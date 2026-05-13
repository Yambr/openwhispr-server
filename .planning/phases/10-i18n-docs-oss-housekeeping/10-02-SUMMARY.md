---
phase: 10
plan: 02
subsystem: i18n
tags: [i18n, web, nextjs, rsc, i18next, icu, locale-negotiation, russian]
requirements_satisfied: [I18N-01, TEST-I18N-01]
provides:
  - "Russian web UI bundles (common, admin, end-user) — 200+ keys"
  - "Edge middleware locale-negotiation chain (cookie → Accept-Language → en)"
  - "`x-locale` request header surfaced to all matched routes for RSC consumption"
  - "i18next-ICU plugin registered on both server factory and client constructor"
  - "/api/locale POST route handler (zod-validated, 1-year SameSite=Lax cookie)"
  - "LanguageSwitcher client island (fieldset/button group, aria-pressed, keyboard nav)"
  - "Key-parity gate + CLDR ru plural-rules gate + e2e Russian-render smoke"
affects:
  - "apps/web/src/middleware.ts (matcher widened from /app/:path* → / minus _next + static)"
  - "apps/web/src/app/layout.tsx (reads x-locale from headers())"
  - "apps/web/src/lib/i18n.ts + i18n-client.tsx (ICU plugin registered)"
  - "apps/web/src/locales/en/common.json (added language.* + test.plural.unread keys)"
  - "apps/web/src/app/(public)/layout.tsx (mounts LanguageSwitcher on public routes)"
  - "apps/web/src/components/screens/AppShell.tsx (mounts LanguageSwitcher in auth header)"
  - "tools/lint-english.ts (allowlist generalized for **/locales/** + i18n test fixtures)"
  - ".github/workflows/web.yml (added test:web-i18n explicit gate after test:unit)"
tech_stack:
  added:
    - "accept-language-parser@^1.5.0 (Edge-runtime safe locale picker)"
    - "i18next-icu@^2.4.3 (CLDR plural rules client + server parity)"
    - "@types/accept-language-parser@^1.5.8 (devDependency for TypeScript)"
  patterns:
    - "Edge middleware emits per-request header (`x-locale`) → RSC layout reads it"
    - "RSC→Client serialization boundary preserved (only plain resource snapshot crosses)"
    - "Cookie-only locale persistence (no DB row, no Better Auth coupling)"
key_files:
  created:
    - "apps/web/src/locales/ru/common.json"
    - "apps/web/src/locales/ru/admin.json"
    - "apps/web/src/locales/ru/end-user.json"
    - "apps/web/src/app/api/locale/route.ts"
    - "apps/web/src/app/api/locale/__tests__/route.test.ts"
    - "apps/web/src/components/screens/language-switcher.tsx"
    - "apps/web/src/components/screens/__tests__/language-switcher.test.tsx"
    - "apps/web/src/app/__tests__/locale-negotiation.test.ts"
    - "apps/web/src/lib/__tests__/i18n-russian-coverage.test.ts"
    - "apps/web/src/lib/__tests__/web-plural-rules.test.ts"
    - "apps/web/tests/e2e/i18n-russian.spec.ts"
  modified:
    - "apps/web/src/middleware.ts"
    - "apps/web/src/app/layout.tsx"
    - "apps/web/src/lib/i18n.ts"
    - "apps/web/src/lib/i18n-client.tsx"
    - "apps/web/src/app/(public)/layout.tsx"
    - "apps/web/src/components/screens/AppShell.tsx"
    - "apps/web/src/locales/en/common.json"
    - "apps/web/src/locales/__tests__/coverage.test.ts"
    - "apps/web/src/lib/__tests__/middleware.test.ts"
    - "apps/web/package.json"
    - "tools/lint-english.ts"
    - ".github/workflows/web.yml"
