// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 06 / Task 2 — POST /api/agent/stream tests.
//
// Strategy: hermetic Fastify app with the centralized error handler + a
// synthetic onRequest auth hook (mirrors tokens/openai-realtime.test.ts
// pattern). undici MockAgent intercepts the LiteLLM upstream so the
// handler exercises the real undici fetch path. The reply.hijack() +
// raw.write() chain is exercised end-to-end through `app.inject()` —
// Fastify's light-my-request preserves the raw socket semantics.
//
// CLAUDE.md compliance: only undici (network process boundary) + the
// Better-Auth boundary (synthetic onRequest hook) are mocked. The route's
// own logic — sse-parser composition, tool-call accumulator, translate-
// tools, abort wiring — is exercised end-to-end through Fastify inject.
//
// Acceptance matrix (12 tests, see 04-06-PLAN.md Task 2 behavior):
//  1. 200 + Content-Type 'application/x-ndjson' + first line read fast
//  2. text-only fixture → text-delta lines + finish chunk vocabulary
//  3. legacy tools translated to OpenAI shape on upstream POST body
//  4. systemPrompt additively prepended (never replaces leading system msg)
//  5. model default chain: body → env → yaml model_list[0].model_name
//     (Phase 41.b / HI-01 — was 'qwen/qwen3.6-plus'; now derived from
//     compose/litellm/litellm_config.yaml so route + proxy can't drift)
//  6. stream:true + stream_options:{include_usage:true} + user forwarded
//  7. x-litellm-call-id captured server-side only — NEVER in wire response
//  8. Client disconnect aborts upstream (signal.aborted within 100ms)
//  9. Upstream non-2xx → ONE terminal type:"error" chunk (260528-0cm rev)
// 10. Mid-stream error → terminal type:"error" chunk (260528-0cm rev)
// 11. Unauthenticated → 401 BEFORE the handler hijacks the reply
// 12. X-Accel-Buffering: no on response (forward-compat for nginx)
//
// 260528-0cm — Tests 9 / 10 / 17 / 18 rewritten to assert the new wire
// envelope: `{type:"error", error, code, provider}` replacing the
// previous `{type:"done", finishReason:"upstream_error"|"stream_error"}`
// chunks. Closes HIGH bug from peer 9zn786o0.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLitellmClient,
  type LitellmClient,
  LitellmUpstreamError,
} from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { AuthError } from "../../../../src/errors.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildAgentStreamRoutes } from "../../../../src/routes/agent/stream.js";

const LITELLM_BASE = "http://litellm.test:4000";
const LITELLM_PATH = "/v1/chat/completions";

let agent: MockAgent;

/**
 * Phase 08.2 Plan 02 — the route now consumes
 * `deps.litellm.chatCompletionsStream`. We build a REAL client (with the
 * test-bound baseUrl) so MockAgent intercepts the undici.request the
 * client issues. Tests that need to simulate the client throwing
 * (Tests 14 / 15) override `chatCompletionsStream` on the returned client
 * with a custom rejection.
 */
function fakeLitellm(overrides?: Partial<LitellmClient>): LitellmClient {
  const client = buildLitellmClient(
    {
      baseUrl: LITELLM_BASE,
      masterKey: "sk-master-test",
      providerKeys: {
        openrouter: "sk-or-test",
        groq: "gsk-test",
        pyannote: "hf-test",
      },
      defaultChatModel: "qwen3.6-plus",
      // 260528-0cm — Tests 9/10 exercise the non-2xx drain path which
      // reads `config.errorDrainTimeoutMs` into `AbortSignal.timeout(ms)`.
      // The pre-260528-0cm fakeLitellm omitted these fields and undici's
      // 503 reply path threw a TypeError ("delay argument must be of
      // type number") instead of the expected LitellmUpstreamError.
      // Production callers always go through `loadLitellmConfigFromEnv`
      // which fills these from defaults — only the test fixture was
      // missing them.
      defaultSttModel: "whisper-1",
      defaultRealtimeModel: "gpt-4o-realtime-preview",
      defaultCleanupModel: "qwen3.6-plus",
      headersTimeoutMs: 30_000,
      bodyTimeoutMs: 30_000,
      errorDrainTimeoutMs: 5_000,
      retryMaxAttempts: 1,
      retryBaseMs: 100,
      retryCapMs: 1_000,
    },
    { isOverride: true }, // skip provider-key precheck (test uses arbitrary models)
  );
  if (overrides) {
    return Object.assign(Object.create(Object.getPrototypeOf(client)), client, overrides);
  }
  return client;
}

