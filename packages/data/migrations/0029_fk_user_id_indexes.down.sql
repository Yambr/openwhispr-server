-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 67 / Plan 67-01 — HI-02 rollback companion.
-- Drops the five leading-`user_id` FK indexes added by 0029.

DROP INDEX IF EXISTS "transcriptions_user_id_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "conversations_user_id_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "messages_user_id_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "notes_user_id_idx";
--> statement-breakpoint

DROP INDEX IF EXISTS "folders_user_id_idx";
