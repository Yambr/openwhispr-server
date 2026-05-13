// Phase 05 / Plan 08 / Task 1 — DELETE /api/transcriptions/delete
// (WIRE-26).
//
// Wire shape (matches
// ~/openwhispr/src/services/TranscriptionsService.ts.deleteTranscription):
//   Request:  { id: string } (body)
//   Success:  200 { ok: true }
//   404:      transcription not found
//
// D-23 — soft delete. Sets deleted_at = NOW(); row remains in the table.
// D-32 — NO usage_ledger writes.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";

const DeleteBodySchema = z.object({
  id: z.string().uuid(),
});

export interface TranscriptionsDeleteDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildTranscriptionsDeleteRoutes = (deps: TranscriptionsDeleteDeps) =>
  async function transcriptionsDeleteRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "DELETE",
      url: "/api/transcriptions/delete",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = DeleteBodySchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const updated = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            UPDATE "transcriptions"
               SET "deleted_at" = NOW()
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return result.rows?.[0];
        });

        if (!updated) {
          throw new NotFoundError("TRANSCRIPTION_NOT_FOUND", "transcription not found");
        }
        return reply.code(200).send({ ok: true });
      },
    });
  };

export default buildTranscriptionsDeleteRoutes;
