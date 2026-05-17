// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 07 / Task 1 — POST /api/conversations/create (WIRE-24).
//
// Wire shape (matches ~/openwhispr/src/services/ConversationsService.ts):
//   Request:  ConversationInput
//   Success:  200 CloudConversation
//
// D-24 — same client_conversation_id on retry returns the existing row
//        (200, NOT 409). Pattern 1 — createOrReturnExisting() from
//        apps/api/src/lib/client-id-upsert.ts.
//
// Note: ConversationInput.messages[] is accepted by the upstream
// interface but NOT persisted by /create per upstream service
// (messages are added separately via /api/conversations/messages).
// We follow that contract — the `messages` field is silently ignored.
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { ConversationInputSchema } from "@openwhispr/wire-schemas";
import type { FastifyInstance } from "fastify";
import { AuthError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import { type CloudConversationRow, rowToCloudConversation } from "./shape.js";

export interface ConversationsCreateDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildConversationsCreateRoutes = (deps: ConversationsCreateDeps) =>
  async function conversationsCreateRoutes(app: FastifyInstance): Promise<void> {
    app.route({
      method: "POST",
      url: "/api/conversations/create",
      // Plan 51-12c — schema:body for LOCKER-04.
      schema: { body: ConversationInputSchema },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = ConversationInputSchema.parse(req.body);
        const tenantId = req.tenant;
        const userId = req.user.id;

        const row = await withTenant(deps.db, tenantId, async (tx) => {
          const insertValues: Record<string, unknown> = {
            tenant_id: tenantId,
            user_id: userId,
            client_conversation_id: body.client_conversation_id ?? null,
            title: body.title ?? "",
          };
          const { row } = await createOrReturnExisting<CloudConversationRow>(tx, {
            table: "conversations",
            clientIdColumn: "client_conversation_id",
            tenantId,
            userId,
            clientIdValue: body.client_conversation_id ?? null,
            insertValues,
          });
          return row;
        });

        return reply.code(200).send(rowToCloudConversation(row));
      },
    });
  };

export default buildConversationsCreateRoutes;
