---
phase: 12
slug: admin-onboarding-wizard-ui-spec-conformance-audit-v2
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
last_updated: 2026-05-14
---

# Phase 12 — Validation Strategy

> Per-phase validation contract. Filled from the 5 PLAN.md files for this phase.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 + @vitest/coverage-v8 (unit/integration); Cucumber 12.8.2 + playwright-bdd 8.5.x + @playwright/test 1.60.0 + @axe-core/playwright 4.11.2 (e2e + conformance axe) |
| **Config file** | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `packages/*/vitest.config.ts`, `tests/e2e-cjm/playwright.config.ts`, NEW `tests/conformance/ui-spec/playwright.config.ts` |
| **Quick run command** | `pnpm test:unit --changed` (per workspace; fast Vitest changed-files mode) |
| **Full suite command** | `pnpm test:unit && pnpm exec playwright test --config tests/conformance/ui-spec/playwright.config.ts && make e2e-cjm` |
| **Estimated runtime** | unit ~30s; conformance axe ~60s (boots Phase 13 compose harness); e2e-cjm ~3–5 min |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit --changed` (Vitest changed-files mode in the touched workspace).
- **After every plan wave:** Run `pnpm test:unit` (full unit) + the conformance Playwright spec.
- **Before `/gsd-verify-work`:** Full suite (unit + conformance + e2e-cjm including the 5 newly-GREEN @cjm-{5.1,5.3,1.5,7.1,7.2} scenarios) must be green.
- **Max feedback latency:** ≤ 60s for unit; ≤ 5 min for full incl. e2e-cjm.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-T1 | 12-01 | 1 | ADMIN-01 | T-12.01-03 | Schema test asserts singleton + enum + 4 columns | vitest | `cd packages/data && pnpm vitest run src/schema/__tests__/setup_state.test.ts` | pending | ⬜ |
| 12-01-T2 | 12-01 | 1 | ADMIN-01 | T-12.01-03 | Drizzle schema + barrel export | vitest | `cd packages/data && pnpm vitest run src/schema/__tests__/setup_state.test.ts` | pending | ⬜ |
| 12-01-T3 | 12-01 | 1 | ADMIN-01, ADMIN-03 | T-12.01-02, T-12.01-03 | Migration test: pending + skipped_legacy + CHECK + users.role nullable + squawk-clean | vitest+testcontainers | `cd packages/data && pnpm vitest run migrations/__tests__/0017-setup-state.test.ts` | pending | ⬜ |
| 12-01-T4 | 12-01 | 1 | ADMIN-01, ADMIN-03 | T-12.01-02, T-12.01-03 | 0017 migration shipped; squawk-clean | vitest+squawk | `node tools/lint-migrations.ts packages/data/migrations/0017_setup_state.sql` | pending | ⬜ |
| 12-01-T5 | 12-01 | 1 | ADMIN-03 | T-12.01-01 | Better Auth input:false; role-escalation regression test | vitest | `cd apps/api && pnpm vitest run src/__tests__/auth-role-input-false.test.ts` | pending | ⬜ |
| 12-02-T1 | 12-02 | 1 | UICONF-01 | T-12.02-04 | Extract listConfiguredOidcProviders; env-permutation table tests | vitest | `cd apps/api && pnpm vitest run src/lib/__tests__/oidc-providers.test.ts` | pending | ⬜ |
| 12-02-T2 | 12-02 | 1 | UICONF-01, ADMIN-02 | T-12.02-01, T-12.02-03 | GET /api/auth/providers public + ETag + Cache-Control + info-leak gate | vitest | `cd apps/api && pnpm vitest run src/routes/__tests__/auth-providers.test.ts` | pending | ⬜ |
| 12-02-T3 | 12-02 | 1 | UICONF-01 | T-12.02-02 | GET /api/capabilities authed; 401 anon; ETag keyed on (tenantId, env-hash, setup_status) | vitest | `cd apps/api && pnpm vitest run src/routes/__tests__/capabilities.test.ts` | pending | ⬜ |
| 12-02-T4 | 12-02 | 1 | UICONF-01 | T-12.02-04 | D-08 zero-drift contract test | vitest | `cd apps/api && pnpm vitest run src/routes/__tests__/auth-providers.test.ts -t "zero-drift"` | pending | ⬜ |
| 12-02-T5 | 12-02 | 1 | ADMIN-02 | T-12.02-05 | Public GET /api/setup-state: no-auth boolean-shaped {status}; rate-limited; no-store cache; unblocks /setup RSC fetch (BLOCKER 1 fix) | vitest+testcontainers | `cd apps/api && pnpm vitest run src/routes/__tests__/setup-state.test.ts` | pending | ⬜ |
| 12-03-T1 | 12-03 | 2 | ADMIN-01, ADMIN-02 | T-12.03-01, T-12.03-02, T-12.03-05, T-12.03-07 | Idempotent POST /api/setup/admin: winner 201 (incl. tenants.name=workspace persistence per RESEARCH Q1), loser 200, rollback, rate-limit, role-via-body guard, timezone-deferred (no users.timezone column; handler accepts but does not write), tenant-rename-failure warnings branch (BLOCKER 3 fix) | vitest+testcontainers | `cd apps/api && pnpm vitest run src/routes/__tests__/setup-admin.test.ts` | pending | ⬜ |
| 12-03-T2 | 12-03 | 2 | ADMIN-02 | (vendoring) | shadcn-stepper vendored with SPDX + upstream cite | typecheck+grep | `test -f apps/web/src/components/ui/stepper.tsx && cd apps/web && pnpm -s typecheck` | pending | ⬜ |
| 12-03-T3 | 12-03 | 2 | UICONF-03 | (i18n parity) | Zod schema + setErrorMap i18n bridge; en+ru parity | vitest+node script | `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/SetupForm.test.tsx -t "schema"` | pending | ⬜ |
| 12-03-T4 | 12-03 | 2 | ADMIN-01, ADMIN-02, UICONF-03 | T-12.03-03, T-12.03-04, T-12.03-06 | /setup page RSC guard (fetches PUBLIC /api/setup-state — NOT /api/capabilities; BLOCKER 1 fix) + SetupForm wizard with hardcoded /admin redirect + tenant_rename_failed warning toast | vitest | `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/SetupForm.test.tsx` | pending | ⬜ |
| 12-04-T1 | 12-04 | 2 | UICONF-02 | T-12.04-02 | useAuthProviders hook with loading flicker-guard | vitest | `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/useAuthProviders.test.ts` | pending | ⬜ |
| 12-04-T2 | 12-04 | 2 | UICONF-02 | T-12.04-03 | OidcButtons rewrite; NEXT_PUBLIC_OIDC_PROVIDERS deleted | vitest+grep | `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/OidcButtons.test.tsx && ! grep -rn "NEXT_PUBLIC_OIDC_PROVIDERS" apps/web/src` | pending | ⬜ |
| 12-04-T3 | 12-04 | 2 | UICONF-06 | T-12.04-04 | SignUpForm single-banner + title≠body fix at lines 102-115 | vitest | `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/SignUpForm.test.tsx` | pending | ⬜ |
| 12-04-T4 | 12-04 | 2 | UICONF-07 | (CTA hookup) | SignInForm resend-verification CTA on 403 EMAIL_NOT_VERIFIED | vitest | `cd apps/web && pnpm vitest run src/components/screens/auth/__tests__/SignInForm.test.tsx -t "UICONF-07"` | pending | ⬜ |
| 12-04-T5 | 12-04 | 2 | ADMIN-04, ADMIN-05 | T-12.04-01 | /admin index page + AdminIndex component (PII gate) + ops.md break-glass docs | vitest+grep | `cd apps/web && pnpm vitest run src/components/screens/__tests__/AdminIndex.test.tsx && grep -nc "break-glass\|htpasswd" docs/operations.md` | pending | ⬜ |
| 12-05a-T1 | 12-05a | 3 | UICONF-04 | T-12.05a-01 | JSX-oracle inventory fixture (6 source-citation comments) | typecheck+grep | `test -f apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts && cd apps/web && pnpm -s typecheck` | pending | ⬜ |
| 12-05a-T2 | 12-05a | 3 | UICONF-04, UICONF-06 | T-12.05a-01, T-12.05a-02 | SignInForm + SignUpForm + OidcButtons + VerifyEmailClient conformance tests | vitest | `cd apps/web && pnpm vitest run src/components/__tests__/conformance/` | pending | ⬜ |
| 12-05a-T3 | 12-05a | 3 | UICONF-04 | T-12.05a-01, T-12.05a-03 | setup + admin-index conformance tests (no-oracle deviation, PII gate) | vitest | `cd apps/web && pnpm vitest run src/components/__tests__/conformance/setup.test.tsx src/components/__tests__/conformance/admin-index.test.tsx` | pending | ⬜ |
| 12-05b-T1 | 12-05b | 3 | UICONF-05 | T-12.05b-01 | @axe-core/playwright 4.11.2 lockfile pin | pnpm | `pnpm list -r @axe-core/playwright \| grep 4.11.2` | pending | ⬜ |
| 12-05b-T2 | 12-05b | 3 | UICONF-05 | T-12.05b-01, T-12.05b-04 | Playwright axe spec, 5 routes, zero violations under WCAG-2.1-AA | playwright | `pnpm exec playwright test --config tests/conformance/ui-spec/playwright.config.ts` | pending | ⬜ |
| 12-05b-T3 | 12-05b | 3 | ADMIN-06 | T-12.05b-02 | 5 @cjm scenarios flipped GREEN by tag removal + `make e2e-cjm` green | cucumber+grep | `make e2e-cjm && ! grep -E "@expected-red.*@after-phase-12" tests/e2e-cjm/features/{admin-onboarding,signup-verify,oidc-providers}.feature` | pending | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/conformance/ui-spec/playwright.config.ts` — NEW config; reuses Phase 13 `tests/e2e-cjm/support/compose-harness.ts` (Plan 12-05b Task 2)
- [ ] `apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts` — hand-curated from `screens-user.jsx` + `screens-admin.jsx` + `ui.jsx` per RESEARCH §16 (Plan 12-05a Task 1)
- [ ] `apps/api/vitest.config.ts` — confirm includes routes/probes coverage with the new `/api/auth/providers` + `/api/capabilities` + `/api/setup/admin` (no edit required — glob already matches)
- [ ] No new framework install — Vitest + Playwright + axe already in lockfile from Phase 13. (Only the @axe-core/playwright minor bump 4.10.2 → 4.11.2 in Plan 12-05b Task 1.)

*Phase 12 has no new framework install; all Wave 0 work is fixture authoring inside the relevant plans.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none) | — | UICONF-04 is semantic-DOM only (no pixel-diff); UICONF-05 is axe-Playwright (real Chromium); all other criteria have automated coverage | N/A |

*All Phase 12 success criteria have automated verification. No manual gate.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (fixture + config land in their respective plans)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (unit) / 300s (full)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready for execution
