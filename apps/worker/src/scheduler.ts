// SPDX-License-Identifier: FSL-1.1-ALv2
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
//
// audit-archive is NOT scheduled directly: partman-maintenance enqueues it
// per-detached-partition.
//
// Phase 14 / Plan 05 — virtual-key-rotation cron removed wholesale per
// CONTEXT decision 3 + BYOK-03 audit closure. The previous nil-UUID
// sentinel payload could never succeed against the noop adapters; the
// production rotation dispatcher does not exist and is out of Phase 14
// scope. See `apps/worker/src/index.ts` for the transient Valkey
// cleanup that drains stale `bull:virtual-key-rotation:*` keys on
// boot for upgrade-in-place operators.

import type { QueueRegistry } from "./queues.js";

// Phase 51 / Plan 51-05 — `utcDateString` retired. Handlers now derive
// the date from `job.timestamp` via `dateStringForJob()` (defined below)
// because the scheduler no longer freezes a `date:` literal into the
// payload at install time (REVIEW CR-8 fix).

export interface SchedulerConfig {
  /**
   * Override defaults at boot — operators can flip cron strings via env if
   * a deploy needs a different cadence (e.g. staggered fleet rollouts).
   */
  usageRollupCron?: string;
  reconciliationCron?: string;
  partmanCron?: string;
}

export const DEFAULT_SCHEDULER_CONFIG: Required<SchedulerConfig> = {
  usageRollupCron: "5 0 * * *",
  reconciliationCron: "0 1 * * *",
  partmanCron: "0 2 * * *",
};

export async function installSchedulers(
  registry: QueueRegistry,
  config: SchedulerConfig = {},
  _now: Date = new Date(),
): Promise<void> {
  // Phase 51 / Plan 51-05 (REVIEW CR-8) — schedulers no longer
  // materialize `date` / `window_start` / `window_end` at install
  // time. BullMQ re-fires the same payload on every cron tick, so the
  // pre-fix code would ship the install-boot date forever. Empty
  // payloads now flow through and the handlers compute the rollup
  // date from `job.timestamp ?? Date.now()` themselves.
  //
  // The `now` parameter is kept (underscore-prefixed) so the signature
  // is wire-compatible with existing tests and so a future per-boot
  // backfill plan can re-enable explicit-date payloads without a
  // breaking change.
  const cfg = { ...DEFAULT_SCHEDULER_CONFIG, ...config };

  // 1. usage-rollup-daily-dispatcher
  await registry.usageRollupDispatcher.upsertJobScheduler(
    "usage-rollup-daily",
    { pattern: cfg.usageRollupCron, tz: "UTC" },
    { name: "usage-rollup-daily", data: {} },
  );

  // 2. reconciliation-daily-check
  await registry.reconciliationDailyCheck.upsertJobScheduler(
    "reconciliation-daily",
    { pattern: cfg.reconciliationCron, tz: "UTC" },
    { name: "reconciliation-daily-check", data: {} },
  );

  // 3. partman-maintenance — empty-payload, no jobData parsing.
  await registry.partmanMaintenance.upsertJobScheduler(
    "partman-maintenance",
    { pattern: cfg.partmanCron, tz: "UTC" },
    { name: "partman-maintenance", data: {} },
  );
}

/**
 * Phase 51 / Plan 51-05 (REVIEW CR-8) — date helper for handlers that
 * formerly consumed a frozen `data.date` from the scheduler payload.
 * Handlers should call this with `job.timestamp` so the rollup runs
 * against the day the cron actually fired, not the day the worker
 * booted. Exported for the handler tests.
 */
export function dateStringForJob(job: { timestamp?: number }): string {
  const ts = typeof job.timestamp === "number" ? job.timestamp : Date.now();
  return new Date(ts).toISOString().slice(0, 10);
}
