// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 04 / Task 3 — BYOK boot guard. MUST run BEFORE the
// OTel SDK side-effect import so a misconfigured OTLP endpoint does
// not produce cascading dial noise on stderr before the fatal
// "byok.required" record reaches operators. The guard is a pure-
// function call that returns void on a satisfied env contract.
//
// Phase 19 / Plan 02 (SR-19.3, D-09 + D-10): library now THROWS
// `BYOKGuardError`; worker entrypoint catches + logs + exits.
// Mirrors apps/api/src/index.ts.
import { assertBYOKConfig, BYOKGuardError } from "@openwhispr/byok-guard";
import { validateEncryptionBoot } from "@openwhispr/data";
import pinoBoot from "pino";

try {
  assertBYOKConfig();
} catch (err) {
  if (err instanceof BYOKGuardError) {
    const bootLog = pinoBoot(
      { name: "worker-boot" },
      pinoBoot.destination({ sync: true, dest: 2 }),
    );
    bootLog.fatal({ err }, "BYOK guard refused boot");
    process.exit(1);
  }
  throw err;
}

// Phase 33 / Plan 33-04 — encryption-config boot gate (mirrors api).
// Exits 78 (BSD EX_CONFIG) when MASTER_KEK is unset / wrong-length / the
// operator selected an unsupported KeyProvider (`vault` / `kms`).
validateEncryptionBoot();

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
import { makePino } from "@openwhispr/observability";
import { type ConnectionOptions, Worker } from "bullmq";
import { Pool } from "pg";
import { loadWorkerConfig } from "./config/worker-config.js";
import { makeAppOwnerPool } from "./db/app-pool.js";
import { assertDirectPostgres } from "./db/assert-direct-postgres.js";
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
import { runShutdown } from "./lib/shutdown.js";
import { drainStaleVkrKeys } from "./lib/vkr-drain.js";
import { buildRedisConnection } from "./queue/connection.js";
import { buildQueueRegistry, closeQueueRegistry, QUEUE_NAMES } from "./queues.js";
import { installSchedulers } from "./scheduler.js";

// Phase 41.d / HI-1 — shared redact factory; replaces a bare `pino({ name })`
// that bypassed the D-T4 redact paths. Boot-time pre-OTel logger above
// (`pinoBoot`) intentionally stays bare-pino because it runs BEFORE the
// observability package is safe to import (BYOK guard rejection path on
// sync-stderr). Every post-bootstrap log line MUST flow through `makePino`.
const log = makePino({ base: { service: "worker" } });

// Phase 13 / Plan 01 / Task 13-01-08 — real SMTP-backed EmailSender from
// the shared `@openwhispr/email` package. Replaces the Phase 6 noopSender
// stub. In production (NODE_ENV=production) this throws at construction
// time if SMTP_HOST is unset (loud-fail), guaranteeing the worker never
// silently swallows verification emails. In non-prod it logs a warning
// and returns a logging-only sender so `docker compose up` still boots
// on a fresh clone with no SMTP env vars.
const realSender = createEmailSender({ log, env: process.env });
// Phase 66 / CR-03 — worker runtime config resolved at the boundary.
// `worker-config.ts` is the ONLY place the worker reads its env contract
// (LOCKER-01 boundary file). `allowSmtpFallback` is the explicit
// `EMAIL_FALLBACK_NONFATAL` opt-in — it replaces the old NODE_ENV read.
const workerConfig = loadWorkerConfig();
// Plan 10-01b — real i18n-backed template renderer; loads en+ru bundles
// from disk at module init. Replaces the noopRenderer stub left in place
// by Phase 6 Plan 06-08 pending the worker i18n surface (this plan).
const templateRenderer = createTemplateRenderer();

// Phase 66 / CR-07 — `drainStaleVkrKeys` (with the SCAN iteration cap +
// failure counter) lives in `./lib/vkr-drain.ts` so it can be unit-tested
// without importing this entrypoint (which runs `main()` as a top-level
// side effect). See that module for the Plan 14-05 rationale.