decisions:
  - "Cookie precedence over Accept-Language (D-I18N-W1) — explicit user intent always wins; matches Next.js examples"
  - "Two-locale matrix (en + ru) — additional locales added by extending SUPPORTED_LOCALES + adding ru/ peer directory; no architectural change"
  - "i18next-ICU registered on BOTH server factory and client constructor (D-I18N-W2) — CLDR plural rules byte-equal across SSR and CSR re-renders"
  - "LanguageSwitcher mounted in TWO layouts (public + AppShell) instead of root layout — RSC `headers()` already drives root layout; placing the switcher in the layout that needs it keeps the dependency direction one-way"
  - "Cookie is NOT httpOnly (NEXT_LOCALE) — needed for client-side fallback detection in a future plan, low risk (locale ≠ secret)"
  - "lint-english allowlist generalized to `**/locales/**` + `**/i18n/__tests__/**` + `**/__tests__/{i18n*,*-i18n}.test.*` — single rule covers web (this plan), api (Plan 10-01), and future packages"
  - "Coverage test in `src/locales/__tests__/coverage.test.ts` requires non-empty value per ru key but does NOT require Cyrillic per value (technical labels like 'Email', 'JSON' legitimately stay English); aggregate 70% Cyrillic floor across the bundle proves translation actually happened"
metrics:
  duration_wall_clock: "~3.3h (interleaved with Plan 10-01 work in parallel)"
  tasks_completed: "5/5"
  tests_added: "10 new test files + extensions to existing coverage.test.ts and middleware.test.ts"
  tests_passing: "763 (41 test files)"
  coverage:
    statements: "97.59%"
    branches: "92.66%"
    functions: "97.85%"
    lines: "98.45%"
  completed: "2026-05-13"
---

# Phase 10 Plan 02: Web Russian Translations + Locale Negotiation — Summary

One-liner: Full en+ru runtime for the Next.js 15 web tier with Edge-middleware locale
negotiation (cookie → Accept-Language → en), i18next-ICU plural parity across
SSR/CSR, language-switcher UI island, and an `/api/locale` POST cookie route.

## What Was Built

1. **Russian translation bundles** — `apps/web/src/locales/ru/{common,admin,end-user}.json`,
   mirroring the English bundles key-for-key (200+ keys spanning UI-SPEC Appendix C).
   Natural Russian translations; technical labels (`Email`, `JSON`, endpoint paths,
   brand names) intentionally preserved.

2. **Locale-negotiation pipeline** —
   - `middleware.ts` widened from `/app/:path*` to `/((?!_next/|favicon|.*\..*).*)`,
     adding a pure `resolveLocale(req)` function that follows the precedence chain
     `NEXT_LOCALE cookie → Accept-Language (via accept-language-parser) → "en"`.
     The auth-gate logic for `/app/*` is preserved; locale negotiation runs before
     it so the redirect-to-/sign-in path still benefits from `x-locale`.
   - `layout.tsx` reads `headers().get('x-locale')` and passes the resolved `lng`
     into `getServerI18n` and `<html lang>`.
   - `i18n.ts` and `i18n-client.tsx` both register the `i18next-icu` plugin so
     CLDR plural rules render identically on server and client.

3. **/api/locale route handler** — zod-validated POST `{locale: 'en'|'ru'}`, sets
   `NEXT_LOCALE` cookie (`SameSite=Lax`, `Max-Age=31536000`, `httpOnly: false`),
   returns 204. Errors return the canonical `{ error: { code, message } }` envelope
   with `code: "INVALID_LOCALE"`.

4. **LanguageSwitcher UI island** — `fieldset`-based accessible button group with
   `aria-pressed`, mounted in both `(public)/layout.tsx` (for sign-in/sign-up/verify)
   and `AppShell.tsx` (for authenticated routes). Labels come exclusively from
   i18n keys (`common.language.english.label`, `common.language.russian.label`).

