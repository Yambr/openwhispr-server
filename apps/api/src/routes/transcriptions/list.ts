// SPDX-License-Identifier: FSL-1.1-ALv2
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
import { z } from "zod";
import { AuthError, ValidationError } from "../../errors.js";
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

// Plan 51-12tx — explicit querystring zod schema for LOCKER-04
// invariant 14 (route declaration must carry `schema: {...}`). The
// handler still calls `parseListQuery(q)` for the keyset-pagination
// shape — this schema is the surface-level guard.
const ListQuerySchema = z
  .object({
    limit: z.string().optional(),
    before: z.string().optional(),
    since: z.string().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof ListQuerySchema>;

export const buildTranscriptionsListRoutes = (deps: TranscriptionsListDeps) =>
  async function transcriptionsListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/transcriptions/list",
      // Plan 51-12tx — schema:querystring for LOCKER-04.
      schema: { querystring: ListQuerySchema },
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
          // Plan 51-12tx (HI-2) — bypass-free error path. The raw
          // parseListQuery message can echo user-supplied cursor/ISO
          // strings; route those through the centralized handler with
          // a fixed-code envelope instead of leaking to the wire.
          req.log.warn({ err }, "transcriptions/list: invalid query");
          throw new ValidationError("INVALID_QUERY", "invalid query");
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
