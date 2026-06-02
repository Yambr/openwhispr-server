-- Phase 5 / Plan 01 — tenant_settings + user_settings tables.
--
-- READ-only in v1 (D-31); mutation paths land in Phase 7. JSONB columns
-- hold the GET /api/stt-config and GET /api/note-recording-config
-- response payloads verbatim, so the routes can SELECT and serialize
-- without any per-key column unpacking.
--
-- AFTER INSERT trigger seed_tenant_settings (Pitfall #8 — AFTER, not
-- BEFORE; BEFORE-row triggers cannot reference NEW.id when the table
-- uses DEFAULT gen_random_uuid() because NEW.id is generated AFTER the
-- BEFORE phase). The trigger is SECURITY DEFINER so it can INSERT into
-- tenant_settings even when invoked from a request running as
-- openwhispr_app under FORCE RLS — the function body is intentionally
-- limited to a single INSERT into tenant_settings(NEW.id) so there is no
-- privilege-escalation surface.
--
-- Backfill: every existing row in tenants gets a tenant_settings row.
-- The default tenant from 0000_initial.sql is the canonical case.

CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"stt_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"note_recording_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"stt_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"note_recording_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "user_settings_tenant_id_idx" ON "user_settings" USING btree ("tenant_id");
--> statement-breakpoint

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "user_settings"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_settings"   FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

-- Quick 260602-x6z (upstream #4) — bypass-aware at creation. The claim-driven
-- `app.bypass` arm + the NULLIF fail-closed form (later reshaped by 0018/0033)
-- are applied HERE so this migration is self-contained: a fresh replay under a
-- NOBYPASSRLS role passes the seed-backfill INSERT below without relying on a
-- later retrofit. The migrate runner sets app.bypass=on + app.tenant_id=<default>
-- (MIGRATE_SESSION_OPTIONS) so both arms are satisfiable during replay.
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

-- AFTER INSERT trigger function (Pitfall #8 — AFTER, not BEFORE).
-- SECURITY DEFINER lets the function INSERT into tenant_settings even
-- under FORCE RLS, but the body is restricted to a single bound INSERT
-- so there is no other privilege-elevation path through this function.
CREATE OR REPLACE FUNCTION seed_tenant_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	INSERT INTO tenant_settings (tenant_id) VALUES (NEW.id)
	ON CONFLICT (tenant_id) DO NOTHING;
	RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tenants_seed_settings
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION seed_tenant_settings();
--> statement-breakpoint

-- Backfill: every existing tenant gets a tenant_settings row. ON
-- CONFLICT DO NOTHING is the idempotency guard for partially-applied
-- prior runs (defense in depth — the migration itself is forward-only).
INSERT INTO tenant_settings (tenant_id)
	SELECT id FROM tenants
	ON CONFLICT (tenant_id) DO NOTHING;
--> statement-breakpoint

-- Grants for openwhispr_app — read+write on both settings tables.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_settings" TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "user_settings"   TO openwhispr_app;
	END IF;
END $$;
