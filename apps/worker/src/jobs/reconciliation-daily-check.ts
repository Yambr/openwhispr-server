// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — reconciliation-daily-check BullMQ job.
//
// D-R2 (daily reconciliation): System mode. For each tenant with non-zero
// activity in the window, computes
//   drift_pct = |litellm_rows - ledger_rows| / max(litellm_rows, 1) * 100
//   drift_usd_cents = |litellm_spend_cents - ledger_spend_cents|
// and emits two OTel observable gauges. When EITHER axis breaches the
// env-overridable threshold (RECONCILIATION_DRIFT_PCT_THRESHOLD=0.5 /
// RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD=1) enqueues a per-tenant
// reconciliation-discrepancy child via the typedQueue wrapper.
//
// Cardinality bound (D-R2): the meter only emits gauges for tenants
// represented in the in-memory map populated on this tick — empty tenants
// are not observed.

import { metrics } from "@opentelemetry/api";
import type { Pool } from "pg";
import { z } from "zod";
import type { TypedQueue } from "../lib/typed-queue.js";
import { withSystemContext } from "../lib/with-system-context.js";
import type { reconciliationDiscrepancySchema } from "./reconciliation-discrepancy.js";

export const reconciliationDailyCheckSchema = z
  .object({
    window_start: z.string().datetime(),
    window_end: z.string().datetime(),
  })
  .strict();
export type ReconciliationDailyCheckPayload = z.infer<typeof reconciliationDailyCheckSchema>;

export interface ReconciliationDailyCheckDeps {
  litellmPool: Pool;
  appOwnerPool: Pool;
  discrepancyQueue: Pick<TypedQueue<typeof reconciliationDiscrepancySchema>, "add">;
  /** Env getter — injected so tests can flip thresholds without process.env mutation. */
  env?: (key: string) => string | undefined;
}

interface DriftRow {
  tenant_id: string;
  litellm_rows: number;
  litellm_spend_cents: number;
  ledger_rows: number;
  ledger_spend_cents: number;
}

const meter = metrics.getMeter("worker.reconciliation");
const driftStore = new Map<string, { drift_pct: number; drift_usd_cents: number }>();

// Register observable gauges once at module load. The callbacks read from
// the in-memory `driftStore` populated by the latest tick — bounded
// cardinality because only tenants with non-zero activity are inserted.
const driftPctGauge = meter.createObservableGauge("litellm_reconciliation_drift_pct", {
  description: "Drift between LiteLLM_SpendLogs row count and usage_ledger row count (percent)",
});
const driftUsdGauge = meter.createObservableGauge("litellm_reconciliation_drift_usd_cents", {
  description: "Drift between LiteLLM_SpendLogs spend and usage_ledger spend (US cents)",
});

/** Exported for unit test — invoked by OTel's exporter at collection time. */
export const _driftPctGaugeCallback = (result: {
  observe: (value: number, attrs: Record<string, string>) => void;
}): void => {
  for (const [tenantId, v] of driftStore) {
    result.observe(v.drift_pct, { tenant_id: tenantId });
  }
};
/** Exported for unit test. */
export const _driftUsdGaugeCallback = (result: {
  observe: (value: number, attrs: Record<string, string>) => void;
}): void => {
  for (const [tenantId, v] of driftStore) {
    result.observe(v.drift_usd_cents, { tenant_id: tenantId });
  }
};

driftPctGauge.addCallback(_driftPctGaugeCallback);
driftUsdGauge.addCallback(_driftUsdGaugeCallback);

/** Test-only: clear the in-memory drift store between fixtures. */
export function _resetDriftStoreForTest(): void {
  driftStore.clear();
}
/** Test-only: read the in-memory drift store. */
export function _readDriftStoreForTest(): ReadonlyMap<
  string,
  { drift_pct: number; drift_usd_cents: number }
> {
  return driftStore;
}

