// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 07 / Task 1 — DELETE /api/conversations/delete (WIRE-24).
//
// Wire shape:
//   Request:  { id: string }
//   Success:  204 No Content (empty body)   ← Phase 56 / Plan 56-04 R10
//             (flipped from 200 + {ok:true} for client contract
//             conformance; matches ConversationsService.deleteConversation
//             which discards the response and the SERVER-REQUIREMENTS.md
//             §R10 table.)
//   404:      not found / cross-tenant
//
// D-23 — soft delete. Sets deleted_at = NOW() on the conversation AND
// cascades soft-delete to all of its messages in the same transaction
// (Phase 56 / Plan 56-04 R10 — messages cannot survive without their
// parent conversation; cascade keeps the messages.deleted_at filter
// in sync with the conversation's lifecycle). The original D-23
// rationale (no HARD delete → preserve audit trail) still holds; we
// add a tombstone to each child row rather than physically removing
// it. GET /api/conversations/messages already gates on the parent
// conversation's existence under withSoftDelete(), so this cascade
// is defence-in-depth, not the primary visibility mechanism.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";

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
      // Plan 51-12c — schema:body for LOCKER-04.
      schema: { body: DeleteBodySchema },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
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
          const row = result.rows?.[0];
          if (!row) return undefined;
          // Phase 56 / Plan 56-04 R10 — cascade soft-delete to messages
          // in the SAME txn so the conversation + its children flip
          // atomically. Filter on deleted_at IS NULL so re-delete of an
          // already-deleted conversation (if it ever raced past the
          // guard above) wouldn't overwrite earlier tombstones.
          await tx.execute(sql`
            UPDATE "messages"
               SET "deleted_at" = NOW()
             WHERE "conversation_id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
          `);
          return row;
        });

        if (!updated) {
          throw new NotFoundError("CONVERSATION_NOT_FOUND", "conversation not found");
        }
        return reply.code(204).send();
      },
    });
  };

export default buildConversationsDeleteRoutes;
