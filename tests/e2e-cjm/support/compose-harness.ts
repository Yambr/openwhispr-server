// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 13 / Plan 01 / Task 13-01-07 — docker-compose primitives for the
// e2e-cjm harness. Extended by Phase 14 / Plan 14-07 with:
//
//   * `envOverrides` — per-scenario env injection via `docker compose
//     --env-file <temp>` (NOT process.env mutation, per CLAUDE.md
//     anti-workaround rule).
//   * `expectExit`   — short-budget boot that polls the api container's
//     exit status, then captures stderr via `compose logs api`. Required
//     by the byok-storage / byok-observability / loud-fail-misconfig
//     feature scenarios that assert the loud-fail Pino fatal record.
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
//       c. if envOverrides: author a temp env file (`<scratch>/<scenario>.env`)
//          merging KEY=VALUE pairs (undefined → bare `KEY=`).
//       d. `compose -p e2e-cjm [--env-file <temp>] -f docker-compose.yml -f
//          docker-compose.embedded-litellm.yml --profile default up -d
//          [--wait | (omit when expectExit set)]`.
//       e. expectExit unset → wait-for-readiness polling /api/health
//          migrations_completed=true.
//          expectExit set    → poll `compose ps --format json api` until
//          State=exited (matching ExitCode) OR timeout; then `compose
//          logs api --no-color --tail=200` for stderr; resolve with the
//          extended `{exitCode, stderr}` shape (exitCode may be null
//          on timeout — caller decides whether to fail the scenario).
//   - tearStack() (idempotent; ALWAYS runs in Makefile trap):
//       a. `compose -p e2e-cjm down -v --remove-orphans`.
//       b. if openwhispr was running → `compose -p openwhispr start`.
//       c. if envFilePath was passed: rm -f the temp env file.
//
// CLAUDE.md anti-mock rule: this module shells out to the real `docker
// compose` CLI. No fake compose. The `spawnFn` opt is a DI seam ONLY for
// the harness's own unit tests (compose-harness.test.ts) — production
// callers omit it and use `node:child_process.spawn` directly.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * `docker-compose.yml` (slim-core, Phase 14 / Plan 14-01) then the
 * `embedded-litellm` overlay (which appends a LiteLLM service + env
 * wiring), then the Phase 14 / Plan 14-03 opt-in overlays the CJM
 * happy-path needs:
 *
 *   - observability — Phase 13 trace-propagation assertions.
 *   - pgbouncer    — production-parity pooler.
 *   - storage      — MinIO + S3_ENDPOINT wiring (BYOK guard refuses boot
 *                    without it).
 *   - dev-tools    — mailpit for verification-email assertions.
 *   - ingress      — Traefik (`https://api.localhost/api/health` readiness URL
 *                    below depends on this overlay being layered).
 */
export const COMPOSE_FILES: readonly string[] = [
  "docker-compose.yml",
  "compose/docker-compose.embedded-litellm.yml",
  "compose/docker-compose.observability.yml",
  "compose/docker-compose.pgbouncer.yml",
  "compose/docker-compose.storage.yml",
  "compose/docker-compose.dev-tools.yml",
  "compose/docker-compose.ingress.yml",
] as const;

/** Profile selector applied to `compose up`. Per plan OQ-2 binding. */
export const COMPOSE_PROFILE = "default";

/** Public Traefik-fronted URL for /api/health (TLS, self-signed). */
export const DEFAULT_HEALTH_URL =
  process.env.READINESS_HEALTH_URL ?? "https://api.localhost/api/health";

/** Boot timeout — laptops cold-pull image layers in <120s typically. */
export const DEFAULT_BOOT_TIMEOUT_MS = 240_000;

/** Default scratch dir for envOverrides temp files (gitignored). */
export const DEFAULT_SCRATCH_DIR = resolve(REPO_ROOT, "tests/e2e-cjm/.scratch");

