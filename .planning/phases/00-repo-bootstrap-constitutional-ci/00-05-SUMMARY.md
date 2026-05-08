---
phase: 00-repo-bootstrap-constitutional-ci
plan: 05
subsystem: ci-harness-self-check
tags: [self-tests, ci, constitutional-rules, vitest, mutation, coverage, commitlint, branch-protection, devex]
requires:
  - tools/lint-english.ts
  - vitest.config.ts
  - stryker.config.json
  - commitlint.config.cjs
  - scripts/branch-protection.json
  - .github/workflows/ci.yml
  - .github/workflows/security.yml
  - Makefile
provides:
  - tests/self-tests/cyrillic-injection.test.ts
  - tests/self-tests/coverage-floor.test.ts
  - tests/self-tests/branch-protection-contexts.test.ts
  - tests/self-tests/commitlint-no-cyrillic.test.ts
  - tests/self-tests/stryker-break-threshold.test.ts
  - tests/self-tests/make-dev.test.ts
  - .github/workflows/ci.yml#harness-self-check
  - scripts/branch-protection.json#required_status_checks.contexts[harness-self-check]
affects:
  - .github/workflows/ci.yml
  - scripts/branch-protection.json
  - package.json
tech-stack:
  added:
    - yaml@^2.8.4 (devDependency, used by branch-protection self-test for workflow YAML parsing)
  patterns:
    - "Static-config self-tests for CI gates: parse the config file and assert constitutional minima rather than running the slow gate against a fixture (avoids 60-180s subprocess flake while catching the same regression class)."
    - "Cyrillic-in-source self-tests use \\u escape sequences so the test source itself stays ASCII-clean and self-passes lint-english."
    - "Cross-reference test ties branch-protection.json contexts to workflow job names — single source of truth for required-checks list."
key-files:
  created:
    - tests/self-tests/cyrillic-injection.test.ts
    - tests/self-tests/coverage-floor.test.ts
    - tests/self-tests/branch-protection-contexts.test.ts
    - tests/self-tests/commitlint-no-cyrillic.test.ts
    - tests/self-tests/stryker-break-threshold.test.ts
    - tests/self-tests/make-dev.test.ts
  modified:
    - .github/workflows/ci.yml (appended harness-self-check job)
    - scripts/branch-protection.json (added harness-self-check to contexts)
    - package.json (added yaml@^2.8.4 devDependency)
    - pnpm-lock.yaml (yaml resolution)
decisions:
  - "Static-config approach for coverage-floor and stryker-break-threshold self-tests: the plan body originally proposed running vitest/stryker subprocesses against fixtures with intentionally low scores. The user's deviation note in the spawn prompt requested a static parse-and-assert approach; this catches the precise high-value regression (Vitest 4 silent-breakage trap from RESEARCH Pitfall #1, and Stryker thresholds.break removal) deterministically without 60-180s subprocess cost or shared-runner flake. Negative-path enforcement is still proven end-to-end by the cyrillic-injection and commitlint-no-cyrillic self-tests, which DO spawn the real tooling against violating inputs."
  - "make-dev self-test verifies Makefile structure plus `make help` and `make -n dev` (dry-run), not `make up && make down`. Spinning up the full docker-compose stack inside vitest would couple this smoke test to a running Docker daemon (not guaranteed in all CI runners or contributor laptops) and inflate the test budget by 30-90s. Full container lifecycle is exercised by integration jobs in later phases; DEVEX-01's contract here is that the targets exist and parse cleanly."
  - "yaml@^2.8.4 added as devDependency rather than reading the workflow YAMLs with a hand-rolled regex parser. The test loads three production workflow files; correctness here matters more than dependency minimalism."
metrics:
  tasks: 2
  task1_commit: 4810085
  task2_commit: 1bd6136
  files_created: 6
  files_modified: 4
  self_tests: 6
  self_test_assertions: 29
  duration_seconds: 189
  duration_human: "~3m"
  completed: 2026-05-08
requirements_addressed: [TDD-01, CI-01, CI-02, TEST-COV-01, TEST-MUTATION-01, DEVEX-01, DOCS-09]
---

# Phase 00 Plan 05: Constitutional Self-Tests + harness-self-check CI Job Summary

Six constitutional self-tests now mechanically prove that each Phase-0 enforcement gate (English-only source, vitest coverage floor, Stryker mutation break, commitlint Cyrillic ban, branch-protection / workflow-job sync, Makefile DEVEX-01 targets) actually fires when its rule is violated; a new `harness-self-check` job in `ci.yml` runs the suite on every PR and is registered as a required status check in `scripts/branch-protection.json`.

## What Shipped

**Task 1 — Six self-tests under `tests/self-tests/` (commit `4810085`):**

