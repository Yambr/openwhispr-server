// Phase 2 / Plan 03 / Task 1 — Single zod source of truth for Phase 2
// wire shapes. Imported by both the apps/api route handlers AND the
// CONTRACT-01 conformance suite (Plan 06). If a shape changes, it changes
// HERE — every consumer picks up the new contract automatically.
//
// Source of truth: BACKEND_SPEC.md (upstream). Conventions:
//   * Request schemas: `.strict()` — extra fields rejected (catches typos
//     and mass-assignment surfaces early).
//   * Response schemas: NO `.strict()` — desktop ignores extras, and we
//     keep forward-compat headroom (e.g. audit metadata may grow on
//     `DeleteAccountResponse`).
//   * `ErrorEnvelope` is `.strict()` because the on-the-wire shape MUST be
//     exactly `{error:string}` with NO extras (security — no leak surface).
import { z } from "zod";

/**
 * Global error envelope — every non-2xx response body matches this shape.
 *
 * `.min(1)` on `error` rules out `{error:""}` (which would type-check but
 * is functionally useless). `.strict()` rejects extras (no leaking
 * stack frames or internal state via additional fields).
 */
export const ErrorEnvelope = z.object({ error: z.string().min(1) }).strict();
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// POST /api/check-user
export const CheckUserRequest = z.object({ email: z.string().email() }).strict();
export type CheckUserRequest = z.infer<typeof CheckUserRequest>;

export const CheckUserResponse = z.object({ exists: z.boolean() });
export type CheckUserResponse = z.infer<typeof CheckUserResponse>;

// GET /api/auth/verification-status?email=<urlencoded>
export const VerificationStatusQuery = z.object({ email: z.string().email() }).strict();
export type VerificationStatusQuery = z.infer<typeof VerificationStatusQuery>;

export const VerificationStatusResponse = z.object({ verified: z.boolean() });
export type VerificationStatusResponse = z.infer<typeof VerificationStatusResponse>;

// DELETE /api/auth/delete-account — passthrough so the handler may attach
// audit metadata in a future phase without breaking the contract.
export const DeleteAccountResponse = z.object({}).passthrough();
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;

// GET /api/health
export const HealthResponse = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponse>;
