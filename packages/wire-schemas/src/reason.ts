// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: docs/wire-contracts-phase-3.md / BACKEND_SPEC.md §/api/reason.
import { z } from "zod";

// POST /api/reason
export const ReasonRequest = z
  .object({
    text: z.string().min(1),
    model: z.string().optional(),
    provider: z.string().optional(),
    promptMode: z.string().optional(),
    matchType: z.string().optional(),
  })
  .strict();
export type ReasonRequest = z.infer<typeof ReasonRequest>;

export const ReasonResponse = z.object({
  text: z.string(),
  model: z.string(),
  provider: z.string(),
  promptMode: z.string(),
  matchType: z.string(),
});
export type ReasonResponse = z.infer<typeof ReasonResponse>;
