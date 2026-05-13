// Phase 05 / Plan 02 / Task 1 — POST /api/streaming-usage (WIRE-09).
//
// Wire shape: BACKEND_SPEC.md:377-412.
//
// Behavior:
//   1. JSON body validated by `StreamingUsageBodySchema` from
//      `@openwhispr/wire-schemas`. Required fields: sessionId,
//      audioDurationSeconds. 12 optional telemetry fields. The schema is
//      NOT `.strict()` — the upstream desktop client occasionally ships
//      additional debug fields and dropping them server-side is friendlier
//      than 400-bouncing the legitimate usage event (D-11).
//   2. Dual-auth (Bearer or cookie) — reuse Phase 2 hook applied at app
//      level. Defensive 401 in handler when `req.user`/`req.tenant`
//      missing (matches transcribe/reason pattern).
//   3. Inside `withTenant(deps.db, tenantId, …)`:
//        a. INSERT into usage_ledger with kind='streaming-stt',
//           units=Math.round(audioDurationSeconds), request_id=sessionId.
//           ON CONFLICT (request_id) DO NOTHING — D-10: same sessionId on
//           retry is idempotent (NOT 409). The client retries on network
//           blips with the same sessionId; landing duplicates would
//           inflate billing.
//        b. SELECT SUM(units) FROM usage_ledger WHERE user_id = … for
//           the response's `wordsUsed`. RLS restricts the SUM to the
//           current tenant.
//   4. OTel span attrs + structured log fields per D-11. text is NEVER
//      persisted in usage_ledger (D-13 / T-05-08 PII mitigation). We log
//      SHA-256(text) + length + a length-bounded preview:
//        - sendLogs=false → first 200 chars of preview
//        - sendLogs=true  → first 1000 chars of preview
//   5. Response: `{wordsUsed, wordsRemaining: 999_999_999, plan: 'unlimited',
//      limitReached: false}` per D-12.

import { createHash } from "node:crypto";
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { StreamingUsageBodySchema } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../errors.js";

export interface StreamingUsageDeps {
  db: TransactionalDb<ExecutableTx>;
}

const UNLIMITED_REMAINING = 999_999_999;
const LEDGER_KIND = "streaming-stt";

interface SumRow {
  words_used: string | number | null;
}

export const buildStreamingUsageRoutes = (deps: StreamingUsageDeps) =>
  async function streamingUsageRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/streaming-usage",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          // Defensive — dualAuthHook should have thrown.
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }

        // Manual zod parse so ZodError → centralized 400 envelope. (We do
        // NOT register schema.body here because the type-provider's
        // validation error shape is `validation` rather than ZodError —
        // routing through manual parse keeps the error path uniform.)
        const body = StreamingUsageBodySchema.parse(req.body);

        const tenantId = req.tenant;
        const userId = req.user.id;
        const units = Math.round(body.audioDurationSeconds);

        // D-13: NEVER store body.text in usage_ledger. Emit SHA-256 +
        // length + bounded preview to structured logs only.
        const text = body.text ?? "";
        const text_sha256 = createHash("sha256").update(text).digest("hex");
        const text_length = text.length;
        const previewCap = body.sendLogs ? 1000 : 200;
        const text_preview = text.slice(0, previewCap);

        req.log.info(
          {
            route: "POST /api/streaming-usage",
            sessionId: body.sessionId,
            units,
            text_sha256,
            text_length,
            text_preview,
            sendLogs: body.sendLogs,
            sttProvider: body.sttProvider,
            sttModel: body.sttModel,
            sttLanguage: body.sttLanguage,
            sttProcessingMs: body.sttProcessingMs,
            audioSizeBytes: body.audioSizeBytes,
            audioFormat: body.audioFormat,
            clientType: body.clientType,
            appVersion: body.appVersion,
            clientVersion: body.clientVersion,
            clientTotalMs: body.clientTotalMs,
          },
          "streaming-usage",
        );

        let wordsUsed = 0;
        await withTenant(deps.db, tenantId, async (tx) => {
          // D-10 idempotent ledger insert. Re-post with same sessionId
          // is a no-op (NOT 409).
          await tx.execute(sql`
            INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
            VALUES (${tenantId}::uuid, ${userId}::uuid, ${body.sessionId}, ${LEDGER_KIND}, ${units})
            ON CONFLICT (request_id) DO NOTHING
          `);
          const result = (await tx.execute(sql`
            SELECT COALESCE(SUM(units), 0)::bigint AS words_used
            FROM usage_ledger
            WHERE user_id = ${userId}::uuid
          `)) as { rows?: SumRow[] };
          const sumRow = result.rows?.[0];
          if (sumRow) {
            const raw = sumRow.words_used;
            wordsUsed = typeof raw === "number" ? raw : raw == null ? 0 : Number(raw);
          }
        });

        return reply.code(200).send({
          wordsUsed,
          wordsRemaining: UNLIMITED_REMAINING,
          plan: "unlimited" as const,
          limitReached: false as const,
        });
      },
    });
  };

export default buildStreamingUsageRoutes;
