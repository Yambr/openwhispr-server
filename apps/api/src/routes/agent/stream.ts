// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 06 / Task 2 — POST /api/agent/stream.
// Phase 08.2 / Plan 02 — upstream call swapped from the inline WHATWG-fetch
// path to the shared @openwhispr/litellm-client's new chatCompletionsStream
// method. Returns Dispatcher.ResponseData (Node Readable body) which we
// bridge to a Web ReadableStream<Uint8Array> via Readable.toWeb for the
// existing sseToNdjson consumer. The client method inherits the
// process-wide SSRF dispatcher (T-08.2-01) and forwards bodyTimeout:0 +
// AbortSignal.
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
//      abort the upstream request (T-04-DISCONNECT mitigation).
//   4. Build upstream via deps.litellm.chatCompletionsStream(...). Model
//      defaulted via D-10 chain, tools translated via D-07, systemPrompt
//      prepended additively via D-11, stream:true + stream_options.
//      include_usage:true forced inside the client (D-12).
//   5. Capture x-litellm-call-id into req.log.info ONLY (T-04-LEAK
//      mitigation — never written to wire). Dispatcher.ResponseData.headers
//      is a Record, not a Headers Map.
//   6. Drain via for-await over sseToNdjson({body: Readable.toWeb(upstream.body), acc}).
//   7. try/catch around the drain: on mid-stream error, emit a
//      finish(stream_error) chunk if writable. finally: end the response.
//
// CRITICAL — after reply.hijack() Fastify's global error handler is
// bypassed. Errors INSIDE the drain land in our try/catch and surface
// as synthetic finish chunks; errors BEFORE hijack (auth re-check) still
// flow through setErrorHandler as canonical envelopes.

import { Readable } from "node:stream";
import type { ExecutableTx, TransactionalDb } from "@openwhispr/data";
import {
  getDefaultAgentModel,
  type LitellmClient,
  LitellmUpstreamError,
} from "@openwhispr/litellm-client";
import {
  type AgentChatMessage,
  type AgentLegacyTool,
  AgentStreamRequestSchema,
} from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../errors.js";
import { type StreamChunk, sseToNdjson } from "../../lib/sse-parser.js";
import { createToolCallAccumulator } from "../../lib/tool-call-accumulator.js";
import { prependSystemPrompt, translateLegacyTools } from "./translate-tools.js";

export interface AgentStreamDeps {
  db: TransactionalDb<ExecutableTx>;
  /**
   * The shared LiteLLM client (Phase 3 D-03). Phase 08.2 — we now consume
   * `chatCompletionsStream` which returns Dispatcher.ResponseData; we bridge
   * the Node Readable body to a Web ReadableStream via Readable.toWeb for
   * the existing sseToNdjson consumer.
   */
  litellm: LitellmClient;
}

// Phase 41.b / HI-01 — DEFAULT_AGENT_MODEL is now sourced from
// compose/litellm/litellm_config.yaml `model_list[0].model_name` via the
// shared loader so the route default cannot drift from the proxy alias.
// Previously this was the literal string `qwen/qwen3.6-plus` which did NOT
// match the yaml alias `qwen3.6-plus` — LiteLLM router emitted a 404 that
// the route surfaced as a finish-chunk `upstream_error` under HTTP 200.
const DEFAULT_AGENT_MODEL = getDefaultAgentModel();

/** Resolve the upstream model per D-10: body → env → fallback. */
function resolveModel(bodyModel: string | undefined): string {
  return bodyModel ?? process.env.DEFAULT_AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
}

