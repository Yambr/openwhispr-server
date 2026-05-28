// SPDX-License-Identifier: FSL-1.1-ALv2
// 260528-0cm — Task 4 PART C — route-level wire-mapping + structured-log +
// secret-redaction + log-level-flip + mid-stream-parity assertions.
//
// Companion to `stream.test.ts` (Tests 9/10/17/18 rewritten in-place).
// This file focuses on the new wire-contract surface introduced by the
// quick-id 260528-0cm helper:
//   1. Wire envelope per AgentErrorCode — every code maps to a single
//      terminal `{type:"error", error, code, provider}` NDJSON line.
//   2. Structured log binding shape — every catch path emits exactly one
//      `req.log.error({event:"agent.stream.upstream_failure", ...})`.
//   3. Log-level flip — `req.log.warn` is NEVER called for these paths
//      (D4 lock).
//   4. Secret-shape redaction at the wire boundary — wire `error` field
//      carries no credential-shape substrings; log binding's
//      `upstream_body_truncated` carries the redactor's `[redacted]`
//      marker.
//   5. Mid-stream drain parity — content chunks preserved + ONE terminal
//      `type:"error"` chunk + NO `type:"done"` chunk.
//
// Strategy: Stub `chatCompletionsStream` (Strategy B per RESEARCH.md
// R8.2) directly on the LitellmClient overrides — no MockAgent needed
// here (the integration tier in `agent-stream-error-contract.test.ts`
// covers Strategy A with real undici).

import { Readable } from "node:stream";
import {
  buildLitellmClient,
  type LitellmClient,
  LitellmUpstreamError,
} from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../../src/error-handler.js";
import { AuthError } from "../../../../../src/errors.js";
import { zodTypeProvider } from "../../../../../src/plugins/zod-type-provider.js";
import { buildAgentStreamRoutes } from "../../../../../src/routes/agent/stream.js";

const LITELLM_BASE = "http://litellm.test:4000";

// Test-side mirror of the canonical messages (the helper's internal const
// is NOT exported per LOCKER-04). Strings MUST match
// `apps/api/src/lib/agent-upstream-error-classify.ts` exactly.
const EXPECTED_UPSTREAM_AUTH =
  "Upstream model provider rejected the request (authentication failure). Contact your operator.";
const EXPECTED_UPSTREAM_RATE_LIMIT = "Rate limit reached. Please retry in a few seconds.";
const EXPECTED_UPSTREAM_QUOTA_EXCEEDED = "Upstream provider quota exceeded. Contact your operator.";
const EXPECTED_UPSTREAM_INVALID_MODEL =
  "Requested model is not available on this server. Choose a different model or contact your operator.";
const EXPECTED_UPSTREAM_TIMEOUT = "Upstream provider did not respond in time. Please retry.";
const EXPECTED_UPSTREAM_UNKNOWN =
  "Upstream model provider is temporarily unavailable. Please try again.";

const SECRET_SHAPE_SK = /sk-[A-Za-z0-9_-]{16,}/;
const SECRET_SHAPE_BEARER_JWT = /Bearer\s+ey[A-Za-z0-9_-]+/;
const SECRET_SHAPE_AKIA = /AKIA[A-Z0-9]{16}/;
const SECRET_SHAPE_AIZA = /AIza[A-Za-z0-9_-]{35}/;

// 260528-fzu — content-chunk error prefix. The route now emits a
// { type:"content", text } line BEFORE the structured { type:"error" }
// line so the immutable desktop client (which only renders
// content/tool_calls/tool_result) shows the error text in the chat bubble.
// The prefix is the U+274C CROSS MARK glyph followed by a single space,
// mirroring the production literal exactly.
const ERROR_CONTENT_PREFIX = "❌ ";

interface ChunkOnWire {
  type: string;
  error?: string;
  code?: string;
  provider?: string;
  finishReason?: string;
  text?: string;
}

interface LogRecord {
  level: "error" | "warn" | "info" | "debug" | "trace" | "fatal";
  bindings: Record<string, unknown>;
  msg: string;
}

let agent: MockAgent;
const logRecords: LogRecord[] = [];

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

async function buildAppWithRejection(rejectionValue: unknown): Promise<FastifyInstance> {
  return buildAppWithStream(() => Promise.reject(rejectionValue));
}

