// SPDX-License-Identifier: FSL-1.1-ALv2
// Shared dev-stack guard for both self-tests and integration tests.
//
// BUG-53-37 + BUG-53-39: container-touching tests (compose-driving
// self-tests AND testcontainers-driving integration tests) can tear
// down the developer's running `openwhispr` dev compose stack. The
// data-loss vector is closed by isolation (self-tests use a distinct
// compose project name; testcontainers should use unique session
// labels). The misleading-failure / surprise-blast-radius vector is
// closed by skipping the test when the dev stack is up.
//
// `devStackUp()` probes whether ANY container in the `openwhispr`
// default compose project is currently running. Callers gate their
// `describe.skipIf(...)` predicate on this. The probe is cheap (~50ms)
// and safe to call at module load.

import { spawnSync } from "node:child_process";

/**
 * @returns true when ≥1 container in the dev compose project
 *   (`openwhispr`) is currently running. False on docker unreachable
 *   or empty project.
 */
export function devStackUp(): boolean {
  try {
    const r = spawnSync(
      "docker",
      ["compose", "-p", "openwhispr", "ps", "--quiet", "--status=running"],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (r.status !== 0) return false;
    return r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
