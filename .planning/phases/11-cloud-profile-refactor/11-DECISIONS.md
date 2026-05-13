---
phase: 11
created: 2026-05-13
status: pending-execution
---

# Phase 11 — Pre-execution decisions (locked)

Recorded by user after 11-01 executor stopped on scope-vs-budget concern.

## D1 — Path C: split Task 7 into new sub-plan 11-05

**Decision:** 11-01 now scopes ONLY Tasks 1-6 (chart refactor + Variant A operator bundle + linter). Task 7 (real kind cluster upgrade test in GitHub Actions, frozen pre-11 chart tarball, base64 secret diff assertions, assumption A1 verification) is pulled out into a NEW sub-plan **11-05** that runs in parallel with Wave 3 (after 11-01 closes).

**Rationale:** Task 7 is CI infra work, materially different from chart/compose/env/linter authoring. Phase 09.1 precedent — live-kind work pulled into its own sub-phase.

**Action for next executor:** treat 11-01 as 6 tasks. Skip Task 7. Write 11-05-PLAN.md with Task 7 lifted verbatim from current 11-01-PLAN.md before spawning 11-05 executor.

## D2 — Task 1 fixture pattern: probe template (a)

**Decision:** Add `charts/openwhispr/templates/_probe-helpers.yaml` rendering a ConfigMap with `data.requiredSecretKeys: {{ include "openwhispr.requiredSecretKeys" . }}` for helm-unittest to assert helper output directly.

**Rationale:** Canonical helm-unittest pattern. Clean isolation (helpers prefix `_` means it doesn't render in production install; the probe template's name starts with `_probe-` so it's also not rendered in prod releases — confirm with helm-unittest selector behavior).

**Action for next executor:** create the probe template as Task 1 RED scaffolding. Helm-unittest `template: _probe-helpers.yaml` selector targets it.

## D3 — Pre-11 anchor SHA

**Captured:** `40d04fe5b3ea8d3012bb9791d834c2c18040c961` (HEAD as of decision recording).

**Action for 11-05 executor:** before any Phase 11 commits land, `git archive 40d04fe5b3ea8d3012bb9791d834c2c18040c961 charts/openwhispr/` → save tarball to `tests/fixtures/pre-11-chart.tar.gz` → commit as the FIRST 11-05 commit. The kind upgrade workflow then upgrades FROM this tarball TO HEAD.

## D4 — Task list mapping

| Sub-plan | Scope | Status |
|---|---|---|
| 11-01 | Tasks 1-6 from current 11-01-PLAN.md (chart refactor + Variant A bundle + linter; skip Task 7) | ready to spawn |
| 11-02 | unchanged | Wave 2 |
| 11-03 | unchanged | Wave 2 |
| 11-04 | unchanged | Wave 3 |
| 11-05 | NEW. Lift Task 7 from 11-01: kind cluster upgrade CI workflow + frozen pre-11 chart tarball + A1 verification | Wave 3 (parallel with 11-04) |

## D5 — Pre-flight test baseline (do not regress)

Captured 2026-05-13:
- apps/api: **967 passed / 7 failed / 2 errors** (testcontainer 3F000 baseline, deferred-items.md item 6)
- apps/worker: **160/160 green**
- apps/web: **763/763 green**
- packages/i18n: **2/2 green**
- helm-unittest: **109/109 green**
- packages/contract-tests: **parse error** in `src/transcriptions.test.ts:189` (baseline, deferred-items.md)
