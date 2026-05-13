// Phase 05 / Plan 06 / Task 1 — GET /api/folders/list (WIRE-23).
//
// Wire shape (matches ~/openwhispr/src/services/FoldersService.ts.list):
//   Query: ?limit=<n>&before=<ISO>&since=<ISO>
//   Success: 200 { folders: CloudFolder[] }
//
// Upstream desktop ONLY sends `?since=<ISO>` today (delta-sync use case)
// — we accept the full keyset trio (limit/before/since) per D-25 for
// forward compat and consistency with /api/notes/list.
//
// Soft-deleted rows excluded via withSoftDelete().
// Ordering: created_at DESC, id DESC — pairs with folders_keyset_idx
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
import { type CloudFolderRow, rowToCloudFolder } from "./shape.js";

export interface FoldersListDeps {
  db: TransactionalDb<ExecutableTx>;
}

interface ListQuery {
  limit?: string;
  before?: string;
  since?: string;
}

export const buildFoldersListRoutes = (deps: FoldersListDeps) =>
  async function foldersListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/folders/list",
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
          // ORDER BY (created_at, id) DESC paired with folders_keyset_idx.
          const result = (await tx.execute(sql`
            SELECT * FROM "folders"
             WHERE "user_id" = ${userId}::uuid${softDelete}${keysetWhere}${orderLimit}
          `)) as { rows?: CloudFolderRow[] };
          return result.rows ?? [];
        });

        return reply.code(200).send({ folders: rows.map(rowToCloudFolder) });
      },
    });
  };

export default buildFoldersListRoutes;
