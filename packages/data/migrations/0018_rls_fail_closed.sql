-- Phase 32 / Plan 32-01 / CRIT-FIX-01 — RLS fail-closed posture.
-- Hand-authored (drizzle-kit emits no ALTER ROLE / DROP DEFAULT / ALTER POLICY).
--
-- Source review: .planning/review/data.md CR-01 + HI-04.
--
-- Reverses 0003_better_auth_tenant_defaults.sql:43-57 (role-default GUC +
-- four GUC-bound column DEFAULTs) AND reshapes every tenant-scoped table's
-- RLS USING/WITH CHECK clause to silent-deny-read + raise-write semantics.
--
-- Why NULLIF(current_setting(...), '')::uuid:
--   With missing_ok=true, current_setting returns '' (empty string) when the
--   GUC is unset. The previous policy body cast '' directly to uuid which
--   raised `invalid input syntax for type uuid`. AND-chain short-circuit
--   (current_setting IS NOT NULL AND current_setting <> '' AND tenant_id =
--   current_setting::uuid) is NOT reliable through PG's RLS planner — the
--   predicate may be reordered. NULLIF is the canonical pattern: NULLIF('',
--   '') → NULL, ::uuid → NULL, comparison `tenant_id = NULL` evaluates to
--   NULL (treated as FALSE for both USING and WITH CHECK). Side-effects:
--   SELECT without GUC returns 0 rows; UPDATE/DELETE without GUC affect 0
--   rows; INSERT without GUC raises 42501 because WITH CHECK against a row
--   whose tenant_id is non-NULL evaluates `<uuid> = NULL` → NULL → fail.
--
-- Forward-only. Companion 0018_rls_fail_closed.down.sql documents rollback
-- (re-introduces fail-open posture — DISCOURAGED). The down file is NOT in
-- the journal; it exists only as a run-once-by-hand rescue script.

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
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- sessions
DROP POLICY IF EXISTS "sessions_tenant_isolation" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- audit_log (partitioned; child partitions inherit parent RLS)
DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "audit_log";
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- usage_ledger
DROP POLICY IF EXISTS "usage_ledger_tenant_isolation" ON "usage_ledger";
--> statement-breakpoint
CREATE POLICY "usage_ledger_tenant_isolation" ON "usage_ledger"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- account (Better Auth)
DROP POLICY IF EXISTS "account_tenant_isolation" ON "account";
--> statement-breakpoint
CREATE POLICY "account_tenant_isolation" ON "account"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- verification (Better Auth)
DROP POLICY IF EXISTS "verification_tenant_isolation" ON "verification";
--> statement-breakpoint
CREATE POLICY "verification_tenant_isolation" ON "verification"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- oauth_state
DROP POLICY IF EXISTS "oauth_state_tenant_isolation" ON "oauth_state";
--> statement-breakpoint
CREATE POLICY "oauth_state_tenant_isolation" ON "oauth_state"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- tenant_settings
DROP POLICY IF EXISTS "tenant_settings_isolation" ON "tenant_settings";
--> statement-breakpoint
CREATE POLICY "tenant_settings_isolation" ON "tenant_settings"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- user_settings
DROP POLICY IF EXISTS "user_settings_isolation" ON "user_settings";
--> statement-breakpoint
CREATE POLICY "user_settings_isolation" ON "user_settings"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- notes
DROP POLICY IF EXISTS "notes_isolation" ON "notes";
--> statement-breakpoint
CREATE POLICY "notes_isolation" ON "notes"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- folders
DROP POLICY IF EXISTS "folders_isolation" ON "folders";
--> statement-breakpoint
CREATE POLICY "folders_isolation" ON "folders"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- conversations
DROP POLICY IF EXISTS "conversations_isolation" ON "conversations";
--> statement-breakpoint
CREATE POLICY "conversations_isolation" ON "conversations"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- messages
DROP POLICY IF EXISTS "messages_isolation" ON "messages";
--> statement-breakpoint
CREATE POLICY "messages_isolation" ON "messages"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- transcriptions
DROP POLICY IF EXISTS "transcriptions_isolation" ON "transcriptions";
--> statement-breakpoint
CREATE POLICY "transcriptions_isolation" ON "transcriptions"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- api_keys
DROP POLICY IF EXISTS "api_keys_isolation" ON "api_keys";
--> statement-breakpoint
CREATE POLICY "api_keys_isolation" ON "api_keys"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- usage_rollup_daily
DROP POLICY IF EXISTS "usage_rollup_daily_isolation" ON "usage_rollup_daily";
--> statement-breakpoint
CREATE POLICY "usage_rollup_daily_isolation" ON "usage_rollup_daily"
  USING (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
