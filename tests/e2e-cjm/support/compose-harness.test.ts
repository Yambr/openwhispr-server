// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 14 / Plan 14-07 / Task 1 — unit tests for the bootStack() extension.
//
// Verifies the two new opts wired by this plan:
//
//   1. `envOverrides?: Record<string, string | undefined>` — when present,
//      bootStack() writes a temp env file under
//      `tests/e2e-cjm/.scratch/<scenario>.env` and invokes `docker compose
//      --env-file <temp> -f … up`. Undefined values are written as bare
//      `KEY=` (explicit unset). The harness does NOT mutate `process.env`.
//
//   2. `expectExit?: number` — when set, bootStack() reduces the readiness
//      budget to a short window (15s), invokes `compose up -d` WITHOUT the
//      `--wait` flag, polls the api container exit code via
//      `compose ps --format json --status exited`, and on a matching exit
//      collects stderr via `compose logs api --no-color --tail=200`.
//      The returned shape extends with `{ stderr, exitCode }`.
//
// CLAUDE.md anti-mock rule: we mock at the PROCESS BOUNDARY only — the
// injected `spawnFn` simulates the `docker compose` CLI surface. The
// harness's own argv-construction and env-file authorship are real
// (filesystem writes are real; tmp dir is cleaned up after each test).

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bootStack,
  DEFAULT_SCENARIO_ENV_OVERRIDES,
  DEV_TOOLS_OVERLAY,
  tearStack,
} from "./compose-harness.js";

// Lightweight EventEmitter-shaped child mock. We model the subset bootStack
// touches: `on('close'|'error', cb)` and pipe-mode `stdout` / `stderr`
// streams that emit a fixed buffer immediately. The mock invokes `close`
// asynchronously so the harness's Promise plumbing fires deterministically.
interface FakeChildSpec {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

function makeFakeChild(spec: FakeChildSpec) {
  type Handler = (...args: unknown[]) => void;
  const closeHandlers: Handler[] = [];
  const errorHandlers: Handler[] = [];
  const stdoutListeners: Handler[] = [];
  const child = {
    on(event: string, cb: Handler) {
      if (event === "close") closeHandlers.push(cb);
      else if (event === "error") errorHandlers.push(cb);
      return child;
    },
    stdout: {
      on(event: string, cb: Handler) {
        if (event === "data") stdoutListeners.push(cb);
        return child.stdout;
      },
    },
    stderr: {
      on(_event: string, _cb: Handler) {
        return child.stderr;
      },
    },
  };
  // Drive callbacks on next tick.
  queueMicrotask(() => {
    if (spec.stdout) {
      for (const l of stdoutListeners) l(Buffer.from(spec.stdout));
    }
    for (const cb of closeHandlers) cb(spec.exitCode ?? 0);
  });
  return child;
}

interface SpawnCall {
  cmd: string;
  args: string[];
  // The full argv as one string for cheap substring assertions.
  joined: string;
}

function makeSpawnRecorder(router: (cmd: string, args: string[]) => FakeChildSpec): {
  spawnFn: (cmd: string, args: string[]) => ReturnType<typeof makeFakeChild>;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawnFn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args, joined: [cmd, ...args].join(" ") });
    return makeFakeChild(router(cmd, args));
  };
  return { spawnFn: spawnFn as unknown as typeof spawnFn, calls };
}

// Stub waitForReadiness for happy-path branches (resolves instantly).
const waitOk = vi.fn(async () => ({
  attempts: 1,
  elapsedMs: 1,
  body: { status: "ok", migrations_completed: true },
}));

