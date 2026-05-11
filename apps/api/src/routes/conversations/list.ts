// Phase 05 / Plan 07 / Task 1 — GET /api/conversations/list (WIRE-24).
//
// Wire shape (matches ConversationsService.list):
//   Query: ?limit=<n>&before=<ISO>&since=<ISO>
//   Success: 200 { conversations: CloudConversation[] }
//
// Task 2 extends this route with an `?include=messages` branch that
// switches to a JOIN+array_agg shape returning
// CloudConversationWithMessages[] per D-27.
//
// Soft-deleted rows excluded via withSoftDelete().
// Ordering: created_at DESC, id DESC — pairs with conversations_keyset_idx
// partial index from Plan 01.
import {
  type ExecutableTx,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  buildKeysetOrderLimit,
  buildKeysetWhere,
  parseListQuery,
} from "../../lib/keyset-pagination.js";
import { withSoftDelete } from "../../lib/soft-delete.js";
import {
  type CloudConversationRow,
  rowToCloudConversation,
} from "./shape.js";

export interface ConversationsListDeps {
  db: TransactionalDb<ExecutableTx>;
}

interface ListQuery {
  limit?: string;
  before?: string;
  since?: string;
  include?: string;
}

export const buildConversationsListRoutes = (deps: ConversationsListDeps) =>
  async function conversationsListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/conversations/list",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const tenantId = req.tenant;
        const userId = req.user.id;
        const q = (req.query ?? {}) as ListQuery;

        let parsed;
        try {
          parsed = parseListQuery(q);
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : "invalid query" });
        }

        const keysetWhere = buildKeysetWhere(parsed);
        const softDelete = withSoftDelete();
        const orderLimit = buildKeysetOrderLimit(parsed);

        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            SELECT * FROM "conversations"
             WHERE "user_id" = ${userId}::uuid${softDelete}${keysetWhere}${orderLimit}
          `)) as { rows?: CloudConversationRow[] };
          return result.rows ?? [];
        });

        return reply
          .code(200)
          .send({ conversations: rows.map(rowToCloudConversation) });
      },
    });
  };

export default buildConversationsListRoutes;
