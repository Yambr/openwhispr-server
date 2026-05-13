---
phase: 10
plan: 01b
subsystem: i18n / worker
tags: [i18n, worker, email, templates, ru, fastify]
requires:
  - apps/worker/src/jobs/email-delivery.ts (Phase 6 Plan 06-08)
  - 10-01a (api i18n bootstrap; pattern reused)
provides:
  - apps/worker/src/i18n/template-renderer.ts (WorkerTemplateRenderer + createTemplateRenderer + UnknownTemplateError)
  - apps/worker/src/i18n/locales/{en,ru}/email/<id>/{subject.txt,body.txt,body.html} (3 templates x 2 locales x 3 files = 18)
affects:
  - apps/worker/src/index.ts (replaces noopRenderer with real templateRenderer)
key-files:
  created:
    - apps/worker/src/i18n/template-renderer.ts
    - apps/worker/src/i18n/__tests__/template-renderer.test.ts
    - apps/worker/src/i18n/__tests__/email-delivery-with-real-renderer.test.ts
    - apps/worker/src/i18n/locales/en/email/email_verification/{subject.txt,body.txt,body.html}
    - apps/worker/src/i18n/locales/en/email/password_reset/{subject.txt,body.txt,body.html}
    - apps/worker/src/i18n/locales/en/email/account_deletion_confirmation/{subject.txt,body.txt,body.html}
    - apps/worker/src/i18n/locales/ru/email/email_verification/{subject.txt,body.txt,body.html}
    - apps/worker/src/i18n/locales/ru/email/password_reset/{subject.txt,body.txt,body.html}
    - apps/worker/src/i18n/locales/ru/email/account_deletion_confirmation/{subject.txt,body.txt,body.html}
  modified:
    - apps/worker/src/index.ts
    - .planning/phases/10-i18n-docs-oss-housekeeping/deferred-items.md
metrics:
  tasks_completed: 2
  duration: ~15m
  completed: 2026-05-13
---

# Phase 10 Plan 10-01b: Worker template renderer + 3 email templates en/ru

Wired the worker-side i18n surface: a synchronous `WorkerTemplateRenderer` that eager-loads 3 production email templates (`email_verification`, `password_reset`, `account_deletion_confirmation`) in `en` + `ru` at module init, plus 18 on-disk template files (subject + text body + html body per template per locale). Replaced the Phase 6 `noopRenderer` stub in `apps/worker/src/index.ts` with the real renderer.

## What changed

### 1. WorkerTemplateRenderer (`apps/worker/src/i18n/template-renderer.ts`)

- Synchronous positional signature `render(templateId, locale, variables)` per the existing `TemplateRenderer` interface in `apps/worker/src/jobs/email-delivery.ts` (advisor B3). The interface is referenced via `implements TemplateRendererInterface` for compile-time enforcement.
- Eager load: at construction, walks `KNOWN_TEMPLATE_IDS x SUPPORTED_LOCALES`, calling `fs.readFileSync` for `subject.txt`, `body.txt`, and (optional) `body.html` per (locale, id). Missing required files throw immediately at boot — the worker will not silently start without all locales present.
- Locale-dir resolution mirrors `apps/api/src/i18n/init.ts`: `LOCALES_DIR` env override → source-tree path (`<here>/locales`) → post-tsup dist fallback (`<here>/i18n/locales`, copy step deferred to 10-01d).
- Interpolation is a deliberate single-pass `{var}` substitution. The 3 templates carry no plural forms, so the renderer does not depend on `i18next` or `i18next-icu` — keeps the worker bundle small. Unknown tokens are left untouched (`{name}` literal renders verbatim) so missing variables surface loudly in QA rather than rendering as `undefined`.
- `UnknownTemplateError` is thrown for unregistered ids; the existing `buildEmailDeliveryHandler` lets it bubble up so BullMQ's retry/DLQ path drives it.

### 2. Email templates (18 files)

Path: `apps/worker/src/i18n/locales/{en,ru}/email/<id>/{subject.txt,body.txt,body.html}`.

- `email_verification` — vars: `name`, `verification_url`.
- `password_reset` — vars: `name`, `reset_url`, `expires_minutes`.
- `account_deletion_confirmation` — vars: `name`, `deleted_at`.

