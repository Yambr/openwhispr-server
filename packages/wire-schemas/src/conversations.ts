// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/conversations/* family.
 * Mirrors ~/openwhispr/src/services/ConversationsService.ts byte-for-byte (D-22).
 *
 * Phase 39 — HIGH sweep: `.strict()` on inputs (incl. nested messages),
 * UUID + ISO-8601 on output, bounded message content + metadata (max 4 KB
 * stringified, bounded keys + scalar values).
 */
import { z } from "zod";

const ISO_DATETIME = z.string().datetime({ offset: true });
const UUID = z.string().uuid();
const TITLE_MAX = 1024;
const CLIENT_ID = z.string().min(1).max(128);
const MESSAGE_CONTENT_MAX = 256 * 1024; // 256 KB
const METADATA_MAX_BYTES = 4096;

export const ConversationRoleSchema = z.enum(["user", "assistant", "system"]);

// H-3 (Phase 64) — exported so the server's conversations/messages.ts
// can adopt this canonical shape instead of an ad-hoc looser schema.
export const MetadataSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(1024), z.number(), z.boolean()]))
  .refine((meta) => JSON.stringify(meta).length <= METADATA_MAX_BYTES, {
    message: "metadata too large",
  });

export const ConversationInputSchema = z
  .object({
    client_conversation_id: CLIENT_ID.optional(),
    title: z.string().max(TITLE_MAX).optional(),
    created_at: ISO_DATETIME.optional(),
    updated_at: ISO_DATETIME.optional(),
    messages: z
      .array(
        z
          .object({
            role: ConversationRoleSchema,
            content: z.string().max(MESSAGE_CONTENT_MAX),
            metadata: MetadataSchema.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type ConversationInput = z.infer<typeof ConversationInputSchema>;

export const CloudConversationSchema = z.object({
  id: UUID,
  client_conversation_id: CLIENT_ID.nullable(),
  title: z.string().max(TITLE_MAX),
  archived_at: ISO_DATETIME.nullable(),
  deleted_at: ISO_DATETIME.nullable(),
  created_at: ISO_DATETIME,
  updated_at: ISO_DATETIME,
});
export type CloudConversation = z.infer<typeof CloudConversationSchema>;

export const CloudMessageSchema = z.object({
  id: UUID,
  conversation_id: UUID,
  role: ConversationRoleSchema,
  content: z.string().max(MESSAGE_CONTENT_MAX),
  metadata: MetadataSchema.nullable(),
  created_at: ISO_DATETIME,
});
export type CloudMessage = z.infer<typeof CloudMessageSchema>;

export const CloudConversationWithMessagesSchema = CloudConversationSchema.extend({
  messages: z.array(CloudMessageSchema).optional(),
});
export type CloudConversationWithMessages = z.infer<typeof CloudConversationWithMessagesSchema>;
