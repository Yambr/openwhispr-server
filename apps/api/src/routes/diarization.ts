// Phase 03 / Plan 06 / Task 3 — POST /v1/audio/diarization (D-07 REVISED).
//
// Wire shape: docs/wire-contracts-phase-3.md "Diarization" — the desktop
// (and Speaches-compatible callers) expect a SYNC response:
//
//   POST /v1/audio/diarization (multipart/form-data, file=<audio>)
//   → 200 {duration, segments: [{start, end, speaker}, ...]}
//
// Backend reality (D-07 REVISED, 2026-05-10): pyannote.ai is async. This
// route is a Fastify SYNC-WRAPPER that orchestrates the 4-step async flow
// server-side and returns when the job succeeds (or 504 at the 5min ceiling):
//
//   1. POST /v1/media/input         → presigned PUT URL + media:// URI
//   2. PUT  <presigned URL>         → upload audio bytes
//   3. POST /v1/diarize {url}       → submit job, get jobId
//   4. GET  /v1/jobs/{jobId} (×N)   → poll @ 1500ms until succeeded/failed
//
// LiteLLM is NOT in the pass-through path (single-hop pass_through_endpoints
// cannot drive the 4-step flow). PYANNOTE_API_KEY is consumed by THIS Fastify
// route directly via apps/api/src/lib/pyannote-client.ts.
//
// Stripe-style idempotency (apps/api/src/lib/idempotency-cache.ts):
// Idempotency-Key header → fallback to SHA-256(file). 24h TTL in Valkey.
// Same key + same body = retry hits cached jobId. Same key + different body
// = 409 (T-03-06-03 mitigation).
//
// Status code matrix:
//   200 — succeeded (DiarizationResponse from pyannote output)
//   400 — non-multipart content-type | missing `file` field | over file-size limit
//   401 — no auth (defensive; dualAuthHook enforces)
//   409 — Idempotency-Key conflict (Stripe)
//   502 — pyannote job 'failed' or 'cancelled' | upstream rejected payload (4xx)
//   503 — PYANNOTE_API_KEY unset | pyannote 5xx | pyannote auth error (Pitfall #8)
//   504 — 5-minute polling ceiling exceeded (jobId returned for resume hint)
//
// LITELLM-07 acknowledged: NO usage_ledger row is written for diarization.
// pyannote billing is unmetered in v1 (documented in 03-06-PLAN.md threat
// register — accepted disposition; v2 may add nginx-log-based metering).

import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { DiarizationResponse } from "@openwhispr/contract-tests/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ServiceUnavailable } from "../errors.js";
import {
  createIdempotencyCache,
  type IdempotencyCache,
  type RedisLike,
} from "../lib/idempotency-cache.js";
import {
  createPyannoteClient,
  MissingPyannoteKeyError,
  PyannoteAuthError,
  PyannoteBadRequestError,
  type PyannoteClient,
  type PyannoteJob,
  PyannoteUnavailableError,
  PyannoteUpstreamError,
} from "../lib/pyannote-client.js";

/** Polling cadence — 1500ms is the smallest interval that pyannote.ai's
 * status endpoint can sustain without rate-limiting at 1000 concurrent jobs. */
export const POLL_INTERVAL_MS = 1_500;

/** Hard ceiling — 5 minutes. Beyond this we 504 with the jobId so the
 * caller can resume polling itself if it really needs to (rare). */
export const POLL_CEILING_MS = 300_000;

/** Mount path locked by docs/wire-contracts-phase-3.md (Plan 01 D-09). */
export const DIARIZATION_MOUNT_PATH = "/v1/audio/diarization";

/** MOCK_DIARIZATION fixture response — contract-test profile only. */
const MOCK_RESPONSE = {
  duration: 5.0,
  segments: [{ start: 0.0, end: 5.0, speaker: "SPEAKER_00" }],
};

