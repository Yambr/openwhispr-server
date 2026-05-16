// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 40 / Sub-fix 40.a — moved from @openwhispr/contract-tests/schemas
// to break the package-boundary inversion (HIGH-FIX-BYOK-01). Production
// routes now import the wire shape from `@openwhispr/wire-schemas`
// rather than a test-helper package.
//
// Source of truth: BACKEND_SPEC.md §/api/check-user.
import { z } from "zod";

// POST /api/check-user
export const CheckUserRequest = z.object({ email: z.string().email() }).strict();
export type CheckUserRequest = z.infer<typeof CheckUserRequest>;

export const CheckUserResponse = z.object({ exists: z.boolean() });
export type CheckUserResponse = z.infer<typeof CheckUserResponse>;
