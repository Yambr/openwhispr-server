-- SPDX-License-Identifier: FSL-1.1-ALv2
-- R20 — restore the session-token uniqueness contract onto `token_fp`.
--
-- Background: migration 0026 (Plan 51-24) moved the unique-session-token
-- contract onto the plaintext `token` column via the partial index
-- `sessions_token_unique_partial` (WHERE token IS NOT NULL). That index
-- enforces NOTHING for real sessions: Phase 57 (commit 6133c2ba) re-added
-- `session.token` to ENCRYPTED_COLUMNS_MAP, so the encryption lens strips
-- the plaintext `token` column on write — it is NULL at rest for every
-- Better-Auth-issued session. A partial index `WHERE token IS NOT NULL`
-- over an always-NULL column indexes zero rows.
--
-- Post-Phase-57 the lens DOES populate `token_fp` on every session create
-- (the SIDECAR_ADDITIONAL_FIELDS registration forwards the fingerprint
-- through Better Auth's adapter `transformInput`). `token_fp` is therefore
-- the column that actually carries a value for real sessions, and the
-- canonical session-resolution lookup (lens `rewriteWhere` — R20 fix)
-- resolves bearer tokens via `WHERE token_fp = sha256(<token>)`.
--
-- This migration moves uniqueness back where the data lives.
--
-- `token_fp` stays NULLABLE (not flipped to NOT NULL): a replay against a
-- pre-fix database may carry residual session rows with NULL token_fp
-- (created while the bug was live). Those rows are unreachable-by-bearer
-- anyway and expire out; flipping NOT NULL would trip SQLSTATE 23502 on a
-- dirty DB. The partial UNIQUE index preserves the uniqueness contract for
-- every row that has a fingerprint (Postgres allows multiple NULLs).

-- 1) Drop the no-op plaintext partial unique index from 0026.
DROP INDEX IF EXISTS "sessions_token_unique_partial";
--> statement-breakpoint

-- 2) Recreate the fingerprint unique index as a PARTIAL unique index.
--    Migration 0020 created `sessions_token_fp_unique` as a FULL unique
--    index (when token_fp was NOT NULL); 0026 relaxed the column to
--    nullable but left the index full. Recreate it partial so residual
--    NULL-token_fp rows do not collide.
DROP INDEX IF EXISTS "sessions_token_fp_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_fp_unique"
  ON "sessions" ("token_fp")
  WHERE "token_fp" IS NOT NULL;
