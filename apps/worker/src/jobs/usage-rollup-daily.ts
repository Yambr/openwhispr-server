// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — usage-rollup-daily BullMQ job (dispatcher + child).
//
// D-W5 (queue inventory):
//   - Dispatcher: System mode. Cron `5 0 * * *` UTC. Reads distinct tenant
//     ids from `usage_ledger` for the supplied `date` (UTC-bucketed window).
//     For each tenant enqueues a per-tenant child via the typedQueue
//     wrapper. Bounded cardinality (only tenants with non-zero activity).
//   - Tenant child: Tenant mode. {tenant_id, date}. Aggregates the day's
//     usage_ledger rows and UPSERTs into `usage_rollup_daily`. Idempotent
//     via ON CONFLICT (tenant_id, date) DO UPDATE.
//
// Schema note: this plan does NOT add a migration for `usage_rollup_daily`
// — Plan 06-02 / 06-04 own the data layer, and Phase 5 already shipped
// the daily aggregate table for /api/usage. We reference the table as
// already-existing. If a future deploy needs the columns explicit, see
// Plan 06-04's review.

import type { Pool } from "pg";
import { z } from "zod";
import type { TypedQueue } from "../lib/typed-queue.js";
import { withSystemContext } from "../lib/with-system-context.js";
import { withTenantContext } from "../lib/with-tenant-context.js";

/** YYYY-MM-DD UTC bucket. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Dispatcher payload — fires per cron tick. */
export const usageRollupDispatcherSchema = z
  .object({
    date: isoDate,
  })
  .strict();
export type UsageRollupDispatcherPayload = z.infer<typeof usageRollupDispatcherSchema>;

/** Per-tenant child payload. */
export const usageRollupTenantSchema = z
  .object({
    tenant_id: z.string().uuid(),
    date: isoDate,
  })
  .strict();
export type UsageRollupTenantPayload = z.infer<typeof usageRollupTenantSchema>;

export interface UsageRollupDispatcherDeps {
  ownerPool: Pool;
  childQueue: Pick<TypedQueue<typeof usageRollupTenantSchema>, "add">;
}

/**
 * Dispatcher handler — System context. Reads from the owner pool (BYPASSRLS)
 * because it iterates across all tenants. Bounded cardinality: SELECT
 * DISTINCT tenant_id over the day's usage_ledger window.
 */
export function buildUsageRollupDispatcher(
  deps: UsageRollupDispatcherDeps,
): (job: import("bullmq").Job) => Promise<{ tenants: number }> {
  return withSystemContext(
    usageRollupDispatcherSchema,
    async (data): Promise<{ tenants: number }> => {
      const { rows } = await deps.ownerPool.query<{ tenant_id: string }>(
        `SELECT DISTINCT tenant_id::text AS tenant_id
         FROM usage_ledger
        WHERE created_at >= ($1::date)
          AND created_at <  ($1::date + INTERVAL '1 day')`,
        [data.date],
      );
      for (const row of rows) {
        await deps.childQueue.add("usage-rollup-daily-tenant", {
          tenant_id: row.tenant_id,
          date: data.date,
        });
      }
      return { tenants: rows.length };
    },
  );
}

export interface UsageRollupTenantDeps {
  pool: Pool;
}

/**
 * Per-tenant child handler — Tenant context. The withTenantContext HOF
 * BEGIN+set_config-binds the GUC, so the SELECT below sees RLS-filtered
 * rows for the active tenant only. The UPSERT writes to a tenant-scoped
 * rollup table.
 *
 * usage_rollup_daily is expected to have shape (tenant_id, date,
 * total_units, kind_breakdown_jsonb) with a unique constraint on
 * (tenant_id, date). The handler is idempotent: re-running it for the
 * same (tenant_id, date) re-derives the totals and overwrites the row.
 */
export function buildUsageRollupTenantHandler(
  deps: UsageRollupTenantDeps,
): (job: import("bullmq").Job) => Promise<void> {
  return withTenantContext(usageRollupTenantSchema, deps.pool, async (data) => {
    await deps.pool.query(
      `WITH per_kind AS (
         SELECT kind, SUM(units)::int AS units_sum
           FROM usage_ledger
          WHERE tenant_id = $1::uuid
            AND created_at >= ($2::date)
            AND created_at <  ($2::date + INTERVAL '1 day')
          GROUP BY kind
       )
       INSERT INTO usage_rollup_daily (tenant_id, date, total_units, kind_breakdown)
       SELECT $1::uuid,
              $2::date,
              COALESCE((SELECT SUM(units_sum)::int FROM per_kind), 0),
              COALESCE((SELECT jsonb_object_agg(kind, units_sum) FROM per_kind), '{}'::jsonb)
       ON CONFLICT (tenant_id, date) DO UPDATE
         SET total_units    = EXCLUDED.total_units,
             kind_breakdown = EXCLUDED.kind_breakdown,
             rolled_up_at   = now()`,
      [data.tenant_id, data.date],
    );
  });
}
