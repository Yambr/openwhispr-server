// Phase 05 / Plan 08 — shared row→wire shape helper for transcriptions.
//
// Mirrors apps/api/src/routes/notes/shape.ts and folders/shape.ts.
// Every transcriptions route MUST route through rowToCloudTranscription()
// so wire-shape drift is impossible.
//
// Upstream CloudTranscription per
// ~/openwhispr/src/services/TranscriptionsService.ts (14 fields):
//   id, client_transcription_id, text, raw_text, word_count, source,
//   provider, model, language, audio_duration_ms, status,
//   deleted_at, created_at, updated_at
//
// NOTE: tenant_id, user_id, duration_seconds exist in the DB but are
// intentionally OMITTED from the wire shape (D-22 byte-for-byte).

export interface CloudTranscriptionRow {
  id: string;
  tenant_id?: string;
  user_id?: string;
  text: string;
  raw_text: string | null;
  word_count: number | string;
  source: string;
  provider: string | null;
  model: string | null;
  language: string | null;
  audio_duration_ms: number | string | null;
  duration_seconds?: number | string | null;
  status: string;
  client_transcription_id: string | null;
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

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a raw transcriptions-row to the canonical CloudTranscription
 * wire shape (~/openwhispr/src/services/TranscriptionsService.ts).
 */
export function rowToCloudTranscription(row: CloudTranscriptionRow): {
  id: string;
  client_transcription_id: string | null;
  text: string;
  raw_text: string | null;
  word_count: number;
  source: string;
  provider: string | null;
  model: string | null;
  language: string | null;
  audio_duration_ms: number | null;
  status: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    client_transcription_id: row.client_transcription_id ?? null,
    text: row.text ?? "",
    raw_text: row.raw_text ?? null,
    word_count: Number(row.word_count ?? 0),
    source: row.source ?? "desktop",
    provider: row.provider ?? null,
    model: row.model ?? null,
    language: row.language ?? null,
    audio_duration_ms: numOrNull(row.audio_duration_ms),
    status: row.status ?? "completed",
    deleted_at: isoOrNull(row.deleted_at),
    created_at: isoNonNull(row.created_at),
    updated_at: isoNonNull(row.updated_at),
  };
}
