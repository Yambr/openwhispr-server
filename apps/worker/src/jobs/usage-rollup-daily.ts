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

import { withSystemBypassClient } from "@openwhispr/data";
import type { Pool } from "pg";
import { z } from "zod";
import type { TypedQueue } from "../lib/typed-queue.js";
import { withSystemContext } from "../lib/with-system-context.js";
import { withTenantContext } from "../lib/with-tenant-context.js";

/** YYYY-MM-DD UTC bucket. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/**
 * Dispatcher payload — fires per cron tick.
 *
 * Phase 51 / Plan 51-05 (REVIEW CR-8) — `date` is OPTIONAL. The
 * scheduler no longer freezes the date at install time; handlers
 * derive the day from `job.timestamp` via `dateStringForJob()`.
 * Operators can still enqueue a one-off backfill job with an explicit
 * `date` and the handler will use it as-is.
 */
export const usageRollupDispatcherSchema = z
  .object({
    date: isoDate.optional(),
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
      // Phase 51 / Plan 51-05 (REVIEW CR-8) — the scheduler now ships
      // empty payloads on every tick. Fall back to "yesterday UTC" so
      // a midnight-cron fire rolls up the day that just closed.
      // Explicit `data.date` (e.g. for backfill) wins.
      const date =
        data.date ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // Phase 58 Track B / worker:CR-02 — bucket by COALESCE(event_at,
      // created_at). event_at carries the LiteLLM startTime (when the spend
      // actually occurred); created_at is the worker ingest timestamp. A row
      // ingested 30s after UTC midnight must roll up into the day its spend
      // occurred, not the day it landed. Historical rows have NULL event_at
      // and fall back to created_at — no already-published number shifts.
      // Quick 260602-j9z (blocker #2) — this cross-tenant SELECT on the
      // FORCE-RLS usage_ledger table runs through the claim-driven bypass so a
      // single NOBYPASSRLS role works (no reliance on the owner BYPASSRLS
      // attribute). withSystemBypassClient sets app.bypass='on' inside a tx.
      const rows = await withSystemBypassClient(deps.ownerPool, async (client) => {
        const res = (await client.query(
          `SELECT DISTINCT tenant_id::text AS tenant_id
             FROM usage_ledger
            WHERE COALESCE(event_at, created_at) >= ($1::date)
              AND COALESCE(event_at, created_at) <  ($1::date + INTERVAL '1 day')`,
          [date],
        )) as { rows: Array<{ tenant_id: string }> };
        return res.rows;
      });
      for (const row of rows) {
        await deps.childQueue.add("usage-rollup-daily-tenant", {
          tenant_id: row.tenant_id,
          date,
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
  // Phase 51 / Plan 51-05 (REVIEW CR-7) — run the UPSERT against the
  // bound client (which has `app.tenant_id` set via set_config), NOT
  // against `deps.pool.query(...)` which would check out a different
  // connection without the GUC and trip the app-pool runtime guard
  // (`TenantContextMissingError`). The handler now signature-takes
  // (data, client).
  return withTenantContext(usageRollupTenantSchema, deps.pool, async (data, client) => {
    await client.query(
      // Phase 58 Track B / worker:CR-02 — bucket by COALESCE(event_at,
      // created_at), the SAME expression the dispatcher uses, so the
      // per-tenant aggregate matches the day the dispatcher enqueued.
      `WITH per_kind AS (
         SELECT kind, SUM(units)::int AS units_sum
           FROM usage_ledger
          WHERE tenant_id = $1::uuid
            AND COALESCE(event_at, created_at) >= ($2::date)
            AND COALESCE(event_at, created_at) <  ($2::date + INTERVAL '1 day')
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