async function buildAppWithStream(
  chatCompletionsStream: LitellmClient["chatCompletionsStream"],
): Promise<FastifyInstance> {
  const litellm = fakeLitellm({ chatCompletionsStream });
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
    // Install a per-request log spy. Captures `error` / `warn` calls into
    // the module-level `logRecords` array so test assertions can validate
    // binding shape + log-level flip without depending on pino transport.
    const captureLog =
      (level: LogRecord["level"]) =>
      (bindings: unknown, msg?: string): void => {
        logRecords.push({
          level,
          bindings: (bindings as Record<string, unknown>) ?? {},
          msg: msg ?? "",
        });
      };
    (req as unknown as { log: Record<string, unknown> }).log = {
      error: captureLog("error"),
      warn: captureLog("warn"),
      info: captureLog("info"),
      debug: captureLog("debug"),
      trace: captureLog("trace"),
      fatal: captureLog("fatal"),
    };
  });
  await app.register(
    buildAgentStreamRoutes({
      db: fakeDb() as never,
      litellm,
    }),
  );
  await app.ready();
  return app;
}

function parseChunks(body: string): ChunkOnWire[] {
  return body
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as ChunkOnWire);
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
  logRecords.length = 0;
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(new Agent());
  vi.restoreAllMocks();
});

