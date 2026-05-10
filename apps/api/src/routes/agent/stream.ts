// Phase 04 / Plan 06 / Task 2 — POST /api/agent/stream.
//
// NDJSON streaming chat handler that composes the Wave-1 utilities:
//   * sseToNdjson (apps/api/src/lib/sse-parser.ts)
//   * createToolCallAccumulator (apps/api/src/lib/tool-call-accumulator.ts)
//   * translateLegacyTools + prependSystemPrompt (./translate-tools.ts)
//
// Wire shape: BACKEND_SPEC §/api/agent/stream — Content-Type
// `application/x-ndjson`, one BACKEND_SPEC chunk per line, finish chunk
// terminating the stream.
//
// Lifecycle (RESEARCH §2.2 lines 207–296):
//   1. Defensive auth re-check (req.user.id) → AuthError if missing. The
//      throw happens BEFORE reply.hijack() so the centralized
//      setErrorHandler still emits the 401 envelope.
//   2. Set headers (Content-Type, X-Accel-Buffering, Cache-Control), then
//      reply.hijack() + reply.raw.flushHeaders() + setNoDelay(true) per
//      D-02 (Node 24 has no flush() — kernel sends each write).
//   3. AbortController wired via req.raw.on('close') — client disconnects
//      abort the upstream fetch (T-04-DISCONNECT mitigation).
//   4. Build upstream POST: model defaulted via D-10 chain, tools translated
//      via D-07, systemPrompt prepended additively via D-11, stream:true +
//      stream_options.include_usage:true forwarded (D-12).
//   5. Capture x-litellm-call-id into req.log.info ONLY (T-04-LEAK
//      mitigation — never written to wire).
//   6. Drain via for-await over sseToNdjson({body, acc}) — one
//      reply.raw.write per chunk. JSON.stringify(chunk) + '\n'.
//   7. try/catch around the drain: on mid-stream error, emit a
//      finish(stream_error) chunk if writable. finally: end the response.
//
// CRITICAL — after reply.hijack() Fastify's global error handler is
// bypassed. Errors INSIDE the drain land in our try/catch and surface
// as synthetic finish chunks; errors BEFORE hijack (auth re-check) still
// flow through setErrorHandler as canonical envelopes.

import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import type { LitellmClient } from "@openwhispr/litellm-client";
import type { FastifyInstance } from "fastify";
import { fetch as undiciFetch } from "undici";
import { AuthError } from "../../errors.js";
import { createToolCallAccumulator } from "../../lib/tool-call-accumulator.js";
import { sseToNdjson, type StreamChunk } from "../../lib/sse-parser.js";
import {
  type ChatMessage,
  type LegacyTool,
  prependSystemPrompt,
  translateLegacyTools,
} from "./translate-tools.js";

export interface AgentStreamDeps {
  db: TransactionalDb<ExecutableTx>;
  /**
   * The shared LiteLLM client (Phase 3 D-03). We only consume `baseUrl`
   * and `masterKey` for the request — the hand-rolled async generator
   * needs raw stream access that LitellmClient.chatCompletions doesn't
   * expose, so we issue the upstream POST via undici directly.
   */
  litellm: LitellmClient & { masterKey?: string };
}

interface RequestBody {
  messages: ChatMessage[];
  model?: string;
  systemPrompt?: string;
  tools?: LegacyTool[];
}

const DEFAULT_AGENT_MODEL = "qwen/qwen3.6-plus";

/** Resolve the upstream model per D-10: body → env → fallback. */
function resolveModel(bodyModel: string | undefined): string {
  return bodyModel ?? process.env.DEFAULT_AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
}

/** Emit a single finish chunk + end the response, if still writable. */
function endWithFinish(
  raw: import("node:http").ServerResponse,
  finishReason: string,
): void {
  /* v8 ignore next */
  if (raw.writableEnded) return;
  const chunk: StreamChunk = {
    type: "finish",
    finishReason,
    usage: { promptTokens: 0, completionTokens: 0 },
  };
  try {
    raw.write(`${JSON.stringify(chunk)}\n`);
    /* v8 ignore next 3 -- socket-already-closed defensive guard; raced-only */
  } catch {
    // Socket closed mid-write — give up; the client already disconnected.
  }
  try {
    raw.end();
    /* v8 ignore next 3 -- socket-already-closed defensive guard; raced-only */
  } catch {
    // ditto.
  }
}

