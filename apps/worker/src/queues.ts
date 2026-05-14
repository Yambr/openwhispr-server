// SPDX-License-Identifier: Apache-2.0
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
 */
export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
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
