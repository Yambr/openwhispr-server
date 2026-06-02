-- Quick 260602-j9z / blocker #2 — ROLLBACK for 0033_rls_claim_driven_bypass.sql.
--
-- Restores the 0018 fail-closed policy bodies (tenant_id arm ONLY, no
-- app.bypass OR-arm). After this rollback the privileged/cross-tenant path
-- again REQUIRES a BYPASSRLS role (withSystemBypass becomes a no-op claim that
-- no policy honors). Forward-only project; this is a run-by-hand rescue script
-- and is intentionally NOT in meta/_journal.json (mirrors 0018's convention).

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

