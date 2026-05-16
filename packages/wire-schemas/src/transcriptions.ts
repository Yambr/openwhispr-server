// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/transcriptions/* family.
 * Mirrors ~/openwhispr/src/services/TranscriptionsService.ts byte-for-byte (D-22).
 *
 * Phase 39 — HIGH sweep: `.strict()` on input, UUID + ISO-8601 + bounded
 * text on output, status enum, non-neg integer durations + word_count.
 */
import { z } from "zod";

const ISO_DATETIME = z.string().datetime({ offset: true });
const TEXT_MAX = 5 * 1024 * 1024; // 5 MB
const SHORT = 256;
const CLIENT_ID = z.string().min(1).max(128);

export const TranscriptionStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;

export const TranscriptionInputSchema = z
  .object({
    client_transcription_id: CLIENT_ID.optional(),
    text: z.string().max(TEXT_MAX),
    raw_text: z.string().max(TEXT_MAX).nullable().optional(),
    provider: z.string().max(SHORT).nullable().optional(),
    model: z.string().max(SHORT).nullable().optional(),
    language: z.string().max(SHORT).nullable().optional(),
    audio_duration_ms: z.number().int().nonnegative().nullable().optional(),
    status: TranscriptionStatusSchema.optional(),
    created_at: ISO_DATETIME.optional(),
  })
  .strict();
export type TranscriptionInput = z.infer<typeof TranscriptionInputSchema>;

export const CloudTranscriptionSchema = z.object({
  id: z.string().uuid(),
  client_transcription_id: CLIENT_ID.nullable(),
  text: z.string().max(TEXT_MAX),
  raw_text: z.string().max(TEXT_MAX).nullable(),
  word_count: z.number().int().nonnegative(),
  source: z.string().max(SHORT),
  provider: z.string().max(SHORT).nullable(),
  model: z.string().max(SHORT).nullable(),
  language: z.string().max(SHORT).nullable(),
  audio_duration_ms: z.number().int().nonnegative().nullable(),
  status: TranscriptionStatusSchema,
  deleted_at: ISO_DATETIME.nullable(),
  created_at: ISO_DATETIME,
  updated_at: ISO_DATETIME,
});
export type CloudTranscription = z.infer<typeof CloudTranscriptionSchema>;
