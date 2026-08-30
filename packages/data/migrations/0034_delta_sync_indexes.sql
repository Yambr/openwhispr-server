-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Delta-sync keyset indexes — the `?since=` axis.
--
-- The desktop's delta pull advances its cursor with the last row's
-- `updated_at` (SyncService.pullNotes / pullConversations:
-- `const next = since ? last.updated_at : last.created_at`), so the list routes
-- now filter and order a `?since=` page by `(updated_at, id) ASC` instead of
-- `created_at`. Before that change an edit to an older row never entered any
-- delta window at all — it was invisible to every other device.
--
-- The existing `<tbl>_keyset_idx` covers only the SNAPSHOT axis
-- `(tenant_id, created_at DESC, id DESC)` and cannot serve the new ordering, so
-- every delta pull would degrade to a sort over the user's whole table. These
-- indexes pair with it: one per table whose list route accepts `since`.
--
-- Leading `(tenant_id, user_id)` matches the handler predicate
-- (`WHERE user_id = $1` inside `withTenant`), then `(updated_at, id)` serves
-- both the tuple comparison and the ORDER BY.
--
-- Plain `CREATE INDEX` (NOT `CONCURRENTLY`): the Drizzle migration runner wraps
-- each migration file in a transaction, and `CREATE INDEX CONCURRENTLY` is
-- illegal inside a transaction block (SQLSTATE 25001). Same rationale and same
-- form as migration 0029. Idempotent: `CREATE INDEX IF NOT EXISTS`.

CREATE INDEX IF NOT EXISTS "notes_delta_idx" ON "notes"
  ("tenant_id", "user_id", "updated_at", "id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "folders_delta_idx" ON "folders"
  ("tenant_id", "user_id", "updated_at", "id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conversations_delta_idx" ON "conversations"
  ("tenant_id", "user_id", "updated_at", "id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "transcriptions_delta_idx" ON "transcriptions"
  ("tenant_id", "user_id", "updated_at", "id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_delta_idx" ON "messages"
  ("tenant_id", "user_id", "updated_at", "id") WHERE "deleted_at" IS NULL;