/** Emit a single finish chunk + end the response, if still writable. */
function endWithFinish(raw: import("node:http").ServerResponse, finishReason: string): void {
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
      schema: {
        // Phase 41.b / HI-02 — declarative schema reference required by
        // LOCKER-04. The route still calls .parse() manually inside the
        // handler because zod-type-provider's auto-400 path runs AFTER
        // Fastify's body parser but the route's hijack must happen with
        // a validated body — manual parse keeps the order explicit and
        // routes ZodError through registerErrorHandler.
        body: AgentStreamRequestSchema,
      },
      config: {
        // Phase 41.b / HI-03 — authed-only route; skip the IP-tier
        // onRequest hook on anonymous traffic to avoid `owrl:ip:*` bucket
        // creation pre-auth (mirrors tokens/openai-realtime.ts).
        authRequired: true,
        // /api/agent/stream is the most expensive endpoint in the codebase
        // (paid LLM, streaming). Per-user bucket (D-2 in 41-b-DECISIONS):
        // 20/min/user. Below token-mint (30/min) because a single stream
        // can run > 30s and burn N tokens; above admin keys (5/hour)
        // because operators run legitimate batches.
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
      handler: async (req, reply) => {
        // (1) Defensive auth re-check. dualAuthHook should have populated
        //     req.user — if not, throw BEFORE hijack so the centralized
        //     handler emits the canonical 401 envelope (T-04-AUTH).
        if (!req.user?.id) {
          throw new AuthError("unauthorized");
        }
        const userId = req.user.id;
        // Phase 41.b / HI-02 — strict zod validation BEFORE reply.hijack()
        // so a ZodError flows through the centralized 400 envelope handler
        // instead of being swallowed into a synthetic stream_error finish
        // chunk post-hijack. The schema enforces messages/tools cap +
        // structural shape; downstream code can rely on the narrowed types.
        const body: {
          messages: AgentChatMessage[];
          model?: string;
          systemPrompt?: string;
          tools?: AgentLegacyTool[];
        } = AgentStreamRequestSchema.parse(req.body ?? {});

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
        // Plan 51-12tx4 (HI-3) — also forcibly destroy() the upstream
        // Readable on client close. Pre-fix the route relied solely on
        // `Readable.toWeb(...).cancel()` propagation to terminate the
        // undici socket; the live forensic finding (08.2-RESEARCH.md
        // candidate #4) showed this does NOT abort the in-flight request
        // under our SSRF-wrapped Agent in undici 7.25, so a client that
        // opened+disconnected mid-stream continued burning paid LLM
        // tokens until LiteLLM itself finished. Holding a mutable
        // reference to the body lets the close-handler explicitly
        // destroy the source Readable AFTER the upstream resolves.
        const abort = new AbortController();
        let upstreamBodyRef: Readable | null = null;
        req.raw.once("close", () => {
          abort.abort();
          if (upstreamBodyRef !== null && !upstreamBodyRef.destroyed) {
            try {
              upstreamBodyRef.destroy();
              /* v8 ignore next 3 -- defensive: already-destroyed race */
            } catch {
              // already torn down — nothing to do.
            }
          }
        });

        // (4) Issue the upstream POST via the shared litellm-client. The
        //     client owns: model fallback (we still re-derive here to honor
        //     the env DEFAULT_AGENT_MODEL chain), stream:true + include_usage,
        //     authHeaders, spend-logs metadata, bodyTimeout:0, signal
        //     forwarding, and non-2xx → LitellmUpstreamError mapping.
        const messages = prependSystemPrompt(body.messages ?? [], body.systemPrompt);
        const extras: Record<string, unknown> = {};
        if (body.tools !== undefined) {
          extras.tools = translateLegacyTools(body.tools);
        }

        // NOTE (Phase 08.2 deviation — empirical live finding):
        // We intentionally DO NOT pass `signal: abort.signal` to the client
        // here. Live forensic probing against the load-test-mock stack
        // (2026-05-12) showed that on `undici.request`, an AbortSignal
        // combined with the process-wide SSRF-wrapped Agent (production
        // dispatcher) causes the request to fail at the connect/dispatch
        // boundary BEFORE reaching the upstream — reproducing the exact
        // `upstream_error` finish-chunk symptom this phase was opened to
        // eliminate. Removing the signal restored content-bearing SSE.
        // Both candidate causes #1 and #4 in 08.2-RESEARCH.md predicted
        // this class of failure but attributed it to undici.fetch; the
        // live evidence now extends the same class to undici.request +
        // signal under the wrapped Agent.
        //
        // Client-disconnect abort still works correctly via two paths
        // (T-08.2-03 preserved):
        //   1. The `req.raw.once("close", ...)` callback flips
        //      `abort.signal.aborted` so any in-route consumers observe
        //      the abort. The drain loop below checks
        //      `raw.writableEnded` on every iteration and breaks on
        //      client disconnect.
        //   2. `Readable.toWeb(upstream.body)` propagates `cancel()` to
        //      `destroy()` on the source Readable when the consumer
        //      breaks — this closes the underlying undici socket.
        //
        // Deferred follow-up: investigate undici 7.25 `signal:` + custom
        // wrapped `Agent` interaction (research candidate cause #4 — likely
        // related to openclaw/openclaw#19147 / #46685 / #61448).
        let upstream: Awaited<ReturnType<typeof deps.litellm.chatCompletionsStream>>;
        try {
          upstream = await deps.litellm.chatCompletionsStream({
            model: resolveModel(body.model),
            messages,
            userId,
            requestId: req.id,
            extras,
          });
        } catch (err) {
          // Upstream connect failure (network/abort thrown by the HTTP
          // client) OR LitellmUpstreamError (non-2xx) — both map to a
          // single upstream_error finish chunk under HTTP 200 because the
          // reply has already been hijacked.
          if (err instanceof LitellmUpstreamError) {
            req.log.warn({ status: err.status }, "agent.stream upstream non-2xx");
          } else {
            req.log.warn({ err: (err as Error).message }, "agent.stream upstream connect failed");
          }
          endWithFinish(raw, "upstream_error");
          return reply;
        }

        // (5) Capture x-litellm-call-id server-side ONLY (T-04-LEAK).
        //     Dispatcher.ResponseData.headers is a Record<string, string |
        //     string[] | undefined>, not a Headers Map.
        const rawCallId = upstream.headers["x-litellm-call-id"];
        // x-litellm-call-id is always single-valued; undici exposes
        // single-valued headers as a string. We intentionally do NOT
        // attempt array-form coercion (defense in depth handled by
        // `typeof === "string"` discriminant).
        const litellmCallId = typeof rawCallId === "string" ? rawCallId : undefined;
        if (litellmCallId) {
          req.log.info(
            { litellmCallId, requestId: req.id },
            "agent.stream litellm call_id captured",
          );
        }

        // (6) Drain via the SSE→NDJSON async generator. Bridge the Node
        //     Readable body → Web ReadableStream<Uint8Array> via the Node
        //     stdlib Readable.toWeb helper (zero-copy; cancel propagation
        //     destroys the source Readable on consumer break).
        // Plan 51-12tx4 — capture body Readable so the client-close
        // handler can destroy() it directly (kills the undici socket
        // even when toWeb.cancel() propagation under the wrapped Agent
        // doesn't, see HI-3 forensic above).
        upstreamBodyRef = upstream.body as Readable;
        const webBody = Readable.toWeb(upstreamBodyRef) as ReadableStream<Uint8Array>;
        const acc = createToolCallAccumulator();
        try {
          for await (const chunk of sseToNdjson({ body: webBody, acc })) {
            /* v8 ignore next -- writableEnded mid-drain race; raced-only */
            if (raw.writableEnded) break;
            raw.write(`${JSON.stringify(chunk)}\n`);
          }
        } catch (err) {
          // (7) Mid-stream error — synthesize a stream_error finish chunk
          //     so the desktop NDJSON consumer never hangs on a half-open
          //     stream. Then fall through to the finally to end the response.
          req.log.warn({ err: (err as Error).message }, "agent.stream drain error");
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
