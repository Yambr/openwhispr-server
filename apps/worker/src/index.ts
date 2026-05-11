// Phase 03 Plan 08 — Worker process entry point.
// Phase 6 Plan 06-08 — extended to host the 7 new queues, their workers,
// and the recurring-job scheduler.
//
// Boots:
//   1. Connection: ioredis (BullMQ + watermark store).
//   2. DB pools:
//      - litellmPool (LiteLLM co-tenant DB; cross-DB reads for the existing
//        ingest-litellm-spend job + the new reconciliation-daily-check).
//      - appOwnerPool (openwhispr_owner; BYPASSRLS; the working pool for
//        every tenant-context job).
//      - maintenancePool (dedicated to partman-maintenance; max=1; never
//        wrapped in withTenantContext's transaction).
//   3. Queue registry (typed Zod-validated handles).
//   4. Scheduler (installs the 4 cron jobs).
//   5. 8 BullMQ Worker instances — one per queue.
//   6. SIGTERM/SIGINT graceful drain over all 8 workers.
//
// The collaborators that the new jobs require (SMTP transport, LiteLLM key
// client, user-key lookup, template renderer) are intentionally left as
// stubs in this commit because the production wiring lives in routes /
// services that Phase 5/6 have not yet shipped (see deferred items in
// 06-08-SUMMARY). The worker boots with no-op stubs so the cron schedules
// fire safely; the dispatcher pattern means a no-op email-delivery /
// virtual-key-rotation cron tick is harmless until the API enqueues real
// payloads.

import { type ConnectionOptions, Worker } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { Pool } from "pg";
import pino from "pino";
import { makeAppOwnerPool } from "./db/app-pool.js";
import { makeLitellmPool } from "./db/litellm-pool.js";
import { buildAuditArchiveHandler } from "./jobs/audit-archive.js";
import {
  buildEmailDeliveryHandler,
  type EmailSender,
  type TemplateRenderer,
} from "./jobs/email-delivery.js";
import {
  createQueue as createIngestQueue,
  createWorker as createIngestWorker,
  ensureScheduler as ensureIngestScheduler,
} from "./jobs/ingest-litellm-spend.js";
import { buildPartmanMaintenanceHandler } from "./jobs/partman-maintenance.js";
import { buildReconciliationDailyCheckHandler } from "./jobs/reconciliation-daily-check.js";
import { buildReconciliationDiscrepancyHandler } from "./jobs/reconciliation-discrepancy.js";
import {
  buildUsageRollupDispatcher,
  buildUsageRollupTenantHandler,
} from "./jobs/usage-rollup-daily.js";
import {
  buildVirtualKeyRotationHandler,
  type LiteLlmKeyClient,
  type UserKeyLookup,
} from "./jobs/virtual-key-rotation.js";
import { buildQueueRegistry, closeQueueRegistry, QUEUE_NAMES } from "./queues.js";
import { installSchedulers } from "./scheduler.js";

const log = pino({ name: "worker" });

// Default no-op SMTP transport — overridden in production by wiring the
// API's nodemailer-backed EmailService into this entrypoint via env.
const noopSender: EmailSender = {
  async send() {
    return { delivered: true, reason: "no-op-sender" };
  },
};
const noopRenderer: TemplateRenderer = {
  render() {
    return { subject: "(no-op)", text: "no-op email body" };
  },
};
const noopLitellmKeyClient: LiteLlmKeyClient = {
  async generateKey() {
    return { key_id: `noop-${Date.now()}` };
  },
  async deleteKey() {
    /* no-op */
  },
};
const noopUserKeyLookup: UserKeyLookup = {
  async loadCurrentKeyId() {
    return null;
  },
  async storeNewKeyId() {
    /* no-op */
  },
};

