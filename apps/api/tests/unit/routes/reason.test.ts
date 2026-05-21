// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 05 / Task 1 — POST /api/reason plugin tests.
//
// Strategy mirrors transcribe.test.ts: hand-rolled fake LitellmClient +
// fake TransactionalDb that records executed SQL fragments; dualAuthHook
// stubbed to populate req.user / req.tenant directly. Full hook
// semantics covered by dual-auth.test.ts.
//
// Coverage matrix:
//   * happy path with default model (qwen3.6-plus) -> 200 ReasonResponse
//   * happy path with explicit model (gpt-4o-mini) -> 200 with that model
//   * empty text body -> 400 envelope (zod min(1) rejection)
//   * extra body field -> 400 envelope (.strict() rejection)
//   * no auth -> 401 envelope
//   * MissingProviderKeyError -> 503 envelope (Pitfall #8 — NOT 401)
//   * LitellmUpstreamError    -> 502 envelope (no master-key leakage)
//   * client.chatCompletions called with userId === req.user.id (D-03)
//   * client.chatCompletions called with requestId === req.id
//   * usage_ledger INSERT with kind='reason_tokens', units=15 (mock total_tokens)
//   * idempotent re-post (same request_id) — both 200, ON CONFLICT clause present
//   * custom promptMode + matchType echoed verbatim

import { ErrorEnvelope, ReasonResponse } from "@openwhispr/contract-tests/schemas";
import {
  type ChatCompletionRequest,
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildReasonRoutes } from "../../../src/routes/reason.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function makeFakeDb(): {
  db: Parameters<typeof buildReasonRoutes>[0]["db"];
  recorded: RecordedQuery[];
} {
  const recorded: RecordedQuery[] = [];
  const tx = {
    async execute(query: unknown): Promise<unknown> {
      const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
      const parts: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (typeof c === "string") {
          parts.push(c);
        } else if (c && typeof c === "object" && "value" in c) {
          const v = (c as { value: unknown }).value;
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
            parts.push((v as string[]).join(""));
          } else {
            parts.push("?");
            params.push(v);
          }
        } else {
          parts.push(String(c));
        }
      }
      recorded.push({ sql: parts.join(""), params });
      return { rows: [] };
    },
  };
  const db = {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
  return { db, recorded };
}

interface FakeLitellmOpts {
  /** Records every chatCompletions call. */
  calls: ChatCompletionRequest[];
  /** When set, chatCompletions throws this error instead of returning. */
  throws?: Error;
  /**
   * Override the upstream JSON response. Default: a representative
   * mock_response payload mirroring compose/litellm/litellm_config.contract.yaml.
   */
  upstreamJson?: {
    model?: string;
    choices?: Array<{ message?: { role?: string; content?: string } }>;
    usage?: { total_tokens?: number };
  };
}

function makeFakeLitellm(opts: FakeLitellmOpts): LitellmClient {
  return {
    baseUrl: "http://litellm.test:4000",
    audioTranscriptions: () => {
      throw new Error("audioTranscriptions not used in this test");
    },
    passthrough: () => {
      throw new Error("passthrough not used in this test");
    },
    async chatCompletions(req) {
      opts.calls.push(req);
      if (opts.throws) throw opts.throws;
      const json = opts.upstreamJson ?? {
        model: req.model ?? "qwen3.6-plus",
        choices: [{ message: { role: "assistant", content: "mocked reasoning" } }],
        usage: { total_tokens: 15 },
      };
      return {
        statusCode: 200,
        body: {
          async json() {
            return json;
          },
        },
      } as unknown as Awaited<ReturnType<LitellmClient["chatCompletions"]>>;
    },
  };
}

function buildApp(
  deps: Parameters<typeof buildReasonRoutes>[0],
  opts?: { authed?: boolean },
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(zodTypeProvider);
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(buildReasonRoutes(deps));
  return app;
}

