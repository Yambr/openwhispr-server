// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 04 / Task 3 — BYOK boot guard. MUST run BEFORE the
// OTel SDK side-effect import so a misconfigured OTLP endpoint does
// not produce cascading dial noise on stderr before the fatal
// "byok.required" record reaches operators. The guard is a pure-
// function call that returns void on a satisfied env contract.
import { assertBYOKConfig } from "@openwhispr/byok-guard";

assertBYOKConfig();

// Phase 6 / Plan 06-12c — OTel SDK bootstrap MUST be the first executable
// import (after the byok-guard call above) so PinoInstrumentation
// patches `pino` before any worker code imports it (D-T3). Without
// this, `metrics.getMeter()` returns a no-op instrument and
// reconciliation-daily-check's gauges never reach Mimir.
import "./otel-bootstrap.js";

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
// Phase 14 / Plan 05 — the virtual-key-rotation worker, its noop
// LiteLLM key client + user-key lookup adapters, its weekly cron, and
// its Zod queue handle were removed wholesale (CONTEXT decision 3 +
// BYOK-03 audit closure). The production driver does not exist; the
// cron enqueued a nil-UUID sentinel that could never succeed; the
// `noopLitellmKeyClient` + `noopUserKeyLookup` constants were
// internal mocks in production code (forbidden by CLAUDE.md "no mocks
// of internal logic"). Removing the dead path is the constitutional
// fix. See `apps/worker/src/index.ts` transient-cleanup block below
// for the one-shot drain of stale Valkey keys on upgrade-in-place.

import { createEmailSender } from "@openwhispr/email";
import { type ConnectionOptions, Worker } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { Pool } from "pg";
import pino from "pino";
import { makeAppOwnerPool } from "./db/app-pool.js";
import { makeLitellmPool } from "./db/litellm-pool.js";
import { createTemplateRenderer } from "./i18n/template-renderer.js";
import { buildAuditArchiveHandler } from "./jobs/audit-archive.js";
import { buildEmailDeliveryHandler } from "./jobs/email-delivery.js";
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
import { buildQueueRegistry, closeQueueRegistry, QUEUE_NAMES } from "./queues.js";
import { installSchedulers } from "./scheduler.js";

const log = pino({ name: "worker" });

// Phase 13 / Plan 01 / Task 13-01-08 — real SMTP-backed EmailSender from
// the shared `@openwhispr/email` package. Replaces the Phase 6 noopSender
// stub. In production (NODE_ENV=production) this throws at construction
// time if SMTP_HOST is unset (loud-fail), guaranteeing the worker never
// silently swallows verification emails. In non-prod it logs a warning
// and returns a logging-only sender so `docker compose up` still boots
// on a fresh clone with no SMTP env vars.
const realSender = createEmailSender({ log, env: process.env });
// Plan 10-01b — real i18n-backed template renderer; loads en+ru bundles
// from disk at module init. Replaces the noopRenderer stub left in place
// by Phase 6 Plan 06-08 pending the worker i18n surface (this plan).
const templateRenderer = createTemplateRenderer();

/**
 * Phase 14 / Plan 05 — transient cleanup of stale BullMQ keys left over
 * from the deleted virtual-key-rotation worker. Operators upgrading
 * in-place have `bull:virtual-key-rotation:*` keys in Valkey from a
 * previous worker boot; BullMQ would not delete them on its own and a
 * resurrected Worker pickup of a nonexistent queue is harmless but
 * produces log noise. SCAN+DEL with a small COUNT so the cleanup is
 * non-blocking on a large keyspace. Idempotent — a second boot finds
 * zero matching keys and exits the loop cleanly. Safe to remove in a
 * future phase once stragglers stop appearing. Wrapped in try/catch
 * because cleanup failure must NEVER prevent the worker from booting.
 */
async function drainStaleVkrKeys(redis: IORedis, logger: typeof log): Promise<void> {
  try {
    let cursor = "0";
    let total = 0;
    do {
      // SCAN returns [next_cursor, keys[]]. COUNT is a hint to Valkey.
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        "bull:virtual-key-rotation:*",
        "COUNT",
        "200",
      );
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        total += keys.length;
      }
    } while (cursor !== "0");
    if (total > 0) {
      logger.info(
        { deleted: total },
        "drained stale bull:virtual-key-rotation:* keys (Plan 14-05)",
      );
    }
  } catch (err) {
    logger.warn({ err }, "transient vkr-key cleanup failed; non-fatal");
  }
}

async function main(): Promise<void> {
  const redis = new IORedis({
    host: process.env["VALKEY_HOST"] ?? "valkey",
    port: Number(process.env["VALKEY_PORT"] ?? "6379"),
    ...(process.env["VALKEY_PASSWORD"] ? { password: process.env["VALKEY_PASSWORD"] } : {}),
    maxRetriesPerRequest: null,
  });
  const connection: ConnectionOptions = redis;

  // Phase 14 / Plan 05 — transient cleanup of stale BullMQ keys from
  // the removed virtual-key-rotation worker. Runs before any Worker
  // construction so a (hypothetical) future re-add of the queue can't
  // race with the drain. Non-fatal — try/catch lives inside the helper.
  await drainStaleVkrKeys(redis, log);

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
    buildEmailDeliveryHandler({
      pool: appOwnerPool,
      sender: realSender,
      renderer: templateRenderer,
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
