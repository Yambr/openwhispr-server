// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — reconciliation-discrepancy BullMQ job.
// Phase 36.b (CRIT-FIX-08) — honest windowed backfill.
//
// D-R3 (alert + backfill): Tenant context. Child of reconciliation-daily-
// check OR ingest-litellm-spend. Re-ingests the LiteLLM_SpendLogs window
// `[payload.since, payload.until)` for `payload.tenant_id` via the extended
// `runIngestOnce(deps, { since, until, tenantId })` signature. The
// per-window SQL path filters on `startTime BETWEEN since AND until` AND
// joins `users` on the target `tenant_id` so cross-tenant rows are skipped.
// Idempotency: `ON CONFLICT (request_id) DO NOTHING` in usage_ledger —
// re-running over an already-ingested window is a no-op.
//
// Before Phase 36.b: this handler called runIngestOnce with no args, which
// advanced the *global* watermark and ingested whatever was next in the
// queue — NOT the discrepancy window, NOT scoped to the affected tenant.
// The TS signature was masked via a double-cast (see worker.md CR-02).
// CRIT-FIX-08 closes both:
//   1. real windowed backfill (extended signature in ingest-litellm-spend.ts),
//   2. honest return type — caller can destructure { rowsProcessed,
//      rowsScanned } without the previous TypeError-on-undefined risk.

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
    // Phase 66 / CR-06 — additive, OPTIONAL window identifier. The schema
    // is `.strict()`, so a NEW field MUST be declared here or `.parse()`
    // rejects the payload. Optional so existing enqueue sites and
    // backfill jobs that omit it still parse. reconciliation-daily-check
    // sets it AND uses it to derive the BullMQ `jobId` so a retried
    // breach fan-out collapses per-tenant re-enqueues instead of
    // duplicating them.
    window_id: z.string().optional(),
  })
  .strict();
export type ReconciliationDiscrepancyPayload = z.infer<typeof reconciliationDiscrepancySchema>;

export interface ReconciliationDiscrepancyDeps {
  pool: Pool;
  ingestDeps: IngestDeps;
}

export interface ReconciliationDiscrepancyResult {
  rowsProcessed: number;
  rowsScanned: number;
}

/**
 * Build the windowed-backfill handler. Returns a function compatible with
 * BullMQ's processor signature that yields the REAL row counts from the
 * underlying `runIngestOnce` invocation.
 *
 * Type-honesty: the previous implementation masked the return type over
 * `withTenantContext`'s `Promise<void>` HOF with a double-cast. We now use
 * a closure-captured `result` slot that the inner handler fills BEFORE
 * returning void; the outer wrapper reads the slot. No type suppression.
 */
export function buildReconciliationDiscrepancyHandler(
  deps: ReconciliationDiscrepancyDeps,
): (job: import("bullmq").Job) => Promise<ReconciliationDiscrepancyResult> {
  return async (job: import("bullmq").Job): Promise<ReconciliationDiscrepancyResult> => {
    // Closure-captured slot. `withTenantContext`'s handler is forced to
    // `Promise<void>` by the HOF contract; the inner code assigns to
    // `captured` before resolving, and the outer wrapper returns it.
    // Type-safe: no double-cast, no `void result` swallow.
    let captured: ReconciliationDiscrepancyResult | undefined;
    const wrapped = withTenantContext(
      reconciliationDiscrepancySchema,
      deps.pool,
      async (data): Promise<void> => {
        // CRIT-FIX-08: explicit windowed backfill scoped to the affected
        // tenant. runIngestOnce returns real {rowsProcessed, rowsScanned};
        // we capture both so the caller / observability layer can see how
        // many rows the backfill actually moved.
        captured = await runIngestOnce(deps.ingestDeps, {
          since: data.since,
          until: data.until,
          tenantId: data.tenant_id,
        });
      },
    );
    await wrapped(job);
    /* c8 ignore start — defensive: `withTenantContext` either throws (schema
       parse failure / handler throw) or runs the inner handler to completion,
       which always assigns `captured` before returning. Reaching this branch
       would require the HOF to swallow a throw — structurally impossible. */
    if (!captured) {
      throw new Error(
        "reconciliation-discrepancy: handler completed without capturing ingest result",
      );
    }
    /* c8 ignore stop */
    return captured;
  };
}