export interface DiarizationDeps {
  /**
   * Pre-connected Valkey client (matches @redis/client surface used by
   * apps/api/src/plugins/rate-limit.ts). Production wires the same
   * client; tests inject a fake RedisLike.
   */
  redis: RedisLike;
  /**
   * MOCK_DIARIZATION=true short-circuits the route to a fixture response
   * without calling pyannote. CI / contract-test profile sets this so
   * `make contract-test` runs hermetically.
   */
  mockMode?: boolean;
  /**
   * Test seam — inject a stub PyannoteClient. Production omits this and
   * the route lazy-creates a client per request (cheap; the underlying
   * undici pool is global). Lazy-creation also lets the
   * MissingPyannoteKeyError fast-path fire from inside the handler so the
   * route's 503 surface includes the operator-actionable message.
   */
  pyannoteFactory?: () => PyannoteClient;
  /**
   * Phase 08.6-02 — Speaches local diarization base URL (e.g.
   * `http://speaches:8000`). When SET, the route bypasses the
   * pyannote.ai async orchestration entirely and POSTs the multipart
   * `file` + `model` form synchronously to
   * `${speachesDiarizationUrl}/v1/audio/diarization`. Speaches returns
   * the canonical `{duration, segments[]}` JSON in a single response —
   * no presigned upload, no jobId, no polling, no idempotency cache.
   *
   * Wired from process.env.SPEACHES_DIARIZATION_URL in apps/api/src/index.ts
   * for the load-test-realistic profile. When UNSET, the legacy pyannote.ai
   * branch is used unchanged (production default in v1).
   */
  speachesDiarizationUrl?: string;
  /**
   * Test seam — inject a custom `fetch` implementation for the Speaches
   * branch. Production omits this and the route uses the global `fetch`
   * (Node 24 LTS ships undici as the global). Tests mock the network
   * boundary by supplying a stub returning a synthesised Response.
   */
  speachesFetch?: typeof fetch;
}

/**
 * Speaches local-diarization model. Hard-coded so api callers don't need
 * to know it; matches the realistic-profile PRELOAD_MODELS entry in
 * docker-compose.load-test.yml.
 */
export const SPEACHES_DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1";

export const buildDiarizationRoutes = (deps: DiarizationDeps) =>
  async function diarizationRoutes(app: FastifyInstance): Promise<void> {
    const idem = createIdempotencyCache(deps.redis);
    // Phase 08.6-02: pick the handler branch ONCE at registration time.
    // - speachesDiarizationUrl set → local Speaches direct (sync multipart)
    // - unset → pyannote.ai async orchestration (production default)
    const handler = deps.speachesDiarizationUrl
      ? handleSpeachesDiarization(deps)
      : handleDiarization(deps, idem);
    app.route({
      method: "POST",
      url: DIARIZATION_MOUNT_PATH,
      // Diarization is heavier on pyannote billing than transcription;
      // 30/min/user (vs transcribe's 60/min) keeps abuse cost-bounded.
      // The local-Speaches branch shares the same per-user budget — it
      // bounds local GPU/CPU contention, not cost.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      handler,
    });
  };