// Scratch dir for envOverrides temp files. The harness writes into
// `tests/e2e-cjm/.scratch/` relative to REPO_ROOT, but we can override the
// scratch dir per-test via the `scratchDir` opt to keep these tests
// hermetic.
let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "cjm-harness-"));
  waitOk.mockClear();
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("bootStack — envOverrides", () => {
  it("writes a temp env file and passes --env-file to compose up", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      // `ps -q` for openwhispr-stack detection → no running stack.
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      envOverrides: {
        S3_ENDPOINT: "https://s3.corp.example.com",
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined, // explicit unset
        DATABASE_URL: "postgresql://app@postgres/app",
      },
      scratchDir,
      scenarioId: "byok-storage-1",
      spawnFn,
      waitForReadinessFn: waitOk,
      inheritStdio: false,
      skipUserStackStop: true,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    expect(upCall, "expected an `up` call").toBeTruthy();
    // --env-file must precede `up`.
    expect(upCall?.joined).toMatch(/--env-file\s+\S+\.env\s+/);

    // The temp file exists and contains the merged overrides.
    const envPath = upCall?.args[upCall.args.indexOf("--env-file") + 1] as string;
    const contents = readFileSync(envPath, "utf8");
    expect(contents).toMatch(/^S3_ENDPOINT=https:\/\/s3\.corp\.example\.com$/m);
    // Undefined overrides become `KEY=` (explicit unset of an inherited var).
    expect(contents).toMatch(/^OTEL_EXPORTER_OTLP_ENDPOINT=$/m);
    expect(contents).toMatch(/^DATABASE_URL=postgresql:\/\/app@postgres\/app$/m);
  });

  it("does NOT mutate process.env when applying envOverrides", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn } = makeSpawnRecorder(router);
    const before = process.env.S3_ENDPOINT;

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      envOverrides: { S3_ENDPOINT: "https://forbidden-mutation.example.com" },
      scratchDir,
      scenarioId: "no-mutation",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
    });

    expect(process.env.S3_ENDPOINT).toBe(before);
  });

  it("appends targetServices as trailing positionals on `up` (scopes the boot)", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      scratchDir,
      scenarioId: "scoped-boot",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      targetServices: ["api"],
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    expect(upCall, "expected an `up` call").toBeTruthy();
    // The service name must trail `up` (and any flags), restricting the boot to
    // api + its depends_on closure instead of the whole profile.
    const a = upCall?.args ?? [];
    expect(a[a.length - 1]).toBe("api");
    expect(a.indexOf("up")).toBeLessThan(a.lastIndexOf("api"));
  });

  it("runs a `--wait <prestartServices>` up BEFORE the main `up` (deterministic dep gate)", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      // exit poll → api never exits (we only assert the up ordering here).
      if (args.includes("ps") && args.includes("--format")) {
        return { stdout: JSON.stringify({ Service: "api", State: "running", ExitCode: 0 }) };
      }
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      scratchDir,
      scenarioId: "prestart-boot",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      expectExit: 78,
      targetServices: ["api"],
      prestartServices: ["pgbouncer"],
      expectExitTimeoutMs: 50,
      expectExitIntervalMs: 25,
    });

    const upCalls = calls.filter((c) => c.joined.includes(" up "));
    expect(upCalls.length, "expected a prestart `up` and a main `up`").toBeGreaterThanOrEqual(2);
    // First up = prestart: `up -d --wait pgbouncer`.
    const prestart = upCalls[0];
    expect(prestart?.args).toContain("--wait");
    expect(prestart?.args[prestart.args.length - 1]).toBe("pgbouncer");
    // Second up = main target boot: `up -d api` WITHOUT --wait (expectExit set).
    const main = upCalls[1];
    expect(main?.args).not.toContain("--wait");
    expect(main?.args[main.args.length - 1]).toBe("api");
  });

  it("skips the prestart phase when prestartServices is omitted", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      scratchDir,
      scenarioId: "no-prestart",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      targetServices: ["api"],
    });

    // Exactly one `up` (the main boot) — no separate prestart `up`.
    const upCalls = calls.filter((c) => c.joined.includes(" up "));
    expect(upCalls.length).toBe(1);
  });

  it("brings up the whole profile when targetServices is omitted", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      scratchDir,
      scenarioId: "full-boot",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    // No service positional after `up`/flags → `up -d --wait` ends the argv.
    expect(upCall?.args[upCall.args.length - 1]).toBe("--wait");
  });
});

