-- SPDX-License-Identifier: FSL-1.1-ALv2
-- Phase 58 Track B — worker:CR-02 — rollback usage_ledger.event_at.
DROP INDEX IF EXISTS "usage_ledger_event_at_idx";
--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP COLUMN IF EXISTS "event_at";
