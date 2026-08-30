-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Rescue companion to 0035. NOT journaled (run by hand), mirroring the 0018 /
-- 0033 / 0034 convention.
--
-- Dropping `space_id` DISCARDS which space a row belonged to. Rows survive and
-- become personal again; the grouping does not. Only run this when no space has
-- ever been used in anger.

DROP INDEX IF EXISTS "folders_space_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "notes_space_idx";
--> statement-breakpoint
ALTER TABLE "folders" DROP COLUMN IF EXISTS "space_id";
--> statement-breakpoint
ALTER TABLE "notes"   DROP COLUMN IF EXISTS "space_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "user_groups";
--> statement-breakpoint
DROP TABLE IF EXISTS "space_teams";
--> statement-breakpoint
DROP TABLE IF EXISTS "spaces";
--> statement-breakpoint
DROP TABLE IF EXISTS "team_members";
--> statement-breakpoint
DROP TABLE IF EXISTS "teams";
