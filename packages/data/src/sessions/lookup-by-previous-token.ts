// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 33 / Plan 33-04 — Node-side replacement for migration 0005's
// `lookup_session_by_previous_token(text)` SECURITY DEFINER function.
//
// Why we rewrite rather than keep the SQL function:
//   - Plan 33-05 drops the plaintext `sessions.previous_token` text column.
//   - The SQL function's body (`WHERE s.previous_token = p_token`) cannot
//     work once that column is gone — it would have to read the 6 bytea
//     sidecars + call the envelope decrypt routine, which a SQL function
//     cannot do (envelope decrypt is Node-side AES-256-GCM).
//   - We preserve the AUTH-04 5-minute overlap CONTRACT (research §15) by
//     hashing the plaintext bearer to SHA-256, looking up the matching
//     `sessions.previous_token_fp` partial index (migration 0019), and
//     filtering by `previous_token_expires_at > now()`.
//   - Index lookup is O(log N) via `sessions_previous_token_fp_idx`
//     (partial index on previous_token_fp WHERE previous_token_fp IS NOT NULL).
//
// SECURITY: this helper runs on the OWNER pool (BYPASSRLS) because the
// caller does not yet know the tenant — that is exactly what we resolve.
// The original SECURITY DEFINER function bypassed RLS for the same reason.
// We deliberately return ONLY (user_id, tenant_id) — no row payload — so a
// malicious caller probing arbitrary tokens learns nothing beyond the
// opaque ID pair. Mirrors the migration 0001/0005 contract.
//
// The follow-up email SELECT remains the caller's responsibility (see
// apps/api/src/lib/token-rotation.ts) — this helper's surface stays
// minimal so unit-level testing of the fingerprint path is decoupled
// from the email-resolution side-effect.

import { createHash } from "node:crypto";

/**
 * Minimal pg-like query surface this helper depends on. We deliberately
 * avoid pulling drizzle's full TransactionalDb type here so the helper
 * can be exercised against a bare `pg.Pool` in unit tests (and
 * production calls go through the same pool wrapper).
 */
export interface SessionLookupExecutor {
  query<R = unknown>(text: string, values: readonly unknown[]): Promise<{ rows: R[] }>;
}

export interface PreviousTokenLookupRow {
  userId: string;
  tenantId: string;
}

/**
 * SHA-256 the plaintext bearer and look up the matching session row by
 * `previous_token_fp`. Returns `null` when no live session has that
 * fingerprint with `previous_token_expires_at > now()`.
 *
 * @param executor pg.Pool-shaped query interface bound to a BYPASSRLS role.
 * @param previousTokenPlain plaintext bearer the desktop sent on the wire.
 */
export async function lookupSessionByPreviousToken(
  executor: SessionLookupExecutor,
  previousTokenPlain: string,
): Promise<PreviousTokenLookupRow | null> {
  const fp = createHash("sha256").update(previousTokenPlain, "utf8").digest();
  const { rows } = await executor.query<{ user_id: string; tenant_id: string }>(
    `SELECT user_id, tenant_id
       FROM sessions
      WHERE previous_token_fp = $1
        AND previous_token_expires_at IS NOT NULL
        AND previous_token_expires_at > now()
      LIMIT 1`,
    [fp],
  );
  const first = rows[0];
  if (!first) return null;
  return { userId: first.user_id, tenantId: first.tenant_id };
}
