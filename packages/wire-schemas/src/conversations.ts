// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/conversations/* family.
 * Mirrors ~/openwhispr/src/services/ConversationsService.ts byte-for-byte (D-22).
 */
import { z } from "zod";

export const ConversationRoleSchema = z.enum(["user", "assistant", "system"]);

export const ConversationInputSchema = z.object({
  client_conversation_id: z.string().optional(),
  title: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: ConversationRoleSchema,
        content: z.string(),
        metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      }),
    )
    .optional(),
});
export type ConversationInput = z.infer<typeof ConversationInputSchema>;

export const CloudConversationSchema = z.object({
  id: z.string(),
  client_conversation_id: z.string().nullable(),
  title: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CloudConversation = z.infer<typeof CloudConversationSchema>;

export const CloudMessageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: ConversationRoleSchema,
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});
export type CloudMessage = z.infer<typeof CloudMessageSchema>;

export const CloudConversationWithMessagesSchema = CloudConversationSchema.extend({
  messages: z.array(CloudMessageSchema).optional(),
});
export type CloudConversationWithMessages = z.infer<typeof CloudConversationWithMessagesSchema>;
