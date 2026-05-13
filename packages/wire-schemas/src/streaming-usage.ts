// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 5 / Plan 01 — Wire schema for POST /api/streaming-usage.
 *
 * 14 fields per BACKEND_SPEC.md:377-412. Required: sessionId + audioDurationSeconds.
 * All other fields optional. `sendLogs` defaults to false.
 */
import { z } from "zod";

export const StreamingUsageBodySchema = z.object({
  // Required
  sessionId: z.string(),
  audioDurationSeconds: z.number().min(0),
  // Optional
  text: z.string().optional(),
  clientType: z.string().optional(),
  appVersion: z.string().optional(),
  clientVersion: z.string().optional(),
  sttProvider: z.string().optional(),
  sttModel: z.string().optional(),
  sttProcessingMs: z.number().optional(),
  sttLanguage: z.string().optional(),
  audioSizeBytes: z.number().optional(),
  audioFormat: z.string().optional(),
  clientTotalMs: z.number().optional(),
  sendLogs: z.boolean().optional().default(false),
});
export type StreamingUsageBody = z.infer<typeof StreamingUsageBodySchema>;
