// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: BACKEND_SPEC.md §/api/auth/verification-status.
import { z } from "zod";

// GET /api/auth/verification-status?email=<urlencoded>
export const VerificationStatusQuery = z.object({ email: z.string().email() }).strict();
export type VerificationStatusQuery = z.infer<typeof VerificationStatusQuery>;

export const VerificationStatusResponse = z.object({ verified: z.boolean() });
export type VerificationStatusResponse = z.infer<typeof VerificationStatusResponse>;
