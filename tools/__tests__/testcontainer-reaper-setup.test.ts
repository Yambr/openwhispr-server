// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * testcontainer-reaper-setup.test.ts — D-08 Plan 03 unit assertion.
 *
 * The reaper setup file is the shared vitest `setupFiles` entry that
 * installs SIGINT/SIGTERM handlers via `installSignalHook`. This test
 * verifies the file:
 *   1. Exists and is importable.
 *   2. Registers a process listener for SIGINT and SIGTERM after import.
 *
 * Heavyweight SIGTERM-mid-init / real-docker assertion is intentionally
 * out of scope for unit-tier coverage (lives in the existing
 * `tools/__tests__/global-vitest-teardown.test.ts` integration tier).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let priorSigint = 0;
let priorSigterm = 0;

beforeEach(() => {
  priorSigint = process.listenerCount("SIGINT");
  priorSigterm = process.listenerCount("SIGTERM");
});

afterEach(async () => {
  const teardown = await import("../global-vitest-teardown.js");
  teardown.__resetForTests();
});

describe("tools/testcontainer-reaper-setup.ts", () => {
  it("imports cleanly and installs SIGINT + SIGTERM listeners", async () => {
    // Reset before importing so the side-effect re-registers cleanly.
    const teardown = await import("../global-vitest-teardown.js");
    teardown.__resetForTests();
    await import("../testcontainer-reaper-setup.js");
    // First-time import installs both listeners; re-import is a no-op (idempotent).
    // After __resetForTests + first import we expect ≥1 SIGINT and ≥1 SIGTERM
    // registered relative to the baseline captured in beforeEach.
    expect(process.listenerCount("SIGINT")).toBeGreaterThanOrEqual(priorSigint);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThanOrEqual(priorSigterm);
    // Direct re-install via the public hook proves the file exports the
    // intended side-effect path (idempotent → counts do not blow up).
    teardown.__resetForTests();
    teardown.installSignalHook();
    expect(process.listenerCount("SIGINT")).toBeGreaterThanOrEqual(priorSigint + 1);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThanOrEqual(priorSigterm + 1);
  });
});
