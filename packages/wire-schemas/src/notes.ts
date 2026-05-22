// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/notes/* family.
 *
 * Mirrors ~/openwhispr/src/services/NotesService.ts byte-for-byte
 * (CONTEXT D-22 canonical wire shape rule). When a TS field is
 * `string | null`, the Zod schema is `z.string().nullable()`. When
 * optional `field?: T`, the Zod schema is `z.T().optional()`.
 *
 * No deviation, no extras — the desktop client is the canonical "user"
 * and any divergence is a wire break.
 *
 * Phase 39 — HIGH sweep: `.strict()` on NoteInput, tightened primitives
 * on CloudNote (UUID + ISO-8601 datetime), bounded long-text fields,
 * symmetrical `note_type` enum, non-neg integer counts, `0|1` boolean-ish.
 *
 * R35 (quick-task 20260522) — INPUT `created_at`/`updated_at` accept the
 * SQLite space form via the lenient `INPUT_DATETIME`. `CloudNoteSchema`
 * (RESPONSE) stays strict RFC-3339.
 */
import { z } from "zod";
import { INPUT_DATETIME } from "./input-datetime.js";

export const NoteTypeSchema = z.enum(["personal", "meeting", "upload"]);
export type NoteType = z.infer<typeof NoteTypeSchema>;

const ISO_DATETIME = z.string().datetime({ offset: true });
const UUID = z.string().uuid();
const CLIENT_ID = z.string().min(1).max(128);

// BACKEND_SPEC limits per HI-3:
const CONTENT_MAX = 256 * 1024; // 256 KB
const TRANSCRIPT_MAX = 5 * 1024 * 1024; // 5 MB
const PROMPT_MAX = 16 * 1024; // 16 KB
const TITLE_MAX = 1024;
const SHORT_TEXT = 1024;
const HASH_MAX = 128;

export const NoteInputSchema = z
  .object({
    client_note_id: CLIENT_ID.optional(),
    title: z.string().max(TITLE_MAX).nullable().optional(),
    content: z.string().max(CONTENT_MAX).optional(),
    enhanced_content: z.string().max(CONTENT_MAX).nullable().optional(),
    enhancement_prompt: z.string().max(PROMPT_MAX).nullable().optional(),
    // R37 — the client's local SQLite `note_type` column is
    // unconstrained `TEXT NOT NULL DEFAULT 'personal'`; it can hold
    // values outside the canonical enum (e.g. `"note"`). The strict
    // `NoteTypeSchema` enum 400'd every such note sync. The INPUT
    // accepts any short string; the route normalizes an unknown value
    // to a canonical `NoteType` before storing. `CloudNoteSchema.note_type`
    // (the response) stays the strict enum. Mirrors the R35 transcription
    // `status` lenient-input / strict-output treatment.
    note_type: z.string().max(SHORT_TEXT).nullish(),
    source_file: z.string().max(SHORT_TEXT).nullable().optional(),
    audio_duration_seconds: z.number().nonnegative().finite().nullable().optional(),
    participants: z.string().max(SHORT_TEXT).nullable().optional(),
    calendar_event_id: z.string().max(SHORT_TEXT).nullable().optional(),
    // diarization_enabled is a legacy `0|1` integer flag per upstream client (M-6).
    diarization_enabled: z
      .union([z.literal(0), z.literal(1)])
      .nullable()
      .optional(),
    expected_speaker_count: z.number().int().nonnegative().max(32).nullable().optional(),
    transcript: z.string().max(TRANSCRIPT_MAX).nullable().optional(),
    enhanced_at_content_hash: z.string().max(HASH_MAX).nullable().optional(),
    folder_id: z.string().max(SHORT_TEXT).nullable().optional(),
    created_at: INPUT_DATETIME.optional(),
    updated_at: INPUT_DATETIME.optional(),
  })
  .strict();
export type NoteInput = z.infer<typeof NoteInputSchema>;

export const CloudNoteSchema = z.object({
  id: UUID,
  client_note_id: CLIENT_ID.nullable(),
  title: z.string().max(TITLE_MAX).nullable(),
  content: z.string().max(CONTENT_MAX),
  enhanced_content: z.string().max(CONTENT_MAX).nullable(),
  note_type: NoteTypeSchema,
  enhancement_prompt: z.string().max(PROMPT_MAX).nullable(),
  source_file: z.string().max(SHORT_TEXT).nullable(),
  audio_duration_seconds: z.number().nonnegative().finite().nullable(),
  folder_id: z.string().max(SHORT_TEXT).nullable(),
  transcript: z.string().max(TRANSCRIPT_MAX).nullable(),
  enhanced_at_content_hash: z.string().max(HASH_MAX).nullable(),
  participants: z.string().max(SHORT_TEXT).nullable(),
  calendar_event_id: z.string().max(SHORT_TEXT).nullable(),
  diarization_enabled: z.union([z.literal(0), z.literal(1)]).nullable(),
  expected_speaker_count: z.number().int().nonnegative().max(32).nullable(),
  deleted_at: ISO_DATETIME.nullable(),
  created_at: ISO_DATETIME,
  updated_at: ISO_DATETIME,
});
export type CloudNote = z.infer<typeof CloudNoteSchema>;

export const SearchResultSchema = CloudNoteSchema.extend({
  score: z.number().nonnegative().finite(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;
