// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 56 / Plan 56-01 / R1 — POST /api/_test/seed-tenant wire schemas.
//
// Spec: /Users/dev/openwhispr/.planning/phases/08-client-server-audit/
//   SERVER-REQUIREMENTS.md §R1 (lines 21-83). Locked decisions in
//   .planning/phases/56-client-contract-conformance/CONTEXT.md §D-1.
//
// Request shape: { email, password, name, verified } — `verified` is
// the explicit opt-in that flips emailVerified=true on the row WITHOUT
// going through the verification-email round-trip. Anti-pattern guard:
// the route handler itself gates on a non-production runtime mode AND
// the explicit `OPENWHISPR_TEST_ROUTES=true` env opt-in (D-1 overrides
// the upstream spec's env-var name), so a hostile client cannot reach
// this surface in production.
//
// Response shape: { token, user{id, email, emailVerified:true,
// createdAt} } — `token` is the raw Better Auth session bearer that
// downstream `Authorization: Bearer <token>` requests accept. The
// `emailVerified` field is a `z.literal(true)` because the route's
// reason for existing is to skip the verification step; if the
// response ever ships `false`, the contract is broken.
import { z } from "zod";

// RFC 5321 §4.5.3.1.1 caps an email at 254 octets. Mirrors
// CheckUserRequest's email field (defence-in-depth at the second
// unauthenticated mutation seam in the test-only surface).
export const SeedTenantRequest = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(256),
    name: z.string().min(1).max(256),
    verified: z.boolean(),
  })
  .strict();
export type SeedTenantRequest = z.infer<typeof SeedTenantRequest>;

export const SeedTenantResponse = z
  .object({
    token: z.string().min(1),
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email(),
        emailVerified: z.literal(true),
        createdAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
export type SeedTenantResponse = z.infer<typeof SeedTenantResponse>;
