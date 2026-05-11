// Phase 6 Plan 06-08 — recurring-job scheduler bootstrap.
//
// Registers cron-shaped repeatable jobs via BullMQ's `upsertJobScheduler`
// API (the modern Job Schedulers — `repeat: { every }` was deprecated in
// BullMQ 5.x, see ingest-litellm-spend's RESEARCH Pitfall #4).
//
// Cron schedule per D-W5 / 06-08 plan:
//
//   | Queue                          | Cron        | Why                           |
//   |--------------------------------|-------------|-------------------------------|
//   | usage-rollup-daily-dispatcher  | `5 0 * * *` | Just after UTC midnight       |
//   | reconciliation-daily-check     | `0 1 * * *` | 1h after rollup so ledger has settled |
//   | partman-maintenance            | `0 2 * * *` | After reconciliation; before peak |
//   | virtual-key-rotation (sentinel)| `0 3 * * 0` | Weekly Sunday — dispatcher shape |
//
// audit-archive is NOT scheduled directly: partman-maintenance enqueues it
// per-detached-partition.
//
// virtual-key-rotation cron uses a sentinel payload (tenant_id +
// user_id = nil-UUID) — the production rotation cron path is owned by a
// separate dispatcher in a future plan; this is the minimum to satisfy
// the must_have acceptance criterion. On-demand rotation goes via
// /api/admin/keys/rotate (Plan 06-09).

import type { QueueRegistry } from "./queues.js";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** UTC date helper — used as the rollup dispatcher's payload `date` field. */
function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface SchedulerConfig {
  /**
   * Override defaults at boot — operators can flip cron strings via env if
   * a deploy needs a different cadence (e.g. staggered fleet rollouts).
   */
  usageRollupCron?: string;
  reconciliationCron?: string;
  partmanCron?: string;
  virtualKeyRotationCron?: string;
}

export const DEFAULT_SCHEDULER_CONFIG: Required<SchedulerConfig> = {
  usageRollupCron: "5 0 * * *",
  reconciliationCron: "0 1 * * *",
  partmanCron: "0 2 * * *",
  virtualKeyRotationCron: "0 3 * * 0",
};

export async function installSchedulers(
  registry: QueueRegistry,
  config: SchedulerConfig = {},
  now: Date = new Date(),
): Promise<void> {
  const cfg = { ...DEFAULT_SCHEDULER_CONFIG, ...config };

  // 1. usage-rollup-daily-dispatcher
  await registry.usageRollupDispatcher.upsertJobScheduler(
    "usage-rollup-daily",
    { pattern: cfg.usageRollupCron, tz: "UTC" },
    { name: "usage-rollup-daily", data: { date: utcDateString(now) } },
  );

  // 2. reconciliation-daily-check
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  await registry.reconciliationDailyCheck.upsertJobScheduler(
    "reconciliation-daily",
    { pattern: cfg.reconciliationCron, tz: "UTC" },
    {
      name: "reconciliation-daily-check",
      data: {
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
      },
    },
  );

  // 3. partman-maintenance — empty-payload, no jobData parsing.
  await registry.partmanMaintenance.upsertJobScheduler(
    "partman-maintenance",
    { pattern: cfg.partmanCron, tz: "UTC" },
    { name: "partman-maintenance", data: {} },
  );

  // 4. virtual-key-rotation — sentinel payload; production dispatcher
  //    iterates the user/tenant table to fan-out per-user children.
  await registry.virtualKeyRotation.upsertJobScheduler(
    "virtual-key-rotation-weekly",
    { pattern: cfg.virtualKeyRotationCron, tz: "UTC" },
    {
      name: "virtual-key-rotation",
      data: { tenant_id: NIL_UUID, user_id: NIL_UUID, reason: "scheduled" },
    },
  );
}
