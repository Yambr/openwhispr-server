-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 59 / Track E — R17: API-key name uniqueness scoped to the owner.
--
-- The active-name partial UNIQUE index landed in migration 0010 as
-- `(tenant_id, name) WHERE revoked_at IS NULL`. In v1's single-
-- installation-single-tenant RLS posture (CLAUDE.md §Constraints item
-- 16) every user resolves to the SAME default tenant, so `(tenant_id,
-- name)` is functionally GLOBAL within an installation: two distinct
-- users cannot both hold a key named `X`, and the second one's 409
-- `API_KEY_NAME_TAKEN` leaks the existence of the first owner's
-- key-name choice (cross-owner info leak + usability bug — R17).
--
-- API keys are owned by the USER, not the tenant — the `/api/v1/keys`
-- list + revoke handlers both scope their queries by `user_id`. The
-- correct, R17-satisfying namespace is therefore `(user_id, name)`.
--
-- This migration drops the tenant-scoped index and re-creates it
-- scoped to `user_id`. The partial `WHERE revoked_at IS NULL` predicate
-- is preserved so a revoked name can still be re-used by its owner.
--
-- Server is pre-production — no data-migration cost. Idempotent:
-- DROP INDEX IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.

DROP INDEX IF EXISTS "api_keys_active_name_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_active_name_idx"
  ON "api_keys" ("user_id", "name")
  WHERE "revoked_at" IS NULL;