describe("bootStack — expectExit + stderr capture", () => {
  it("returns exitCode and stderr when api container exits non-zero", async () => {
    const fatalLine = JSON.stringify({
      level: 60,
      event: "byok.required",
      code: "BYOK_STORAGE_REQUIRED",
      overlay: "storage",
      missing: ["S3_ENDPOINT"],
      hint: "Set the missing env(s) OR enable the overlay (…).",
      msg: "BYOK env missing for disabled overlay; refusing to start",
    });
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (
        args.includes("ps") &&
        args.includes("-q") &&
        args.includes("-p") &&
        args.includes("openwhispr")
      )
        return { stdout: "" };
      // For the exit-status poll: `ps` (no -q) reports an exited api.
      if (
        args.includes("ps") &&
        args.includes("--format") &&
        args.some((a) => a.startsWith("api"))
      ) {
        return { stdout: JSON.stringify({ Service: "api", State: "exited", ExitCode: 1 }) };
      }
      if (args.includes("logs") && args.includes("api")) {
        return { stdout: `${fatalLine}\n` };
      }
      return { exitCode: 0 };
    };
    const { spawnFn } = makeSpawnRecorder(router);

    const result = await bootStack({
      composeFiles: ["docker-compose.yml"],
      envOverrides: { S3_ENDPOINT: undefined },
      expectExit: 1,
      scratchDir,
      scenarioId: "expect-exit",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      // Short polling for the test path.
      expectExitTimeoutMs: 500,
      expectExitIntervalMs: 25,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBeDefined();
    expect(result.stderr).toContain('"event":"byok.required"');
    expect(result.stderr).toContain('"code":"BYOK_STORAGE_REQUIRED"');
    // The harness MUST NOT have called waitForReadiness when expectExit is set.
    expect(waitOk).not.toHaveBeenCalled();
  });

  it("returns null exitCode and times out when api never exits but expectExit is set", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      // exit-status poll always reports running.
      if (args.includes("ps") && args.includes("--format")) {
        return { stdout: JSON.stringify({ Service: "api", State: "running", ExitCode: 0 }) };
      }
      if (args.includes("logs")) return { stdout: "no fatal yet" };
      return { exitCode: 0 };
    };
    const { spawnFn } = makeSpawnRecorder(router);

    const result = await bootStack({
      composeFiles: ["docker-compose.yml"],
      expectExit: 1,
      scratchDir,
      scenarioId: "expect-exit-timeout",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      expectExitTimeoutMs: 150,
      expectExitIntervalMs: 25,
    });

    expect(result.exitCode).toBeNull();
    // Even on timeout, harness collects whatever stderr/logs exist so tests
    // can diagnose stuck boots.
    expect(typeof result.stderr).toBe("string");
  });

  it("detects a restart-looping crash via docker inspect when compose ps never shows exited (live @cjm-sso-1.6)", async () => {
    // A boot-time non-zero exit under `restart: unless-stopped` never settles on
    // State=exited — Docker restart-loops it, so `compose ps` flickers
    // restarting/running with a transient ExitCode=0 (empirically verified).
    // The harness must fall back to `docker inspect .State.ExitCode`, which
    // carries the REAL last exit code even mid-loop.
    const fatal = "FATAL oidc-jit-boot: OIDC_TENANT_MAPPING is not valid JSON. Refusing to boot";
    const router = (cmd: string, args: string[]): FakeChildSpec => {
      // openwhispr-stack running-detection.
      if (args.includes("ps") && args.includes("-q") && args.includes("openwhispr")) {
        return { stdout: "" };
      }
      // inspectApiExit's `compose ps -aq api` → return a fake container id.
      if (args.includes("ps") && args.includes("-aq") && args.some((a) => a.startsWith("api"))) {
        return { stdout: "deadbeefcafe\n" };
      }
      // exit-status poll `compose ps --format json` → ALWAYS restarting, ExitCode 0
      // (never settles on exited — the restart-loop case).
      if (args.includes("ps") && args.includes("--format")) {
        return { stdout: JSON.stringify({ Service: "api", State: "restarting", ExitCode: 0 }) };
      }
      // `docker inspect <cid> --format ...` → the TRUE last exit code (78), mid-loop.
      if (cmd === "docker" && args[0] === "inspect") {
        return { stdout: "restarting 78 5\n" };
      }
      if (args.includes("logs") && args.includes("api")) {
        return { stdout: `${fatal}\n` };
      }
      return { exitCode: 0 };
    };
    const { spawnFn } = makeSpawnRecorder(router);

    const result = await bootStack({
      composeFiles: ["docker-compose.yml"],
      envOverrides: { OIDC_TENANT_CLAIM: "email_domain", OIDC_TENANT_MAPPING: "{not valid json" },
      expectExit: 78,
      scratchDir,
      scenarioId: "jit-malformed-boot",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      expectExitTimeoutMs: 500,
      expectExitIntervalMs: 25,
    });

    expect(result.exitCode).toBe(78);
    expect(result.stderr).toContain("FATAL oidc-jit-boot");
    expect(waitOk).not.toHaveBeenCalled();
  });

  it("detects a crash even when the poll keeps sampling the `running 0` window mid-restart (load race)", async () => {
    // A crash-looping container oscillates between `restarting ExitCode=78`
    // (backoff) and `running ExitCode=0` (the brief up-window before re-crash).
    // Under full-stack load the running-window widens and the poll can keep
    // sampling `running 0 <restartCount>0>` and miss the `restarting 78`
    // instant. The harness must still resolve: it remembers the last non-zero
    // exit and treats restartCount>0 as the definitive crash signal. This router
    // returns `restarting 78` ONCE (so lastNonZeroExit is captured) then
    // `running 0 7` forever — proving we don't hang waiting for another
    // `restarting` window.
    let inspectCalls = 0;
    const fatal = "FATAL oidc-jit-boot: OIDC_TENANT_MAPPING is not valid JSON. Refusing to boot";
    const router = (cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q") && args.includes("openwhispr")) {
        return { stdout: "" };
      }
      if (args.includes("ps") && args.includes("-aq") && args.some((a) => a.startsWith("api"))) {
        return { stdout: "deadbeefcafe\n" };
      }
      // compose ps --format json → never `exited` (restart-loop).
      if (args.includes("ps") && args.includes("--format")) {
        return { stdout: JSON.stringify({ Service: "api", State: "running", ExitCode: 0 }) };
      }
      if (cmd === "docker" && args[0] === "inspect") {
        inspectCalls += 1;
        // First inspect catches the `restarting 78` backoff window; every
        // subsequent inspect samples the `running 0` up-window (restartCount>0).
        return inspectCalls === 1 ? { stdout: "restarting 78 1\n" } : { stdout: "running 0 7\n" };
      }
      if (args.includes("logs") && args.includes("api")) {
        return { stdout: `${fatal}\n` };
      }
      return { exitCode: 0 };
    };
    const { spawnFn } = makeSpawnRecorder(router);

    const result = await bootStack({
      composeFiles: ["docker-compose.yml"],
      envOverrides: { OIDC_TENANT_CLAIM: "email_domain", OIDC_TENANT_MAPPING: "{not valid json" },
      expectExit: 78,
      scratchDir,
      scenarioId: "jit-malformed-load-race",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
      expectExitTimeoutMs: 500,
      expectExitIntervalMs: 25,
    });

    // Resolved to the remembered non-zero exit (78), not null — even though the
    // FIRST inspect already returns restarting/78, the point is the harness
    // returns the crash code and never hangs on the running-window samples.
    expect(result.exitCode).toBe(78);
  });
});

