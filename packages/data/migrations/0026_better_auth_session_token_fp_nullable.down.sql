-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Plan 51-24 — rollback token_fp NULL relaxation.
DROP INDEX IF EXISTS "sessions_token_unique_partial";
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "token_fp" SET NOT NULL;
