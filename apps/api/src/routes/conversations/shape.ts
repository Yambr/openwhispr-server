// Phase 05 / Plan 07 — shared row→wire shape helpers for conversations
// and messages routes.
//
// Wire shapes mirror ~/openwhispr/src/services/ConversationsService.ts
// byte-for-byte (D-22):
//
//   CloudConversation = {
//     id, client_conversation_id, title, archived_at, deleted_at,
//     created_at, updated_at
//   }
//
//   CloudMessage = {
//     id, conversation_id, role, content, metadata, created_at
//   }
//
//   CloudConversationWithMessages extends CloudConversation with
//     optional `messages: CloudMessage[]` (D-27 array_agg branch).

export interface CloudConversationRow {
  id: string;
  tenant_id?: string;
  user_id?: string;
  client_conversation_id: string | null;
  title: string;
  archived_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CloudMessageRow {
  id: string;
  conversation_id: string;
  tenant_id?: string;
  user_id?: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  client_message_id?: string | null;
  created_at: Date | string;
  updated_at?: Date | string;
  deleted_at?: Date | string | null;
}

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isoNonNull(v: Date | string | null | undefined): string {
  return isoOrNull(v) ?? "";
}

export function rowToCloudConversation(row: CloudConversationRow): {
  id: string;
  client_conversation_id: string | null;
  title: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    client_conversation_id: row.client_conversation_id ?? null,
    title: row.title ?? "",
    archived_at: isoOrNull(row.archived_at),
    deleted_at: isoOrNull(row.deleted_at),
    created_at: isoNonNull(row.created_at),
    updated_at: isoNonNull(row.updated_at),
  };
}

export function rowToCloudMessage(row: CloudMessageRow): {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
} {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content ?? "",
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    created_at: isoNonNull(row.created_at),
  };
}
