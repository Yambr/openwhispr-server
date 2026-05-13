---
phase: 10
plan: 01a
subsystem: i18n / api
tags: [i18n, server, api, i18next, icu, fastify, errors]
requires:
  - typed-errors (apps/api/src/errors.ts)
  - centralized setErrorHandler (apps/api/src/error-handler.ts)
provides:
  - apps/api/src/i18n/init.ts (i18n instance + Fastify plugin)
  - apps/api/src/i18n/locales/{en,ru}.json (errors namespace)
  - readonly `code` on every typed-error class
  - test:i18n-completeness pnpm alias (ts-morph scan)
affects:
  - error-handler.ts (localizes envelope via req.i18n)
  - buildApp (registers i18nPlugin after requestLog)
  - tsup.config.ts (copies locales into dist on build)
key-files:
  created:
    - apps/api/src/i18n/init.ts
    - apps/api/src/i18n/locales/en.json
    - apps/api/src/i18n/locales/ru.json
    - apps/api/src/i18n/__tests__/init.test.ts
    - apps/api/src/i18n/__tests__/i18n-completeness.test.ts
    - apps/api/src/__tests__/errors-code.test.ts
    - apps/api/src/__tests__/error-handler-i18n.test.ts
  modified:
    - apps/api/src/errors.ts
    - apps/api/src/error-handler.ts
    - apps/api/src/index.ts
    - apps/api/tsup.config.ts
    - apps/api/package.json
    - package.json
    - pnpm-lock.yaml
metrics:
  tasks_completed: 8
  duration: ~12m
  completed: 2026-05-13
---

# Phase 10 Plan 10-01a: Server i18n bootstrap (API only) Summary

Wired the apps/api i18n surface: an i18next + ICU instance preloaded with
en/ru `errors` resources, a Fastify plugin that mounts the
i18next-http-middleware as a preHandler hook (Accept-Language steers
translation), readonly `code` literals on every typed-error class, and a
ts-morph completeness scanner that fails CI if a class is added without
both locale translations.

## What changed

### 1. Typed error codes (`apps/api/src/errors.ts`)

Each of the six typed-error classes (`ValidationError`, `AuthError`,
`NotFoundError`, `RateLimitError`, `ServiceUnavailable`, `ServerError`)
now carries a `readonly code` literal (`VALIDATION_ERROR`, `AUTH_ERROR`,
etc.). The handler uses this code to look up `errors.<code>` via
i18next.

### 2. i18n init (`apps/api/src/i18n/init.ts`)

- Process-wide singleton, initialized synchronously at module load (zero
  IO latency at request time).
- Locale dir resolution: `LOCALES_DIR` env override → bundled
  `dist/i18n/locales/` (preferred, populated by tsup) → source-tree
  `src/i18n/locales/` fallback.
- ICU formatter registered (no patterns shipped in 10-01a but ready for
  10-01b plural forms).
- `i18nPlugin` adapts the Connect-style `i18next-http-middleware` to a
  Fastify 5 preHandler hook (no `@fastify/middie` dependency).
- `nsSeparator: "."` + `keySeparator: false` so call sites use the
  `errors.<CODE>` form mandated by the plan.

### 3. Locale files (`apps/api/src/i18n/locales/{en,ru}.json`)

All six codes translated, ru in formal form. Cyrillic isolated to ru.json
(allowlisted by `tools/lint-english.ts` via `**/locales/**`).

### 4. Error-handler i18n integration (`apps/api/src/error-handler.ts`)

Each typed-error branch now sets `code = err.code` and the final
emission calls `localize(req, code, message)` which does
`req.i18n?.t(`errors.${code}`, { defaultValue: message })`. When
`req.i18n` is absent (legacy boot, pre-plugin tests) the constructor
message flows through untouched — preserves the contract pinned by
`error-handler.test.ts`.

Split the dual `RateLimitError || statusCode===429` branch and the dual
`ServiceUnavailable || statusCode===503` branch so only the typed-error
path carries a code; fastify's own statusCode-bearing errors flow
through the literal path.

