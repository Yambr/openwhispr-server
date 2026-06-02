-- Quick 260602-j9z / blocker #2 — claim-driven RLS bypass (app.bypass GUC).
-- Hand-authored (drizzle-kit emits no ALTER/DROP/CREATE POLICY).
--
-- Source: upstream managed-Postgres deploy requirement. The privileged /
-- cross-tenant path previously relied on the owner role's BYPASSRLS attribute
-- (worker system jobs + bootstrap). Corporate managed Postgres issues ONE
-- NOBYPASSRLS `svcdb_*` role and will not grant BYPASSRLS. This migration adds
-- a Supabase `service_role`-style CLAIM: a transaction-scoped `app.bypass` GUC
-- that the policies honor, so a single NOBYPASSRLS role can run every path.
--
-- The fail-closed posture from 0018 is PRESERVED — we only ADD an OR arm:
--
--   USING/WITH CHECK (
--     current_setting('app.bypass', true) = 'on'
--     OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
--   )
--
-- Isolation invariant (property-tested): the bypass arm is reachable ONLY from
-- system jobs + bootstrap, which set `app.bypass='on'` via
-- `withSystemBypass[Client]` inside their own transaction. A normal request
-- (withTenant) sets ONLY `app.tenant_id`, never `app.bypass`, so the left arm
-- is false and tenant isolation is unchanged. `set_config(..., true)` is
-- transaction-scoped, so the claim cannot leak across PgBouncer connection
-- reuse.
--
-- Forward-only. Safe to apply on a DB already at 0018 (DROP POLICY IF EXISTS +
-- CREATE POLICY per table). Companion 0033_rls_claim_driven_bypass.down.sql
-- restores the 0018 bodies (no app.bypass arm); NOT journaled (run-by-hand
-- rescue, mirroring 0018's convention).

-- users
DROP POLICY IF EXISTS "users_tenant_isolation" ON "users";
--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- sessions
DROP POLICY IF EXISTS "sessions_tenant_isolation" ON "sessions";
--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- audit_log (partitioned; child partitions inherit parent RLS)
DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "audit_log";
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- usage_ledger
DROP POLICY IF EXISTS "usage_ledger_tenant_isolation" ON "usage_ledger";
--> statement-breakpoint
CREATE POLICY "usage_ledger_tenant_isolation" ON "usage_ledger"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- account (Better Auth)
DROP POLICY IF EXISTS "account_tenant_isolation" ON "account";
--> statement-breakpoint
CREATE POLICY "account_tenant_isolation" ON "account"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- verification (Better Auth)
DROP POLICY IF EXISTS "verification_tenant_isolation" ON "verification";
--> statement-breakpoint
CREATE POLICY "verification_tenant_isolation" ON "verification"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- oauth_state
DROP POLICY IF EXISTS "oauth_state_tenant_isolation" ON "oauth_state";
--> statement-breakpoint
CREATE POLICY "oauth_state_tenant_isolation" ON "oauth_state"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- tenant_settings
DROP POLICY IF EXISTS "tenant_settings_isolation" ON "tenant_settings";
--> statement-breakpoint
CREATE POLICY "tenant_settings_isolation" ON "tenant_settings"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- user_settings
DROP POLICY IF EXISTS "user_settings_isolation" ON "user_settings";
--> statement-breakpoint
CREATE POLICY "user_settings_isolation" ON "user_settings"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- notes
DROP POLICY IF EXISTS "notes_isolation" ON "notes";
--> statement-breakpoint
CREATE POLICY "notes_isolation" ON "notes"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- folders
DROP POLICY IF EXISTS "folders_isolation" ON "folders";
--> statement-breakpoint
CREATE POLICY "folders_isolation" ON "folders"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- conversations
DROP POLICY IF EXISTS "conversations_isolation" ON "conversations";
--> statement-breakpoint
CREATE POLICY "conversations_isolation" ON "conversations"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- messages
DROP POLICY IF EXISTS "messages_isolation" ON "messages";
--> statement-breakpoint
CREATE POLICY "messages_isolation" ON "messages"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- transcriptions
DROP POLICY IF EXISTS "transcriptions_isolation" ON "transcriptions";
--> statement-breakpoint
CREATE POLICY "transcriptions_isolation" ON "transcriptions"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- api_keys
DROP POLICY IF EXISTS "api_keys_isolation" ON "api_keys";
--> statement-breakpoint
CREATE POLICY "api_keys_isolation" ON "api_keys"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- usage_rollup_daily
DROP POLICY IF EXISTS "usage_rollup_daily_isolation" ON "usage_rollup_daily";
--> statement-breakpoint
CREATE POLICY "usage_rollup_daily_isolation" ON "usage_rollup_daily"
  USING (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass', true) = 'on'
    OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
