// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-08 — worker graceful-shutdown drain.
//
// Extracted out of `index.ts` so it can be unit-tested without importing
// the worker entrypoint (which runs `main()` as a top-level side effect).
//
// CR-08 fix: pre-fix the shutdown body wrapped a `Promise.allSettled` +
// six `await`s in one try/catch and ALWAYS called `process.exit(0)`.
// `Promise.allSettled` never rejects, so per-worker drain failures were
// silently swallowed; a `pool.end()` throw landed in the outer catch but
// the process still exited 0. Kubernetes / docker-compose recorded that
// as a graceful shutdown, masking abandoned in-flight jobs during rolling
// deploys. `runShutdown` now inspects the allSettled results AND wraps
// each subsequent await individually, tracking a `shutdownErrored` flag,
// and resolves the correct exit code (0 clean / 1 on any drain failure).

import type { Logger } from "pino";

/** Anything with an async `close()` — BullMQ Worker / Queue. */
export interface AsyncCloseable {
  close(): Promise<unknown>;
}
/** Anything with an async `end()` — pg.Pool. */
export interface AsyncEndable {
  end(): Promise<unknown>;
}
/** Anything with an async `quit()` — ioredis. */
export interface AsyncQuittable {
  quit(): Promise<unknown>;
}

export interface ShutdownDeps {
  /** BullMQ Worker instances to drain. */
  workers: AsyncCloseable[];
  /** The pre-existing ingest queue handle. */
  ingestQueue: AsyncCloseable;
  /** Closes the typed queue registry. */
  closeRegistry: () => Promise<unknown>;
  /** pg pools to end (litellm, appOwner, maintenance). */
  pools: AsyncEndable[];
  /** ioredis connection to quit. */
  redis: AsyncQuittable;
  logger: Logger;
}

/**
 * Drain every worker / queue / pool / redis connection. Returns the exit
 * code the caller should pass to `process.exit`: `0` when every drain
 * step succeeded, `1` when ANY step failed. Never throws — each step is
 * individually guarded so a single failure neither aborts the remaining
 * drains nor masks itself as a graceful (0) exit.
 */
export async function runShutdown(deps: ShutdownDeps): Promise<number> {
  let shutdownErrored = false;

  // Drain all workers. `Promise.allSettled` never rejects — inspect each
  // result for `status === "rejected"` so a per-worker drain failure is
  // counted instead of swallowed.
  const workerResults = await Promise.allSettled(deps.workers.map((w) => w.close()));
  for (const r of workerResults) {
    if (r.status === "rejected") {
      shutdownErrored = true;
      deps.logger.error({ err: r.reason }, "worker drain failed during shutdown");
    }
  }

  // Each subsequent teardown is awaited inside its own guard so one throw
  // sets the flag without skipping the rest.
  const steps: Array<{ label: string; run: () => Promise<unknown> }> = [
    { label: "ingest-queue", run: () => deps.ingestQueue.close() },
    { label: "queue-registry", run: () => deps.closeRegistry() },
    ...deps.pools.map((p, i) => ({
      label: `pool-${i}`,
      run: () => p.end(),
    })),
    { label: "redis", run: () => deps.redis.quit() },
  ];

  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      shutdownErrored = true;
      deps.logger.error({ err, step: step.label }, "shutdown step failed");
    }
  }

  return shutdownErrored ? 1 : 0;
}