Russian bundles use the formal вы-form per `CLAUDE.md`: opener "Здравствуйте, {name}!", closer "С уважением, команда OpenWhispr". Cyrillic is isolated to `ru/**` (lint-english allowlist already covers `**/locales/**`).

### 3. Worker entrypoint wiring (`apps/worker/src/index.ts`)

`templateRenderer = createTemplateRenderer()` is now passed to `buildEmailDeliveryHandler` in place of the `noopRenderer` stub left by Phase 6 Plan 06-08. The renderer initialises at module load; failure surfaces at boot, not at job time.

### 4. Tests

| Suite | Tests | Notes |
|-------|-------|-------|
| `src/i18n/__tests__/template-renderer.test.ts` | 14 | unit: 3 templates x 2 locales, completeness, interpolation, error path, DI bundle injection, locale fallback, `LOCALES_DIR` override |
| `src/i18n/__tests__/email-delivery-with-real-renderer.test.ts` | 3 | integration: real renderer + `buildEmailDeliveryHandler` + Postgres testcontainer (no renderer stub) |
| **TOTAL new** | **17** | **all green** |
| Full `pnpm -F @openwhispr/worker test` | 156 | all green (no regressions) |

### 5. Coverage on changed code

`apps/worker/src/i18n/` coverage (via `pnpm -F @openwhispr/worker test --coverage`):

| Metric | Result | Threshold |
|--------|--------|-----------|
| Lines | 97.61 | ≥ 90 |
| Branches | 93.33 | ≥ 90 |
| Functions | 100 | ≥ 90 |
| Statements | 97.67 | ≥ 90 |

## Commits

- `13c6091` — test(10-01b): red template-renderer + en/ru email templates on disk
- `5de9259` — feat(10-01b): worker template renderer + 3 email templates en/ru

## Deviations

- **[Rule 3 — Blocking]** Plan 10-01 listed the canonical template id as `email_verification` (interfaces block) while the user prompt mentioned `verify-email`. The prompt explicitly says "or whatever 3 are in 10-PLAN.md", so the plan's `email_verification` / `password_reset` / `account_deletion_confirmation` IDs were used — these also match the existing `enqueueEmailDelivery` payload contract that Plan 10-01c will wire into Better Auth hooks.
- **[Rule 3 — Blocking]** Plan 10-01 mentions ICU "for ICU patterns ready for 10-01b plural forms". The 3 production templates carry no plural forms, so the renderer ships without an i18next/ICU runtime dependency. Swap-in is a single-file change if a future template needs CLDR plurals. Documented inline in `template-renderer.ts`.
- **[Rule 1 — Formatting]** Biome auto-reordered imports in `email-delivery-with-real-renderer.test.ts` after staging (`canRunDocker` import alphabetised after `email-delivery`).

## Out of scope (per scope-boundary)

Per the 10-01b prompt these belong to 10-01c/d and were NOT touched:
- `users.locale` migration + Better Auth `additionalFields.locale` (10-01c)
- API → BullMQ enqueue with locale (10-01c)
- Audit Cyrillic guard (10-01d)
- docker-compose `LOCALES_DIR` mount + tsup `onSuccess` copy (10-01d)
- CI `test:i18n-completeness` workflow (10-01d)
- Bulk conversion of remaining `reply.code().send({error:...})` sites (10-01d)

Pre-existing failures (NOT introduced by 10-01b) logged to `deferred-items.md`:
- `packages/contract-tests/src/transcriptions.test.ts` — parse error (await outside async).
- `apps/worker/src/lib/typed-queue.ts` + `with-tenant-context.ts` — pre-existing `tsc --noEmit` errors. Test suite is green.

## Known stubs

None. The renderer is fully wired and the 3 templates are production-ready.

## Self-Check: PASSED

- `apps/worker/src/i18n/template-renderer.ts` exists ✓
- 18 template files exist (`find apps/worker/src/i18n/locales -name "*.txt" -o -name "*.html" | wc -l` = 18) ✓
- Both commits exist in git log (`13c6091`, `5de9259`) ✓
- 17/17 new tests + 156/156 full worker tests green ✓
- `pnpm lint:english` green (Cyrillic only in `locales/ru/**`) ✓
- Coverage on `src/i18n` ≥ 90/90/90/90 ✓
- Helm chart untouched (not modified) ✓
