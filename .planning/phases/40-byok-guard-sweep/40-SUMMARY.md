---
phase: 40
plan: byok-guard-contract-tests-high-sweep
subsystem: byok-guard + contract-tests + wire-schemas
tags: [byok, redact-url, fetch-and-parse, wire-schemas, package-boundary]
requirements: [HIGH-FIX-BYOK-01, HIGH-FIX-BYOK-02, HIGH-FIX-BYOK-03]
dependency_graph:
  requires: [Phase 39 — strict wire-schemas]
  provides: [Wire schemas as the single canonical home for production route shapes; defence-in-depth redactor; strict envelope test helper]
  affects: [apps/api routes, contract tests, byok-guard]
tech_stack:
  added: []
  patterns: [private-field error class with toJSON() (LOCKER-05), drift-as-failure parity test]
key_files:
  created:
    - packages/wire-schemas/src/check-user.ts
    - packages/wire-schemas/src/verification-status.ts
    - packages/wire-schemas/src/delete-account.ts
    - packages/wire-schemas/src/reason.ts
    - packages/wire-schemas/src/diarization.ts
    - packages/byok-guard/tests/unit/__tests__/redact-url-completeness.test.ts
    - packages/byok-guard/tests/unit/__tests__/redact-url-parity.test.ts
    - packages/contract-tests/src/errors.ts
    - packages/contract-tests/tests/unit/helpers/__tests__/fetch-and-parse-envelope.test.ts
  modified:
    - packages/wire-schemas/src/index.ts
    - packages/contract-tests/src/schemas.ts
    - packages/contract-tests/src/index.ts
    - packages/contract-tests/src/helpers/http.ts
    - packages/byok-guard/src/redact-url.ts
    - packages/byok-guard/tests/unit/__tests__/redact-url.test.ts
    - apps/api/src/routes/check-user.ts
    - apps/api/src/routes/verification-status.ts
    - apps/api/src/routes/delete-account.ts
    - apps/api/src/routes/reason.ts
    - apps/api/src/routes/diarization.ts
decisions:
  - 40.a re-exports moved schemas from `contract-tests/src/schemas.ts` for backwards-compat with existing contract tests (no test-file churn).
  - 40.b parity test uses `git grep` to discover `process.env.<NAME>_API_KEY` at test time, then constructs synthetic URLs with `lowercase(<NAME>)` as the query key — adding a new API_KEY env var without updating the redactor's recogniser fails the test.
  - 40.c `MalformedUpstreamEnvelopeError` follows the LOCKER-05 pattern: `bodyText` is a private field (`#bodyText`), truncated at 200 chars, with `toJSON()` exposing only `{name, message, status, contentType}`.
metrics:
  duration_minutes: ~20
  commits: 3
  completed_date: 2026-05-16
---

# Phase 40 — byok-guard + contract-tests HIGH sweep Summary

Closes `HIGH-FIX-BYOK-01..03` from `.planning/review/byok-guard-contract-tests.md`. Three atomic sub-fixes — one per HIGH — landed with strict TDD (RED → GREEN per the 40.b and 40.c sub-fixes; 40.a is a pure refactor of import paths covered by the existing contract test suite).

## Sub-fix 40.a — Package-boundary inversion (HIGH-FIX-BYOK-01)

**SHA:** `8ae973e`

Five route files imported wire schemas from `@openwhispr/contract-tests/schemas` — a test-helper package. Phase 40.a moved every such schema into `@openwhispr/wire-schemas` (the canonical home), updated the route imports, and re-exported from `contract-tests/src/schemas.ts` for backwards compatibility with the existing contract tests. `contract-tests/package.json` was already `private: true`; verified — no flip needed.

Schemas moved: `CheckUserRequest`, `CheckUserResponse`, `VerificationStatusQuery`, `VerificationStatusResponse`, `DeleteAccountResponse`, `ReasonRequest`, `ReasonResponse`, `DiarizationResponse` (8 total). Route imports updated: 5 files. Contract tests unchanged (re-exports preserved every import path).

Verification: `pnpm --filter @openwhispr/wire-schemas typecheck` clean; `pnpm --filter @openwhispr/contract-tests test` — 38 passed / 180 skipped (no regressions). `pnpm --filter @openwhispr/api typecheck` reports only pre-existing errors in unrelated packages (`packages/data/src/encryption/lens.ts`, `packages/litellm-client/*`, `apps/api/src/routes/transcriptions/*`) — none in the 5 modified route files.

## Sub-fix 40.b — `redactUrl` completeness (HIGH-FIX-BYOK-02)

**SHA:** `06806f8`

Before: only `URL.password` was masked — userinfo username, query-string credentials, AWS SigV4 params, and bearer-shaped path segments all leaked. Phase 40.b extends `packages/byok-guard/src/redact-url.ts` to additionally mask:

