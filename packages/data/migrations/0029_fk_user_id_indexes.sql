-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 67 / Plan 67-01 — HI-02: leading user_id FK indexes.
--
-- `transcriptions`, `conversations`, `messages`, `notes`, `folders` each
-- declare `user_id uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE`.
-- The only indexes touching `user_id` on these tables are composite indexes
-- LED BY `tenant_id` (`<tbl>_client_id_idx` = `(tenant_id, user_id, ...)`),
-- which Postgres cannot use for the FK-cascade enforcement scan. As a result
-- `DELETE FROM users WHERE id = ?` triggers a sequential scan of all five
-- child tables — fine on tiny installs, expensive at the 1000-user scale this
-- backend targets.
--
-- This migration adds a dedicated leading-`user_id` index per table so the FK
-- cascade enforcement is index-backed.
--
-- `api_keys` is EXCLUDED: migration 0028 (`0028_api_keys_name_scope.sql`)
-- rescoped `api_keys_active_name_idx` to `(user_id, name)` — a leading-
-- `user_id` index already sufficient for the cascade scan.
--
-- Plain `CREATE INDEX` (NOT `CONCURRENTLY`): the Drizzle migration runner
-- wraps each migration file in a transaction, and `CREATE INDEX CONCURRENTLY`
-- is illegal inside a transaction block (SQLSTATE 25001). The migrate runner
-- connects direct to Postgres, so a migration-time index build is fine.
-- Idempotent: `CREATE INDEX IF NOT EXISTS`.

CREATE INDEX IF NOT EXISTS "transcriptions_user_id_idx" ON "transcriptions" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conversations_user_id_idx" ON "conversations" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_user_id_idx" ON "messages" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notes_user_id_idx" ON "notes" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "folders_user_id_idx" ON "folders" ("user_id");
