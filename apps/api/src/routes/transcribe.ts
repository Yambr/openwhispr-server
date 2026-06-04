// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 04 / Task 1 — POST /api/transcribe.
//
// Wire shape: docs/wire-contracts-phase-3.md "POST /api/transcribe".
//
// Behavior:
//   1. Multipart audio body is forwarded RAW (req.raw) to LiteLLM's
//      /v1/audio/transcriptions via @openwhispr/litellm-client. No
//      buffering — the file streams chunk-by-chunk through the api process
//      to LiteLLM (RESEARCH Pitfall #5; SCALE-01 1000 concurrent demands
//      O(1) memory per request).
//   2. The shared LiteLLM client (Plan 03) injects:
//        - authorization: Bearer ${LITELLM_MASTER_KEY}
//        - x-litellm-end-user-id: ${req.user.id}    (D-03 attribution)
//        - x-litellm-spend-logs-metadata: {openwhispr_request_id}  (OBS-04)
//   3. wordsUsed semantics — minutes-of-audio, ceil(duration/60). The
//      `transcribe_minutes` ledger kind binds the same unit so observability
//      labels and the ledger row stay consistent (Plan 01 D-09).
//   4. Idempotency — usage_ledger insert uses
//      `ON CONFLICT (request_id) DO NOTHING`. The Plan 08 spend-ingest
//      worker also writes from LiteLLM_SpendLogs; both UPSERTs converge
//      on the same row (DATA-03 first-writer-wins).
//   5. Error shape:
//        - MissingProviderKeyError (no GROQ_API_KEY)  -> 503 with the
//          MissingProviderKeyError.message verbatim. NEVER 401 — Pitfall
//          #8: a 401 would look like a session expiry to the desktop and
//          trigger an unwanted sign-out.
//        - LitellmUpstreamError                       -> 502 generic
//          envelope. Upstream body is NEVER echoed (it could carry a
//          truncated provider error containing secret-shaped fragments).
//        - dual-auth failure                          -> 401 (existing
//          dualAuthHook + setErrorHandler).
//
// Multipart plugin registration: @fastify/multipart is registered ONCE in
// buildApp (HIGH-4, Plan 03 Wave-1). This route does NOT re-register it.

