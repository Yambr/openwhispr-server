-- Phase 6 / Plan 02 — convert audit_log to monthly RANGE-partitioned parent.
--
-- D-A2: pg_partman 5.2.4 monthly partitions. RLS on parent propagates to
-- all children automatically (PG 13+ native declarative partitioning).
-- D-A6: 18-action CHECK constraint enumerated verbatim.
--
-- Migration shape (the online "rename → create empty parent → register
-- with partman → copy rows back → drop legacy" pattern):
--
--   1. Rename existing flat audit_log out of the way.
--   2. CREATE TABLE audit_log (... PARTITION BY RANGE (created_at)).
--      Primary key MUST include the partition key.
--   3. Recreate indexes (propagate to children automatically).
--   4. ENABLE + FORCE RLS + policy on the parent (children inherit).
--   5. Register with pg_partman (monthly RANGE, p_premake=4).
--   6. Configure retention to 13 months, keep_table=true.
--   7. INSERT legacy rows into the new partitioned parent (router
--      delivers each row to the right monthly child by created_at).
--   8. DROP the legacy table.
--   9. GRANT the canonical DML chain to openwhispr_app.
--
-- Numbering note: 0011-0013 were already taken by notes/folders/
-- transcriptions cloud-column migrations; we use 0014 to preserve
-- linear migration order. The plan's frontmatter references the
-- conceptual "0011" — see 06-02-SUMMARY.md for the deviation record.

-- 1. Rename out of the way ---------------------------------------------------
ALTER TABLE "audit_log" RENAME TO "audit_log_legacy";
--> statement-breakpoint

-- 1a. Drop the original RLS policy + foreign key references so we can
--     rebuild them on the new parent. (The legacy table is dropped at the
--     end of this migration.)
ALTER TABLE "audit_log_legacy" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "audit_log_tenant_isolation" ON "audit_log_legacy";
--> statement-breakpoint

-- 1b. Rename legacy indexes so we can recreate them on the new parent
--     with their canonical names. ALTER TABLE RENAME does not rename
--     indexes; we ALTER INDEX directly.
ALTER INDEX "audit_log_tenant_id_idx"  RENAME TO "audit_log_legacy_tenant_id_idx";
--> statement-breakpoint
ALTER INDEX "audit_log_created_at_idx" RENAME TO "audit_log_legacy_created_at_idx";
--> statement-breakpoint

-- 2. Create the partitioned parent -------------------------------------------
CREATE TABLE "audit_log" (
	"id" uuid NOT NULL DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY ("id", "created_at"),
	CONSTRAINT "audit_log_action_check" CHECK ("action" IN (
		'auth.signin',
		'auth.signin_failed',
		'auth.signout',
		'auth.password_change',
		'auth.oauth_link',
		'account.delete',
		'account.delete_requested',
		'key.issued',
		'key.revoked',
		'settings.tenant_changed',
		'settings.user_changed',
		'admin.tenant_created',
		'admin.tenant_suspended',
		'admin.user_impersonated',
		'admin.role_changed',
		'security.cross_tenant_attempt',
		'security.rate_limit_exceeded',
		'security.ssrf_blocked'
	)),
	CONSTRAINT "audit_log_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
		ON DELETE no action ON UPDATE no action
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint

-- 3. Indexes on the parent — auto-propagate to children ----------------------
CREATE INDEX "audit_log_tenant_id_idx"  ON "audit_log" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");
--> statement-breakpoint

-- 4. RLS + canonical tenant-isolation policy on the parent -------------------
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- 5+6. Partition strategy — pg_partman when available, native DEFAULT
--      partition otherwise (quick 260602-fda, blocker #1).
--
-- Managed cloud Postgres (and any cluster where pg_partman is not
-- installed — pg_partman is NOT a trusted extension, so it needs a server
-- package + superuser CREATE EXTENSION) would otherwise fail this
-- migration: partman.create_parent + partman.part_config do not exist and
-- the audited fail-closed INSERT on auth.signin would then have no child
-- partition to route into. We auto-detect:
--
--   * pg_partman present  → register the parent (monthly RANGE, premake 4)
--     + retention (13 months, keep_table) — full auto-rotation. Operators
--     who install partman get rotation with zero further config ("turn it
--     on and it works").
--   * pg_partman absent   → create a single native DEFAULT partition so
--     every row routes into `audit_log_default`. INSERTs / auth.signin work
--     with zero partman dependency; there is just no automatic monthly
--     child creation or retention. The daily partman-maintenance worker job
--     no-ops when the extension is absent.
--
-- audit_log itself is ALWAYS a partitioned parent (steps 1-4 above), so the
-- shape is identical for downstream readers in both branches.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_partman') THEN
		PERFORM partman.create_parent(
			p_parent_table  => 'public.audit_log',
			p_control       => 'created_at',
			p_type          => 'range',
			p_interval      => '1 month',
			p_premake       => 4
		);
		UPDATE partman.part_config
			 SET retention                = '13 months',
			     retention_keep_table     = true,
			     retention_keep_index     = false,
			     infinite_time_partitions = true,
			     inherit_privileges       = true
		 WHERE parent_table = 'public.audit_log';
	ELSE
		-- No pg_partman: a single catch-all DEFAULT partition keeps the
		-- partitioned parent insertable. `IF NOT EXISTS` keeps the migration
		-- idempotent if re-run by hand.
		CREATE TABLE IF NOT EXISTS "audit_log_default"
			PARTITION OF "audit_log" DEFAULT;
	END IF;
END
$$;
--> statement-breakpoint

-- 7. Copy legacy rows into the partitioned parent ---------------------------
--    `create_parent` above already materialized the current month plus
--    p_premake=4 future months. Legacy rows whose `created_at` predates
--    that window fall through to the catch-all `audit_log_default`
--    partition (enabled by `infinite_time_partitions = true`); the
--    daily `partman-maintenance` BullMQ job (Plan 06-08, D-A4) is
--    responsible for promoting them into properly-bounded monthly
--    children via partman.partition_data_proc when invoked outside a
--    wrapping transaction.
--
--    We deliberately do NOT call `run_maintenance_proc()` here because
--    it issues a COMMIT inside the procedure body, which is illegal
--    when the migration runner wraps each migration in a transaction.
INSERT INTO "audit_log" ("id", "tenant_id", "actor_user_id", "action", "payload", "created_at")
	SELECT "id", "tenant_id", "actor_user_id", "action", "payload", "created_at"
	  FROM "audit_log_legacy";
--> statement-breakpoint

-- 8. Drop the legacy table -------------------------------------------------
DROP TABLE "audit_log_legacy";
--> statement-breakpoint

-- 9. Re-grant DML to openwhispr_app on the new parent ----------------------
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log" TO openwhispr_app;
	END IF;
END
$$;