function handleDiarization(deps: DiarizationDeps, idem: IdempotencyCache) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !req.tenant) {
      // Defensive — dualAuthHook should have thrown.
      return reply.code(401).send({ error: "unauthorized" });
    }

    // Mock-mode short-circuit (contract-test profile). The fixture body
    // is parsed through DiarizationResponse so any future schema drift
    // surfaces as a test failure, not a silent contract break.
    if (deps.mockMode) {
      return reply.code(200).send(DiarizationResponse.parse(MOCK_RESPONSE));
    }

    const contentTypeHeader = req.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    if (!contentType || !contentType.toLowerCase().startsWith("multipart/")) {
      return reply.code(400).send({ error: "expected multipart/form-data with `file` field" });
    }

    // Fast-fail when PYANNOTE_API_KEY is unset — emit 503 with operator-
    // actionable message BEFORE consuming the multipart body. (Reading
    // the body just to throw it away wastes the desktop's upload.)
    let pyannote: PyannoteClient;
    try {
      pyannote = deps.pyannoteFactory ? deps.pyannoteFactory() : createPyannoteClient();
    } catch (err) {
      if (err instanceof MissingPyannoteKeyError) {
        // Pitfall #8: 503 (NOT 401) — the desktop's tokenStore treats
        // 401 as a session-expiry signal and signs the user out. Config
        // gaps must surface as 503 with operator-actionable message.
        throw new ServiceUnavailable(err.message);
      }
      throw err;
    }

    // Read the multipart `file` part. @fastify/multipart is registered
    // ONCE at buildApp (HIGH-4, Plan 03 Wave 1) with attachFieldsToBody:
    // false; calling req.file() pulls just the `file` part as a stream.
    let filePart: Awaited<ReturnType<FastifyRequest["file"]>>;
    try {
      filePart = await req.file();
    } catch (err) {
      // @fastify/multipart's RequestFileTooLargeError surfaces here when
      // the limit is exceeded; we convert to a 400 envelope.
      const fastifyErr = err as { code?: string; message?: string };
      if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "file exceeds size limit" });
      }
      throw err;
    }
    if (!filePart) {
      return reply.code(400).send({ error: "expected `file` multipart field" });
    }

    // Buffer the file (bounded by @fastify/multipart's 100MB limits.fileSize
    // applied at buildApp). Bounded buffering is acceptable for diarization
    // because (a) the 5min POLL_CEILING_MS already restricts our use case
    // to ≤~5min audio = ~10MB at 16kHz mono and (b) we need the full bytes
    // to hash for the SHA-256(file) idempotency fallback AND to PUT to the
    // pyannote presigned URL (which expects a single Content-Length-known
    // body, not a stream of indeterminate length).
    const chunks: Buffer[] = [];
    const hash = createHash("sha256");
    let truncated = false;
    try {
      for await (const chunk of filePart.file) {
        hash.update(chunk);
        chunks.push(chunk);
      }
      // @fastify/multipart marks the stream as truncated when limits.fileSize
      // is exceeded mid-stream (rather than throwing). Surface that as 400.
      truncated = filePart.file.truncated === true;
    } catch (err) {
      const fastifyErr = err as { code?: string };
      if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "file exceeds size limit" });
      }
      throw err;
    }
    if (truncated) {
      return reply.code(400).send({ error: "file exceeds size limit" });
    }
    const fileBuffer = Buffer.concat(chunks);
    const bodyHash = hash.digest("hex");
    const fileMime = filePart.mimetype || "application/octet-stream";

    // Stripe-style idempotency: prefer the explicit header; fall back to
    // SHA-256(file) so retries with the same body are still cheap even
    // when the desktop forgets to set the header.
    const headerKeyRaw = req.headers["idempotency-key"];
    const headerKey = Array.isArray(headerKeyRaw) ? headerKeyRaw[0] : headerKeyRaw;
    const idemKey = typeof headerKey === "string" && headerKey.length > 0 ? headerKey : bodyHash;

    let jobId: string | null = null;
    const lookup = await idem.lookupOrReserve(idemKey, bodyHash);
    if (lookup.state === "conflict") {
      return reply.code(409).send({
        error: "Idempotency-Key conflict: same key used with different request body",
      });
    }
    if (lookup.state === "hit") {
      jobId = lookup.jobId;
    } else if (lookup.state === "in-flight") {
      // Another request just reserved but hasn't bound jobId yet.
      // Wait briefly and re-check (max 4 retries, 250ms each = 1s total).
      for (let i = 0; i < 4; i++) {
        await sleep(250);
        const recheck = await idem.lookupOrReserve(idemKey, bodyHash);
        if (recheck.state === "hit") {
          jobId = recheck.jobId;
          break;
        }
        if (recheck.state === "conflict") {
          return reply.code(409).send({
            error: "Idempotency-Key conflict",
          });
        }
      }
      if (!jobId) {
        reply.header("retry-after", "5");
        return reply.code(503).send({
          error: "concurrent request in flight; retry shortly",
        });
      }
    }

    // Steps 1-3: when no cached jobId, orchestrate upload + submit.
    if (!jobId) {
      try {
        const { url: presignedUrl, mediaUri } = await pyannote.createMediaInput();
        await pyannote.uploadToPresignedUrl(presignedUrl, fileBuffer, fileMime);
        jobId = await pyannote.submitDiarize(mediaUri);
        // WR-01: pass bodyHash so the rescue path (expired/corrupt cache)
        // can preserve the real fingerprint and retries return 'hit'
        // instead of a spurious 409 against bodyHash:"unknown".
        await idem.bindJobId(idemKey, jobId, bodyHash);
      } catch (err) {
        return mapPyannoteError(err, reply, req);
      }
    }

    // Step 4: poll loop with abort-on-disconnect.
    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    req.raw.on("close", onClose);

    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < POLL_CEILING_MS) {
        if (abortController.signal.aborted) {
          // Client disconnected — pyannote job continues; idem cache
          // retains jobId for retry. No response — connection is gone.
          req.log.info(
            { jobId, idemKey: idemKey.slice(0, 8) },
            "diarization client disconnected during poll",
          );
          return;
        }
        let job: PyannoteJob;
        try {
          job = await pyannote.pollJob(jobId, abortController.signal);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          return mapPyannoteError(err, reply, req);
        }
        if (job.status === "succeeded" && job.output) {
          return reply.code(200).send(DiarizationResponse.parse(job.output));
        }
        if (job.status === "failed" || job.status === "cancelled") {
          return reply.code(502).send({ error: `diarization job ${job.status}`, jobId });
        }
        // status === 'created' | 'running' — wait then poll again.
        try {
          await sleep(POLL_INTERVAL_MS, undefined, {
            signal: abortController.signal,
          });
        } catch {
          // sleep rejects on abort — fall back into the loop's abort check.
        }
      }
      // 5-minute ceiling exceeded. Caller may resume via Idempotency-Key.
      return reply.code(504).send({
        error:
          "diarization exceeded 5-minute ceiling; for files > 5min consider corporate LiteLLM override with self-hosted Speaches",
        jobId,
      });
    } finally {
      req.raw.off("close", onClose);
    }
  };
}

