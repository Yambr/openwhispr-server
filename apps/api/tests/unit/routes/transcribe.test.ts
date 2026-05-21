// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 04 / Task 1 — POST /api/transcribe plugin tests.
//
// Strategy: register the plugin against a hand-rolled fake LitellmClient
// (in-memory) and a hand-rolled fake TransactionalDb that records executed
// SQL fragments. dualAuthHook is stubbed to populate req.user / req.tenant
// directly so we test the route's wire-shape semantics in isolation; the
// full hook contract is covered in dual-auth.test.ts.
//
// Coverage matrix:
//   * happy path (fake LiteLLM 200) -> 200 with TranscribeResponse shape
//   * missing GROQ_API_KEY -> 503 (NOT 401 — Pitfall #8)
//   * upstream LiteLLM error -> 502 (envelope, no master key leakage)
//   * dual-auth failure (no req.user) -> 401
//   * non-multipart content-type -> 400
//   * usage_ledger row written with kind='transcribe_minutes' + idempotency clause
//   * idempotent re-post (same request_id) does NOT duplicate (ON CONFLICT path)
//   * streaming: req.raw forwarded WITHOUT buffering — passing > 1 MB body
//     does not load it into a Buffer in our route

import fastifyMultipart from "@fastify/multipart";
import { ErrorEnvelope, TranscribeResponse } from "@openwhispr/contract-tests/schemas";
import {
  type AudioTranscriptionRequest,
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { zodTypeProvider } from "../../../src/plugins/zod-type-provider.js";
import { buildTranscribeRoutes } from "../../../src/routes/transcribe.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

interface RecordedQuery {
  sql: string;
  params: readonly unknown[];
}

function makeFakeDb(): {
  db: Parameters<typeof buildTranscribeRoutes>[0]["db"];
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
  /** When set, audioTranscriptions throws this error instead of returning. */
  throws?: Error;
  /** Upstream JSON body to return (default: a representative whisper-verbose payload). */
  upstreamJson?: { text: string; duration?: number; language?: string; segments?: unknown[] };
  /** Records every audioTranscriptions call. */
  calls: AudioTranscriptionRequest[];
  /** Captures the chunks the route forwards into the client (proves no buffering). */
  bodyByteCount: number;
}

function makeFakeLitellm(opts: FakeLitellmOpts): LitellmClient {
  return {
    baseUrl: "http://litellm.test:4000",
    chatCompletions: () => {
      throw new Error("chatCompletions not used in this test");
    },
    passthrough: () => {
      throw new Error("passthrough not used in this test");
    },
    async audioTranscriptions(args) {
      opts.calls.push(args);
      // Drain the readable so the route's `req.raw` actually flows
      // through (proves we forwarded a stream, not a Buffer).
      await new Promise<void>((resolve, reject) => {
        let total = 0;
        args.body.on("data", (chunk: Buffer | string) => {
          total += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
        });
        args.body.on("end", () => {
          opts.bodyByteCount = total;
          resolve();
        });
        args.body.on("error", reject);
      });
      if (opts.throws) throw opts.throws;
      const json = opts.upstreamJson ?? {
        text: "hello world",
        duration: 90,
        language: "en",
        segments: [],
      };
      // Mimic undici Dispatcher.ResponseData shape (only what the route reads).
      return {
        statusCode: 200,
        body: {
          async json() {
            return json;
          },
        },
      } as unknown as Awaited<ReturnType<LitellmClient["audioTranscriptions"]>>;
    },
  };
}

function buildApp(
  deps: Parameters<typeof buildTranscribeRoutes>[0],
  opts?: { authed?: boolean },
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(fastifyCookieIfNeeded);
  app.register(fastifyMultipart, {
    attachFieldsToBody: false as const,
    limits: { fileSize: 100 * 1024 * 1024 },
  });
  app.register(zodTypeProvider);
  // Stub dualAuthHook — this test isolates the route logic; full hook
  // semantics are covered by dual-auth.test.ts.
  if (opts?.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
    });
  }
  app.register(buildTranscribeRoutes(deps));
  return app;
}