/**
 * Path of the dev-tools overlay that injects `OPENWHISPR_DISABLE_RATE_LIMIT=1`
 * directly into the api service `environment:` block. The slim e2e-cjm
 * sweep makes hundreds of `/api/auth/*` calls per worker; without this
 * override Better Auth's per-IP anti-abuse limiter starts returning
 * HTTP 429 around the 70th spec and cascades follow-on auth-bearing
 * scenarios into 401/redirect failure modes.
 *
 * Ad-hoc scenario stacks (e.g. `e2e-cjm-byok-<hash>`) spawned by
 * {@link bootStack} with their own `composeFiles` list do NOT pick up
 * the outer Makefile-booted overlay set — so the harness defensively
 * appends this overlay to every scenario boot unless the caller opts
 * out via {@link BootStackOptions.disableRateLimitOverlayAutoInclude}.
 */
export const DEV_TOOLS_OVERLAY = "compose/docker-compose.dev-tools.yml";

/**
 * Default per-scenario envOverrides merged with the caller-supplied map.
 * Keys named here are inherited by every spawned scenario stack unless
 * the caller's `envOverrides` shadows them. This is the "scenario stacks
 * inherit the rate-limit kill switch by default" guarantee that prevents
 * the BYOK loud-fail / slim-core scenarios from being starved by Better
 * Auth's per-IP limiter when the sweep runs auth-heavy specs back-to-back.
 *
 * Source-of-truth: `compose/docker-compose.dev-tools.yml` (the production
 * overlay sets the same value for the outer e2e-cjm stack). This default
 * exists to mirror that posture on per-scenario stacks where the overlay
 * file alone is not sufficient (because base `docker-compose.yml` does
 * not declare `OPENWHISPR_DISABLE_RATE_LIMIT` in its api env block, so
 * `--env-file` substitution is a no-op without the overlay also present).
 */
export const DEFAULT_SCENARIO_ENV_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  OPENWHISPR_DISABLE_RATE_LIMIT: "1",
});

/** Default budget when expectExit is set: short window for fast-fail boots. */
export const DEFAULT_EXPECT_EXIT_TIMEOUT_MS = 15_000;
/** Default poll interval for the api-container exit-status loop. */
export const DEFAULT_EXPECT_EXIT_INTERVAL_MS = 500;

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
  /**
   * Per-scenario env injection. `undefined` value writes a bare `KEY=`
   * line (explicit unset relative to the inherited environment). Plan
   * 14-07: enables the BYOK loud-fail feature scenarios to drive the
   * api container into specific misconfig postures.
   */
  envOverrides?: Record<string, string | undefined>;
  /**
   * Scenario id used to name the temp env file (`<scratch>/<scenarioId>.env`).
   * Defaults to a millisecond-resolution timestamp suffix.
   */
  scenarioId?: string;
  /** Override scratch dir for the temp env file. Tests inject a tmpdir. */
  scratchDir?: string;
  /**
   * Expect the api container to exit with this code instead of reaching
   * a healthy state. When set:
   *   - `compose up` is invoked WITHOUT `--wait`.
   *   - The readiness probe is SKIPPED.
   *   - The harness polls `compose ps --format json api` until State=exited
   *     OR the timeout fires.
   *   - Stderr is captured via `compose logs api --no-color --tail=200`.
   */
  expectExit?: number;
  /** Override the expect-exit polling budget (default 15s). */
  expectExitTimeoutMs?: number;
  /** Override the expect-exit polling interval (default 500ms). */
  expectExitIntervalMs?: number;
  /**
   * Opt out of the auto-include of `compose/docker-compose.dev-tools.yml`
   * and the auto-merge of {@link DEFAULT_SCENARIO_ENV_OVERRIDES}. Defaults
   * to `false` — every scenario inherits the rate-limit kill switch + the
   * dev-tools overlay unless the caller explicitly opts out. Set to `true`
   * for scenarios that need to assert production-shape rate-limit
   * behaviour (none today; reserved for future contract tests).
   */
  disableRateLimitOverlayAutoInclude?: boolean;
  /**
   * Restrict `docker compose up` to these service names (plus their
   * depends_on closure) instead of the whole `--profile` set. Use for
   * fast-fail boot-config scenarios that only need the api + its hard
   * dependencies and would otherwise pay the full observability/ingress
   * stack's startup latency. `up -d <svc>` still respects depends_on, so
   * `["api"]` pulls api+migrate+litellm+valkey+postgres+pgbouncer but skips
   * grafana/loki/tempo/mimir/otel/minio/traefik/web/worker. Undefined →
   * bring up the entire profile (the default, full-stack behaviour).
   */
  targetServices?: readonly string[];
  /**
   * Services to bring up (and WAIT for health) BEFORE the main `up`. Use with
   * `expectExit` + `targetServices` for fast-crash boots whose target depends on
   * a chain that must be healthy first: the main `up -d` (no `--wait`, since the
   * target is expected to crash) returns as soon as containers are CREATED and
   * does NOT block on the dependency chain finishing its start — so under
   * full-stack load contention the target can sit in `created` while its deps
   * are still starting, and the exit-poll then races (never observing the
   * crash → exitCode null). Pre-starting the deps with `up -d --wait` guarantees
   * they're healthy, so the subsequent target `up` starts (and crashes) at once.
   * Undefined → no pre-start phase (the main `up` brings up the dep closure).
   */
  prestartServices?: readonly string[];
}

