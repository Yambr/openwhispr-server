// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * global-vitest-teardown.ts — Vitest 4 globalTeardown hook + SIGINT/SIGTERM
 * signal handlers that prune leaked testcontainers.
 *
 * Phase 13 / Plan 01 / Task 02. Closes the leak documented in
 * `.planning/deferred-items.md §1` (30 GB volumes, 13 orphan postgres
 * containers from prior crashed/SIGINT'd vitest sessions): testcontainers'
 * Ryuk reaper is not firing in our apps/api vitest runs.
 *
 * Behavior:
 *   - `globalTeardown` default export runs at the very end of a vitest run
 *     (success OR failure) and spawns
 *       docker container prune -f --filter label=org.testcontainers=true
 *     Failures are SWALLOWED — globalTeardown must never abort the test
 *     report (a missing `docker` binary in CI sandbox is a benign noop).
 *   - `installSignalHook()` is an idempotent SIGINT/SIGTERM registrar. It
 *     uses a module-scoped `installed = false` guard so duplicate calls are
 *     no-ops. Handlers run the same prune command, then exit with the POSIX
 *     128 + signal-number convention (SIGINT=130, SIGTERM=143).
 *
 * Exit codes (signal handlers):
 *   - SIGINT  → process.exit(130)
 *   - SIGTERM → process.exit(143)
 */
import { execFileSync } from "node:child_process";

const BASE_PRUNE_ARGV: readonly string[] = [
  "container",
  "prune",
  "-f",
  "--filter",
  "label=org.testcontainers=true",
];

/**
 * Build the `docker container prune` argv. When the environment variable
 * `OPENWHISPR_TESTCONTAINER_SESSION_ID` is set the prune is narrowed by an
 * additional `--filter label=org.testcontainers.session-id=<id>` so a
 * worker tearing down only removes the containers IT spawned, not those of
 * a peer vitest worker running in parallel (D-08 hardening, Phase 18.1.1
 * Plan 03). When unset, the legacy broad filter argv is returned verbatim
 * for backwards compatibility with the existing apps/api setup.
 */
function buildPruneArgv(): string[] {
  const id = process.env.OPENWHISPR_TESTCONTAINER_SESSION_ID;
  if (id && id.length > 0) {
    return [...BASE_PRUNE_ARGV, "--filter", `label=org.testcontainers.session-id=${id}`];
  }
  return [...BASE_PRUNE_ARGV];
}

function pruneTestcontainers(): void {
  try {
    execFileSync("docker", buildPruneArgv(), { stdio: "inherit" });
  } catch {
    // Swallow. Common benign causes:
    //   - `docker` binary absent (e.g., CI sandbox without DinD)
    //   - prune exit code non-zero (nothing to prune; daemon unreachable)
    // The teardown must NEVER throw — that would abort the vitest report.
  }
}

export default async function globalTeardown(): Promise<void> {
  pruneTestcontainers();
}

let installed = false;

export function installSignalHook(): void {
  if (installed) {
    return;
  }
  installed = true;
  process.on("SIGINT", () => {
    pruneTestcontainers();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    pruneTestcontainers();
    process.exit(143);
  });
}

// Test-only reset hook. Vitest's `vi.resetModules()` does not clear
// module-scoped `let` bindings reliably across the dynamic `import()` we use
// in `global-vitest-teardown.test.ts` (the import is cached under the same
// resolved URL); a direct reset function is the cheapest way to give the
// idempotency test a clean slate without leaking real `process.on` listeners
// across cases. Not exported from `index.ts`-style barrels — internal.
export function __resetForTests(): void {
  installed = false;
}
