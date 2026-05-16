# Phase 21 — CONTEXT

**Date:** 2026-05-16
**Mode:** Self-authored from `~/.claude/plans/mellow-watching-hinton.md` (no separate discuss session — the plan IS the spec).
**Phase boundary:** ROADMAP "Phase 21: Anti-shortcut Locker Infrastructure (CRITICAL — must land before any other Phase 22+)" — ship 5 new linters wired into pre-commit + CI + branch-protection so future agents cannot ship `.skip`/`.only` Gherkin, `retries > 0`, untested step files, `[test-fix]` PRs that edit production code, or per-phase coverage below 90/90/90/90.

## Why this phase exists

The 2026-05-16 QA audit (`.planning/qa-audit/2026-05-16-cjm-coverage.md` + `2026-05-16-test-layering.md`) identified 18 gaps (10 CJM coverage gaps G1..G10 + 8 layering gaps L1..L8). Closing those gaps requires writing roughly 11 new `.feature` files, ~11 new `*.steps.ts` files, a smoke layer, a BYOK provider matrix, and more — all of which is highly susceptible to shortcuts unless infrastructure-level enforcement exists FIRST.

Per `CLAUDE.md` Hard Rule §1 and `feedback_no_workarounds_enterprise`, the user expects strict TDD discipline. Without pre-commit + CI lockers, an agent can:
- write `@skip` or `test.skip("...", ...)` to make a flaky test "pass"
- bump `retries: 3` to mask a flake
- ship a step file without unit tests (memory `feedback_cjm_steps_need_unit_tests`)
- edit production code in a `[test-fix]` PR to satisfy a failing test (Hard Rule §1)
- ship sub-90% coverage on a strict-coverage package

Phase 21 makes those shortcuts structurally impossible — the linter blocks the commit, the CI blocks the merge, and CODEOWNERS blocks any attempt to weaken the linter itself.

## Locked decisions

### D-01 — Five linters land separately, not one mega-linter

**Why:** Each rule has a different surface (Gherkin tags, playwright configs, step files + sibling tests, PR diff, coverage JSON). Bundling them would couple unrelated failure modes. Each linter follows the existing `tools/lint-*.ts` pattern: pure-function core + `run(opts)` for testability + CLI bootstrap behind `invokedAsCli` guard.

### D-02 — Pre-existing-debt allowlist for SR-21.3 (steps-have-unit-tests)

**Why:** 11 of 12 existing `*.steps.ts` files lack unit tests today. Writing those 11 tests in this phase would balloon scope from "ship the linter" to "retroactively cover all CJM steps". The allowlist is a one-time legacy carve-out with explicit acceptance criteria: each entry MUST be removed by the phase that lands the corresponding unit test. Phase 24..32 are committed to add new step bindings WITH unit tests in the same atomic commit — the allowlist MUST NOT grow.

### D-03 — Production fix bundled in SR-21.2 (apps/web/playwright.config.ts retries)

**Why:** `apps/web/playwright.config.ts:31` was carrying `retries: process.env.CI ? 2 : 0`. The linter's GREEN baseline requires fixing this in the same commit; per `feedback_no_workarounds_enterprise`, the linter is NOT weakened to permit the existing technical debt. Fixed in commit `ea5d025` (replaced with `retries: 0` + explanatory comment citing D-12).

### D-04 — `[scope-expansion]` override label for SR-21.4

**Why:** Hard Rule §1 is absolute but occasionally a `[test-fix]` PR legitimately needs to touch production code (e.g. a test surfaces a real bug). The override label lets the maintainer document the deviation explicitly; human review handles the rationale, the linter only checks the label is present. Without the override, the rule becomes a footgun.

### D-05 — `lint-prod-edit-guard` and `lint-coverage-floor` are CI-only

**Why:** Both need PR metadata (title, body, changed-files list) and the latter needs `coverage-summary.json`. Pre-commit hooks cannot provide either. They are wired in `.github/workflows/ci.yml` as PR-only jobs and added to `scripts/branch-protection.json` so they gate merges.

### D-06 — Branch-protection bump from 16 to 21 required contexts

**Why:** The 5 new jobs MUST gate merges. Anyone with admin access can disable a required check, but the explicit list in `scripts/branch-protection.json` is the source of truth — see `tools/sync-branch-protection.ts` (already exists per Phase 0) for re-applying after drift.

## Scope and out-of-scope

In scope:
- 5 new linters under `tools/`
- 5 new colocated test files with strict 90/90/90/90 coverage
- 1 allowlist file (SR-21.3 legacy carve-out)
- Wiring: 10 `pnpm` scripts, 3 lefthook hooks, 5 CI jobs, 5 branch-protection contexts, ~17 CODEOWNERS pins, 1 PR-template section
- Production fix: `apps/web/playwright.config.ts` retries

Out of scope:
- Writing the 11 missing step unit tests (deferred to Phase 24..32 as those phases land new step files)
- Fixing the 2 existing `test.skip("title", body)` in `apps/web/tests/e2e/` — those are RUNTIME-conditional (test.skip(condition, reason)) not the static-title form, and the linter explicitly allows the conditional form
- Writing CJM gap closure tests (Phase 22..39)

## Cross-references

- Plan source: `~/.claude/plans/mellow-watching-hinton.md` (sections "Phase Q-00 — Hard anti-shortcut locker infrastructure")
- Audit source: `.planning/qa-audit/2026-05-16-cjm-coverage.md`, `.planning/qa-audit/2026-05-16-test-layering.md`
- Memory invariants: `feedback_no_workarounds_enterprise`, `feedback_cjm_steps_need_unit_tests`, `feedback_tdd_and_ci`
- Constitutional rules: `CLAUDE.md` Hard Rule §1 (no production edits in test-fix PRs), PROJECT.md §2 (90/90/90/90 strict packages)
