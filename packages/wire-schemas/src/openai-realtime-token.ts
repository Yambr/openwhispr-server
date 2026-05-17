// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-08 (REVIEW CR-2) — wire schema for
// POST /api/openai-realtime-token.
//
// Pre-publication review found that the route at
// apps/api/src/routes/tokens/openai-realtime.ts:79 used a bare type
// assertion (`(req.body ?? {}) as RequestBody`) — no validation. The
// `body.model` field then flowed UNCAPPED into an outbound POST to
// OpenAI's `/v1/realtime/client_secrets`. Combined with the missing
// LOCKER-04 `schema:` declaration, an authed user could:
//   1. Bypass the streams=∈{1,2} allowlist by abusing zod's absence.
//   2. Pass an arbitrarily long `model` string that OpenAI would
//      either reject (wasted paid-provider hop) or echo back into
//      logs (PII surface).
//
// Schema constraints:
//   * `streams`: optional, integer in {1, 2}.
//   * `model`: optional, non-empty, max 128 chars (OpenAI model IDs are
//     short; multi-MB strings are abuse).
//   * `.strict()` — no extra keys.

import { z } from "zod";

export const OpenAIRealtimeTokenRequest = z
  .object({
    streams: z.union([z.literal(1), z.literal(2)]).optional(),
    model: z.string().min(1).max(128).optional(),
  })
  .strict();
export type OpenAIRealtimeTokenRequest = z.infer<typeof OpenAIRealtimeTokenRequest>;

export const OpenAIRealtimeTokenResponse = z.object({
  clientSecret: z.string(),
  clientSecrets: z.array(z.string()),
});
export type OpenAIRealtimeTokenResponse = z.infer<typeof OpenAIRealtimeTokenResponse>;
