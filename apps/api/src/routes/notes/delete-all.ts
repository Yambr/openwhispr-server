// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — DELETE /api/notes/delete-all (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts.deleteAll):
//   Request:  (no body)
//   Success:  200 { deleted: number }
//   400:      delete-all exceeds 1000 rows (Open Q#6 / T-DEL-ALL-DOS) —
//             emitted via ValidationError so the canonical envelope is
//             produced by the centralized setErrorHandler (H-4, Phase 64).
//
// D-23 + Open Q#6: HARD delete (DELETE FROM, not UPDATE deleted_at =
// NOW()). The "delete all" semantics in the desktop is "purge from
// cloud" — soft-delete would leave tombstones that the cloud-sync
// observer would interpret as "deleted on another device" and then
// echo back as additional local deletes. Hard delete is what the
// upstream contract wants.
//
// 1000-row cap (T-DEL-ALL-DOS): operators with very large note
// collections trigger 400 + an envelope explaining the cap. Phase 6
// will introduce async BullMQ bulk-delete; for v1 the cap keeps the
// request-time roundtrip bounded.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, ValidationError } from "../../errors.js";

const MAX_INLINE_PURGE = 1000;

// LOCKER-04 inv-14 — DELETE /api/notes/delete-all carries no request
// payload, but the invariant still requires a declarative `schema:`
// key. This route is body-less: the desktop client sends DELETE with
// no JSON body. The schema therefore accepts an absent body (undefined
// / null) AND an empty object — anything else is rejected at the
// dispatcher. Satisfies the structural rule (the linter checks
// `schema:` key presence, not its shape).
const EmptyBodySchema = z.object({}).strict().nullish();

export interface NotesDeleteAllDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildNotesDeleteAllRoutes = (deps: NotesDeleteAllDeps) =>
  async function notesDeleteAllRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "DELETE",
      url: "/api/notes/delete-all",
      // LOCKER-04 inv-14 — empty-body schema for a payload-less DELETE.
      schema: { body: EmptyBodySchema },
      // Tighter rate-limit than per-note delete — bulk-purge ops should
      // be rare. 3/min/user is enough for "I accidentally", "I really
      // accidentally", "yes really".
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;

        const result = await withTenant(deps.db, tenantId, async (tx) => {
          // Count first — surface 400 BEFORE any DELETE runs.
          // 1000-row cap per Open Q#6.
          // Phase 51 / Plan 51-12 (REVIEW routes-conversations HIGH) —
          // count MUST cover the same rowset the DELETE will purge.
          // Pre-fix the count filtered `deleted_at IS NULL` (only live
          // rows) but the DELETE below is total (live + tombstones).
          // A user could soft-delete N rows via /notes/delete and then
          // trigger an unbounded hard-purge that bypassed the
          // MAX_INLINE_PURGE gate. The fix removes the `deleted_at IS
          // NULL` predicate from the count so the gate accounts for
          // tombstones too.
          const countRes = (await tx.execute(sql`
            SELECT COUNT(*)::int AS n
              FROM "notes"
             WHERE "user_id" = ${userId}::uuid
          `)) as { rows?: { n: number | string }[] };
          const count = Number(countRes.rows?.[0]?.n ?? 0);
          if (count > MAX_INLINE_PURGE) {
            return { exceeded: true, count } as const;
          }
          // Hard purge. RLS scopes to current tenant; we constrain to
          // user_id explicitly so cross-user purge under shared tenant
          // is impossible. Includes already-soft-deleted rows
          // (deleted_at IS NOT NULL) so the purge is total. The desktop's
          // "delete all" semantics is "make my cloud notes go away".
          const delRes = (await tx.execute(sql`
            DELETE FROM "notes"
             WHERE "user_id" = ${userId}::uuid
            RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return {
            exceeded: false,
            deleted: delRes.rows?.length ?? 0,
          } as const;
        });

        if (result.exceeded) {
          // H-4 (Phase 64) — route the over-limit 400 through the
          // centralized setErrorHandler (the SINGLE emission point) via
          // ValidationError, instead of an inline reply emission. This
          // gives the response i18n localization + uniform error logging,
          // consistent with every sibling 4xx (METADATA_TOO_LARGE,
          // BATCH_TOO_LARGE, ...).
          throw new ValidationError(
            "DELETE_ALL_TOO_LARGE",
            `delete-all exceeds ${MAX_INLINE_PURGE} rows; please delete in batches`,
          );
        }
        return reply.code(200).send({ deleted: result.deleted });
      },
    });
  };

export default buildNotesDeleteAllRoutes;
