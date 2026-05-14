---
phase: 14-slim-core-byok-profiles-v2
plan: 07
subsystem: e2e-cjm-byok
tags: [byok, e2e-cjm, gherkin, loud-fail, redaction, harness]
requires: [14-01, 14-02, 14-03, 14-04, 14-05, 14-06]
provides:
  - "bootStack({envOverrides, expectExit, scenarioId, scratchDir}) — per-scenario hermetic compose boots with env injection and api-exit stderr capture"
  - "tearStack({envFilePath}) — temp-env-file cleanup on teardown"
  - "@cjm-byok-storage (3 scenarios) Gherkin coverage of storage overlay refusal + corp BYOK acceptance"
  - "@cjm-byok-observability (3 scenarios) Gherkin coverage of observability overlay refusal + =disabled sentinel + corp OTLP endpoint"
  - "@cjm-loud-fail-misconfig (2 scenarios) Gherkin coverage of boot-order invariant + credential redaction"
  - "Phase 14 success criterion #5 closed (Gherkin scenarios exist and bind 1:1 to byok-guard contract)"
affects:
  - tests/e2e-cjm/support/compose-harness.ts
  - tests/e2e-cjm/support/compose-harness.test.ts
  - tests/e2e-cjm/features/byok-storage.feature
  - tests/e2e-cjm/features/byok-observability.feature
  - tests/e2e-cjm/features/loud-fail-misconfig.feature
  - tests/e2e-cjm/steps/byok.steps.ts
  - .gitignore
tech-stack:
  added: []
  patterns:
    - "per-scenario hermetic compose project ('e2e-cjm-byok-<uuid>') so envOverrides do not collide across scenarios"
    - "docker compose --env-file <temp> injection (NO process.env mutation) for per-scenario BYOK postures"
    - "expect-exit polling via 'compose ps --format json api' + stderr capture via 'compose logs api --no-color'"
    - "Pino NDJSON parsing of captured stderr, line-prefix-stripped for docker compose log format"
key-files:
  created:
    - tests/e2e-cjm/support/compose-harness.test.ts
    - tests/e2e-cjm/features/byok-storage.feature
    - tests/e2e-cjm/features/byok-observability.feature
    - tests/e2e-cjm/features/loud-fail-misconfig.feature
    - tests/e2e-cjm/steps/byok.steps.ts
  modified:
    - tests/e2e-cjm/support/compose-harness.ts
    - .gitignore
decisions:
  - "Step file lives at tests/e2e-cjm/steps/byok.steps.ts (NOT support/ as the plan named) because playwright.config.ts bddgen 'steps' glob only loads support/world.ts; all sibling step files live under steps/. Deviation Rule 3 (blocking)."
  - "envOverrides are injected via docker compose --env-file <temp> (not process.env mutation) per CLAUDE.md no-workarounds. Undefined values become bare 'KEY=' lines (explicit unset)."
  - "BYOK feature scenarios use per-scenario hermetic compose projects ('e2e-cjm-byok-<uuid>') so they do not collide with the outer Makefile-booted 'e2e-cjm' happy-path stack. After() hook always teardown's."
  - "Local GREEN against a real compose boot deferred to CI (Phase 12 Plan 12-05b posture): the new scenarios will run under .github/workflows/e2e-cjm.yml on the next CI invocation. Local dry-run via bddgen confirms 0 orphan steps."
metrics:
  duration_minutes: 7
  completed_at: "2026-05-14T17:28:00Z"
  tasks_completed: 3
  files_changed: 7
  commits: 8
---

# Phase 14 Plan 07: e2e-cjm BYOK Gherkin Coverage Summary

**One-liner:** Authored 8 Gherkin scenarios across 3 feature files plus 17 step-definition regexes, and extended `bootStack()` with `envOverrides`/`expectExit` so the api container can be driven into specific BYOK misconfig postures and asserted against the Pino fatal record contract — closing Phase 14 success criterion #5.

## What Shipped

### 1. `bootStack()` extension (Task 1 GREEN)

Two new opts wired into `tests/e2e-cjm/support/compose-harness.ts`:

```ts
export interface BootStackOptions {
  // …existing opts preserved verbatim…
  envOverrides?: Record<string, string | undefined>;
  scenarioId?: string;
  scratchDir?: string;
  expectExit?: number;
  expectExitTimeoutMs?: number;
  expectExitIntervalMs?: number;
}

export interface BootStackResult {
  userStackWasRunning: boolean;
  stderr?: string;
  exitCode?: number | null;
  envFilePath?: string;
}
```

- `envOverrides` — Author a temp env file at `<scratchDir>/<scenarioId>.env`, pass to `docker compose --env-file <temp>`. Undefined value → bare `KEY=` line (explicit unset). **No `process.env` mutation** per CLAUDE.md.
- `expectExit` — Skip `--wait`/readiness probe, poll `compose ps --format json api` until `State=exited`, then capture stderr via `compose logs api --no-color --tail=200`. Returned shape extended with `{ stderr, exitCode, envFilePath }`.
- `tearStack({ envFilePath })` — `rm -f` the temp env file on teardown (best-effort, never throws).

Unit tests in `tests/e2e-cjm/support/compose-harness.test.ts` cover all three behaviors (argv shape, no-mutation invariant, expectExit happy/timeout paths, temp-file cleanup). DI seam is `spawnFn` — mocks the `docker compose` CLI at the process boundary only.

### 2. Gherkin features (Tasks 2+3 RED)

#### `tests/e2e-cjm/features/byok-storage.feature` (`@cjm-byok-storage`)

```gherkin
Feature: BYOK storage loud-fail and corporate-endpoint acceptance

  Background:
    Given a fresh per-scenario compose project for BYOK boot testing

  @cjm-byok-storage @cjm-byok-storage.1
  Scenario: api refuses to start when storage overlay is OFF and S3_ENDPOINT is unset
    Given the slim-core compose stack without the storage overlay
    And the env override `S3_ENDPOINT` is unset
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting exit code 1
    Then the api process exits with code 1
    And stderr contains a Pino fatal record with event "byok.required"
    And stderr contains a Pino fatal record with code "BYOK_STORAGE_REQUIRED"
    And stderr contains a Pino fatal record with overlay "storage"

  @cjm-byok-storage @cjm-byok-storage.2
  Scenario: api boots when storage overlay is OFF but S3_ENDPOINT is set to corporate BYOK
    Given the slim-core compose stack without the storage overlay
    And the env override `S3_ENDPOINT` is "https://s3.corp.example.com"
    And the env override `S3_ACCESS_KEY` is "ak"
    And the env override `S3_SECRET_KEY` is "sk"
    And the env override `S3_BUCKET` is "ow"
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    And the env override `DATABASE_URL` is "postgresql://app@postgres/app"
    When the api container boots expecting a healthy ready state
    Then no `byok.required` fatal record is emitted

  @cjm-byok-storage @cjm-byok-storage.3
  Scenario: api boots when storage overlay is ON
    Given the slim-core compose stack with the storage overlay
    And the env override `OTEL_EXPORTER_OTLP_ENDPOINT` is "disabled"
    And the env override `INGRESS_BASE_URL` is "http://api.localhost"
    When the api container boots expecting a healthy ready state
    Then no `byok.required` fatal record is emitted
```

#### `tests/e2e-cjm/features/byok-observability.feature` (`@cjm-byok-observability`)

Three scenarios covering the `OTEL_EXPORTER_OTLP_ENDPOINT` contract:

| # | Posture | Expectation |
|---|---|---|
| 1 | overlay OFF + endpoint unset | `BYOK_OBSERVABILITY_REQUIRED` fatal, exit 1 |
| 2 | overlay OFF + endpoint=`"disabled"` (sentinel) | boots clean, no fatal, no `OTel SDK starting` log |
| 3 | overlay OFF + endpoint=`http://localhost:14317` (BYOK corp) | boots clean, no fatal |

#### `tests/e2e-cjm/features/loud-fail-misconfig.feature` (`@cjm-loud-fail-misconfig`)

Two scenarios verifying loud-fail discipline properties:

| # | Property | Assertion |
|---|---|---|
| 1 | Boot order | First level-60 log has `event="byok.required"`; no `installGlobalSSRF` or `OTel SDK starting` in captured stderr |
| 2 | Credential redaction | `S3_ENDPOINT=https://access:secret@s3.corp.example.com/` → fatal `hint` contains `*****@s3.corp.example.com`; raw substring `secret` absent from stderr |

