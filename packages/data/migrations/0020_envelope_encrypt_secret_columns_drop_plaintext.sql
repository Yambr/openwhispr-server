-- Phase 33 / Plan 33-05 / CRIT-FIX-02 — drop plaintext credential columns.
--
-- Forward migration completing the envelope-encryption rollout begun in
-- 0019 (additive bytea sidecars) and continued through Plan 33-02 (lens
-- + boot validator), Plan 33-03 (Node-side backfill), Plan 33-04
-- (wrap-adapter + oauth_state codec + Node-side fp lookup).
--
-- Operator pre-condition: this migration MUST be deployed AFTER the
-- Node-side backfill has populated every sidecar column on every row.
-- Running 0020 with un-backfilled rows is data loss (the plaintext
-- bytes are gone after DROP COLUMN). See docs/security.md §12
-- "Rollback rescue procedure" for the reverse-backfill path.
--
-- Drops the 8 plaintext credential columns:
--   account.{access_token, refresh_token, id_token, password}
--   verification.value
--   sessions.{token, previous_token}
--   oauth_state.code_verifier
--
-- Drops the plaintext-token indexes that referenced those columns:
--   sessions_token_unique          (UNIQUE INDEX on plaintext token)
--   sessions_previous_token_idx    (partial INDEX on plaintext previous_token)
--   sessions_token_fp_unique       (partial-unique nullable-transition idx from 0019)
--
-- Promotes the fingerprint index to a full UNIQUE INDEX (no WHERE
-- clause) AND flips `sessions.token_fp` to NOT NULL — the schema is
-- now bytea-only and fingerprint lookup is the canonical path.
-- `previous_token_fp` stays nullable (NULL during sessions whose
-- AUTH-04 5-minute overlap window is closed, which is the common case).
--
-- Forward-only. Companion 0020.down.sql is a rescue script (NOT in
-- the drizzle journal) — see docs/security.md §12.

-- 1) Drop plaintext credential columns ────────────────────────────────
ALTER TABLE "account"
  DROP COLUMN "access_token",
  DROP COLUMN "refresh_token",
  DROP COLUMN "id_token",
  DROP COLUMN "password";
--> statement-breakpoint

ALTER TABLE "verification"
  DROP COLUMN "value";
--> statement-breakpoint

-- Drop the plaintext-token indexes BEFORE dropping the underlying
-- columns; Postgres lets you drop a column without explicitly dropping
-- the dependent index (CASCADE-implicit) but listing them explicitly
-- makes the diff readable + the reverse rescue script symmetric.
DROP INDEX IF EXISTS "sessions_token_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_previous_token_idx";
--> statement-breakpoint

ALTER TABLE "sessions"
  DROP COLUMN "token",
  DROP COLUMN "previous_token";
--> statement-breakpoint

ALTER TABLE "oauth_state"
  DROP COLUMN "code_verifier";
--> statement-breakpoint

-- 2) Promote sessions_token_fp_unique to a full UNIQUE INDEX ──────────
-- The 0019-era index was a partial UNIQUE (WHERE token_fp IS NOT NULL)
-- so un-backfilled rows could carry NULL token_fp without violating
-- uniqueness. With plaintext now gone every row's token_fp is bound;
-- replace the partial index with a plain UNIQUE INDEX.
DROP INDEX IF EXISTS "sessions_token_fp_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_fp_unique" ON "sessions" ("token_fp");
--> statement-breakpoint

-- 3) Flip sessions.token_fp to NOT NULL ───────────────────────────────
-- Operator pre-condition (above) guarantees no row has NULL token_fp at
-- this point. If a row slipped through, this ALTER will raise 23502 —
-- the operator MUST run the backfill before retrying.
ALTER TABLE "sessions"
  ALTER COLUMN "token_fp" SET NOT NULL;
--> statement-breakpoint

-- previous_token_fp stays nullable — most sessions outside the AUTH-04
-- 5-minute overlap window have no previous-token state.
ALTER TABLE "sessions"
  ALTER COLUMN "previous_token_fp" DROP NOT NULL;
