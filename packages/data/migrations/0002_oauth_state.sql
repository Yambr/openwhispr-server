-- Phase 2 / Plan 01 / D-22 — OAuth shim state storage.
-- 10-minute TTL; Phase 6 ships the BullMQ sweeper (this migration only
-- creates the table + indexes + RLS).
--
-- The (provider, callback_url, scheme, code_verifier) tuple is the
-- minimum needed to:
--   * Resume the IdP round-trip after the upstream redirect.
--   * Echo the channel scheme in the final desktop redirect (D-07).
--   * Validate the PKCE proof at code-exchange time.
--
-- consumed_at is set NULL on insert and NOT NULL on first claim by the
-- callback handler — single-use semantics defeat replay attacks. The
-- partial index on expires_at WHERE consumed_at IS NULL keeps the
-- background sweeper's WHERE-clause lookup index-only.

CREATE TABLE "oauth_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "provider" text NOT NULL,
  "callback_url" text NOT NULL,
  "scheme" text NOT NULL,
  "code_verifier" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "oauth_state_tenant_id_idx" ON "oauth_state" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "oauth_state_expires_at_idx" ON "oauth_state" ("expires_at")
  WHERE "consumed_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "oauth_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_state" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "oauth_state_tenant_isolation" ON "oauth_state"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "oauth_state" TO openwhispr_app;
  END IF;
END $$;
