// SPDX-License-Identifier: FSL-1.1-ALv2
// tests/e2e — host-side compose stack helpers.
//
// Boots the docker-compose stack with the contract-test profile +
// hermetic mock LiteLLM config. The api healthcheck is the gate the
// `up --wait` command honors; once the wait returns, all dependents
// (postgres, pgbouncer, valkey, traefik, litellm, api, migrate) are
// healthy or "started" per their compose `depends_on.condition`.
//
// We deliberately avoid `dockerode` / `testcontainers` here — the
// e2e suite must exercise the SAME compose topology operators run,
// not a bespoke programmatic stack. `docker compose` is the contract.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

/**
 * Public base URL — always Traefik over TLS on the dev hostname. RFC
 * 6761 reserves `*.localhost` to loopback so this resolves on every
 * developer laptop and CI runner without /etc/hosts edits.
 */
export const BACKEND_URL = "https://api.localhost";

/** Canonical hermetic-mode env passed to every compose invocation. */
export const HERMETIC_ENV = {
  LITELLM_CONFIG_FILE: "litellm_config.contract.yaml",
  OPENWHISPR_TEST_ROUTES: "true",
} as const;

/**
 * Run a command and stream its stdout/stderr. Resolves with the exit
 * code (does NOT throw on non-zero — caller decides). The 30-minute
 * timeout matches the worst-case cold-pull scenario on CI.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string; quiet?: boolean } = {},
): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: { ...process.env, ...opts.env },
      stdio: opts.quiet ? "ignore" : "inherit",
    });
    child.on("close", (code) => resolveCode(code ?? -1));
    child.on("error", () => resolveCode(-1));
  });
}

/**
 * Canonical compose `-f` file list for the hermetic e2e stack.
 *
 * The `seed` (and `contract-test-runner`) services live ONLY in the
 * contract-test overlay — they are not part of the bare
 * `docker-compose.yml`. `--profile contract-test` alone cannot surface
 * a service that is absent from the merged config, so the overlay file
 * must be passed via `-f` on EVERY compose invocation (matching the CI
 * `contract-test` cell: `-f docker-compose.yml -f compose/docker-compose.contract-test.yml`).
 * Without it, `compose run --rm seed` fails with `no such service: seed`.
 */
export const COMPOSE_FILE_ARGS: readonly string[] = [
  "-f",
  "docker-compose.yml",
  "-f",
  "compose/docker-compose.contract-test.yml",
] as const;

/**
 * Convenience: `docker compose -f ... ...args` with the canonical
 * hermetic env and the contract-test overlay layered in.
 */
export async function compose(...args: string[]): Promise<number> {
  return run("docker", ["compose", ...COMPOSE_FILE_ARGS, ...args], {
    env: { ...HERMETIC_ENV },
  });
}

/**
 * Bring the full stack up (default + contract-test profiles) and seed
 * the conformance fixtures. Throws on any non-zero exit.
 */
export async function bringStackUp(): Promise<void> {
  if (!existsSync(resolve(REPO_ROOT, ".env"))) {
    throw new Error(
      ".env not found at repo root. Run `tools/bootstrap.sh` (or copy .env.example) before `make e2e-hermetic`.",
    );
  }

  // Bring up the `default` profile. Two design choices:
  //
  // 1. ONLY `--profile default` (not `--profile contract-test`): the
  //    contract-test profile carries `seed` (one-shot) and
  //    `contract-test-runner` (vitest container that exits after its
  //    own in-cluster suite finishes). Bringing them up here would
  //    drag a self-exiting runner into the started set. The
  //    contract-test overlay FILE is still passed via `COMPOSE_FILE_ARGS`
  //    so `seed` exists in the merged config; seed is invoked separately
  //    via `run --rm seed` below.
  //
  // 2. NO `--wait`: the observability stack (grafana in particular) is
  //    flaky on cold-cache laptops and occasionally reports unhealthy
  //    for a few seconds before stabilizing. `up --wait` would fail the
  //    entire run on a transient grafana hiccup that the host-side e2e
  //    doesn't care about. The follow-up `waitForApiHealth()` polls the
  //    api healthcheck via Traefik directly — that's the only readiness
  //    signal the e2e actually needs. `make contract-test` uses --wait
  //    because the in-cluster runner depends on every observability
  //    target via its own depends_on; our host-side suite does not.
  // `--profile dev` is required: AUDIT-HARD-04 gated the `mailpit` SMTP
  // trap behind the `dev` profile (it must not start in production).
  // The r21/r22 verification-email e2e tests poll mailpit on
  // 127.0.0.1:8025, so the host-side harness must opt the trap in.
  const upCode = await compose("--profile", "default", "--profile", "dev", "up", "-d");
  if (upCode !== 0) {
    throw new Error(`docker compose up failed with exit code ${upCode}`);
  }

  // Seed lives in the `contract-test` profile but is invoked here as a
  // one-shot via `run --rm` — that bypasses the profile gating without
  // dragging contract-test-runner into the started set.
  const seedCode = await compose(
    "--profile",
    "default",
    "--profile",
    "contract-test",
    "run",
    "--rm",
    "seed",
  );
  if (seedCode !== 0) {
    throw new Error(`compose seed failed with exit code ${seedCode}`);
  }
}

/**
 * Tear the stack down and DROP volumes. Run on global teardown so
 * subsequent runs start from a clean Postgres state.
 */
export async function bringStackDown(): Promise<void> {
  await compose("down", "-v", "--remove-orphans");
}

/**
 * Probe the api `/api/health` endpoint until it returns 200 or the
 * deadline expires. Used as a belt-and-suspenders check on top of
 * `up --wait` (which gates on the docker HEALTHCHECK, not the actual
 * Traefik+api round-trip).
 */
export async function waitForApiHealth(deadlineMs = 120_000): Promise<void> {
  const started = Date.now();
  let lastErr: unknown;
  while (Date.now() - started < deadlineMs) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `api /api/health did not become reachable at ${BACKEND_URL} within ${deadlineMs}ms (last error: ${String(lastErr)})`,
  );
}

/**
 * Read a fixture audio file from `tests/fixtures/audio/`. Returns a
 * single-part `multipart/form-data` body suitable for posting to
 * `/api/transcribe`.
 */
export interface AudioMultipartBody {
  body: Buffer;
  contentType: string;
}
export function audioMultipartBody(filename = "sample-1s.wav"): AudioMultipartBody {
  const fileBytes = readFileSync(resolve(REPO_ROOT, "tests/fixtures/audio", filename));
  const boundary = `----openwhispr-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, fileBytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
