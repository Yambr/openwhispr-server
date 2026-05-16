// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schemas for /api/stt-config + /api/note-recording-config.
 *
 * Tenant- and user-scoped settings response shapes per BACKEND_SPEC.md:430-478.
 * Per D-31 these are read-only in v1; mutations are deferred to Phase 7.
 *
 * Phase 39 — HIGH sweep: bounded enums for providers/formats, non-neg
 * integer durations and sample rates.
 */
import { z } from "zod";

export const SttProviderSchema = z.enum(["openai", "groq", "speaches", "deepgram", "assemblyai"]);
export type SttProvider = z.infer<typeof SttProviderSchema>;

export const AudioFormatSchema = z.enum(["wav", "webm", "mp3", "m4a", "flac", "ogg"]);
export type AudioFormat = z.infer<typeof AudioFormatSchema>;

export const SttConfigResponseSchema = z.object({
  defaultModel: z.string().min(1).max(256),
  defaultLanguage: z.string().min(1).max(64),
  availableProviders: z.array(SttProviderSchema).max(16),
});
export type SttConfigResponse = z.infer<typeof SttConfigResponseSchema>;

export const NoteRecordingConfigResponseSchema = z.object({
  maxDurationSeconds: z.number().int().nonnegative(),
  sampleRateHz: z.number().int().nonnegative(),
  allowedFormats: z.array(AudioFormatSchema).max(16),
  diarizationEnabled: z.boolean(),
});
export type NoteRecordingConfigResponse = z.infer<typeof NoteRecordingConfigResponseSchema>;
