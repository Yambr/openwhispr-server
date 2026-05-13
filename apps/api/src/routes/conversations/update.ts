// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 07 / Task 1 — PATCH /api/conversations/update (WIRE-24).
//
// Wire shape (matches ConversationsService.update):
//   Request:  { id: string, title?: string, archived_at?: string | null }
//   Success:  200 CloudConversation
//   404:      cross-tenant / cross-user / soft-deleted (RLS invisible)
//
// Static allowlist of mutable columns. updated_at is bumped server-side.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError } from "../../errors.js";
import { type CloudConversationRow, rowToCloudConversation } from "./shape.js";

const MUTABLE_COLS = ["title", "archived_at"] as const;
type MutableCol = (typeof MUTABLE_COLS)[number];

const UpdateBodySchema = z.object({
  id: z.string().uuid(),
  title: z.string().optional(),
  archived_at: z.string().nullable().optional(),
});

const FIELD_MAP: Record<string, MutableCol> = {
  title: "title",
  archived_at: "archived_at",
};

export interface ConversationsUpdateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildConversationsUpdateRoutes = (deps: ConversationsUpdateDeps) =>
  async function conversationsUpdateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "PATCH",
      url: "/api/conversations/update",
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = UpdateBodySchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const setFragments = [];
        for (const [key, col] of Object.entries(FIELD_MAP)) {
          if (Object.hasOwn(body, key)) {
            const v = (body as Record<string, unknown>)[key];
            setFragments.push(sql`${sql.raw(`"${col}"`)} = ${v as unknown}`);
          }
        }
        setFragments.push(sql`"updated_at" = NOW()`);

        const setClause = setFragments.reduce<ReturnType<typeof sql>>(
          (acc, frag, i) => (i === 0 ? frag : sql`${acc}, ${frag}`),
          sql``,
        );

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          const result = (await tx.execute(sql`
            UPDATE "conversations"
               SET ${setClause}
             WHERE "id" = ${body.id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             RETURNING *
          `)) as { rows?: CloudConversationRow[] };
          return result.rows?.[0];
        });

        if (!row) {
          throw new NotFoundError("CONVERSATION_NOT_FOUND", "conversation not found");
        }
        return reply.code(200).send(rowToCloudConversation(row));
      },
    });
  };

export default buildConversationsUpdateRoutes;