function readThreshold(
  env: (k: string) => string | undefined,
  key: string,
  fallback: number,
): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildReconciliationDailyCheckHandler(
  deps: ReconciliationDailyCheckDeps,
): (job: import("bullmq").Job) => Promise<{ tenants: number; breached: number }> {
  const env = deps.env ?? ((k: string) => process.env[k]);
  return withSystemContext(
    reconciliationDailyCheckSchema,
    async (data): Promise<{ tenants: number; breached: number }> => {
      const pctThreshold = readThreshold(env, "RECONCILIATION_DRIFT_PCT_THRESHOLD", 0.5);
      const usdThreshold = readThreshold(env, "RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD", 1);

      // LiteLLM side: count + sum spend per tenant via end_user → users mapping.
      // We aggregate in two passes (LiteLLM DB, then app DB) and merge in JS
      // — simpler than a cross-DB FDW (we deliberately avoid postgres_fdw
      // in this project per Phase 3 D-* boundary).
      const { rows: litellmRows } = await deps.litellmPool.query<{
        end_user: string | null;
        row_count: string;
        spend_cents: string;
      }>(
        `SELECT "end_user",
                COUNT(*)::text         AS row_count,
                COALESCE(SUM((spend * 100))::bigint, 0)::text AS spend_cents
           FROM "LiteLLM_SpendLogs"
          WHERE "startTime" >= $1::timestamptz
            AND "startTime" <  $2::timestamptz
          GROUP BY "end_user"`,
        [data.window_start, data.window_end],
      );

      const litellmByTenant = new Map<string, { row_count: number; spend_cents: number }>();
      // Resolve each end_user to a tenant_id (small in-loop call — bounded
      // by tenant count, not row count; production workloads have ≤ 1000
      // distinct tenants).
      for (const row of litellmRows) {
        if (!row.end_user) continue;
        const tenantRes = await deps.appOwnerPool.query<{ tenant_id: string }>(
          `SELECT tenant_id::text AS tenant_id FROM users WHERE id = $1::uuid LIMIT 1`,
          [row.end_user],
        );
        const tid = tenantRes.rows[0]?.tenant_id;
        if (!tid) continue;
        const existing = litellmByTenant.get(tid) ?? { row_count: 0, spend_cents: 0 };
        existing.row_count += Number(row.row_count);
        existing.spend_cents += Number(row.spend_cents);
        litellmByTenant.set(tid, existing);
      }

      // Ledger side: count + sum (we don't have spend on the ledger; treat
      // units as the comparable count axis only when ledger_spend_cents is
      // not directly tracked. For this check, ledger_spend_cents is held
      // at 0 and only the row count drives drift_pct. This is the agreed
      // shape until DATA-* adds a spend column to usage_ledger.)
      const { rows: ledgerRows } = await deps.appOwnerPool.query<{
        tenant_id: string;
        row_count: string;
      }>(
        `SELECT tenant_id::text AS tenant_id, COUNT(*)::text AS row_count
           FROM usage_ledger
          WHERE created_at >= $1::timestamptz
            AND created_at <  $2::timestamptz
          GROUP BY tenant_id`,
        [data.window_start, data.window_end],
      );
      const ledgerByTenant = new Map<string, number>();
      for (const r of ledgerRows) ledgerByTenant.set(r.tenant_id, Number(r.row_count));

      const allTenants = new Set<string>([...litellmByTenant.keys(), ...ledgerByTenant.keys()]);

      driftStore.clear();
      let breached = 0;
      for (const tenantId of allTenants) {
        const ll = litellmByTenant.get(tenantId) ?? { row_count: 0, spend_cents: 0 };
        const lg = ledgerByTenant.get(tenantId) ?? 0;
        // Skip zero-activity tenants (cardinality bound).
        if (ll.row_count === 0 && lg === 0) continue;
        const driftPct = (Math.abs(ll.row_count - lg) / Math.max(ll.row_count, 1)) * 100;
        const driftUsd = Math.abs(ll.spend_cents - 0); // ledger spend axis = 0 today
        driftStore.set(tenantId, { drift_pct: driftPct, drift_usd_cents: driftUsd });
        if (driftPct > pctThreshold || driftUsd > usdThreshold) {
          breached++;
          await deps.discrepancyQueue.add("reconciliation-discrepancy", {
            tenant_id: tenantId,
            since: data.window_start,
            until: data.window_end,
            drift_pct: driftPct,
            drift_usd_cents: driftUsd,
          });
        }
      }

      return { tenants: driftStore.size, breached };
    },
  );
}
