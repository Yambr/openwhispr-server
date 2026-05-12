---
phase: 08-load-test-tuning-slo-publication
plan: 02
subsystem: load-test
tags: [load-test, k6, scaffold, tdd]
requires: []
provides:
  - "@openwhispr/load-test workspace package"
  - "scenario-picker (weighted RNG over locked 50/25/15/10 mix)"
  - "provisionUsers() pure function (k6 setup() core)"
  - "extractBearer / updateBearer (Better Auth rotation helpers)"
  - "verify-compose.sh argument-parsing validator"
  - "fd-probe.test.sh contract harness for plan 04"
affects:
  - pnpm-workspace.yaml
tech-stack:
  added: ["@types/k6@^1.3.0"]
  patterns: ["pure-fn-extracted-from-k6-runtime", "RNG-injection-for-deterministic-tests"]
key-files:
  created:
    - tools/load-test/package.json
    - tools/load-test/tsconfig.json
    - tools/load-test/tsup.config.ts
    - tools/load-test/vitest.config.ts
    - tools/load-test/src/main.ts
    - tools/load-test/src/scenario-picker.ts
    - tools/load-test/src/scenario-picker.test.ts
    - tools/load-test/src/setup.ts
    - tools/load-test/src/setup.test.ts
    - tools/load-test/src/utils/auth.ts
    - tools/load-test/src/utils/auth.test.ts
    - tools/load-test/src/utils/http.ts
    - tools/load-test/src/utils/http.test.ts
    - tools/load-test/scripts/verify-compose.sh
    - tools/load-test/scripts/verify-compose.test.sh
    - tools/load-test/scripts/fd-probe.test.sh
    - tools/load-test/README.md
  modified:
    - pnpm-workspace.yaml
key-decisions:
  - "Substituted @types/k6 for @grafana/k6-types (the latter does not exist on npm) — Rule 3 blocking dependency."
  - "Email uniqueness across provisionUsers() invocations enforced via Date.now() + monotonic counter so fast back-to-back vitest runs do not collide."
  - "k6 setup() runtime wrapper carved out from coverage with c8 ignore so the pure provisionUsers() core can hold the 90/90/90/90 threshold without the k6-only globals.process branch dragging it down."
metrics:
  duration_min: 6
  completed: 2026-05-12
  tasks_total: 3
  tasks_complete: 3
  commits: 6
  tests_added: 25
---

# Phase 8 Plan 02: Load-Test Scaffold Summary

Stood up `@openwhispr/load-test` workspace with the TDD-tested helpers
the k6 load test will consume (scenario picker, setup() user
provisioner, bearer-rotation helpers, base HTTP constants) plus the
two CI shell harnesses (`verify-compose.sh` argument parser and
`fd-probe.test.sh` contract harness for plan 04). Six RED→GREEN commit
pairs, 18 vitest cases, 7 shell-test cases, coverage 93.47/90/100/93.18
on the diff.

## What Shipped

| Surface | File | Coverage |
|---|---|---|
| Workspace scaffold | `tools/load-test/{package,tsconfig,tsup,vitest}.{json,ts}` | n/a |
| Scenario picker | `src/scenario-picker.ts` (51 LOC) | 90.9 / 100 / 100 / 90 |
| setup() provisioner | `src/setup.ts` (134 LOC, k6 wrapper c8-ignored) | 91.66 / 85.71 / 100 / 91.3 |
| Bearer rotation | `src/utils/auth.ts` (32 LOC) | 100 / 100 / 100 / 100 |
| HTTP constants | `src/utils/http.ts` (29 LOC) | 100 / 100 / 100 / 100 |
| Compose validator | `scripts/verify-compose.sh` + test | 4 shell cases pass |
| fd-probe harness | `scripts/fd-probe.test.sh` | 3 shell cases pass |

Aggregate diff coverage: **93.47% statements, 90% branches, 100% functions, 93.18% lines** (≥ 90/90/90/90 floor met).

## Verification

```sh
pnpm --filter @openwhispr/load-test test:coverage  # 18 passed, 90/90/90/90 cleared
pnpm --filter @openwhispr/load-test typecheck       # clean
pnpm --filter @openwhispr/load-test build           # dist/main.js 109 B
bash tools/load-test/scripts/verify-compose.test.sh # 4/4 pass
bash tools/load-test/scripts/fd-probe.test.sh       # 3/3 pass
```

## Commits

