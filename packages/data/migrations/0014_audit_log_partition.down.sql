-- Phase 6 / Plan 02 — rollback for 0014_audit_log_partition.sql.
--
-- Restores a flat `audit_log` table, preserving all rows. Invariant:
-- row count BEFORE rollback == row count AFTER rollback. The rollback
-- test in packages/data/migrations/__tests__/0014-audit-log-partition.test.ts
-- seeds a row through the partitioned parent and asserts the same row
-- is queryable after rollback.
--
-- Strategy (deterministic; avoids pg_partman procedural calls that issue
-- internal COMMITs, which are illegal inside a wrapping transaction):
--
--   1. Snapshot every row into a temporary table.
--   2. Remove the partman registration row from partman.part_config.
--   3. DROP TABLE audit_log CASCADE — drops the partitioned parent AND
--      every child partition (audit_log_pYYYY_pMM + audit_log_default).
--   4. CREATE TABLE audit_log (...) in the original Phase 1 flat shape.
--   5. INSERT rows from the snapshot.
--   6. Re-establish RLS + canonical policy + GRANT chain.

-- 1. Snapshot rows.
CREATE TEMPORARY TABLE _audit_log_snapshot AS
	SELECT "id", "tenant_id", "actor_user_id", "action", "payload", "created_at"
	  FROM "audit_log";
--> statement-breakpoint

-- 2. De-register from pg_partman.
DELETE FROM partman.part_config WHERE parent_table = 'public.audit_log';
--> statement-breakpoint

-- 3. Drop the partitioned parent + all children in one statement.
DROP TABLE "audit_log" CASCADE;
--> statement-breakpoint

-- 4. Recreate the original flat audit_log shape from 0000_initial.sql.
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "audit_log_tenant_id_idx"  ON "audit_log" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at");
--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- 5. Restore rows (preserves IDs + created_at).
INSERT INTO "audit_log" ("id", "tenant_id", "actor_user_id", "action", "payload", "created_at")
	SELECT "id", "tenant_id", "actor_user_id", "action", "payload", "created_at"
	  FROM _audit_log_snapshot;
--> statement-breakpoint

DROP TABLE _audit_log_snapshot;
--> statement-breakpoint

-- 6. Re-grant DML to openwhispr_app on the restored flat table.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log" TO openwhispr_app;
	END IF;
END
$$;
