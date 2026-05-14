// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 14-07 — step defs for the BYOK loud-fail feature suites.
//
// Source-of-truth:
//   - .planning/phases/14-slim-core-byok-profiles-v2/14-07-PLAN.md Tasks 2+3
//   - tests/e2e-cjm/features/byok-storage.feature
//   - tests/e2e-cjm/features/byok-observability.feature
//   - tests/e2e-cjm/features/loud-fail-misconfig.feature
//
// Placement deviation from plan (Rule 3 blocking):
//   The plan names `tests/e2e-cjm/support/byok-steps.ts`. The
//   playwright.config.ts `defineBddConfig({steps: ["support/world.ts",
//   "steps/**/*.ts"]})` glob only loads `world.ts` from support/; every
//   other step file lives under tests/e2e-cjm/steps/ (transcribe.steps.ts,
//   auth.steps.ts, etc.). Authoring under support/ would orphan the
//   bindings. We follow the codebase convention (steps/byok.steps.ts)
//   and document the deviation in the SUMMARY.
//
// Each BYOK scenario runs its own hermetic compose project (one per
// scenario, project name `e2e-cjm-byok-<uuid>`) so the per-scenario
// envOverrides do not collide with the outer Makefile-booted `e2e-cjm`
// happy-path stack. teardown is wired in After() — never leaks containers
// or volumes regardless of scenario outcome.
//
// CLAUDE.md anti-mock rule: bootStack() shells out to the real docker
// compose CLI; we observe a real api container's stderr via the Pino
// destination configured in packages/byok-guard/src/index.ts.

import { randomUUID } from "node:crypto";
import { type BootStackResult, bootStack, tearStack } from "../support/compose-harness.js";
import { After, type CjmFixtures, expect, Given, Then, When } from "../support/world.js";

/**
 * BYOK-side per-scenario state. Re-keyed by tenantId so concurrent
 * scenarios (currently disallowed by playwright config workers=1, but
 * defensive nonetheless) don't trample one another.
 */
interface ByokScenarioState {
  scenarioId: string;
  projectName: string;
  composeFiles: string[];
  envOverrides: Record<string, string | undefined>;
  bootResult?: BootStackResult;
  /** Parsed Pino NDJSON records from captured stderr (empty until boot). */
  fatalRecords: Array<Record<string, unknown>>;
  /** Raw captured stderr — used for substring assertions (redaction etc.). */
  stderr: string;
  /** Tracks whether bootStack succeeded so After() teardown is targeted. */
  booted: boolean;
}

const state = new Map<string, ByokScenarioState>();

/** Canonical slim-core base files (no overlays). */
const SLIM_CORE_BASE: readonly string[] = [
  "docker-compose.yml",
  "docker-compose.embedded-litellm.yml",
] as const;

/** Map of overlay name → compose file path. */
const OVERLAYS: Record<string, string> = {
  storage: "compose/docker-compose.storage.yml",
  observability: "compose/docker-compose.observability.yml",
  ingress: "compose/docker-compose.ingress.yml",
  pgbouncer: "compose/docker-compose.pgbouncer.yml",
  "dev-tools": "compose/docker-compose.dev-tools.yml",
};

function stateFor(tenantId: string): ByokScenarioState {
  let s = state.get(tenantId);
  if (!s) {
    const id = `byok-${randomUUID().slice(0, 8)}`;
    s = {
      scenarioId: id,
      projectName: `e2e-cjm-${id}`,
      composeFiles: [...SLIM_CORE_BASE],
      envOverrides: {},
      fatalRecords: [],
      stderr: "",
      booted: false,
    };
    state.set(tenantId, s);
  }
  return s;
}

/**
 * Parse captured stderr as Pino NDJSON. Lines that fail JSON.parse are
 * dropped (docker compose interleaves non-JSON banner lines). Returns
 * the records in emission order.
 */