- URL.username (Phase 40 addition);
- Query-string credential params (case-insensitive): `api_key`, `apikey`, `api-key`, `*_api_key`, `token`, `*_token`, `access_token`, `refresh_token`, `key`, `code`, `secret`, `signature`, `password`, plus AWS SigV4 (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`);
- Bearer-shaped path segments: `sk-…`, `sk-ant-…`, `AIza…`, `AKIA…` (longest-prefix-first ordering — `sk-ant-` masked before `sk-` so the ant key isn't partially redacted).

**Test coverage:** 50 synthetic URLs in `redact-url-completeness.test.ts` covering every redaction class (with positive AND non-leak assertions). Plus a drift-as-failure parity test (`redact-url-parity.test.ts`) that at test time greps `apps/**/src/**` + `packages/**/src/**` for `process.env.<NAME>_API_KEY`, constructs `https://example.com/?<lower(name)>=sk-fakefakefakefakefakefake` for each, and asserts the result does not contain the fake. Adding a new `process.env.FOO_API_KEY` to code without updating the redactor's recogniser → parity test fails loudly.

**Discovered env vars (parity test, 7 total):** `ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `PYANNOTE_API_KEY`, `TAVILY_API_KEY`, `YANDEX_SEARCH_API_KEY`. All currently masked by the `*_api_key` recogniser. Total redact-url tests: 64 passed (4 files in byok-guard tests dir).

The original `redact-url.test.ts` had one stale assertion (`https://user:hunter2@example.com/` → `https://user:***@example.com/`) — updated to the new contract (`https://***:***@example.com/`) since username is now also masked.

## Sub-fix 40.c — `fetchAndParse` envelope enforcement (HIGH-FIX-BYOK-03)

**SHA:** `9073b8c`

Before: the `typeof body === "object"` guard short-circuited envelope validation for raw-string, empty, and HTML bodies — exactly the regressions the helper exists to catch. Phase 40.c:

- Created `packages/contract-tests/src/errors.ts` with `MalformedUpstreamEnvelopeError`. The class follows the LOCKER-05 pattern from Phase 37: `bodyText` is a `#private` field truncated at 200 chars at construction, with `toJSON()` overridden to expose only `{name, message, status, contentType}` — defence-in-depth against accidentally embedding upstream payloads in test logs / structured-clone paths.
- Rewrote `packages/contract-tests/src/helpers/http.ts` to throw `MalformedUpstreamEnvelopeError` for every non-2xx response whose body is not a parseable JSON object. `ErrorEnvelope.parse(parsed)` still runs as the final shape check on valid JSON objects.
- Exported the error class from `packages/contract-tests/src/index.ts` so consumers can `expect(...).rejects.toBeInstanceOf(MalformedUpstreamEnvelopeError)` without reaching into a private subpath.

**Test coverage:** 9 cases in `fetch-and-parse-envelope.test.ts` — 4 RED-on-Phase-39 cases (text/plain 500, empty body, HTML 500 page, JSON string literal), plus regression coverage on valid envelopes + 2xx bodies + the LOCKER-05 `toJSON` invariant. Uses a real `node:http` ephemeral server (no fetch mock — fetch is a network boundary per CLAUDE.md). 9/9 GREEN.

## Verification

- `pnpm lint:lockers` exit 0 across all 3 commits.
- byok-guard tests: 64/64 passed (4 test files).
- contract-tests tests: 38 passed / 180 skipped (suite skips are pre-existing — unchanged by Phase 40).
- New error class follows the LOCKER-05 pattern (private bodyText + toJSON()).

## Self-Check: PASSED

- `8ae973e` on HEAD~2 — `feat(40a): move route schemas from contract-tests to wire-schemas`.
- `06806f8` on HEAD~1 — `feat(40b): redactUrl masks query secrets userinfo bearer paths`.
- `9073b8c` on HEAD — `feat(40c): fetchAndParse enforces envelope on non-2xx responses`.
- All 9 new files exist (5 wire-schemas + 2 byok-guard tests + 1 contract-tests errors + 1 contract-tests test).
- REQUIREMENTS rows 638-640 flipped to `Complete`; ROADMAP line 89 flipped to `[x]`.

## Deviations from Plan

None of substance. Two minor adjustments:

1. The `contract-tests/package.json` was already `private: true` — no flip needed (verified via `grep '"private"' packages/contract-tests/package.json`).
2. The 40.c error class initial draft used a `public readonly bodyText` field; LOCKER-05 (lint-secret-shape-in-error) rejected it. Re-wrote per the Phase 37 pattern (`#bodyText` private field + `getBodyText()` accessor + custom `toJSON()`) — locker exit 0 on second attempt.
