-- Phase 6 / Plan 06-08 — usage_rollup_daily table.
--
-- D-W5 (queue inventory) usage-rollup-daily job aggregates a tenant's
-- usage_ledger rows for one UTC date and UPSERTs into this rollup table.
-- Reads from /api/usage daily charts hit the rollup; the per-request
-- ledger remains the source of truth (idempotency via request_id).
--
-- RLS: canonical tenant_isolation policy via current_setting GUC.
-- Idempotent on (tenant_id, date) — the rollup job is safe to re-run.

CREATE TABLE "usage_rollup_daily" (
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"total_units" integer NOT NULL DEFAULT 0,
	"kind_breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"rolled_up_at" timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY ("tenant_id", "date")
);
--> statement-breakpoint

ALTER TABLE "usage_rollup_daily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_rollup_daily" FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "usage_rollup_daily_isolation" ON "usage_rollup_daily"
	USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
	WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

CREATE INDEX "usage_rollup_daily_date_idx" ON "usage_rollup_daily" ("date");
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
		GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_rollup_daily" TO openwhispr_app;
	END IF;
END $$;