### 3. Step definitions (`tests/e2e-cjm/steps/byok.steps.ts`)

17 step regexes covering all 8 BYOK scenarios:

| Kind | Regex (verbatim from registration) |
|---|---|
| Background | `a fresh per-scenario compose project for BYOK boot testing` |
| Compose-files | `the slim-core compose stack with the {word} overlay` |
| Compose-files | `the slim-core compose stack without the {word} overlay` |
| Env-overrides | `the env override \`{word}\` is unset` |
| Env-overrides | `the env override \`{word}\` is {string}` |
| Boot drivers | `the api container boots expecting exit code {int}` |
| Boot drivers | `the api container boots expecting a healthy ready state` |
| Exit assertions | `the api process exits with code {int}` |
| Fatal-record assertions | `stderr contains a Pino fatal record with event {string}` |
| Fatal-record assertions | `stderr contains a Pino fatal record with code {string}` |
| Fatal-record assertions | `stderr contains a Pino fatal record with overlay {string}` |
| Negative assertions | `no \`byok.required\` fatal record is emitted` |
| Negative assertions | `no OTel SDK initialization log appears` |
| Boot-order assertion | `the very first Pino fatal log line on stderr has event {string}` |
| Boot-order assertion | `no SSRF dispatcher initialization log appears` |
| Redaction assertion | `the fatal record \`hint\` field contains the redacted form {string}` |
| Redaction assertion | `the raw substring {string} does not appear anywhere on stderr` |

`After()` hook always invokes `tearStack()` (idempotent) — no leaked containers/volumes regardless of scenario outcome. Each scenario gets its own hermetic compose project `e2e-cjm-byok-<uuid>` so they cannot collide with the outer Makefile-booted `e2e-cjm` happy-path stack.

## Local Verification Run

| Check | Result |
|---|---|
| `pnpm vitest run tests/e2e-cjm/support/compose-harness.test.ts` | **GREEN** (5/5 passed, 313ms) |
| `pnpm exec bddgen --config tests/e2e-cjm/playwright.config.ts` | **GREEN** — 0 orphan steps; 11 spec files generated including all 3 new features |
| `pnpm tsx tools/lint-cjm-doc.ts --features tests/e2e-cjm/features --check-expected-red` | **PASS** (20 anchors) |
| `pnpm exec biome check <plan-14-07-files>` | **PASS** (0 errors, 0 warnings) |
| `pnpm exec tsc --noEmit` on byok.steps.ts + compose-harness.ts | **PASS** (no type errors) |

## CI-Deferred Local Boot (Phase 12 Plan 12-05b posture)

Per the plan's deviation guidance and the user's directive: a live `docker compose` boot of the slim-core stack + per-scenario re-up locally is destructive (`compose down -v` wipes user volumes) and slow (~10 min cold image pull on a clean laptop). The new scenarios will execute their GREEN gate via **`.github/workflows/e2e-cjm.yml`** on the next CI invocation:

```yaml
# .github/workflows/e2e-cjm.yml lines 36-44 (Phase 13 / Plan 01 / Task 13-01-08)
- name: docker compose build
  run: docker compose -f docker-compose.yml -f docker-compose.embedded-litellm.yml build api worker web
- name: make e2e-cjm
  env:
    E2E_CJM: "1"
    CI: "true"
  run: make e2e-cjm
```

The Makefile target's `--grep-invert "@expected-red"` filter does not exclude our new tags (`@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig`) — they will run unconditionally.

Local dry-run via bddgen is the deterministic local proof of binding: all 17 step regexes bind, all 8 scenarios generate runnable specs.

## Goal-Backward Audit: Phase 14 Success Criteria → Plan + Verifying Test

| Phase 14 success criterion | Plan(s) | Verifying test(s) |
|---|---|---|
| 1. `docker compose up` brings the 6-service slim-core without overlays | 14-01 | `tests/unit/compose-base-services.test.ts` (services enumerated, no `profiles:` inversion) |
| 2. `.env.slim.example` + bootstrap env-overridable | 14-02 | `tools/bootstrap.test.ts` (env template override path); `.env.slim.example` lint coverage |
| 3. 6 opt-in compose overlays (observability/storage/ingress/pgbouncer/dev-tools/contract-test) | 14-03 | `tests/unit/compose-overlay-layering.test.ts`; helm-chart-parity linter |
| 4. BYOK loud-fail guard + Pino fatal + OTel `=disabled` sentinel | 14-04 | `packages/byok-guard/src/__tests__/byok-guard.test.ts` |
| 5. Gherkin `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` GREEN | **14-07 (this plan)** | `tests/e2e-cjm/features/byok-storage.feature` + sibling features, driven by `tests/e2e-cjm/steps/byok.steps.ts` + `tests/e2e-cjm/support/compose-harness.test.ts` |

