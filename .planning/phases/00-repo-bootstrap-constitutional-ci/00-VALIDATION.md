---
phase: 0
slug: repo-bootstrap-constitutional-ci
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-08
updated: 2026-05-08
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 0 is unusual — its "user-observable behaviors" are CI signals on a fresh PR rather than runtime application behaviors. The harness IS the deliverable.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (unit/integration), Playwright 1.59.1 (e2e — Phase 2+), Stryker 9.6.1 (mutation) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (Phase 2), `stryker.config.json` |
| **Quick run command** | `pnpm vitest run --bail 1 --reporter=dot` |
| **Full suite command** | `pnpm test` (alias: `vitest run --coverage`) |
| **Phase gate command** | `pnpm lint && pnpm lint:english && pnpm typecheck && pnpm test && pnpm test:mutation:incremental && pnpm vitest run tests/self-tests/` |
| **Estimated runtime** | Quick: ~10s. Full: ~5-8 min once everything is wired. |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run --changed` (only re-runs affected tests)
- **After every plan wave:** `pnpm test` (full suite including coverage threshold gate) + `pnpm vitest run tests/self-tests/`
- **Before `/gsd-verify-work`:** Full GHA workflow run on a real PR — every CI check green; manual verifications per the section below
- **Max feedback latency:** 30 seconds for unit; 5 min for full suite; 10 min for full PR-time CI

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 0-01-01 | 01 | 1 | DEVEX-01 | meta | `test -f package.json && grep -q '"packageManager": "pnpm@11.0.8"' package.json && pnpm install --frozen-lockfile` | depends-on Wave 1 task 1 | pending |
| 0-01-02 | 01 | 1 | DEVEX-01 | meta | `test -f biome.json && test -f lefthook.yml && test -f commitlint.config.cjs && pnpm exec biome check . && grep -q 'subject-no-cyrillic' commitlint.config.cjs` | depends-on Wave 1 task 2 | pending |
| 0-02-01 | 02 | 1 | TDD-02, TEST-MUTATION-01 | unit | `pnpm install && pnpm -r exec tsc --noEmit && grep -q 'phase-0-placeholder' apps/api/src/index.ts` | depends-on plan 02 task 1 | pending |
| 0-02-02 | 02 | 1 | TEST-COV-01, TEST-MUTATION-01 | meta + smoke | `grep -q 'thresholds:' vitest.config.ts && grep -q 'lines: 85' vitest.config.ts && pnpm vitest run --coverage && pnpm stryker run --incremental` | depends-on plan 02 task 2 | pending |
| 0-03-01 | 03 | 1 | DOCS-09 | self-test | `pnpm exec tsx tools/lint-english.ts && pnpm vitest run tools/lint-english.test.ts` | depends-on plan 03 task 1 | pending |
| 0-03-02 | 03 | 1 | DEVEX-01 | meta | `test -f Makefile && make help && bash -n scripts/setup-branch-protection.sh && pnpm vitest run tools/lint-tdd.test.ts` | depends-on plan 03 task 2 | pending |
| 0-04-01 | 04 | 2 | TDD-01, CI-01, CI-02 | meta | `test -f .github/workflows/ci.yml && test -f .github/pull_request_template.md && pnpm dlx js-yaml .github/workflows/ci.yml > /dev/null && grep -q 'Tests First Checklist (TDD-01)' .github/pull_request_template.md` | depends-on plan 04 task 1 | pending |
| 0-04-02 | 04 | 2 | CI-01, CI-02 | meta | `test -f .github/workflows/security.yml && grep -q 'github/codeql-action/init@v4' .github/workflows/security.yml && ! grep -q 'codeql-action/init@v3' .github/workflows/security.yml && grep -q 'package-ecosystem: npm' .github/dependabot.yml` | depends-on plan 04 task 2 | pending |
| 0-05-01 | 05 | 2 | TDD-01, TEST-COV-01, TEST-MUTATION-01, DOCS-09, CI-03 | self-test | `pnpm vitest run tests/self-tests/cyrillic-injection.test.ts tests/self-tests/coverage-floor.test.ts tests/self-tests/branch-protection-contexts.test.ts tests/self-tests/commitlint-no-cyrillic.test.ts tests/self-tests/stryker-break-threshold.test.ts tests/self-tests/make-dev.test.ts` | depends-on plan 05 task 1 | pending |
| 0-05-02 | 05 | 2 | CI-01, CI-02 | meta | `grep -q 'harness-self-check:' .github/workflows/ci.yml && grep -q '"harness-self-check"' scripts/branch-protection.json && pnpm vitest run tests/self-tests/branch-protection-contexts.test.ts` | depends-on plan 05 task 2 | pending |
| 0-06-01 | 06 | 3 | DEVEX-01, DOCS-09 | meta | `test -f README.md && test -f CONTRIBUTING.md && test -f SECURITY.md && test -f CODE_OF_CONDUCT.md && test -f docs/operations.md && grep -q 'make dev' README.md && grep -q 'Tests First' CONTRIBUTING.md && pnpm exec tsx tools/lint-english.ts` | depends-on plan 06 task 1 | pending |
| 0-06-02 | 06 | 3 | DEVEX-01, DOCS-09 | smoke | `test -f docs/adrs/0000-template.md && test -f docs/adrs/0001-pnpm-workspaces-monorepo.md && test -f docs/adrs/0002-vitest-and-stryker-for-coverage-and-mutation.md && test -f docs/adrs/0003-english-only-source-artifacts.md && pnpm lint && pnpm lint:english && pnpm typecheck && pnpm test && pnpm test:mutation:incremental && pnpm vitest run tests/self-tests/` | depends-on plan 06 task 2 | pending |

*Status: pending · green · red · flaky*

Each row maps to ONE task in the corresponding plan, has an `<automated>` verify command from the plan's `<verify>` block, and identifies the requirement IDs the task addresses. No 3 consecutive tasks without an automated verify (Nyquist sampling continuity).

---

## Wave 0 Requirements

Phase 0 IS Wave 0 for the entire project — there is no pre-existing infrastructure. Every task in this phase is establishing the test/lint/CI substrate. Wave-internal ordering:

- [ ] `package.json` + `pnpm-workspace.yaml` exist before any tooling task (Plan 01 Task 1 — Wave 1)
- [ ] `biome.json` + `lefthook.yml` + `commitlint.config.cjs` exist (Plan 01 Task 2 — Wave 1)
- [ ] `tsconfig.base.json` exists before typecheck task (Plan 01 Task 1 — Wave 1)
- [ ] Skeleton workspaces + placeholder modules exist before vitest/stryker config (Plan 02 Task 1 — Wave 1)
- [ ] `vitest.config.ts` + `stryker.config.json` exist before any coverage/mutation gate (Plan 02 Task 2 — Wave 1)
- [ ] At least one passing unit test exists before coverage threshold can be evaluated meaningfully (Plan 02 Task 1 — Wave 1, ships placeholder tests)
- [ ] `apps/api/src/placeholder.ts` and `packages/{auth,data,litellm-client}/src/index.ts` exist before Stryker can run (Plan 02 Task 1 — Wave 1)
- [ ] `tools/lint-english.ts` + its test exist before any DOCS-09 self-test (Plan 03 Task 1 — Wave 1)
- [ ] `Makefile` + `docker-compose.yml` + branch-protection script exist before make-dev self-test (Plan 03 Task 2 — Wave 1)
- [ ] `.github/workflows/ci.yml` + `security.yml` + PR template exist before branch-protection-contexts self-test (Plan 04 — Wave 2)
- [ ] All self-tests exist before final integration smoke (Plan 05 — Wave 2)

After Plan 05 lands, every constitutional rule has a self-test that violates the rule and asserts the enforcement mechanism rejects it. After Plan 06, the full quality gate passes end-to-end.

---

## Manual-Only Verifications

These cannot be fully automated within the repo (require GitHub-side state or operator action) and are documented here for `/gsd-verify-work`:

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Branch protection on `main` matches required-checks list | CI-03 | GitHub repo-settings state is operator-level config, not committed code | After phase complete: operator runs `bash scripts/setup-branch-protection.sh` then verifies `gh api repos/${GITHUB_REPOSITORY}/branches/main/protection` returns `required_status_checks.contexts` matching `scripts/branch-protection.json` |
| PR template "tests first" checkbox is enforced | TDD-01 | Requires opening a real PR with the box unchecked and observing the GHA fail | Open a draft PR with the checkbox unchecked → `pr-checklist` job (mheap/require-checklist-action) must fail |
| English-only lint catches Cyrillic in real PR | DOCS-09 | Requires opening a real PR adding Cyrillic | Open a draft PR adding `привет` (Cyrillic "privet") to `apps/api/src/test.ts` → `lint-english` job must fail with `file:line:col` diagnostic |
| commitlint PR check rejects Cyrillic commit message | DOCS-09 | Requires a real PR with a Cyrillic-containing commit message | Push a commit with `feat: привет hello` to a draft PR → `commitlint` job must fail |
| Trivy SHA pin is post-2026-03-19 (recovery release) | (security) | Verifying the pinned SHA matches a v0.36.0+ release requires GitHub API lookup | Inspect `.github/workflows/security.yml`, look up the pinned SHA via `gh api repos/aquasecurity/trivy-action/git/commits/<sha>` and confirm the corresponding release tag is v0.36.0 or newer |

The `cyrillic-injection`, `commitlint-no-cyrillic`, `branch-protection-contexts`, `coverage-floor`, and `stryker-break-threshold` self-tests in `tests/self-tests/` automate the rule-violation negative cases. The four manual verifications above test the GitHub-side integration the self-tests cannot reach.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task in every plan has an `<automated>` block)
- [x] Wave 0 covers all MISSING references (Plan 02 Task 1 ships placeholder modules + tests; Plan 03 Task 1 ships lint-english + its test; Plan 05 Task 1 ships the self-test suite)
- [x] No watch-mode flags (Vitest `run` not `watch`; Stryker non-watch except dev-only)
- [x] Feedback latency < 30s for quick / < 5min for full suite / < 10min for full PR CI
- [x] `nyquist_compliant: true` set in frontmatter — per-task map fully populated

**Approval:** populated by planner; pending execution
