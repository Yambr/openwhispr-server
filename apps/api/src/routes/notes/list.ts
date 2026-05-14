// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 05 / Task 2 — GET /api/notes/list (WIRE-22).
//
// Wire shape (matches ~/openwhispr/src/services/NotesService.ts.list):
//   Query: ?limit=<n>&before=<ISO>&since=<ISO>
//   Success: 200 { notes: CloudNote[] }
//
// D-25 — keyset pagination via parseListQuery() + buildKeysetWhere() +
// buildKeysetOrderLimit() helpers. limit clamps to [1, 200] (default
// 50). Soft-deleted rows excluded via withSoftDelete().
//
// Ordering: created_at DESC, id DESC — pairs with notes_keyset_idx
// partial index from Plan 01.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../errors.js";
import {
  buildKeysetOrderLimit,
  buildKeysetWhere,
  parseListQuery,
} from "../../lib/keyset-pagination.js";
import { withSoftDelete } from "../../lib/soft-delete.js";
import { type CloudNoteRow, rowToCloudNote } from "./shape.js";

export interface NotesListDeps {
  db: TransactionalDb<ExecutableTx>;
}

interface ListQuery {
  limit?: string;
  before?: string;
  since?: string;
}

export const buildNotesListRoutes = (deps: NotesListDeps) =>
  async function notesListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/notes/list",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;

        let parsed: ReturnType<typeof parseListQuery>;
        try {
          parsed = parseListQuery((req.query ?? {}) as ListQuery);
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : "invalid query" });
        }

        const keysetWhere = buildKeysetWhere(parsed);
        const softDelete = withSoftDelete();
        const orderLimit = buildKeysetOrderLimit(parsed);

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          // ORDER BY (created_at, id) DESC paired with notes_keyset_idx.
          const result = (await tx.execute(sql`
            SELECT * FROM "notes"
             WHERE "user_id" = ${userId}::uuid${softDelete}${keysetWhere}${orderLimit}
          `)) as { rows?: CloudNoteRow[] };
          return result.rows ?? [];
        });

        return reply.code(200).send({ notes: rows.map(rowToCloudNote) });
      },
    });
  };

export default buildNotesListRoutes;