### 5. Plugin registration (`apps/api/src/index.ts`)

`i18nPlugin` registered right after `requestLog` and before dual-auth /
routes, so every downstream hook + the error handler sees a populated
`req.i18n`.

### 6. Build pipeline (`apps/api/tsup.config.ts`)

`onSuccess` hook copies `src/i18n/locales/{en,ru}.json` into
`dist/i18n/locales/` so the bundled container can resolve locales from
the same relative path that vitest uses.

### 7. ts-morph completeness scan (`apps/api/src/i18n/__tests__/i18n-completeness.test.ts`)

Walks every `apps/api/src/**/*.ts` (skipping test files), collects every
`throw new <TypedErrorClass>(…)` expression, and asserts each
class-to-code mapping has an `errors.<code>` key in both en.json and
ru.json. Also checks ru.json contains Cyrillic for every code and en+ru
have identical key sets.

### 8. pnpm script

```json
"test:i18n-completeness": "vitest run src/i18n/__tests__/i18n-completeness.test.ts"
```

Root alias added too: `pnpm test:i18n-completeness` delegates to the
apps/api workspace.

## Tests

| Suite | Tests | Status |
|-------|-------|--------|
| `src/i18n/__tests__/init.test.ts` | 8 | green |
| `src/i18n/__tests__/i18n-completeness.test.ts` | 5 | green |
| `src/__tests__/errors-code.test.ts` | 6 | green |
| `src/__tests__/error-handler-i18n.test.ts` | 8 | green |
| `src/error-handler.test.ts` (regression) | 22 | green |
| **TOTAL** | **49** | **all green** |

## Commits

- `75e9fe2` — feat(10-01a): add readonly i18n code literals to typed error classes
- `fbd98e0` — feat(10-01a): i18next + icu bootstrap with en/ru error locales
- `f0aba87` — feat(10-01a): localize centralized error envelope via req.i18n

## Deviations

- **[Rule 3 — Blocking]** `i18next-http-middleware` ships a Connect-style
  handler but Fastify 5 has no `app.use`. Chose to adapt to a
  `preHandler` hook (mirrors `req.raw.i18n` onto `req.i18n`) rather than
  add `@fastify/middie` as a new top-level dep — smaller surface, no
  Connect compat shim. Documented inline.
- **[Rule 3 — Blocking]** `initImmediate: false` rejected by InitOptions
  type for the installed i18next 26.x; dropped — resources are still
  pre-loaded synchronously via the `resources` field, so the lookup
  path is just as fast.
- **[Rule 1 — Format]** Biome auto-fixed import order in init.ts.

## Out of scope (per scope-boundary rule)

Pre-existing test failures observed during the full `pnpm test` run
were NOT introduced by this plan (baseline-confirmed via `git stash`).
Logged to
`.planning/phases/10-i18n-docs-oss-housekeeping/deferred-items.md`:
- `scripts/check-default-secrets.test.ts` (4 tests) — path-doubling bug
- conversation / folder / note / transcription integration tests —
  testcontainer teardown noise
- `rate-limit-isolation T3` — unauthenticated requests now hit the
  rate-limit bucket on baseline

## Known stubs

None. The plan delivered the full API i18n surface for the 6 typed-error
codes. Wide-spread `reply.send({error: …})` callsite migration and the
worker template renderer + audit Cyrillic guard are intentionally
deferred to 10-01b/c/d per the planning split.

## Self-Check: PASSED

- `apps/api/src/i18n/init.ts` exists ✓
- `apps/api/src/i18n/locales/en.json` + `ru.json` exist ✓
- All three commits exist in `git log` ✓
- 49/49 i18n-related tests green ✓
- `pnpm test:i18n-completeness` green ✓
- Biome clean on all touched files ✓
- TypeScript clean on all touched files ✓
- `pnpm lint:english` green ✓ (locales + i18n test files allowlisted)
