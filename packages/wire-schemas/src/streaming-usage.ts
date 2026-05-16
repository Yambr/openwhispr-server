// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 5 / Plan 01 — Wire schema for POST /api/streaming-usage.
 *
 * 14 fields per BACKEND_SPEC.md:377-412. Required: sessionId + audioDurationSeconds.
 * All other fields optional. `sendLogs` defaults to false.
 *
 * Phase 39 — HIGH sweep: `.strict()`, non-neg + finite numerics, bounded
 * short-text fields, bounded `text` payload.
 */
import { z } from "zod";

const SHORT = 256;
const TEXT_MAX = 5 * 1024 * 1024; // 5 MB
// sessionId acts as the idempotency-key; clients may supply opaque tokens,
// UUIDs, or hashed composite keys up to 4 KB. Stays bounded to refuse
// pathological multi-MB strings while accepting all real-world shapes.
const SESSION_ID = z.string().min(1).max(4096);

export const StreamingUsageBodySchema = z
  .object({
    // Required
    sessionId: SESSION_ID,
    audioDurationSeconds: z.number().nonnegative().finite(),
    // Optional
    text: z.string().max(TEXT_MAX).optional(),
    clientType: z.string().max(SHORT).optional(),
    appVersion: z.string().max(SHORT).optional(),
    clientVersion: z.string().max(SHORT).optional(),
    sttProvider: z.string().max(SHORT).optional(),
    sttModel: z.string().max(SHORT).optional(),
    sttProcessingMs: z.number().int().nonnegative().optional(),
    sttLanguage: z.string().max(SHORT).optional(),
    audioSizeBytes: z.number().int().nonnegative().optional(),
    audioFormat: z.string().max(SHORT).optional(),
    clientTotalMs: z.number().int().nonnegative().optional(),
    sendLogs: z.boolean().optional().default(false),
  })
  .strict();
export type StreamingUsageBody = z.infer<typeof StreamingUsageBodySchema>;
