// Phase 2 / Plan 01 + 05 — token-rotation helpers for the AUTH-04
// 5-minute overlap window.
//
// Source of truth: 02-RESEARCH-AUTH.md § Token Rotation Overlap.
//
// Plan 01 shipped: hashToken (SHA-256 pure function).
// Plan 05 adds:    recordPreviousToken + tryPreviousToken (DB-touching).
//
// AUTH-A3 finding (2026-05-09):
//   Better Auth 1.6.9's bearer plugin (node_modules/better-auth/dist/
//   plugins/bearer/index.mjs) does NOT support a built-in rotation
//   overlap. The `set-auth-token` header carries the freshly-rotated
//   value; the OLD token's signed-cookie HMAC verification stops working
//   the moment Better Auth rotates the underlying session cookie value.
//   Therefore we MUST keep the previous_token_hash machinery — this
//   plan lands the helpers that operate on it.
//
//   The actual hook-into-Better-Auth wiring (calling recordPreviousToken
//   on the rotation event) is intentionally NOT part of these helpers —
//   it is a small wiring step that lives in apps/api/src/auth.ts and is
//   exercised end-to-end by Plan 06's CONTRACT-01 token-rotation
//   contract test against a real backend. The helpers themselves are
//   unit-testable in isolation against a recording fake DB; the
//   SECURITY DEFINER function they call is exercised by the existing
//   migration tests in packages/data.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  withTenant,
  type ExecutableTx,
  type TransactionalDb,
} from "@openwhispr/data";

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

/**
 * Record the previously-active token hash on a session row before Better
 * Auth's rotation completes. The `previous_token_expires_at` column is
 * stamped to `now() + 5 minutes` per AUTH-04. Subsequent requests using
 * the OLD token within that window are accepted via `tryPreviousToken`.
 *
 * Runs inside `withTenant(db, tenantId, ...)` so the UPDATE is bound by
 * the existing tenant_isolation policy on `sessions`. Caller MUST pass
 * the validated tenant UUID — this function does not resolve it.
 */
export async function recordPreviousToken(
  db: TransactionalDb<ExecutableTx>,
  tenantId: string,
  sessionId: string,
  oldHash: Buffer,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.execute(
      sql`UPDATE sessions
          SET previous_token_hash = ${oldHash},
              previous_token_expires_at = now() + interval '5 minutes'
          WHERE id = ${sessionId}::uuid`,
    );
  });
}

export interface PreviousTokenMatch {
  userId: string;
  tenantId: string;
}

/**
 * Look up a session by its `previous_token_hash`. Calls the SECURITY
 * DEFINER function `lookup_session_by_previous_token(bytea)` defined in
 * migration 0001_better_auth.sql, which:
 *   1. Bypasses RLS deliberately (the caller doesn't yet know the
 *      tenant — that's exactly what we're resolving).
 *   2. Returns ONLY (user_id, tenant_id) tuples — no row data — so a
 *      malicious caller probing arbitrary hashes learns nothing beyond
 *      "this hash maps to <opaque ids>".
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
  const hash = hashToken(bearerToken);
  const r = (await db.execute(
    sql`SELECT user_id, tenant_id
        FROM lookup_session_by_previous_token(${hash})`,
  )) as { rows: Array<{ user_id: string; tenant_id: string }> };
  const first = r.rows[0];
  if (!first) return null;
  return { userId: first.user_id, tenantId: first.tenant_id };
}
