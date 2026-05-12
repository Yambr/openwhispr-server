// Phase 07.1 / Plan 06 — TanStack Query 5 key factory (D-STACK-3).
//
// Mirrors RESEARCH § Pattern 5 byte-for-byte. Every screen-level hook (Plans
// 07..12) imports `queryKeys.*` so cache-bucket identity is centralised:
// changes here propagate to every consumer without grep-and-replace.
//
// Keys are `as const` tuples so TanStack Query's type inference flows the
// literal shape through to `useQuery({ queryKey: ... })`. Cursor objects
// are passed by reference at the call site, which is fine — TanStack
// serialises them via JSON.stringify for cache-key equality.
export interface ListCursor {
  limit: number;
  before?: string;
  since?: string;
}

export interface MessagesCursor {
  limit: number;
  before?: string;
}

export const queryKeys = {
  usage: () => ["usage"] as const,
  session: () => ["auth", "session"] as const,
  sessions: () => ["auth", "sessions"] as const,
  sttConfig: () => ["stt-config"] as const,
  noteRecordingConfig: () => ["note-recording-config"] as const,
  transcriptions: {
    list: (cursor: ListCursor) => ["transcriptions", "list", cursor] as const,
    detail: (id: string) => ["transcriptions", "detail", id] as const,
  },
  notes: {
    list: (cursor: ListCursor) => ["notes", "list", cursor] as const,
    detail: (id: string) => ["notes", "detail", id] as const,
    search: (q: string) => ["notes", "search", q] as const,
  },
  folders: () => ["folders"] as const,
  conversations: {
    list: (cursor: ListCursor) => ["conversations", "list", cursor] as const,
    messages: (id: string, cursor?: MessagesCursor) =>
      ["conversations", "messages", id, cursor] as const,
    search: (q: string) => ["conversations", "search", q] as const,
  },
} as const;
