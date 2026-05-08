---
phase: 0
slug: repo-bootstrap-constitutional-ci
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 0 is unusual — its "user-observable behaviors" are CI signals on a fresh PR rather than runtime application behaviors. The harness IS the deliverable.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit/integration), Playwright 1.x (e2e — Phase 2+), Stryker 9.x (mutation) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `stryker.config.json` |
| **Quick run command** | `pnpm vitest run --bail 1 --reporter=dot` |
| **Full suite command** | `pnpm test` (alias for: lint + typecheck + vitest run --coverage + stryker run --incremental) |
| **Estimated runtime** | Quick: ~10s. Full: ~3-5 min once everything is wired. |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run --changed` (only re-runs affected tests)
- **After every plan wave:** `pnpm test` (full suite including coverage threshold gate)
- **Before `/gsd-verify-work`:** Full GHA workflow run on a real PR — every CI check green
- **Max feedback latency:** 30 seconds for unit; 5 min for full suite

---

## Per-Task Verification Map

The planner will populate this table fully. Skeleton:

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 0-01-01 | 01 | 1 | DEVEX-01 | unit | `make dev && make test` | ❌ W0 | ⬜ pending |
| 0-01-02 | 01 | 1 | TDD-01 | meta | `grep -q 'tests-first' .github/pull_request_template.md` | ❌ W0 | ⬜ pending |
| 0-02-01 | 02 | 1 | CI-01 | meta | `test -f .github/workflows/ci.yml` | ❌ W0 | ⬜ pending |
| 0-02-02 | 02 | 1 | CI-02 | smoke | Open dummy PR, check 12 GHA jobs spawn | ❌ W0 | ⬜ pending |
| 0-02-03 | 02 | 1 | CI-03 | meta | `gh api repos/{owner}/{repo}/branches/main/protection` succeeds | ❌ W0 | ⬜ pending |
| 0-03-01 | 03 | 2 | TEST-COV-01 | meta | `grep -E 'lines:\s*85' vitest.config.ts` | ❌ W0 | ⬜ pending |
| 0-03-02 | 03 | 2 | TEST-COV-01 | self-test | Inject untested function; `pnpm vitest run --coverage` exits non-zero | ❌ W0 | ⬜ pending |
| 0-04-01 | 04 | 2 | TEST-MUTATION-01 | meta | `pnpm stryker run --incremental` exits 0 against placeholder | ❌ W0 | ⬜ pending |
| 0-05-01 | 05 | 2 | DOCS-09 | meta | `tools/lint-english.ts` exists and is executable | ❌ W0 | ⬜ pending |
| 0-05-02 | 05 | 2 | DOCS-09 | self-test | Inject Cyrillic char into a fixture; lint exits non-zero | ❌ W0 | ⬜ pending |
| 0-06-01 | 06 | 1 | TDD-02 | meta | `grep -q stryker package.json && grep -q vitest package.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

The planner will expand this with one row per task.

---

## Wave 0 Requirements

Phase 0 IS Wave 0 for the entire project — there is no pre-existing infrastructure. Every task in this phase is establishing the test/lint/CI substrate. Wave 0 line items here are about ordering within the phase:

- [ ] `package.json` + `pnpm-workspace.yaml` exist before any tooling task
- [ ] `vitest.config.ts` exists before coverage threshold task
- [ ] `tsconfig.base.json` exists before typecheck task
- [ ] `biome.json` exists before lint task
- [ ] `.github/workflows/ci.yml` exists before branch-protection task
- [ ] At least one passing unit test exists before coverage threshold can be evaluated meaningfully
- [ ] `apps/api/src/placeholder.ts` and `packages/{auth,data,litellm-client}/index.ts` exist before Stryker can run

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Branch protection on `main` matches required-checks list | CI-03 | GitHub API state is operator-level config, not committed code | After phase complete, run `scripts/setup-branch-protection.sh` then `gh api repos/{owner}/{repo}/branches/main/protection` and verify `required_status_checks.contexts` lists every job from `ci.yml` + `security.yml` |
| PR template "tests first" checkbox is enforced | TDD-01 | Requires opening a real PR with the box unchecked and observing the GHA fail | Open a draft PR with the checkbox unchecked → require-checklist-action job must fail |
| English-only lint catches Cyrillic in real PR | DOCS-09 | Requires opening a real PR adding Cyrillic | Open a draft PR adding `привет` to `apps/api/src/test.ts` → `lint:english` job must fail with file:line:col |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (Vitest `run` not `watch`; Stryker non-watch)
- [ ] Feedback latency < 30s for quick / < 5min for full
- [ ] `nyquist_compliant: true` set in frontmatter once planner populates the per-task map

**Approval:** pending