describe("bootStack — default scenario env-overrides (rate-limit propagation)", () => {
  // Source-of-truth: brief from orchestrator + memory `feedback_cjm_steps_need_unit_tests`.
  // Ad-hoc scenario stacks (e2e-cjm-byok-<hash>) spawned with their own slim
  // composeFiles inherit the rate-limit kill switch via two paths:
  //
  //   1. dev-tools overlay auto-appended to composeFiles unless the caller
  //      opted out via `disableRateLimitOverlayAutoInclude: true`.
  //   2. `OPENWHISPR_DISABLE_RATE_LIMIT=1` merged into envOverrides so the
  //      authored env-file carries the value as well (defence-in-depth).
  //
  // Without this, Better Auth's per-IP limiter starts returning 429 after
  // ~70 specs and the BYOK/auth-bearing follow-on scenarios cascade-fail.
  it("merges OPENWHISPR_DISABLE_RATE_LIMIT=1 into the authored env-file by default", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      // Caller passes a scenario-specific override; the rate-limit kill
      // switch MUST be merged in by the harness without the caller having
      // to remember to do it themselves.
      envOverrides: { S3_ENDPOINT: "https://s3.corp.example.com" },
      scratchDir,
      scenarioId: "default-overrides-merge",
      spawnFn,
      waitForReadinessFn: waitOk,
      inheritStdio: false,
      skipUserStackStop: true,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    expect(upCall, "expected an `up` call").toBeTruthy();
    const envPath = upCall?.args[upCall.args.indexOf("--env-file") + 1] as string;
    const contents = readFileSync(envPath, "utf8");
    // Caller-supplied override survives the merge.
    expect(contents).toMatch(/^S3_ENDPOINT=https:\/\/s3\.corp\.example\.com$/m);
    // Default rate-limit kill switch is injected by the harness.
    expect(contents).toMatch(/^OPENWHISPR_DISABLE_RATE_LIMIT=1$/m);
  });

  it("authors an env-file with the defaults even when caller passes no envOverrides", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      // No envOverrides — pre-fix this code path skipped --env-file entirely
      // and the scenario stack would NOT inherit the rate-limit kill switch.
      scratchDir,
      scenarioId: "no-caller-overrides",
      spawnFn,
      waitForReadinessFn: waitOk,
      inheritStdio: false,
      skipUserStackStop: true,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    expect(upCall?.joined).toMatch(/--env-file\s+\S+\.env\s+/);
    const envPath = upCall?.args[upCall.args.indexOf("--env-file") + 1] as string;
    expect(readFileSync(envPath, "utf8")).toMatch(/^OPENWHISPR_DISABLE_RATE_LIMIT=1$/m);
  });

  it("auto-appends the dev-tools overlay to scenario composeFiles", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      // Caller supplies a slim list that omits dev-tools (the BYOK pattern).
      composeFiles: ["docker-compose.yml", "compose/docker-compose.storage.yml"],
      scratchDir,
      scenarioId: "auto-overlay",
      spawnFn,
      waitForReadinessFn: waitOk,
      inheritStdio: false,
      skipUserStackStop: true,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    expect(upCall, "expected an `up` call").toBeTruthy();
    // The dev-tools overlay path MUST be in the argv as a `-f` operand.
    expect(upCall?.joined).toContain(`-f ${DEV_TOOLS_OVERLAY}`);
  });

  it("does NOT double-append the dev-tools overlay when caller already included it", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml", DEV_TOOLS_OVERLAY],
      scratchDir,
      scenarioId: "no-double-append",
      spawnFn,
      waitForReadinessFn: waitOk,
      inheritStdio: false,
      skipUserStackStop: true,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    const occurrences = upCall?.args.filter((a) => a === DEV_TOOLS_OVERLAY).length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("honours disableRateLimitOverlayAutoInclude opt-out (no overlay, no default overrides)", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await bootStack({
      composeFiles: ["docker-compose.yml"],
      disableRateLimitOverlayAutoInclude: true,
      scratchDir,
      scenarioId: "opt-out",
      spawnFn,
      waitForReadinessFn: waitOk,
      inheritStdio: false,
      skipUserStackStop: true,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    expect(upCall?.joined).not.toContain(DEV_TOOLS_OVERLAY);
    // Without caller-supplied envOverrides AND with opt-out, no --env-file
    // is authored (legacy pre-fix behaviour preserved).
    expect(upCall?.joined).not.toMatch(/--env-file/);
  });

  it("freezes the DEFAULT_SCENARIO_ENV_OVERRIDES constant to prevent mutation by callers", () => {
    expect(Object.isFrozen(DEFAULT_SCENARIO_ENV_OVERRIDES)).toBe(true);
    expect(DEFAULT_SCENARIO_ENV_OVERRIDES.OPENWHISPR_DISABLE_RATE_LIMIT).toBe("1");
  });
});

