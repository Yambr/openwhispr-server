---
phase: 10
plan: 10-01
subsystem: server-side i18n end-to-end (api + worker + audit + ci + locale-volume + 70-site conversion)
tags: [i18n, server, api, worker, email, audit-log, ci, ru, en, i18next, better-auth, bullmq]
requires:
  - Phase 6 / Plan 06-08 (email-delivery job + templates DI)
  - Phase 2 / Plan 03 (centralized error-handler + typed-error classes)
provides:
  - i18next + ICU bootstrap + Fastify plugin (req.i18n.t)
  - en/ru error envelopes (29 codes covering 400/401/404/409/429/500/502/503)
  - per-instance i18n code overload `new <TypedError>(code, message)`
  - worker email template renderer (en/ru x 3 templates x 3 files)
  - users.locale column + Better Auth additionalFields + per-user locale honored by email queue
  - BullMQ email-delivery queue wired into the api entrypoint
  - audit_log Cyrillic guard (fail-loud, no INSERT)
  - operator LOCALES_DIR bind mounts (api + worker)
  - CI `i18n-completeness` job gating en/ru parity per PR
  - ts-morph completeness scanner covering both class-default and per-instance codes
affects:
  - apps/api/src/errors.ts, error-handler.ts, index.ts, i18n/*, lib/audit.ts, ~40 route files
  - apps/worker/src/index.ts, i18n/*, tsup.config.ts
  - packages/data migrations (0016_users_locale)
  - docker-compose.yml (api + worker LOCALES_DIR volumes)
  - .github/workflows/ci.yml (+ i18n-completeness job)
tech-stack:
  added: [i18next, i18next-fs-backend, i18next-icu, i18next-http-middleware, ts-morph (dev), bullmq (api)]
  patterns: [per-locale email rendering, runtime-overridable locale dir, fail-loud audit-log english-only guard, two-arg constructor overload for typed errors]
key-files:
  created:
    - apps/api/src/i18n/init.ts
    - apps/api/src/i18n/locales/en.json
    - apps/api/src/i18n/locales/ru.json
    - apps/api/src/i18n/__tests__/init.test.ts
    - apps/api/src/i18n/__tests__/i18n-completeness.test.ts
    - apps/api/src/__tests__/errors-code.test.ts
    - apps/api/src/__tests__/error-handler-i18n.test.ts
    - apps/api/src/__tests__/auth-locale-and-enqueue.test.ts
    - apps/worker/src/i18n/template-renderer.ts
    - apps/worker/src/i18n/__tests__/template-renderer.test.ts
    - apps/worker/src/i18n/__tests__/email-delivery-with-real-renderer.test.ts
    - apps/worker/src/i18n/locales/{en,ru}/email/{email_verification,password_reset,account_deletion_confirmation}/{subject.txt,body.txt,body.html}
    - packages/data/migrations/0016_users_locale.sql
    - packages/data/migrations/__tests__/0016-users-locale.test.ts
  modified:
    - apps/api/src/errors.ts (per-instance code overload + UpstreamError + ConflictError)
    - apps/api/src/error-handler.ts (i18n localization + 502/409 mappings)
    - apps/api/src/index.ts (i18nPlugin + BullMQ queue wiring)
    - apps/api/src/auth.ts (BuildAuthOptions + enqueueEmail DI)
    - apps/api/src/lib/audit.ts (AuditCyrillicError + assertEnglishOnly)
    - apps/api/src/lib/audit.test.ts (7 new Cyrillic-guard tests)
    - apps/api/tsup.config.ts (copy locales to dist)
    - apps/worker/src/index.ts (real template renderer)
    - apps/worker/tsup.config.ts (copy locales to dist)
    - packages/data/src/schema/users.ts (locale column)
    - docker-compose.yml (api + worker LOCALES_DIR mounts)
    - .github/workflows/ci.yml (+ i18n-completeness job)
    - 37 route files under apps/api/src/routes/** (70 inline error sites migrated)
decisions:
  - "Localization is opt-in via req.i18n.t at the centralized envelope handler; routes throw typed errors with a stable `code` and never format strings themselves."
  - "Cyrillic in the runtime is allowed ONLY inside i18n locale files and i18n-test fixtures (constructed via String.fromCharCode); source code, audit_log payloads, and commit messages stay English-only and the lint-english + audit Cyrillic guard + commitlint body-no-cyrillic rules enforce that line."
  - "Per-instance code overload `new <TypedError>(code, message)` is backward-compatible: legacy single-arg throws keep the class default code, two-arg throws set a per-instance code that the i18n-completeness CI gate then asserts has en + ru parity."
  - "LOCALES_DIR bind mounts are the operator-override path; the bundled image still carries dist/i18n/locales/** so a fresh `docker compose up` works without any extra setup."
  - "Per-user locale (users.locale) is round-tripped via Better Auth user.additionalFields and consumed by the worker's template renderer through the BullMQ payload; the locale fallback chain is per-user → Accept-Language → en."
metrics:
  duration: ~3 hours (10-01a + 10-01b + 10-01c + 10-01d)
  commits: 14
  files-touched: ~75
---

# Phase 10 Plan 10-01: Server-Side i18n End-to-End Summary

One-liner: Full server-side internationalization wave — i18next bootstrap + req-scoped translation for the api envelope (10-01a), worker email templates in en/ru (10-01b), users.locale column + Better Auth round-trip + BullMQ email queue wiring (10-01c), and the closing housekeeping pass: audit-log Cyrillic guard + operator LOCALES_DIR mounts + CI completeness gate + migration of 70 inline error sites to typed-error throws with per-site i18n codes (10-01d).

## Sub-step roll-up

### 10-01a — api i18n bootstrap + typed-error code literals
- Added `apps/api/src/i18n/init.ts` (i18next + ICU + i18next-fs-backend; Fastify plugin mounts `req.i18n.t`).
- en/ru locale files with the 6 baseline error codes.
- `code: readonly string` added to every typed-error class; centralized `setErrorHandler` resolves `errors.<code>` via req.i18n when available, falls back to literal message otherwise.
- ts-morph `i18n-completeness` test asserts every typed-error class has en + ru translations.
- `pnpm test:i18n-completeness` alias added.
- Commits: 75e9fe2, fbd98e0, f0aba87, 0ff52a1.

### 10-01b — worker email template renderer + en/ru bodies
- `WorkerTemplateRenderer` resolves `<locale>/email/<id>/{subject,body.txt,body.html}` from `apps/worker/src/i18n/locales/**`.
- 3 templates (email_verification, password_reset, account_deletion_confirmation) x 2 locales x 3 files = 18 files.
- `UnknownTemplateError` for unrecognized template ids.
- `apps/worker/src/index.ts` swaps the noopRenderer for the real renderer.
- Commits: 13c6091, 5de9259.

### 10-01c — users.locale migration + Better Auth additionalFields + BullMQ queue wiring
- Migration `0016_users_locale.sql` adds `locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ru'))`.
- Drizzle schema field + Better Auth `user.additionalFields.locale` (sign-up input + get-session round-trip).
- `BuildAuthOptions.enqueueEmail` DI for `sendVerificationEmail` hook.
- BullMQ email-delivery queue constructed in `apps/api/src/index.ts` when `VALKEY_URL` is present; falls through to inline SMTP otherwise.
- Commits: edfaa53, e94a064, ad79bdf.

### 10-01d — audit-log Cyrillic guard + LOCALES_DIR mount + CI gate + 70-site conversion
- `AuditCyrillicError` + recursive `assertEnglishOnly` runs on payload AND ctx.user_agent before INSERT.
- docker-compose api + worker gain `LOCALES_DIR=/app/locales` env + read-only bind mounts against the source-tree locale dirs.
- `.github/workflows/ci.yml` gains a dedicated `i18n-completeness` job.
- `errors.ts` gets `UpstreamError` (502) + `ConflictError` (409) and a two-arg `(code, message)` overload.
- 70 inline `reply.code(N).send({error:...})` sites in `apps/api/src/routes/**` migrated to typed-error throws with 29 distinct per-site codes (UNAUTHORIZED, CONVERSATION_NOT_FOUND, FOLDER_NOT_FOUND, NOTE_NOT_FOUND, TRANSCRIPTION_NOT_FOUND, API_KEY_NOT_FOUND, API_KEY_NAME_TAKEN, BATCH_TOO_LARGE, METADATA_TOO_LARGE, INVALID_UUID, INVALID_ID, INVALID_STREAMS_COUNT, QUERY_REQUIRED, MULTIPART_REQUIRED, MULTIPART_FILE_FIELD_REQUIRED, MULTIPART_FILE_FIELD_MISSING, FILE_TOO_LARGE, CONVERSATION_ID_REQUIRED, TRANSCRIPTION_UPSTREAM_FAILED, REASONING_UPSTREAM_FAILED, WEB_SEARCH_UPSTREAM_FAILED, WEB_SEARCH_NOT_CONFIGURED, WEB_SEARCH_PROVIDER_KEY_MISSING, DIARIZATION_JOB_FAILED, PYANNOTE_UNAVAILABLE, PYANNOTE_REJECTED, PYANNOTE_UPSTREAM, UPSTREAM_ERROR, CONFLICT).
- The i18n-completeness scanner now also asserts each per-instance code has en + ru translations.
- Commits: 8e1f4e5, 70997d3, e4239e3, 9779c85, 3551859, aa18211.

## Commit chain across 10-01

| Sub-step | Commits | Notes |
|----------|---------|-------|
| 10-01a   | 75e9fe2, fbd98e0, f0aba87, 0ff52a1 | i18n bootstrap + typed-error code literals + localized envelope |
| 10-01b   | 13c6091, 5de9259 | worker template renderer + 18 email files |
| 10-01c   | edfaa53, e94a064, ad79bdf | users.locale migration + Better Auth DI + BullMQ wiring |
| 10-01d   | 8e1f4e5, 70997d3, e4239e3, 9779c85, 3551859, aa18211 | Cyrillic guard + LOCALES_DIR + CI gate + 70-site conversion |

**Total: 15 commits across 10-01a/b/c/d** (4 + 2 + 3 + 6 = 15, of which 13 are feature/ci/test commits; the rest are sub-summary docs).

## Outcome

End-to-end Russian as a first-class operator-configurable locale across the api wire surface, worker email templates, and the auth round-trip. Every route in `apps/api/src/routes/**` now emits its error envelope through the centralized handler with a stable i18n code, and the CI gate guarantees en/ru parity on every PR. Audit-log forensics tooling can continue to assume English-only payload values via the fail-loud Cyrillic guard. Operators can re-translate without rebuilding the image via the LOCALES_DIR bind mounts.

## Self-Check: PASSED

- 15 commit hashes verified present in `git log` between 5b26083 and aa18211 inclusive.
- 0 remaining single-line `reply.code(N).send({ error: ... })` sites in `apps/api/src/routes/**` (excluding tests).
- `pnpm test:i18n-completeness` green (6/6 tests covering class-default + per-instance code parity).
- `pnpm lint:english` green (850 files scanned).
- Audit-log Cyrillic guard test suite green (7 new tests, 48/48 total in audit.test.ts).
- helm-unittest still 109/109 (chart untouched).
