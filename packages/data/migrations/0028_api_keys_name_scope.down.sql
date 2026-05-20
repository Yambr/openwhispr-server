-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 59 / Track E — R17 rollback: restore the tenant-scoped
-- api_keys active-name unique index (migration 0010 shape).

DROP INDEX IF EXISTS "api_keys_active_name_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_active_name_idx"
  ON "api_keys" ("tenant_id", "name")
  WHERE "revoked_at" IS NULL;