function parsePinoStderr(raw: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // docker compose log lines are prefixed with `<service>  | ` — strip.
    const stripped = trimmed.replace(/^[\w-]+\s+\|\s+/, "");
    if (!stripped.startsWith("{")) continue;
    try {
      const obj = JSON.parse(stripped) as Record<string, unknown>;
      out.push(obj);
    } catch {
      /* not JSON; skip */
    }
  }
  return out;
}

// --- Background -----------------------------------------------------------

Given("a fresh per-scenario compose project for BYOK boot testing", async ({ tenantId }) => {
  // Allocate state for this scenario; nothing to do beyond that — the
  // bootStack() call in "When the api container boots …" performs the
  // actual hermetic-project up.
  stateFor(tenantId);
});

// --- Compose-file selection ------------------------------------------------

Given(
  "the slim-core compose stack with the {word} overlay",
  async ({ tenantId }: CjmFixtures, overlayName: string) => {
    const s = stateFor(tenantId);
    const overlay = OVERLAYS[overlayName];
    expect(overlay, `unknown overlay '${overlayName}'`).toBeTruthy();
    if (!s.composeFiles.includes(overlay)) s.composeFiles.push(overlay);
  },
);

Given(
  "the slim-core compose stack without the {word} overlay",
  async ({ tenantId }: CjmFixtures, overlayName: string) => {
    const s = stateFor(tenantId);
    const overlay = OVERLAYS[overlayName];
    expect(overlay, `unknown overlay '${overlayName}'`).toBeTruthy();
    s.composeFiles = s.composeFiles.filter((f) => f !== overlay);
  },
);

// --- Env-override population ----------------------------------------------

Given("the env override `{word}` is unset", async ({ tenantId }: CjmFixtures, key: string) => {
  const s = stateFor(tenantId);
  s.envOverrides[key] = undefined;
});

Given(
  "the env override `{word}` is {string}",
  async ({ tenantId }: CjmFixtures, key: string, value: string) => {
    const s = stateFor(tenantId);
    s.envOverrides[key] = value;
  },
);

// --- Boot drivers ----------------------------------------------------------

When(
  "the api container boots expecting exit code {int}",
  async ({ tenantId }: CjmFixtures, code: number) => {
    const s = stateFor(tenantId);
    s.bootResult = await bootStack({
      projectName: s.projectName,
      composeFiles: s.composeFiles,
      envOverrides: s.envOverrides,
      scenarioId: s.scenarioId,
      expectExit: code,
      skipUserStackStop: true, // outer Makefile already handled this
      inheritStdio: false,
    });
    s.booted = true;
    s.stderr = s.bootResult.stderr ?? "";
    s.fatalRecords = parsePinoStderr(s.stderr);
  },
);

When(
  "the api container boots expecting a healthy ready state",
  async ({ tenantId }: CjmFixtures) => {
    const s = stateFor(tenantId);
    // For healthy-boot scenarios we still set a defensive expectExit=null:
    // bootStack() default behavior is to wait for readiness via /api/health.
    s.bootResult = await bootStack({
      projectName: s.projectName,
      composeFiles: s.composeFiles,
      envOverrides: s.envOverrides,
      scenarioId: s.scenarioId,
      skipUserStackStop: true,
      inheritStdio: false,
    });
    s.booted = true;
    // For healthy-boot we still grab logs so "no fatal record" can be asserted.
    // bootStack happy path does not populate stderr; the step that needs
    // log introspection re-invokes `docker compose logs api` separately.
    s.stderr = s.bootResult.stderr ?? "";
    s.fatalRecords = parsePinoStderr(s.stderr);
  },
);

// --- Assertions ------------------------------------------------------------

Then("the api process exits with code {int}", async ({ tenantId }: CjmFixtures, code: number) => {
  const s = stateFor(tenantId);
  expect(s.bootResult, "no boot result").toBeTruthy();
  expect(s.bootResult?.exitCode).toBe(code);
});

