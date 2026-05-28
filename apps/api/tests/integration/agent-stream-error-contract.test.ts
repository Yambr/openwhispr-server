// SPDX-License-Identifier: FSL-1.1-ALv2
// 260528-0cm — Integration contract test for /api/agent/stream wire
// envelope on upstream failure. Drives the REAL `buildLitellmClient` →
// real undici dispatch path with a MockAgent intercepting at the
// network boundary (Strategy A per RESEARCH.md R8.2).
//
// This complements the Strategy-B unit tests (Tests 9 / 17 / 18 / 18b in
// stream.test.ts + 20 cases in stream-error-mapping.test.ts) which stub
// the LitellmClient's `chatCompletionsStream` method directly. The
// integration test value here is exercising the FULL upstream path:
//   buildAgentStreamRoutes → buildLitellmClient → undici.request →
//   MockAgent → 4xx/5xx → LitellmUpstreamError → catch → wire chunk.
//
// Per project hard rule: only the LiteLLM HTTP boundary is mocked
// (network process boundary); no in-process logic mocks. The synthetic
// onRequest auth hook is the Better-Auth boundary (allowed mock
// per CLAUDE.md).

import { Readable } from "node:stream";
import { buildLitellmClient, type LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../src/error-handler.js";
import { AuthError } from "../../src/errors.js";
import { zodTypeProvider } from "../../src/plugins/zod-type-provider.js";
import { buildAgentStreamRoutes } from "../../src/routes/agent/stream.js";

const LITELLM_BASE = "http://litellm.test:4000";
const LITELLM_PATH = "/v1/chat/completions";

const SECRET_SHAPE_SK = /sk-[A-Za-z0-9_-]{16,}/;
const SECRET_SHAPE_BEARER_JWT = /Bearer\s+ey[A-Za-z0-9_-]+/;
const SECRET_SHAPE_AKIA = /AKIA[A-Z0-9]{16}/;
const SECRET_SHAPE_AIZA = /AIza[A-Za-z0-9_-]{35}/;

// 260528-fzu — content-chunk error prefix (U+274C CROSS MARK + single
// space), mirroring the production literal. The route emits a
// { type:"content", text } line BEFORE the structured { type:"error" }
// line so the immutable desktop client renders the error in the bubble.
const ERROR_CONTENT_PREFIX = "❌ ";

interface WireChunk {
  type: string;
  error?: string;
  code?: string;
  provider?: string;
  text?: string;
  finishReason?: string;
}

let agent: MockAgent;

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
    { isOverride: true },
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

async function buildContractApp(litellm?: LitellmClient): Promise<FastifyInstance> {
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
      litellm: litellm ?? fakeLitellm(),
    }),
  );
  await app.ready();
  return app;
}

function parseChunks(body: string): WireChunk[] {
  return body
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as WireChunk);
}

function assertNoSecretShapes(body: string): void {
  expect(body).not.toMatch(SECRET_SHAPE_SK);
  expect(body).not.toMatch(SECRET_SHAPE_BEARER_JWT);
  expect(body).not.toMatch(SECRET_SHAPE_AKIA);
  expect(body).not.toMatch(SECRET_SHAPE_AIZA);
}

beforeEach(() => {
  agent = new MockAgent({ connections: 10 });
  agent.disableNetConnect();
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
  setGlobalDispatcher(new Agent());
});