5. **Test surface** —
   - `locale-negotiation.test.ts` — 7 cases driving the middleware against synthetic
     `NextRequest` instances (cookie precedence, q-weighted Accept-Language picking,
     unsupported locale fallback, /app auth-redirect path still 307s).
   - `i18n-russian-coverage.test.ts` — structural en↔ru parity (no missing keys,
     no Russian-only orphans, no empty values).
   - `web-plural-rules.test.ts` — CLDR ru plural categories at boundary integers
     0/1/2/3/5/11/21/22/25/101/105 via i18next-ICU, asserted against marker
     substrings (`ONE_ARM` / `FEW_ARM` / `MANY_ARM`) embedded in the `common.test.plural.unread`
     translation.
   - `coverage.test.ts` — extended to drive ru bundles in addition to en (per-key
     presence + aggregate 70%-Cyrillic floor).
   - `language-switcher.test.tsx` — 3 cases (button rendering + aria-pressed, POST+refresh,
     no-op when clicking the active locale).
   - `route.test.ts` (`/api/locale`) — 5 cases (en + ru happy paths, unsupported
     locale rejection, malformed-JSON rejection, missing-field rejection).
   - `i18n-russian.spec.ts` (Playwright e2e) — 2 cases (cookie-pre-set Russian render
     + hydration-error capture, click-switcher persistence across reload).

## TDD Gate Compliance

- RED commit (`df6b176`): all 4 new test files + extended coverage.test.ts FAIL.
  Verified: `237 failed | 235 passed` in the targeted vitest run.
- GREEN commits (`94dfa46`, `ac9041f`, `20cacda`): tests progressively turn green
  as each implementation lands.
- Final vitest run: 763 passing across 41 files. No skips.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Extended `tools/lint-english.ts` allowlist**
- **Found during:** Task 1 (RED commit setup)
- **Issue:** Plan asserted "lint-english allowlist already covers `apps/web/src/locales/ru/**`
  via the regex on `apps/web/src/locales/**`" — incorrect. The allowlist only had
  `packages/i18n/locales/**` and `tests/fixtures/i18n/**`. Russian JSON files and
  the e2e spec (which intentionally embeds Russian phrases) would have failed the
  pre-commit Cyrillic scan.
- **Fix:** Generalized the allowlist to `**/locales/**` + `**/i18n/__tests__/**` +
  `**/__tests__/{i18n*,*-i18n}.test.*`. The single rule covers this plan's web
  bundles, Plan 10-01's `apps/api/src/i18n/` bundles, the i18n test files in both
  apps, and any future package.
- **Files modified:** `tools/lint-english.ts`
- **Commits:** `df6b176`, `ac9041f`, `20cacda`

**2. [Rule 1 — Bug] Test-only key `common.test.plural.unread` initially orphaned in ru**
- **Found during:** Task 2 (GREEN ru-coverage run)
- **Issue:** Added the ICU-plural test key only to ru/common.json; the parity test
  (`i18n-russian-coverage.test.ts` — `no Russian-only orphan keys absent from English`)
  correctly caught it.
- **Fix:** Added a simpler English counterpart (`{count, plural, one{# unread message}
  other{# unread messages}}`) to en/common.json. The web tier never renders this
  surface — it exists purely so the plural-rules test has a real ICU template to
  exercise.
- **Files modified:** `apps/web/src/locales/en/common.json`
- **Commit:** `94dfa46`

**3. [Rule 1 — Bug] Initial plural-rules test wrapped resources at wrong depth**
- **Found during:** Task 2 verification
- **Issue:** The test passed `resources: { ru: commonRu }`, but the production
  pattern (`getServerI18n` + `resourceStore.data[lng]`) doubles the namespace
  wrap: `{ ru: { common: <commonRu> } }`. Lookups against `common.test.plural.unread`
  resolved to the key itself.
- **Fix:** Mirror the production wrap structure in the test.
- **Files modified:** `apps/web/src/lib/__tests__/web-plural-rules.test.ts`
- **Commit:** `94dfa46`

**4. [Rule 1 — Bug] Coverage test's Cyrillic-per-value check was over-strict**
- **Found during:** Task 2 GREEN
- **Issue:** Required every ru bundle value to contain a Cyrillic codepoint. Failed
  on legitimate technical labels (`Email`, `JSON`, endpoint URL strings, brand names).
