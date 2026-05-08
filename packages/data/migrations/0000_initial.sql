-- Phase 1 / Plan 03 — first migration. Run as openwhispr_owner (BYPASSRLS).
--
-- HAND-AUGMENTED (RESEARCH-DB §"First migration"; assumption A1 verified):
-- drizzle-kit 0.31.10 emits CREATE TABLE / CREATE INDEX / FK constraints
-- but does NOT emit `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`,
-- `CREATE POLICY`, the `pgcrypto` extension, the default-tenant seed,
-- or the GRANTs to openwhispr_app. Those blocks are appended below the
-- drizzle-kit-generated DDL. Future migrations follow the same pattern;
-- the Plan 05 RLS lint catches drift (table without ENABLE+FORCE+policy).
--
-- Roles (openwhispr_owner / openwhispr_app) are NOT created here — they
-- live in `init/00-roles.sh` which the Postgres container's entrypoint
-- runs once on first volume init. CREATE ROLE outlives databases and
-- requires CREATEROLE privilege the migration runner must not have.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "tenants" ("id", "name") VALUES
	('00000000-0000-0000-0000-000000000000', 'default')
	ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"units" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "users_tenant_id_idx" ON "users" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_unique" ON "users" USING btree ("tenant_id","email");
--> statement-breakpoint
CREATE INDEX "sessions_tenant_id_idx" ON "sessions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_idx" ON "audit_log" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "usage_ledger_tenant_id_idx" ON "usage_ledger" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_request_id_unique" ON "usage_ledger" USING btree ("request_id");
--> statement-breakpoint
-- =====================================================================
-- Hand-augmented section: row level security DDL + canonical isolation
-- policies + grants for openwhispr_app. Every tenant-scoped table gets
-- BOTH ENABLE and FORCE (Pitfall 5: ENABLE alone exempts the table
-- owner; FORCE binds the owner too).
-- =====================================================================
ALTER TABLE "users"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "sessions"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions"     FORCE  ROW LEVEL SECURITY;
ALTER TABLE "audit_log"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "usage_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_ledger" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
-- Canonical tenant-isolation policy (D-16). The `, true` in
-- `current_setting('app.tenant_id', true)` is missing_ok: when the GUC
-- is unset we get '' instead of an error, '' ::uuid throws inside the
-- policy expression, and the row is denied. Fail-closed by design.
CREATE POLICY "users_tenant_isolation" ON "users"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "usage_ledger_tenant_isolation" ON "usage_ledger"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
-- Grants: openwhispr_app gets DML on every tenant-scoped table and
-- read-only on tenants (which it queries to resolve the tenant for the
-- onRequest hook in Phase 2). It does NOT receive any rights on the
-- _meta schema where __drizzle_migrations lives.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT USAGE ON SCHEMA public TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "users"        TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions"     TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log"    TO openwhispr_app;
		GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_ledger" TO openwhispr_app;
		GRANT SELECT ON "tenants" TO openwhispr_app;
	END IF;
END $$;