import { randomBytes } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import {
  DEFAULT_STT_MODEL,
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { routeRateLimitConfig } from "../config/rate-limits.js";
import { AuthError, ServiceUnavailable, UpstreamError, ValidationError } from "../errors.js";
import { minutesFromDuration } from "../lib/word-units.js";

export interface TranscribeDeps {
  db: TransactionalDb<ExecutableTx>;
  litellm: LitellmClient;
  /**
   * D2 — STT model alias forwarded to LiteLLM's `/v1/audio/transcriptions`.
   * Production threads this from `loadLitellmConfigFromEnv().defaultSttModel`
   * (operator-owned via `LITELLM_STT_MODEL`); the LiteLLM proxy catalog
   * resolves the alias. The route NEVER reads `process.env` (LOCKER-01) and
   * NEVER bakes a model literal — when the dep is omitted (test isolation)
   * the route falls back to the bundled `DEFAULT_STT_MODEL` env-default.
   */
  sttModel?: string;
}

interface UpstreamWhisperJson {
  text: string;
  duration?: number;
  language?: string;
  segments?: unknown[];
}

// STT_PROVIDER is a display-only hint echoed in `TranscribeResponse.sttProvider`
// — it is NOT behaviour-gating (LiteLLM's catalog owns provider routing) and
// is intentionally NOT env-driven. The STT *model* (D2) IS operator-owned and
// flows through `deps.sttModel`.
const STT_PROVIDER = "groq";
const UNLIMITED_REMAINING = 999_999_999;

/**
 * Phase 59 / Track B — R16 facet 2: zero-byte upload guard.
 *
 * `req.file()` pulls JUST the multipart `file` part as a stream
 * (`@fastify/multipart` is registered with `attachFieldsToBody:false` at
 * buildApp). We peek the FIRST chunk of that stream:
 *
 *   - first chunk is `undefined` (stream ended with zero bytes)
 *     → the upload is empty; the caller rejects with 400 EMPTY_AUDIO
 *     BEFORE any upstream call.
 *   - first chunk has bytes → we re-wrap the part into a FRESH multipart
 *     envelope, prepending the peeked chunk back and streaming the rest.
 *     Only ONE chunk is ever held in memory — the O(1)-per-request
 *     streaming invariant (SCALE-01) is preserved; the audio payload is
 *     never fully buffered.
 *
 * Returns `{ empty: true }` for the zero-byte case, or
 * `{ empty: false, body, contentType }` carrying the re-enveloped stream.
 */
interface MultipartFilePart {
  readonly filename?: string;
  readonly mimetype?: string;
  readonly file: Readable;
}

type PeekResult = { empty: true } | { empty: false; body: Readable; contentType: string };

async function peekAndRewrap(part: MultipartFilePart): Promise<PeekResult> {
  const iterator = part.file[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || (first.value as Buffer).length === 0) {
    // Drain any trailing zero-length chunks so the socket is released.
    part.file.resume();
    return { empty: true };
  }
  const firstChunk = first.value as Buffer;

  const boundary = `----openwhispr-${randomBytes(16).toString("hex")}`;
  const filename = part.filename ?? "audio";
  const mimetype = part.mimetype ?? "application/octet-stream";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimetype}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  const through = new PassThrough();
  // Pipe the envelope: head → firstChunk → remaining file chunks → tail.
  // The remaining chunks stream straight through — never collected.
  void (async () => {
    try {
      through.write(head);
      through.write(firstChunk);
      let next = await iterator.next();
      while (!next.done) {
        if (!through.write(next.value as Buffer)) {
          await new Promise((resolve) => through.once("drain", resolve));
        }
        next = await iterator.next();
      }
      through.end(tail);
    } catch (err) {
      through.destroy(err as Error);
    }
  })();

  return {
    empty: false,
    body: through,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export const buildTranscribeRoutes = (deps: TranscribeDeps) =>
  async function transcribeRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/transcribe",
      // Phase 6 / Plan 06-09: route now opts into the canonical per-route
      // rate-limit matrix (D-RL2). User-tier 20/min user (transcribe is
      // GPU-expensive; tight user-tier cap), IP-tier 60/min handled by
      // the global GLOBAL_IP_CEILING. Previously hard-coded `max: 60`
      // shadowed Plan 06-09's transcribe entry — Phase 06-12d Rule 2
      // wire-up gap closed.
      config: { rateLimit: routeRateLimitConfig("transcribe") },
      // No `schema.body` — multipart bodies bypass the JSON body parser.
      // Response shape is the canonical TranscribeResponse from Plan 01.
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        const contentTypeHeader = req.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader)
          ? contentTypeHeader[0]
          : contentTypeHeader;
        if (!contentType || !contentType.toLowerCase().startsWith("multipart/form-data")) {
          throw new ValidationError(
            "MULTIPART_REQUIRED",
            "expected multipart/form-data audio upload",
          );
        }

        // Phase 59 / Track B — R16 facet 2: read the multipart `file` part
        // and reject a zero-byte upload with 400 BEFORE any upstream call.
        // `peekAndRewrap` holds at most ONE chunk in memory; the audio
        // payload streams through unbuffered (SCALE-01 O(1) preserved).
        let filePart: MultipartFilePart | undefined;
        try {
          filePart = (await req.file()) as MultipartFilePart | undefined;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === "FST_REQ_FILE_TOO_LARGE") {
            throw new ValidationError("FILE_TOO_LARGE", "audio file exceeds size limit");
          }
          throw err;
        }
        if (!filePart) {
          throw new ValidationError(
            "MULTIPART_FILE_FIELD_MISSING",
            "expected a `file` multipart field",
          );
        }
        const peeked = await peekAndRewrap(filePart);
        if (peeked.empty) {
          throw new ValidationError("EMPTY_AUDIO", "audio file is empty");
        }

        // D2 — operator-owned STT alias (LITELLM_STT_MODEL → litellm config
        // → deps.sttModel). Resolved once: forwarded to LiteLLM AND echoed
        // in the response so the wire `sttModel` field and the upstream
        // `?model=` query never drift.
        const sttModel = deps.sttModel ?? DEFAULT_STT_MODEL;

        let upstreamJson: UpstreamWhisperJson;
        try {
          const upstream = await deps.litellm.audioTranscriptions({
            // Phase 19.2 / Plan 02 — SERVER-ERRORS Entry 11 closure:
            // forward the resolved STT model so LiteLLM does not reject
            // with `model=None`.
            model: sttModel,
            body: peeked.body,
            contentType: peeked.contentType,
            userId: req.user.id,
            // Upstream #4 (D-2) — the multipart /v1/audio/transcriptions
            // body has no JSON `user` slot, so the configurable
            // LITELLM_USER_HEADER_NAME header is this route's only
            // attribution vector for the end-user EMAIL. `userId` (the
            // UUID) stays the stable x-litellm-end-user-id key (D-1).
            endUser: req.user.email ?? req.user.id,
            requestId: req.id,
          });
          upstreamJson = (await upstream.body.json()) as UpstreamWhisperJson;
        } catch (err) {
          if (err instanceof MissingProviderKeyError) {
            // 503 — operator-actionable config issue. NEVER 401 (Pitfall #8).
            // HI-03 (Phase 62): code+literal pair — the missing-key detail
            // is logged server-side for operator triage but is NOT carried
            // on `.message` (the error handler emits the class-default
            // literal regardless; this keeps the throw site explicit so a
            // future handler change cannot re-leak the upstream string).
            req.log.warn({ err }, "missing provider key on /api/transcribe");
            throw new ServiceUnavailable("SERVICE_UNAVAILABLE", "Service temporarily unavailable");
          }
          if (err instanceof LitellmUpstreamError) {
            req.log.warn({ status: err.status }, "litellm upstream error on /api/transcribe");
            throw new UpstreamError(
              "TRANSCRIPTION_UPSTREAM_FAILED",
              "upstream transcription provider failure",
            );
          }
          throw err;
        }

        const minutes = minutesFromDuration(upstreamJson.duration);

        // DATA-03: idempotent ledger insert. Plan 08's spend-ingest worker
        // also writes from LiteLLM_SpendLogs; both UPSERTs converge on
        // the same row via the request_id UNIQUE index.
        const tenantId = req.tenant;
        const userId = req.user.id;
        const requestId = req.id;
        await withTenant(deps.db, tenantId, async (tx) => {
          await tx.execute(sql`
            INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
            VALUES (${tenantId}::uuid, ${userId}::uuid, ${requestId}, 'transcribe_minutes', ${minutes})
            ON CONFLICT (request_id) DO NOTHING
          `);
        });

        const response = {
          text: upstreamJson.text,
          wordsUsed: minutes,
          wordsRemaining: UNLIMITED_REMAINING,
          plan: "unlimited" as const,
          limitReached: false as const,
          sttProvider: STT_PROVIDER,
          sttModel,
          ...(upstreamJson.language !== undefined ? { language: upstreamJson.language } : {}),
          ...(upstreamJson.duration !== undefined ? { duration: upstreamJson.duration } : {}),
          ...(upstreamJson.segments !== undefined ? { segments: upstreamJson.segments } : {}),
        };
        return reply.code(200).send(response);
      },
    });
  };

export default buildTranscribeRoutes;
