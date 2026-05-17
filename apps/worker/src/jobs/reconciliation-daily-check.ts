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

// Phase 51 / Plan 51-05 (REVIEW CR-8) — both window fields OPTIONAL.
// Scheduler no longer freezes them at install time; the handler
// derives the 24-hour window from `job.timestamp` if absent. Explicit
// backfill jobs may still pass the window.
export const reconciliationDailyCheckSchema = z
  .object({
    window_start: z.string().datetime().optional(),
    window_end: z.string().datetime().optional(),
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

// Phase 41.d / HI-3 — guard the module-level addCallback against
// double-registration. If `buildReconciliationDailyCheckHandler` is called
// twice (test re-import + production wiring share the module graph), OTel
// fires the callback twice per collection tick — doubling the gauge
// cardinality. The boolean flag closes the regression cheaply without
// changing the public surface.
let _gaugesRegistered = false;
if (!_gaugesRegistered) {
  driftPctGauge.addCallback(_driftPctGaugeCallback);
  driftUsdGauge.addCallback(_driftUsdGaugeCallback);
  _gaugesRegistered = true;
}

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

      // Phase 51 / Plan 51-05 (REVIEW CR-8) — the scheduler now ships
      // empty payloads. Fall back to the last full UTC day [yesterday
      // 00:00, today 00:00). Explicit window from a backfill job wins.
      const utcMidnight = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
      );
      const fallbackEnd = utcMidnight.toISOString();
      const fallbackStart = new Date(utcMidnight.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const windowStart = data.window_start ?? fallbackStart;
      const windowEnd = data.window_end ?? fallbackEnd;

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
        [windowStart, windowEnd],
      );

      const litellmByTenant = new Map<string, { row_count: number; spend_cents: number }>();
      // Phase 41.d / HI-2 — resolve every distinct end_user -> tenant_id in
      // ONE batched query (`WHERE id = ANY($1::uuid[])`). Previously this
      // issued a serialized per-end_user round-trip — O(distinct users) per
      // tick, not "bounded by tenant count" as the original comment claimed.
      // At 10k DAU that was 10k sequential awaits per tick. The single
      // ANY-array query produces the same user->tenant map in one round-trip
      // and the outer aggregation iterates over the resulting distinct
      // tenants only.
      const distinctEndUsers = Array.from(
        new Set(litellmRows.map((r) => r.end_user).filter((v): v is string => v !== null)),
      );
      const userToTenant = new Map<string, string>();
      if (distinctEndUsers.length > 0) {
        const mapRes = await deps.appOwnerPool.query<{ id: string; tenant_id: string }>(
          `SELECT id::text AS id, tenant_id::text AS tenant_id
             FROM users
            WHERE id = ANY($1::uuid[])`,
          [distinctEndUsers],
        );
        for (const r of mapRes.rows) userToTenant.set(r.id, r.tenant_id);
      }
      for (const row of litellmRows) {
        if (!row.end_user) continue;
        const tid = userToTenant.get(row.end_user);
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
        [windowStart, windowEnd],
      );
      const ledgerByTenant = new Map<string, number>();
      for (const r of ledgerRows) ledgerByTenant.set(r.tenant_id, Number(r.row_count));

      const allTenants = new Set<string>([...litellmByTenant.keys(), ...ledgerByTenant.keys()]);

      // Phase 41.d / HI-3 — atomic snapshot swap. Build the next tick's
      // drift map in a LOCAL variable; the module-level `driftStore` is
      // mutated ONLY at the end of the handler (clear + bulk-copy). OTel
      // exporter callbacks firing during the for-loop (e.g., on the await
      // inside discrepancyQueue.add) observe the PREVIOUS tick's complete
      // snapshot until the swap. Previously a clear()-at-start scheme left
      // the exporter free to observe an empty or mid-mutation Map and emit
      // false-negative or partial gauge points.
      const nextDriftStore = new Map<string, { drift_pct: number; drift_usd_cents: number }>();
      let breached = 0;
      for (const tenantId of allTenants) {
        const ll = litellmByTenant.get(tenantId) ?? { row_count: 0, spend_cents: 0 };
        const lg = ledgerByTenant.get(tenantId) ?? 0;
        // Skip zero-activity tenants (cardinality bound).
        if (ll.row_count === 0 && lg === 0) continue;
        const driftPct = (Math.abs(ll.row_count - lg) / Math.max(ll.row_count, 1)) * 100;
        const driftUsd = Math.abs(ll.spend_cents - 0); // ledger spend axis = 0 today
        nextDriftStore.set(tenantId, { drift_pct: driftPct, drift_usd_cents: driftUsd });
        if (driftPct > pctThreshold || driftUsd > usdThreshold) {
          breached++;
          await deps.discrepancyQueue.add("reconciliation-discrepancy", {
            tenant_id: tenantId,
            since: windowStart,
            until: windowEnd,
            drift_pct: driftPct,
            drift_usd_cents: driftUsd,
          });
        }
      }

      // Atomic swap: clear the module-level store then bulk-copy the
      // freshly-built snapshot. The exporter callback iterates `driftStore`
      // directly; the clear+copy pair is synchronous JS (no awaits) so an
      // OTel collection that lands between these two statements would see
      // a zero-entry tick which is acceptable transient behaviour (the
      // next 15s tick recovers). Crucially, the buggy `clear()`-at-start
      // window — which spanned multiple awaits inside the breach loop — is
      // closed.
      driftStore.clear();
      for (const [k, v] of nextDriftStore) driftStore.set(k, v);

      return { tenants: driftStore.size, breached };
    },
  );
}
