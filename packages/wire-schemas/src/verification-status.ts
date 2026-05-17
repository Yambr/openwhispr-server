// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: BACKEND_SPEC.md §/api/auth/verification-status.
//
// Phase 51 / Plan 51-07 (REVIEW wire-schemas HIGH): unauthenticated
// probe surface — email length bounded to RFC-5321 floor (254 bytes)
// so a multi-MB query string can't trigger an unbounded DB lookup.
import { z } from "zod";

// GET /api/auth/verification-status?email=<urlencoded>
export const VerificationStatusQuery = z.object({ email: z.string().email().max(254) }).strict();
export type VerificationStatusQuery = z.infer<typeof VerificationStatusQuery>;

export const VerificationStatusResponse = z.object({ verified: z.boolean() });
export type VerificationStatusResponse = z.infer<typeof VerificationStatusResponse>;
