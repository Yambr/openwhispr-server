// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas
// to break the package-boundary inversion (HIGH-FIX-BYOK-01). Production
// routes now import the wire shape from `@openwhispr/wire-schemas`
// rather than a test-helper package.
//
// Source of truth: BACKEND_SPEC.md §/api/check-user.
//
// Phase 51 / Plan 51-07 (REVIEW wire-schemas HIGH): the email field now
// enforces RFC-5321 maximum length (254 bytes). This endpoint is
// UNAUTHENTICATED — the pre-fix schema accepted multi-MB emails that
// triggered an indexed-LIKE DB lookup per request.
import { z } from "zod";

// POST /api/check-user
export const CheckUserRequest = z.object({ email: z.string().email().max(254) }).strict();
export type CheckUserRequest = z.infer<typeof CheckUserRequest>;

export const CheckUserResponse = z.object({ exists: z.boolean() });
export type CheckUserResponse = z.infer<typeof CheckUserResponse>;