function mapPyannoteError(err: unknown, reply: FastifyReply, req: FastifyRequest) {
  if (err instanceof PyannoteUnavailableError) {
    req.log.warn({ status: err.status }, "pyannote upstream unavailable");
    reply.header("retry-after", "30");
    return reply.code(503).send({ error: "pyannote.ai upstream unavailable" });
  }
  if (err instanceof PyannoteAuthError) {
    // Pitfall #8: pyannote 401/403 → 503 (operator-actionable), NEVER 401
    // to the desktop. The desktop's tokenStore treats 401 as session-expiry
    // and signs the user out — a misconfigured PYANNOTE_API_KEY would
    // unjustly log the user out without this conversion.
    req.log.warn({ status: err.status }, "pyannote auth error");
    return reply.code(503).send({
      error: "PYANNOTE_API_KEY rejected by upstream — verify the key in .env",
    });
  }
  if (err instanceof PyannoteBadRequestError) {
    req.log.warn({ status: err.status }, "pyannote rejected request");
    return reply.code(502).send({ error: `pyannote rejected request (${err.status})` });
  }
  if (err instanceof PyannoteUpstreamError) {
    req.log.warn({ status: err.status }, "pyannote upstream error");
    return reply.code(502).send({ error: "pyannote upstream error" });
  }
  // Unknown — let the centralized error handler emit the canonical 500.
  throw err;
}

/**
 * Phase 08.6-02 — Speaches local diarization branch.
 *
 * Buffers the multipart `file` part (bounded by @fastify/multipart's 100MB
 * limits.fileSize), re-wraps it in a fresh multipart envelope with the
 * canonical `file` + `model` form fields, and POSTs synchronously to
 * `${speachesDiarizationUrl}/v1/audio/diarization`. Speaches returns
 * the {duration, segments[]} JSON in a single response — same shape as
 * our DiarizationResponse contract.
 *
 * Error mapping:
 *   200 + valid JSON          → 200 reply
 *   200 + malformed JSON      → 502 (upstream broke contract)
 *   4xx upstream              → 502 (upstream rejected payload)
 *   5xx upstream              → 503 (upstream unavailable, retry-after: 30s)
 *   fetch network error       → 503 (ECONNREFUSED / DNS / TLS / etc)
 *
 * No idempotency cache, no jobId, no polling — Speaches is sync.
 */
