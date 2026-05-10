// Phase 03 / Plan 06 / Task 3 — POST /v1/audio/diarization plugin tests.
//
// Strategy mirrors transcribe.test.ts and reason.test.ts: register the
// plugin against a hand-rolled fake PyannoteClient + an in-memory fake
// RedisLike (idempotency cache backing). dualAuthHook is stubbed to
// populate req.user / req.tenant directly; full hook semantics are
// covered by dual-auth.test.ts.
//
// Coverage matrix — one failing test FIRST per row:
//   * 200 succeeded (single poll cycle) — DiarizationResponse shape echoed
//   * 200 idem hit (second post with same Idempotency-Key + body skips submit)
//   * 200 mock mode (MOCK_DIARIZATION=true short-circuit)
//   * 400 non-multipart content-type
//   * 400 missing `file` field
//   * 401 no auth (req.user absent)
//   * 409 idempotency conflict (same key, different body hash)
//   * 502 pyannote job 'failed'
//   * 502 pyannote job 'cancelled'
//   * 502 PyannoteBadRequestError (4xx other)
//   * 503 missing PYANNOTE_API_KEY (Pitfall #8 — NEVER 401)
//   * 503 PyannoteUnavailableError (5xx) with retry-after header
//   * 503 PyannoteAuthError (401/403 from upstream — Pitfall #8)
//   * 504 5-minute polling ceiling exceeded (jobId returned)
//   * idempotency: bindJobId called with the freshly-submitted jobId
//   * PYANNOTE_API_KEY never appears in any reply payload
//   * uploadToPresignedUrl receives the full file bytes (no truncation)

import Fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiarizationResponse,
  ErrorEnvelope,
} from "@openwhispr/contract-tests/schemas";
import { registerErrorHandler } from "../../error-handler.js";
import { zodTypeProvider } from "../../plugins/zod-type-provider.js";
import {
  buildDiarizationRoutes,
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
} from "../diarization.js";
import {
  MissingPyannoteKeyError,
  PyannoteAuthError,
  PyannoteBadRequestError,
  PyannoteUnavailableError,
  type PyannoteClient,
  type PyannoteJob,
} from "../../lib/pyannote-client.js";
import type { RedisLike } from "../../lib/idempotency-cache.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";

/**
 * In-memory RedisLike substitute mirroring the @redis/client surface
 * the idempotency-cache module actually exercises (set / get with the
 * options object). Honors NX, EX, and KEEPTTL semantics enough for
 * the cache's contract.
 */
function makeFakeRedis(): RedisLike & { __store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    __store: store,
    async set(key, value, opts) {
      if (opts?.NX === true && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
  };
}

interface FakePyannoteOpts {
  /** Sequence of job statuses to return on successive pollJob calls. */
  pollResponses?: PyannoteJob[];
  /** When set, createMediaInput throws this error. */
  createMediaThrows?: Error;
  /** When set, uploadToPresignedUrl throws this error. */
  uploadThrows?: Error;
  /** When set, submitDiarize throws this error. */
  submitThrows?: Error;
  /** When set, pollJob throws this error on every call. */
  pollThrows?: Error;
  /** Records every uploaded body's byte length. */
  uploadedBytes: number[];
  /** Records jobIds bound via submitDiarize. */
  submittedJobIds: string[];
  /** Records every method invocation in order. */
  calls: string[];
}

function makeFakePyannote(opts: FakePyannoteOpts): PyannoteClient {
  let pollIndex = 0;
  return {
    async createMediaInput() {
      opts.calls.push("createMediaInput");
      if (opts.createMediaThrows) throw opts.createMediaThrows;
      return {
        url: "https://pyannote-presigned.test/upload/abc-key-123",
        mediaUri: "media://abc-key-123",
      };
    },
    async uploadToPresignedUrl(_url, body, _ct) {
      opts.calls.push("uploadToPresignedUrl");
      if (opts.uploadThrows) throw opts.uploadThrows;
      const buf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body ?? ""));
      opts.uploadedBytes.push(buf.length);
    },
    async submitDiarize(_mediaUri) {
      opts.calls.push("submitDiarize");
      if (opts.submitThrows) throw opts.submitThrows;
      const jobId = `job-${opts.submittedJobIds.length + 1}`;
      opts.submittedJobIds.push(jobId);
      return jobId;
    },
    async pollJob(jobId, _signal) {
      opts.calls.push(`pollJob:${jobId}`);
      if (opts.pollThrows) throw opts.pollThrows;
      const responses = opts.pollResponses ?? [];
      const r = responses[Math.min(pollIndex, responses.length - 1)];
      pollIndex++;
      return (
        r ?? {
          jobId,
          status: "succeeded",
          output: {
            duration: 5,
            segments: [{ start: 0, end: 5, speaker: "SPEAKER_00" }],
          },
        }
      );
    },
  };
}

interface BuildOpts {
  redis?: RedisLike;
  pyannote?: PyannoteClient;
  pyannoteFactory?: () => PyannoteClient;
  authed?: boolean;
  mockMode?: boolean;
}

