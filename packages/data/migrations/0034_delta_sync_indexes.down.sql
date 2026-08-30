-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Rescue companion to 0034. NOT journaled (run by hand), mirroring the 0018 /
-- 0033 convention.

DROP INDEX IF EXISTS "notes_delta_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "folders_delta_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_delta_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "transcriptions_delta_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "messages_delta_idx";
