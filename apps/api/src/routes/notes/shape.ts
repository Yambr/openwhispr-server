// Phase 05 / Plan 05 — shared row→wire shape helper for notes routes.
//
// Every route handler returns the byte-for-byte upstream CloudNote
// shape per ~/openwhispr/src/services/NotesService.ts (D-22). The
// upstream interface uses snake_case keys + nullable everywhere except
// (id, content, note_type, created_at, updated_at). This module is
// the SINGLE place row→wire serialization happens — every route MUST
// route through rowToCloudNote() so the wire-shape drift is impossible.

export interface CloudNoteRow {
  id: string;
  tenant_id?: string;
  user_id?: string;
  client_note_id: string | null;
  title: string | null;
  content: string;
  note_type: string;
  enhanced_content: string | null;
  enhancement_prompt: string | null;
  source_file: string | null;
  audio_duration_seconds: number | null;
  folder_id: string | null;
  transcript: string | null;
  enhanced_at_content_hash: string | null;
  participants: string | null;
  calendar_event_id: string | null;
  diarization_enabled: number | null;
  expected_speaker_count: number | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function isoOrNull(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isoNonNull(v: Date | string | null | undefined): string {
  return isoOrNull(v) ?? "";
}

/**
 * Map a raw notes-row (pg/Drizzle return shape) to the canonical
 * CloudNote wire shape. Nullable-everywhere policy follows upstream
 * NotesService.ts.
 */
export function rowToCloudNote(row: CloudNoteRow): {
  id: string;
  client_note_id: string | null;
  title: string | null;
  content: string;
  enhanced_content: string | null;
  note_type: string;
  enhancement_prompt: string | null;
  source_file: string | null;
  audio_duration_seconds: number | null;
  folder_id: string | null;
  transcript: string | null;
  enhanced_at_content_hash: string | null;
  participants: string | null;
  calendar_event_id: string | null;
  diarization_enabled: number | null;
  expected_speaker_count: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    client_note_id: row.client_note_id ?? null,
    title: row.title ?? null,
    content: row.content ?? "",
    enhanced_content: row.enhanced_content ?? null,
    note_type: row.note_type ?? "personal",
    enhancement_prompt: row.enhancement_prompt ?? null,
    source_file: row.source_file ?? null,
    audio_duration_seconds:
      row.audio_duration_seconds === null || row.audio_duration_seconds === undefined
        ? null
        : Number(row.audio_duration_seconds),
    folder_id: row.folder_id ?? null,
    transcript: row.transcript ?? null,
    enhanced_at_content_hash: row.enhanced_at_content_hash ?? null,
    participants: row.participants ?? null,
    calendar_event_id: row.calendar_event_id ?? null,
    diarization_enabled:
      row.diarization_enabled === null || row.diarization_enabled === undefined
        ? null
        : Number(row.diarization_enabled),
    expected_speaker_count:
      row.expected_speaker_count === null || row.expected_speaker_count === undefined
        ? null
        : Number(row.expected_speaker_count),
    deleted_at: isoOrNull(row.deleted_at),
    created_at: isoNonNull(row.created_at),
    updated_at: isoNonNull(row.updated_at),
  };
}
