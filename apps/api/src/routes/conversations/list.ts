// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 07 / Tasks 1 + 2 — GET /api/conversations/list (WIRE-24).
//
// Wire shape (matches ConversationsService.list):
//   Query: ?limit=<n>&before=<ISO>&since=<ISO>[&include=messages]
//   Success (default):
//     200 { conversations: CloudConversation[] }
//   Success (?include=messages, D-27):
//     200 { conversations: CloudConversationWithMessages[] }
//       where each row carries `messages: CloudMessage[]` aggregated
//       via array_agg, capped at 100 messages per conversation
//       (RESEARCH § Open Q#2 — T-AGG-MEM mitigation) and ordered
//       (created_at ASC, id ASC); soft-deleted messages excluded.
//
// Soft-deleted conversation rows excluded via withSoftDelete().
// Conversation ordering: created_at DESC, id DESC — pairs with
// conversations_keyset_idx partial index from Plan 01.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "../../errors.js";
import {
  buildKeysetOrderLimit,
  buildKeysetWhere,
  parseListQuery,
} from "../../lib/keyset-pagination.js";
import { withSoftDelete } from "../../lib/soft-delete.js";
import {
  type CloudConversationRow,
  type CloudMessageRow,
  rowToCloudConversation,
  rowToCloudMessage,
} from "./shape.js";

export interface ConversationsListDeps {
  db: TransactionalDb<ExecutableTx>;
}

// Plan 51-12c — explicit querystring schema for LOCKER-04 invariant 14.
const ListQuerySchema = z
  .object({
    limit: z.string().optional(),
    before: z.string().optional(),
    since: z.string().optional(),
    include: z.string().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof ListQuerySchema>;

interface ConversationWithMessagesRow extends CloudConversationRow {
  messages: CloudMessageRow[] | null;
}

export const buildConversationsListRoutes = (deps: ConversationsListDeps) =>
  async function conversationsListRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "GET",
      url: "/api/conversations/list",
      // Plan 51-12c — schema:querystring for LOCKER-04.
      schema: { querystring: ListQuerySchema },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const tenantId = req.tenant;
        const userId = req.user.id;
        const q = (req.query ?? {}) as ListQuery;

        let parsed: ReturnType<typeof parseListQuery>;
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

        // Task 2 — D-27 array_agg JSON aggregation branch with a 100-
        // message cap per conversation (T-AGG-MEM mitigation, Open Q#2).
        if (q.include === "messages") {
          const rowsWithMessages = await withTenant(deps.db, tenantId, async (tx) => {
            const result = (await tx.execute(sql`
              SELECT c.*,
                COALESCE(
                  (
                    SELECT array_agg(
                             jsonb_build_object(
                               'id', m.id,
                               'conversation_id', m.conversation_id,
                               'role', m.role,
                               'content', m.content,
                               'metadata', m.metadata,
                               'created_at', m.created_at
                             )
                             ORDER BY m.created_at ASC, m.id ASC
                           )
                    FROM (
                      SELECT *
                        FROM "messages"
                       WHERE conversation_id = c.id
                         AND deleted_at IS NULL
                    ORDER BY created_at ASC, id ASC
                       LIMIT 100
                    ) m
                  ),
                  ARRAY[]::jsonb[]
                ) AS messages
                FROM "conversations" c
               WHERE c."user_id" = ${userId}::uuid
                 AND c."deleted_at" IS NULL${keysetWhere}${orderLimit}
            `)) as { rows?: ConversationWithMessagesRow[] };
            return result.rows ?? [];
          });

          return reply.code(200).send({
            conversations: rowsWithMessages.map((row) => ({
              ...rowToCloudConversation(row),
              messages: Array.isArray(row.messages) ? row.messages.map(rowToCloudMessage) : [],
            })),
          });
        }

        // Default branch (Task 1) — no messages embedded.
        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            SELECT * FROM "conversations"
             WHERE "user_id" = ${userId}::uuid${softDelete}${keysetWhere}${orderLimit}
          `)) as { rows?: CloudConversationRow[] };
          return result.rows ?? [];
        });

        return reply.code(200).send({ conversations: rows.map(rowToCloudConversation) });
      },
    });
  };

export default buildConversationsListRoutes;
