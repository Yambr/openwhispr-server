-- Phase 2 / Plan 01 / D-22 — Better Auth tables + extends users/sessions.
-- Hand-authored (drizzle-kit does not emit FORCE RLS, CREATE POLICY,
-- SECURITY DEFINER functions, or REVOKE/GRANT — Phase 1 pattern continues).
--
-- Better Auth's `User` and `Session` entities map onto Phase 1's existing
-- users/sessions tables via the Drizzle adapter's schema arg. Phase 2 adds
-- only `account` (per-(user,provider) credential row) and `verification`
-- (email-verify + password-reset short-lived tokens). Existing users gains
-- the Better Auth required fields; existing sessions gains the AUTH-04
-- overlap-window columns.
--
-- All new tenant-scoped tables MUST have FORCE RLS + tenant_isolation
-- policy that references current_setting('app.tenant_id', true). The
-- `, true` (missing_ok) is required so that an unset GUC produces ''
-- (which fails the ::uuid cast and denies the row) rather than an error.

ALTER TABLE "users" ADD COLUMN "name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;
--> statement-breakpoint

ALTER TABLE "sessions" ADD COLUMN "previous_token_hash" bytea;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "previous_token_expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" text;
--> statement-breakpoint

CREATE INDEX "sessions_previous_token_hash_idx" ON "sessions" ("previous_token_hash")
  WHERE "previous_token_hash" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "account" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider_id" text NOT NULL,
  "account_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "account_provider_account_tenant_unique"
    UNIQUE ("provider_id", "account_id", "tenant_id")
);
--> statement-breakpoint
CREATE INDEX "account_tenant_id_idx" ON "account" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");
--> statement-breakpoint

CREATE TABLE "verification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "verification_tenant_id_idx" ON "verification" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
--> statement-breakpoint

-- =====================================================================
-- RLS DDL (hand-augmented; drizzle-kit does not emit these).
-- =====================================================================
ALTER TABLE "account"      ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "account"      FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "account_tenant_isolation" ON "account"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

CREATE POLICY "verification_tenant_isolation" ON "verification"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- =====================================================================
-- AUTH-04 overlap window — SECURITY DEFINER lookup function.
--
-- The dual-auth hook calls this function when getSession returns null
-- but a bearer token is present. The function bypasses RLS (SECURITY
-- DEFINER) so the caller can locate the (user_id, tenant_id) tuple
-- without already knowing the tenant. It returns nothing else — the
-- caller then opens a withTenant() transaction with the returned tenant
-- to fetch the full user row under the canonical RLS scope.
--
-- STABLE volatility: the function does not modify the database and its
-- result depends only on the input + now(). REVOKE FROM public + GRANT
-- EXECUTE TO openwhispr_app keeps any other role from probing the
-- session table out-of-band.
-- =====================================================================
CREATE OR REPLACE FUNCTION lookup_session_by_previous_token(p_hash bytea)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
AS $$
  SELECT s.user_id, s.tenant_id
  FROM sessions s
  WHERE s.previous_token_hash = p_hash
    AND s.previous_token_expires_at > now()
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lookup_session_by_previous_token(bytea) FROM PUBLIC;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "account"      TO openwhispr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "verification" TO openwhispr_app;
    GRANT EXECUTE ON FUNCTION lookup_session_by_previous_token(bytea) TO openwhispr_app;
  END IF;
END $$;
