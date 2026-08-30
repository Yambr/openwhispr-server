// SPDX-License-Identifier: FSL-1.1-ALv2
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

import { TranscriptionStatusSchema } from "@openwhispr/wire-schemas";

// R35 (quick-task 20260522) — the immutable client's local SQLite
// `transcriptions.status` is unconstrained free TEXT; the INPUT schema
// now tolerates any string. The DB column is free `text` (no CHECK), but
// `rowToCloudTranscription` echoes `row.status` into the strict
// `CloudTranscriptionSchema` RESPONSE. To keep the documented RESPONSE
// contract honest, map an unknown input status to a canonical
// `TranscriptionStatus` before insert — the SERVER stores its own
// canonical status; the raw client value is the client's local concern.
export function normalizeTranscriptionStatus(status: string): string {
  return TranscriptionStatusSchema.safeParse(status).success ? status : "completed";
}

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
  // Rows read through a raw `tx.execute` arrive as node-postgres TEXT
  // ("2026-01-01 00:00:00+00"), not Date objects, so the list paths emitted a
  // non-ISO timestamp while create/update emitted ISO for the very same row.
  // The desktop hands this value straight back as its `?before=` / `?since=`
  // cursor, and URL decoding turns the `+00` offset into a space — the next
  // page 400s on an unparseable timestamp. The wire schema declares ISO 8601,
  // so normalize here and the shape is identical whichever route produced it.
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? String(v) : parsed.toISOString();
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
