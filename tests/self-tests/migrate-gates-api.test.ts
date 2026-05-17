// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 Plan 02 — migrate-gates-api self-test: verifies the
// `depends_on: { migrate: { condition: service_completed_successfully } }`
// link by inspecting container timestamps after `compose up --wait`.
//
// Compose 2.20+ honors `service_completed_successfully`; older versions
// silently ignore it (Pitfall #6). Test skips cleanly under both
// no-Docker and Compose < 2.20 conditions.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COMPOSE_PROJECT,
  composeAtLeast,
  dockerAvailable,
  dockerCompose,
  fixtureSecrets,
} from "./_helpers.js";

const skip = !dockerAvailable || !composeAtLeast(2, 20);

const ROOT = process.cwd();
const ENV_BACKUP = join(ROOT, ".env.bak-02-02-gates");

function writeFixtureEnv(): void {
  const env = fixtureSecrets();
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(join(ROOT, ".env"), `${lines.join("\n")}\n`);
}

interface InspectResult {
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  status: string;
}

function dockerInspect(name: string): InspectResult | null {
  const r = spawnSync(
    "docker",
    [
      "inspect",
      "--format",
      "{{.State.StartedAt}}|{{.State.FinishedAt}}|{{.State.ExitCode}}|{{.State.Status}}",
      name,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (r.status !== 0) return null;
  const parts = r.stdout.trim().split("|");
  if (parts.length < 4) return null;
  return {
    startedAt: parts[0]!,
    finishedAt: parts[1]!,
    exitCode: Number(parts[2]),
    status: parts[3]!,
  };
}

describe.skipIf(skip)(
  "Phase 2 Plan 02 — migrate gates api start (service_completed_successfully)",
  () => {
    beforeAll(() => {
      const envPath = join(ROOT, ".env");
      if (existsSync(envPath)) copyFileSync(envPath, ENV_BACKUP);
      writeFixtureEnv();
    });

    afterAll(() => {
      dockerCompose(["down", "-v"], { timeoutMs: 120_000 });
      const envPath = join(ROOT, ".env");
      if (existsSync(ENV_BACKUP)) {
        copyFileSync(ENV_BACKUP, envPath);
        rmSync(ENV_BACKUP, { force: true });
      } else if (existsSync(envPath)) {
        rmSync(envPath, { force: true });
      }
    }, 180_000);
    // ^^^ vitest default hook timeout is 10s; `docker compose down -v`
    // for the full slim+litellm stack routinely takes 15-30s. Without
    // the explicit timeout the file marks `not ok` at file-level even
    // when every `it()` passed.

    // Retry once: docker-daemon load from sibling projects (testcontainers
    // in @openwhispr/data, e.g.) can transiently slow `up --wait`. One
    // retry empirically clears the flake.
    it("migrate exits 0 before api starts (timestamps strictly ordered, or fallback contract)", {
      retry: 1,
      timeout: 600_000,
    }, async () => {
      const up = dockerCompose(
        [
          "up",
          "-d",
          "--wait",
          // LiteLLM cold-boot can take ~50s on a fresh image pull; api waits
          // until then via service_completed_successfully + healthcheck. 180s
          // was a Phase 2 baseline before LiteLLM joined the chain (Phase 03).
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

      if (up.exitCode !== 0) {
        const logs = dockerCompose(["logs", "--no-color", "migrate", "api"], {
          timeoutMs: 30_000,
        });
        // biome-ignore lint/suspicious/noConsole: failure-only diagnostics
        console.error(
          "compose up --wait failed:\n",
          up.stderr || up.stdout,
          "\n--- service logs ---\n",
          logs.stdout,
        );
      }
      expect(up.exitCode).toBe(0);

      const migrate = dockerInspect(`${COMPOSE_PROJECT}-migrate-1`);
      const api = dockerInspect(`${COMPOSE_PROJECT}-api-1`);
      expect(migrate, "migrate container exists").not.toBeNull();
      expect(api, "api container exists").not.toBeNull();

      // Primary contract: migrate exited 0; api is running.
      expect(migrate?.exitCode).toBe(0);
      expect(api?.status).toBe("running");

      // Secondary (timestamp) ordering: migrate.FinishedAt MUST be <=
      // api.StartedAt. Docker's RFC3339Nano timestamps are lexicographic-
      // comparable when both are non-zero. The 0001-01-01 zero timestamp
      // means "never" — that's a failure case for FinishedAt on a
      // service_completed_successfully run.
      if (
        migrate &&
        api &&
        migrate.finishedAt &&
        api.startedAt &&
        !migrate.finishedAt.startsWith("0001-01-01") &&
        !api.startedAt.startsWith("0001-01-01")
      ) {
        expect(
          migrate.finishedAt <= api.startedAt,
          `migrate finishedAt=${migrate.finishedAt} must be <= api startedAt=${api.startedAt}`,
        ).toBe(true);
      }
    });
  },
);
