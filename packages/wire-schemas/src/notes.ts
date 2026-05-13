// SPDX-License-Identifier: Apache-2.0
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
 */
import { z } from "zod";

const NoteTypeSchema = z.enum(["personal", "meeting", "upload"]);

export const NoteInputSchema = z.object({
  client_note_id: z.string().optional(),
  title: z.string().nullable().optional(),
  content: z.string().optional(),
  enhanced_content: z.string().nullable().optional(),
  enhancement_prompt: z.string().nullable().optional(),
  note_type: NoteTypeSchema.optional(),
  source_file: z.string().nullable().optional(),
  audio_duration_seconds: z.number().nullable().optional(),
  participants: z.string().nullable().optional(),
  calendar_event_id: z.string().nullable().optional(),
  diarization_enabled: z.number().nullable().optional(),
  expected_speaker_count: z.number().nullable().optional(),
  transcript: z.string().nullable().optional(),
  enhanced_at_content_hash: z.string().nullable().optional(),
  folder_id: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type NoteInput = z.infer<typeof NoteInputSchema>;

export const CloudNoteSchema = z.object({
  id: z.string(),
  client_note_id: z.string().nullable(),
  title: z.string().nullable(),
  content: z.string(),
  enhanced_content: z.string().nullable(),
  note_type: z.string(),
  enhancement_prompt: z.string().nullable(),
  source_file: z.string().nullable(),
  audio_duration_seconds: z.number().nullable(),
  folder_id: z.string().nullable(),
  transcript: z.string().nullable(),
  enhanced_at_content_hash: z.string().nullable(),
  participants: z.string().nullable(),
  calendar_event_id: z.string().nullable(),
  diarization_enabled: z.number().nullable(),
  expected_speaker_count: z.number().nullable(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CloudNote = z.infer<typeof CloudNoteSchema>;

export const SearchResultSchema = CloudNoteSchema.extend({
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;