- **Fix:** Weakened the per-key check to non-empty string only; added an aggregate
  assertion that ≥70% of UI-SPEC values contain Cyrillic (proves translation
  happened without forcing churn for every English-by-design label).
- **Files modified:** `apps/web/src/locales/__tests__/coverage.test.ts`
- **Commit:** `94dfa46`

**5. [Rule 1 — Bug] `<div role="group">` flagged by biome a11y rule**
- **Found during:** Task 4 commit (biome pre-commit hook)
- **Issue:** Biome's `lint/a11y/useSemanticElements` requires `<fieldset>` over
  `<div role="group">`.
- **Fix:** Switched to `<fieldset>` with `aria-label`, reset native border/padding
  via Tailwind utilities. Tests still pass — Testing Library finds the buttons
  by role.
- **Files modified:** `apps/web/src/components/screens/language-switcher.tsx`
- **Commit:** `20cacda`

**6. [Rule 1 — Bug] Existing middleware test asserted old narrow matcher**
- **Found during:** Task 3 GREEN
- **Issue:** Phase 07.1 test (`middleware.test.ts:54`) asserted
  `expect(config.matcher).toEqual(["/app/:path*"])`. Plan 10-02 deliberately
  widens the matcher to also catch public + auth routes for locale negotiation.
- **Fix:** Updated the assertion to match the new matcher and replaced the
  obsolete D-ADMIN-1 narrative with a clarified comment that `/admin/*` is still
  excluded by the new regex (covered by Traefik basic-auth per D-ADMIN-1).
- **Files modified:** `apps/web/src/lib/__tests__/middleware.test.ts`
- **Commit:** `ac9041f`

### None (Architectural)

No Rule 4 architectural deviations.

## Authentication Gates

None encountered.

## Self-Check

### Files exist

- apps/web/src/locales/ru/common.json: FOUND
- apps/web/src/locales/ru/admin.json: FOUND
- apps/web/src/locales/ru/end-user.json: FOUND
- apps/web/src/middleware.ts: FOUND (widened matcher, x-locale emission)
- apps/web/src/app/layout.tsx: FOUND (reads x-locale)
- apps/web/src/lib/i18n.ts: FOUND (ICU plugin)
- apps/web/src/lib/i18n-client.tsx: FOUND (ICU plugin)
- apps/web/src/components/screens/language-switcher.tsx: FOUND
- apps/web/src/app/api/locale/route.ts: FOUND
- apps/web/src/app/__tests__/locale-negotiation.test.ts: FOUND
- apps/web/src/lib/__tests__/i18n-russian-coverage.test.ts: FOUND
- apps/web/src/lib/__tests__/web-plural-rules.test.ts: FOUND
- apps/web/tests/e2e/i18n-russian.spec.ts: FOUND

### Commits exist

- df6b176: FOUND (RED)
- 94dfa46: FOUND (Russian bundles)
- ac9041f: FOUND (middleware + layout + ICU)
- 20cacda: FOUND (LanguageSwitcher + /api/locale)
- 623db39: FOUND (CI gate)

## Self-Check: PASSED

## Known Stubs

None.

## Threat Flags

None — no new network-exposed surface beyond `/api/locale` which is a same-origin
cookie-set route with strict zod validation.

## Open Followups (out of scope for this plan)

1. The e2e spec (`tests/e2e/i18n-russian.spec.ts`) was not run in this plan
   because the full docker-compose stack was not booted locally. It will run
   on the next PR pipeline (the existing `.github/workflows/web.yml`
   `playwright` job picks up `tests/e2e/*.spec.ts` automatically).
2. `apps/api` Russian error-envelope work is owned by Plan 10-01 (running in
   parallel). Their files appeared as untracked while this plan was in flight;
   the `tools/lint-english.ts` allowlist update here intentionally accommodates
   them so they will commit cleanly.
3. Future locale additions: extend `SUPPORTED_LOCALES` in `middleware.ts` and
   add a peer directory under `apps/web/src/locales/<lng>/`. No code changes
   elsewhere.
