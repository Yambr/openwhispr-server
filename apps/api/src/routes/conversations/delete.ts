// Phase 05 / Plan 07 / Task 1 — DELETE /api/conversations/delete (WIRE-24).
//
// Wire shape:
//   Request:  { id: string }
//   Success:  200 { ok: true }
//   404:      not found / cross-tenant
//
// D-23 — soft delete. Sets deleted_at = NOW() on the conversation.
// Messages remain in their table; ON DELETE CASCADE only fires on HARD
// delete of the parent conversation (which never happens in this route).
// Messages remain physically present but become unreachable via the
// /api/conversations/messages routes because GET filters by the
// conversation's existence under withSoftDelete().
import {
  type ExecutableTx,
  type TransactionalDb,
  withTenant,
} from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const DeleteBodySchema = z.object({
  id: z.string().uuid(),
});

export interface ConversationsDeleteDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildConversationsDeleteRoutes = (deps: ConversationsDeleteDeps) =>
  async function conversationsDeleteRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "DELETE",
      url: "/api/conversations/delete",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const body = DeleteBodySchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const updated = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            UPDATE "conversations"
               SET "deleted_at" = NOW()
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING "id"
          `)) as { rows?: { id: string }[] };
          return result.rows?.[0];
        });

        if (!updated) {
          return reply.code(404).send({ error: "conversation not found" });
        }
        return reply.code(200).send({ ok: true });
      },
    });
  };

export default buildConversationsDeleteRoutes;