function handleSpeachesDiarization(deps: DiarizationDeps) {
  const baseUrl = deps.speachesDiarizationUrl as string; // guarded at registration
  const fetchImpl: typeof fetch = deps.speachesFetch ?? globalThis.fetch;
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !req.tenant) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const contentTypeHeader = req.headers["content-type"];
    const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
    if (!contentType || !contentType.toLowerCase().startsWith("multipart/")) {
      return reply.code(400).send({ error: "expected multipart/form-data with `file` field" });
    }

    // Read the multipart `file` part. @fastify/multipart is registered
    // ONCE at buildApp; calling req.file() pulls just the `file` part.
    let filePart: Awaited<ReturnType<FastifyRequest["file"]>>;
    try {
      filePart = await req.file();
    } catch (err) {
      const fastifyErr = err as { code?: string };
      if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "file exceeds size limit" });
      }
      throw err;
    }
    if (!filePart) {
      return reply.code(400).send({ error: "expected `file` multipart field" });
    }

    const chunks: Buffer[] = [];
    let truncated = false;
    try {
      for await (const chunk of filePart.file) {
        chunks.push(chunk);
      }
      truncated = filePart.file.truncated === true;
    } catch (err) {
      const fastifyErr = err as { code?: string };
      if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "file exceeds size limit" });
      }
      throw err;
    }
    if (truncated) {
      return reply.code(400).send({ error: "file exceeds size limit" });
    }
    const fileBuffer = Buffer.concat(chunks);
    const fileMime = filePart.mimetype || "application/octet-stream";
    const fileName = filePart.filename || "audio.wav";

    // Build the outgoing multipart envelope. We construct the body
    // explicitly (rather than via FormData) so the body type stays as
    // a Node Buffer — predictable for the test seam and the undici
    // dispatcher both. Boundary is unique-per-request.
    const boundary = `----owsp-speaches-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const CRLF = "\r\n";
    const head = Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
        `${SPEACHES_DIARIZATION_MODEL}${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
        `Content-Type: ${fileMime}${CRLF}${CRLF}`,
      "utf8",
    );
    const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, "utf8");
    const outBody = Buffer.concat([head, fileBuffer, tail]);

    let upstream: Response;
    try {
      upstream = await fetchImpl(`${baseUrl}/v1/audio/diarization`, {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body: outBody,
      });
    } catch (err) {
      // Network-level failure (ECONNREFUSED, DNS, TLS handshake, etc).
      // Pitfall #8: 503 with operator-actionable message, NEVER 401.
      req.log.warn({ err: (err as Error).message }, "speaches diarization unreachable");
      reply.header("retry-after", "30");
      return reply.code(503).send({
        error: "speaches diarization unavailable — verify SPEACHES_DIARIZATION_URL",
      });
    }

    if (upstream.status >= 500) {
      req.log.warn({ status: upstream.status }, "speaches diarization upstream 5xx");
      reply.header("retry-after", "30");
      return reply.code(503).send({
        error: "speaches diarization upstream unavailable",
      });
    }
    if (upstream.status >= 400) {
      req.log.warn({ status: upstream.status }, "speaches diarization rejected payload");
      return reply.code(502).send({
        error: `speaches diarization rejected request (${upstream.status})`,
      });
    }

    let parsed: unknown;
    try {
      parsed = await upstream.json();
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, "speaches diarization returned non-JSON body");
      return reply.code(502).send({
        error: "speaches diarization returned malformed body",
      });
    }

    try {
      return reply.code(200).send(DiarizationResponse.parse(parsed));
    } catch (err) {
      req.log.warn(
        { err: (err as Error).message },
        "speaches diarization body failed schema validation",
      );
      return reply.code(502).send({
        error: "speaches diarization response failed schema validation",
      });
    }
  };
}

export default buildDiarizationRoutes;