| Hash | Message |
|---|---|
| `a98a5ad` | test(08-02): add failing scenario picker weighted distribution |
| `ae06634` | feat(08-02): implement scenario picker for locked 50/25/15/10 mix |
| `cb51937` | test(08-02): add failing tests for setup() and auth/http utils |
| `56038ba` | feat(08-02): implement setup() provisioner and auth/http utils |
| `a351746` | test(08-02): add failing shell harnesses for verify-compose and fd-probe |
| `5db1e93` | feat(08-02): implement verify-compose.sh argument-parsing validator |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking dependency] Substituted `@types/k6` for `@grafana/k6-types`**
- **Found during:** Task 1 `pnpm install`
- **Issue:** `@grafana/k6-types` is not published to npm (`ERR_PNPM_FETCH_404`). The plan referenced it but the maintained community package is `@types/k6` (Grafana k6 docs link to it).
- **Fix:** Updated `tools/load-test/package.json` devDeps and `tsconfig.json#compilerOptions.types` to `@types/k6`.
- **Files modified:** `tools/load-test/package.json`, `tools/load-test/tsconfig.json`
- **Commit:** captured in `a98a5ad` (RED commit; included scaffold infra).

**2. [Rule 2 — Email-uniqueness safety] Monotonic counter alongside `Date.now()`**
- **Found during:** Task 2 writing the "fresh emails across invocations" test.
- **Issue:** A timestamp-only suffix collides under fast back-to-back vitest runs (sub-millisecond gap). Without a counter the uniqueness test would be flaky.
- **Fix:** Added a module-level counter combined with `Date.now()` in the email stamp.
- **Files modified:** `tools/load-test/src/setup.ts`
- **Commit:** `56038ba`.

**3. [Observation — not a fix] Plan 03 files swept into 08-02 commits by lefthook**
- **Found during:** Tasks 1 & 3 commits.
- **Issue:** The pre-commit `biome … {staged_files}` runs with `stage_fixed: true`, and on this branch plan 03 had untracked files (`compose/mock-litellm/*`) in the worktree. Biome formatted them, lefthook staged the formatted versions, and they rode along on my `git add` despite my targeted path arguments. The files belong to plan 03; they did not cause failures and plan 03's parallel commits added/will add their own copies in a separate stream.
- **Action:** None — out-of-scope to revert without disturbing plan 03's concurrent work. Documented for the verifier.

### Plan Stretches

None. The three tasks executed exactly as scoped.

## Known Stubs

- `tools/load-test/src/main.ts` exports `PLACEHOLDER` only. This is intentional and explicitly called out in the plan: Wave 2 / Plan 06 wires the k6 `default` export, `options`, and scenario routing on top of this entry. The `main.ts` file is excluded from vitest coverage for this reason.
- The k6 runtime wrapper in `src/setup.ts` (the `setup()` thin function below the `/* c8 ignore start */` line) is intentionally not unit-tested — its execution context is the k6 VM. The pure `provisionUsers()` core that does the actual work is fully covered.
- `scripts/verify-compose.sh` cannot yet validate a real compose profile because the `load-test-mock` / `load-test-realistic` profiles land in Wave 1 / Plan 05. This is by design — the plan ships argument-parsing only in Wave 0.
- `scripts/fd-probe.test.sh` runs against in-test stubs in Wave 0 because the real `apps/api/scripts/fd-probe.sh` is owned by Plan 04. The harness already supports `FD_PROBE_PATH` override so plan 04 can re-run it against the real probe with zero changes here.

## Self-Check

- [x] `tools/load-test/package.json` exists
- [x] `tools/load-test/src/scenario-picker.ts` exists
- [x] `tools/load-test/src/setup.ts` exists
- [x] `tools/load-test/src/utils/auth.ts` exists
- [x] `tools/load-test/src/utils/http.ts` exists
- [x] `tools/load-test/scripts/verify-compose.sh` exists (executable)
- [x] `tools/load-test/scripts/fd-probe.test.sh` exists (executable)
- [x] `pnpm-workspace.yaml` registers `tools/load-test`
- [x] Commits `a98a5ad`, `ae06634`, `cb51937`, `56038ba`, `a351746`, `5db1e93` all present in `git log`
- [x] `pnpm --filter @openwhispr/load-test test:coverage` clears 90/90/90/90
- [x] `pnpm --filter @openwhispr/load-test typecheck` clean
- [x] `pnpm --filter @openwhispr/load-test build` produces `dist/main.js`

## Self-Check: PASSED
