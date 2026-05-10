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

import {
  type ExecutableTx,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import {
  type LitellmClient,
  LitellmUpstreamError,
  MissingProviderKeyError,
} from "@openwhispr/litellm-client";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ServiceUnavailable } from "../errors.js";
import { minutesFromDuration } from "../lib/word-units.js";

export interface TranscribeDeps {
  db: TransactionalDb<ExecutableTx>;
  litellm: LitellmClient;
}

interface UpstreamWhisperJson {
  text: string;
  duration?: number;
  language?: string;
  segments?: unknown[];
}

const STT_PROVIDER = "groq";
const STT_MODEL = "whisper-large-v3";
const UNLIMITED_REMAINING = 999_999_999;

export const buildTranscribeRoutes = (deps: TranscribeDeps) =>
  async function transcribeRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/transcribe",
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      // No `schema.body` — multipart bodies bypass the JSON body parser.
      // Response shape is the canonical TranscribeResponse from Plan 01.
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          return reply.code(401).send({ error: "unauthorized" });
        }

        const contentTypeHeader = req.headers["content-type"];
        const contentType = Array.isArray(contentTypeHeader)
          ? contentTypeHeader[0]
          : contentTypeHeader;
        if (
          !contentType ||
          !contentType.toLowerCase().startsWith("multipart/form-data")
        ) {
          return reply
            .code(400)
            .send({ error: "expected multipart/form-data audio upload" });
        }

        let upstreamJson: UpstreamWhisperJson;
        try {
          const upstream = await deps.litellm.audioTranscriptions({
            body: req.raw,
            contentType,
            userId: req.user.id,
            requestId: req.id,
          });
          upstreamJson = (await upstream.body.json()) as UpstreamWhisperJson;
        } catch (err) {
          if (err instanceof MissingProviderKeyError) {
            // 503 — operator-actionable config issue. NEVER 401 (Pitfall #8).
            // Throw ServiceUnavailable so the centralized setErrorHandler
            // emits the canonical envelope using err.message verbatim.
            throw new ServiceUnavailable(err.message);
          }
          if (err instanceof LitellmUpstreamError) {
            req.log.warn(
              { status: err.status },
              "litellm upstream error on /api/transcribe",
            );
            return reply
              .code(502)
              .send({ error: "upstream transcription provider failure" });
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
          sttModel: STT_MODEL,
          ...(upstreamJson.language !== undefined
            ? { language: upstreamJson.language }
            : {}),
          ...(upstreamJson.duration !== undefined
            ? { duration: upstreamJson.duration }
            : {}),
          ...(upstreamJson.segments !== undefined
            ? { segments: upstreamJson.segments }
            : {}),
        };
        return reply.code(200).send(response);
      },
    });
  };

export default buildTranscribeRoutes;
