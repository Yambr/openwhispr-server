-- Phase 5 / Plan 01 — api_keys table.
--
-- D-29 storage shape: key_prefix is GLOBALLY UNIQUE (`pak_<6-chars>`),
-- key_hash is Argon2id digest of the full clear-text key. Listing only
-- ever exposes key_prefix; the clear-text key is returned exactly once
-- at creation time. Soft-revoke via revoked_at; partial UNIQUE on
-- (tenant_id, name) WHERE revoked_at IS NULL prevents duplicate active
-- names per tenant.

CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL DEFAULT '{}'::text[],
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "api_keys_isolation" ON "api_keys"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- key_prefix is GLOBALLY UNIQUE — used for the constant-time prefix
-- lookup before per-row Argon2id verification on bearer auth.
CREATE UNIQUE INDEX "api_keys_key_prefix_unique" ON "api_keys" ("key_prefix");
--> statement-breakpoint

-- Active-name uniqueness per tenant (D-29). Revoked rows are excluded so
-- operators can re-use a name after a key is rotated.
CREATE UNIQUE INDEX "api_keys_active_name_idx" ON "api_keys"
	("tenant_id", "name")
	WHERE "revoked_at" IS NULL;
--> statement-breakpoint

CREATE INDEX "api_keys_keyset_idx" ON "api_keys"
	("tenant_id", "created_at" DESC, "id" DESC)
	WHERE "revoked_at" IS NULL;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "api_keys" TO openwhispr_app;
	END IF;
END $$;
