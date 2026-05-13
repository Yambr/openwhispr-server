// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 09 / Task 1 — Argon2id helper for API key issuance and
// verification (WIRE-27, D-29).
//
// Storage shape (D-29):
//   * `key_prefix` = first 12 chars of the clear-text PAK = "pak_" + 8
//     random base64url chars. Non-secret; used for fast O(log n) lookup
//     on the GLOBALLY UNIQUE `key_prefix` index before Argon2id verify.
//   * `key_hash` = Argon2id digest of the FULL clear-text key. Format
//     string is `$argon2id$v=19$m=65536$t=3$p=1$<salt>$<hash>` per OWASP
//     2026 password-storage recommendations.
//   * Clear-text key surfaces ONLY at creation time
//     (CreateApiKeyResponse.key); list responses NEVER include it.
//
// OWASP 2026 Argon2id parameters (RESEARCH § Code Examples):
//   memoryCost: 65536  (64 MiB)
//   timeCost:   3
//   parallelism: 1
//
// Per T-PARAM-DOWNGRADE mitigation, ARGON2_PARAMS is a module-level
// constant — no runtime override path. Tests assert the format string
// contains m=65536/t=3/p=1.
//
// Per Pitfall #5, @node-rs/argon2 dispatches hash/verify work onto the
// NAPI tokio threadpool, so 100 concurrent verify calls do NOT block
// Fastify's main thread (unlike the pure-JS `argon2` package).
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

/**
 * OWASP 2026 password-storage Argon2id parameters. Module-level constant
 * — no override path (T-PARAM-DOWNGRADE). Verify reads parameters out of
 * the stored hash format string, so a downgrade attack would have to
 * rewrite the persisted hash itself.
 */
const ARGON2_PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Generate a new programmatic-access key (PAK).
 *
 * Returns {clearText, prefix}:
 *   * clearText — `pak_<24-bytes-base64url>` (≈ 32 chars after `pak_`).
 *     This is the value the caller MUST surface to the user exactly
 *     once via CreateApiKeyResponse.key.
 *   * prefix — first 12 chars of clearText = `pak_` + first 8 random
 *     chars. Stored in api_keys.key_prefix; used for fast lookup before
 *     Argon2id verify on bearer auth (Phase 6).
 */
export function generatePak(): { clearText: string; prefix: string } {
  // randomBytes(24) → 32 base64url chars (no padding). Combined with the
  // `pak_` literal prefix the full clear-text is 36 chars.
  const raw = randomBytes(24).toString("base64url");
  const clearText = `pak_${raw}`;
  const prefix = clearText.slice(0, 12);
  return { clearText, prefix };
}

/**
 * Hash a clear-text PAK with Argon2id using OWASP 2026 parameters.
 * Returns the encoded `$argon2id$v=19$m=65536$t=3$p=1$<salt>$<hash>`
 * format string that includes the algorithm + parameters + salt + digest
 * — suitable for direct persistence in api_keys.key_hash.
 */
export async function hashKey(clearText: string): Promise<string> {
  return hash(clearText, ARGON2_PARAMS);
}

/**
 * Verify a clear-text PAK against a stored Argon2id hash.
 *
 * The parameters embedded in `storedHash` (m=, t=, p=) are what the
 * verify uses — re-asserting ARGON2_PARAMS here would prevent rolling
 * upgrades. Per T-PARAM-DOWNGRADE we accept the format string as
 * authoritative; the constant-time `verify` returns false on mismatch.
 */
export async function verifyKey(
  clearText: string,
  storedHash: string,
): Promise<boolean> {
  return verify(storedHash, clearText);
}

/**
 * Compute the persisted `key_prefix` from a clear-text PAK. Pure-string
 * function (no crypto); used by Phase 6 bearer-auth middleware to
 * extract the lookup key from an inbound Authorization header before
 * dispatching to Argon2id verify.
 */
export function parsePakPrefix(clearText: string): string {
  return clearText.slice(0, 12);
}
