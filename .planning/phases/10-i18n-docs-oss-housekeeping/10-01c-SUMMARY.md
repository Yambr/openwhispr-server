---
phase: 10
plan: 10-01c
subsystem: api + data + auth + i18n
tags: [i18n, auth, better-auth, drizzle, migration, bullmq, email-delivery]
requires: [10-01a, 10-01b]
provides:
  - users.locale column (NOT NULL DEFAULT 'en' CHECK ('en'|'ru'))
  - Drizzle schema users.locale field
  - Better Auth user.additionalFields.locale (sign-up input, get-session round-trip)
  - BuildAuthOptions.enqueueEmail DI for sendVerificationEmail hook
  - BullMQ email-delivery queue wired in apps/api/src/index.ts entrypoint
affects:
  - packages/data/migrations/0016_users_locale.sql
  - packages/data/src/schema/users.ts
  - apps/api/src/auth.ts (BuildAuthOptions + sendVerificationEmail branch)
  - apps/api/src/index.ts (entrypoint queue wiring)
  - apps/api/package.json (+bullmq)
tech-stack:
  added: [bullmq@^5.16.0 (api)]
  patterns: [optional-DI for queue enqueue, VALKEY_URL-gated queue construction, fall-through to inline SMTP when queue absent]
key-files:
  created:
    - packages/data/migrations/0016_users_locale.sql
    - packages/data/migrations/__tests__/0016-users-locale.test.ts
    - apps/api/src/__tests__/auth-locale-and-enqueue.test.ts
  modified:
    - packages/data/migrations/meta/_journal.json
    - packages/data/src/schema/users.ts
    - apps/api/src/auth.ts
    - apps/api/src/index.ts
    - apps/api/package.json
    - .planning/phases/10-i18n-docs-oss-housekeeping/deferred-items.md
decisions:
  - "Use canonical worker template id 'email_verification' (confirmed by 10-01b SUMMARY) — not 'verify-email'."
  - "EmailDeliveryPayload declared structurally in auth.ts (not imported from worker) to keep api → worker dep direction clean. Worker re-parses via Zod at job pickup."
  - "Queue construction gated on VALKEY_URL — when unset, enqueueEmail stays undefined and buildAuth falls through to inline email.send (backward compat for all 8 pre-existing buildAuth call sites)."
  - "user.tenantId fallback to zero-UUID when hook payload omits tenant context — keeps the worker Zod schema parseable; worker logs per-tenant warning."
metrics:
  duration: ~14m
  completed: 2026-05-13
---

# Phase 10 Plan 10-01c: users.locale + Better Auth additionalFields + enqueueEmail DI Summary

## What shipped

A per-user `locale` column wired end-to-end: Postgres CHECK-constrained
column, Drizzle schema field, Better Auth `additionalFields` declaration
(so sign-up accepts `locale` and get-session round-trips it), and an
optional `enqueueEmail` DI on `BuildAuthOptions` that routes Better Auth's
`sendVerificationEmail` hook through the BullMQ email-delivery queue —
landing on the locale-aware templates rendered by the Plan 10-01b worker.
The production API entrypoint (`apps/api/src/index.ts`) constructs the
queue when `VALKEY_URL` is configured; OSS quickstart deploys without
Valkey keep the existing inline SMTP path.

## Commits

| # | Hash       | Subject                                                                                  |
|---|------------|------------------------------------------------------------------------------------------|
| 1 | `edfaa53`  | feat(10-01c): add users.locale column (en/ru) + drizzle schema                           |
| 2 | `e94a064`  | feat(10-01c): better auth user.locale additionalfield + enqueueemail di                  |
| 3 | `ad79bdf`  | feat(10-01c): wire bullmq email-delivery queue to better auth in api entrypoint          |

## Tests added (strict TDD — RED → GREEN per task)

- `packages/data/migrations/__tests__/0016-users-locale.test.ts` — 3 tests
  via Postgres 17.5-pgpartman testcontainer: column shape (text NOT NULL
  DEFAULT 'en'), CHECK constraint rejects 'fr' / accepts 'en'+'ru',
  inserted rows without explicit locale default to 'en'.
- `apps/api/src/__tests__/auth-locale-and-enqueue.test.ts` — 5 tests:
  additionalFields.locale config shape, enqueue path with template_id
  `email_verification` + variables `{url}`, locale fallback to 'en' when
  hook payload omits it, backward-compat inline `email.send` path
  preserved when enqueueEmail unset, error propagation (REDIS_DOWN).

All 5/5 + 3/3 green. `apps/worker` suite still 160/160 green.

## Deviations from plan

None. Plan executed as specified.

## Deferred / Pre-existing (out of scope per Rule 4)

17 `apps/api` integration test files fail with `code:3F000` (Postgres
schema missing) when the `openwhispr/postgres:17.5-pgpartman` testcontainer
image is not present locally. Confirmed pre-existing via `git stash` on
both HEAD and pre-edit baselines. Logged to deferred-items.md.

## Self-Check: PASSED

- packages/data/migrations/0016_users_locale.sql: FOUND
- packages/data/migrations/__tests__/0016-users-locale.test.ts: FOUND
- apps/api/src/__tests__/auth-locale-and-enqueue.test.ts: FOUND
- Commit edfaa53: FOUND
- Commit e94a064: FOUND
- Commit ad79bdf: FOUND
