// Phase 2 / Plan 01 / Task 1 — pure crypto helpers for the AUTH-04
// token-rotation overlap window.
//
// Source of truth: 02-RESEARCH-AUTH.md § Token Rotation Overlap.
//
// Scope of THIS file (Task 1):
//   * `hashToken(token)` — SHA-256 32-byte digest, deterministic. Used to
//     compute `sessions.token_hash` and `sessions.previous_token_hash`.
//
// Out of scope (deliberately deferred to a Wave 2/3 plan):
//   * `recordPreviousToken(db, tenantId, sessionId, oldHash)` — DB-touching;
//     requires a live `appDb` and `withTenant` integration.
//   * `tryPreviousToken(db, bearerToken)` — calls the SECURITY DEFINER
//     function defined in 0001_better_auth.sql.
import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 digest of an opaque bearer token. Returns a 32-byte
 * Buffer suitable for the `bytea` column types on `sessions.token_hash`
 * and `sessions.previous_token_hash`.
 *
 * Determinism: identical input ALWAYS yields identical output (verified
 * by token-rotation.test.ts). Empty-string input is a defined SHA-256
 * output (`e3b0c4...`); we don't special-case it.
 */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
