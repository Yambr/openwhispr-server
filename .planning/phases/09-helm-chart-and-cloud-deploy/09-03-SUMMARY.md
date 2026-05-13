---
phase: 09
plan: 03
subsystem: ci-gates
tags: [compose-parity, drift-detection, ci, helm]
status: complete
completed: 2026-05-13
duration_minutes: 15
tasks_completed: 2
commits:
  - 028cc4a: compose-chart parity lint driver + allowlist (DEPLOY-02)
  - caa5f13: wire compose-chart parity into helm-lint workflow
---

# Phase 9 Plan 3: Compose ↔ Chart Parity Lint Summary

`tools/lint-compose-chart-parity.ts` — TypeScript drift-detection gate — yaml-parses `docker-compose.yml` + load-test variants, runs `helm template` against the chart with `bundledAi.enabled=true`, extracts `Deployment` / `StatefulSet` / `Job` / `DaemonSet` / `CronJob` resource names, asserts a 1:1 mapping minus an allowlist. Wired into `.github/workflows/helm-lint.yml`. 23 vitest tests, coverage 97.33/96.15/90.9/96.92 — above the 90/90/90/90 gate.

## What landed

- `tools/lint-compose-chart-parity.ts` orchestrates: (a) yaml-parse compose union across 3 files; (b) shell out to `helm template` with `--set bundledAi.enabled=true` so conditional templates render; (c) parse helm output with `yaml.parseAllDocuments`; (d) extract `kind` ∈ `CHART_KINDS` resource names, stripping `ow-openwhispr-` release prefix; (e) compute `compose - chart - allowlist`; (f) exit 1 if anything left over.
- `tools/compose-chart-parity.allowlist.json` defines 5 categories with inline justification: `test-only`, `cluster-prereq`, `bundled-ai-conditional`, `load-test-only`, `wave-deferred`. The `wave-deferred` category contains explicit `REMOVE WHEN PLAN LANDS` markers tracing each entry to the wave that retires it (postgres → 09-04, pgbouncer/valkey/minio → 09-05, api/web/worker → 09-06, litellm/speaches → 09-07, migrate → 09-08).
- `.github/workflows/helm-lint.yml` gains: (a) parity lint step after `helm template`; (b) vitest coverage gate (≥ 90/90/90/90) for the driver. actionlint clean.
- pnpm scripts: `lint:compose-chart-parity` + `test:lint-compose-chart-parity` (added in 09-02 commit as forward-looking placeholder; now actively used).
- Smoke against current repo: 23 compose services, all allowlisted (chart skeleton has only ServiceAccount/Secret today), exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical] Production parity gate must also test the negative path on real repo.**
- **Found during:** Task 1 design.
- **Issue:** Plan calls for a fixture compose that adds an unallowed service to trigger nonzero exit. Vitest covers this via `main()` with injected mocks (test 2 in the integration suite). Real-repo smoke test confirms exit 0 against current state.
- **Fix:** Added 3 integration tests (`main` with mocked helm + mocked compose) covering PASS, FAIL-on-missing, and missing-allowlist-graceful paths. Plus a real-binary smoke test.

**2. [Rule 1 - Bug] Initial design used `existsSync` for both compose files AND allowlist with no injection point.**
- **Found during:** First vitest run — the "missing allowlist treated as empty" test passed only because both files were absent on disk.
- **Fix:** Added `exists?: (f: string) => boolean` opt to `MainOpts` so tests can simulate file presence independent of disk.

### Auth gates

None.

## Verification

- `pnpm exec tsx tools/lint-compose-chart-parity.ts` → exit 0; reports 23 compose services, 0 chart resources, 23 allowlisted, PASS.
- `pnpm test:lint-compose-chart-parity` → 23/23 pass, coverage 97.33/96.15/90.9/96.92.
- `actionlint .github/workflows/helm-lint.yml` → exit 0.

## Self-Check: PASSED

Files created:
- FOUND: tools/lint-compose-chart-parity.ts
- FOUND: tools/lint-compose-chart-parity.test.ts
- FOUND: tools/compose-chart-parity.allowlist.json

Files modified:
- FOUND: .github/workflows/helm-lint.yml (added parity + coverage steps)

Commits: FOUND 028cc4a, caa5f13.
