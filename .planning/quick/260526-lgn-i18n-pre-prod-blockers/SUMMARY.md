---
quick_id: 260526-lgn
slug: i18n-pre-prod-blockers
title: Pre-prod i18n BLOCKERS B1/B2/B3 — three atomic commits
date: 2026-05-26
status: complete
commits:
  - sha: 05f69698
    subject: "fix(web-i18n): translate AdminForbidden 403 surface via getServerI18n (B1, pre-prod blocker)"
  - sha: ed26be75
    subject: "fix(web-i18n): translate sheet close sr-only via required closeLabel prop (B2, pre-prod blocker)"
  - sha: f7a794f4
    subject: "fix(web-i18n): translate stepper completed sr-only via completedLabel prop (B3, pre-prod blocker)"
trigger: .planning/review/pre-prod-2026-05-26/UI-PROD.md (F1/F2/F3) → SHIP-DECISION.md
---

# Quick Task 260526-lgn — Pre-prod i18n BLOCKERS

## Trigger

Pre-production 4-track review on 2026-05-26 (security / code-review / LOCKER+secrets / UI) returned **GO-WITH-CAVEATS**. Only blocking items were 3 hardcoded English strings in `apps/web/` that bypassed `react-i18next` entirely — ru-locale users would have hit them in the universal first-launch journey (`/setup` wizard + admin gate).

Source-of-truth: `.planning/review/pre-prod-2026-05-26/SHIP-DECISION.md`.

## Fix

Three atomic strict-TDD commits on `main`:

| # | SHA | Blocker | Pattern |
|---|---|---|---|
| 1 | `05f69698` | B1 — `apps/web/src/app/(admin)/layout.tsx:16-28` `AdminForbidden()` 403 page | Async RSC reads `lng` from `headers().get("x-locale")`, calls `getServerI18n`, renders 4 new `admin.forbidden.*` keys in en + ru |
| 2 | `ed26be75` | B2 — `apps/web/src/components/ui/sheet.tsx:75` `<span sr-only>Close</span>` | `SheetContent` adds **required** `closeLabel: string` prop (TS-enforced, no silent-EN-leak); new `common.action.close.label` in en + ru |
| 3 | `f7a794f4` | B3 — `apps/web/src/components/ui/stepper.tsx:146` `<span sr-only>Completed</span>` | `StepIndicator` adds **required** `completedLabel: string` prop; SetupForm.tsx passes `t("end-user:end-user.setup.step.completed.aria.label")`; new key in en + ru |

## Evidence

Independently verified by main orchestrator (CLAUDE.md Rule 3):

- All 3 commits on `main` HEAD (`git log --oneline -3`)
- All 3 new conformance tests GREEN under re-run (14 + 6 + 7 = 27 passed, 0 failed)
- Hardcoded English literals (`>Close<`, `>Completed<`, `403 — Forbidden`) absent from the 3 files
- `pnpm --filter @openwhispr/web typecheck` clean (proves required-prop pattern catches missed callsites repo-wide)
- Working tree clean (only pre-existing untracked planning artifacts)
- Full apps/web suite: 77 files / 1076 tests GREEN (per executor; locale-parity-sweep included)
- No `--no-verify` bypass — all lefthook hooks (gitleaks, biome, phase-tag-comments, english, web-typecheck, lockers, commitlint) passed on every commit

## Deviations from plan

1. **B2 plan assumed an `AppShell.tsx` `<SheetContent>` call-site that does not exist.** `grep -rn "<SheetContent" apps/web/src --include="*.tsx" | grep -v __tests__` returned zero production hits — mobile `<Sheet>` is annotated in `AppShell.tsx` as a future "Plan 12 final-pass" item. Executor correctly skipped the non-existent callsite edit; the required-prop pattern still meets the blocker goal by pre-emptively locking any future consumer into the localized path at TS compile time.
2. **B3 commit subject** trimmed from 106 → 99 chars to satisfy `commitlint` `header-max-length: 100`. Dropped redundant word "required"; body still states the prop is required.

## Locale keys added

- `admin.forbidden.title.text` (en + ru)
- `admin.forbidden.body_prefix.text` (en + ru)
- `admin.forbidden.body_middle.text` (en + ru)
- `admin.forbidden.body_suffix.text` (en + ru)
- `common.action.close.label` (en + ru)
- `end-user.setup.step.completed.aria.label` (en + ru)

en+ru parity preserved (verified by per-commit conformance tests mirroring the Plan 51-11e `locale-parity-sweep.test.tsx` pattern).

## Ready-to-push

Owner's pre-push checklist (from SHIP-DECISION.md operator env checklist):
- [ ] `MASTER_KEK` 32 bytes set
- [ ] `OPENWHISPR_KEY_PROVIDER=env`
- [ ] `LITELLM_BASE_URL` + `LITELLM_VIRTUAL_KEY` (not dev sentinel)
- [ ] `OPENAI_API_KEY` (default `REALTIME_BACKEND=direct`)
- [ ] `OPENWHISPR_ENABLE_TEST_ROUTES` **unset** in prod image
- [ ] `AUTH_URL` + `INGRESS_BASE_URL` = prod URLs
- [ ] Optional: `DATABASE_URL=<prod> pnpm tsx tools/lint-rls.ts`

Then `git push`.
