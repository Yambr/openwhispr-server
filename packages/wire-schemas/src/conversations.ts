// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/conversations/* family.
 * Mirrors ~/openwhispr/src/services/ConversationsService.ts byte-for-byte (D-22).
 *
 * Phase 39 — HIGH sweep: `.strict()` on inputs (incl. nested messages),
 * UUID + ISO-8601 on output, bounded message content + metadata (max 4 KB
 * stringified, bounded keys + scalar values).
 *
 * R35 (quick-task 20260522) — INPUT `created_at`/`updated_at` accept the
 * SQLite space form via the lenient `INPUT_DATETIME`. The Cloud* RESPONSE
 * schemas stay strict RFC-3339.
 */
import { z } from "zod";
import { INPUT_DATETIME } from "./input-datetime.js";

const ISO_DATETIME = z.string().datetime({ offset: true });
const UUID = z.string().uuid();
const TITLE_MAX = 1024;
const CLIENT_ID = z.string().min(1).max(128);
const MESSAGE_CONTENT_MAX = 256 * 1024; // 256 KB
// The desktop stores an assistant turn's tool calls here, and a search_notes
// result set is comfortably larger than the original 4 KiB. The cap — not the
// value type — is the anti-abuse control (T-MSG-INJ), so it stays, just sized
// for the payload the client it mirrors actually produces. Still an order of
// magnitude under MESSAGE_CONTENT_MAX, which is the field that gets forwarded
// downstream and therefore carries the cost multiplier.
export const METADATA_MAX_BYTES = 64 * 1024;

export const ConversationRoleSchema = z.enum(["user", "assistant", "system"]);

// H-3 (Phase 64) — exported so the server's conversations/messages.ts
// can adopt this canonical shape instead of an ad-hoc looser schema.
//
// Phase 68 / Plan 68-01 — REVIEW wire-schemas HIGH H-1: the
// size-refinement message is the stable machine key `metadata.too_large`
// (NOT inline English). The route maps the key through i18next so the
// end-user error message is localized — wire schemas must never carry an
// inline-English end-user string.
// Metadata holds arbitrary JSON, bounded by SIZE and DEPTH rather than by
// value type. The previous scalar-only union modeled a narrower client than the
// one this package mirrors: the desktop persists
// `metadata: { toolCalls: ToolCallInfo[] }` (chat/useChatPersistence.ts), where
// each entry nests objects and — for search_notes — an array of them
// (chat/types.ts). Every conversation push carrying an agent turn 400'd on the
// `toolCalls` key, so agent history never synced.
//
// The depth bound is not decoration. A recursive Zod value schema would
// stack-overflow on a payload that nests thousands of arrays inside the size
// cap — turning a validation rule into a crash — so the walk below is
// ITERATIVE and rejects anything deeper than a tool-call payload can justify.
const METADATA_MAX_DEPTH = 8;

function withinMetadataDepth(value: unknown): boolean {
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };
    if (depth > METADATA_MAX_DEPTH) return false;
    if (Array.isArray(node)) {
      for (const item of node) stack.push({ node: item, depth: depth + 1 });
    } else if (node !== null && typeof node === "object") {
      for (const item of Object.values(node)) stack.push({ node: item, depth: depth + 1 });
    }
  }
  return true;
}

export const MetadataSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .refine((meta) => JSON.stringify(meta).length <= METADATA_MAX_BYTES, {
    message: "metadata.too_large",
  })
  .refine(withinMetadataDepth, { message: "metadata.too_deep" });

export const ConversationInputSchema = z
  .object({
    client_conversation_id: CLIENT_ID.optional(),
    title: z.string().max(TITLE_MAX).optional(),
    created_at: INPUT_DATETIME.optional(),
    updated_at: INPUT_DATETIME.optional(),
    messages: z
      .array(
        z
          .object({
            role: ConversationRoleSchema,
            content: z.string().max(MESSAGE_CONTENT_MAX),
            // R36 — the immutable client's SyncService maps every
            // message `metadata: m.metadata ? (...) : null`, so a
            // message without metadata carries an EXPLICIT null.
            // `.nullish()` (= optional + nullable) accepts absent OR
            // null OR a populated object; `.optional()` alone rejected
            // the null and 400'd every conversation sync.
            metadata: MetadataSchema.nullish(),
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
