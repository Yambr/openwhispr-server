-- Phase 02.12 — Adopt Better Auth v1.6.9's canonical `session.token` text
-- storage. Drop AUTH-04 v1 hash-only design (bytea `token_hash` /
-- `previous_token_hash`) which the entire OSS auth ecosystem (NextAuth,
-- Auth.js, Lucia, Better Auth itself) does not support natively. The
-- AUTH-04 5-minute overlap CONTRACT (behavior) is preserved via the
-- plain-text `previous_token` column; at-rest hardening is deferred to
-- v2 (column-level pgcrypto or Postgres TDE — ADR-tracked in
-- `.planning/STATE.md` Roadmap Evolution).
--
-- Pre-existing rows: TRUNCATE sessions. Phase 02 is dev-only; no
-- production data exists. The default-tenant row in `tenants` is
-- untouched (TRUNCATE is scoped to `sessions` only). FK chains do not
-- cascade outwards from sessions — `users` and `tenants` are not
-- affected.
--
-- All four DDL stages (TRUNCATE, DROP COLUMN, ADD COLUMN, function
-- replacement) run inside drizzle-orm/migrator's enclosing transaction;
-- partial application is impossible.

-- Step 1 — drop dependent partial index BEFORE dropping the column
-- (PG refuses DROP COLUMN if a non-CASCADE index references it).
DROP INDEX IF EXISTS "sessions_previous_token_hash_idx";
--> statement-breakpoint

-- Step 2 — drop the SECURITY DEFINER lookup function bound to the bytea
-- signature. The replacement function with `text` parameter is created
-- below. DROP must precede the column drop because the function body
-- references `sessions.previous_token_hash`.
DROP FUNCTION IF EXISTS lookup_session_by_previous_token(bytea);
--> statement-breakpoint

-- Step 3 — TRUNCATE before dropping NOT NULL columns. Phase 02 dev-only.
TRUNCATE TABLE "sessions";
--> statement-breakpoint

-- Step 4 — drop the legacy bytea storage columns.
ALTER TABLE "sessions" DROP COLUMN "token_hash";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "previous_token_hash";
--> statement-breakpoint

-- Step 5 — add Better Auth's canonical plain-text columns.
-- `token` is NOT NULL (every session must carry a bearer); `previous_token`
-- is nullable (only populated within the AUTH-04 5-minute overlap window).
ALTER TABLE "sessions" ADD COLUMN "token" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "previous_token" text;
--> statement-breakpoint

-- Step 6 — UNIQUE index on `token` (BA's lookup-by-token path scans this).
-- Replaces the dropped non-unique `sessions_token_hash_idx`. Per Phase 02
-- Plan 01 the original index lived implicitly via the bytea column; we
-- create an explicit UNIQUE index here so token collisions raise 23505.
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" ("token");
--> statement-breakpoint

-- Step 7 — partial index on the AUTH-04 overlap column for sub-millisecond
-- lookup during the 5-minute rotation window.
CREATE INDEX "sessions_previous_token_idx" ON "sessions" ("previous_token")
  WHERE "previous_token" IS NOT NULL;
--> statement-breakpoint

-- =====================================================================
-- AUTH-04 SECURITY DEFINER lookup functions, recreated with text params.
--
-- `session_lookup_by_token(text)` — current-token path. The dual-auth
--   hook may use this to resolve a bearer to (user_id, tenant_id) without
--   already knowing the tenant. Better Auth's drizzle adapter does its
--   own SELECT in the normal path; this function exists for the
--   defense-in-depth fallback / BYPASSRLS-by-EXECUTE pattern.
--
-- `lookup_session_by_previous_token(text)` — overlap-window path.
--   Behaviorally identical to the bytea version dropped above; only the
--   parameter type changes.
--
-- Both functions:
--   * STABLE volatility (read-only, depends on now() + input).
--   * SECURITY DEFINER — caller does not need SELECT on sessions.
--   * SET search_path = public, pg_temp — defense in depth against
--     search_path injection (PG SECURITY DEFINER hardening best practice).
--   * REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO openwhispr_app — only
--     the app role can invoke; arbitrary roles cannot probe.
-- =====================================================================
CREATE OR REPLACE FUNCTION session_lookup_by_token(p_token text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT s.user_id, s.tenant_id
  FROM sessions s
  WHERE s.token = p_token
    AND s.expires_at > now()
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION session_lookup_by_token(text) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION lookup_session_by_previous_token(p_token text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT s.user_id, s.tenant_id
  FROM sessions s
  WHERE s.previous_token = p_token
    AND s.previous_token_expires_at IS NOT NULL
    AND s.previous_token_expires_at > now()
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lookup_session_by_previous_token(text) FROM PUBLIC;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT EXECUTE ON FUNCTION session_lookup_by_token(text)            TO openwhispr_app;
    GRANT EXECUTE ON FUNCTION lookup_session_by_previous_token(text)   TO openwhispr_app;
  END IF;
END $$;
