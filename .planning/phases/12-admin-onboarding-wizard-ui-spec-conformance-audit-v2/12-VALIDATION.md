---
phase: 12
slug: admin-onboarding-wizard-ui-spec-conformance-audit-v2
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 12 — Validation Strategy

> Per-phase validation contract. Drafted from 12-RESEARCH.md §"Validation Architecture";
> planner fills the Per-Task Verification Map row-by-row from its task list.

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
| _(planner fills row-by-row from RESEARCH.md §14 plan-split)_ | | | | | | | | | |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/conformance/ui-spec/playwright.config.ts` — NEW config; reuse Phase 13 `tests/e2e-cjm/support/compose-harness.ts`.
- [ ] `apps/web/src/components/__tests__/conformance/__fixtures__/jsx-inventory.ts` — derived from `screens-user.jsx` + `screens-admin.jsx` + `ui.jsx`; cited line-numbers per role/label/landmark.
- [ ] `apps/api/vitest.config.ts` — confirm includes routes/probes coverage with the new `/api/auth/providers` + `/api/capabilities` + `/api/setup/admin`.
- [ ] No new framework install — Vitest + Playwright + axe already in lockfile from Phase 13.

*Phase 12 has no new framework install; all Wave 0 work is fixture authoring.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity vs `screens-user.jsx` artboards | UICONF-04 (semantic only, NOT pixel) | Pixel-diff explicitly forbidden by UICONF-04 | N/A — automated semantic conformance via Vitest+RTL + axe Playwright covers UICONF-04/05/06 verifiably; no human eye required |

*All Phase 12 success criteria have automated verification. No manual gate.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (unit) / 300s (full)
- [ ] `nyquist_compliant: true` set in frontmatter (planner flips after filling Per-Task Verification Map)

**Approval:** pending
