---
phase: 13
slug: e2e-cjm-harness-v2-ships-first
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (unit/integration) + Cucumber + playwright-bdd 8.4.2 + @playwright/test (e2e-cjm) |
| **Config file** | `vitest.config.ts` (per-package), `playwright.config.ts` (NEW, repo root or `tests/e2e-cjm/`), `bddgen.config.ts` (NEW), `tools/lint-weak-assertions.ts` (NEW) |
| **Quick run command** | `pnpm vitest run packages/email tools` |
| **Full suite command** | `make e2e-cjm` (boots docker-compose, runs `bddgen` then `pnpm playwright test` filtered by `--grep-invert "@expected-red"`) |
| **Estimated runtime** | quick ~30 s · full ~5 min (compose boot + readiness wait + 2 reference scenarios) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/email tools` (touched-package scope; full unit suite if cross-cutting)
- **After every plan wave:** Run `make e2e-cjm` plus `pnpm tsx tools/lint-weak-assertions.ts`
- **Before `/gsd-verify-work`:** Full suite must be green, including `@cjm-1.1` (signup happy) and `@cjm-1.2` (already-registered negative twin); `@expected-red` scenarios MUST be filtered out (not skipped — invisible to the runner)
- **Max feedback latency:** 60 s for unit/integration; 5 min for e2e-cjm wave gate

---

## Per-Task Verification Map

> Populated by gsd-planner. Each task in PLAN.md must link to an entry here with `Test Type` and `Automated Command`. Manual entries forbidden except those listed in the "Manual-Only Verifications" section below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 13.a | 0 | E2E-01 | — | playwright-bdd installs and `bddgen` compiles `.feature` → `.spec.ts` | unit | `pnpm exec bddgen --dry-run` | ❌ W0 | ⬜ pending |
| 13-01-02 | 13.a | 0 | E2E-08 | — | `tools/global-vitest-teardown.ts` cleans up orphan testcontainers | integration | `pnpm vitest run tools/__tests__/global-vitest-teardown.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-03 | 13.a | 0 | E2E-09 | — | `tools/lint-weak-assertions.ts` flags `getAllByText(...).length.toBeGreaterThan(0)` family | unit | `pnpm tsx tools/lint-weak-assertions.ts --self-test` | ❌ W0 | ⬜ pending |
| 13-01-04 | 13.a | 0 | E2E-04 | — | `packages/email/` ships nodemailer-backed `EmailSender` with prod loud-fail gate | unit | `pnpm vitest run packages/email` | ❌ W0 | ⬜ pending |
| 13-01-05 | 13.a | 1 | E2E-02, E2E-10 | — | `@cjm-1.1` signup-happy round-trips via real worker + Mailpit HTTP API | e2e | `make e2e-cjm SCENARIO=@cjm-1.1` | ❌ W0 | ⬜ pending |
| 13-01-06 | 13.a | 1 | E2E-10 | — | `@cjm-1.2` already-registered negative twin GREEN | e2e | `make e2e-cjm SCENARIO=@cjm-1.2` | ❌ W0 | ⬜ pending |
| 13-01-07 | 13.a | 1 | E2E-05 | — | Readiness probes (incl. `migrations_completed=true`) gate scenario start | integration | `pnpm vitest run tools/__tests__/readiness-probe.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-08 | 13.a | 1 | E2E-09 | — | Weak-assertion sweep: 7 sites rewritten to `toHaveLength(1)` (auth + notes) | unit | `pnpm vitest run apps/web` + `pnpm tsx tools/lint-weak-assertions.ts` | ❌ W0 | ⬜ pending |
| 13-01-09 | 13.a | 2 | E2E-03, E2E-12 | — | GHA `E2E_CJM=1` job boots independent compose stack, runs suite, `always()` prunes labelled containers | e2e | GHA workflow dispatch | ❌ W0 | ⬜ pending |
| 13-02-01 | 13.b | 0 | E2E-11 | — | `docs/customer-journeys.md` enumerates ~20 journeys with `@cjm-N.M` tags; every happy path has a negative twin | doc-lint | `pnpm tsx tools/lint-cjm-doc.ts` | ❌ W0 | ⬜ pending |
| 13-02-02 | 13.b | 1 | E2E-02 | — | 8 feature files authored; downstream-phase scenarios tagged `@expected-red @after-phase-N` | e2e | `make e2e-cjm` (with grep-invert) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` workspace: `playwright-bdd@8.4.2`, `@cucumber/cucumber@12.8.2`, `@playwright/test`, `nodemailer` (held at REQUIREMENTS.md-locked versions)
- [ ] `packages/email/` package scaffolded with `src/`, `tests/`, `package.json`, `tsconfig.json`
- [ ] `tests/e2e-cjm/` directory with `features/`, `steps/`, `support/compose-harness.ts`, `playwright.config.ts`
- [ ] `tools/global-vitest-teardown.ts` + `apps/api/vitest.setup.ts` SIGINT/SIGTERM hook
- [ ] `tools/lint-weak-assertions.ts` matching the `tools/lint-english.ts` / `tools/lint-rls.ts` precedent
- [ ] `tools/lint-cjm-doc.ts` (validates happy/negative-twin pairing in `docs/customer-journeys.md`)
- [ ] `Makefile` target `e2e-cjm` and `.github/workflows/e2e-cjm.yml`
- [ ] `support/compose-harness.ts:bootStack()` passes `--profile default` (TD-14.f workaround)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `docker container prune --filter label=org.testcontainers=true` in GHA `always()` block actually runs on cancelled job | E2E-08 | GHA `always()` semantics tested only via real workflow_dispatch; can't be unit-tested | After Wave 2: cancel a workflow run manually, verify `always()` step ran and pruned containers via job logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (unit) / 5 min (e2e)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
