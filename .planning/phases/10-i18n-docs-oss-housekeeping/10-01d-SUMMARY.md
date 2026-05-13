---
phase: 10
plan: 10-01d
subsystem: i18n + audit-log + ci
tags: [i18n, audit-log, ci, error-handler, typed-errors]
requires: [10-01a, 10-01b, 10-01c]
provides: [audit-cyrillic-guard, locale-volume-mount, i18n-ci-gate, per-site-i18n-codes]
key-files:
  created: []
  modified:
    - apps/api/src/lib/audit.ts
    - apps/api/src/lib/audit.test.ts
    - apps/api/src/errors.ts
    - apps/api/src/error-handler.ts
    - apps/api/src/i18n/__tests__/i18n-completeness.test.ts
    - apps/api/src/i18n/locales/en.json
    - apps/api/src/i18n/locales/ru.json
    - apps/worker/tsup.config.ts
    - docker-compose.yml
    - .github/workflows/ci.yml
    - 37 route files under apps/api/src/routes/**
decisions:
  - "Two-arg overload `new <Class>(code, message)` keeps existing 1-arg call-sites working while opting per-site translations in via the new slot."
  - "Cyrillic guard fails LOUD (no log, no INSERT) so it surfaces programmer mistakes the same way the forbidden-keys sweep does."
  - "Operator LOCALES_DIR bind mount points at the source-tree JSON so re-translations are a compose restart, not a rebuild."
  - "Dedicated `i18n-completeness` CI job (separate from `test`) so the failure surface is immediately legible on PR checks."
metrics:
  duration: 25 minutes
  commits: 6
  files-touched: 47
---

# Phase 10 Plan 10-01d: Audit Cyrillic Guard + Locale Volume Mount + CI Gate + 70-Site Conversion Summary

One-liner: Final 10-01 sub-step — adds a fail-loud Cyrillic guard on `audit_log.payload`, mounts api/worker locale directories as operator-overridable volumes, wires an `i18n-completeness` job into GitHub Actions, and migrates all 70 inline `reply.code(N).send({error:...})` sites in apps/api/src/routes/** to typed-error throws with per-site i18n codes and en/ru translations.

## Deliverables

1. **Audit-log Cyrillic guard (T-10-01 mitigation)** — `apps/api/src/lib/audit.ts` exports `AuditCyrillicError` plus a recursive `assertEnglishOnly` scanner that runs on the payload AND the ctx user_agent before the INSERT. Regex covers U+0400-U+04FF + Supplement + Extended-A/B; built only from `\u` escapes so `tools/lint-english.ts` does not self-flag. Seven new tests cover happy-path, top-level hit, nested hit, ctx user_agent hit, numeric/boolean pass-through, no-row-on-hit (transaction rollback), and the error-class shape.

2. **docker-compose `LOCALES_DIR` mount** — api service gains `LOCALES_DIR=/app/locales` env + bind mount `./apps/api/src/i18n/locales:/app/locales:ro`. Worker mirrors the shape against `./apps/worker/src/i18n/locales`. Worker tsup config gains an `onSuccess copyLocalesToDist` hook so the bundled image carries `dist/i18n/locales/{en,ru}/email/**` out of the box; the bind mount remains the operator-override path without requiring a rebuild.

3. **CI workflow YAML gate** — `.github/workflows/ci.yml` gains an `i18n-completeness` job that runs `pnpm test:i18n-completeness` on every PR and main push. Fails when any TypedError code is missing in en.json OR ru.json, when key sets diverge, or when a ru translation is left as Latin script. Standalone job so the failure surface is immediately legible.

4. **Bulk conversion of 70 inline error sites** — every `return reply.code(N).send({ error: "..." })` in `apps/api/src/routes/**/*.ts` (excluding tests) now throws a typed error. Two new typed-error classes added to `errors.ts`: `UpstreamError` (502, distinct from `ServiceUnavailable` 503 + `SSRFBlockedError` 502) and `ConflictError` (409). Constructor overload `(code, message)` allows per-site i18n codes while preserving the legacy `(message)` form for existing throws. The centralized `error-handler.ts` was extended to map the two new classes; `i18n-completeness.test.ts` was extended to scan `NewExpression` args for per-instance codes and assert each has en + ru translations.

## Per-site code inventory (70 total)

- **AuthError (401, code=UNAUTHORIZED)** — 33 sites across routes/conversations, routes/folders, routes/notes, routes/transcriptions, routes/v1/keys, routes/agent/web-search, routes/diarization, routes/reason, routes/transcribe, routes/usage, routes/streaming-usage, routes/stt-config, routes/note-recording-config, routes/tokens/openai-realtime.
- **NotFoundError (404)** — 9 sites with codes CONVERSATION_NOT_FOUND, FOLDER_NOT_FOUND, TRANSCRIPTION_NOT_FOUND, NOTE_NOT_FOUND, API_KEY_NOT_FOUND.
- **ValidationError (400)** — 18 sites with codes BATCH_TOO_LARGE, QUERY_REQUIRED, METADATA_TOO_LARGE, CONVERSATION_ID_REQUIRED, INVALID_UUID, INVALID_ID, INVALID_STREAMS_COUNT, MULTIPART_REQUIRED, MULTIPART_FILE_FIELD_REQUIRED, MULTIPART_FILE_FIELD_MISSING, FILE_TOO_LARGE.
- **ConflictError (409)** — 1 site with code API_KEY_NAME_TAKEN.
- **UpstreamError (502)** — 5 sites with codes TRANSCRIPTION_UPSTREAM_FAILED, REASONING_UPSTREAM_FAILED, WEB_SEARCH_UPSTREAM_FAILED, DIARIZATION_JOB_FAILED, PYANNOTE_REJECTED, PYANNOTE_UPSTREAM.
- **ServiceUnavailable (503)** — 4 sites with codes WEB_SEARCH_NOT_CONFIGURED, WEB_SEARCH_PROVIDER_KEY_MISSING, PYANNOTE_UNAVAILABLE.

All codes have en + ru translations enforced by the extended i18n-completeness scanner. ru translations use formal вы-form.

## Commit hash chain

| # | Hash | Summary |
|---|------|---------|
| 1 | 8e1f4e5 | feat(10-01d): audit-log cyrillic guard (T-10-01 mitigation) |
| 2 | 70997d3 | feat(10-01d): locales_dir bind mount for api + worker (operator override) |
| 3 | e4239e3 | ci(10-01d): add i18n-completeness gate to required ci jobs |
| 4 | 9779c85 | feat(10-01d): per-instance i18n codes + upstream/conflict typed errors |
| 5 | 3551859 | feat(10-01d): convert 401 unauthorized sites to AuthError + i18n codes (33 files) |
| 6 | aa18211 | feat(10-01d): convert remaining 37 inline error sites to typed-error throws |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical functionality] Two new typed-error classes (UpstreamError, ConflictError)**
- **Found during:** Task 4 bulk conversion design
- **Issue:** Original `errors.ts` lacked 502 and 409 mappings; existing 502/409 inline sends had no semantically-correct typed-error class to throw.
- **Fix:** Added `UpstreamError extends Error` (mapped to 502 in centralized handler) and `ConflictError extends Error` (mapped to 409). Distinct from `ServiceUnavailable` (503 — OUR infra) and `SSRFBlockedError` (502 — outbound policy).
- **Files modified:** apps/api/src/errors.ts, apps/api/src/error-handler.ts
- **Commit:** 9779c85

**2. [Rule 2 — missing critical functionality] Per-instance i18n-completeness scanner**
- **Found during:** Task 4 design
- **Issue:** The existing scanner only verified the 6 class-default codes; per-site codes (introduced by the (code, message) overload) had no automated parity check.
- **Fix:** Extended `collectThrownClasses()` to return both `classes` and `perInstanceCodes` (a `Map<code, firstSite>`). New test asserts each per-instance code has en + ru translations and reports the first throw site on failure.
- **Files modified:** apps/api/src/i18n/__tests__/i18n-completeness.test.ts
- **Commit:** 9779c85

**3. [Rule 3 — blocking issue] Naming clash in agent/web-search.ts**
- **Found during:** Task 4 bulk conversion
- **Issue:** `apps/api/src/lib/web-search/types.ts` exports a local `UpstreamError` class consumed by the route's catch block. Importing the new typed `UpstreamError` from `errors.ts` would shadow it.
- **Fix:** Imported the new typed classes with `TypedServiceUnavailable` / `TypedUpstreamError` aliases so the route can throw the canonical typed-error while still catching the local `UpstreamError` adapter type.
- **Files modified:** apps/api/src/routes/agent/web-search.ts
- **Commit:** aa18211

**4. [Rule 1 — lint regression exposed by formatter] `let parsed;` annotations**
- **Found during:** Task 4 batch 1 pre-commit
- **Issue:** Biome's auto-formatter reformatted multi-line imports during pre-commit on the converted routes; reformatting surfaced pre-existing `let parsed;` patterns (5 sites) which biome flagged as `noImplicitAnyLet`.
- **Fix:** Added explicit `let parsed: ReturnType<typeof parseListQuery>;` annotations on all 5 sites.
- **Files modified:** apps/api/src/routes/conversations/list.ts, apps/api/src/routes/conversations/messages.ts, apps/api/src/routes/folders/list.ts, apps/api/src/routes/notes/list.ts, apps/api/src/routes/transcriptions/list.ts
- **Commit:** 3551859

### Deferred / Out of scope

- **Multi-line `reply.code(N).send({ error: ..., extra })`** sites in `apps/api/src/routes/diarization.ts` (10 sites carrying extra metadata like `jobId`) were NOT in the original 70 (single-line scan). They preserve their inline form because their error envelopes carry extra fields beyond `{error}` and migrating them is a wider envelope-contract change. Tracked in `deferred-items.md` for future i18n hardening if/when the wire contract is amended.

- **rate-limit-isolation integration test T3** is pre-existing red on `main` (verified by `git stash` baseline). Not introduced by this plan. Already covered in `deferred-items.md`.

## Self-Check: PASSED

- All commit hashes exist in `git log` (verified via `git log --oneline 8e1f4e5..aa18211`).
- All listed file paths exist in the working tree.
- `pnpm test:i18n-completeness` green (6/6 tests).
- `pnpm lint:english` green (850 files scanned).
- 0 remaining single-line `reply.code(N).send({ error: ... })` sites in `apps/api/src/routes/**` (excluding tests).
- 48/48 audit.test.ts green.
- 36/36 error-handler.test.ts + error-handler-i18n.test.ts + error-handler-better-auth-apierror.test.ts green.
- 39/39 unit tests on converted multi-site files (diarization, reason, agent/web-search, conversations/messages) green.