describe("tearStack — temp env file cleanup", () => {
  it("removes the temp env file authored during bootStack", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    const boot = await bootStack({
      composeFiles: ["docker-compose.yml"],
      envOverrides: { S3_ENDPOINT: "https://x.example.com" },
      scratchDir,
      scenarioId: "cleanup",
      spawnFn,
      waitForReadinessFn: waitOk,
      skipUserStackStop: true,
      inheritStdio: false,
    });

    const upCall = calls.find((c) => c.joined.includes(" up "));
    const envPath = upCall?.args[upCall.args.indexOf("--env-file") + 1] as string;
    expect(readFileSync(envPath, "utf8").length).toBeGreaterThan(0);

    await tearStack({
      composeFiles: ["docker-compose.yml"],
      spawnFn,
      skipUserStackRestart: true,
      inheritStdio: false,
      envFilePath: boot.envFilePath,
    });

    expect(() => readFileSync(envPath, "utf8")).toThrow();
  });

  it("auto-includes the dev-tools overlay in the `down` file set (matches bootStack → no leaked network)", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await tearStack({
      composeFiles: ["docker-compose.yml"],
      spawnFn,
      skipUserStackRestart: true,
      inheritStdio: false,
    });

    const downCall = calls.find((c) => c.joined.includes(" down "));
    expect(downCall, "expected a `down` call").toBeTruthy();
    // The down must list the dev-tools overlay (bootStack auto-includes it on
    // `up`); a mismatched file set leaves the project network behind.
    expect(downCall?.joined).toContain(DEV_TOOLS_OVERLAY);
  });

  it("does not double-add the dev-tools overlay when the caller already listed it", async () => {
    const router = (_cmd: string, args: string[]): FakeChildSpec => {
      if (args.includes("ps") && args.includes("-q")) return { stdout: "" };
      return { exitCode: 0 };
    };
    const { spawnFn, calls } = makeSpawnRecorder(router);

    await tearStack({
      composeFiles: ["docker-compose.yml", DEV_TOOLS_OVERLAY],
      spawnFn,
      skipUserStackRestart: true,
      inheritStdio: false,
    });

    const downCall = calls.find((c) => c.joined.includes(" down "));
    const occurrences = (downCall?.args ?? []).filter((a) => a === DEV_TOOLS_OVERLAY).length;
    expect(occurrences).toBe(1);
  });
});
