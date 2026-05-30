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

    // D-06: client.chatCompletions called with default model. R33 — this
    // bare `{text}` body is the CLEANUP shape; with no `cleanupModel` dep
    // injected the cleanup branch falls back to DEFAULT_CHAT_MODEL.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("qwen3.6-plus");
    // D-03: userId pulled from req.user.id, NOT body.
    expect(calls[0]?.userId).toBe(TEST_USER);
    expect(typeof calls[0]?.requestId).toBe("string");
    // R33 — cleanup shape prepends the localized cleanup system message.
    expect(calls[0]?.messages).toHaveLength(2);
    expect(calls[0]?.messages[0]?.role).toBe("system");
    expect(calls[0]?.messages[0]?.content).toContain("text cleanup tool");
    expect(calls[0]?.messages[1]).toEqual({ role: "user", content: "hello" });

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

  // D3a — the default chat model is operator-owned (LITELLM_DEFAULT_CHAT_MODEL
  // → litellm config → injected `defaultModel` dep). When `body.model` is
  // absent the route MUST use the injected value, not a baked literal.
  // R33 — `defaultModel` is the AGENT-shape default; `agentName` makes
  // this body the agent shape so the `defaultModel` chain applies (a bare
  // `{text}` body is the cleanup shape and uses `cleanupModel` instead).
  it("uses the injected defaultModel for the agent shape when body.model is omitted (D3a)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "corp-chat-internal",
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { total_tokens: 3 },
      },
    });
    app = buildApp({ db, litellm, defaultModel: "corp-chat-internal" });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello", agentName: "Whispr" }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.model).toBe("corp-chat-internal");
    // Unknown to the bundled display map → best-effort 'litellm' fallback.
    expect(parsed.provider).toBe("litellm");
    expect(calls[0]?.model).toBe("corp-chat-internal");
  });

  // D3a — R28: `body.model` may arrive explicitly null; the route must
  // treat null like absent and fall through to the injected default.
  // R33 — agent shape (`agentName` set) so the `defaultModel` chain
  // applies; the cleanup-shape null-model path is covered by the R33
  // cleanup tests below.
  it("treats body.model=null like absent and uses the injected default (D3a/R28)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm, defaultModel: "corp-chat-internal" });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hello", model: null, agentName: "Whispr" }),
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0]?.model).toBe("corp-chat-internal");
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
    // R33 — this body carries `agentName` + `systemPrompt` + explicit
    // `model`, so it is the AGENT shape: the provided `systemPrompt` is
    // used as the system message and `text` is the user message.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.messages).toEqual([
      { role: "system", content: "Optional system override" },
      { role: "user", content: "raw transcript" },
    ]);
    // Agent shape -> NO thinking-off extras.
    expect(calls[0]?.extras).toBeUndefined();
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

  // R28 (quick-task 20260522) — the immutable desktop client builds the
  // /api/reason body from `opts.model` / `opts.agentName`; on the FIRST
  // dictation of a session those are `null`, so the body literally
  // contains `"model":null` / `"agentName":null`. The schema's
  // `.optional()` rejected `null`, 400-ing the first dictation. `.nullish()`
  // admits it; the handler's `?? default` already treats null === undefined.
  it("R28 — accepts the first-dictation body {text, model:null, agentName:null} -> 200", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "hi", model: null, agentName: null }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = ReasonResponse.parse(res.json());
    // `model:null` falls through to the default-model chain.
    expect(parsed.model).toBe("qwen3.6-plus");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("qwen3.6-plus");
  });

  // R33 — the cleanup request shape (no agentName, no systemPrompt,
  // empty/absent model) is the dictation-cleanup path. The route must
  // (a) prepend the localized cleanup system message, (b) route to the
  // injected cleanup-class model, (c) carry the Qwen3 thinking-OFF field
  // `extra_body.chat_template_kwargs.enable_thinking:false` in `extras`.
  it("R33 — cleanup-shape request -> cleanup persona + cleanup model + thinking-off", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "qwen3.6-cleanup",
        choices: [{ message: { role: "assistant", content: "One, two, three." } }],
        usage: { total_tokens: 9 },
      },
    });
    app = buildApp({ db, litellm, defaultModel: "qwen3.6-plus", cleanupModel: "qwen3.6-cleanup" });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      // Cloud cleanup body the immutable client sends: text only.
      payload: JSON.stringify({ text: "one two three" }),
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("expected one upstream call");

    // (b) routed to the injected cleanup-class model.
    expect(call.model).toBe("qwen3.6-cleanup");

    // (a) cleanup system message prepended; user message is the verbatim
    // transcript. The {{agentName}} placeholder survives literally.
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]?.role).toBe("system");
    expect(call.messages[0]?.content).toContain("text cleanup tool");
    expect(call.messages[0]?.content).toContain("{{agentName}}");
    expect(call.messages[1]).toEqual({ role: "user", content: "one two three" });

    // (c) thinking-OFF travels in the request body via `extras`.
    expect(call.extras).toBeDefined();
    expect(call.extras).toEqual({
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
  });

  it("R33 — cleanup-shape with locale 'ru' selects the RU cleanup prompt", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm, defaultModel: "qwen3.6-plus", cleanupModel: "qwen3.6-cleanup" });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "one two three", language: "ru" }),
    });
    expect(res.statusCode).toBe(200);
    const call = calls[0];
    if (!call) throw new Error("expected one upstream call");
    expect(call.messages[0]?.role).toBe("system");
    // RU prompt — assert a stable non-Cyrillic structural property: the
    // {{agentName}} placeholder is present and the EN marker is NOT.
    expect(call.messages[0]?.content).toContain("{{agentName}}");
    expect(call.messages[0]?.content).not.toContain("text cleanup tool");
    expect(call.model).toBe("qwen3.6-cleanup");
  });

  it("R33 — cleanup-shape with non-empty customPrompt -> override used VERBATIM as the system message (tier 1)", async () => {
    // Three-tier precedence tier 1: the user's Prompt-Studio cleanup
    // override (`body.customPrompt`) wins over the server localized
    // default. The upstream call must carry the override verbatim, still
    // route to the cleanup model, and still carry thinking-off extras.
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "qwen3.6-cleanup",
        choices: [{ message: { role: "assistant", content: "One, two, three." } }],
        usage: { total_tokens: 9 },
      },
    });
    app = buildApp({ db, litellm, defaultModel: "qwen3.6-plus", cleanupModel: "qwen3.6-cleanup" });
    const customCleanup = "Remove fillers. Output ONLY the cleaned transcript. No commentary.";
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      // Cleanup shape (no model/agentName/systemPrompt) PLUS the
      // Prompt-Studio cleanup override the client forwards.
      payload: JSON.stringify({ text: "uh one two three", customPrompt: customCleanup }),
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("expected one upstream call");

    // Tier 1: the system message IS the customPrompt verbatim — NOT the
    // localized server default (no `text cleanup tool` marker).
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]).toEqual({ role: "system", content: customCleanup });
    expect(call.messages[0]?.content).not.toContain("text cleanup tool");
    expect(call.messages[1]).toEqual({ role: "user", content: "uh one two three" });

    // Still the cleanup shape: cleanup model + thinking-off extras.
    expect(call.model).toBe("qwen3.6-cleanup");
    expect(call.extras).toEqual({
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
  });

  it("R33 — cleanup-shape with empty-string customPrompt -> server localized default (tier 2)", async () => {
    // Tier 2: a blank `customPrompt` must NOT send an empty system
    // message — it falls through to the localized `prompts.cleanupPrompt`.
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({ calls });
    app = buildApp({ db, litellm, defaultModel: "qwen3.6-plus", cleanupModel: "qwen3.6-cleanup" });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ text: "one two three", customPrompt: "" }),
    });
    expect(res.statusCode).toBe(200);
    const call = calls[0];
    if (!call) throw new Error("expected one upstream call");
    expect(call.messages[0]?.role).toBe("system");
    expect(call.messages[0]?.content).toContain("text cleanup tool");
    expect(call.model).toBe("qwen3.6-cleanup");
  });

  it("R33 — agent-shape request -> conversational call, default model, NO thinking-off", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "qwen3.6-plus",
        choices: [{ message: { role: "assistant", content: "agent reply" } }],
        usage: { total_tokens: 4 },
      },
    });
    app = buildApp({ db, litellm, defaultModel: "qwen3.6-plus", cleanupModel: "qwen3.6-cleanup" });
    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      // agentName set -> agent shape (no systemPrompt -> no system message).
      payload: JSON.stringify({ text: "summarize this", agentName: "Whispr" }),
    });
    expect(res.statusCode).toBe(200);
    const call = calls[0];
    if (!call) throw new Error("expected one upstream call");

    // Agent shape -> default conversational model, NOT the cleanup model.
    expect(call.model).toBe("qwen3.6-plus");
    // agentName-only -> no system message (today's behaviour, not regressed).
    expect(call.messages).toEqual([{ role: "user", content: "summarize this" }]);
    // Agent shape -> no thinking-off extras in the request body.
    expect(call.extras).toBeUndefined();
  });

  // R33 / cleanup-no-rephrase contract (Quick 260530-kkz) — REGRESSION GUARD.
  //
  // Incident: the cleanup model rephrased/rewrote transcripts instead of
  // only stripping fillers. Root cause was on the litellm side (alias
  // qwen3.6-cleanup targeted a reasoning model whose `enable_thinking:false`
  // kwarg OpenRouter dropped → it "thought" and rewrote); the fix swapped
  // the backing model to a strict instruct checkpoint + temperature:0.
  //
  // THIS test guards OUR layer's half of the contract: the route must return
  // the cleanup model's output VERBATIM and add nothing of its own. If a
  // future change ever inserts a server-side "polish"/post-process step on
  // the cleanup path, this fails. It does NOT (and cannot) assert that a real
  // model avoids rephrasing — that is the instruct-model + temp:0 litellm
  // config's job, additionally guarded by the nightly e2e against the real
  // stage alias (task #17). Scope here is strictly the server passthrough.
  it("R33 — cleanup-shape returns the model output VERBATIM (no server-side rephrase/added content)", async () => {
    const { db } = makeFakeDb();
    const calls: ChatCompletionRequest[] = [];

    // Golden pair: a dirty dictation transcript (the user's spoken input)
    // and the exact cleaned text the (now strict-instruct) cleanup model
    // returns — fillers/false-starts/duplicate-words removed, punctuation
    // fixed, wording + meaning preserved, NO rephrase, NO added content.
    const dirtyTranscript =
      "um so yeah i was like thinking that uh we should maybe you know ship " +
      "the the thing on friday but um idk if the tests are gonna pass by then " +
      "so like maybe monday is safer i guess";
    const cleanedGolden =
      "Yeah, I was thinking we should maybe ship the thing on Friday, but I " +
      "don't know if the tests will pass by then. Maybe Monday's safer, I guess.";

    const litellm = makeFakeLitellm({
      calls,
      upstreamJson: {
        model: "qwen3.6-cleanup",
        choices: [{ message: { role: "assistant", content: cleanedGolden } }],
        usage: { total_tokens: 42 },
      },
    });
    app = buildApp({ db, litellm, defaultModel: "qwen3.6-plus", cleanupModel: "qwen3.6-cleanup" });

    const res = await app.inject({
      method: "POST",
      url: "/api/reason",
      headers: { "content-type": "application/json" },
      // Cleanup shape: text only (no model/agentName/systemPrompt).
      payload: JSON.stringify({ text: dirtyTranscript }),
    });
    expect(res.statusCode).toBe(200);

    // VERBATIM passthrough: response.text is byte-for-byte the model output.
    // The server neither appends a preamble/commentary nor re-cleans/rewrites
    // it — `reason.ts` returns choices[0].message.content unchanged.
    const parsed = ReasonResponse.parse(res.json());
    expect(parsed.text).toBe(cleanedGolden);

    // The server adds nothing of its own: no extra leading/trailing content,
    // and the dirty input text is NOT echoed back into the response.
    expect(parsed.text).not.toContain(dirtyTranscript);
    expect(parsed.text.startsWith("Yeah, I was thinking")).toBe(true);
    expect(parsed.text.endsWith("Maybe Monday's safer, I guess.")).toBe(true);

    // Still the cleanup contract on the request side: cleanup model, the
    // cleanup system prompt is applied, the raw transcript is the user
    // message verbatim, and thinking-off travels in the body.
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("expected one upstream call");
    expect(call.model).toBe("qwen3.6-cleanup");
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]?.role).toBe("system");
    expect(call.messages[0]?.content).toContain("text cleanup tool");
    // The user message is the dirty transcript VERBATIM — the server does
    // not pre-clean or alter the input before sending it upstream.
    expect(call.messages[1]).toEqual({ role: "user", content: dirtyTranscript });
    expect(call.extras).toEqual({
      extra_body: { chat_template_kwargs: { enable_thinking: false } },
    });
  });
});