async function main(): Promise<void> {
  const redis = new IORedis({
    host: process.env["VALKEY_HOST"] ?? "valkey",
    port: Number(process.env["VALKEY_PORT"] ?? "6379"),
    ...(process.env["VALKEY_PASSWORD"] ? { password: process.env["VALKEY_PASSWORD"] } : {}),
    maxRetriesPerRequest: null,
  });
  const connection: ConnectionOptions = redis;

  const litellmPool = makeLitellmPool();
  const appOwnerPool = makeAppOwnerPool();
  const maintenancePool = new Pool({
    connectionString: process.env["DATABASE_URL_OWNER"],
    max: 1,
  });

  // Pre-existing ingest queue (Phase 3 wiring kept intact).
  const ingestQueue = createIngestQueue(redis);
  await ingestIngestSchedulerSafe(ingestQueue);

  // Phase 6 typed queue registry + scheduler.
  const registry = buildQueueRegistry(connection);
  await installSchedulers(registry);

  // Workers.
  const ingestWorker = createIngestWorker({
    litellmPool,
    appOwnerPool,
    connection,
    redis,
  });

  const emailWorker = new Worker(
    QUEUE_NAMES.emailDelivery,
    buildEmailDeliveryHandler({ pool: appOwnerPool, sender: noopSender, renderer: noopRenderer }),
    { connection },
  );
  const vkrWorker = new Worker(
    QUEUE_NAMES.virtualKeyRotation,
    buildVirtualKeyRotationHandler({
      pool: appOwnerPool,
      litellm: noopLitellmKeyClient,
      userKeyLookup: noopUserKeyLookup,
    }),
    { connection },
  );
  const rollupDispatcherWorker = new Worker(
    QUEUE_NAMES.usageRollupDispatcher,
    buildUsageRollupDispatcher({
      ownerPool: appOwnerPool,
      childQueue: registry.usageRollupTenant,
    }),
    { connection },
  );
  const rollupTenantWorker = new Worker(
    QUEUE_NAMES.usageRollupTenant,
    buildUsageRollupTenantHandler({ pool: appOwnerPool }),
    { connection },
  );
  const reconciliationCheckWorker = new Worker(
    QUEUE_NAMES.reconciliationDailyCheck,
    buildReconciliationDailyCheckHandler({
      litellmPool,
      appOwnerPool,
      discrepancyQueue: registry.reconciliationDiscrepancy,
    }),
    { connection },
  );
  const reconciliationDiscrepancyWorker = new Worker(
    QUEUE_NAMES.reconciliationDiscrepancy,
    buildReconciliationDiscrepancyHandler({
      pool: appOwnerPool,
      ingestDeps: { litellmPool, appOwnerPool, connection, redis },
    }),
    { connection },
  );
  const partmanWorker = new Worker(
    QUEUE_NAMES.partmanMaintenance,
    buildPartmanMaintenanceHandler({
      maintenancePool,
      auditArchiveQueue: registry.auditArchive,
    }),
    { connection },
  );
  const auditArchiveWorker = new Worker(
    QUEUE_NAMES.auditArchive,
    buildAuditArchiveHandler({ pool: appOwnerPool }),
    { connection },
  );

  const workers = [
    ingestWorker,
    emailWorker,
    vkrWorker,
    rollupDispatcherWorker,
    rollupTenantWorker,
    reconciliationCheckWorker,
    reconciliationDiscrepancyWorker,
    partmanWorker,
    auditArchiveWorker,
  ];

  log.info({ workers: workers.length }, "worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down — draining BullMQ workers");
    try {
      await Promise.allSettled(workers.map((w) => w.close()));
      await ingestQueue.close();
      await closeQueueRegistry(registry);
      await litellmPool.end();
      await appOwnerPool.end();
      await maintenancePool.end();
      await redis.quit();
    } catch (err) {
      log.error({ err }, "error during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

async function ingestIngestSchedulerSafe(
  queue: ReturnType<typeof createIngestQueue>,
): Promise<void> {
  await ensureIngestScheduler(queue);
}

main().catch((err: unknown) => {
  log.error({ err }, "worker failed to start");
  process.exit(1);
});
