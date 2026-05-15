// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * testcontainer-availability.ts — Phase 18.1.2 / Plan 01 / Task 02.
 *
 * Docker availability probe (D-02). Runs `docker info` with a 2 s timeout
 * inside try/catch. On failure (daemon-down, missing binary, ETIMEDOUT) it
 * MUTATES `process.env.OPENWHISPR_SKIP_TESTCONTAINERS = "1"` so downstream
 * integration tests can `describe.skip` in their `beforeAll`. The probe
 * NEVER throws and NEVER calls `process.exit` — a throw from this module
 * would break the rest of the vitest `setupFiles` chain (RESEARCH pitfall
 * §1: `execFileSync` with `timeout` raises on timeout; we must swallow).
 *
 * Wired into `tools/testcontainer-reaper-setup.ts` AFTER `installSignalHook()`
 * per PATTERNS surface 1 — single setupFile entry, do NOT add a second one.
 *
 * The structured warning is memoised at module scope so re-invocation under
 * daemon-down (multiple setupFiles imports across workers) logs once.
 *
 * Zero new top-level dependencies (D-22): `execFileSync` is `node:child_process`
 * stdlib and the warning is a single JSON-shaped `console.warn` line — same
 * boundary discipline as `tools/global-vitest-teardown.ts`.
 */
import { execFileSync } from "node:child_process";

const SKIP_ENV = "OPENWHISPR_SKIP_TESTCONTAINERS";
const PROBE_TIMEOUT_MS = 2_000;

let warned = false;

export function assertDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], {
      timeout: PROBE_TIMEOUT_MS,
      stdio: "ignore",
    });
    return true;
  } catch (err) {
    process.env[SKIP_ENV] = "1";
    if (!warned) {
      warned = true;
      const reason = err instanceof Error ? err.message : String(err);
      // Structured single-line JSON to stderr — same boundary discipline as
      // `tools/global-vitest-teardown.ts` (no console; no logger dep per D-22).
      process.stderr.write(
        `${JSON.stringify({ event: "docker.unavailable", reason, env: SKIP_ENV })}\n`,
      );
    }
    return false;
  }
}

// Test-only reset hook. Mirrors `tools/global-vitest-teardown.ts`'s
// `__resetForTests` — module-scoped `let warned` is not cleared reliably by
// `vi.resetModules()` (the import is cached under the same resolved URL),
// so the idempotency test needs an explicit reset. Not exported from any
// barrel — internal.
export function __resetForTests(): void {
  warned = false;
}
