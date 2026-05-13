// Phase 05 / Plan 08 / Task 1 — GET /api/transcriptions/list (WIRE-26).
//
// Wire shape (matches ~/openwhispr/src/services/TranscriptionsService.ts.list):
//   Query: ?limit=<n>&before=<ISO>&since=<ISO>
//   Success: 200 { transcriptions: CloudTranscription[] }
//
// Keyset pagination via shared parseListQuery + buildKeysetWhere +
// buildKeysetOrderLimit helpers; soft-deleted rows excluded via
// withSoftDelete(). Pairs with transcriptions_keyset_idx partial index.
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
import { type CloudTranscriptionRow, rowToCloudTranscription } from "./shape.js";

export interface TranscriptionsListDeps {
  db: TransactionalDb<ExecutableTx>;
}

interface ListQuery {
  limit?: string;
  before?: string;
  since?: string;
}

export const buildTranscriptionsListRoutes = (deps: TranscriptionsListDeps) =>
  async function transcriptionsListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/transcriptions/list",
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
          // ORDER BY (created_at, id) DESC paired with
          // transcriptions_keyset_idx partial index (Plan 01).
          const result = (await tx.execute(sql`
            SELECT * FROM "transcriptions"
             WHERE "user_id" = ${userId}::uuid${softDelete}${keysetWhere}${orderLimit}
          `)) as { rows?: CloudTranscriptionRow[] };
          return result.rows ?? [];
        });

        return reply.code(200).send({ transcriptions: rows.map(rowToCloudTranscription) });
      },
    });
  };

export default buildTranscriptionsListRoutes;