// fastifyCookie is a transitive dep already in the workspace; keeping the
// helper opaque so a future plugin reorder doesn't ripple into every test.
async function fastifyCookieIfNeeded(_app: FastifyInstance) {
  /* no-op — cookie plugin not required for this route's tests */
}

function multipartBody(
  payload: Buffer | string,
  boundary = "----test-boundary",
): { body: Buffer; contentType: string } {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const fileBytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return {
    body: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("POST /api/transcribe", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns canonical TranscribeResponse on happy path (Groq whisper-large-v3)", async () => {
    const { db, recorded } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const lOpts = { calls, bodyByteCount: 0 };
    const litellm = makeFakeLitellm(lOpts);
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("hello-world-audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const parsed = TranscribeResponse.parse(res.json());
    expect(parsed.text).toBe("hello world");
    expect(parsed.sttProvider).toBe("groq");
    expect(parsed.sttModel).toBe("whisper-large-v3");
    expect(parsed.plan).toBe("unlimited");
    expect(parsed.limitReached).toBe(false);
    expect(parsed.wordsUsed).toBe(2); // ceil(90/60)
    expect(parsed.wordsRemaining).toBe(999_999_999);
    expect(parsed.duration).toBe(90);
    expect(parsed.language).toBe("en");
    // Forwarded request carried our request_id in the spend-logs metadata
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userId).toBe(TEST_USER);
    expect(typeof calls[0]?.requestId).toBe("string");
    // Phase 19.2 / Plan 02 — SERVER-ERRORS Entry 11 regression: route
    // MUST forward the STT model into the litellm client call so the
    // upstream URL carries `?model=...` and LiteLLM does not reject with
    // `Invalid model name passed in model=None`. D2: with no injected
    // `sttModel` dep the route falls back to the bundled default alias.
    expect(calls[0]?.model).toBe("whisper-large-v3");
    // Ledger row written with kind='transcribe_minutes', units=2, ON CONFLICT
    const insert = recorded.find((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(insert).toBeDefined();
    expect(insert?.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    // The fake recorder serializes drizzle's `sql` chunks; values may be
    // inlined into the SQL text (StringChunk path) OR captured as bound
    // params depending on the chunk shape. Assert across both surfaces.
    const wholeRecording = insert?.sql + JSON.stringify(insert?.params);
    expect(wholeRecording).toContain("transcribe_minutes");
    expect(wholeRecording).toContain(TEST_TENANT);
    expect(wholeRecording).toContain(TEST_USER);
    // The kind+units pair we care about most: the row was inserted with
    // units=2 (minutes derived from upstream duration=90s).
    expect(insert?.sql).toMatch(/2\s*\)\s*ON CONFLICT/);
  });

  // D2 — the STT alias is operator-owned (LITELLM_STT_MODEL → litellm
  // config → injected dep). A corporate operator's non-default alias MUST
  // reach the litellm call AND be echoed in `sttModel`, with no
  // `whisper-large-v3` literal baked into the route.
  it("forwards an injected non-default sttModel into the litellm call and the response (D2)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({ calls, bodyByteCount: 0 });
    app = buildApp({ db, litellm, sttModel: "corp-whisper-internal" });
    const { body, contentType } = multipartBody("hello-world-audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const parsed = TranscribeResponse.parse(res.json());
    expect(parsed.sttModel).toBe("corp-whisper-internal");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("corp-whisper-internal");
  });

  it("returns 401 envelope when no auth (req.user absent)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({ calls, bodyByteCount: 0 });
    app = buildApp({ db, litellm }, { authed: false });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    // LiteLLM was never called — auth is the gate.
    expect(calls).toHaveLength(0);
  });

  it("returns 503 envelope when GROQ_API_KEY is missing (Pitfall #8 — NOT 401)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      bodyByteCount: 0,
      throws: new MissingProviderKeyError("GROQ_API_KEY", "whisper-large-v3"),
    });
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
    const env = ErrorEnvelope.parse(res.json());
    // HI-03 (Phase 62): the error envelope emits the class-default literal
    // — the missing-key detail stays server-side (`req.log.warn`).
    expect(env.error).toBe("Service temporarily unavailable");
    expect(res.body).not.toContain("GROQ_API_KEY");
  });

  it("returns 502 envelope on upstream LiteLLM failure (no master-key leakage)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      bodyByteCount: 0,
      throws: new LitellmUpstreamError(
        500,
        "Bearer sk-litellm-master-DO-NOT-LEAK upstream error blob",
      ),
    });
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(502);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toBe("upstream transcription provider failure");
    // CRITICAL: master-key shape MUST NOT appear in the response.
    expect(JSON.stringify(env)).not.toMatch(/sk-litellm-master/);
  });

  it("rejects non-multipart content-type with 400 envelope", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({ calls, bodyByteCount: 0 });
    app = buildApp({ db, litellm });
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ not: "multipart" }),
    });
    expect(res.statusCode).toBe(400);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/multipart/);
    expect(calls).toHaveLength(0);
  });

  // Phase 59 / Track B — R16 facet 2: a zero-byte audio file part must be
  // rejected with 400 BEFORE any upstream call. Pre-fix the empty body
  // streamed through to litellm and 502'd.
  it("R16 — rejects a zero-byte file part with 400 before any upstream call", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({ calls, bodyByteCount: 0 });
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/empty/i);
    // The empty upload NEVER reached the STT upstream.
    expect(calls).toHaveLength(0);
  });

  it("forwards req.raw without buffering (1.5 MB payload streams through)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const lOpts = { calls, bodyByteCount: 0 };
    const litellm = makeFakeLitellm(lOpts);
    app = buildApp({ db, litellm });
    const big = Buffer.alloc(1_500_000, 0x61); // ~1.5 MB of 'a'
    const { body, contentType } = multipartBody(big);
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    // We saw the FULL body (multipart envelope + payload) flow through the
    // upstream client — proving the route did NOT buffer/parse it.
    expect(lOpts.bodyByteCount).toBeGreaterThan(1_500_000);
  });

  it("idempotent re-post (same request_id) does not throw — ON CONFLICT DO NOTHING", async () => {
    // The fake DB returns rows:[] for both inserts; the SQL itself contains
    // the ON CONFLICT clause so the real Postgres path is the unit of
    // contract here. We verify the SQL TEXT is correct AND replaying the
    // same payload twice succeeds (no thrown exception, both responses 200).
    const { db, recorded } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({ calls, bodyByteCount: 0 });
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("audio");
    const res1 = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    const res2 = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const inserts = recorded.filter((r) => /INSERT INTO usage_ledger/i.test(r.sql));
    expect(inserts).toHaveLength(2);
    for (const ins of inserts) {
      expect(ins.sql).toMatch(/ON CONFLICT \(request_id\) DO NOTHING/);
    }
  });

  it("returns wordsUsed=0 when upstream omits duration (json response_format)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      bodyByteCount: 0,
      upstreamJson: { text: "transcribed words" },
    });
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const parsed = TranscribeResponse.parse(res.json());
    expect(parsed.wordsUsed).toBe(0);
    expect(parsed.duration).toBeUndefined();
    expect(parsed.language).toBeUndefined();
    expect(parsed.segments).toBeUndefined();
  });

  it("re-throws unknown errors (caught by setErrorHandler -> 500 envelope)", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({
      calls,
      bodyByteCount: 0,
      throws: new Error("totally unexpected"),
    });
    app = buildApp({ db, litellm });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(500);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    // Defensive: the centralized handler emits "Internal server error",
    // never the raw `err.message`.
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).not.toMatch(/totally unexpected/);
  });
});

describe("POST /api/transcribe — multipart plugin presence", () => {
  it("multipart content-type is registered when route is mounted", async () => {
    const { db } = makeFakeDb();
    const calls: AudioTranscriptionRequest[] = [];
    const litellm = makeFakeLitellm({ calls, bodyByteCount: 0 });
    const app2 = buildApp({ db, litellm });
    await app2.ready();
    expect(app2.hasContentTypeParser("multipart/form-data")).toBe(true);
    await app2.close();
  });
});
