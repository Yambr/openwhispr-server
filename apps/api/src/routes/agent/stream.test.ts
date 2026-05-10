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
//  5. model default chain: body → env → 'qwen/qwen3.6-plus'
//  6. stream:true + stream_options:{include_usage:true} + user forwarded
//  7. x-litellm-call-id captured server-side only — NEVER in wire response
//  8. Client disconnect aborts upstream (signal.aborted within 100ms)
//  9. Upstream non-2xx → ONE finish chunk with finishReason:'upstream_error'
// 10. Mid-stream error → finish chunk with finishReason:'stream_error'
// 11. Unauthenticated → 401 BEFORE the handler hijacks the reply
// 12. X-Accel-Buffering: no on response (forward-compat for nginx)

import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";
import { registerErrorHandler } from "../../error-handler.js";
import { AuthError } from "../../errors.js";
import { buildAgentStreamRoutes } from "./stream.js";

const LITELLM_BASE = "http://litellm.test:4000";
const LITELLM_PATH = "/v1/chat/completions";

let agent: MockAgent;

function fakeLitellm(): LitellmClient {
  return {
    baseUrl: LITELLM_BASE,
    masterKey: "sk-master-test",
    chatCompletions: () => Promise.reject(new Error("not used")),
    audioTranscriptions: () => Promise.reject(new Error("not used")),
    passthrough: () => Promise.reject(new Error("not used")),
  } as unknown as LitellmClient;
}

function fakeDb(): { transaction<T>(cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>): Promise<T> } {
  return {
    async transaction(cb) {
      return cb({ async execute() { return { rows: [] }; } });
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
  app.addHook("onRequest", async (req) => {
    const auth = req.headers["authorization"];
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
            tool_calls: [
              { index: 0, function: { arguments: '"foo"}' } },
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
      expect(first.type).toBe("text-delta");
      // Sanity: the entire round-trip stays under a generous unit budget.
      // (e2e budget < 500ms is asserted in plan 09 against the live stack.)
      expect(elapsed).toBeLessThan(2000);
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
      const toolCalls = chunks.filter((c) => c.type === "tool-call");
      expect(toolCalls.length).toBe(2);
      expect(toolCalls[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "tc_a",
        toolName: "lookup",
        args: { q: "foo" },
      });
      expect(toolCalls[1]).toMatchObject({
        type: "tool-call",
        toolCallId: "tc_b",
        toolName: "search",
        args: { x: 1 },
      });
      const finish = chunks.at(-1) as { type: string; finishReason: string; usage: { promptTokens: number; completionTokens: number } };
      expect(finish.type).toBe("finish");
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

  it("Test 5 — model default chain: body → env → 'qwen/qwen3.6-plus'", async () => {
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
    expect((captures[1] as { model: string }).model).toBe("qwen/qwen3.6-plus");
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
    const logged: Array<unknown> = [];
    app.addHook("onRequest", async (req) => {
      const auth = req.headers["authorization"];
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
    let capturedReq: import("fastify").FastifyRequest | null = null;
    app.addHook("onRequest", async (req) => {
      const auth = req.headers["authorization"];
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
      } catch { /* expected post-abort */ }
    } finally {
      globalThis.AbortController = OriginalAC;
      await app.close();
    }
  });

  it("Test 9 — upstream non-2xx → ONE finish chunk with finishReason 'upstream_error' (status 200 already sent)", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(503, "boom");

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
      const finish = JSON.parse(lines[0]) as { type: string; finishReason: string };
      expect(finish.type).toBe("finish");
      expect(finish.finishReason).toBe("upstream_error");
    } finally {
      await app.close();
    }
  });

  it("Test 10 — mid-stream drain error (raw.write throws after N writes) emits finish chunk with finishReason 'stream_error'", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    // Custom app that wraps reply.raw.write to throw after the first chunk.
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    const writes: string[] = [];
    app.addHook("onRequest", async (req) => {
      const auth = req.headers["authorization"];
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
      // route's try/catch must surface this as a stream_error finish chunk
      // (which itself goes through a separate try/catch for socket-already-
      // closed safety).
      const raw = reply.raw;
      const origWrite = raw.write.bind(raw);
      let n = 0;
      let inFinish = false;
      raw.write = ((chunk: unknown, ...rest: unknown[]) => {
        const text = String(chunk);
        // Allow the synthetic finish(stream_error) chunk through so the
        // wire response actually contains it.
        if (text.includes("stream_error")) inFinish = true;
        if (n >= 1 && !inFinish) {
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
      const last = JSON.parse(lines.at(-1) as string) as { type: string; finishReason: string };
      expect(last.type).toBe("finish");
      expect(last.finishReason).toBe("stream_error");
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

  it("Test 14 (branch coverage) — handler tolerates missing body (req.body undefined → empty object) AND missing messages", async () => {
    let captured: Record<string, unknown> | null = null;
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, (opts) => {
        const raw = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
        captured = JSON.parse(raw) as Record<string, unknown>;
        return buildTextOnlySse();
      });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers["authorization"];
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
    });
    // Wipe req.body BEFORE the handler so the `req.body ?? {}` branch fires.
    app.addHook("preHandler", async (req) => {
      (req as unknown as { body?: unknown }).body = undefined;
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
        payload: {},
      });
      expect(r.statusCode).toBe(200);
      expect(captured).not.toBeNull();
      expect((captured as { messages: unknown[] }).messages).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("Test 15 (branch coverage) — masterKey absent on litellm dep does not throw; route still completes", async () => {
    // We only need to exercise the `?? ""` branch — no need to capture the
    // actual header (intercept matchers see headers in different shapes
    // depending on undici internals).
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(200, buildTextOnlySse(), {
        headers: { "content-type": "text/event-stream" },
      });

    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers["authorization"];
      const value = Array.isArray(auth) ? auth[0] : auth;
      if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: "u1",
        email: "u1@test.local",
      };
    });
    // Provide a litellm without masterKey — exercises the `?? ""` fallback.
    const litellmNoKey = {
      baseUrl: LITELLM_BASE,
      chatCompletions: () => Promise.reject(new Error("not used")),
      audioTranscriptions: () => Promise.reject(new Error("not used")),
      passthrough: () => Promise.reject(new Error("not used")),
    } as unknown as LitellmClient;
    await app.register(
      buildAgentStreamRoutes({
        db: fakeDb() as never,
        litellm: litellmNoKey,
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
});
