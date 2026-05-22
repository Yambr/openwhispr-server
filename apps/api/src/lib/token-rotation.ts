// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 51 / Plan 51-13 (REVIEW api-core HIGH HI-01) — header rewritten.
//
// Storage shape evolution:
//   * Phase 02 Plan 01 — bytea(SHA-256) hashed bearer storage.
//   * Phase 02.12 — adopted Better Auth v1.6.9's plain-text
//     `session.token` model; bearers stored verbatim on
//     `sessions.token` + `sessions.previous_token` (text columns).
//   * Phase 33 / Plan 33-05 (migration 0020) — plaintext columns
//     DROPPED. Only the SHA-256 fingerprint sidecar
//     `previous_token_fp` (bytea, partial-unique index) is persisted.
//     `tryPreviousToken` resolves the bearer by fingerprinting the
//     candidate and looking up the matching session row.
//
// Current state (post-Phase-33): there is NO plaintext bearer at rest.
// The header on this file used to advertise "plaintext bearer storage"
// — that is the storage shape we left behind in Phase 33. The body of
// the file (recordPreviousToken / tryPreviousToken) correctly stores
// only the fingerprint and resolves via the same shape. Pre-Phase-51,
// an auditor reading the header would form the wrong conclusion;
// fixed in this rewrite (REVIEW api-core HIGH HI-01).
//
// The AUTH-04 5-minute overlap CONTRACT (recordPreviousToken +
// tryPreviousToken behavior) is preserved across all three phases —
// only the storage representation changed.
//
// Source of truth (rev): 02.12-CONTEXT.md D-02 (simplify
// token-rotation.ts) + 33-05-PLAN.md (envelope-encryption land).
//
// AUTH-A3 finding (2026-05-09) preserved verbatim:
//   Better Auth 1.6.9's bearer plugin (node_modules/better-auth/dist/
//   plugins/bearer/index.mjs) does NOT support a built-in rotation
//   overlap. The `set-auth-token` header carries the freshly-rotated
//   value; the OLD token's signed-cookie HMAC verification stops working
//   the moment Better Auth rotates the underlying session cookie value.
//   Therefore we MUST keep the previous_token machinery — this module
//   lands the helpers that operate on it.

import { type ExecutableTx, type TransactionalDb, withTenant } from "@openwhispr/data";
import { sql } from "drizzle-orm";

/**
 * Record the previously-active bearer token on a session row before Better
 * Auth's rotation completes. The `previous_token_expires_at` column is
 * stamped to `now() + 5 minutes` per AUTH-04. Subsequent requests using
 * the OLD token within that window are accepted via `tryPreviousToken`.
 *
 * Phase 02.12 — `oldToken` is the plain-text bearer (no hashing). Stored
 * verbatim into `sessions.previous_token` (text). The AUTH-04 overlap
 * CONTRACT is preserved; only the representation changed.
 *
 * Runs inside `withTenant(db, tenantId, ...)` so the UPDATE is bound by
 * the existing tenant_isolation policy on `sessions`. Caller MUST pass
 * the validated tenant UUID — this function does not resolve it.
 */
export async function recordPreviousToken(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  sessionId: string,
  oldToken: string,
): Promise<void> {
  // Phase 33 / Plan 33-05 — plaintext `sessions.previous_token` column
  // dropped by migration 0020. Only the SHA-256 fingerprint sidecar
  // (`previous_token_fp`) is written; `tryPreviousToken` resolves the
  // bearer via the partial-unique fingerprint index. The 5-minute
  // overlap CONTRACT is preserved as a behaviour guarantee — storage
  // shape is now fingerprint-only.
  //
  // The plaintext `oldToken` is NOT persisted because the route hooks
  // never need to read it back — Better Auth itself owns the next-token
  // emission and the rotation contract only requires "an attacker
  // presenting the OLD bearer during the overlap window resolves to
  // the same (user_id, tenant_id) tuple". The fingerprint achieves that
  // without exposing recoverable plaintext.
  const { createHash } = await import("node:crypto");
  const fp = createHash("sha256").update(oldToken, "utf8").digest();
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(
      sql`UPDATE sessions
          SET previous_token_fp = ${fp},
              previous_token_expires_at = now() + interval '5 minutes'
          WHERE id = ${sessionId}::uuid`,
    );
  });
}

