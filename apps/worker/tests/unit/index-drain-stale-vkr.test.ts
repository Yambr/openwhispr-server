// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 66 / CR-07 — drainStaleVkrKeys SCAN-loop cap + failure counter.
//
// The drain lives in `src/lib/vkr-drain.ts` (extracted out of index.ts so
// it is testable without importing the worker entrypoint, which runs
// `main()` as a top-level side effect). The Valkey client is a stub — it
// is a process/network boundary, so a stub is permitted by CLAUDE.md.
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _readVkrCleanupFailures,
  _resetVkrCleanupFailures,
  drainStaleVkrKeys,
  VKR_DRAIN_MAX_ITERATIONS,
} from "../../src/lib/vkr-drain.js";

const silentLogger = pino({ level: "silent" });

afterEach(() => {
  _resetVkrCleanupFailures();
});

describe("CR-07 — drainStaleVkrKeys boot-time hardening", () => {
  it("CR-07: caps the SCAN loop so a misbehaving Valkey cursor cannot lock boot", async () => {
    // A misbehaving Valkey that NEVER returns cursor "0". Pre-fix the
    // `do/while (cursor !== "0")` loop would spin forever and lock boot.
    let scanCalls = 0;
    const stubRedis = {
      scan: vi.fn(async () => {
        scanCalls++;
        // Always return a non-zero cursor + zero keys.
        return ["9999", []] as [string, string[]];
      }),
      del: vi.fn(async () => 0),
    } as never;

    // Must RESOLVE (not hang) even though the cursor never reaches "0".
    await expect(drainStaleVkrKeys(stubRedis, silentLogger)).resolves.toBeUndefined();
    // And the SCAN was called at most VKR_DRAIN_MAX_ITERATIONS times.
    expect(scanCalls).toBeLessThanOrEqual(VKR_DRAIN_MAX_ITERATIONS);
    expect(scanCalls).toBe(VKR_DRAIN_MAX_ITERATIONS);
  });

  it("CR-07: increments the cleanup-failure counter when SCAN throws", async () => {
    const stubRedis = {
      scan: vi.fn(async () => {
        throw new Error("NOPERM — Valkey ACL change");
      }),
      del: vi.fn(async () => 0),
    } as never;

    expect(_readVkrCleanupFailures()).toBe(0);
    // Cleanup failure is non-fatal — the drain still resolves.
    await expect(drainStaleVkrKeys(stubRedis, silentLogger)).resolves.toBeUndefined();
    // ...but the failure counter recorded the event for operator alerting.
    expect(_readVkrCleanupFailures()).toBe(1);
  });

  it("CR-07: a well-behaved Valkey drains cleanly without tripping the counter", async () => {
    let call = 0;
    const stubRedis = {
      scan: vi.fn(async () => {
        call++;
        // First page returns a key + a non-zero cursor; second page
        // returns cursor "0" to terminate the loop.
        return call === 1
          ? (["7", ["bull:virtual-key-rotation:abc"]] as [string, string[]])
          : (["0", []] as [string, string[]]);
      }),
      del: vi.fn(async () => 1),
    } as never;

    await expect(drainStaleVkrKeys(stubRedis, silentLogger)).resolves.toBeUndefined();
    expect(_readVkrCleanupFailures()).toBe(0);
  });
});
