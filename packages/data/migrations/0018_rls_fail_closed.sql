-- Phase 32 / Plan 32-01 / CRIT-FIX-01 — RLS fail-closed posture.
-- Hand-authored (drizzle-kit emits no ALTER ROLE / DROP DEFAULT / ALTER POLICY).
--
-- Source review: .planning/review/data.md CR-01 + HI-04.
--
-- Reverses 0003_better_auth_tenant_defaults.sql:43-57 (role-default GUC +
-- four GUC-bound column DEFAULTs) AND reshapes every tenant-scoped table's
-- RLS USING/WITH CHECK clause to silent-deny-read + raise-write semantics.
--
-- Semantics per (op, context) cell after this migration:
--   SELECT without GUC → 0 rows (silent deny)
--   INSERT without GUC → 42501 new row violates row-level security policy
--   UPDATE without GUC → 0 rows affected (USING reduces target set to 0)
--   DELETE without GUC → 0 rows affected (USING reduces target set to 0)
-- With GUC set via withTenant(): rows of the binding tenant visible/mutable;
-- INSERTs with a foreign tenant_id raise 42501 (WITH CHECK fails).
--
-- Forward-only. Companion 0018_rls_fail_closed.down.sql documents rollback
-- (re-introduces fail-open posture — DISCOURAGED, breaks the multi-tenant
-- invariant). The down file is NOT in the journal; it exists only as a
-- run-once-by-hand rescue script.
--
-- Idempotency: ALTER ROLE ... RESET is idempotent; DROP DEFAULT is
-- idempotent (no-op if already null); DROP POLICY IF EXISTS + CREATE POLICY
-- is the canonical pattern used by 0014_audit_log_partition.sql.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    EXECUTE 'ALTER ROLE openwhispr_app RESET app.tenant_id';
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "users"        ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "sessions"     ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "account"      ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint

-- users
DROP POLICY IF EXISTS "users_tenant_isolation" ON "users";
--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- sessions
DROP POLICY IF EXISTS "sessions_tenant_isolation" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- audit_log (partitioned; child partitions inherit parent RLS)
DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "audit_log";
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- usage_ledger
DROP POLICY IF EXISTS "usage_ledger_tenant_isolation" ON "usage_ledger";
--> statement-breakpoint
CREATE POLICY "usage_ledger_tenant_isolation" ON "usage_ledger"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- account (Better Auth)
DROP POLICY IF EXISTS "account_tenant_isolation" ON "account";
--> statement-breakpoint
CREATE POLICY "account_tenant_isolation" ON "account"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- verification (Better Auth)
DROP POLICY IF EXISTS "verification_tenant_isolation" ON "verification";
--> statement-breakpoint
CREATE POLICY "verification_tenant_isolation" ON "verification"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- oauth_state
DROP POLICY IF EXISTS "oauth_state_tenant_isolation" ON "oauth_state";
--> statement-breakpoint
CREATE POLICY "oauth_state_tenant_isolation" ON "oauth_state"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- tenant_settings
DROP POLICY IF EXISTS "tenant_settings_isolation" ON "tenant_settings";
--> statement-breakpoint
CREATE POLICY "tenant_settings_isolation" ON "tenant_settings"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- user_settings
DROP POLICY IF EXISTS "user_settings_isolation" ON "user_settings";
--> statement-breakpoint
CREATE POLICY "user_settings_isolation" ON "user_settings"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- notes
DROP POLICY IF EXISTS "notes_isolation" ON "notes";
--> statement-breakpoint
CREATE POLICY "notes_isolation" ON "notes"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- folders
DROP POLICY IF EXISTS "folders_isolation" ON "folders";
--> statement-breakpoint
CREATE POLICY "folders_isolation" ON "folders"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- conversations
DROP POLICY IF EXISTS "conversations_isolation" ON "conversations";
--> statement-breakpoint
CREATE POLICY "conversations_isolation" ON "conversations"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- messages
DROP POLICY IF EXISTS "messages_isolation" ON "messages";
--> statement-breakpoint
CREATE POLICY "messages_isolation" ON "messages"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- transcriptions
DROP POLICY IF EXISTS "transcriptions_isolation" ON "transcriptions";
--> statement-breakpoint
CREATE POLICY "transcriptions_isolation" ON "transcriptions"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- api_keys
DROP POLICY IF EXISTS "api_keys_isolation" ON "api_keys";
--> statement-breakpoint
CREATE POLICY "api_keys_isolation" ON "api_keys"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
--> statement-breakpoint

-- usage_rollup_daily
DROP POLICY IF EXISTS "usage_rollup_daily_isolation" ON "usage_rollup_daily";
--> statement-breakpoint
CREATE POLICY "usage_rollup_daily_isolation" ON "usage_rollup_daily"
  USING (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NOT NULL
    AND current_setting('app.tenant_id', true) <> ''
    AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
  );
