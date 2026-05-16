// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 06 / Task 1 — pyannote-client.ts tests.
//
// Strategy: undici MockAgent intercepts every pyannote.ai endpoint so we
// exercise the real undici call surface (no fetch shim, no http.request
// stubbing). Each test pins a single behavior listed in the plan.
//
// Coverage matrix:
//   * createMediaInput — auth header + JSON body + URL extraction.
//   * uploadToPresignedUrl — PUT body forwarded; non-2xx → PyannoteUpstreamError.
//   * submitDiarize — POST {url: mediaUri} + jobId extraction.
//   * pollJob — GET /v1/jobs/{jobId} returns full payload; AbortSignal honored.
//   * Missing PYANNOTE_API_KEY → MissingPyannoteKeyError before any HTTP call.
//   * Status classification: 401/403 → PyannoteAuthError; 5xx → PyannoteUnavailableError;
//     other 4xx → PyannoteBadRequestError.

import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPyannoteClient,
  MissingPyannoteKeyError,
  PyannoteAuthError,
  PyannoteBadRequestError,
  type PyannoteJob,
  PyannoteUnavailableError,
  PyannoteUpstreamError,
} from "../../../../src/lib/pyannote-client.js";

const PYANNOTE_BASE = "https://api.pyannote.ai";

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent({ connections: 1 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  vi.restoreAllMocks();
});

describe("createPyannoteClient — factory", () => {
  it("throws MissingPyannoteKeyError when PYANNOTE_API_KEY is unset and no apiKey opt", () => {
    const previous = process.env.PYANNOTE_API_KEY;
    delete process.env.PYANNOTE_API_KEY;
    try {
      expect(() => createPyannoteClient()).toThrow(MissingPyannoteKeyError);
    } finally {
      if (previous !== undefined) process.env.PYANNOTE_API_KEY = previous;
    }
  });

  it("throws MissingPyannoteKeyError when apiKey is empty string", () => {
    expect(() => createPyannoteClient({ apiKey: "" })).toThrow(MissingPyannoteKeyError);
  });

  it("constructs successfully when apiKey is provided", () => {
    expect(() => createPyannoteClient({ apiKey: "test-key" })).not.toThrow();
  });

  it("MissingPyannoteKeyError carries operator-actionable message", () => {
    try {
      createPyannoteClient({ apiKey: "" });
    } catch (err) {
      expect(err).toBeInstanceOf(MissingPyannoteKeyError);
      expect((err as Error).message).toMatch(/PYANNOTE_API_KEY/);
      expect((err as Error).message).toMatch(/\.env|LITELLM_BASE_URL/);
    }
  });
});

