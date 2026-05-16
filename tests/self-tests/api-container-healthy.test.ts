// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 Plan 02 — D-23 self-test: bring up postgres+valkey+migrate+api
// with `--wait` and assert the api container reaches the `healthy`
// state. Phase 14 / SLIM-03 moved pgbouncer into an overlay, so the
// slim-core base used here connects api directly to postgres:5432.
//
// Skip-clean when Docker is unavailable or Compose < 2.20 (the plan
// relies on `service_completed_successfully` which arrived in 2.20).
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeAtLeast, dockerAvailable, dockerCompose, fixtureSecrets } from "./_helpers.js";

const skip = !dockerAvailable || !composeAtLeast(2, 20);

const ROOT = process.cwd();
const ENV_BACKUP = join(ROOT, ".env.bak-02-02-healthy");

function writeFixtureEnv(): void {
  const env = fixtureSecrets();
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(ROOT, ".env"), `${lines.join("\n")}\n`);
}

describe.skipIf(skip)("Phase 2 Plan 02 D-23 — api container reaches healthy", () => {
  beforeAll(() => {
    const envPath = join(ROOT, ".env");
    if (existsSync(envPath)) copyFileSync(envPath, ENV_BACKUP);
    writeFixtureEnv();
  });

  afterAll(async () => {
    // Always tear down the volumes (-v) — fixture postgres state is
    // disposable and a leftover RLS-extended schema from a half-applied
    // migration would corrupt subsequent runs.
    dockerCompose(["down", "-v"], { timeoutMs: 120_000 });
    const envPath = join(ROOT, ".env");
    if (existsSync(ENV_BACKUP)) {
      copyFileSync(ENV_BACKUP, envPath);
      rmSync(ENV_BACKUP, { force: true });
    } else if (existsSync(envPath)) {
      rmSync(envPath, { force: true });
    }
  }, 180_000);

  it("`docker compose up --wait` brings api to healthy status within 180s", async () => {
    // `--wait` blocks until every service in the project has either a
    // healthy healthcheck OR exited 0 (for one-shot services like
    // migrate). Timeout is the test runner's responsibility.
    const r = dockerCompose(
      [
        "up",
        "-d",
        "--wait",
        // LiteLLM cold-boot can take ~50s; 180s was the Phase 2 baseline
        // before LiteLLM joined the chain (Phase 03). 300s gives headroom.
        "--wait-timeout",
        "300",
        "postgres",
        "valkey",
        "litellm",
        "migrate",
        "api",
      ],
      { timeoutMs: 600_000 },
    );

    if (r.exitCode !== 0) {
      // Capture diagnostics on failure for the developer.
      const logs = dockerCompose(["logs", "--no-color", "api", "migrate"], {
        timeoutMs: 30_000,
      });
      // biome-ignore lint/suspicious/noConsole: failure-only diagnostics
      console.error(
        "compose up --wait failed:\n",
        r.stderr || r.stdout,
        "\n--- service logs ---\n",
        logs.stdout,
      );
    }

    expect(r.exitCode).toBe(0);

    // Verify api is reported as healthy via `compose ps --format json`.
    const ps = dockerCompose(["ps", "--format", "json", "api"], {
      timeoutMs: 30_000,
    });
    expect(ps.exitCode).toBe(0);
    // `ps --format json` emits one JSON object per line in Compose v2;
    // we just check the api row's Health field for "healthy".
    expect(ps.stdout).toMatch(/"Health"\s*:\s*"healthy"/);
  }, 600_000);
});
