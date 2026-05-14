// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/transcriptions/* family.
 * Mirrors ~/openwhispr/src/services/TranscriptionsService.ts byte-for-byte (D-22).
 */
import { z } from "zod";

export const TranscriptionInputSchema = z.object({
  client_transcription_id: z.string().optional(),
  text: z.string(),
  raw_text: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  audio_duration_ms: z.number().nullable().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
});
export type TranscriptionInput = z.infer<typeof TranscriptionInputSchema>;

export const CloudTranscriptionSchema = z.object({
  id: z.string(),
  client_transcription_id: z.string().nullable(),
  text: z.string(),
  raw_text: z.string().nullable(),
  word_count: z.number(),
  source: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  language: z.string().nullable(),
  audio_duration_ms: z.number().nullable(),
  status: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CloudTranscription = z.infer<typeof CloudTranscriptionSchema>;
