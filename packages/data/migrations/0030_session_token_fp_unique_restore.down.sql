-- SPDX-License-Identifier: FSL-1.1-ALv2
-- R20 — rollback: restore migration 0026's plaintext-token unique index.
--
-- Mirrors the 0026 end-state: drop the partial token_fp unique index and
-- recreate the plaintext `sessions_token_unique_partial`. Note this
-- rollback re-establishes the broken posture (uniqueness on an always-NULL
-- column); it exists only for migration-tooling symmetry.

DROP INDEX IF EXISTS "sessions_token_fp_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_unique_partial"
  ON "sessions" ("token")
  WHERE "token" IS NOT NULL;