function fakeDb(): {
  transaction<T>(cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>): Promise<T>;
} {
  return {
    async transaction(cb) {
      return cb({
        async execute() {
          return { rows: [] };
        },
      });
    },
  };
}

interface TestAppOpts {
  bearerMap?: Record<string, string>;
  defaultAgentModelEnv?: string | null;
}

async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  if (opts.defaultAgentModelEnv === null) {
    delete process.env.DEFAULT_AGENT_MODEL;
  } else if (typeof opts.defaultAgentModelEnv === "string") {
    process.env.DEFAULT_AGENT_MODEL = opts.defaultAgentModelEnv;
  }
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) throw new AuthError("unauthorized");
    const userId = opts.bearerMap?.[value];
    if (!userId) throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: userId,
      email: `${userId}@test.local`,
    };
  });
  await app.register(
    buildAgentStreamRoutes({
      db: fakeDb() as never,
      litellm: fakeLitellm(),
    }),
  );
  await app.ready();
  return app;
}

/** Construct a single SSE frame body string. */
function sseFrame(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

/** A canonical text-only SSE stream ending in finish_reason="stop". */
function buildTextOnlySse(): string {
  return (
    sseFrame({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] }) +
    sseFrame({ choices: [{ delta: { content: " world" }, finish_reason: null }] }) +
    sseFrame({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }) +
    "data: [DONE]\n\n"
  );
}

