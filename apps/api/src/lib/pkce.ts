// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 05 / Task 1 — PKCE (RFC 7636) helpers for the OAuth shim.
//
// Two pure functions, both crypto-grade. Used by `desktop-signin.ts` to
// generate the verifier (persisted in oauth_state) + the challenge
// (forwarded to the IdP authorize URL).
//
// We pin verifier length to 43 chars (the RFC 7636 § 4.1 minimum). This
// is 32 bytes of randomness encoded as URL-safe-base64-no-padding —
// the smallest legal verifier that still satisfies the spec. The
// challenge is also 43 chars (SHA-256 = 32 bytes → b64url-no-pad = 43).
//
// URL-safe-base64-no-padding is RFC 4648 § 5; Node's `'base64url'`
// encoding does this natively (Node 16+). The `.replace(/=+$/, "")`
// belt-and-suspenders covers older Node versions where `base64url`
// might emit padding (it does not in Node 24, but the cost is zero).
import { createHash, randomBytes } from "node:crypto";

const VERIFIER_BYTES = 32;

/**
 * Generate a fresh PKCE verifier — 32 random bytes encoded as
 * URL-safe-base64 with no padding (43 chars).
 *
 * RFC 7636 § 4.1: `code_verifier = high-entropy cryptographic random
 * STRING using the unreserved characters [A-Z] / [a-z] / [0-9] / "-" /
 * "." / "_" / "~", with a minimum length of 43 characters and a maximum
 * length of 128 characters`.
 *
 * We emit only `[A-Za-z0-9_-]` (no `.` or `~`) which is a strict subset
 * of the allowed alphabet and thus always valid.
 */
export function generatePkceVerifier(): string {
  return randomBytes(VERIFIER_BYTES).toString("base64url").replace(/=+$/, "");
}

/**
 * Compute the S256 PKCE challenge for a given verifier.
 *
 * RFC 7636 § 4.2: `code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`.
 * URL-safe-base64 with no padding. SHA-256 over UTF-8 (ASCII-clean since
 * the verifier alphabet is `[A-Za-z0-9_-]`).
 */
export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url")
    .replace(/=+$/, "");
}
