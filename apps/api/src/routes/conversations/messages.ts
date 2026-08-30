// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 07 / Task 3 — /api/conversations/messages (WIRE-25).
//
// Dual-method endpoint (mirrors ConversationsService.addMessage +
// getMessages in ~/openwhispr/src/services/ConversationsService.ts):
//
//   POST  /api/conversations/messages
//     body  { conversation_id: uuid, role, content, metadata?, client_message_id? }
//     201   CloudMessage   (single-message only per v1 — D-22 +
//                           Claude's Discretion documented in 05-CONTEXT.md).
//                           Phase 56 / Plan 56-04 — R10 client contract
//                           conformance, flipped 200 → 201 Created.
//                           Idempotent replay also returns 201.
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
import { METADATA_MAX_BYTES, MetadataSchema } from "@openwhispr/wire-schemas";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthError, NotFoundError, ValidationError } from "../../errors.js";
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
// Plan 51-12c — de-exported (LOCKER-04 dead-export, no external
// consumers).
// Sourced from the canonical schema rather than restated. This defence-in-depth
// check and MetadataSchema's own refinement used to carry the number
// independently, so raising the schema cap for desktop tool-call metadata would
// have left the route rejecting at the old 4 KiB — accepted on create, refused
// on the very next message.
const MESSAGE_METADATA_MAX_BYTES = METADATA_MAX_BYTES;

// Phase 51 / Plan 51-12 (REVIEW routes-conversations HIGH) — content
// length cap. Pre-fix the metadata field was capped at 4 KiB but
// `content` was unconstrained (`z.string()`); the asymmetry meant
// every message INSERT was bounded only by Fastify's global
// bodyLimit, producing a cost-multiplier vector when content is
// forwarded to LiteLLM downstream. 256 KiB is generous for a
// conversational turn and aligned with the LiteLLM context-window
// floor.
//
// Plan 51-12c — de-exported (LOCKER-04 dead-export). The only external
// consumer was the regression test which now reads it through the
// source file directly.
const MESSAGE_CONTENT_MAX_BYTES = 256 * 1024;

// H-2 (Phase 64) — role enum aligned DOWN to the canonical
// `ConversationRoleSchema` from `@openwhispr/wire-schemas`. The server
// previously accepted `"tool"`, a unilateral widening the OUTPUT
// contract (`CloudMessageSchema`) and the upstream client persistence
// interface (`ConversationsService.ts`) both reject.
const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

const MessageInputSchema = z
  .object({
    conversation_id: z.string().uuid(),
    role: MessageRoleSchema,
    content: z.string().max(MESSAGE_CONTENT_MAX_BYTES),
    // H-3 (Phase 64) — adopt the canonical MetadataSchema (bounded keys,
    // scalar values, 4 KiB cap) instead of an ad-hoc looser
    // z.record(z.string(), z.unknown()). The runtime 4 KiB check below
    // is kept as defence-in-depth (the cap is now ALSO enforced here).
    metadata: MetadataSchema.nullable().optional(),
    client_message_id: z.string().optional(),
  })
  .strict();

// Plan 51-12c — explicit zod schema for the GET querystring so the
// route declaration carries `schema: { querystring }` per LOCKER-04
// invariant 14. The handler still uses `parseListQuery(q)` for the
// keyset-pagination shape — this schema is the surface-level guard.
const MessagesListQuerySchema = z
  .object({
    conversation_id: z.string().min(1),
    limit: z.string().optional(),
    before: z.string().optional(),
    since: z.string().optional(),
  })
  .strict();
type ListQuery = z.infer<typeof MessagesListQuerySchema>;

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
      // Plan 51-12c — schema:body for LOCKER-04 (handler still calls
      // `.parse()` since Fastify's stock ZodCompiler is not attached).
      schema: { body: MessageInputSchema },
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const body = MessageInputSchema.parse(req.body);

        // T-MSG-INJ — 4 KiB metadata cap. Defence-in-depth: the canonical
        // MetadataSchema (H-3, Phase 64) now also enforces this cap at the
        // schema layer; this runtime check is kept so the METADATA_TOO_LARGE
        // i18n code path stays exercised.
        const metaBytes = Buffer.byteLength(JSON.stringify(body.metadata ?? {}), "utf8");
        if (metaBytes > MESSAGE_METADATA_MAX_BYTES) {
          throw new ValidationError(
            "METADATA_TOO_LARGE",
            `metadata exceeds ${MESSAGE_METADATA_MAX_BYTES} bytes`,
          );
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
          throw new NotFoundError("CONVERSATION_NOT_FOUND", "conversation not found");
        }
        return reply.code(201).send(rowToCloudMessage(result));
      },
    });

    // -----------------------------------------------------------------
    // GET /api/conversations/messages — keyset list of one conv.
    // -----------------------------------------------------------------
    app.route({
      method: "GET",
      url: "/api/conversations/messages",
      // Plan 51-12c — schema:querystring for LOCKER-04.
      schema: { querystring: MessagesListQuerySchema },
      config: { rateLimit: { max: 240, timeWindow: "1 minute" } },
      handler: async (req, reply) => {
        if (!req.user || !req.tenant) {
          throw new AuthError("UNAUTHORIZED", "unauthorized");
        }
        const q = (req.query ?? {}) as ListQuery;
        const conversationId = q.conversation_id;
        if (!conversationId || typeof conversationId !== "string") {
          throw new ValidationError("CONVERSATION_ID_REQUIRED", "conversation_id required");
        }
        // UUID sanity check — keep the SQL cast from raising.
        const uuidRe =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRe.test(conversationId)) {
          throw new ValidationError("INVALID_UUID", "conversation_id must be a UUID");
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
          throw new NotFoundError("CONVERSATION_NOT_FOUND", "conversation not found");
        }
        return reply.code(200).send({ messages: rows.map(rowToCloudMessage) });
      },
    });
  };

export default buildConversationsMessagesRoutes;
