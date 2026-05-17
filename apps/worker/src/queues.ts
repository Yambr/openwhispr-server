// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 Plan 06-08 — typed BullMQ queue registry.
//
// One place to construct the wrapped Queue instances for every Phase 6
// queue plus the pre-existing ingest-litellm-spend queue. Callers
// (enqueue sites in apps/api routes, the scheduler, child-of-parent
// fan-outs) import named queue handles from here so Zod parsing
// happens at every enqueue site.

import type { ConnectionOptions } from "bullmq";
import { auditArchiveSchema } from "./jobs/audit-archive.js";
import { emailDeliverySchema } from "./jobs/email-delivery.js";
import { partmanMaintenanceSchema } from "./jobs/partman-maintenance.js";
import { reconciliationDailyCheckSchema } from "./jobs/reconciliation-daily-check.js";
import { reconciliationDiscrepancySchema } from "./jobs/reconciliation-discrepancy.js";
import { usageRollupDispatcherSchema, usageRollupTenantSchema } from "./jobs/usage-rollup-daily.js";
import { type TypedQueue, typedQueue } from "./lib/typed-queue.js";

export const QUEUE_NAMES = {
  emailDelivery: "email-delivery",
  usageRollupDispatcher: "usage-rollup-daily-dispatcher",
  usageRollupTenant: "usage-rollup-daily-tenant",
  reconciliationDailyCheck: "reconciliation-daily-check",
  reconciliationDiscrepancy: "reconciliation-discrepancy",
  partmanMaintenance: "partman-maintenance",
  auditArchive: "audit-archive",
} as const;

export interface QueueRegistry {
  emailDelivery: TypedQueue<typeof emailDeliverySchema>;
  usageRollupDispatcher: TypedQueue<typeof usageRollupDispatcherSchema>;
  usageRollupTenant: TypedQueue<typeof usageRollupTenantSchema>;
  reconciliationDailyCheck: TypedQueue<typeof reconciliationDailyCheckSchema>;
  reconciliationDiscrepancy: TypedQueue<typeof reconciliationDiscrepancySchema>;
  partmanMaintenance: TypedQueue<typeof partmanMaintenanceSchema>;
  auditArchive: TypedQueue<typeof auditArchiveSchema>;
}

/**
 * Phase 6 Plan 06-08 — per-queue tuning. Centralized defaults so the
 * Helm chart and the docker-compose deploy can re-use the same retry /
 * removeOnComplete policy without re-discovering them per queue.
 *
 * Phase 51 / Plan 51-05 (REVIEW CR-9) — DLQ semantics. Pre-fix, jobs
 * that exhausted `attempts: 5` were silently GC'd after 7 days
 * (`removeOnFail: { age: 7d }`) — no audit row, no operator alert.
 * `email-delivery`, `audit-archive`, and `reconciliation-discrepancy`
 * losses produced no signal.
 *
 * Fix: drop the `removeOnFail` age policy entirely. Failed jobs stay
 * in the BullMQ `failed` set forever (operators can inspect them with
 * `bullmq` / Bull-Board) until manually cleaned. A future plan can
 * mirror them into a Postgres `failed_jobs` audit table for offline
 * retention; this commit closes the silent-loss gap with the minimal
 * surgical fix.
 *
 * Retry backoff also gains jitter (REVIEW worker HIGH) — `delay * 2^n`
 * with a uniform-random factor between 0.5 and 1.0 to break the
 * thundering-herd on upstream-wide outages. Implemented at the
 * BullMQ-options level via the `jitter` option.
 */
export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  // BullMQ `jitter` option: 1 = full jitter (0..delay*2^attempt
  // uniformly), 0 = no jitter. Use 0.5 (half-jitter) which empirically
  // de-correlates worker retry waves without delaying the median by
  // much.
  backoff: { type: "exponential" as const, delay: 1_000, jitter: 0.5 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  // Phase 51 / Plan 51-05 (REVIEW CR-9) — keep failed jobs forever
  // (operator-driven cleanup). NO age-based GC.
  removeOnFail: false as const,
};

export function buildQueueRegistry(connection: ConnectionOptions): QueueRegistry {
  const opts = { connection, defaultJobOptions: DEFAULT_JOB_OPTS };
  return {
    emailDelivery: typedQueue(QUEUE_NAMES.emailDelivery, emailDeliverySchema, opts),
    usageRollupDispatcher: typedQueue(
      QUEUE_NAMES.usageRollupDispatcher,
      usageRollupDispatcherSchema,
      opts,
    ),
    usageRollupTenant: typedQueue(QUEUE_NAMES.usageRollupTenant, usageRollupTenantSchema, opts),
    reconciliationDailyCheck: typedQueue(
      QUEUE_NAMES.reconciliationDailyCheck,
      reconciliationDailyCheckSchema,
      opts,
    ),
    reconciliationDiscrepancy: typedQueue(
      QUEUE_NAMES.reconciliationDiscrepancy,
      reconciliationDiscrepancySchema,
      opts,
    ),
    partmanMaintenance: typedQueue(QUEUE_NAMES.partmanMaintenance, partmanMaintenanceSchema, opts),
    auditArchive: typedQueue(QUEUE_NAMES.auditArchive, auditArchiveSchema, opts),
  };
}

export async function closeQueueRegistry(reg: QueueRegistry): Promise<void> {
  await Promise.allSettled([
    reg.emailDelivery.close(),
    reg.usageRollupDispatcher.close(),
    reg.usageRollupTenant.close(),
    reg.reconciliationDailyCheck.close(),
    reg.reconciliationDiscrepancy.close(),
    reg.partmanMaintenance.close(),
    reg.auditArchive.close(),
  ]);
}
