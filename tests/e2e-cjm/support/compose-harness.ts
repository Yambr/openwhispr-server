// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 01 / Task 13-01-07 — docker-compose primitives for the
// e2e-cjm harness. NO LIVE BOOT THIS SESSION — the Session 5 Makefile target
// calls these in sequence.
//
// The harness operates two compose projects:
//   1. `openwhispr` — the contributor's normal running stack (may be up
//      before `make e2e-cjm` is invoked; the user expects it preserved).
//   2. `e2e-cjm`    — the hermetic per-suite stack we boot for the test.
//
// Lifecycle (matches the Session-5 Makefile target body):
//   - bootStack():
//       a. detect-running openwhispr project (compose ps -q).
//       b. if running → `compose -p openwhispr stop` (NOT down, NOT -v).
//       c. `compose -p e2e-cjm -f docker-compose.yml -f
//          docker-compose.embedded-litellm.yml --profile default up -d --wait`.
//       d. wait-for-readiness (poll /api/health migrations_completed=true).
//   - tearStack() (idempotent; ALWAYS runs in Makefile trap):
//       a. `compose -p e2e-cjm down -v --remove-orphans`.
//       b. if openwhispr was running → `compose -p openwhispr start`.
//
// Why two compose files: `docker-compose.embedded-litellm.yml` adds the
// in-cluster LiteLLM service (no provider API keys needed for the CJM
// happy path). The `--profile default` selector picks the bundled OSS
// services (mailpit, api, web, postgres, valkey, traefik, etc.).
//
// Why NOT testcontainers DockerComposeEnvironment here (cf. phase6-compose):
// the e2e-cjm harness must be driven from a Makefile via raw `docker compose`
// commands so the open-source quickstart (`docker compose up`) and the
// e2e harness use the same wire. testcontainers' UUID-suffixed project name
// would also defeat the openwhispr-stop / e2e-cjm-up / openwhispr-start
// dance documented above (the user has a running `-p openwhispr` stack;
// reusing that exact name in tests would clobber the user's volumes).
//
// CLAUDE.md anti-mock rule: this module shells out to the real `docker
// compose` CLI. No fake compose. Failure modes (docker daemon not running,
// permission denied, port conflict) bubble up verbatim via the spawn error.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { waitForReadiness } from "./wait-for-readiness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root (3 levels up from `tests/e2e-cjm/support/`). */
export const REPO_ROOT = resolve(__dirname, "../../..");

/** The compose project name OWNED BY this harness. */
export const E2E_PROJECT = "e2e-cjm";

/** The contributor's pre-existing stack name (preserved across runs). */
export const USER_PROJECT = "openwhispr";

/**
 * Compose files to layer when booting `-p e2e-cjm`. ORDER MATTERS — base
 * `docker-compose.yml` then the `embedded-litellm` overlay (which appends
 * a LiteLLM service + env wiring). Per plan OQ-2 binding.
 */
export const COMPOSE_FILES: readonly string[] = [
  "docker-compose.yml",
  "docker-compose.embedded-litellm.yml",
] as const;

/** Profile selector applied to `compose up`. Per plan OQ-2 binding. */
export const COMPOSE_PROFILE = "default";

/** Public Traefik-fronted URL for /api/health (TLS, self-signed). */
export const DEFAULT_HEALTH_URL =
  process.env.READINESS_HEALTH_URL ?? "https://api.localhost/api/health";

/** Boot timeout — laptops cold-pull image layers in <120s typically. */
export const DEFAULT_BOOT_TIMEOUT_MS = 240_000;

export interface BootStackOptions {
  /** Override total readiness budget (default 240s). */
  timeoutMs?: number;
  /** Override compose project name (rarely needed; tests use the constant). */
  projectName?: string;
  /** Override the compose files. Pass an explicit list to skip the overlay. */
  composeFiles?: readonly string[];
  /** Override the readiness URL. */
  healthUrl?: string;
  /**
   * Override the child-process spawner — DI seam for tests. Production
   * passes nothing → defaults to `node:child_process.spawn`. The shape
   * matches the subset we need.
   */
  spawnFn?: typeof spawn;
  /**
   * Override the readiness probe — DI seam for tests. Production passes
   * nothing → defaults to {@link waitForReadiness}.
   */
  waitForReadinessFn?: typeof waitForReadiness;
  /** If true, do not pre-stop the user's `openwhispr` project. */
  skipUserStackStop?: boolean;
  /** Stream child-process stdio to the parent. Defaults to true. */
  inheritStdio?: boolean;
}

export interface TearStackOptions {
  projectName?: string;
  composeFiles?: readonly string[];
  spawnFn?: typeof spawn;
  /** If true, do not re-start the user's `openwhispr` project on teardown. */
  skipUserStackRestart?: boolean;
  inheritStdio?: boolean;
  /**
   * Set by `bootStack()` to record whether the user's stack was running.
   * In a CLI invocation this is passed back via a sidecar state file
   * (Session 5 Makefile responsibility). For unit tests we pass it
   * explicitly.
   */
  userStackWasRunning?: boolean;
}