export const buildAgentStreamRoutes = (deps: AgentStreamDeps) =>
  async function agentStreamRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/agent/stream",
      handler: async (req, reply) => {
        // (1) Defensive auth re-check. dualAuthHook should have populated
        //     req.user — if not, throw BEFORE hijack so the centralized
        //     handler emits the canonical 401 envelope (T-04-AUTH).
        if (!req.user?.id) {
          throw new AuthError("unauthorized");
        }
        const userId = req.user.id;
        const body = (req.body ?? {}) as RequestBody;

        // (2) Set headers, hijack, flush, disable Nagle (D-02 / D-04).
        // Use raw.setHeader directly so light-my-request preserves them
        // across reply.hijack() (Fastify reply.header() routes through the
        // serializer which is bypassed by hijack).
        const raw = reply.raw;
        raw.setHeader("Content-Type", "application/x-ndjson");
        raw.setHeader("X-Accel-Buffering", "no");
        raw.setHeader("Cache-Control", "no-cache, no-transform");
        reply.hijack();
        try {
          raw.flushHeaders();
          /* v8 ignore next 4 -- defensive: flushHeaders may throw on already-flushed adapters */
        } catch {
          // flushHeaders may throw if already flushed in some adapters —
          // safe to ignore; the headers above are queued either way.
        }
        try {
          req.raw.socket?.setNoDelay(true);
          /* v8 ignore next 3 -- defensive: setNoDelay isn't always available on test sockets */
        } catch {
          // Defensive: setNoDelay isn't always available on test sockets.
        }

        // (3) AbortController wired to client disconnect (T-04-DISCONNECT).
        const abort = new AbortController();
        req.raw.once("close", () => {
          abort.abort();
        });

        // (4) Build the upstream request body.
        const upstreamBody = {
          model: resolveModel(body.model),
          messages: prependSystemPrompt(body.messages ?? [], body.systemPrompt),
          ...(body.tools !== undefined
            ? { tools: translateLegacyTools(body.tools) }
            : {}),
          stream: true,
          stream_options: { include_usage: true },
          user: userId,
        };

        const upstreamUrl = `${deps.litellm.baseUrl}/v1/chat/completions`;
        const masterKey =
          (deps.litellm as { masterKey?: string }).masterKey ?? "";
        const headers: Record<string, string> = {
          "content-type": "application/json",
          authorization: `Bearer ${masterKey}`,
          "x-litellm-spend-logs-metadata": JSON.stringify({
            openwhispr_request_id: req.id,
            openwhispr_user_id: userId,
          }),
        };

        let upstream: Awaited<ReturnType<typeof undiciFetch>>;
        try {
          upstream = await undiciFetch(upstreamUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(upstreamBody),
            signal: abort.signal,
          });
          /* v8 ignore next 8 -- network connect failure path; exercised in
             integration tests against a torn-down upstream. The unit-level
             non-2xx path covered by Test 9 already exercises the same
             upstream_error finish-chunk emission below. */
        } catch (err) {
          // Network failure / abort during the upstream connect — emit a
          // single upstream_error finish chunk and end. The client side
          // sees a clean stream-end with the reason in-band.
          req.log.warn({ err: (err as Error).message }, "agent.stream upstream connect failed");
          endWithFinish(raw, "upstream_error");
          return reply;
        }

        // (5) Capture x-litellm-call-id server-side ONLY (T-04-LEAK).
        const litellmCallId = upstream.headers.get("x-litellm-call-id");
        if (litellmCallId) {
          req.log.info(
            { litellmCallId, requestId: req.id },
            "agent.stream litellm call_id captured",
          );
        }

        if (!upstream.ok || !upstream.body) {
          req.log.warn(
            { status: upstream.status },
            "agent.stream upstream non-2xx",
          );
          endWithFinish(raw, "upstream_error");
          return reply;
        }

        // (6) Drain via the SSE→NDJSON async generator. One write per chunk.
        const acc = createToolCallAccumulator();
        try {
          for await (const chunk of sseToNdjson({ body: upstream.body, acc })) {
            /* v8 ignore next -- writableEnded mid-drain race; raced-only */
            if (raw.writableEnded) break;
            raw.write(`${JSON.stringify(chunk)}\n`);
          }
        } catch (err) {
          // (7) Mid-stream error — synthesize a stream_error finish chunk
          //     so the desktop NDJSON consumer never hangs on a half-open
          //     stream. Then fall through to the finally to end the response.
          req.log.warn(
            { err: (err as Error).message },
            "agent.stream drain error",
          );
          if (!raw.writableEnded) {
            const finish: StreamChunk = {
              type: "finish",
              finishReason: "stream_error",
              usage: { promptTokens: 0, completionTokens: 0 },
            };
            try {
              raw.write(`${JSON.stringify(finish)}\n`);
              /* v8 ignore next 3 -- defensive: socket closed mid-write */
            } catch {
              // socket already closed — nothing more to do.
            }
          }
        } finally {
          if (!raw.writableEnded) {
            try {
              raw.end();
              /* v8 ignore next 3 -- defensive: socket closed mid-end */
            } catch {
              // socket already closed.
            }
          }
        }
        return reply;
      },
    });
  };

export default buildAgentStreamRoutes;