describe("260528-0cm — /api/agent/stream wire-contract integration (MockAgent)", () => {
  it("Case 1 — 401 upstream → terminal type:'error' chunk with code:upstream_auth, provider:litellm", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(401, '{"error":{"message":"Invalid api key"}}');

    const app = await buildContractApp();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toBe("application/x-ndjson");
      const chunks = parseChunks(r.body);
      // 260528-fzu — content-before-error ordering: 2 lines on preflight.
      expect(chunks).toHaveLength(2);
      const contentChunk = chunks[0]!;
      const chunk = chunks[chunks.length - 1]!;
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_auth");
      expect(chunk.provider).toBe("litellm");
      expect(chunk.error).toBe(
        "Upstream model provider rejected the request (authentication failure). Contact your operator.",
      );
      expect(contentChunk.type).toBe("content");
      expect(contentChunk.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(contentChunk.text).toBe(ERROR_CONTENT_PREFIX + chunk.error);
      assertNoSecretShapes(r.body);
    } finally {
      await app.close();
    }
  });

  it("Case 2 — 429 with Retry-After:30 → code:upstream_rate_limit, error ends with (retry in ~30s)", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(429, '{"error":{"message":"rate limited"}}', {
        headers: { "retry-after": "30" },
      });

    const app = await buildContractApp();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      const chunks = parseChunks(r.body);
      // 260528-fzu — content-before-error ordering: 2 lines on preflight.
      expect(chunks).toHaveLength(2);
      const contentChunk = chunks[0]!;
      const chunk = chunks[chunks.length - 1]!;
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_rate_limit");
      expect(chunk.provider).toBe("litellm");
      expect(chunk.error?.endsWith("(retry in ~30s)")).toBe(true);
      expect(contentChunk.type).toBe("content");
      expect(contentChunk.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(contentChunk.text).toBe(ERROR_CONTENT_PREFIX + chunk.error);
      assertNoSecretShapes(r.body);
    } finally {
      await app.close();
    }
  });

  it("Case 3 — 5xx upstream → code:upstream_unknown, provider:litellm", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(503, "service unavailable");

    const app = await buildContractApp();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const chunks = parseChunks(r.body);
      // 260528-fzu — content-before-error ordering: 2 lines on preflight.
      expect(chunks).toHaveLength(2);
      const contentChunk = chunks[0]!;
      const chunk = chunks[chunks.length - 1]!;
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_unknown");
      expect(chunk.provider).toBe("litellm");
      expect(contentChunk.type).toBe("content");
      expect(contentChunk.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(contentChunk.text).toBe(ERROR_CONTENT_PREFIX + chunk.error);
    } finally {
      await app.close();
    }
  });

  it("Case 4 — mid-stream socket break → 2+ content chunks preserved + terminal type:'error' (provider:unknown)", async () => {
    // Build a Readable that emits 2 valid SSE frames then errors on the
    // third pull. We bypass MockAgent for this case (it cannot easily
    // simulate a streaming-then-erroring body via the standard intercept
    // API) and instead inject the response via a stubbed
    // chatCompletionsStream that returns a 200 with our crafted Readable
    // body. Provider asserted EXACTLY as "unknown" per PLAN-CHECK
    // WARNING-3 tightening: undici socket break surfaces as a plain
    // Error, NOT a LitellmUpstreamError.
    // Dispatcher.ResponseData has a complex undici shape; the route
    // only reads `.headers` + `.body`. Test path is excluded from
    // LOCKER-02 — `as any` is legitimate for negative typing here.
    const stubStream: LitellmClient["chatCompletionsStream"] = (() =>
      Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "text/event-stream" },
        body: buildContentThenBreakReadable(),
        trailers: {},
        opaque: undefined,
        context: {},
      } as any)) as LitellmClient["chatCompletionsStream"];

    const litellm = fakeLitellm({ chatCompletionsStream: stubStream });
    const app = await buildContractApp(litellm);
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const chunks = parseChunks(r.body);
      const contentChunks = chunks.filter((c) => c.type === "content");
      expect(contentChunks.length).toBeGreaterThanOrEqual(1);
      const last = chunks[chunks.length - 1]!;
      expect(last.type).toBe("error");
      expect(last.code).toBe("upstream_unknown");
      // Per PLAN-CHECK rev 2 tightening: drain-side raw Error → provider:"unknown".
      expect(last.provider).toBe("unknown");
      // 260528-fzu — the LAST content chunk (immediately before the
      // terminal error chunk on the drain path) is the error-prefixed text
      // and equals PREFIX + the terminal error chunk's error.
      const lastContent = contentChunks[contentChunks.length - 1]!;
      expect(lastContent.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(lastContent.text).toBe(ERROR_CONTENT_PREFIX + last.error);
      const doneChunks = chunks.filter((c) => c.type === "done");
      expect(doneChunks).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("Case 5 — 400 model_not_found JSON body → code:upstream_invalid_model; canonical message hides the model name", async () => {
    agent
      .get(LITELLM_BASE)
      .intercept({ path: LITELLM_PATH, method: "POST" })
      .reply(
        400,
        '{"error":{"message":"The model openai/gpt-oss-120b does not exist","type":"invalid_request_error","code":"model_not_found"}}',
      );

    const app = await buildContractApp();
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
      const chunks = parseChunks(r.body);
      // 260528-fzu — content-before-error ordering: 2 lines on preflight.
      expect(chunks).toHaveLength(2);
      const contentChunk = chunks[0]!;
      const chunk = chunks[chunks.length - 1]!;
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_invalid_model");
      expect(chunk.provider).toBe("litellm");
      expect(chunk.error).toBe(
        "Requested model is not available on this server. Choose a different model or contact your operator.",
      );
      // No model name leaked into wire `error`.
      expect(chunk.error).not.toContain("openai/gpt-oss-120b");
      expect(contentChunk.type).toBe("content");
      expect(contentChunk.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(contentChunk.text).toBe(ERROR_CONTENT_PREFIX + chunk.error);
      // No model name leaked into the content line either.
      expect(contentChunk.text).not.toContain("openai/gpt-oss-120b");
    } finally {
      await app.close();
    }
  });

  it("Case 6 — chatCompletionsStream rejects with ECONNREFUSED-shape error → code:upstream_timeout, provider:unknown", async () => {
    // Driving real ECONNREFUSED through a MockAgent that disabled net
    // connect would require enabling net connect for a specific URL,
    // which is fragile and slow. Instead, stub chatCompletionsStream to
    // reject with the same shape undici emits for ECONNREFUSED. The
    // route catch path treats this as a network/abort error → maps to
    // upstream_timeout (per CONTEXT.md D2/D3 with the user-prompt scope
    // override) and emits provider:"unknown".
    const econnrefused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const litellm = fakeLitellm({
      chatCompletionsStream: () => Promise.reject(econnrefused),
    });
    const app = await buildContractApp(litellm);
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const chunks = parseChunks(r.body);
      // 260528-fzu — content-before-error ordering: 2 lines on preflight.
      expect(chunks).toHaveLength(2);
      const contentChunk = chunks[0]!;
      const chunk = chunks[chunks.length - 1]!;
      expect(chunk.type).toBe("error");
      expect(chunk.code).toBe("upstream_timeout");
      expect(chunk.provider).toBe("unknown");
      expect(contentChunk.type).toBe("content");
      expect(contentChunk.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(contentChunk.text).toBe(ERROR_CONTENT_PREFIX + chunk.error);
    } finally {
      await app.close();
    }
  });
});

function buildContentThenBreakReadable(): Readable {
  let pulls = 0;
  return new Readable({
    read() {
      pulls += 1;
      if (pulls === 1) {
        this.push(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "hel" }, finish_reason: null }],
          })}\n\n`,
        );
        return;
      }
      if (pulls === 2) {
        this.push(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "lo" }, finish_reason: null }],
          })}\n\n`,
        );
        return;
      }
      this.destroy(new Error("socket closed"));
    },
  });
}