describe("createMediaInput", () => {
  it("POSTs /v1/media/input with bearer auth + JSON body and returns {url, mediaUri}", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedMethod: string | undefined;
    let capturedPath: string | undefined;
    let capturedBody: string | undefined;
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply((opts) => {
        capturedHeaders = opts.headers as Record<string, string>;
        capturedMethod = opts.method;
        capturedPath = opts.path;
        capturedBody = String(opts.body);
        return {
          statusCode: 201,
          data: {
            url: "https://pyannote-presigned.example.com/abc/uploads/key-12345?sig=x",
          },
          responseOptions: {
            headers: { "content-type": "application/json" },
          },
        };
      });

    const client = createPyannoteClient({ apiKey: "test-key" });
    const result = await client.createMediaInput();

    expect(capturedPath).toBe("/v1/media/input");
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders.authorization).toBe("Bearer test-key");
    expect(capturedHeaders["content-type"]).toBe("application/json");
    expect(capturedBody).toBe("{}");
    expect(result.url).toBe("https://pyannote-presigned.example.com/abc/uploads/key-12345?sig=x");
    expect(result.mediaUri).toBe("media://key-12345");
  });

  it("prefers explicit mediaUri field when pyannote returns one", async () => {
    agent.get(PYANNOTE_BASE).intercept({ path: "/v1/media/input", method: "POST" }).reply(201, {
      url: "https://pyannote-presigned.example.com/abc/uploads/key-X?sig=y",
      mediaUri: "media://explicit-key",
    });
    const client = createPyannoteClient({ apiKey: "k" });
    const r = await client.createMediaInput();
    expect(r.mediaUri).toBe("media://explicit-key");
  });

  it("throws PyannoteAuthError on 401", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply(401, { error: "invalid_key" });
    const client = createPyannoteClient({ apiKey: "bad" });
    await expect(client.createMediaInput()).rejects.toBeInstanceOf(PyannoteAuthError);
  });

  it("throws PyannoteAuthError on 403", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply(403, { error: "forbidden" });
    const client = createPyannoteClient({ apiKey: "bad" });
    await expect(client.createMediaInput()).rejects.toBeInstanceOf(PyannoteAuthError);
  });

  it("throws PyannoteUnavailableError on 503", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply(503, "upstream busy");
    const client = createPyannoteClient({ apiKey: "k" });
    await expect(client.createMediaInput()).rejects.toBeInstanceOf(PyannoteUnavailableError);
  });

  it("throws PyannoteBadRequestError on 422", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply(422, { error: "invalid payload" });
    const client = createPyannoteClient({ apiKey: "k" });
    await expect(client.createMediaInput()).rejects.toBeInstanceOf(PyannoteBadRequestError);
  });

  it("WR-04: PyannoteBadRequestError.message does NOT include upstream body (body parked on .bodyText)", async () => {
    const SECRET_BODY = '{"error":"Authorization header malformed: sk-leak-1234"}';
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply(400, SECRET_BODY);
    const client = createPyannoteClient({ apiKey: "k" });
    try {
      await client.createMediaInput();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PyannoteBadRequestError);
      const e = err as PyannoteBadRequestError;
      // .message is generic — safe to log via err.message.
      expect(e.message).toBe("pyannote 400");
      expect(e.message).not.toContain("sk-leak-1234");
      expect(e.message).not.toContain("Authorization");
      // Phase 37 / CR-9 sibling: bodyText is now private + non-enumerable
      // (was leaking via pino's `err` serializer); JSON.stringify of the
      // error must NOT echo the upstream secret-shaped payload.
      expect(JSON.stringify(e)).not.toContain("sk-leak-1234");
      expect(Object.keys(e)).not.toContain("bodyText");
    }
  });

  it("WR-04: PyannoteUpstreamError.message does NOT include upstream body (body parked on .bodyText)", async () => {
    const PRESIGNED_HOST = "https://pyannote-uploads.example.com";
    const LEAKY_BODY = "<xml>signature: sig-secret-deadbeef</xml>";
    agent
      .get(PRESIGNED_HOST)
      .intercept({ path: "/leak-key", method: "PUT" })
      .reply(403, LEAKY_BODY);
    const client = createPyannoteClient({ apiKey: "k" });
    try {
      await client.uploadToPresignedUrl(
        `${PRESIGNED_HOST}/leak-key`,
        Buffer.from("x"),
        "audio/wav",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PyannoteUpstreamError);
      const e = err as PyannoteUpstreamError;
      expect(e.message).toBe("pyannote 403");
      expect(e.message).not.toContain("sig-secret");
      // Phase 37 / CR-9 sibling: bodyText is now private + non-enumerable.
      expect(JSON.stringify(e)).not.toContain("sig-secret");
      expect(Object.keys(e)).not.toContain("bodyText");
    }
  });
});

describe("uploadToPresignedUrl", () => {
  const PRESIGNED_HOST = "https://pyannote-uploads.example.com";

  it("PUTs binary body with provided content-type; resolves on 200", async () => {
    let capturedMethod: string | undefined;
    let capturedHeaders: Record<string, string> = {};
    agent
      .get(PRESIGNED_HOST)
      .intercept({ path: "/key-XYZ", method: "PUT" })
      .reply((opts) => {
        capturedMethod = opts.method;
        capturedHeaders = opts.headers as Record<string, string>;
        return { statusCode: 200, data: "" };
      });

    const client = createPyannoteClient({ apiKey: "k" });
    const buf = Buffer.from("audio-bytes");
    await expect(
      client.uploadToPresignedUrl(`${PRESIGNED_HOST}/key-XYZ`, buf, "audio/wav"),
    ).resolves.toBeUndefined();

    expect(capturedMethod).toBe("PUT");
    expect(capturedHeaders["content-type"]).toBe("audio/wav");
    // Auth header MUST NOT appear on presigned URL — pre-signed PUT is
    // pre-authenticated via signature; sending Authorization can break the
    // upload depending on the storage backend.
    expect(capturedHeaders.authorization).toBeUndefined();
  });

  it("rejects with PyannoteUpstreamError on non-2xx", async () => {
    agent
      .get(PRESIGNED_HOST)
      .intercept({ path: "/expired-key", method: "PUT" })
      .reply(403, "expired signature");

    const client = createPyannoteClient({ apiKey: "k" });
    await expect(
      client.uploadToPresignedUrl(`${PRESIGNED_HOST}/expired-key`, Buffer.from("x"), "audio/wav"),
    ).rejects.toBeInstanceOf(PyannoteUpstreamError);
  });
});

