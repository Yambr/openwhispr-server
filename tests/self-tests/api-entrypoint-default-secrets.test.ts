// SPDX-License-Identifier: Apache-2.0
// Phase 2 Plan 02 — D-25 self-test: closes Phase 1 D-08 / SC#1 partial.
//
// Spins up the api container with MASTER_KEK=changeme (every other
// REQUIRED_KEY set to a valid non-deny-listed value) and asserts the
// container exits non-zero with `MASTER_KEK` and `refusing to start`
// in stderr — proving entrypoint.sh runs check-default-secrets.cjs
// BEFORE node main.
//
// Skip-clean when the Docker daemon is unreachable; skip-clean when
// Compose < 2.20 (service_completed_successfully unsupported).
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeAtLeast,
  dockerAvailable,
  dockerCompose,
  fixtureSecrets,
} from "./_helpers.js";

const skip = !dockerAvailable || !composeAtLeast(2, 20);

const ROOT = process.cwd();
const ENV_BACKUP = join(ROOT, ".env.bak-02-02-entrypoint");

function writeFixtureEnv(overrides: Record<string, string>): void {
  const env = fixtureSecrets(overrides);
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(ROOT, ".env"), `${lines.join("\n")}\n`);
}

function backupExistingEnv(): void {
  const envPath = join(ROOT, ".env");
  // Save the operator's existing .env so we can restore it after the
  // test (we DON'T want to clobber a real .env on a contributor laptop).
  if (existsSync(envPath)) {
    copyFileSync(envPath, ENV_BACKUP);
  }
}

function restoreEnv(): void {
  const envPath = join(ROOT, ".env");
  if (existsSync(ENV_BACKUP)) {
    copyFileSync(ENV_BACKUP, envPath);
    rmSync(ENV_BACKUP, { force: true });
  } else if (existsSync(envPath)) {
    rmSync(envPath, { force: true });
  }
}

describe.skipIf(skip)("Phase 2 Plan 02 D-25 — api entrypoint defense-in-depth (closes Phase 1 SC#1)", () => {
  beforeAll(async () => {
    backupExistingEnv();
    // Build the api image once (cached on subsequent runs in CI).
    const r = dockerCompose(["build", "api"], { timeoutMs: 600_000 });
    if (r.exitCode !== 0) {
      // Surface the build error to the developer; downstream `it` will
      // skip rather than spam unrelated failures.
      // biome-ignore lint/suspicious/noConsole: surface build failure for diagnosis
      console.error("docker compose build api failed:\n", r.stderr || r.stdout);
    }
  }, 600_000);

  afterAll(() => {
    restoreEnv();
  });

  it("exits non-zero with MASTER_KEK in stderr when MASTER_KEK=changeme", () => {
    writeFixtureEnv({ MASTER_KEK: "changeme" });

    // Run the api container with --no-deps (don't try to start postgres
    // etc.); the entrypoint should reject before reaching node main.
    const r = dockerCompose(
      ["run", "--rm", "--no-deps", "api"],
      { timeoutMs: 120_000 },
    );

    expect(r.exitCode).not.toBe(0);
    // The check-default-secrets script writes both the offending key
    // name and the literal "refusing to start" string per Phase 1.
    expect(r.stderr + r.stdout).toMatch(/MASTER_KEK/);
    expect(r.stderr + r.stdout).toMatch(/refusing to start/);
  }, 180_000);
});