/** A multi-tool-call SSE stream that drains via the accumulator. */
function buildMultiToolCallSse(): string {
  return (
    sseFrame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "tc_a",
                function: { name: "lookup", arguments: '{"q":' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }) +
    sseFrame({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"foo"}' } }],
          },
          finish_reason: null,
        },
      ],
    }) +
    sseFrame({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 1,
                id: "tc_b",
                function: { name: "search", arguments: '{"x":1}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }) +
    sseFrame({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }) +
    "data: [DONE]\n\n"
  );
}

beforeEach(() => {
  agent = new MockAgent({ connections: 10 });
  agent.disableNetConnect();
  // Phase 41.f / HI-2 — the litellm-client now refuses any outbound
  // request unless the global undici dispatcher carries the SSRF marker
  // stamped by `makeSSRFDispatcher()`. The MockAgent is a hermetic
  // network boundary so we stamp the same well-known Symbol here; the
  // canonical pattern is mirrored from
  // `packages/litellm-client/tests/unit/index.test.ts`.
  Object.defineProperty(agent, Symbol.for("openwhispr.ssrf-wrapped"), {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  // Restore a real Agent so subsequent tests in other suites are unaffected.
  setGlobalDispatcher(new Agent());
  vi.restoreAllMocks();
  delete process.env.DEFAULT_AGENT_MODEL;
});

describe("POST /api/agent/stream", () => {
  it("Test 1 — returns 200 with Content-Type application/x-ndjson and the first NDJSON line is small/fast", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const t0 = Date.now();
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const elapsed = Date.now() - t0;
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
      // Body has at least one full NDJSON line; first line parses to a chunk.
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThan(0);
      const first = JSON.parse(lines[0]) as { type: string };
      expect(first.type).toBe("content");
      // Sanity: the entire round-trip stays under a generous unit budget.
      // (e2e budget < 500ms is asserted in plan 09 against the live stack.)
      expect(elapsed).toBeLessThan(2000);
    } finally {
      await app.close();
    }
  });

  it("R23 — accepts the FULL documented BACKEND_SPEC request body (messages + systemPrompt + tools + sessionId + clientType + appVersion)", async () => {
    // R23: the immutable desktop client POSTs sessionId/clientType/
    // appVersion alongside messages. Pre-R23 the schema was `.strict()`
    // and missing those three keys, so the documented body 400'd.
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          model: "qwen3.6-plus",
          systemPrompt: "be helpful",
          tools: [{ name: "search", description: "web", parameters: { type: "object" } }],
          sessionId: "11111111-2222-3333-4444-555555555555",
          clientType: "desktop",
          appVersion: "1.2.3",
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("R28 — accepts the first-dictation body with model:null, systemPrompt:null, tools:null -> 200 NDJSON", async () => {
    // R28: the immutable desktop client builds the body from
    // `opts.model` / `opts.systemPrompt`; on the FIRST dictation of a
    // session those are `null`, so the body literally carries
    // `"model":null`. `.optional()` rejected `null`; `.nullish()` admits
    // it and the handler treats null === undefined (resolveModel `??`,
    // prependSystemPrompt falsy-check, tools null-skip).
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          model: null,
          systemPrompt: null,
          tools: null,
          sessionId: null,
          clientType: null,
          appVersion: null,
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("R28 — accepts a tool whose description is null -> 200 NDJSON", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          tools: [{ name: "search", description: null, parameters: { type: "object" } }],
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
    } finally {
      await app.close();
    }
  });

  it("R23 — accepts an UNDOCUMENTED extra top-level field (.passthrough() forward-compat)", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          futureClientField: "value",
        },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
    } finally {
      await app.close();
    }
  });

  it("Test 2 — chunk vocabulary matches BACKEND_SPEC for multi-tool-call stream", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildMultiToolCallSse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      const chunks = r.body
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const toolCalls = chunks.filter((c) => c.type === "tool_call");
      expect(toolCalls.length).toBe(2);
      expect(toolCalls[0]).toMatchObject({
        type: "tool_call",
        id: "tc_a",
        name: "lookup",
        arguments: '{"q":"foo"}',
      });
      expect(toolCalls[1]).toMatchObject({
        type: "tool_call",
        id: "tc_b",
        name: "search",
        arguments: '{"x":1}',
      });
      const finish = chunks.at(-1) as {
        type: string;
        finishReason: string;
        usage: { promptTokens: number; completionTokens: number };
      };
      expect(finish.type).toBe("done");
      expect(finish.finishReason).toBe("tool_calls");
      expect(finish.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    } finally {
      await app.close();
    }
  });

  it("Test 3 — legacy tools array translated to OpenAI shape on upstream POST body", async () => {
    let captured: Record<string, unknown> | null = null;
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, (opts) => {
        try {
          const raw = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
          captured = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          captured = null;
        }
        return buildTextOnlySse();
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          tools: [
            {
              name: "search",
              description: "Search the web",
              parameters: { type: "object", properties: { q: { type: "string" } } },
            },
          ],
        },
      });
      expect(r.statusCode).toBe(200);
      expect(captured).not.toBeNull();
      const tools = (captured as Record<string, unknown>).tools as Array<{
        type: string;
        function: { name: string; parameters: unknown };
      }>;
      expect(tools).toHaveLength(1);
      expect(tools[0].type).toBe("function");
      expect(tools[0].function.name).toBe("search");
      expect(tools[0].function.parameters).toEqual({
        type: "object",
        properties: { q: { type: "string" } },
      });
    } finally {
      await app.close();
    }
  });

  it("Test 4 — systemPrompt is additively prepended; original system message preserved", async () => {
    let captured: Record<string, unknown> | null = null;
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, (opts) => {
        const raw = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
        captured = JSON.parse(raw) as Record<string, unknown>;
        return buildTextOnlySse();
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          systemPrompt: "be helpful",
          messages: [
            { role: "system", content: "you are a sloth" },
            { role: "user", content: "hi" },
          ],
        },
      });
      expect(captured).not.toBeNull();
      const messages = (captured as Record<string, unknown>).messages as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0]).toEqual({ role: "system", content: "be helpful" });
      expect(messages[1]).toEqual({ role: "system", content: "you are a sloth" });
      expect(messages[2]).toEqual({ role: "user", content: "hi" });
    } finally {
      await app.close();
    }
  });

  it("Test 5 — model default chain: body → env → yaml model_list[0].model_name (HI-01)", async () => {
    const captures: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 3; i++) {
      agent
        .get(LITELLM_BASE)
        .intercept({ path: LITELLM_PATH, method: "POST" })
        .reply(200, (opts) => {
          const raw = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
          captures.push(JSON.parse(raw) as Record<string, unknown>);
          return buildTextOnlySse();
        });
    }

    // Case A — env DEFAULT_AGENT_MODEL set, no body.model → uses env value.
    const appA = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1" },
      defaultAgentModelEnv: "custom-model",
    });
    try {
      await appA.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
    } finally {
      await appA.close();
    }
    // Case B — env unset, no body.model → falls through to qwen.
    const appB = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1" },
      defaultAgentModelEnv: null,
    });
    try {
      await appB.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
    } finally {
      await appB.close();
    }
    // Case C — explicit body.model wins regardless of env.
    const appC = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1" },
      defaultAgentModelEnv: "custom-model",
    });
    try {
      await appC.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }], model: "explicit" },
      });
    } finally {
      await appC.close();
    }
    expect(captures).toHaveLength(3);
    expect((captures[0] as { model: string }).model).toBe("custom-model");
    // Phase 41.b / HI-01 — default is now sourced from compose/litellm/
    // litellm_config.yaml's first model_list entry (currently
    // 'qwen3.6-plus', NO `qwen/` prefix). The route MUST match the proxy
    // alias verbatim or LiteLLM router 404s the request.
    expect((captures[1] as { model: string }).model).toBe("qwen3.6-plus");
    expect((captures[2] as { model: string }).model).toBe("explicit");
  });

  it("Test 6 — upstream body always carries stream:true + stream_options.include_usage:true + user", async () => {
    let captured: Record<string, unknown> | null = null;
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, (opts) => {
        const raw = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
        captured = JSON.parse(raw) as Record<string, unknown>;
        return buildTextOnlySse();
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const c = captured as unknown as {
        stream: boolean;
        stream_options: { include_usage: boolean };
        user: string;
      };
      expect(c.stream).toBe(true);
      expect(c.stream_options).toEqual({ include_usage: true });
      expect(c.user).toBe("u1");
    } finally {
      await app.close();
    }
  });

  it("Test 7 — x-litellm-call-id captured server-side only; NEVER appears in wire response (T-04-LEAK)", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: {
          "content-type": "text/event-stream",
          "x-litellm-call-id": "call_xyz_secret",
        },
      });

    // Build a custom app that wires the log-capture hook BEFORE app.ready().
    process.env.DEFAULT_AGENT_MODEL = "test-model";
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    const logged: Array<unknown> = [];
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
      const origInfo = req.log.info.bind(req.log);
      req.log.info = ((obj: unknown, msg?: string) => {
        logged.push({ obj, msg });
        return origInfo(obj as never, msg as never);
      }) as typeof req.log.info;
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm: fakeLitellm(),
      }),
    );
    await app.ready();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      // Wire response MUST NOT contain the call-id literal.
      expect(r.body).not.toContain("call_xyz_secret");
      // Server-side log line MUST contain it (proves we captured it).
      const stringified = JSON.stringify(logged);
      expect(stringified).toContain("call_xyz_secret");
    } finally {
      await app.close();
    }
  });

  it("Test 8 — client disconnect wires AbortController via req.raw.once('close'); aborting fires the upstream signal", async () => {
    // Spy on AbortController construction so we can capture the instance the
    // route creates, then trigger the close handler and assert the signal aborts.
    const OriginalAC = globalThis.AbortController;
    const created: AbortController[] = [];
    class SpyAbortController extends OriginalAC {
      constructor() {
        super();
        created.push(this as unknown as AbortController);
      }
    }
    globalThis.AbortController = SpyAbortController as unknown as typeof AbortController;

    let onceUpstreamConnected: (() => void) | null = null;
    const upstreamConnected = new Promise<void>((res) => {
      onceUpstreamConnected = res;
    });
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, () => {
        if (onceUpstreamConnected) (onceUpstreamConnected as () => void)();
        return buildTextOnlySse();
      });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    let capturedReq: import("fastify").FastifyRequest | null = null;
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
      capturedReq = req;
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm: fakeLitellm(),
      }),
    );
    await app.ready();
    try {
      const injectPromise = app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      // Wait for the upstream call to fire (proves the route reached the
      // body of the handler where the AbortController is constructed and
      // the close listener is attached).
      await upstreamConnected;
      // Capture the route's AbortController (it's the one the route just
      // constructed — most-recent in the spy array).
      expect(created.length).toBeGreaterThan(0);
      const routeAc = created[created.length - 1];
      // Verify the route attached a close listener on req.raw (count > 0).
      expect(capturedReq).not.toBeNull();
      const raw = (capturedReq as { raw: import("node:stream").Readable }).raw;
      expect(raw.listenerCount("close")).toBeGreaterThan(0);
      // Fire close — the route's listener calls abort.abort() on the AC.
      raw.emit("close");
      // The synchronous abort.abort() flips signal.aborted immediately.
      expect(routeAc.signal.aborted).toBe(true);
      try {
        await injectPromise;
      } catch {
        /* expected post-abort */
      }
    } finally {
      globalThis.AbortController = OriginalAC;
      await app.close();
    }
  });

  it("Test 8b — client disconnect destroy()s the upstream Readable body within 100ms (undici socket FIN — closes the AbortSignal-under-wrapped-Agent disconnect gap)", async () => {
    // Per the advisor study (2026-05-23) that resolved the deferred
    // undici-7.25 AbortSignal-under-wrapped-Agent question: undici 8 is
    // contraindicated (active per-request-dispatcher regressions). The
    // correct fix is to keep 7.25 and rely on `upstream.body.destroy()`
    // from the `req.raw.once("close")` listener — that's what closes
    // the undici socket since the `signal:` parameter is intentionally
    // omitted (stream.ts L223-244). This test pins that the destroy()
    // call actually fires on client disconnect, closing the 1000-
    // concurrent in-flight-POST risk this codebase is sized for.
    //
    // Strategy: stub `chatCompletionsStream` to return a controllable
    // upstream Readable that NEVER ends; trigger raw.emit("close") and
    // assert `body.destroyed === true` within 100ms (matches Test 8's
    // SLO budget for client-disconnect propagation).
    const { Readable } = await import("node:stream");
    const controllableBody = new Readable({ read() {} });
    // Wire upstream that never completes (keeps the route in the drain
    // loop until disconnect tears it down).
    const stubbedClient = fakeLitellm({
      async chatCompletionsStream() {
        return {
          statusCode: 200,
          headers: {},
          trailers: {},
          opaque: null,
          context: {},
          body: controllableBody as unknown as import("undici").Dispatcher.ResponseData<unknown>["body"],
        };
      },
    });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    let capturedReq: import("fastify").FastifyRequest | null = null;
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
      capturedReq = req;
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm: stubbedClient,
      }),
    );
    await app.ready();
    try {
      const injectPromise = app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      // Wait for the route to wire the close listener (proves
      // `upstreamBodyRef` has been assigned in the handler).
      const startedAt = Date.now();
      while (capturedReq === null && Date.now() - startedAt < 1000) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(capturedReq).not.toBeNull();
      // Push one chunk so the route advances past the headers-flush
      // and assigns upstreamBodyRef (the assignment in stream.ts L310
      // happens at the bridge step before drain).
      controllableBody.push("data: {}\n\n");
      await new Promise((r) => setTimeout(r, 30));
      // Pre-condition: body is alive.
      expect(controllableBody.destroyed).toBe(false);
      // Fire client disconnect — the route's req.raw.once("close")
      // listener (stream.ts L195-205) must call upstreamBodyRef.destroy().
      const raw = (capturedReq as { raw: import("node:stream").Readable }).raw;
      raw.emit("close");
      // SLO budget — destroy() should propagate synchronously inside the
      // listener; allow a tick for the scheduler.
      const destroyDeadline = Date.now() + 100;
      while (!controllableBody.destroyed && Date.now() < destroyDeadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(controllableBody.destroyed).toBe(true);
      try {
        await injectPromise;
      } catch {
        /* expected post-abort */
      }
    } finally {
      // Best-effort cleanup if the route didn't destroy (test failure path).
      if (!controllableBody.destroyed) controllableBody.destroy();
      await app.close();
    }
  });

  it("Test 9 (260528-0cm) — upstream 503 → ONE terminal type:'error' chunk (code:upstream_unknown, provider:litellm)", async () => {
    agent.get(LITELLM_BASE).intercept({ path: LITELLM_PATH, method: "POST" }).reply(503, "boom");

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const chunk = JSON.parse(lines[0]) as {
        type: string;
        error: string;
        code: string;
        provider: string;
      };
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_unknown");
      expect(chunk.provider).toBe("litellm");
      expect(typeof chunk.error).toBe("string");
      expect(chunk.error.length).toBeGreaterThan(0);
      // D4 — `finishReason:"upstream_error"` literal must not appear.
      expect(r.body).not.toContain('"finishReason":"upstream_error"');
      // D1 — no `done` chunk follows the terminal `error` chunk.
      expect(r.body).not.toContain('"type":"done"');
    } finally {
      await app.close();
    }
  });

  it("Test 10 (260528-0cm) — mid-stream drain error → terminal type:'error' chunk (code:upstream_unknown, provider:unknown)", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    // Custom app that wraps reply.raw.write to throw after the first chunk.
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    const writes: string[] = [];
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
    });
    app.addHook("preHandler", async (_req, reply) => {
      // Wrap raw.write so the FIRST chunk write succeeds (capturing the
      // text-delta), then subsequent writes from the drain throw — the
      // route's try/catch must surface this as a terminal type:"error"
      // chunk (260528-0cm: replaces the previous synthetic done.stream_error).
      const raw = reply.raw;
      const origWrite = raw.write.bind(raw);
      let n = 0;
      let inError = false;
      raw.write = ((chunk: unknown, ...rest: unknown[]) => {
        const text = String(chunk);
        // Allow the synthetic terminal type:"error" chunk through so the
        // wire response actually contains it.
        if (text.includes('"type":"error"')) inError = true;
        if (n >= 1 && !inError) {
          throw new Error("simulated mid-stream socket error");
        }
        writes.push(text);
        n++;
        return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof raw.write;
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm: fakeLitellm(),
      }),
    );
    await app.ready();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      const last = JSON.parse(lines.at(-1) as string) as {
        type: string;
        code: string;
        provider: string;
        error: string;
      };
      expect(last.type).toBe("error");
      // Drain-side raw.write throw is a plain Error (NOT a
      // LitellmUpstreamError) — provider:"unknown" per D2 lock.
      expect(last.code).toBe("upstream_unknown");
      expect(last.provider).toBe("unknown");
      // D4 — `finishReason:"stream_error"` literal must not appear.
      expect(r.body).not.toContain('"finishReason":"stream_error"');
    } finally {
      await app.close();
    }
  });

  it("Test 11 — unauthenticated request returns 401 BEFORE the handler hijacks the reply", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: "unauthorized" });
    } finally {
      await app.close();
    }
  });

  it("Test 13 (branch coverage) — defensive auth re-check throws AuthError when req.user.id is absent at handler time", async () => {
    // Build an app where the onRequest hook 'authenticates' but does NOT
    // set req.user — exercising the route's `if (!req.user?.id)` defensive
    // gate (T-04-AUTH defense-in-depth).
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (_req) => {
      // No-op — pretend dual-auth ran but a downstream bug erased req.user.
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm: fakeLitellm(),
      }),
    );
    await app.ready();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: "unauthorized" });
    } finally {
      await app.close();
    }
  });

  it("Test 14 (HI-02) — empty body returns 400 zod envelope BEFORE reply.hijack (no upstream call)", async () => {
    // Phase 41.b / HI-02 — previously the route did `(req.body ?? {}) as
    // RequestBody` and tolerated missing `messages`. The strict
    // AgentStreamRequestSchema now requires `messages` so an empty body
    // is a canonical 400 — flowing through registerErrorHandler's
    // ZodError → 400 envelope branch (NOT a post-hijack stream_error
    // chunk). No upstream call is ever issued.
    let upstreamHit = false;
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, () => {
        upstreamHit = true;
        return buildTextOnlySse();
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r.statusCode).toBe(400);
      // ZodError flows through the centralized handler; envelope has
      // an `error` string field.
      const json = r.json() as { error?: string };
      expect(typeof json.error).toBe("string");
      expect(upstreamHit).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("Test 19 (HI-02) — string `tools` field is rejected with 400 zod envelope (cast-bypass class)", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }], tools: "abc" },
      });
      expect(r.statusCode).toBe(400);
      expect(r.headers["content-type"]).toMatch(/application\/json/);
    } finally {
      await app.close();
    }
  });

  it("Test 20 (R23) — unknown top-level keys are tolerated (.passthrough())", async () => {
    // R23 (was HI-02): the request schema was relaxed from `.strict()` to
    // `.passthrough()`. The immutable desktop client sends documented
    // metadata fields (sessionId/clientType/appVersion) and may add more;
    // an unmodeled key no longer 400s — it is accepted and ignored while
    // `messages` (+ the typed fields) stay validated.
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }], sneaky: 1 },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
    } finally {
      await app.close();
    }
  });

  it("Test 21 (HI-02) — oversize messages (> 50) is rejected with 400 (cost-multiplier cap)", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const messages = Array.from({ length: 51 }, () => ({
        role: "user",
        content: "x",
      }));
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages },
      });
      expect(r.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("Test 12 — response includes X-Accel-Buffering: no header (forward-compat for nginx-fronting operators)", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["x-accel-buffering"]).toBe("no");
    } finally {
      await app.close();
    }
  });

  // ---- Phase 08.2 Plan 02 — regression + new failure-path tests ----

  it("Test 16 (08.2 regression) — route source no longer imports undici.fetch", async () => {
    // File-level guard: re-importing undici.fetch would reintroduce the
    // production failure class this phase was opened to eliminate. We read
    // the route source from disk and assert zero occurrences of the import
    // alias and call site.
    // red-baseline: 2026-05-15 (Phase 18.1 F3 — Test 16 ENOENT)
    const here = dirname(fileURLToPath(import.meta.url));
    const streamSourcePath = resolve(
      here,
      "..",
      "..",
      "..",
      "..",
      "src",
      "routes",
      "agent",
      "stream.ts",
    );
    if (!existsSync(streamSourcePath)) {
      throw new Error(`source-contract path moved: ${streamSourcePath}`);
    }
    const source = readFileSync(streamSourcePath, "utf8");
    // POSITIVE — prove the file was actually loaded (no silent empty-string pass).
    expect(source.length).toBeGreaterThan(100);
    expect(source).not.toMatch(/fetch\s+as\s+undiciFetch/);
    expect(source).not.toMatch(/\bundiciFetch\s*\(/);
    // Positive guard: the route MUST call chatCompletionsStream and bridge
    // via Readable.toWeb.
    expect(source).toMatch(/chatCompletionsStream/);
    expect(source).toMatch(/Readable\.toWeb/);
  });

  it("Test 17 (260528-0cm) — upstream connect throw (fetch failed analogue) → terminal type:'error' chunk (code:upstream_unknown, provider:unknown)", async () => {
    // Stub chatCompletionsStream on the deps to throw with the same error
    // shape undici emits at the connect/dispatch boundary. Reproduces the
    // live production-mode failure observed in the 08.1 forensic-probe run.
    const litellm = fakeLitellm({
      chatCompletionsStream: () => Promise.reject(new Error("fetch failed")),
    });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm,
      }),
    );
    await app.ready();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const chunk = JSON.parse(lines[0]) as {
        type: string;
        code: string;
        provider: string;
        error: string;
      };
      // Plain Error (not LitellmUpstreamError) — `fetch failed` does not
      // carry a recognized timeout error code, so the classifier maps it
      // to upstream_unknown, NOT upstream_timeout. Provider is "unknown"
      // because it isn't a LitellmUpstreamError instance (D2 lock).
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_unknown");
      expect(chunk.provider).toBe("unknown");
      expect(typeof chunk.error).toBe("string");
      expect(chunk.error.length).toBeGreaterThan(0);
      // D4 — no `finishReason:"upstream_error"` literal on the wire.
      expect(r.body).not.toContain('"finishReason":"upstream_error"');
      // D1 — no `done` chunk follows the terminal error chunk.
      expect(r.body).not.toContain('"type":"done"');
    } finally {
      await app.close();
    }
  });

  it("Test 18 (260528-0cm) — LitellmUpstreamError(502) → terminal type:'error' chunk (code:upstream_unknown, provider:litellm)", async () => {
    const litellm = fakeLitellm({
      chatCompletionsStream: () =>
        Promise.reject(new LitellmUpstreamError(502, "upstream timed out")),
    });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm,
      }),
    );
    await app.ready();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const chunk = JSON.parse(lines[0]) as {
        type: string;
        code: string;
        provider: string;
        error: string;
      };
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_unknown");
      // LitellmUpstreamError → provider:"litellm" per D2 lock.
      expect(chunk.provider).toBe("litellm");
      expect(typeof chunk.error).toBe("string");
      expect(chunk.error.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("Test 18b (260528-0cm) — LitellmUpstreamError(400, model_not_found body) → code:upstream_invalid_model, NO model name leaked", async () => {
    const litellm = fakeLitellm({
      chatCompletionsStream: () =>
        Promise.reject(
          new LitellmUpstreamError(400, "Invalid model name passed in model=openai/gpt-oss-120b"),
        ),
    });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
    });
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm,
      }),
    );
    await app.ready();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          model: "openai/gpt-oss-120b",
        },
      });
      expect(r.statusCode).toBe(200);
      const lines = r.body.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(1);
      const chunk = JSON.parse(lines[0]) as {
        type: string;
        code: string;
        provider: string;
        error: string;
      };
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_invalid_model");
      expect(chunk.provider).toBe("litellm");
      // Canonical message is provider-/model-name-agnostic.
      expect(chunk.error).not.toContain("openai/gpt-oss-120b");
    } finally {
      await app.close();
    }
  });
});
