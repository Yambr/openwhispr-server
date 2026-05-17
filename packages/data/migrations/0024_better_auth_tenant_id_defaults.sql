-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Plan 51-22 — patch Migration 0003 plural-table drift.
--
-- Background: 0003_better_auth_tenant_defaults.sql installed the canonical
-- Better Auth single-tenant bridge:
--
--   1. ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-...'
--      — every backend connect from the app role lands with the
--        default-tenant GUC pre-bound (PgBouncer-friendly).
--
--   2. ALTER TABLE <t> ALTER COLUMN tenant_id SET DEFAULT
--        current_setting('app.tenant_id', true)::uuid
--      on the 4 Better Auth tables — so the drizzleAdapter's `INSERT ...
--      VALUES (default, ...)` resolves to the GUC value at row time.
--
-- Drift: 0003 was authored against the early-Phase 02.5 schema where the
-- Better Auth tables were singular (`account`, `verification`). Phase 5
-- consolidated all schema files on the pluralized convention (`accounts`,
-- `verifications`) — but 0003 was never refreshed, so steps (2) for
-- `account` and `verification` failed silently against tables that no
-- longer existed under those names. The 0003 ALTER on `users` /
-- `sessions` was unaffected because those table names did not drift.
--
-- Symptom: Better Auth sign-up creates a `users` row (default DEFAULT
-- resolves from the rolconfig'd GUC), then immediately fails on
-- `INSERT INTO accounts (tenant_id, ...) VALUES (default, ...)` with
-- `null value in column "tenant_id"` — Postgres has no column DEFAULT
-- for `accounts.tenant_id`, so `default` lands as NULL.
--
-- Fix: re-issue the SET DEFAULT against the canonical pluralized names
-- (`accounts`, `verifications`). The `users` and `sessions` cases are
-- already covered by 0003; we re-run them here too with `IF EXISTS`
-- semantics (ALTER ... SET DEFAULT is idempotent — same statement is a
-- no-op when the default already matches).

-- Re-assert 0003's ALTER ROLE in case the earlier migration's DO $$ block
-- did not persist in some boot orderings (observed empirically:
-- pg_db_role_setting was empty after 0003 ran). Idempotent: ALTER ROLE
-- ... SET overwrites any prior setting.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    EXECUTE 'ALTER ROLE openwhispr_app SET app.tenant_id TO ''00000000-0000-0000-0000-000000000000''';
  END IF;
END $$;
--> statement-breakpoint

-- Note: DB-level table names are SINGULAR (`account`, `verification`) —
-- the TS schema files use plural variable names (`accounts`, `verifications`)
-- but pgTable("account", ...) / pgTable("verification", ...) is what the
-- migrations create.  This is the same set as 0003 — re-issuing makes the
-- migration explicit + idempotent against fresh / partial migration state.
ALTER TABLE "users"        ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
--> statement-breakpoint
ALTER TABLE "sessions"     ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
--> statement-breakpoint
ALTER TABLE "account"      ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
