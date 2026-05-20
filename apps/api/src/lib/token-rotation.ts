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
   * WR-05: the matched user's email, fetched via a follow-up SELECT
   * AFTER the SECURITY DEFINER lookup resolves the tenant. Surfaced to
   * downstream consumers (audit logs, ledger metadata) so they don't
   * silently observe an empty-string sentinel synthesized by buildApp's
   * minimal-mode tryPrev adapter. `null` when the user row was deleted
   * mid-rotation — fail-loud over silent "" placeholder.
   */
  email: string | null;
}

/**
 * Look up a session by its `previous_token`. Calls the SECURITY DEFINER
 * function `lookup_session_by_previous_token(text)` defined in migration
 * 0005_session_token_plain.sql (Phase 02.12), which:
 *   1. Bypasses RLS deliberately (the caller doesn't yet know the
 *      tenant — that's exactly what we're resolving).
 *   2. Returns ONLY (user_id, tenant_id) tuples — no row data — so a
 *      malicious caller probing arbitrary tokens learns nothing beyond
 *      "this token maps to <opaque ids>".
 *   3. Filters by `previous_token_expires_at > now()` so expired
 *      overlap windows do not match.
 *
 * Returns `null` when the bearer is not a recently-rotated previous
 * token (the dual-auth hook then emits its 401 envelope).
 *
 * The DB connection used here is the standard appDb — the function's
 * SECURITY DEFINER attribute is what bypasses RLS, NOT the connection
 * role. This is the SAFEST shape: the role can EXECUTE the function but
 * cannot SELECT from sessions directly.
 */
export async function tryPreviousToken(
  db: { execute(query: unknown): Promise<unknown> },
  bearerToken: string,
): Promise<PreviousTokenMatch | null> {
  // Phase 33 / Plan 33-04 — the migration-0005 SECURITY DEFINER function
  // `lookup_session_by_previous_token(text)` was dropped by migration
  // 0019b. We now SHA-256 the plaintext bearer and SELECT against the
  // partial unique index `sessions_previous_token_fp_idx` over the
  // bytea(32) fingerprint column. Identical AUTH-04 5-minute overlap
  // CONTRACT — only the lookup mechanism changed (Node-side hash + index
  // probe replaces SECURITY DEFINER call). The `db.execute` interface
  // here is the same `TransactionalDb` shape Plan 08 wired; we issue a
  // single drizzle `sql` query that matches the helper in
  // packages/data/src/sessions/lookup-by-previous-token.ts (Node-side
  // helper exists for the integration-test fingerprint codepath without
  // needing drizzle).
  const { createHash } = await import("node:crypto");
  const fp = createHash("sha256").update(bearerToken, "utf8").digest();
  const r = (await db.execute(
    sql`SELECT user_id, tenant_id
          FROM sessions
         WHERE previous_token_fp = ${fp}
           AND previous_token_expires_at IS NOT NULL
           AND previous_token_expires_at > now()
         LIMIT 1`,
  )) as { rows: Array<{ user_id: string; tenant_id: string }> };
  const first = r.rows[0];
  if (!first) return null;
  // WR-05: resolve email so downstream consumers (audit logs, ledger
  // metadata, dual-auth synthesized user objects) see a real value.
  // Pre-fix, buildApp's minimal-mode tryPrev adapter hard-coded
  // `email: ""` because the SECURITY DEFINER function only returned
  // the (user_id, tenant_id) pair — that empty-string sentinel
  // silently propagated through middleware.
  //
  // HI-05 (REVIEW api-core HIGH / Phase 62): the follow-up SELECT is
  // now EXPLICITLY tenant-scoped — `AND tenant_id = <resolved>::uuid`.
  // Previously the SELECT relied solely on the post-condition that
  // `first.user_id` belongs to `first.tenant_id`; a race during a
  // user-move / admin-impersonation flow could desync those. The
  // predicate pins the lookup to the tenant the sessions row already
  // resolved, so a row whose `tenant_id` does not match is never read.
  // (The function still runs on the standard `openwhispr_app` role —
  // this is belt-and-braces at the SQL level. `users.id` is a primary
  // key so the query stays bounded.)
  let email: string | null = null;
  try {
    const er = (await db.execute(
      sql`SELECT email FROM users
           WHERE id = ${first.user_id}::uuid
             AND tenant_id = ${first.tenant_id}::uuid
           LIMIT 1`,
    )) as { rows: Array<{ email: string }> };
    email = er.rows[0]?.email ?? null;
  } catch {
    // Row deleted mid-rotation or RLS blocked the read — surface null
    // so consumers fail loud rather than receiving a silent "".
    email = null;
  }
  return { userId: first.user_id, tenantId: first.tenant_id, email };
}
