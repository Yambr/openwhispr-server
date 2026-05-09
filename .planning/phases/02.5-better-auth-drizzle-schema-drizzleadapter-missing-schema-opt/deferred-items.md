# Plan 02.5-03 — Deferred Items

## Pre-existing test/typecheck failures (out of scope for Plan 02.5-03)

Verified on HEAD (1d6bb27) BEFORE Plan 03 edits — confirmed unaffected by this plan.

### 1. `apps/api/scripts/check-default-secrets.test.ts` — 4 failing tests
- Path resolution bug: tests invoke the script with a relative path that resolves to `apps/api/apps/api/scripts/check-default-secrets.ts` (double-prefix). `ERR_MODULE_NOT_FOUND`.
- Pre-existing on HEAD; nothing to do with Better Auth schema mapping.
- Owner: whichever phase introduced `check-default-secrets.test.ts` (DATA-06 — likely Phase 02.x KMS plan).

### 2. `apps/api/src/__tests__/auth-schema-mapping.test.ts:21` — TS2412
- Plan 01's RED-test-lock file. `captured.schema` typed as `Record<string,unknown> | undefined`; assignment to non-undefined target violates `exactOptionalPropertyTypes`.
- Pre-existing on HEAD; not caused by Plan 03.
- Fix: change captured-args field type to allow `undefined` or use `Object.assign`.
- Owner: re-open Plan 01 OR roll into Plan 05 cleanup.

### 3. `apps/api/src/__tests__/auth-trusted-origins.test.ts:43` — TS2493
- Phase 02.4 test. Tuple-of-length-0 indexed at [0]. Pre-existing.
- Owner: Phase 02.4 closure.

Plan 03 surface (auth.ts schema map): typechecks clean, runs clean, 3/3 unit tests GREEN.