/** Run a docker-compose subcommand; resolve with exit code (never throws). */
function runCompose(
  args: string[],
  opts: {
    spawnFn?: typeof spawn;
    inheritStdio?: boolean;
  } = {},
): Promise<number> {
  const spawnImpl = opts.spawnFn ?? spawn;
  const inheritStdio = opts.inheritStdio ?? true;
  return new Promise((res) => {
    const child = spawnImpl("docker", ["compose", ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: inheritStdio ? "inherit" : "pipe",
    });
    child.on("close", (code) => res(code ?? -1));
    child.on("error", () => res(-1));
  });
}

/** Detect whether a compose project has any running containers. */
export async function isProjectRunning(
  projectName: string,
  opts: { spawnFn?: typeof spawn } = {},
): Promise<boolean> {
  const spawnImpl = opts.spawnFn ?? spawn;
  return new Promise((res) => {
    let stdout = "";
    const child = spawnImpl("docker", ["compose", "-p", projectName, "ps", "-q"], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // The child handle may be a typed return value or a more-narrow union
    // (spawn() returns ChildProcessWithoutNullStreams when stdio:'pipe'
    // covers all three streams; here we ignore stdin and stderr so stdout
    // is the only typed Readable).
    (child.stdout as NodeJS.ReadableStream | null)?.on("data", (b) => {
      stdout += String(b);
    });
    child.on("close", () => res(stdout.trim().length > 0));
    child.on("error", () => res(false));
  });
}

/** Build the `-f <file>` argv pairs for a compose call. */
function buildComposeFileArgs(files: readonly string[]): string[] {
  return files.flatMap((f) => ["-f", f]);
}

/**
 * Boot the e2e-cjm stack. Idempotent on the e2e-cjm project — re-running
 * after a partial boot will detect existing containers and reuse them
 * (compose up -d is itself idempotent).
 *
 * Returns metadata the caller (Makefile / Session 5) should thread into
 * the tearStack() call so the user's stack is properly restored.
 */
export async function bootStack(
  opts: BootStackOptions = {},
): Promise<{ userStackWasRunning: boolean }> {
  const projectName = opts.projectName ?? E2E_PROJECT;
  const composeFiles = opts.composeFiles ?? COMPOSE_FILES;
  const healthUrl = opts.healthUrl ?? DEFAULT_HEALTH_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const waitFn = opts.waitForReadinessFn ?? waitForReadiness;
  const spawnFn = opts.spawnFn;
  const inheritStdio = opts.inheritStdio;

  // 1. Detect + pause the user's pre-existing stack (NOT down — preserves
  //    volumes, networks, named images).
  let userStackWasRunning = false;
  if (!opts.skipUserStackStop) {
    userStackWasRunning = await isProjectRunning(USER_PROJECT, { spawnFn });
    if (userStackWasRunning) {
      const code = await runCompose(["-p", USER_PROJECT, "stop"], {
        spawnFn,
        inheritStdio,
      });
      if (code !== 0) {
        throw new Error(`bootStack: failed to stop user stack '${USER_PROJECT}' (exit ${code})`);
      }
    }
  }

  // 2. `compose -p e2e-cjm -f docker-compose.yml -f docker-compose.embedded-litellm.yml --profile default up -d --wait`
  const upArgs = [
    "-p",
    projectName,
    ...buildComposeFileArgs(composeFiles),
    "--profile",
    COMPOSE_PROFILE,
    "up",
    "-d",
    "--wait",
  ];
  const upCode = await runCompose(upArgs, { spawnFn, inheritStdio });
  if (upCode !== 0) {
    throw new Error(`bootStack: 'docker compose ${upArgs.join(" ")}' failed (exit ${upCode})`);
  }

  // 3. Cross-check api readiness through Traefik. `--wait` only blocks on
  //    container-healthcheck (which the api ships), but migrations may
  //    still be running inside the api process; /api/health.migrations_completed
  //    is the deterministic signal.
  await waitFn({ url: healthUrl, timeoutMs });

  return { userStackWasRunning };
}

/**
 * Tear down the e2e-cjm stack and restore the user's pre-existing project.
 * Idempotent — safe to call multiple times. Failures DO NOT throw; teardown
 * MUST always succeed enough to let the trap in the Makefile complete.
 *
 * The Makefile target invokes this via `trap` so it runs on both success
 * and failure paths; that's why this fn returns a result object instead
 * of throwing.
 */
export async function tearStack(opts: TearStackOptions = {}): Promise<{
  e2eDownExitCode: number;
  userStackStartExitCode: number | null;
}> {
  const projectName = opts.projectName ?? E2E_PROJECT;
  const composeFiles = opts.composeFiles ?? COMPOSE_FILES;
  const spawnFn = opts.spawnFn;
  const inheritStdio = opts.inheritStdio;

  const e2eDownExitCode = await runCompose(
    ["-p", projectName, ...buildComposeFileArgs(composeFiles), "down", "-v", "--remove-orphans"],
    { spawnFn, inheritStdio },
  );

  let userStackStartExitCode: number | null = null;
  if (!opts.skipUserStackRestart && opts.userStackWasRunning) {
    userStackStartExitCode = await runCompose(["-p", USER_PROJECT, "start"], {
      spawnFn,
      inheritStdio,
    });
  }

  return { e2eDownExitCode, userStackStartExitCode };
}