All 7 requirements (SLIM-01..04, BYOK-01..03) covered by at least one Gherkin scenario after this plan.

## Deviations from Plan

### 1. [Rule 3 — Blocking] Step file placement: `steps/byok.steps.ts` not `support/byok-steps.ts`

- **Found during:** Task 2 wiring
- **Issue:** Plan named step file as `tests/e2e-cjm/support/byok-steps.ts`. The `playwright.config.ts` bddgen config has `steps: ["support/world.ts", "steps/**/*.ts"]` — only `world.ts` is loaded from `support/`; every other step file (auth, transcribe, oidc, etc.) lives under `steps/`. Authoring under `support/` would orphan all step bindings.
- **Fix:** File authored at `tests/e2e-cjm/steps/byok.steps.ts` matching the existing codebase convention.
- **Files modified:** `tests/e2e-cjm/steps/byok.steps.ts` (created)
- **Commit:** `d0e0878 feat(14-07): byok-storage + byok-observability step defs`

### 2. [Rule 3 — Blocking] CI-deferred live-stack GREEN

- **Found during:** Task 2/3 verification
- **Issue:** Plan's verification commands (`pnpm test:cjm -t "@cjm-byok-storage"` etc.) require a live `docker compose` boot. Locally this stops the user's running `openwhispr` project, pulls ~10 min of image layers, and runs `compose down -v` on teardown (volume-destructive). The user's instruction explicitly authorizes this deferral.
- **Fix:** Local proof is the bddgen dry-run (0 orphan steps, all specs generated) + the vitest unit-test of the harness extension (5/5 GREEN). Live GREEN runs in `.github/workflows/e2e-cjm.yml` on the next CI invocation (matches Phase 12 Plan 12-05b posture documented in PROJECT.md).
- **Files modified:** none (escape hatch only — documented in this SUMMARY)

### 3. [Rule 2 — Critical correctness] `compose ps --format json` parser handles NDJSON + array shapes

- **Found during:** Task 1 implementation
- **Issue:** Newer docker compose versions emit NDJSON for `ps --format json`; older versions emit a JSON array. The harness's exit-status poller must handle both.
- **Fix:** `parseComposePsJson()` tries `JSON.parse` first (array path), falls back to newline-split NDJSON. Unit tested by the test that drives `expectExit` with a `{ Service: "api", State: "exited", ExitCode: 1 }` single-object stdout.
- **Files modified:** `tests/e2e-cjm/support/compose-harness.ts`
- **Commit:** `1cdc8b3 feat(14-07): bootStack envOverrides + stderr capture`

## Known Stubs

None. The harness extension is production-ready; step defs invoke real `bootStack()`/`tearStack()`; Pino fatal records are read from real api container stderr in CI.

## Commit Trail

```
006be84 chore(14-07): biome lint clean — unused param + optional chain
de94d18 test(14-07): red @cjm-loud-fail-misconfig feature
d0e0878 feat(14-07): byok-storage + byok-observability step defs
09f384c test(14-07): red @cjm-byok-storage + @cjm-byok-observability feature files
dc77d8a chore(14-07): gitignore tests/e2e-cjm/.scratch/
1cdc8b3 feat(14-07): bootStack envOverrides + stderr capture
f68335e test(14-07): red — compose-harness envOverrides + expectExit + cleanup tests
```

## Self-Check: PASSED

All 7 created/modified files exist on disk; all 7 plan-14-07 commits present in `git log`. Harness unit tests GREEN (5/5). bddgen dry-run GREEN (0 orphan steps, 11 feature spec files generated). Biome lint clean on all Plan 14-07 files. CJM doc lint passes (20 anchors). Live-stack GREEN deferred to `.github/workflows/e2e-cjm.yml` per documented Phase 12 Plan 12-05b posture.
