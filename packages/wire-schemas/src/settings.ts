/**
 * Phase 5 / Plan 01 — Wire schemas for /api/stt-config + /api/note-recording-config.
 *
 * Tenant- and user-scoped settings response shapes per BACKEND_SPEC.md:430-478.
 * Per D-31 these are read-only in v1; mutations are deferred to Phase 7.
 */
import { z } from "zod";

export const SttConfigResponseSchema = z.object({
  defaultModel: z.string(),
  defaultLanguage: z.string(),
  availableProviders: z.array(z.string()),
});
export type SttConfigResponse = z.infer<typeof SttConfigResponseSchema>;

export const NoteRecordingConfigResponseSchema = z.object({
  maxDurationSeconds: z.number(),
  sampleRateHz: z.number(),
  allowedFormats: z.array(z.string()),
  diarizationEnabled: z.boolean(),
});
export type NoteRecordingConfigResponse = z.infer<typeof NoteRecordingConfigResponseSchema>;