describe("260528-0cm — agent stream wire envelope per AgentErrorCode", () => {
  const cases: Array<{
    name: string;
    rejection: () => unknown;
    expectedCode: string;
    expectedProvider: "litellm" | "unknown";
    expectedErrorContains?: string;
    expectedErrorEndsWith?: string;
    expectedErrorIs?: string;
    expectedUpstreamStatus: number | null;
  }> = [
    {
      name: "LitellmUpstreamError(401) → upstream_auth/litellm",
      rejection: () => new LitellmUpstreamError(401, "Invalid api key"),
      expectedCode: "upstream_auth",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_AUTH,
      expectedUpstreamStatus: 401,
    },
    {
      name: "LitellmUpstreamError(403) → upstream_auth/litellm",
      rejection: () => new LitellmUpstreamError(403, "Forbidden"),
      expectedCode: "upstream_auth",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_AUTH,
      expectedUpstreamStatus: 403,
    },
    {
      name: "LitellmUpstreamError(402) → upstream_quota_exceeded/litellm",
      rejection: () => new LitellmUpstreamError(402, "Payment required"),
      expectedCode: "upstream_quota_exceeded",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_QUOTA_EXCEEDED,
      expectedUpstreamStatus: 402,
    },
    {
      name: "LitellmUpstreamError(429, retryAfterMs:30000) → upstream_rate_limit with suffix",
      rejection: () => new LitellmUpstreamError(429, "rate limit", { retryAfterMs: 30_000 }),
      expectedCode: "upstream_rate_limit",
      expectedProvider: "litellm",
      expectedErrorEndsWith: "(retry in ~30s)",
      expectedUpstreamStatus: 429,
    },
    {
      name: "LitellmUpstreamError(429) bare → upstream_rate_limit base",
      rejection: () => new LitellmUpstreamError(429, "rate limit"),
      expectedCode: "upstream_rate_limit",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_RATE_LIMIT,
      expectedUpstreamStatus: 429,
    },
    {
      name: "LitellmUpstreamError(404, model not found) → upstream_invalid_model/litellm",
      rejection: () => new LitellmUpstreamError(404, "model not found"),
      expectedCode: "upstream_invalid_model",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_INVALID_MODEL,
      expectedUpstreamStatus: 404,
    },
    {
      name: "LitellmUpstreamError(400, invalid model name body) → upstream_invalid_model",
      rejection: () => new LitellmUpstreamError(400, "Invalid model name passed in model=foo"),
      expectedCode: "upstream_invalid_model",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_INVALID_MODEL,
      expectedUpstreamStatus: 400,
    },
    {
      name: "LitellmUpstreamError(400, model_not_found JSON) → upstream_invalid_model",
      rejection: () =>
        new LitellmUpstreamError(400, '{"error":{"code":"model_not_found","message":"missing"}}'),
      expectedCode: "upstream_invalid_model",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_INVALID_MODEL,
      expectedUpstreamStatus: 400,
    },
    {
      name: "LitellmUpstreamError(400, unrelated body) → upstream_unknown",
      rejection: () => new LitellmUpstreamError(400, "tool argument failed validation"),
      expectedCode: "upstream_unknown",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_UNKNOWN,
      expectedUpstreamStatus: 400,
    },
    {
      name: "LitellmUpstreamError(500) → upstream_unknown/litellm",
      rejection: () => new LitellmUpstreamError(500, "boom"),
      expectedCode: "upstream_unknown",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_UNKNOWN,
      expectedUpstreamStatus: 500,
    },
    {
      name: "LitellmUpstreamError(502) → upstream_unknown",
      rejection: () => new LitellmUpstreamError(502, "bad gateway"),
      expectedCode: "upstream_unknown",
      expectedProvider: "litellm",
      expectedErrorIs: EXPECTED_UPSTREAM_UNKNOWN,
      expectedUpstreamStatus: 502,
    },
    {
      name: "ECONNREFUSED → upstream_timeout/unknown",
      rejection: () => Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }),
      expectedCode: "upstream_timeout",
      expectedProvider: "unknown",
      expectedErrorIs: EXPECTED_UPSTREAM_TIMEOUT,
      expectedUpstreamStatus: null,
    },
    {
      name: "AbortError → upstream_timeout/unknown",
      rejection: () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        return e;
      },
      expectedCode: "upstream_timeout",
      expectedProvider: "unknown",
      expectedErrorIs: EXPECTED_UPSTREAM_TIMEOUT,
      expectedUpstreamStatus: null,
    },
    {
      name: "TypeError('fetch failed') → upstream_unknown/unknown",
      rejection: () => new TypeError("fetch failed"),
      expectedCode: "upstream_unknown",
      expectedProvider: "unknown",
      expectedErrorIs: EXPECTED_UPSTREAM_UNKNOWN,
      expectedUpstreamStatus: null,
    },
  ];

  for (const tc of cases) {
    it(tc.name, async () => {
      const app = await buildAppWithRejection(tc.rejection());
      try {
        const r = await app.inject({
          method: "POST",
          url: "/api/agent/stream",
          headers: {
            authorization: "Bearer ok-u1",
            "content-type": "application/json",
          },
          payload: {
            messages: [{ role: "user", content: "hi" }],
            model: "openwhispr-default",
          },
        });
        expect(r.statusCode).toBe(200);
        expect(r.headers["content-type"]).toBe("application/x-ndjson");
        const chunks = parseChunks(r.body);
        // 260528-fzu — content chunk emitted BEFORE the structured error
        // chunk: exactly 2 lines on the preflight failure path.
        expect(chunks).toHaveLength(2);
        // chunks[0] — the content chunk carrying the error text.
        const contentChunk = chunks[0]!;
        expect(contentChunk.type).toBe("content");
        expect(contentChunk.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
        // chunks[1] — the unchanged structured error chunk.
        const chunk = chunks[1]!;
        expect(chunk.type).toBe("error");
        expect(chunk.code).toBe(tc.expectedCode);
        expect(chunk.provider).toBe(tc.expectedProvider);
        if (tc.expectedErrorIs !== undefined) {
          expect(chunk.error).toBe(tc.expectedErrorIs);
        }
        if (tc.expectedErrorEndsWith !== undefined) {
          expect(chunk.error?.endsWith(tc.expectedErrorEndsWith)).toBe(true);
        }
        if (tc.expectedErrorContains !== undefined) {
          expect(chunk.error).toContain(tc.expectedErrorContains);
        }
        // 260528-fzu — content text equals PREFIX + the error chunk's error.
        expect(contentChunk.text).toBe(ERROR_CONTENT_PREFIX + chunk.error);
        // D1 — no done chunk follows the terminal error chunk.
        expect(r.body).not.toContain('"type":"done"');
        // Chunk shape is exactly the 4-key set per T-260528-0cm-03 —
        // assert against the ERROR chunk so the structured-error shape
        // stays locked at {code,error,provider,type}.
        expect(Object.keys(chunk).sort()).toEqual(["code", "error", "provider", "type"]);
      } finally {
        await app.close();
      }
    });
  }
});