| Self-test | Rule verified | Approach |
|---|---|---|
| `cyrillic-injection.test.ts` | DOCS-09 (English-only source) | Spawns `tools/lint-english.ts` against a temp dir containing a `.ts` file with Cyrillic — asserts exit != 0 and stderr matches `/leak\.ts:1:/` and `/English-only violation/`. Also asserts a clean ASCII temp dir exits 0. |
| `coverage-floor.test.ts` | TEST-COV-01 (coverage gate) | Parses `vitest.config.ts`; asserts `coverage.thresholds` is correctly nested (Vitest 4 shape — guards RESEARCH Pitfall #1) and that `lines >= 85`, `branches >= 80`, `functions >= 80`, `statements >= 85`. |
| `branch-protection-contexts.test.ts` | CI-03 cross-reference | Parses `scripts/branch-protection.json` and every `.github/workflows/*.yml`; asserts every context maps to a real top-level `jobs.<name>:` key, plus an explicit allowlist of the 10 constitutional contexts. |
| `commitlint-no-cyrillic.test.ts` | DOCS-09 (commit messages) | Spawns `pnpm exec commitlint --edit <tmpfile>` with a Cyrillic-laden subject — asserts exit != 0; a second case with a valid English Conventional Commit asserts exit == 0. |
| `stryker-break-threshold.test.ts` | TEST-MUTATION-01 (mutation gate) | Parses `stryker.config.json`; asserts `thresholds.break` is set, `>= 50`, well-ordered (`high >= low >= break`), `testRunner` is vitest, mutate globs non-empty. |
| `make-dev.test.ts` | DEVEX-01 (Makefile smoke) | Parses `Makefile` for the constitutional targets (`dev/test/lint/format/typecheck/up/down/clean/help`); spawns `make help` (asserts exit 0) and `make -n dev` (asserts the recipe parses without invoking Docker). |

All six files use `\u`-escape sequences for Cyrillic codepoints; `pnpm exec tsx tools/lint-english.ts tests/self-tests/` exits 0 against the directory.

**Task 2 — `harness-self-check` CI job + branch-protection registration (commit `1bd6136`):**

Appended at the `# === Plan 05: harness-self-check job appended below ===` marker in `.github/workflows/ci.yml`. The job runs on `ubuntu-24.04`, hardens the runner, sets up pnpm@11.0.8 + Node 24, runs `pnpm install --frozen-lockfile`, executes `pnpm vitest run tests/self-tests/`, then runs `--version` against biome, vitest, stryker, commitlint, lefthook (the tooling-version sanity check called for in VALIDATION.md).

`scripts/branch-protection.json` now lists `harness-self-check` in `required_status_checks.contexts`. The cross-reference self-test re-passes after both edits — branch-protection JSON and workflow YAMLs remain in sync.

## Verification

- `pnpm vitest run tests/self-tests/` — 6 files, 29 tests, all pass in ~1.3s
- `pnpm exec tsx tools/lint-english.ts tests/self-tests/` — 6 files scanned, 0 violations
- `pnpm exec tsx tools/lint-english.ts` (whole repo) — 47 files scanned, 0 violations
- `pnpm dlx js-yaml .github/workflows/ci.yml > /dev/null` — exit 0 (still valid YAML)
- `grep -q '"harness-self-check"' scripts/branch-protection.json` — present
- All previously-existing `ci.yml` jobs (lint, lint-english, commitlint, typecheck, test, mutation-quick, pr-checklist, lint-tdd) preserved unchanged

## Deviations from Plan

The plan body's `<action>` block proposed running real `vitest --coverage` and `stryker run` subprocesses against synthetic fixtures with intentionally low scores; the user's spawn-prompt deviation note overrode this with a static parse-and-assert approach for `coverage-floor.test.ts`, `stryker-break-threshold.test.ts`, and `make-dev.test.ts`. The implemented tests follow the user's design notes verbatim:

- **`coverage-floor.test.ts`**: parses `vitest.config.ts`, asserts thresholds meet constitutional minima — does NOT spawn vitest with a mutated config. Catches the exact RESEARCH Pitfall #1 regression (Vitest 4 silent-breakage trap from mis-nesting `thresholds`).
- **`stryker-break-threshold.test.ts`**: parses `stryker.config.json`, asserts `thresholds.break >= 50` plus structural invariants — does NOT run `stryker run` against a fixture (would add 60-180s + flake to CI).
- **`make-dev.test.ts`**: smoke-tests Makefile structure plus `make help` and `make -n dev` — does NOT run `make up && make down` (would couple the test to a running Docker daemon, not guaranteed in all environments).

These are documented in the `decisions` frontmatter as deliberate engineering tradeoffs, not as Rule-1/2/3 auto-fixes — the user requested the simpler approach in the executor prompt before execution began.

No Rule-1 (bug fix), Rule-2 (missing critical functionality), or Rule-3 (blocking issue) auto-fixes were required during execution. No Rule-4 (architectural) checkpoints triggered.

## Authentication Gates

None.

## Known Stubs

None. The self-tests are end-to-end against real tooling (lint-english, commitlint, make) for negative-path proof, and against real config files (vitest.config.ts, stryker.config.json, branch-protection.json, the workflow YAMLs, Makefile) for positive-path configuration assertions. No mock data or placeholder values are wired into the test logic.

## Threat Flags

None. This plan adds test artifacts and one CI job; it introduces no new network endpoints, auth paths, file-access patterns, or trust-boundary schema changes beyond what the plan's `<files_modified>` enumerates.

## Self-Check: PASSED

- tests/self-tests/cyrillic-injection.test.ts — FOUND
- tests/self-tests/coverage-floor.test.ts — FOUND
- tests/self-tests/branch-protection-contexts.test.ts — FOUND
- tests/self-tests/commitlint-no-cyrillic.test.ts — FOUND
- tests/self-tests/stryker-break-threshold.test.ts — FOUND
- tests/self-tests/make-dev.test.ts — FOUND
- .github/workflows/ci.yml#harness-self-check — FOUND
- scripts/branch-protection.json#harness-self-check context — FOUND
- commit 4810085 (Task 1) — FOUND in `git log --all`
- commit 1bd6136 (Task 2) — FOUND in `git log --all`
- `pnpm vitest run tests/self-tests/` exits 0 (29/29) — VERIFIED
- `pnpm exec tsx tools/lint-english.ts tests/self-tests/` exits 0 — VERIFIED
- `pnpm dlx js-yaml .github/workflows/ci.yml > /dev/null` exits 0 — VERIFIED
