-- Phase 33 / Plan 33-05 — RESCUE rollback for 0020.
--
-- This script is NOT in the drizzle journal (mirrors 0018 + 0019 down-
-- migration precedent). It reverses the schema change but CANNOT
-- recover plaintext data — that's a fundamental cost of the
-- envelope-encryption rollout and the reason 0020 is forward-only by
-- design. Operators that need to restore plaintext content MUST run a
-- reverse-backfill step (decrypt the bytea sidecars, write plaintext)
-- BEFORE re-introducing the columns; see docs/security.md §12
-- "Rollback rescue procedure".
--
-- Restored shape:
--   - 8 plaintext credential columns (text, nullable, no DEFAULT)
--   - sessions_token_unique UNIQUE INDEX on plaintext token (recreated)
--   - sessions_previous_token_idx partial INDEX on plaintext previous_token
--   - sessions_token_fp_unique demoted back to partial-unique
--   - sessions.token_fp flipped back to nullable
--
-- The bytea sidecars are left UNTOUCHED — operators usually want to
-- preserve the ciphertext so the forward rollout can be re-attempted
-- after the underlying issue is resolved.

-- 1) Recreate plaintext columns ────────────────────────────────────────
ALTER TABLE "account"
  ADD COLUMN "access_token"  text,
  ADD COLUMN "refresh_token" text,
  ADD COLUMN "id_token"      text,
  ADD COLUMN "password"      text;
--> statement-breakpoint

ALTER TABLE "verification"
  ADD COLUMN "value" text;
--> statement-breakpoint

ALTER TABLE "sessions"
  ADD COLUMN "token"          text,
  ADD COLUMN "previous_token" text;
--> statement-breakpoint

ALTER TABLE "oauth_state"
  ADD COLUMN "code_verifier" text;
--> statement-breakpoint

-- 2) Reverse the fingerprint index promotion ─────────────────────────
ALTER TABLE "sessions"
  ALTER COLUMN "token_fp" DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_token_fp_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_fp_unique" ON "sessions" ("token_fp")
  WHERE "token_fp" IS NOT NULL;
--> statement-breakpoint

-- 3) Recreate plaintext-token indexes ─────────────────────────────────
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" ("token");
--> statement-breakpoint
CREATE INDEX "sessions_previous_token_idx" ON "sessions" ("previous_token")
  WHERE "previous_token" IS NOT NULL;