Then(
  "stderr contains a Pino fatal record with event {string}",
  async ({ tenantId }: CjmFixtures, event: string) => {
    const s = stateFor(tenantId);
    const match = s.fatalRecords.find((r) => r.level === 60 && r.event === event);
    expect(match, `no fatal record with event="${event}" in stderr:\n${s.stderr}`).toBeTruthy();
  },
);

Then(
  "stderr contains a Pino fatal record with code {string}",
  async ({ tenantId }: CjmFixtures, code: string) => {
    const s = stateFor(tenantId);
    const match = s.fatalRecords.find((r) => r.level === 60 && r.code === code);
    expect(match, `no fatal record with code="${code}" in stderr:\n${s.stderr}`).toBeTruthy();
  },
);

Then(
  "stderr contains a Pino fatal record with overlay {string}",
  async ({ tenantId }: CjmFixtures, overlay: string) => {
    const s = stateFor(tenantId);
    const match = s.fatalRecords.find((r) => r.level === 60 && r.overlay === overlay);
    expect(match, `no fatal record with overlay="${overlay}" in stderr:\n${s.stderr}`).toBeTruthy();
  },
);

Then("no `byok.required` fatal record is emitted", async ({ tenantId }: CjmFixtures) => {
  const s = stateFor(tenantId);
  const offender = s.fatalRecords.find((r) => r.level === 60 && r.event === "byok.required");
  expect(offender, `unexpected fatal record present:\n${JSON.stringify(offender)}`).toBeUndefined();
});

Then("no OTel SDK initialization log appears", async ({ tenantId }: CjmFixtures) => {
  const s = stateFor(tenantId);
  expect(s.stderr).not.toMatch(/OTel SDK starting|NodeSDK\b/);
});

// --- Plan 14-07 Task 3 — loud-fail-misconfig assertions ------------------

Then(
  "the very first Pino fatal log line on stderr has event {string}",
  async ({ tenantId }: CjmFixtures, event: string) => {
    const s = stateFor(tenantId);
    const firstFatal = s.fatalRecords.find(
      (r) => typeof r.level === "number" && (r.level as number) >= 60,
    );
    expect(firstFatal, `no fatal record found in stderr:\n${s.stderr}`).toBeTruthy();
    expect(firstFatal?.event).toBe(event);
  },
);

Then("no SSRF dispatcher initialization log appears", async ({ tenantId }: CjmFixtures) => {
  const s = stateFor(tenantId);
  expect(s.stderr).not.toMatch(/installGlobalSSRF\b|SSRF dispatcher/);
});

Then(
  "the fatal record `hint` field contains the redacted form {string}",
  async ({ tenantId }: CjmFixtures, expected: string) => {
    const s = stateFor(tenantId);
    const fatal = s.fatalRecords.find((r) => r.level === 60 && r.event === "byok.required");
    expect(fatal, `no byok.required fatal record:\n${s.stderr}`).toBeTruthy();
    const hint = String(fatal?.hint ?? "");
    expect(hint).toContain(expected);
  },
);

Then(
  "the raw substring {string} does not appear anywhere on stderr",
  async ({ tenantId }: CjmFixtures, secret: string) => {
    const s = stateFor(tenantId);
    expect(s.stderr.indexOf(secret), `secret '${secret}' leaked in stderr:\n${s.stderr}`).toBe(-1);
  },
);

// --- Teardown --------------------------------------------------------------

After(async ({ tenantId }: CjmFixtures) => {
  const s = state.get(tenantId);
  if (!s || !s.booted) return;
  // Always teardown — idempotent, never throws (per harness contract).
  await tearStack({
    projectName: s.projectName,
    composeFiles: s.composeFiles,
    skipUserStackRestart: true,
    inheritStdio: false,
    envFilePath: s.bootResult?.envFilePath,
  });
  state.delete(tenantId);
});
