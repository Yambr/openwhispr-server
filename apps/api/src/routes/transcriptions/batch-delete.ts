// Phase 05 / Plan 08 / Task 1 — POST /api/transcriptions/batch-delete
// (WIRE-26).
//
// Wire shape (matches
// ~/openwhispr/src/services/TranscriptionsService.ts.batchDelete):
//   Request:  { ids: string[] } (length 1..500)
//   Success:  200 { deleted: string[] }  ← upstream returns the array of
//             IDs that were actually soft-deleted, NOT a count.
//   400:      batch size exceeds 500 (D-30)
//
// D-23 — soft delete via deleted_at = NOW(); rows remain in the table.
// D-32 — NO usage_ledger writes.
//
// Uses `id = ANY($1::uuid[])` for a single-statement bulk update — one
// transaction, one round-trip; RLS still gates each row.
import {
  type ExecutableTx,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const MAX_BATCH_SIZE = 500;

const BatchDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()),
});

export interface TranscriptionsBatchDeleteDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildTranscriptionsBatchDeleteRoutes = (
  deps: TranscriptionsBatchDeleteDeps,
) =>
  async function transcriptionsBatchDeleteRoutes(
    app: FastifyInstance,
  ): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const body = BatchDeleteBodySchema.parse(req.body);

        if (body.ids.length > MAX_BATCH_SIZE) {
          return reply
            .code(400)
            .send({ error: `batch size exceeds ${MAX_BATCH_SIZE} items` });
        }

        const tenantId = req.tenant;
        const userId = req.user.id;

        const deleted = await withTenant(deps.db, tenantId, async (tx) => {
          // Single-statement bulk update — ANY($1::uuid[]) lets Postgres
          // plan a single index scan against transcriptions_pkey + RLS.
          // Returns RETURNING id of the rows actually flipped (already-
          // deleted rows are excluded by `deleted_at IS NULL`).
          const result = (await tx.execute(sql`
            UPDATE "transcriptions"
               SET "deleted_at" = NOW()
             WHERE "id" = ANY(${body.ids}::uuid[])
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return (result.rows ?? []).map((r) => r.id);
        });

        return reply.code(200).send({ deleted });
      },
    });
  };

export default buildTranscriptionsBatchDeleteRoutes;
