// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-07 — boot-time stale virtual-key-rotation key drain.
//
// Extracted out of `index.ts` so it can be unit-tested without importing
// the worker entrypoint (which runs `assertBYOKConfig()` + `main()` as
// top-level side effects on import). The drain itself is unchanged in
// behaviour from Phase 14 / Plan 05 except for the CR-07 hardening:
//   - the SCAN loop is capped at `VKR_DRAIN_MAX_ITERATIONS` so a
//     misbehaving Valkey cursor can no longer lock the boot path, and
//   - a cleanup failure increments an OTel counter operators can alert
//     on instead of only logging at `warn`.

import { metrics } from "@opentelemetry/api";
import type { Redis as IORedis } from "ioredis";
import type { Logger } from "pino";

// Phase 66 / CR-07 — failure counter for the boot-time stale-key drain.
// A cleanup failure (Valkey ACL change, transient network) previously
// only logged at `warn` — invisible without log-tailing at boot. The
// counter lets operator dashboards surface stuck / mis-permissioned
// workers.
const vkrCleanupFailureCounter = metrics
  .getMeter("worker")
  .createCounter("worker_vkr_cleanup_failures_total", {
    description: "Count of boot-time stale virtual-key-rotation key cleanup failures",
  });

// Test-seam: the OTel API exposes no public read on a Counter, so a
// process-local mirror lets unit tests assert the increment. Matches the
// project's `_for-test` underscore-export convention.
let _vkrCleanupFailures = 0;
/** Test-only: read the cleanup-failure tally. */
export function _readVkrCleanupFailures(): number {
  return _vkrCleanupFailures;
}
/** Test-only: reset the cleanup-failure tally between fixtures. */
export function _resetVkrCleanupFailures(): void {
  _vkrCleanupFailures = 0;
}

/**
 * Phase 66 / CR-07 — upper bound on the SCAN loop. A misbehaving Valkey
 * that returns a non-zero cursor forever would otherwise lock the boot
 * path with no timeout. At COUNT=200 this caps the drain at ~200k keys
 * scanned, far beyond any realistic stale-key population.
 */
export const VKR_DRAIN_MAX_ITERATIONS = 1000;

/**
 * Transient cleanup of stale BullMQ keys left over from the deleted
 * virtual-key-rotation worker (Phase 14 / Plan 05). Operators upgrading
 * in-place have `bull:virtual-key-rotation:*` keys in Valkey from a
 * previous worker boot; BullMQ would not delete them on its own and a
 * resurrected Worker pickup of a nonexistent queue is harmless but
 * produces log noise. SCAN+DEL with a small COUNT so the cleanup is
 * non-blocking on a large keyspace. Idempotent — a second boot finds
 * zero matching keys and exits the loop cleanly. Wrapped in try/catch
 * because cleanup failure must NEVER prevent the worker from booting.
 *
 * Phase 66 / CR-07 — the SCAN loop is capped at `VKR_DRAIN_MAX_ITERATIONS`
 * and a cleanup failure increments `worker_vkr_cleanup_failures_total`.
 */
export async function drainStaleVkrKeys(redis: IORedis, logger: Logger): Promise<void> {
  try {
    let cursor = "0";
    let total = 0;
    let iterations = 0;
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
      iterations++;
      if (iterations >= VKR_DRAIN_MAX_ITERATIONS && cursor !== "0") {
        // Phase 66 / CR-07 — bail out rather than loop forever on a
        // misbehaving Valkey cursor. The drain is best-effort; an
        // un-completed pass is non-fatal (a later boot retries).
        logger.warn(
          { iterations, deleted: total },
          "vkr-key cleanup hit iteration cap; aborting drain (non-fatal)",
        );
        break;
      }
    } while (cursor !== "0");
    if (total > 0) {
      logger.info(
        { deleted: total },
        "drained stale bull:virtual-key-rotation:* keys (Plan 14-05)",
      );
    }
  } catch (err) {
    vkrCleanupFailureCounter.add(1);
    _vkrCleanupFailures++;
    logger.warn({ err }, "transient vkr-key cleanup failed; non-fatal");
  }
}
