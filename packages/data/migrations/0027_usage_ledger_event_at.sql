-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 58 Track B — worker:CR-02 — usage_ledger.event_at column.
--
-- usage-rollup-daily and reconciliation-daily-check bucketed usage_ledger
-- rows by `created_at` (the worker ingest timestamp), not by the LiteLLM
-- `startTime` (when the spend actually occurred). A rollup tick 30s after
-- UTC midnight allocated yesterday's late-arriving spend into today's
-- bucket; reconciliation read the same column so its drift gauge reported
-- 0 while the rollup was wrong — self-concealing.
--
-- This migration adds `event_at` (timestamptz, nullable) carrying the
-- LiteLLM `startTime`. The ingest job writes it on every new row; the
-- rollup + reconciliation queries bucket on COALESCE(event_at, created_at).
--
-- Going-forward only: historical rows have NULL event_at and keep
-- created_at bucketing via COALESCE, so already-published rollup numbers
-- do NOT shift. No NOT NULL, no DEFAULT — re-computing historical rollups
-- is explicitly out of scope.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS make
-- this migration re-runnable.

ALTER TABLE "usage_ledger" ADD COLUMN IF NOT EXISTS "event_at" timestamptz;
--> statement-breakpoint

-- Supports the rollup/reconciliation window scan on COALESCE(event_at, created_at).
CREATE INDEX IF NOT EXISTS "usage_ledger_event_at_idx"
  ON "usage_ledger" ("tenant_id", "event_at");