export interface PreviousTokenMatch {
  userId: string;
  tenantId: string;
  /**
   * WR-05: the matched user's email, returned by the SECURITY DEFINER
   * lookup's `JOIN users`. Surfaced to downstream consumers (audit logs,
   * ledger metadata) so they don't silently observe an empty-string
   * sentinel synthesized by buildApp's minimal-mode tryPrev adapter.
   * `null` when the user row was deleted mid-rotation (the JOIN matches
   * nothing — but the whole lookup then returns `null` anyway) — kept
   * nullable for the defence-in-depth fail-loud contract.
   */
  email: string | null;
}

/**
 * Look up a session by its rotated previous bearer.
 *
 * AUDIT-SEC-01 (HACK-C2) fix — calls the SECURITY DEFINER function
 * `lookup_session_by_previous_token_fp(bytea)` defined in migration
 * `0031_restore_previous_token_fp_lookup.sql`, which:
 *   1. Bypasses RLS deliberately, via its definer (table-owner) rights —
 *      the caller doesn't yet know the tenant, that's exactly what we're
 *      resolving. The `sessions` table carries FORCE ROW LEVEL SECURITY
 *      with a fail-closed policy (migration 0018); a bare SELECT issued
 *      through the RLS-subject `openwhispr_app` pool with no
 *      `app.tenant_id` GUC matches ZERO rows. That was the dead-overlap
 *      bug — the SECURITY DEFINER attribute is what fixes it.
 *   2. Returns ONLY (user_id, tenant_id, email) — no row data, no token
 *      material — so a caller probing arbitrary fingerprints learns
 *      nothing beyond "this fingerprint maps to <opaque ids>".
 *   3. Filters by `previous_token_expires_at > now()` so expired overlap
 *      windows do not match — the 5-minute window stays bounded.
 *
 * Returns `null` when the bearer is not a recently-rotated previous
 * token (the dual-auth hook then emits its 401 envelope).
 *
 * The DB connection used here is the standard appDb (`makeAppDb()`) —
 * the function's SECURITY DEFINER attribute is what bypasses RLS, NOT
 * the connection role. This is the SAFEST shape: the role can EXECUTE
 * the function but cannot SELECT from `sessions` directly, and no
 * BYPASSRLS connection is threaded into request paths.
 *
 * History: migration 0005 first shipped a SECURITY DEFINER lookup keyed
 * on a plaintext `previous_token` column; migration 0019b retired it
 * when the storage shape moved, and the Node-side helper that replaced
 * it issued a bare RLS-bound SELECT — which the RLS-subject app pool
 * could never satisfy without a tenant GUC. Migration 0031 reinstates
 * the SECURITY DEFINER lookup, keyed on the `previous_token_fp` bytea
 * fingerprint sidecar that is the post-Phase-33 storage shape.
 */
export async function tryPreviousToken(
  db: { execute(query: unknown): Promise<unknown> },
  bearerToken: string,
): Promise<PreviousTokenMatch | null> {
  // SHA-256 the candidate bearer and resolve via the SECURITY DEFINER
  // function. The function's `JOIN users` returns the matched user's
  // email in the same round-trip (WR-05) — no follow-up SELECT against
  // the RLS-fail-closed `users` table on this tenant-less pool.
  const { createHash } = await import("node:crypto");
  const fp = createHash("sha256").update(bearerToken, "utf8").digest();
  const r = (await db.execute(
    sql`SELECT user_id, tenant_id, email
          FROM lookup_session_by_previous_token_fp(${fp})`,
  )) as { rows: Array<{ user_id: string; tenant_id: string; email: string | null }> };
  const first = r.rows[0];
  if (!first) return null;
  return {
    userId: first.user_id,
    tenantId: first.tenant_id,
    email: first.email ?? null,
  };
}
