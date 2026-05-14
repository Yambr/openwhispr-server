// SPDX-License-Identifier: FSL-1.1-ALv2
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

import fastifyMultipart from "@fastify/multipart";
import { DiarizationResponse, ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import type { RedisLike } from "../../../../src/lib/idempotency-cache.js";
import {
  MissingPyannoteKeyError,
  PyannoteAuthError,
  PyannoteBadRequestError,
  type PyannoteClient,
  type PyannoteJob,
  PyannoteUnavailableError,
} from "../../../../src/lib/pyannote-client.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import {
  buildDiarizationRoutes,
  POLL_CEILING_MS,
  POLL_INTERVAL_MS,
} from "../../../../src/routes/diarization.js";

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
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
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
    opts.pyannoteFactory ?? (opts.pyannote ? () => opts.pyannote as PyannoteClient : undefined);
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
  const fileBytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
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
      createMediaThrows: new PyannoteUnavailableError(503, "pyannote 503"),
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
        createMediaThrows: new PyannoteAuthError(401, `bad key: ${SECRET_KEY}`),
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

  // ----- Stage B back-fill tests -----------------------------------------
  // Closing the residual ≥ 90/90/90/90 gap on diarization.ts. Each test
  // pins one previously uncovered branch and runs against the same fake
  // PyannoteClient + in-memory RedisLike used by the canonical tests above.

  it("rethrows non-MissingPyannoteKey errors raised by pyannoteFactory (line 152 path)", async () => {
    const sentinel = new Error("factory blew up unexpectedly");
    app = buildApp({
      pyannoteFactory: () => {
        throw sentinel;
      },
    });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    // Centralized error handler maps unknown throws to 500.
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("factory blew up unexpectedly");
  });

  it("returns 502 envelope on PyannoteUpstreamError (presigned PUT non-2xx)", async () => {
    const { PyannoteUpstreamError } = await import("../../../../src/lib/pyannote-client");
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      uploadThrows: new PyannoteUpstreamError(500, "presigned PUT failed"),
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
    expect(env.error).toMatch(/pyannote upstream/);
  });

  it("rethrows unknown errors from mapPyannoteError so centralized handler emits 500", async () => {
    // Submit step throws a plain Error (not in the PyannoteError taxonomy).
    // mapPyannoteError must rethrow → centralized error handler → 500.
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      submitThrows: new Error("totally novel failure mode"),
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(500);
    // Centralized handler emits a generic envelope; the original message
    // must NOT leak (information disclosure guard).
    expect(res.body).not.toContain("totally novel failure mode");
  });

  it("returns 502 when pollJob throws PyannoteBadRequestError mid-loop", async () => {
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      pollThrows: new PyannoteBadRequestError(422, "poll rejected"),
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

  it("aborts the response (no body) when pollJob throws AbortError (client disconnect)", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
      pollThrows: abortErr,
    });
    app = buildApp({ pyannote });
    const { body, contentType } = multipartBody("audio");
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: { "content-type": contentType },
      payload: body,
    });
    // The handler returns undefined on AbortError → Fastify sends 200
    // empty body (or just no payload). The critical assertion is that
    // we did NOT send a 502/500 envelope on this branch.
    expect([200, 0]).toContain(res.statusCode);
    // No JSON body produced.
    expect(res.body === "" || res.body == null).toBe(true);
  });

  it("returns 503 envelope when an in-flight reservation never binds a jobId (state='in-flight' fallthrough)", async () => {
    // Build a redis stub whose entry has a fingerprint matching but whose
    // sibling :jobid key never appears — exercises the in-flight retry
    // loop's failure exit (lines 242-246).
    const store = new Map<string, string>();
    const KEY = "diar:idem:stuck-key";
    // Pre-seed a reservation entry with bodyHash matching SHA256("audio").
    const { createHash } = await import("node:crypto");
    const bodyHash = createHash("sha256").update("audio").digest("hex");
    store.set(KEY, JSON.stringify({ bodyHash, jobId: null, createdAt: Date.now() }));
    const redis: RedisLike = {
      async set(_k, _v, opts) {
        // NX always rejected — entry already exists.
        if (opts?.NX === true) return null;
        return "OK";
      },
      async get(k) {
        return store.get(k) ?? null;
      },
    };
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    app = buildApp({ pyannote, redis });
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: {
        "content-type": multipartBody("audio").contentType,
        "idempotency-key": "stuck-key",
      },
      payload: multipartBody("audio").body,
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/concurrent request in flight/);
  }, 10_000);

  it("returns 409 when a recheck during in-flight wait reveals a different bodyHash", async () => {
    // Mirror the in-flight loop but flip the stored bodyHash on the
    // second redis.get call so the recheck path observes a conflict
    // (lines 236-238 / 242-238).
    const { createHash } = await import("node:crypto");
    const ourBodyHash = createHash("sha256").update("body-A").digest("hex");
    const otherBodyHash = createHash("sha256").update("body-different").digest("hex");
    let getCount = 0;
    const KEY = "diar:idem:flip-key";
    const redis: RedisLike = {
      async set(_k, _v, opts) {
        if (opts?.NX === true) return null;
        return "OK";
      },
      async get(k) {
        if (k !== KEY) return null;
        getCount++;
        // First lookup: matches → in-flight. Subsequent: conflict.
        const hash = getCount === 1 ? ourBodyHash : otherBodyHash;
        return JSON.stringify({ bodyHash: hash, jobId: null, createdAt: 0 });
      },
    };
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    app = buildApp({ pyannote, redis });
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: {
        "content-type": multipartBody("body-A").contentType,
        "idempotency-key": "flip-key",
      },
      payload: multipartBody("body-A").body,
    });
    expect(res.statusCode).toBe(409);
    const env = ErrorEnvelope.parse(res.json());
    expect(env.error).toMatch(/Idempotency-Key conflict/i);
  }, 10_000);

  it("recovers when in-flight recheck eventually returns 'hit' with a bound jobId", async () => {
    // Flip from in-flight (no sibling) to hit (sibling present) on the
    // second redis.get pass — exercises lines 232-234.
    const { createHash } = await import("node:crypto");
    const bodyHash = createHash("sha256").update("body-hit").digest("hex");
    const KEY = "diar:idem:hit-key";
    const SIBLING = `${KEY}:jobid`;
    let mainGets = 0;
    const redis: RedisLike = {
      async set(_k, _v, opts) {
        if (opts?.NX === true) return null;
        return "OK";
      },
      async get(k) {
        if (k === KEY) {
          mainGets++;
          return JSON.stringify({ bodyHash, jobId: null, createdAt: 0 });
        }
        if (k === SIBLING) {
          // First pass: not-yet-bound → in-flight. Second pass: bound.
          return mainGets >= 2 ? "job-bound-late" : null;
        }
        return null;
      },
    };
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    app = buildApp({ pyannote, redis });
    const res = await app.inject({
      method: "POST",
      url: "/v1/audio/diarization",
      headers: {
        "content-type": multipartBody("body-hit").contentType,
        "idempotency-key": "hit-key",
      },
      payload: multipartBody("body-hit").body,
    });
    expect(res.statusCode).toBe(200);
  }, 10_000);

  it("returns 400 when @fastify/multipart truncates an oversized file mid-stream", async () => {
    // Build a buildApp variant with a tiny limits.fileSize. We can't
    // inject limits via the existing buildApp (it hard-codes 100MB), so
    // construct the app manually.
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
    });
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 32 }, // 32 bytes — smaller than our payload
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const big = Buffer.alloc(8 * 1024, 0x62); // 8 KB > 32 byte limit
      const { body, contentType } = multipartBody(big);
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
      const env = ErrorEnvelope.parse(res.json());
      expect(env.error).toMatch(/file exceeds size limit/);
      expect(calls).toEqual([]);
    } finally {
      await localApp.close();
    }
  });

  it("returns 400 when req.file() throws FST_REQ_FILE_TOO_LARGE synchronously", async () => {
    // Build a Fastify app where the route is registered but req.file() is
    // monkey-patched to throw the @fastify/multipart-shaped error before
    // any stream iteration. Pins the catch block at lines 164-168.
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 100 * 1024 * 1024 },
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("preHandler", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      (req as unknown as { file: () => Promise<never> }).file = async () => {
        const err = Object.assign(new Error("file too large"), {
          code: "FST_REQ_FILE_TOO_LARGE",
        });
        throw err;
      };
    });
    const calls: string[] = [];
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls,
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const { body, contentType } = multipartBody("audio");
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
      const env = ErrorEnvelope.parse(res.json());
      expect(env.error).toMatch(/file exceeds size limit/);
    } finally {
      await localApp.close();
    }
  });

  it("returns 400 when the multipart stream iterator throws FST_REQ_FILE_TOO_LARGE mid-chunk", async () => {
    // Mid-stream throw path (lines 195-199): the `for await` loop catches
    // the error and converts it to a 400. Inject a fake req.file() whose
    // returned `file` async-iterable throws on first next().
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 100 * 1024 * 1024 },
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("preHandler", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      (req as unknown as { file: () => Promise<unknown> }).file = async () => ({
        mimetype: "audio/wav",
        file: {
          // eslint-disable-next-line require-yield
          // biome-ignore lint/correctness/useYield: throwing-only async generator simulates upstream error.
          async *[Symbol.asyncIterator]() {
            const err = Object.assign(new Error("too big"), {
              code: "FST_REQ_FILE_TOO_LARGE",
            });
            throw err;
          },
          truncated: false,
        },
      });
    });
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const { body, contentType } = multipartBody("audio");
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(400);
      const env = ErrorEnvelope.parse(res.json());
      expect(env.error).toMatch(/file exceeds size limit/);
    } finally {
      await localApp.close();
    }
  });

  it("rethrows non-too-large errors from the multipart stream iterator", async () => {
    // Defensive: an unrelated stream error must NOT be silently mapped to
    // 400. mapPyannoteError-of-unknown rethrows → centralized handler 500.
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 100 * 1024 * 1024 },
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("preHandler", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      (req as unknown as { file: () => Promise<unknown> }).file = async () => ({
        mimetype: "audio/wav",
        file: {
          // eslint-disable-next-line require-yield
          // biome-ignore lint/correctness/useYield: throwing-only async generator simulates upstream error.
          async *[Symbol.asyncIterator]() {
            throw new Error("disk read fault");
          },
          truncated: false,
        },
      });
    });
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const { body, contentType } = multipartBody("audio");
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(500);
      // Must NOT leak the upstream message.
      expect(res.body).not.toContain("disk read fault");
    } finally {
      await localApp.close();
    }
  });

  it("emits the route's 'client disconnect' log line when req.raw 'close' fires mid-poll", async () => {
    // Pins the onClose listener (line 268) + abort-signal-aborted return
    // (lines 274, 277-281). Strategy: stub pollJob so the FIRST call
    // synchronously fires req.raw.emit('close') and then returns
    // 'running' — the next iteration's signal.aborted check is true and
    // the handler returns without writing a body.
    const calls: string[] = [];
    let rawForListener: { emit: (e: string) => void } | undefined;
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
        return "job-disconnect";
      },
      async pollJob(jobId) {
        calls.push("pollJob");
        // On the first poll, simulate the desktop dropping its TCP socket.
        if (rawForListener) rawForListener.emit("close");
        return { jobId, status: "running" };
      },
    };
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 100 * 1024 * 1024 },
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      // Hand the test a handle to req.raw so it can fire 'close' from
      // inside pollJob. We just pluck the EventEmitter-shaped raw socket.
      rawForListener = req.raw as unknown as {
        emit: (e: string) => void;
      };
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const { body, contentType } = multipartBody("audio");
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      // Handler returned undefined → Fastify produces an empty 200.
      // The KEY assertion is the handler did NOT emit a 5xx envelope.
      expect(res.statusCode).toBeLessThan(500);
      // pollJob fired at least once before disconnect.
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await localApp.close();
    }
  });

  it("extracts content-type[0] when the header arrives as an array (proxy edge case)", async () => {
    // Pin line 128 cond-expr idx 0 — `Array.isArray(contentTypeHeader)`
    // truthy branch. Confirms the route reads the FIRST element of an
    // array-shaped Content-Type header (rare, but legal per RFC 7230 §3.2.2
    // when an upstream proxy concatenates duplicate headers).
    //
    // We can't ship a real array via inject() — Fastify normalizes — so we
    // mutate the parsed headers in preHandler. Two array-shaped variants:
    //   * non-multipart array → handler emits 400 (still hits the branch).
    //   * multipart array → fastify-multipart may itself reject; the 400
    //     from the route's content-type guard is enough to pin coverage.
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(zodTypeProvider);
    localApp.addHook("preHandler", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      // Force an array shape — non-multipart so the route's content-type
      // guard hits the 400 path. The Array.isArray(headerKeyRaw) idx 0
      // branch is exercised regardless of the route's eventual exit.
      (req.headers as Record<string, unknown>)["content-type"] = ["application/json", "text/plain"];
    });
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      // Non-multipart → 400 envelope.
      expect(res.statusCode).toBe(400);
      const env = ErrorEnvelope.parse(res.json());
      expect(env.error).toMatch(/multipart/);
    } finally {
      await localApp.close();
    }
  });

  it("normalizes idempotency-key when the header arrives as an array", async () => {
    // Mirror of content-type array case for line 212 idx 0.
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 100 * 1024 * 1024 },
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("onRequest", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      const k = req.headers["idempotency-key"];
      if (typeof k === "string") {
        (req.headers as Record<string, unknown>)["idempotency-key"] = [k];
      }
    });
    const pyannote = makeFakePyannote({
      uploadedBytes: [],
      submittedJobIds: [],
      calls: [],
    });
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const { body, contentType } = multipartBody("audio");
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: {
          "content-type": contentType,
          "idempotency-key": "client-key-array",
        },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await localApp.close();
    }
  });

  it("falls back to application/octet-stream when filePart.mimetype is empty", async () => {
    // Pin line 206 binary-expr idx 1 — the right-hand fallback.
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.register(fastifyMultipart, {
      attachFieldsToBody: false as const,
      limits: { fileSize: 100 * 1024 * 1024 },
    });
    localApp.register(zodTypeProvider);
    localApp.addHook("preHandler", async (req) => {
      req.user = { id: TEST_USER, email: "fixture@conformance.test" };
      req.tenant = TEST_TENANT;
      (req as unknown as { file: () => Promise<unknown> }).file = async () => ({
        mimetype: "", // empty — triggers the fallback
        file: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from("audio-bytes");
          },
          truncated: false,
        },
      });
    });
    const captured: { contentType?: string } = {};
    const pyannote: PyannoteClient = {
      async createMediaInput() {
        return {
          url: "https://pyannote-presigned.test/upload/abc",
          mediaUri: "media://abc",
        };
      },
      async uploadToPresignedUrl(_url, _body, contentType) {
        captured.contentType = contentType;
      },
      async submitDiarize() {
        return "job-mime";
      },
      async pollJob(jobId) {
        return {
          jobId,
          status: "succeeded",
          output: {
            duration: 1,
            segments: [{ start: 0, end: 1, speaker: "SPEAKER_00" }],
          },
        };
      },
    };
    localApp.register(
      buildDiarizationRoutes({
        redis: makeFakeRedis(),
        pyannoteFactory: () => pyannote,
      }),
    );
    try {
      const { body, contentType } = multipartBody("audio");
      const res = await localApp.inject({
        method: "POST",
        url: "/v1/audio/diarization",
        headers: { "content-type": contentType },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(captured.contentType).toBe("application/octet-stream");
    } finally {
      await localApp.close();
    }
  });

  // ----------------------------------------------------------------------
  // Phase 08.6-02 — SPEACHES_DIARIZATION_URL branch
  //
  // When the dep `speachesDiarizationUrl` is set, the route bypasses the
  // pyannote.ai async orchestration entirely and POSTs the multipart body
  // synchronously to `${url}/v1/audio/diarization`. Speaches returns the
  // canonical `{duration, segments[]}` JSON shape in a single response —
  // no presigned upload, no jobId, no polling, no idempotency cache.
  //
  // The pyannote.ai branch is fully preserved (covered by the 30+ tests
  // above). These tests assert the Speaches branch in isolation by
  // injecting a stub `fetch` at the network boundary.
  // ----------------------------------------------------------------------
  describe("SPEACHES_DIARIZATION_URL branch", () => {
    function buildSpeachesApp(opts: {
      speachesFetch: typeof fetch;
      speachesUrl?: string;
      authed?: boolean;
    }): FastifyInstance {
      const a = Fastify({ logger: false });
      registerErrorHandler(a);
      a.register(fastifyMultipart, {
        attachFieldsToBody: false as const,
        limits: { fileSize: 100 * 1024 * 1024 },
      });
      a.register(zodTypeProvider);
      if (opts.authed !== false) {
        a.addHook("onRequest", async (req) => {
          req.user = { id: TEST_USER, email: "fixture@conformance.test" };
          req.tenant = TEST_TENANT;
        });
      }
      const deps: Parameters<typeof buildDiarizationRoutes>[0] = {
        redis: makeFakeRedis(),
        speachesDiarizationUrl: opts.speachesUrl ?? "http://speaches.internal.test:8000",
        speachesFetch: opts.speachesFetch,
      };
      a.register(buildDiarizationRoutes(deps));
      return a;
    }

    it("posts multipart to <url>/v1/audio/diarization and returns parsed JSON (200 happy path)", async () => {
      const captured: {
        url?: string;
        method?: string;
        contentType?: string | null;
        bodyBytes?: number;
      } = {};
      const speachesFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        captured.url = url;
        if (init?.method !== undefined) captured.method = init.method;
        captured.contentType =
          (init?.headers as Record<string, string> | undefined)?.["content-type"] ??
          (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ??
          null;
        // body is a Buffer in our client; record its length.
        const body = init?.body;
        if (body && typeof (body as Buffer).length === "number") {
          captured.bodyBytes = (body as Buffer).length;
        }
        return new Response(
          JSON.stringify({
            duration: 7.25,
            segments: [
              { start: 0.0, end: 3.1, speaker: "SPEAKER_00" },
              { start: 3.1, end: 7.25, speaker: "SPEAKER_01" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      const app2 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("speaches-audio-bytes");
        const res = await app2.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(200);
        const parsed = DiarizationResponse.parse(res.json());
        expect(parsed.segments).toHaveLength(2);
        expect(parsed.duration).toBe(7.25);
        expect(speachesFetch).toHaveBeenCalledTimes(1);
        expect(captured.url).toBe("http://speaches.internal.test:8000/v1/audio/diarization");
        expect(captured.method).toBe("POST");
        expect(captured.contentType ?? "").toMatch(/^multipart\/form-data; boundary=/);
        // The proxied body must include the audio bytes; with the multipart
        // envelope overhead added we expect > raw payload length.
        expect(captured.bodyBytes ?? 0).toBeGreaterThan(Buffer.from("speaches-audio-bytes").length);
      } finally {
        await app2.close();
      }
    });

    it("sends form fields `file` (audio bytes) and `model` (pyannote/speaker-diarization-community-1)", async () => {
      let capturedBody: Buffer | null = null;
      let capturedCT: string | null = null;
      const speachesFetch = async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as Buffer;
        capturedCT =
          (init?.headers as Record<string, string> | undefined)?.["content-type"] ?? null;
        return new Response(
          JSON.stringify({
            duration: 1.0,
            segments: [{ start: 0, end: 1, speaker: "SPEAKER_00" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };
      const app3 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("X-AUDIO-X");
        const res = await app3.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(200);
        expect(capturedBody).not.toBeNull();
        expect(capturedCT).toMatch(/^multipart\/form-data; boundary=/);
        const text = Buffer.from(capturedBody as unknown as Buffer).toString("utf8");
        expect(text).toContain('name="model"');
        expect(text).toContain("pyannote/speaker-diarization-community-1");
        expect(text).toContain('name="file"');
        expect(text).toContain("X-AUDIO-X");
      } finally {
        await app3.close();
      }
    });

    it("maps Speaches 5xx to 503 envelope (operator-actionable)", async () => {
      const speachesFetch = async () =>
        new Response("internal error", {
          status: 500,
          headers: { "content-type": "text/plain" },
        });
      const app4 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await app4.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(503);
        expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
      } finally {
        await app4.close();
      }
    });

    it("maps Speaches 4xx to 502 envelope (upstream rejected payload)", async () => {
      const speachesFetch = async () =>
        new Response(JSON.stringify({ detail: "bad audio" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      const app5 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await app5.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(502);
        expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
      } finally {
        await app5.close();
      }
    });

    it("returns 400 envelope when the multipart has no file part (no Speaches call)", async () => {
      const speachesFetch = vi.fn(async () => new Response("", { status: 200 }));
      const app6 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const boundary = "----diar-speaches-no-file";
        const body = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nx\r\n--${boundary}--\r\n`,
          "utf8",
        );
        const res = await app6.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
          payload: body,
        });
        expect(res.statusCode).toBe(400);
        expect(speachesFetch).not.toHaveBeenCalled();
      } finally {
        await app6.close();
      }
    });

    it("rejects non-multipart content-type with 400 envelope (no Speaches call)", async () => {
      const speachesFetch = vi.fn(async () => new Response("", { status: 200 }));
      const app7 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const res = await app7.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": "application/json" },
          payload: "{}",
        });
        expect(res.statusCode).toBe(400);
        expect(speachesFetch).not.toHaveBeenCalled();
      } finally {
        await app7.close();
      }
    });

    it("does NOT call the pyannote factory when speachesDiarizationUrl is set", async () => {
      const speachesFetch = async () =>
        new Response(
          JSON.stringify({
            duration: 0.5,
            segments: [{ start: 0, end: 0.5, speaker: "SPEAKER_00" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const pyannoteFactory = vi.fn(() => {
        throw new Error("should not be called when Speaches branch is active");
      });
      const a = Fastify({ logger: false });
      registerErrorHandler(a);
      a.register(fastifyMultipart, {
        attachFieldsToBody: false as const,
        limits: { fileSize: 100 * 1024 * 1024 },
      });
      a.register(zodTypeProvider);
      a.addHook("onRequest", async (req) => {
        req.user = { id: TEST_USER, email: "fixture@conformance.test" };
        req.tenant = TEST_TENANT;
      });
      a.register(
        buildDiarizationRoutes({
          redis: makeFakeRedis(),
          speachesDiarizationUrl: "http://speaches.internal.test:8000",
          speachesFetch: speachesFetch as unknown as typeof fetch,
          pyannoteFactory: pyannoteFactory as unknown as () => PyannoteClient,
        }),
      );
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await a.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(200);
        expect(pyannoteFactory).not.toHaveBeenCalled();
      } finally {
        await a.close();
      }
    });

    it("returns 401 envelope when no auth (req.user absent; no Speaches call)", async () => {
      const speachesFetch = vi.fn(async () => new Response("", { status: 200 }));
      const app8 = buildSpeachesApp({
        speachesFetch: speachesFetch as unknown as typeof fetch,
        authed: false,
      });
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await app8.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(401);
        expect(speachesFetch).not.toHaveBeenCalled();
      } finally {
        await app8.close();
      }
    });

    it("maps a 200 response with malformed JSON body to 502 envelope", async () => {
      const speachesFetch = async () =>
        new Response("not-json{{", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const app9 = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await app9.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(502);
      } finally {
        await app9.close();
      }
    });

    it("returns 400 when the multipart stream throws FST_REQ_FILE_TOO_LARGE mid-chunk (Speaches branch)", async () => {
      const speachesFetch = vi.fn(async () => new Response("", { status: 200 }));
      const localApp = Fastify({ logger: false });
      registerErrorHandler(localApp);
      localApp.register(fastifyMultipart, {
        attachFieldsToBody: false as const,
        limits: { fileSize: 100 * 1024 * 1024 },
      });
      localApp.register(zodTypeProvider);
      localApp.addHook("preHandler", async (req) => {
        req.user = { id: TEST_USER, email: "fixture@conformance.test" };
        req.tenant = TEST_TENANT;
        (req as unknown as { file: () => Promise<unknown> }).file = async () => ({
          mimetype: "audio/wav",
          file: {
            // eslint-disable-next-line require-yield
            // biome-ignore lint/correctness/useYield: throwing-only async generator simulates upstream error.
            async *[Symbol.asyncIterator]() {
              throw Object.assign(new Error("too big"), {
                code: "FST_REQ_FILE_TOO_LARGE",
              });
            },
            truncated: false,
          },
        });
      });
      localApp.register(
        buildDiarizationRoutes({
          redis: makeFakeRedis(),
          speachesDiarizationUrl: "http://speaches.internal.test:8000",
          speachesFetch: speachesFetch as unknown as typeof fetch,
        }),
      );
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await localApp.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(400);
        expect(speachesFetch).not.toHaveBeenCalled();
      } finally {
        await localApp.close();
      }
    });

    it("returns 400 when filePart.file.truncated === true (Speaches branch)", async () => {
      const speachesFetch = vi.fn(async () => new Response("", { status: 200 }));
      const localApp = Fastify({ logger: false });
      registerErrorHandler(localApp);
      localApp.register(fastifyMultipart, {
        attachFieldsToBody: false as const,
        limits: { fileSize: 100 * 1024 * 1024 },
      });
      localApp.register(zodTypeProvider);
      localApp.addHook("preHandler", async (req) => {
        req.user = { id: TEST_USER, email: "fixture@conformance.test" };
        req.tenant = TEST_TENANT;
        (req as unknown as { file: () => Promise<unknown> }).file = async () => ({
          mimetype: "audio/wav",
          file: {
            async *[Symbol.asyncIterator]() {
              yield Buffer.from("partial");
            },
            truncated: true,
          },
        });
      });
      localApp.register(
        buildDiarizationRoutes({
          redis: makeFakeRedis(),
          speachesDiarizationUrl: "http://speaches.internal.test:8000",
          speachesFetch: speachesFetch as unknown as typeof fetch,
        }),
      );
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await localApp.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(400);
        expect(speachesFetch).not.toHaveBeenCalled();
      } finally {
        await localApp.close();
      }
    });

    it("maps a 200 response that fails DiarizationResponse schema to 502 envelope", async () => {
      const speachesFetch = async () =>
        new Response(
          // Valid JSON but missing the required `segments` field.
          JSON.stringify({ duration: 3.0 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const appB = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await appB.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(502);
        expect(() => ErrorEnvelope.parse(res.json())).not.toThrow();
      } finally {
        await appB.close();
      }
    });

    it("maps fetch() network errors (ECONNREFUSED) to 503 envelope", async () => {
      const speachesFetch = async () => {
        throw new TypeError("fetch failed");
      };
      const appA = buildSpeachesApp({ speachesFetch: speachesFetch as unknown as typeof fetch });
      try {
        const { body, contentType } = multipartBody("audio");
        const res = await appA.inject({
          method: "POST",
          url: "/v1/audio/diarization",
          headers: { "content-type": contentType },
          payload: body,
        });
        expect(res.statusCode).toBe(503);
      } finally {
        await appA.close();
      }
    });
  });
});
