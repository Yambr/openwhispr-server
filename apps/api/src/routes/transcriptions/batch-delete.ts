// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 08 / Task 1 — POST /api/transcriptions/batch-delete
// (WIRE-26).
//
// Wire shape (matches
// ~/openwhispr/src/services/TranscriptionsService.ts.batchDelete):
//   Request:  { ids: string[] } (length 0..500)
//   Success:  200 { deleted: string[] }  ← echoes the ids that were
//             soft-deleted by THIS call (always equals input on success
//             under the atomic semantic below).
//   400:      batch size exceeds 500 (D-30)
//   404:      ANY id in the batch failed to match a live, owned row →
//             whole transaction rolled back (Phase 56 / Plan 05 / R11
//             atomicity decision).
//
// ATOMICITY (Phase 56 / Plan 05 / R11) — single transaction, all-or-
// none. The route runs a single `UPDATE … WHERE id = ANY($1::uuid[])
// AND user_id = $userId AND deleted_at IS NULL RETURNING id` inside
// `withTenant`, then verifies the RETURNING row count equals the
// requested id count. On mismatch (missing id, already-deleted id,
// RLS-hidden id from a different tenant) we throw NotFoundError —
// which propagates out of `withTenant`, triggering Postgres ROLLBACK
// on the enclosing transaction → no partial soft-deletes ever land.
// Per SERVER-REQUIREMENTS.md §R11 atomicity test requirement; previous
// implementation returned partial-success which the spec disallows.
//
// D-23 — soft delete via deleted_at = NOW(); rows remain in the table.
// D-32 — NO usage_ledger writes.
import { setTimeout as sleep } from "node:timers/promises";
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError, ValidationError } from "../../errors.js";

const MAX_BATCH_SIZE = 500;

// WR-07 (Phase 65) — constant-time failure-path floor. The all-hit path
// runs a full `UPDATE … RETURNING` and commits; the all-miss path returns an
// empty RETURNING and rolls back — Postgres does measurably less work on a
// miss, so raw response timing oracles cross-tenant id existence at large
// batch sizes. On the mismatch branch we wait until a fixed wall-clock budget
// (measured from handler entry) elapses before throwing, so the failure path
// is never systematically faster than a success. The budget must exceed the
// p99 all-hit duration for the 500-id cap; 750ms is generous for a
// soft-delete UPDATE of 500 indexed rows (sub-50ms loopback) while staying a
// tolerable ceiling for a genuinely-missing batch.
const FAILURE_PATH_FLOOR_MS = 750;

const BatchDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()),
});

export interface TranscriptionsBatchDeleteDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildTranscriptionsBatchDeleteRoutes = (deps: TranscriptionsBatchDeleteDeps) =>
  async function transcriptionsBatchDeleteRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/transcriptions/batch-delete",
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = BatchDeleteBodySchema.parse(req.body);

        if (body.ids.length > MAX_BATCH_SIZE) {
          throw new ValidationError(
            "BATCH_TOO_LARGE",
            `batch size exceeds ${MAX_BATCH_SIZE} items`,
          );
        }

        const tenantId = req.tenant;
        const userId = req.user.id;
        // WR-07 — handler-entry timestamp anchors the constant-time floor.
        const startedAt = Date.now();

        // Dedupe the input — Postgres `id = ANY(arr)` matches each row
        // once regardless of duplicates in `arr`, so the atomicity
        // `requested.length === returned.length` check would otherwise
        // false-positive a "missing id" when the only "miss" is a
        // duplicate. The wire contract does not require dedup output;
        // we dedup pre-tx for the count comparison only.
        const requestedIds = Array.from(new Set(body.ids));

        const deleted = await withTenant(deps.db, tenantId, async (tx) => {
          // Empty list short-circuits — ARRAY[]::uuid[] is valid SQL but
          // pointless and avoids a no-op DB roundtrip. Empty in → empty
          // out under atomic semantics (vacuously all-or-none).
          if (requestedIds.length === 0) return [];
          // Build ARRAY[$1, $2, ...]::uuid[] via sql.join() — drizzle would
          // otherwise expand the JS array as varargs ($1, $2) which casts
          // to record, not uuid[]. See Plan 09 create.ts for the same fix.
          const idsArr = sql`ARRAY[${sql.join(
            requestedIds.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[]`;
          const result = (await tx.execute(sql`
            UPDATE "transcriptions"
               SET "deleted_at" = NOW()
             WHERE "id" = ANY(${idsArr})
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          const returnedIds = (result.rows ?? []).map((r) => r.id);
          // ATOMICITY (Phase 56 Plan 05 R11) — if ANY requested id did
          // not match a live, owned row (not found, already-deleted,
          // RLS-hidden), throw to roll back the WHOLE transaction.
          // Postgres aborts the tx on the exception; no partial soft-
          // deletes ever land.
          if (returnedIds.length !== requestedIds.length) {
            // WR-07 — equalize the failure path with the success path so
            // response timing does not oracle cross-tenant id existence.
            // Wait out the remaining constant-time budget BEFORE throwing
            // (the throw rolls the tx back).
            const elapsed = Date.now() - startedAt;
            if (elapsed < FAILURE_PATH_FLOOR_MS) {
              await sleep(FAILURE_PATH_FLOOR_MS - elapsed);
            }
            throw new NotFoundError("TRANSCRIPTION_NOT_FOUND", "transcription not found");
          }
          return returnedIds;
        });

        return reply.code(200).send({ deleted });
      },
    });
  };

export default buildTranscriptionsBatchDeleteRoutes;
