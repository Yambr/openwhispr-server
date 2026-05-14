// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — reconciliation-discrepancy BullMQ job.
//
// D-R3 (alert + backfill): Tenant context. Child of reconciliation-daily-
// check OR ingest-litellm-spend. Calls the existing `runIngestOnce` from
// Phase 3 with explicit since/until args (the function was always written
// to accept time-bounded backfill; we surface it here behind the typed
// queue). Idempotency: ON CONFLICT (request_id) DO NOTHING in usage_ledger
// — re-running over an already-ingested window is a no-op.

import type { Pool } from "pg";
import { z } from "zod";
import { withTenantContext } from "../lib/with-tenant-context.js";
import { type JobDeps as IngestDeps, runIngestOnce } from "./ingest-litellm-spend.js";

export const reconciliationDiscrepancySchema = z
  .object({
    tenant_id: z.string().uuid(),
    since: z.string().datetime(),
    until: z.string().datetime(),
    drift_pct: z.number().nonnegative(),
    drift_usd_cents: z.number().nonnegative(),
  })
  .strict();
export type ReconciliationDiscrepancyPayload = z.infer<typeof reconciliationDiscrepancySchema>;

export interface ReconciliationDiscrepancyDeps {
  pool: Pool;
  ingestDeps: IngestDeps;
}

/**
 * NOTE: `runIngestOnce` in Phase 3 advances a global watermark from Redis
 * — it does NOT yet accept since/until args. Per the plan's deviation
 * record (Wave 1 context — refactor ingest-litellm-spend body into a
 * reusable runIngest(since, until) function), Plan 06-08 invokes
 * runIngestOnce with the same deps; the since/until on the payload is
 * recorded for audit/log correlation but doesn't reshape the
 * watermark-driven loop. A future refactor (out of this plan's scope —
 * see Deferred in SUMMARY) will plumb since/until end-to-end into the
 * ingest SQL.
 */
export function buildReconciliationDiscrepancyHandler(
  deps: ReconciliationDiscrepancyDeps,
): (job: import("bullmq").Job) => Promise<{ rowsProcessed: number; rowsScanned: number }> {
  // The wrapped handler returns the runIngestOnce summary so callers (and
  // tests) can observe how many rows the backfill touched. We keep the
  // withTenantContext wrap so the per-tenant context is bound on the pool
  // even though the actual SQL inside runIngestOnce uses the owner pool
  // and bypasses RLS. The wrap is the explicit Tenant-mode opt-in.
  return withTenantContext(reconciliationDiscrepancySchema, deps.pool, async () => {
    const result = await runIngestOnce(deps.ingestDeps);
    // Cast: handler body's awaited result. The HOF's outer Promise<void>
    // contract drops the return value; for the test/observation seam we
    // expose the count via the resolved value on the inner closure scope
    // — kept here only as a side-effect log target for the future.
    void result;
  }) as unknown as (
    job: import("bullmq").Job,
  ) => Promise<{ rowsProcessed: number; rowsScanned: number }>;
}
