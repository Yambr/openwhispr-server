// Phase 05 / Plan 07 / Task 3 — /api/conversations/messages (WIRE-25).
//
// Dual-method endpoint (mirrors ConversationsService.addMessage +
// getMessages in ~/openwhispr/src/services/ConversationsService.ts):
//
//   POST  /api/conversations/messages
//     body  { conversation_id: uuid, role, content, metadata?, client_message_id? }
//     200   CloudMessage   (single-message only per v1 — D-22 +
//                           Claude's Discretion documented in 05-CONTEXT.md)
//     400   metadata exceeds 4 KiB envelope (T-MSG-INJ mitigation)
//     400   conversation_id missing / unknown role
//     404   conversation_id not found / cross-tenant invisible
//     idempotency — same client_message_id returns the existing row,
//                   NEVER 409 (D-24)
//
//   GET   /api/conversations/messages?conversation_id=<uuid>&limit=&before=&since=
//     200   { messages: CloudMessage[] }
//     400   conversation_id missing
//     keyset paginated on (created_at, id) DESC; soft-deleted excluded.
//
// RLS: conversations + messages both FORCE-RLS on tenant_id. We
// additionally bind by user_id in every WHERE clause to keep EXPLAIN
// output obvious (matches the established Plan 05 pattern).
import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError } from "../../errors.js";
import { createOrReturnExisting } from "../../lib/client-id-upsert.js";
import {
  buildKeysetOrderLimit,
  buildKeysetWhere,
  parseListQuery,
} from "../../lib/keyset-pagination.js";
import { withSoftDelete } from "../../lib/soft-delete.js";
import { type CloudMessageRow, rowToCloudMessage } from "./shape.js";

// T-MSG-INJ — 4 KiB metadata cap. The check runs against the JSON
// serialization of the parsed body.metadata object so callers can't
// smuggle bytes via whitespace; we re-stringify with no spaces.
export const MESSAGE_METADATA_MAX_BYTES = 4096;

const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

const MessageInputSchema = z
  .object({
    conversation_id: z.string().uuid(),
    role: MessageRoleSchema,
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    client_message_id: z.string().optional(),
  })
  .strict();

interface ListQuery {
  conversation_id?: string;
  limit?: string;
  before?: string;
  since?: string;
}

export interface ConversationsMessagesDeps {
  db: TransactionalDb<ExecutableTx>;
}

export const buildConversationsMessagesRoutes = (deps: ConversationsMessagesDeps) =>
  async function conversationsMessagesRoutes(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------
    // POST /api/conversations/messages — add a single message.
    // -----------------------------------------------------------------
    app.route({
      method: "POST",
      url: "/api/conversations/messages",
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = MessageInputSchema.parse(req.body);

        // T-MSG-INJ — 4 KiB metadata cap.
        const metaBytes = Buffer.byteLength(JSON.stringify(body.metadata ?? {}), "utf8");
        if (metaBytes > MESSAGE_METADATA_MAX_BYTES) {
          return reply.code(400).send({ error: "metadata exceeds 4096 bytes (4KB cap)" });
        }

        const tenantId = req.tenant;
        const userId = req.user.id;

        // Step 1 — assert the conversation belongs to this user
        // (cross-tenant invisible via FORCE-RLS; cross-user via WHERE).
        const result = await withTenant(deps.db, tenantId, async (tx) => {
          const owns = (await tx.execute(sql`
            SELECT "id" FROM "conversations"
             WHERE "id" = ${body.conversation_id}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             LIMIT 1
          `)) as { rows?: { id: string }[] };
          if (!owns.rows?.[0]) return null;

          const insertValues: Record<string, unknown> = {
            conversation_id: body.conversation_id,
            tenant_id: tenantId,
            user_id: userId,
            role: body.role,
            content: body.content,
            metadata: JSON.stringify(body.metadata ?? {}),
            client_message_id: body.client_message_id ?? null,
          };
          const { row } = await createOrReturnExisting<CloudMessageRow>(tx, {
            table: "messages",
            clientIdColumn: "client_message_id",
            tenantId,
            userId,
            clientIdValue: body.client_message_id ?? null,
            insertValues,
          });
          return row;
        });

        if (!result) {
          return reply.code(404).send({ error: "conversation not found" });
        }
        return reply.code(200).send(rowToCloudMessage(result));
      },
    });

    // -----------------------------------------------------------------
    // GET /api/conversations/messages — keyset list of one conv.
    // -----------------------------------------------------------------
    app.route({
      method: "GET",
      url: "/api/conversations/messages",
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const q = (req.query ?? {}) as ListQuery;
        const conversationId = q.conversation_id;
        if (!conversationId || typeof conversationId !== "string") {
          return reply.code(400).send({ error: "conversation_id required" });
        }
        // UUID sanity check — keep the SQL cast from raising.
        const uuidRe =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRe.test(conversationId)) {
          return reply.code(400).send({ error: "conversation_id must be a UUID" });
        }

        let parsed: ReturnType<typeof parseListQuery>;
        try {
          parsed = parseListQuery(q);
        } catch (err) {
          return reply
            .code(400)
            .send({ error: err instanceof Error ? err.message : "invalid query" });
        }

        const tenantId = req.tenant;
        const userId = req.user.id;
        const keysetWhere = buildKeysetWhere(parsed);
        const softDelete = withSoftDelete();
        const orderLimit = buildKeysetOrderLimit(parsed);

        // Confirm the user owns the conversation (404 otherwise so
        // we don't disclose existence to cross-tenant probes).
        const rows = await withTenant(deps.db, tenantId, async (tx) => {
          const owns = (await tx.execute(sql`
            SELECT "id" FROM "conversations"
             WHERE "id" = ${conversationId}::uuid
               AND "user_id" = ${userId}::uuid
               AND "deleted_at" IS NULL
             LIMIT 1
          `)) as { rows?: { id: string }[] };
          if (!owns.rows?.[0]) return null;

          const result = (await tx.execute(sql`
            SELECT * FROM "messages"
             WHERE "conversation_id" = ${conversationId}::uuid
               AND "user_id" = ${userId}::uuid${softDelete}${keysetWhere}${orderLimit}
          `)) as { rows?: CloudMessageRow[] };
          return result.rows ?? [];
        });

        if (rows === null) {
          return reply.code(404).send({ error: "conversation not found" });
        }
        return reply.code(200).send({ messages: rows.map(rowToCloudMessage) });
      },
    });
  };

export default buildConversationsMessagesRoutes;
