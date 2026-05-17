-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Plan 51-23 — drop the Better-Auth introspection compat columns.

ALTER TABLE "sessions"     DROP COLUMN IF EXISTS "previous_token";
--> statement-breakpoint
ALTER TABLE "sessions"     DROP COLUMN IF EXISTS "token";
--> statement-breakpoint
ALTER TABLE "verification" DROP COLUMN IF EXISTS "value";
--> statement-breakpoint
ALTER TABLE "account"      DROP COLUMN IF EXISTS "id_token";
--> statement-breakpoint
ALTER TABLE "account"      DROP COLUMN IF EXISTS "refresh_token";
--> statement-breakpoint
ALTER TABLE "account"      DROP COLUMN IF EXISTS "access_token";
--> statement-breakpoint
ALTER TABLE "account"      DROP COLUMN IF EXISTS "password";
