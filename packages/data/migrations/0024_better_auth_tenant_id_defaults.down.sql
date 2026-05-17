-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Plan 51-22 — rollback the plural-table column DEFAULT patch.
-- Restores no-default for the 4 Better Auth tables; 0003-down (if ever
-- run) handles the ALTER ROLE rolconfig.

ALTER TABLE "users"        ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "sessions"     ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "account"      ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "tenant_id" DROP DEFAULT;
