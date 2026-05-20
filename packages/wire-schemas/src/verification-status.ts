// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas.
// Source of truth: BACKEND_SPEC.md §/api/auth/verification-status.
//
// Phase 51 / Plan 51-07 (REVIEW wire-schemas HIGH): unauthenticated
// probe surface — email length bounded to RFC-5321 floor (254 bytes)
// so a multi-MB query string can't trigger an unbounded DB lookup.
import { z } from "zod";

// GET /api/auth/verification-status?email=<urlencoded>
//
// Phase 59 / Track D — R15/R5: `email` is OPTIONAL. The route derives
// identity from the session cookie, never the param (R5). R5 mandates
// the server accept the documented `?email=` field "without warning,
// without error" — which includes its ABSENCE: a required-param schema
// 400s a desktop poll that omits it, the direct inverse of R5. When
// present, the value is still validated (RFC-5321 ≤254 bytes) so a
// malformed/oversized param can't ride through to the handler.
export const VerificationStatusQuery = z
  .object({ email: z.string().email().max(254).optional() })
  .strict();
export type VerificationStatusQuery = z.infer<typeof VerificationStatusQuery>;

export const VerificationStatusResponse = z.object({ verified: z.boolean() });
export type VerificationStatusResponse = z.infer<typeof VerificationStatusResponse>;
