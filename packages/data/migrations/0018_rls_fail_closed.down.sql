-- !!! DANGER — Phase 32 ROLLBACK SCRIPT !!!
-- Re-introduces the FAIL-OPEN posture from 0003_better_auth_tenant_defaults.sql.
-- Any query outside withTenant() will silently bind to the default tenant.
-- Run ONLY as an emergency rollback during a same-day incident; revert
-- as soon as the underlying issue is fixed. NOT in the drizzle journal —
-- run by hand with the openwhispr_owner role.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    EXECUTE $sql$ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'$sql$;
  END IF;
END $$;

ALTER TABLE "users"        ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
ALTER TABLE "sessions"     ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
ALTER TABLE "account"      ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
ALTER TABLE "verification" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- Restoring fail-open policy bodies for all 16 tables is left as an exercise
-- — this rollback is intentionally incomplete because rolling back a security
-- migration should require a human pause to consider whether the proper
-- remediation is forward-fix rather than rollback.
