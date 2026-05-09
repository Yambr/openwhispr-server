-- Phase 02.5 / Plan 02 — Better Auth tenant-default binding.
-- Hand-authored (drizzle-kit emits no ALTER ROLE / column DEFAULT bound to GUC).
--
-- Problem: Better Auth's Drizzle adapter issues bare INSERTs that do NOT
-- supply tenant_id. The Better Auth tables (users / sessions / account /
-- verification) all have NOT NULL tenant_id with FORCE RLS attached.
-- Without help, every Better Auth INSERT crashes with either a NOT NULL
-- violation OR an RLS policy violation depending on the exact GUC state.
--
-- Fix (per CONTEXT D-02 + D-03, single-tenant v1 only):
--   1. ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'
--      so every connection from the app role lands with the default-tenant
--      GUC pre-bound. PgBouncer transaction-pool reuses physical connections
--      and rolconfig is applied at backend-connect time — once per backend,
--      stable for the life of the connection — which is the correct semantic
--      for a single-tenant install.
--   2. ALTER TABLE ... ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid
--      on all four Better Auth tables. With (1) in place, this resolves to
--      the default-tenant UUID for every Better Auth INSERT — no app-side
--      changes required, no wrapper around the adapter.
--   3. Idempotently re-assert the default-tenant row (already seeded in
--      0000_initial.sql; included here for safety on partially-applied
--      migration histories).
--
-- GUC name `app.tenant_id` is the canonical name used by every RLS policy
-- (0000_initial.sql, 0001_better_auth.sql, 0002_oauth_state.sql). The
-- CONTEXT.md mention of an alternate GUC name is a documentation typo;
-- the locked decision intent (role default + column DEFAULT) is preserved
-- at full strength here.
--
-- v2 / multi-tenant follow-up (DEFERRED per D-06):
--   * Drop the ALTER ROLE default and instead set per-request via a
--     Fastify hook calling `SELECT set_config('app.tenant_id', ..., true)`
--     before any route handler runs. Plan 06 in a future phase.
--   * The column DEFAULTs can stay; they're harmless when set_config has
--     already populated the GUC.

INSERT INTO "tenants" ("id", "name") VALUES
  ('00000000-0000-0000-0000-000000000000', 'default')
  ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    EXECUTE $sql$ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'$sql$;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "users"        ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
--> statement-breakpoint
ALTER TABLE "sessions"     ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
--> statement-breakpoint
ALTER TABLE "account"      ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