describe("260528-0cm — structured log binding shape", () => {
  it("LitellmUpstreamError(429, retryAfterMs:30000) emits req.log.error with retry_after_ms binding", async () => {
    const app = await buildAppWithRejection(
      new LitellmUpstreamError(429, "rate limit", { retryAfterMs: 30_000 }),
    );
    try {
      await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {
          messages: [{ role: "user", content: "hi" }],
          model: "openwhispr-default",
        },
      });
      const errorLogs = logRecords.filter((r) => r.level === "error");
      expect(errorLogs).toHaveLength(1);
      const log = errorLogs[0]!;
      expect(log.bindings.event).toBe("agent.stream.upstream_failure");
      expect(log.bindings.upstream_status).toBe(429);
      expect(log.bindings.code).toBe("upstream_rate_limit");
      expect(log.bindings.provider).toBe("litellm");
      expect(log.bindings.kind).toBe("rate_limit");
      expect(log.bindings.model).toBe("openwhispr-default");
      expect(typeof log.bindings.request_id).toBe("string");
      expect(log.bindings.retry_after_ms).toBe(30_000);
      expect(log.msg).toBe("agent stream upstream call failed");
    } finally {
      await app.close();
    }
  });

  it("plain Error → req.log.error with upstream_status:null, provider:unknown, kind:null", async () => {
    const app = await buildAppWithRejection(new Error("network broke"));
    try {
      await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const errorLogs = logRecords.filter((r) => r.level === "error");
      expect(errorLogs).toHaveLength(1);
      const log = errorLogs[0]!;
      expect(log.bindings.event).toBe("agent.stream.upstream_failure");
      expect(log.bindings.upstream_status).toBeNull();
      expect(log.bindings.provider).toBe("unknown");
      expect(log.bindings.kind).toBeNull();
      expect(log.bindings.retry_after_ms).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("log binding's `upstream_body_truncated` is ≤500 chars even with a 2000-char body", async () => {
    const longBody = "X".repeat(2000);
    const app = await buildAppWithRejection(new LitellmUpstreamError(500, longBody));
    try {
      await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const errorLogs = logRecords.filter((r) => r.level === "error");
      expect(errorLogs).toHaveLength(1);
      const truncated = errorLogs[0]!.bindings.upstream_body_truncated;
      expect(typeof truncated).toBe("string");
      expect((truncated as string).length).toBeLessThanOrEqual(500);
    } finally {
      await app.close();
    }
  });
});

describe("260528-0cm — log level flip", () => {
  it("upstream failure → req.log.error called once; req.log.warn NEVER called for agent.stream paths", async () => {
    const app = await buildAppWithRejection(new LitellmUpstreamError(503, "unavailable"));
    try {
      await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const errorLogs = logRecords.filter(
        (r) => r.level === "error" && r.bindings.event === "agent.stream.upstream_failure",
      );
      const warnLogs = logRecords.filter(
        (r) =>
          r.level === "warn" &&
          (r.msg.startsWith("agent.stream upstream") || r.msg.startsWith("agent.stream drain")),
      );
      expect(errorLogs).toHaveLength(1);
      expect(warnLogs).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe("260528-0cm — secret-shape redaction at the wire boundary", () => {
  it("LitellmUpstreamError carrying multiple credential shapes → wire `error` is canonical; log carries redacted markers", async () => {
    const adversarialBody =
      "Invalid api key sk-or-v1-abcdef1234567890abcdef1234567890 " +
      "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.deadbeef";
    const app = await buildAppWithRejection(new LitellmUpstreamError(401, adversarialBody));
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      const chunks = parseChunks(r.body);
      // 260528-fzu — the structured error chunk is now the LAST line; the
      // content chunk (chunks[0]) precedes it.
      const contentChunk = chunks[0]!;
      const chunk = chunks[chunks.length - 1]!;
      // (a/b) wire `error` carries no secret-shape substring.
      expect(chunk.error).not.toMatch(SECRET_SHAPE_SK);
      expect(chunk.error).not.toMatch(SECRET_SHAPE_BEARER_JWT);
      expect(chunk.error).not.toMatch(SECRET_SHAPE_AKIA);
      expect(chunk.error).not.toMatch(SECRET_SHAPE_AIZA);
      // 260528-fzu — the content chunk carries the same canonical redacted
      // message, so it must pass the same secret-shape nots.
      expect(contentChunk.type).toBe("content");
      expect(contentChunk.text).not.toMatch(SECRET_SHAPE_SK);
      expect(contentChunk.text).not.toMatch(SECRET_SHAPE_BEARER_JWT);
      expect(contentChunk.text).not.toMatch(SECRET_SHAPE_AKIA);
      expect(contentChunk.text).not.toMatch(SECRET_SHAPE_AIZA);
      // (c) wire chunk shape is exactly the 4-key set — no
      // `upstream_body_truncated` key leaks onto the wire.
      expect(Object.keys(chunk)).not.toContain("upstream_body_truncated");
      expect(Object.keys(chunk)).not.toContain("upstream_status");
      expect(Object.keys(chunk)).not.toContain("kind");
      expect(Object.keys(chunk)).not.toContain("litellm_call_id");
      // (d) structured log's `upstream_body_truncated` carries the redactor marker.
      const errorLogs = logRecords.filter((r2) => r2.level === "error");
      expect(errorLogs).toHaveLength(1);
      const upstreamBody = errorLogs[0]!.bindings.upstream_body_truncated;
      expect(typeof upstreamBody).toBe("string");
      expect(upstreamBody).toContain("[redacted]");
    } finally {
      await app.close();
    }
  });
});

describe("260528-0cm — mid-stream drain parity", () => {
  it("2 content frames then mid-drain throw → content preserved + terminal type:error + NO done chunk", async () => {
    // Build a Readable that emits 2 valid SSE frames then errors on the
    // third pull. The route's drain catch path will surface this as the
    // terminal error chunk.
    const stream = chatCompletionsStreamWithMidDrainError();
    const app = await buildAppWithStream(stream);
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/agent/stream",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { messages: [{ role: "user", content: "hi" }] },
      });
      expect(r.statusCode).toBe(200);
      const chunks = parseChunks(r.body);
      // First N real streamed content chunks preserved, plus the new
      // trailing error-prefixed content chunk (260528-fzu).
      const contentChunks = chunks.filter((c) => c.type === "content");
      expect(contentChunks.length).toBeGreaterThanOrEqual(1);
      // Terminal chunk is type:"error", NOT type:"done".
      const last = chunks[chunks.length - 1];
      expect(last?.type).toBe("error");
      expect(last?.code).toBe("upstream_unknown");
      // Drain-side raw Error → provider:"unknown" per D2.
      expect(last?.provider).toBe("unknown");
      // 260528-fzu — the LAST content chunk (immediately before the
      // terminal error chunk on the drain path) is the error-prefixed
      // text and equals PREFIX + the error chunk's error.
      const lastContent = contentChunks[contentChunks.length - 1]!;
      expect(lastContent.text?.startsWith(ERROR_CONTENT_PREFIX)).toBe(true);
      expect(lastContent.text).toBe(ERROR_CONTENT_PREFIX + last?.error);
      // D1 — no done chunk anywhere.
      const doneChunks = chunks.filter((c) => c.type === "done");
      expect(doneChunks).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

/**
 * Helper: returns a `chatCompletionsStream` impl that resolves to a
 * Dispatcher.ResponseData-like object whose `body` is a Node Readable
 * yielding 2 valid SSE frames then throwing on the next read.
 */
function chatCompletionsStreamWithMidDrainError(): LitellmClient["chatCompletionsStream"] {
  // Dispatcher.ResponseData has a complex undici shape; the route only
  // reads `.headers` + `.body`. Test path is excluded from LOCKER-02 —
  // `as any` is legitimate for negative typing here.
  return (() =>
    Promise.resolve({
      statusCode: 200,
      headers: { "content-type": "text/event-stream" },
      body: buildMidDrainErrorReadable(),
      trailers: {},
      opaque: undefined,
      context: {},
    } as any)) as LitellmClient["chatCompletionsStream"];
}

function buildMidDrainErrorReadable(): Readable {
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
      // Third pull throws — surfaces as a drain-loop error in the route.
      this.destroy(new Error("simulated mid-drain socket break"));
    },
  });
}