describe("submitDiarize", () => {
  it("POSTs /v1/diarize with {url: mediaUri} and returns jobId", async () => {
    let capturedBody: string | undefined;
    let capturedHeaders: Record<string, string> = {};
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/diarize", method: "POST" })
      .reply((opts) => {
        capturedBody = String(opts.body);
        capturedHeaders = opts.headers as Record<string, string>;
        return {
          statusCode: 201,
          data: { jobId: "job-abc-123", status: "created" },
          responseOptions: {
            headers: { "content-type": "application/json" },
          },
        };
      });

    const client = createPyannoteClient({ apiKey: "k" });
    const jobId = await client.submitDiarize("media://key-12345");
    expect(jobId).toBe("job-abc-123");
    expect(JSON.parse(capturedBody ?? "{}")).toEqual({
      url: "media://key-12345",
    });
    expect(capturedHeaders.authorization).toBe("Bearer k");
    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  it("throws PyannoteAuthError on 401", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/diarize", method: "POST" })
      .reply(401, { error: "bad-key" });
    const client = createPyannoteClient({ apiKey: "bad" });
    await expect(client.submitDiarize("media://x")).rejects.toBeInstanceOf(PyannoteAuthError);
  });

  it("throws PyannoteUnavailableError on 502", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/diarize", method: "POST" })
      .reply(502, "bad gateway");
    const client = createPyannoteClient({ apiKey: "k" });
    await expect(client.submitDiarize("media://x")).rejects.toBeInstanceOf(
      PyannoteUnavailableError,
    );
  });
});

describe("pollJob", () => {
  it("GETs /v1/jobs/{jobId} with bearer auth and returns full payload", async () => {
    let capturedMethod: string | undefined;
    let capturedHeaders: Record<string, string> = {};
    let capturedPath: string | undefined;
    const payload: PyannoteJob = {
      jobId: "job-1",
      status: "succeeded",
      output: {
        duration: 12.5,
        segments: [
          { start: 0.0, end: 5.0, speaker: "SPEAKER_00" },
          { start: 5.0, end: 12.5, speaker: "SPEAKER_01" },
        ],
      },
    };
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/jobs/job-1", method: "GET" })
      .reply((opts) => {
        capturedMethod = opts.method;
        capturedHeaders = opts.headers as Record<string, string>;
        capturedPath = opts.path;
        return {
          statusCode: 200,
          data: payload,
          responseOptions: {
            headers: { "content-type": "application/json" },
          },
        };
      });

    const client = createPyannoteClient({ apiKey: "k" });
    const job = await client.pollJob("job-1");

    expect(capturedMethod).toBe("GET");
    expect(capturedPath).toBe("/v1/jobs/job-1");
    expect(capturedHeaders.authorization).toBe("Bearer k");
    expect(job.status).toBe("succeeded");
    expect(job.output?.duration).toBe(12.5);
    expect(job.output?.segments).toHaveLength(2);
  });

  it("throws AbortError synchronously when signal is already aborted (no HTTP call)", async () => {
    // Intentionally do NOT register an interceptor — if a HTTP call is
    // made, MockAgent will reject with a connect error and the assertion
    // shape would be wrong.
    const client = createPyannoteClient({ apiKey: "k" });
    const ac = new AbortController();
    ac.abort();
    await expect(client.pollJob("job-1", ac.signal)).rejects.toThrow(/abort/i);
  });

  it("returns running status without output", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/jobs/job-running", method: "GET" })
      .reply(200, { jobId: "job-running", status: "running" });
    const client = createPyannoteClient({ apiKey: "k" });
    const job = await client.pollJob("job-running");
    expect(job.status).toBe("running");
    expect(job.output).toBeUndefined();
  });

  it("returns failed status (caller maps to 502)", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/jobs/job-failed", method: "GET" })
      .reply(200, { jobId: "job-failed", status: "failed" });
    const client = createPyannoteClient({ apiKey: "k" });
    const job = await client.pollJob("job-failed");
    expect(job.status).toBe("failed");
  });

  it("encodes jobId path component to defend against path traversal", async () => {
    let capturedPath: string | undefined;
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: /^\/v1\/jobs\// })
      .reply((opts) => {
        capturedPath = opts.path;
        return { statusCode: 200, data: { jobId: "x", status: "running" } };
      });
    const client = createPyannoteClient({ apiKey: "k" });
    await client.pollJob("../escape/attempt");
    expect(capturedPath).toBe(`/v1/jobs/${encodeURIComponent("../escape/attempt")}`);
  });

  it("throws PyannoteUnavailableError on 504", async () => {
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/jobs/job-x", method: "GET" })
      .reply(504, "gateway timeout");
    const client = createPyannoteClient({ apiKey: "k" });
    await expect(client.pollJob("job-x")).rejects.toBeInstanceOf(PyannoteUnavailableError);
  });
});

// ----- Stage B back-fill — close residual gaps to 90/90/90/90 ------------

