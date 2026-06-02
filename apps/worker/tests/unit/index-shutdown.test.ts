// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-08 — worker shutdown exit code on drain failure.
//
// `runShutdown` lives in `src/lib/shutdown.ts` (extracted out of index.ts
// so it is testable without importing the worker entrypoint, which runs
// `main()` as a top-level side effect). The collaborators (BullMQ
// workers, pg pools, ioredis) are stubs at the close/end/quit boundary —
// permitted by CLAUDE.md.
import pino from "pino";
import { describe, expect, it } from "vitest";
import { runShutdown } from "../../src/lib/shutdown.js";

const silentLogger = pino({ level: "silent" });

const okWorker = () => ({ close: async () => undefined });
const okQueue = { close: async () => undefined };
const okPool = () => ({ end: async () => undefined });
const okRedis = { quit: async () => undefined };

describe("CR-08 — runShutdown exit code", () => {
  it("CR-08: resolves exit code 0 when every drain step succeeds", async () => {
    const code = await runShutdown({
      workers: [okWorker(), okWorker()],
      ingestQueue: okQueue,
      closeRegistry: async () => undefined,
      pools: [okPool(), okPool(), okPool()],
      redis: okRedis,
      logger: silentLogger,
    });
    expect(code).toBe(0);
  });

  it("CR-08: resolves exit code 1 when a worker .close() rejects", async () => {
    const code = await runShutdown({
      workers: [
        okWorker(),
        { close: async () => Promise.reject(new Error("worker drain stalled")) },
      ],
      ingestQueue: okQueue,
      closeRegistry: async () => undefined,
      pools: [okPool()],
      redis: okRedis,
      logger: silentLogger,
    });
    // Pre-fix this was masked as exit(0) — Promise.allSettled never
    // rejects so the per-worker failure was swallowed.
    expect(code).toBe(1);
  });

  it("CR-08: resolves exit code 1 when a pool .end() throws", async () => {
    const code = await runShutdown({
      workers: [okWorker()],
      ingestQueue: okQueue,
      closeRegistry: async () => undefined,
      pools: [okPool(), { end: async () => Promise.reject(new Error("pool end failed")) }],
      redis: okRedis,
      logger: silentLogger,
    });
    expect(code).toBe(1);
  });

  it("quick 260602-eth: a null ingestQueue is skipped, not drained, and stays clean", async () => {
    let registryClosed = false;
    const code = await runShutdown({
      workers: [okWorker()],
      // Spend reconciliation disabled → no ingest queue was ever created.
      ingestQueue: null,
      closeRegistry: async () => {
        registryClosed = true;
      },
      pools: [okPool(), okPool()],
      redis: okRedis,
      logger: silentLogger,
    });
    // No ingest-queue drain to fail → clean exit, registry still drained.
    expect(code).toBe(0);
    expect(registryClosed).toBe(true);
  });

  it("CR-08: a failing step does not abort the remaining drains", async () => {
    let registryClosed = false;
    let redisQuit = false;
    const code = await runShutdown({
      workers: [{ close: async () => Promise.reject(new Error("first step fails")) }],
      ingestQueue: { close: async () => Promise.reject(new Error("ingest close fails")) },
      closeRegistry: async () => {
        registryClosed = true;
      },
      pools: [okPool()],
      redis: {
        quit: async () => {
          redisQuit = true;
        },
      },
      logger: silentLogger,
    });
    expect(code).toBe(1);
    // The registry + redis drains still ran despite earlier failures.
    expect(registryClosed).toBe(true);
    expect(redisQuit).toBe(true);
  });
});