export interface BootStackResult {
  userStackWasRunning: boolean;
  /** Captured api-container stderr (only populated when expectExit is set). */
  stderr?: string;
  /** Observed api exit code; null when the container did not exit within the budget. */
  exitCode?: number | null;
  /** Path to the temp env file authored for this boot (if envOverrides was set). */
  envFilePath?: string;
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
  /** Path to the per-scenario env file authored by bootStack; removed on teardown. */
  envFilePath?: string;
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

/** Run a docker-compose subcommand and capture stdout. */
function runComposeCapture(
  args: string[],
  opts: { spawnFn?: typeof spawn } = {},
): Promise<{ exitCode: number; stdout: string }> {
  const spawnImpl = opts.spawnFn ?? spawn;
  return new Promise((res) => {
    let stdout = "";
    const child = spawnImpl("docker", ["compose", ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    (child.stdout as NodeJS.ReadableStream | null)?.on("data", (b) => {
      stdout += String(b);
    });
    child.on("close", (code) => res({ exitCode: code ?? -1, stdout }));
    child.on("error", () => res({ exitCode: -1, stdout }));
  });
}

/** Run a raw `docker` (non-compose) subcommand and capture stdout. */
function runDockerCapture(
  args: string[],
  spawnFn?: typeof spawn,
): Promise<{ exitCode: number; stdout: string }> {
  const spawnImpl = spawnFn ?? spawn;
  return new Promise((res) => {
    let stdout = "";
    const child = spawnImpl("docker", args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    (child.stdout as NodeJS.ReadableStream | null)?.on("data", (b) => {
      stdout += String(b);
    });
    child.on("close", (code) => res({ exitCode: code ?? -1, stdout }));
    child.on("error", () => res({ exitCode: -1, stdout }));
  });
}

/**
 * Remove any docker networks still carrying a compose project's label. Compose
 * `down` leaves an orphaned `<project>_*` network behind once its containers are
 * already gone (v2.23 quirk); this sweeps them by the
 * `com.docker.compose.project=<project>` label filter so the address pool isn't
 * leaked across runs. Best-effort — every step swallows errors so teardown
 * never throws. Exported for unit coverage.
 */
export async function removeProjectNetworks(
  projectName: string,
  spawnFn?: typeof spawn,
): Promise<string[]> {
  const removed: string[] = [];
  try {
    const { stdout } = await runDockerCapture(
      [
        "network",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${projectName}`,
        "--format",
        "{{.Name}}",
      ],
      spawnFn,
    );
    const names = stdout
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    for (const name of names) {
      const { exitCode } = await runDockerCapture(["network", "rm", name], spawnFn);
      if (exitCode === 0) removed.push(name);
    }
  } catch {
    /* swallow — teardown MUST NOT throw */
  }
  return removed;
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
 * Author a temp env file from the overrides map. Undefined values become
 * bare `KEY=` lines — docker compose treats this as an explicit unset
 * relative to the host environment (overrides everything except shell
 * env on the docker compose invocation line itself).
 *
 * Returns the absolute path of the authored file.
 */
function writeEnvOverrideFile(
  scratchDir: string,
  scenarioId: string,
  overrides: Record<string, string | undefined>,
): string {
  mkdirSync(scratchDir, { recursive: true });
  // docker compose `--env-file` REPLACES the default `.env` (it does NOT
  // merge). So if the caller's `.env` has POSTGRES_OWNER_PASSWORD,
  // VALKEY_PASSWORD, etc., a temp file with just `OPENWHISPR_DISABLE_
  // RATE_LIMIT=1` would strip those and postgres would refuse to boot
  // ("superuser password is not specified"). Mirror the base .env first
  // (best-effort — absent .env is fine for OSS-quickstart paths) then
  // append the overrides last so they win on duplicate keys.
  const baseEnvPath = resolve(REPO_ROOT, ".env");
  const baseEnv = existsSync(baseEnvPath) ? readFileSync(baseEnvPath, "utf8") : "";
  const lines: string[] = [
    "# Auto-generated by tests/e2e-cjm/support/compose-harness.ts (Phase 14 / Plan 14-07).",
    `# Scenario: ${scenarioId}. Removed by tearStack().`,
    "# --- begin inherited base .env ---",
    baseEnv.trimEnd(),
    "# --- end inherited base .env ---",
    "# --- begin scenario overrides ---",
  ];
  for (const [k, v] of Object.entries(overrides)) {
    lines.push(`${k}=${v ?? ""}`);
  }
  const path = resolve(scratchDir, `${scenarioId}.env`);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  return path;
}

/** Parse one or more JSON objects (compose ps may emit NDJSON or a single object). */
function parseComposePsJson(
  raw: string,
): Array<{ Service?: string; State?: string; ExitCode?: number }> {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Try array first.
  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr)) return arr;
    return [arr];
  } catch {
    /* fall through to NDJSON */
  }
  // NDJSON.
  return trimmed
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as { Service?: string; State?: string; ExitCode?: number };
      } catch {
        return {};
      }
    });
}

/**
 * Resolve the api container id for a project, then `docker inspect` its true
 * last exit code + restart count. `docker compose ps --format json` reports a
 * TRANSIENT ExitCode (0) while a container is mid restart-loop, but
 * `inspect .State.ExitCode` carries the REAL last exit code even in the
 * `restarting` state (empirically verified). Returns null if the container or
 * its exit state can't be read yet.
 */
async function inspectApiExit(
  projectName: string,
  composeFiles: readonly string[],
  envFilePath: string | undefined,
  spawnFn: typeof spawn | undefined,
): Promise<{ status: string; exitCode: number; restartCount: number } | null> {
  const idArgs = [
    ...(envFilePath ? ["--env-file", envFilePath] : []),
    "-p",
    projectName,
    ...buildComposeFileArgs(composeFiles),
    "ps",
    "-aq",
    "api",
  ];
  const { stdout: idOut } = await runComposeCapture(idArgs, { spawnFn });
  const cid = idOut.trim().split("\n")[0]?.trim();
  if (!cid) return null;
  // `docker inspect` (NOT `compose`) — direct container introspection.
  const spawnImpl = spawnFn ?? spawn;
  const inspected = await new Promise<string>((res) => {
    let out = "";
    const child = spawnImpl(
      "docker",
      ["inspect", cid, "--format", "{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}"],
      { cwd: REPO_ROOT, env: process.env, stdio: ["ignore", "pipe", "ignore"] },
    );
    (child.stdout as NodeJS.ReadableStream | null)?.on("data", (b) => {
      out += String(b);
    });
    child.on("close", () => res(out));
    child.on("error", () => res(""));
  });
  const [status, exitStr, restartStr] = inspected.trim().split(/\s+/);
  if (!status) return null;
  return {
    status,
    exitCode: Number.parseInt(exitStr ?? "", 10) || 0,
    restartCount: Number.parseInt(restartStr ?? "", 10) || 0,
  };
}

/**
 * Poll until the api container reports a terminal loud-fail signal, then resolve
 * its exit code (or null on timeout). A container that exits non-zero during
 * boot with `restart: unless-stopped` does NOT settle on `State=exited` — Docker
 * restart-loops it, so `compose ps` flickers between `restarting`/`running` and
 * never stably shows `exited` (compose ps ExitCode reads 0 mid-loop). Detect the
 * crash via BOTH signals: a stable `compose ps State=exited`, OR a
 * `docker inspect` showing the container restart-looping (`restarting`, or
 * RestartCount>0) with a non-zero last exit code. Either is an authentic
 * loud-fail observation.
 */
async function pollApiExit(
  projectName: string,
  composeFiles: readonly string[],
  envFilePath: string | undefined,
  expectedExit: number,
  timeoutMs: number,
  intervalMs: number,
  spawnFn: typeof spawn | undefined,
): Promise<number | null> {
  // We deliberately return the OBSERVED code even if it doesn't match
  // expectedExit — the step layer asserts the comparison so the diagnostic
  // surfaces in the cucumber report.
  void expectedExit;
  const started = Date.now();
  // Last non-zero exit code seen across the restart loop. Under `restart:
  // unless-stopped` a crash-looping container oscillates between
  // `restarting ExitCode=<N>` (during backoff) and `running ExitCode=0` (the
  // brief moment it's up before re-crashing); the `running 0` window widens the
  // sicker the backoff gets, so a point-in-time poll can repeatedly sample
  // `running 0` and miss the `restarting N` window — especially under full-stack
  // load contention. We therefore remember the last non-zero exit and treat
  // ANY observed restart (restartCount > 0) as the definitive crash signal.
  let lastNonZeroExit: number | null = null;
  while (Date.now() - started < timeoutMs) {
    const psArgs = [
      ...(envFilePath ? ["--env-file", envFilePath] : []),
      "-p",
      projectName,
      ...buildComposeFileArgs(composeFiles),
      "ps",
      "--format",
      "json",
      "api",
    ];
    const { stdout } = await runComposeCapture(psArgs, { spawnFn });
    const rows = parseComposePsJson(stdout);
    const api = rows.find((r) => r.Service === "api") ?? rows[0];
    if (api && api.State === "exited") {
      return typeof api.ExitCode === "number" ? api.ExitCode : -1;
    }
    // Restart-loop case: a boot-time non-zero exit under `restart: unless-stopped`
    // never settles on `exited`. `docker inspect` carries the true last exit code.
    const inspected = await inspectApiExit(projectName, composeFiles, envFilePath, spawnFn);
    if (inspected) {
      if (inspected.exitCode !== 0) lastNonZeroExit = inspected.exitCode;
      // `restarting`/`exited` with a non-zero code is an unambiguous crash.
      if (
        inspected.exitCode !== 0 &&
        (inspected.status === "restarting" || inspected.status === "exited")
      ) {
        return inspected.exitCode;
      }
      // restartCount > 0 means the container HAS crashed at least once, even if
      // this instant samples `running ExitCode=0` mid-restart. Return the last
      // non-zero exit we saw (or, if we somehow only ever sampled the running
      // window, the next loop captures the code — but a positive restartCount is
      // itself proof the boot is not healthy).
      if (inspected.restartCount > 0 && lastNonZeroExit !== null) {
        return lastNonZeroExit;
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return lastNonZeroExit;
}

/**
 * Boot the e2e-cjm stack. Idempotent on the e2e-cjm project — re-running
 * after a partial boot will detect existing containers and reuse them
 * (compose up -d is itself idempotent).
 */
export async function bootStack(opts: BootStackOptions = {}): Promise<BootStackResult> {
  const projectName = opts.projectName ?? E2E_PROJECT;
  const baseComposeFiles = opts.composeFiles ?? COMPOSE_FILES;
  // Defensive auto-include: scenario stacks that select their own slim
  // compose-file set (e.g. BYOK loud-fail scenarios) miss the rate-limit
  // kill switch the outer e2e-cjm stack gets via the dev-tools overlay.
  // Append the overlay unless the caller explicitly opted out.
  const composeFiles =
    opts.disableRateLimitOverlayAutoInclude || baseComposeFiles.includes(DEV_TOOLS_OVERLAY)
      ? baseComposeFiles
      : [...baseComposeFiles, DEV_TOOLS_OVERLAY];
  const healthUrl = opts.healthUrl ?? DEFAULT_HEALTH_URL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const waitFn = opts.waitForReadinessFn ?? waitForReadiness;
  const spawnFn = opts.spawnFn;
  const inheritStdio = opts.inheritStdio;
  const scratchDir = opts.scratchDir ?? DEFAULT_SCRATCH_DIR;

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

  // 2. Author the temp env file BEFORE the up call, so compose picks it up
  //    via --env-file. Phase 14 / Plan 14-07 deviation: NO process.env
  //    mutation (per CLAUDE.md anti-workaround).
  //
  //    The default overrides ({@link DEFAULT_SCENARIO_ENV_OVERRIDES}) are
  //    merged FIRST so caller-supplied overrides win on key collision.
  //    The temp file is authored even when the caller supplied no
  //    overrides, so the rate-limit kill switch reaches every spawned
  //    scenario stack (paired with the auto-included dev-tools overlay
  //    above; the overlay's `environment:` block declares the var, the
  //    env-file just makes sure variable substitution stays consistent
  //    if a future overlay refactor switches to `${VAR}` form).
  let envFilePath: string | undefined;
  const mergedOverrides: Record<string, string | undefined> | undefined =
    opts.disableRateLimitOverlayAutoInclude
      ? opts.envOverrides
      : { ...DEFAULT_SCENARIO_ENV_OVERRIDES, ...(opts.envOverrides ?? {}) };
  if (mergedOverrides) {
    const scenarioId = opts.scenarioId ?? `cjm-${Date.now()}`;
    envFilePath = writeEnvOverrideFile(scratchDir, scenarioId, mergedOverrides);
  }

  // 2c. Pre-start phase: bring the dependency chain up to HEALTHY first, so the
  //     subsequent (no-wait) target `up` starts and crashes immediately instead
  //     of sitting in `created` while its deps churn under load. Only runs when
  //     prestartServices is set (fast-crash boots). `up -d --wait` blocks until
  //     these report healthy (or compose errors), giving a deterministic gate.
  if (opts.prestartServices && opts.prestartServices.length > 0) {
    const prestartArgs = [
      ...(envFilePath ? ["--env-file", envFilePath] : []),
      "-p",
      projectName,
      ...buildComposeFileArgs(composeFiles),
      "--profile",
      COMPOSE_PROFILE,
      "up",
      "-d",
      "--wait",
      ...opts.prestartServices,
    ];
    const prestartCode = await runCompose(prestartArgs, { spawnFn, inheritStdio });
    if (prestartCode !== 0) {
      throw new Error(
        `bootStack: prestart 'docker compose ${prestartArgs.join(" ")}' failed (exit ${prestartCode})`,
      );
    }
  }

  // 3. `compose -p e2e-cjm [--env-file …] -f docker-compose.yml … --profile default up -d [--wait]`
  //    --wait is omitted when expectExit is set — we expect a fast crash,
  //    not a healthy container.
  const upArgs = [
    ...(envFilePath ? ["--env-file", envFilePath] : []),
    "-p",
    projectName,
    ...buildComposeFileArgs(composeFiles),
    "--profile",
    COMPOSE_PROFILE,
    "up",
    "-d",
    ...(opts.expectExit === undefined ? ["--wait"] : []),
    // Service-name positionals MUST trail all flags. When set, compose brings
    // up only these + their depends_on closure (not the whole profile).
    ...(opts.targetServices ?? []),
  ];
  const upCode = await runCompose(upArgs, { spawnFn, inheritStdio });
  // When expectExit is set, a non-zero up code is acceptable (the api
  // container's crash MAY surface as a compose-up error depending on
  // depends_on wiring). The downstream poll resolves the real signal.
  if (opts.expectExit === undefined && upCode !== 0) {
    throw new Error(`bootStack: 'docker compose ${upArgs.join(" ")}' failed (exit ${upCode})`);
  }

  // 4a. Happy path: cross-check api readiness through Traefik.
  if (opts.expectExit === undefined) {
    await waitFn({ url: healthUrl, timeoutMs });
    return { userStackWasRunning, envFilePath };
  }

  // 4b. expectExit path: poll the api container's exit code, then capture
  //     stderr via `compose logs api --no-color --tail=200`. The two
  //     together let scenarios assert the loud-fail Pino fatal record.
  const exitCode = await pollApiExit(
    projectName,
    composeFiles,
    envFilePath,
    opts.expectExit,
    opts.expectExitTimeoutMs ?? DEFAULT_EXPECT_EXIT_TIMEOUT_MS,
    opts.expectExitIntervalMs ?? DEFAULT_EXPECT_EXIT_INTERVAL_MS,
    spawnFn,
  );
  const logsArgs = [
    ...(envFilePath ? ["--env-file", envFilePath] : []),
    "-p",
    projectName,
    ...buildComposeFileArgs(composeFiles),
    "logs",
    "api",
    "--no-color",
    "--tail=200",
  ];
  const { stdout: stderr } = await runComposeCapture(logsArgs, { spawnFn });

  return { userStackWasRunning, envFilePath, exitCode, stderr };
}

/**
 * Tear down the e2e-cjm stack and restore the user's pre-existing project.
 * Idempotent — safe to call multiple times. Failures DO NOT throw; teardown
 * MUST always succeed enough to let the trap in the Makefile complete.
 */
export async function tearStack(opts: TearStackOptions = {}): Promise<{
  e2eDownExitCode: number;
  userStackStartExitCode: number | null;
}> {
  const projectName = opts.projectName ?? E2E_PROJECT;
  const baseComposeFiles = opts.composeFiles ?? COMPOSE_FILES;
  // Mirror bootStack's auto-include of the dev-tools overlay: `down` must be
  // invoked with the SAME compose-file set the `up` used, or compose can leave
  // the project's network behind (the `up` declared it across files the `down`
  // didn't list). A leaked `<project>_openwhispr_internal` network per run
  // eventually exhausts Docker's address-pool and fails the NEXT boot with
  // "could not find an available, non-overlapping IPv4 address pool" — observed
  // after ~18 @cjm-sso-1.6 iterations left orphaned networks.
  const composeFiles = baseComposeFiles.includes(DEV_TOOLS_OVERLAY)
    ? baseComposeFiles
    : [...baseComposeFiles, DEV_TOOLS_OVERLAY];
  const spawnFn = opts.spawnFn;
  const inheritStdio = opts.inheritStdio;

  const downArgs = [
    ...(opts.envFilePath ? ["--env-file", opts.envFilePath] : []),
    "-p",
    projectName,
    ...buildComposeFileArgs(composeFiles),
    "down",
    "-v",
    "--remove-orphans",
  ];
  const e2eDownExitCode = await runCompose(downArgs, { spawnFn, inheritStdio });

  // Belt-and-suspenders network sweep. `docker compose down` does NOT reliably
  // remove a project network once all its containers are already gone — compose
  // v2.23 reports "No resource found to remove for project <p>" and leaves the
  // labeled `<project>_openwhispr_internal` network orphaned. Each leaked network
  // consumes an address-pool slot; ~18 accumulate → the next boot fails with
  // "could not find an available, non-overlapping IPv4 address pool". Sweep any
  // network still carrying this project's compose label. Best-effort, never
  // throws (teardown must not fail the run).
  await removeProjectNetworks(projectName, spawnFn);

  let userStackStartExitCode: number | null = null;
  if (!opts.skipUserStackRestart && opts.userStackWasRunning) {
    userStackStartExitCode = await runCompose(["-p", USER_PROJECT, "start"], {
      spawnFn,
      inheritStdio,
    });
  }

  // Best-effort cleanup of the per-scenario env file.
  if (opts.envFilePath) {
    try {
      rmSync(opts.envFilePath, { force: true });
    } catch {
      /* swallow — teardown MUST NOT throw */
    }
  }

  return { e2eDownExitCode, userStackStartExitCode };
}