describe("POST /api/reason", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns canonical ReasonResponse with default model qwen3.6-plus (D-06)", async () => {
    const { db, recorded } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello" }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.text).toBe("mocked reasoning");
    expect(parsed.model).toBe("qwen3.6-plus");
    expect(parsed.provider).toBe("openrouter");
    expect(parsed.promptMode).toBe("default");
    expect(parsed.matchType).toBe("default");

    // D-06: client.chatCompletions called with default model.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("qwen3.6-plus");
    // D-03: userId pulled from req.user.id, NOT body.
    expect(calls[0]?.userId).toBe(TEST_USER);
    expect(typeof calls[0]?.requestId).toBe("string");
    expect(calls[0]?.messages).toEqual([{ role: "user", content: "hello" }]);

    // Ledger row written with kind='reason_tokens', units=15 (mock total_tokens).
    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert).toBeDefined();
    expect(insert?.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    const wholeRecording = insert?.sql + JSON.stringify(insert?.params);
    expect(wholeRecording).toContain("reason_tokens");
    expect(wholeRecording).toContain(TEST_TENANT);
    expect(wholeRecording).toContain(TEST_USER);
    expect(insert?.sql).toMatch(/15\s*\)\s*ON CONFLICT/);
  });

  it("respects explicit model gpt-4o-mini and echoes provider=openrouter", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "gpt-4o-mini",
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { total_tokens: 2 },
      },
    });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hi", model: "gpt-4o-mini" }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.model).toBe("gpt-4o-mini");
    expect(parsed.provider).toBe("openrouter");
    expect(calls[0]?.model).toBe("gpt-4o-mini");
  });

  it("rejects empty text with 400 envelope (zod min(1))", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "" }),
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("accepts the FULL documented BACKEND_SPEC request body (R23 — all ~21 fields → 200)", async () => {
    // R23: the immutable desktop client POSTs the full documented body
    // (docs/wire-contracts-phase-3.md §/api/reason). Pre-R23 the schema
    // was `.strict()` with only text/model/provider/promptMode/matchType,
    // so every documented field beyond text/model tripped a 400.
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        text: "raw transcript",
        model: "qwen3.6-plus",
        agentName: "Claude",
        customDictionary: ["Yambr", "Gizmo"],
        customPrompt: "Optional user-provided cleanup prompt",
        systemPrompt: "Optional system override",
        language: "en",
        locale: "en-US",
        sessionId: "11111111-2222-3333-4444-555555555555",
        clientType: "desktop",
        appVersion: "1.2.3",
        clientVersion: "1.2.3",
        sttProvider: "openai",
        sttModel: "whisper-1",
        sttProcessingMs: 412,
        sttWordCount: 27,
        sttLanguage: "en",
        audioDurationMs: 6500,
        audioSizeBytes: 90123,
        audioFormat: "webm",
        clientTotalMs: 1200,
      }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.text).toBe("mocked reasoning");
    expect(parsed.model).toBe("qwen3.6-plus");
    // Handler still forwards only `text` to LiteLLM as the user message.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.messages).toEqual([{ role: "user", content: "raw transcript" }]);
  });

  it("accepts an UNDOCUMENTED extra body field (.passthrough() — R23 forward-compat)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hi", futureClientField: "bar" }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.text).toBe("mocked reasoning");
    expect(calls).toHaveLength(1);
  });

  it("tolerates a body-level `user` field — handler still attributes via req.user.id (D-03)", async () => {
    // R23: ReasonRequest is now `.passthrough()`, so a body-level `user`
    // no longer 400s. Attribution safety is unchanged: the route NEVER
    // reads `user` from req.body — the shared LiteLLM client overrides it
    // with req.user.id at the call site (D-03 belt-and-suspenders).
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hi", user: "victim-user-id" }),
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userId).toBe(TEST_USER);
  });

  it("returns 401 envelope when no auth (req.user absent)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm }, { authed: false });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello" }),
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("returns 503 envelope when OPENROUTER_API_KEY is missing (Pitfall #8 — NOT 401)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new MissingProviderKeyError("OPENROUTER_API_KEY", "qwen3.6-plus"),
    });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello" }),
    });
    expect(res.statusCode).toBe(503);
    const env = ErrorEnvelope.parse(res.json());
    // HI-03 (Phase 62): the error envelope emits the class-default literal
    // — the missing-key detail is NOT echoed to the wire (it stays in the
    // server-side `req.log.warn({ err })` for operator triage).
    expect(env.error).toBe("Service temporarily unavailable");
    expect(res.body).not.toContain("OPENROUTER_API_KEY");
  });

  it("returns 502 envelope on upstream LiteLLM failure (no master-key leakage)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new LitellmUpstreamError(500, "Bearer sk-litellm-master-DO-NOT-LEAK upstream blob"),
    });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello" }),
    });
    expect(res.statusCode).toBe(502);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toBe("upstream reasoning provider failure");
    expect(JSON.stringify(env)).not.toMatch(/sk-litellm-master/);
  });

  it("idempotent re-post (same shape) — both 200, ON CONFLICT clause present", async () => {
    const { db, recorded } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const payload = JSON.stringify({ text: "hello" });
    const res1 = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload,
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const inserts = recorded.filter((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(inserts).toHaveLength(2);
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    }
  });

  it("response promptMode/matchType are the constant 'default' (R23 — request-shape removed)", async () => {
    // R23: promptMode / matchType were RESPONSE-shape fields wrongly
    // modeled on the REQUEST schema. The immutable client never sends
    // them. They are removed from ReasonRequest; the handler's response
    // echo is now the literal "default" (no client-sourced value).
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "x" }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.promptMode).toBe("default");
    expect(parsed.matchType).toBe("default");
  });

  it("tolerates a stray promptMode in the body (.passthrough() — R23, no longer 400)", async () => {
    // R23: a body-level `promptMode` is now an undocumented passthrough
    // key — accepted but ignored; the response echo stays "default".
    const { db } = makeFakeDb();
    const litellm = makeFakeLitellm({ calls: [] });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        text: "x",
        promptMode: "anything-the-client-sends",
      }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.promptMode).toBe("default");
  });

  it("falls back to provider='litellm' when model alias is unknown to bundled table", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "corp-internal-model",
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { total_tokens: 3 },
      },
    });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hi", model: "corp-internal-model" }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.model).toBe("corp-internal-model");
    expect(parsed.provider).toBe("litellm");
  });

  it("re-throws unknown errors (caught by setErrorHandler -> 500 envelope)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      throws: new Error("totally unexpected"),
    });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello" }),
    });
    expect(res.statusCode).toBe(500);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).not.toMatch(/totally unexpected/);
  });

  it("derives wordsRemaining-equivalent from upstream usage; missing usage -> units=0", async () => {
    const { db, recorded } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "qwen3.6-plus",
        choices: [{ message: { role: "assistant", content: "no usage stats" } }],
        // usage omitted entirely
      },
    });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hi" }),
    });
    expect(res.statusCode).toBe(200);
    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert).toBeDefined();
    // units=0 inlined into SQL by drizzle's StringChunk path under our recorder.
    expect(insert?.sql).toMatch(/0\s*\)\s*ON CONFLICT/);
  });
});