async function main(): Promise<void> {
  // Quick-task 260524-u00 / Task A4 — VALKEY_URL parity with api/web.
  // Pre-fix the worker read split VALKEY_HOST/PORT/PASSWORD env (asymmetric
  // with api's apps/api/src/plugins/rate-limit.ts:193 `new Redis(VALKEY_URL)`
  // pattern). The chart projected VALKEY_URL from a single secretRef but
  // operators had to extraEnv the split keys for the worker — peer's
  // chart-1.0.5 values-yambr.yaml carries that workaround. buildRedisConnection
  // centralises URL parsing so all three services consume the same secret shape.
  const redis = buildRedisConnection();
  const connection: ConnectionOptions = redis;

  // Phase 14 / Plan 05 — transient cleanup of stale BullMQ keys from
  // the removed virtual-key-rotation worker. Runs before any Worker
  // construction so a (hypothetical) future re-add of the queue can't
  // race with the drain. Non-fatal — try/catch lives inside the helper.
  await drainStaleVkrKeys(redis, log);

  // Quick 260602-eth — spend reconciliation reads LiteLLM_SpendLogs cross-DB.
  // On a self-host pointed at an EXTERNAL LiteLLM gateway there is no LiteLLM
  // DB to reach into, so `spendReconciliationEnabled` resolves false and we
  // never construct the pool (makeLitellmPool would otherwise throw on the
  // missing URL). The ingest/reconciliation workers + cron are gated on it
  // below; every other job runs regardless.
  const spendReconciliationEnabled = workerConfig.spendReconciliationEnabled;
  const litellmPool = spendReconciliationEnabled ? makeLitellmPool() : null;
  const appOwnerPool = makeAppOwnerPool();
  // Phase 66 / CR-09 — the inline maintenancePool gets the SAME shared
  // PgBouncer guard makeAppOwnerPool / makeLitellmPool use. Pre-fix it
  // had none — a PgBouncer-pointed DATABASE_URL_OWNER would let
  // partman.run_maintenance_proc()'s internal COMMITs corrupt partman
  // state (Pitfall #9).
  const maintenanceUrl = process.env["DATABASE_URL_OWNER"];
  if (!maintenanceUrl) {
    throw new Error("DATABASE_URL_OWNER is required");
  }
  assertDirectPostgres(maintenanceUrl, "DATABASE_URL_OWNER");
  const maintenancePool = new Pool({
    connectionString: maintenanceUrl,
    max: 1,
  });

  // Pre-existing ingest queue (Phase 3 wiring kept intact). Gated on
  // spend-reconciliation (quick 260602-eth) — the ingest job reads LiteLLM's
  // DB cross-DB and is meaningless without it.
  const ingestQueue = spendReconciliationEnabled ? createIngestQueue(redis) : null;
  if (ingestQueue) {
    await ingestIngestSchedulerSafe(ingestQueue);
  }

  // Phase 6 typed queue registry + scheduler. The reconciliation cron is
  // suppressed when spend reconciliation is disabled; usage-rollup + partman
  // always install.
  const registry = buildQueueRegistry(connection);
  await installSchedulers(registry, { reconciliationEnabled: spendReconciliationEnabled });

  // Workers. The LiteLLM-DB-dependent trio (ingest + the two reconciliation
  // workers) is only constructed when spend reconciliation is enabled
  // (quick 260602-eth); on external-gateway deploys litellmPool is null.
  const emailWorker = new Worker(
    QUEUE_NAMES.emailDelivery,
    buildEmailDeliveryHandler({
      pool: appOwnerPool,
      sender: realSender,
      renderer: templateRenderer,
      allowSmtpFallback: workerConfig.allowSmtpFallback,
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

  // Always-on workers (no LiteLLM-DB dependency).
  const workers: Worker[] = [
    emailWorker,
    rollupDispatcherWorker,
    rollupTenantWorker,
    partmanWorker,
    auditArchiveWorker,
  ];

  // Pools drained on shutdown — appOwnerPool + maintenancePool always; the
  // LiteLLM pool only when constructed.
  const pools: Pool[] = [appOwnerPool, maintenancePool];

  // Quick 260602-eth — the spend-reconciliation trio (ingest + the two
  // reconciliation workers) is wired only when a LiteLLM DB is reachable.
  // `litellmPool` is non-null inside this branch, satisfying the handler deps
  // without a non-null assertion.
  if (litellmPool) {
    const ingestWorker = createIngestWorker({
      litellmPool,
      appOwnerPool,
      connection,
      redis,
    });
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
    workers.push(ingestWorker, reconciliationCheckWorker, reconciliationDiscrepancyWorker);
    pools.push(litellmPool);
  }

  log.info(
    { workers: workers.length, spendReconciliation: spendReconciliationEnabled },
    "worker started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down — draining BullMQ workers");
    // Phase 66 / CR-08 — runShutdown inspects the Promise.allSettled
    // results AND guards every subsequent teardown await, returning a
    // non-zero exit code on ANY drain failure. A masked exit(0) on a
    // drain failure would have the orchestrator record a false graceful
    // shutdown during rolling deploys.
    const code = await runShutdown({
      workers,
      ingestQueue,
      closeRegistry: () => closeQueueRegistry(registry),
      pools,
      redis,
      logger: log,
    });
    process.exit(code);
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