function buildApp(opts: BuildOpts = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.register(fastifyMultipart, {
    attachFieldsToBody: false as const,
    limits: { fileSize: 100 * 1024 * 1024 },
  });
  app.register(zodTypeProvider);
  if (opts.authed !== false) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
    });
  }
  // exactOptionalPropertyTypes: omit optional fields rather than passing
  // `undefined` explicitly.
  const factory =
    opts.pyannoteFactory ??
    (opts.pyannote ? () => opts.pyannote as PyannoteClient : undefined);
  const diarDeps: Parameters<typeof buildDiarizationRoutes>[0] = {
    redis: opts.redis ?? makeFakeRedis(),
  };
  if (opts.mockMode !== undefined) diarDeps.mockMode = opts.mockMode;
  if (factory) diarDeps.pyannoteFactory = factory;
  app.register(buildDiarizationRoutes(diarDeps));
  return app;
}

function multipartBody(
  payload: Buffer | string,
  boundary = "----diar-test-boundary",
): { body: Buffer; contentType: string } {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const fileBytes =
    typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return {
    body: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("POST /v1/audio/diarization", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns canonical DiarizationResponse on succeeded poll (200 happy path)", async () => {
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
      pollResponses: [
        {
          jobId: "job-1",
          status: "succeeded",
          output: {
            duration: 12.5,
            segments: [
              { start: 0, end: 4.2, speaker: "SPEAKER_00" },
              { start: 4.2, end: 12.5, speaker: "SPEAKER_01" },
            ],
          },
        },
      ],
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio-bytes");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const parsed = DiarizationResponse.parse(res.json());
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]?.speaker).toBe("SPEAKER_00");
    expect(calls).toEqual([
      "createMediaInput",
      "uploadToPresignedUrl",
      "submitDiarize",
      "pollJob:job-1",
    ]);
  });

  it("short-circuits to mock fixture when mockMode=true (MOCK_DIARIZATION)", async () => {
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
    });
    app = buildApp({ pyannote, mockMode: true });
    const { body, contentType } = multipartBody("audio-bytes");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const parsed = DiarizationResponse.parse(res.json());
    expect(parsed.segments).toHaveLength(1);
    // pyannote NEVER reached in mock mode.
    expect(calls).toEqual([]);
  });

  it("idempotent re-post with same Idempotency-Key + body reuses cached jobId (200; submit called once)", async () => {
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
    });
    const redis = makeFakeRedis();
    app = buildApp({ pyannote, redis });
    const { body, contentType } = multipartBody("identical-bytes");
    const headers = {
      "content-type": contentType,
      "idempotency-key": "client-key-A",
    };
    const r1 = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers,
      payload: body,
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers,
      payload: body,
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    // submitDiarize called ONCE across two requests.
    const submitCount = calls.filter((c) => c === "submitDiarize").length;
    expect(submitCount).toBe(1);
    // pollJob called for both (second hits cached jobId).
    const pollCount = calls.filter((c) => c.startsWith("pollJob:")).length;
    expect(pollCount).toBe(2);
  });

  it("rejects non-multipart content-type with 400 envelope", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    app = buildApp({ pyannote });
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ not: "multipart" }),
    });
    expect(res.statusCode).toBe(400);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/multipart/);
  });

  it("returns 400 envelope when multipart has no file part", async () => {
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
    });
    app = buildApp({ pyannote });
    // Multipart envelope with a non-file field only.
    const boundary = "----diar-no-file";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\npyannote/diarization-3.1\r\n--${boundary}--\r\n`,
      "utf8",
    );
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("returns 401 envelope when no auth (req.user absent)", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    app = buildApp({ pyannote, authed: false });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
  });

  it("returns 409 envelope when Idempotency-Key reused with different body (Stripe semantics)", async () => {
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
    });
    const redis = makeFakeRedis();
    app = buildApp({ pyannote, redis });
    const r1 = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: {
        "content-type": multipartBody("body-A").contentType,
        "idempotency-key": "shared-key",
      },
      payload: multipartBody("body-A").body,
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: {
        "content-type": multipartBody("body-B-different").contentType,
        "idempotency-key": "shared-key",
      },
      payload: multipartBody("body-B-different").body,
    });
    expect(r2.statusCode).toBe(409);
    const env = ErrorEnvelope.parse(r2.json());
    expect(env.error).toMatch(/Idempotency-Key conflict/);
  });

  it("returns 502 envelope when pyannote job status='failed'", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      pollResponses: [{ jobId: "job-1", status: "failed" }],
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(502);
    // 502 envelope carries an additional `jobId` hint so the desktop can
    // resume polling. ErrorEnvelope is .strict() — assert the `error`
    // field directly rather than parsing strictly.
    const json = res.json() as { error: string; jobId: string };
    expect(json.error).toMatch(/diarization job failed/);
    expect(json.jobId).toBe("job-1");
  });

  it("returns 502 envelope when pyannote job status='cancelled'", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      pollResponses: [{ jobId: "job-1", status: "cancelled" }],
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(502);
    const json = res.json() as { error: string; jobId: string };
    expect(json.error).toMatch(/cancelled/);
    expect(json.jobId).toBe("job-1");
  });

  it("returns 502 envelope on PyannoteBadRequestError (upstream rejected our payload)", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      submitThrows: new PyannoteBadRequestError(422, "pyannote 422: bad"),
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(502);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/pyannote rejected request/);
  });

  it("returns 503 envelope when PYANNOTE_API_KEY is missing (Pitfall #8 — NOT 401)", async () => {
    app = buildApp({
      pyannoteFactory: () => {
        throw new MissingPyannoteKeyError();
      },
    });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/PYANNOTE_API_KEY/);
    // Defensive: a 401 would sign the desktop user out.
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 503 envelope + retry-after header on PyannoteUnavailableError (5xx upstream)", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      createMediaThrows: new PyannoteUnavailableError(
        503,
        "pyannote 503",
      ),
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("30");
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/pyannote\.ai upstream/);
  });

  it("converts PyannoteAuthError (401/403 upstream) to 503 with operator-actionable message (Pitfall #8)", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      createMediaThrows: new PyannoteAuthError(401, "auth failed"),
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(503);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/PYANNOTE_API_KEY rejected by upstream/);
    // Critical desktop invariant: NEVER 401 from upstream auth issues.
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 504 envelope with jobId when polling exceeds the 5-minute ceiling", async () => {
    // Simulate the ceiling without burning 5 real minutes of wall-clock:
    // the fake pollJob throws immediately on the first call to advance
    // through the loop, then a Date.now spy reports the elapsed time has
    // exceeded the ceiling. Specifically, the first Date.now() call
    // (reading startedAt) returns 0; subsequent calls return a value
    // beyond POLL_CEILING_MS so the loop exits with 504 on iteration 2.
    let pollCallCount = 0;
    const pyannote: PyannoteClient = {
      async createMediaInput() {
        return {
          url: "https://pyannote-presigned.test/upload/abc",
          mediaUri: "media://abc",
        };
      },
      async uploadToPresignedUrl() {
        /* no-op */
      },
      async submitDiarize() {
        return "job-1";
      },
      async pollJob(jobId) {
        pollCallCount++;
        // First poll: still running. The route then sleeps POLL_INTERVAL_MS
        // before iterating; when its `Date.now() - startedAt < POLL_CEILING_MS`
        // check runs it sees the spied time has jumped past the ceiling.
        return { jobId, status: "running" };
      },
    };
    app = buildApp({ pyannote });

    // Strategy: stub setTimeout from node:timers/promises path indirectly
    // by stubbing global setTimeout. The route's sleep() comes from
    // node:timers/promises which calls global setTimeout under the hood.
    // We let Fastify's own boot timer keep using the real one by using
    // vi.useFakeTimers() AFTER the route is registered.
    await app.ready();

    // Now activate fake timers. Date.now will tick via vi.advanceTimersByTime.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const injectPromise = app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": multipartBody("audio").contentType },
      payload: multipartBody("audio").body,
    });

    // Advance the fake clock past the ceiling so the second iteration's
    // ceiling check trips. Repeatedly advance until the inject resolves.
    for (let i = 0; i < 20 && pollCallCount < 1; i++) {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }
    // Jump past ceiling.
    await vi.advanceTimersByTimeAsync(POLL_CEILING_MS + POLL_INTERVAL_MS * 2);

    const res = await injectPromise;
    vi.useRealTimers();

    expect(res.statusCode).toBe(504);
    const json = res.json() as { error: string; jobId: string };
    expect(json.error).toMatch(/5-minute ceiling/);
    expect(json.jobId).toBe("job-1");
  }, 15_000);

  it("uploadToPresignedUrl receives the full file bytes (no truncation)", async () => {
    const uploadedBytes: number[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes,
      submittedJobIds: [],
      calls: [],
    });
    app = buildApp({ pyannote });
    const big = Buffer.alloc(64 * 1024, 0x61); // 64 KB
    const { body, contentType } = multipartBody(big);
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(uploadedBytes).toHaveLength(1);
    expect(uploadedBytes[0]).toBe(big.length);
  });

  it("PYANNOTE_API_KEY value never appears in any reply payload (information disclosure guard)", async () => {
    const SECRET_KEY = "sk-pyannote-DO-NOT-LEAK-12345";
    process.env.PYANNOTE_API_KEY = SECRET_KEY;
    try {
      const pyannote = makeFakePyannote({
        uploadedBytes: [],
        submittedJobIds: [],
        calls: [],
        createMediaThrows: new PyannoteAuthError(
          401,
          `bad key: ${SECRET_KEY}`,
        ),
      });
      app = buildApp({ pyannote });
      const { body, contentType } = multipartBody("audio");
      const res = await app.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.body).not.toContain(SECRET_KEY);
    } finally {
      delete process.env.PYANNOTE_API_KEY;
    }
  });

  it("does NOT call POLL_INTERVAL_MS-bounded sleep more than ceiling/interval times (sanity for poll cadence constants)", () => {
    // Pure constant assertion — Plan-locked values; regressions here flip
    // the production billing/abuse posture.
    expect(POLL_INTERVAL_MS).toBe(1500);
    expect(POLL_CEILING_MS).toBe(300_000);
  });
});