describe("PyannoteAuthError / PyannoteUnavailableError default messages", () => {
  it("PyannoteAuthError uses fallback message when none provided", () => {
    const err = new PyannoteAuthError(401);
    expect(err.message).toMatch(/pyannote auth failed \(401\)/);
  });

  it("PyannoteUnavailableError uses fallback message when none provided", () => {
    const err = new PyannoteUnavailableError(503);
    expect(err.message).toMatch(/pyannote unavailable \(503\)/);
  });
});

describe("classify() unknown-status fallthrough", () => {
  it("emits PyannoteUpstreamError for non-2xx, non-4xx, non-5xx (e.g. 300-class redirects)", async () => {
    // pyannote.ai shouldn't return 3xx in practice, but the route's
    // classify() has a fallthrough for "anything else >= 300 and < 400"
    // → PyannoteUpstreamError. Pinning prevents a future refactor from
    // silently turning a redirect into a 200.
    agent
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply(308, "redirect to /v2/media/input");
    const client = createPyannoteClient({ apiKey: "k" });
    await expect(client.createMediaInput()).rejects.toBeInstanceOf(PyannoteUpstreamError);
  });
});

describe("deriveMediaUri edge cases", () => {
  it("falls back to media://unknown when presigned URL has no path segments", async () => {
    agent.get(PYANNOTE_BASE).intercept({ path: "/v1/media/input", method: "POST" }).reply(201, {
      url: "https://pyannote-presigned.example.com/", // no segments
    });
    const client = createPyannoteClient({ apiKey: "k" });
    const r = await client.createMediaInput();
    expect(r.mediaUri).toBe("media://unknown");
  });

  it("falls back to media://unknown when the URL is not parseable", async () => {
    agent.get(PYANNOTE_BASE).intercept({ path: "/v1/media/input", method: "POST" }).reply(201, {
      url: "this-is-not-a-url",
    });
    const client = createPyannoteClient({ apiKey: "k" });
    const r = await client.createMediaInput();
    expect(r.mediaUri).toBe("media://unknown");
  });
});

describe("dispatcher option", () => {
  it("forwards a custom dispatcher into every undici request", async () => {
    // We can't easily observe whether opts.dispatcher reached undici without
    // intercepting at the request level, but the easiest way to pin the
    // four `if (opts.dispatcher)` branches (lines 184, 207, 234, 254) is to
    // construct the client with `dispatcher: agent` (which is itself a
    // valid Dispatcher) and run all four method paths end-to-end. The
    // global dispatcher is unset for this test so the only way the
    // requests can succeed is via the explicit dispatcher.
    setGlobalDispatcher(
      new MockAgent({ connections: 1 }), // unused empty pool
    );
    const explicit = new MockAgent({ connections: 1 });
    explicit.disableNetConnect();
    explicit.get(PYANNOTE_BASE).intercept({ path: "/v1/media/input", method: "POST" }).reply(201, {
      url: "https://pyannote-presigned.example.com/abc/uploads/k1?sig=x",
    });
    explicit
      .get("https://pyannote-presigned.example.com")
      .intercept({ path: /^\/abc\/uploads\/k1/, method: "PUT" })
      .reply(200, "");
    explicit
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/diarize", method: "POST" })
      .reply(201, { jobId: "job-d" });
    explicit
      .get(PYANNOTE_BASE)
      .intercept({ path: "/v1/jobs/job-d", method: "GET" })
      .reply(200, { jobId: "job-d", status: "running" });

    const client = createPyannoteClient({
      apiKey: "k",
      dispatcher: explicit,
    });
    const m = await client.createMediaInput();
    expect(m.mediaUri).toMatch(/^media:\/\//);
    await client.uploadToPresignedUrl(
      "https://pyannote-presigned.example.com/abc/uploads/k1?sig=x",
      Buffer.from("x"),
      "audio/wav",
    );
    const jid = await client.submitDiarize("media://k1");
    expect(jid).toBe("job-d");
    const job = await client.pollJob(jid);
    expect(job.status).toBe("running");

    await explicit.close();
    // Restore the per-test agent so afterEach can close it cleanly.
    setGlobalDispatcher(agent);
  });
});

describe("baseUrl override", () => {
  it("respects custom baseUrl (corporate-override mode is route-side, but factory accepts)", async () => {
    const CUSTOM = "https://pyannote.internal.corp.example";
    let capturedPath: string | undefined;
    agent
      .get(CUSTOM)
      .intercept({ path: "/v1/media/input", method: "POST" })
      .reply((opts) => {
        capturedPath = opts.path;
        return {
          statusCode: 201,
          data: { url: `${CUSTOM}/uploads/abc?sig=x` },
        };
      });
    const client = createPyannoteClient({ apiKey: "k", baseUrl: CUSTOM });
    const r = await client.createMediaInput();
    expect(capturedPath).toBe("/v1/media/input");
    expect(r.url).toContain(CUSTOM);
  });
});
