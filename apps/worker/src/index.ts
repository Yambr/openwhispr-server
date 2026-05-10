// Phase 03 Plan 08 — Worker process entry point.
//
// Boots the BullMQ Job Scheduler `ingest-litellm-spend` (30s cadence) and
// runs forever until SIGTERM/SIGINT. Each tick calls runIngestOnce()
// against the LiteLLM co-tenant DB and the openwhispr application DB,
// converging spend rows into usage_ledger by request_id (DATA-03).
//
// Lifecycle:
//   1. Construct ioredis instance (BullMQ connection + watermark store).
//   2. Construct pg.Pools for litellm-read and openwhispr-owner.
//   3. Register the recurring scheduler.
//   4. Spawn the BullMQ Worker.
//   5. Wait for SIGTERM/SIGINT, then drain via worker.close() (research
//      §Code Example 3 — graceful shutdown lets the in-flight job finish
//      and prevents new jobs from starting).
import { Redis as IORedis } from "ioredis";
import pino from "pino";
import { makeAppOwnerPool } from "./db/app-pool.js";
import { makeLitellmPool } from "./db/litellm-pool.js";
import {
  createQueue,
  createWorker,
  ensureScheduler,
} from "./jobs/ingest-litellm-spend.js";

const log = pino({ name: "worker" });

async function main(): Promise<void> {
  const redis = new IORedis({
    host: process.env["VALKEY_HOST"] ?? "valkey",
    port: Number(process.env["VALKEY_PORT"] ?? "6379"),
    ...(process.env["VALKEY_PASSWORD"]
      ? { password: process.env["VALKEY_PASSWORD"] }
      : {}),
    // BullMQ requires this to be null for blocking commands.
    maxRetriesPerRequest: null,
  });

  const litellmPool = makeLitellmPool();
  const appOwnerPool = makeAppOwnerPool();

  const queue = createQueue(redis);
  await ensureScheduler(queue);
  const worker = createWorker({
    litellmPool,
    appOwnerPool,
    connection: redis,
    redis,
  });

  log.info("worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down — draining BullMQ worker");
    try {
      await worker.close();
      await queue.close();
      await litellmPool.end();
      await appOwnerPool.end();
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

main().catch((err: unknown) => {
  log.error({ err }, "worker failed to start");
  process.exit(1);
});
