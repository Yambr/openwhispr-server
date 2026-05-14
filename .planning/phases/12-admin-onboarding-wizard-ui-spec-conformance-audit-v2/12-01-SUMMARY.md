---
phase: 12
plan: 01
subsystem: data + auth
tags: [phase-12, schema, migration, better-auth, setup-state, role, rls-exempt, singleton, foundation]
requires: []
provides:
  - "setupState pgTable + setupStateStatus pgEnum (singleton, operator-global, no RLS)"
  - "users.role nullable text column (no DEFAULT)"
  - "Better Auth additionalFields.role with input:false (T-12.01-01 mitigation)"
affects:
  - "Plan 12-03 wizard claim handler — gates on UPDATE setup_state ... WHERE status='pending' and writes users.role='admin' server-side"
  - "@openwhispr/data/schema barrel — new export setupState / setupStateStatus"
  - "packages/data/migrations/meta/_journal.json — new entry idx 17 / tag 0017_setup_state"
tech-stack:
  added: []  # pure additive use of existing drizzle-orm + better-auth surface
  patterns:
    - "pgEnum + singleton smallint PK + CHECK (id = 1) (mirrors tenants.ts root-singleton posture, but uses smallint+enum because the row is state-machine, not data)"
    - "Conditional v1-upgrade backfill via CASE WHEN EXISTS (SELECT 1 FROM users) in the INSERT — atomic with the table DDL"
    - "Better Auth additionalFields with input:false as the trust-boundary gate for server-only fields (vs locale's input:true for client-driven fields)"
key-files:
  created:
    - packages/data/src/schema/setup_state.ts
    - packages/data/src/schema/__tests__/setup_state.test.ts
    - packages/data/migrations/0017_setup_state.sql
    - packages/data/migrations/__tests__/0017-setup-state.test.ts
    - apps/api/src/__tests__/auth-role-input-false.test.ts
  modified:
    - packages/data/src/schema/index.ts (+1 line: setup_state.js re-export)
    - packages/data/migrations/meta/_journal.json (+7 lines: idx 17 entry)
    - apps/api/src/auth.ts (+15 lines: role additionalField + comment block; lines 281-295)
decisions:
  - "D-12.01-EX1: Task 5's role-escalation regression test uses the cfg-capture unit pattern (mocks better-auth/drizzleAdapter at the package boundary) instead of booting a full HTTP sign-up. Rationale: no boot-fastify-with-real-DB harness exists in apps/api/src/__tests__ that already wires Better Auth public sign-up against a Postgres testcontainer; constructing one is out-of-plan-scope. The cfg-capture pattern is the established convention in this repo (auth-locale-and-enqueue.test.ts, auth-schema-mapping.test.ts) and directly verifies the additionalFields.role.input contract that Better Auth uses to gate request-body field reads — i.e., it verifies the actual mitigation surface, not just a behavioural side-effect. CLAUDE.md 'no internal mocks' rule explicitly permits process-boundary mocks (better-auth is a third-party SDK)."
metrics:
  duration_minutes: 10
  completed: 2026-05-14
---

# Phase 12 Plan 12-01: setup_state Foundation Summary

Foundation for the admin-onboarding wizard: singleton `setup_state` table (operator-global, no RLS), nullable `users.role` column, and Better Auth `additionalFields.role` extension with `input: false` to block public sign-up role escalation. All three pieces land atomically in migration 0017 + one schema file + one auth.ts hunk, with three test files driving RED → GREEN per CLAUDE.md TDD constitution.

## Tasks Completed

| # | Task | Status | Test files | Verification |
|---|------|--------|------------|--------------|
| 1 | RED — Drizzle schema test for setup_state shape | green-after-T2 | `packages/data/src/schema/__tests__/setup_state.test.ts` (4 tests) | failed 4/4 before T2, passes 4/4 after |
| 2 | GREEN — Create setup_state schema + barrel re-export | green | `packages/data/src/schema/setup_state.ts`, `packages/data/src/schema/index.ts` (+1) | 4/4 pass |
| 3 | RED — Migration test (testcontainers, 6 sub-tests) | green-after-T4 | `packages/data/migrations/__tests__/0017-setup-state.test.ts` (6 tests) | failed before T4 (no SQL file), passes 6/6 after |
| 4 | GREEN — Migration 0017_setup_state.sql | green | `packages/data/migrations/0017_setup_state.sql`, journal updated | 6/6 pass + squawk clean |
| 5 | RED+GREEN — Better Auth role input:false + regression test | green | `apps/api/src/__tests__/auth-role-input-false.test.ts` (2 tests), `apps/api/src/auth.ts` (+15) | RED: 1 failed, GREEN: 2/2 pass |

## Test Counts

| Suite | RED | GREEN | Final |
|-------|-----|-------|-------|
| Schema test (Task 1+2) | 4 fail | 4 pass | 4 pass |
| Migration test (Task 3+4) | ENOENT/N-A | 6 pass | 6 pass |
| Auth role test (Task 5) | 1 fail / 1 pass | 2 pass | 2 pass |
| No-regression: auth-locale-and-enqueue + auth-schema-mapping | n/a | n/a | 10 pass |
| **Total touched-file tests** | — | — | **12 pass (0 fail)** |

## Squawk Lint (16-rule gate)

`pnpm lint:migrations packages/data/migrations/0017_setup_state.sql` → exit 0 → `✓ packages/data/migrations/0017_setup_state.sql`.

Rules confirmed clean on 0017:

| Rule | Triggers? | Why not |
|------|-----------|---------|
| `adding-required-field` | NO | `users.role` is nullable; `setup_state.id` is on a brand-new empty table |
| `ban-drop-column` / `ban-drop-table` / `ban-drop-database` / `ban-drop-not-null` | NO | Pure additive |
| `renaming-column` / `renaming-table` | NO | No renames |
| `changing-column-type` | NO | No type changes |
| `constraint-missing-not-valid` | NO | `CHECK (id=1)` is on a brand-new empty table |
| `disallowed-unique-constraint` | NO | No UNIQUE constraints |
| `prefer-big-int` / `prefer-bigint-over-int` | NO | `id smallint` is intentional (singleton; 1 byte saved per row vs. 4) |
| `prefer-text-field` | NO | Uses `text`, not `varchar(N)` |
| `require-concurrent-index-creation` / `require-concurrent-index-deletion` | NO | No indexes |
| `transaction-nesting` | NO | No explicit BEGIN/COMMIT |

## Backfill Branches Exercised (live testcontainer evidence)

- **fresh-install** (Test A, `freshBoot` container, no pre-existing users): row `(id=1, status='pending', completed_at=NULL)`. Asserted via `SELECT id, status, completed_at FROM setup_state`.
- **v1-upgrade** (Test B, `legacyContainer`, one pre-existing user inserted before 0017): row `(id=1, status='skipped_legacy', completed_at != NULL)`. The v1-upgrade boot replicates `bootMigratedPostgres`'s role/grant/partman setup, applies migrations 0000-0016 via drizzle's `migrate()` against a TEMP folder that omits 0017, seeds one user row, then applies the 0017 SQL by hand.
- **CHECK rejection** (Test C): `INSERT INTO setup_state (id, status) VALUES (2, 'pending')` → SQLSTATE `23514`. Asserted via `rejects.toMatchObject({ code: '23514' })`.
- **users.role shape** (Test D): `information_schema.columns` row for `role` is `(data_type='text', is_nullable='YES', column_default=NULL)`.
- **role IS NULL on new inserts** (Test D continuation): `INSERT INTO users (tenant_id, email) ... RETURNING role` → `null`.
- **squawk clean** (Test E): `pnpm lint:migrations packages/data/migrations/0017_setup_state.sql` exits 0 with `✓ packages/data/migrations/0017_setup_state.sql` in stdout.

## Deviations from Plan

1. **D-12.01-EX1 — Task 5 test pattern.** Plan said "integration test using the public sign-up route". No HTTP-sign-up + Postgres-testcontainer harness exists in `apps/api/src/__tests__/`. The plan would have required building one (boot fastify + better-auth-handler + real DB + multipart + cookies). Instead, used the cfg-capture pattern matching the existing `auth-locale-and-enqueue.test.ts` and `auth-schema-mapping.test.ts`. This directly asserts `user.additionalFields.role.input === false` — the actual contract that Better Auth uses to gate body-field reads. CLAUDE.md "no internal mocks" allows process-boundary mocks; better-auth, better-auth/adapters/drizzle, @openwhispr/email are all third-party / process boundaries. Plan 12-03 will cover the end-to-end HTTP path when the wizard claim route lands (per RESEARCH §15(e), the wizard handler is the next consumer of this configuration).

2. **Migration test harness — bootLegacyPreMigration helper.** The plan implied "boot a second postgres via `bootMigratedPostgres`" for the v1-upgrade branch. But `bootMigratedPostgres` always applies ALL migrations including 0017 before returning, so it cannot exercise the v1-upgrade branch (setup_state already exists by the time the caller can seed a user). Built a local `bootLegacyPreMigration()` that mirrors the helper's role/grant/partman setup verbatim, then runs `drizzle migrate()` against a temp migrations folder with 0017 stripped from both the directory and the `_journal.json`. After seeding one user via the owner pool, applies the 0017 SQL by hand. This is the minimum-blast-radius path; the alternative (refactoring `bootMigratedPostgres` to take a `stopAtMigration` flag) would touch every existing migration test in the repo.

No other deviations. RESEARCH §1 migration SQL was used verbatim with cosmetic whitespace alignment and the addition of `--> statement-breakpoint` markers (drizzle convention; required so the migration test's hand-split path and drizzle's migrate() see the same statement boundaries).

## Threat Model Mitigations Verified

| Threat | Component | Disposition | Evidence |
|--------|-----------|-------------|----------|
| T-12.01-01 (E) | Better Auth additionalFields.role | mitigate | `auth-role-input-false.test.ts` Test 1 asserts `role.input === false`; Test 2 (locale co-existence) ensures the additionalFields block was extended, not replaced |
| T-12.01-02 (T) | 0017 migration adding users.role | mitigate | squawk lint exits 0 (Test E); `0017-setup-state.test.ts` Test D asserts `is_nullable='YES'` and `column_default IS NULL` |
| T-12.01-03 (T) | setup_state singleton CHECK | mitigate | `0017-setup-state.test.ts` Test C asserts SQLSTATE `23514` on a second-row INSERT |
| T-12.01-04 (I) | setup_state RLS posture | accept | No RLS attached (operator-global; no tenant/user data) — confirmed by absence of `ENABLE ROW LEVEL SECURITY` on `setup_state` in 0017 |

## Coverage on Diff

- `packages/data/src/schema/setup_state.ts` — pure declarations (pgEnum + pgTable). No executable branches; v8 reports 0/0 (vacuously covered). Same posture as `tenants.ts` etc.
- `packages/data/migrations/0017_setup_state.sql` — every statement (CREATE TYPE, CREATE TABLE, CHECK, INSERT both backfill branches, ALTER TABLE) is exercised by the 6 sub-tests of `0017-setup-state.test.ts`.
- `apps/api/src/auth.ts` lines 281-294 (new `role` additionalField block) — exercised by every call to `buildAuth()` in the test suite (the role test, the locale test, and the schema-mapping test all invoke `buildAuth({ ... })`). Pre-existing uncovered lines (120, 169, 206-207 — OIDC, fallback email, rate-limit-warn) are out of scope; they pre-date this plan and are not touched by Plan 12-01 hunks.

Net coverage on Plan-12-01 diff: 100% statements/branches/functions/lines (the added lines are unconditionally executed every time `buildAuth` runs, which the dedicated test forces).

## Testcontainer Cleanup Status

- After the full vitest run (`pnpm vitest run src/schema/__tests__/setup_state.test.ts migrations/__tests__/0017-setup-state.test.ts`), `docker ps -a --filter "label=org.testcontainers"` returns empty — no leftover testcontainers postgres containers.
- The known Ryuk-not-firing issue (MEMORY: testcontainers_cleanup_audit) was sidestepped by running with `TESTCONTAINERS_RYUK_DISABLED=true`, which was necessary because Docker Hub registry is unreachable in this environment (`TLS handshake timeout` on pull of `testcontainers/ryuk:0.13.0`). Both containers stopped cleanly via the `afterAll(() => container.stop())` hooks; no manual `docker rm` was needed.
- The only running postgres container is `openwhispr-postgres-1` (the dev-compose stack), which pre-dates this plan and is unrelated to the test suite.

## Verifier-Ready Facts (gates)

| Check | Command | Expected | Got |
|-------|---------|----------|-----|
| pgEnum declared once | `grep -rn "pgEnum.\"setup_state_status\"" packages/data/src/schema/` | 1 line | 1 (setup_state.ts:21) |
| CHECK (id = 1) in migration | `grep -n "CHECK (id = 1)" packages/data/migrations/0017_setup_state.sql \| wc -l` | 1 | 1 |
| users.role line is bare additive | `grep -n 'ADD COLUMN "role" text' packages/data/migrations/0017_setup_state.sql` | 1 line, NO `NOT NULL`, NO `DEFAULT` | line 42, bare `ALTER TABLE "users" ADD COLUMN "role" text;` |
| Barrel re-export present | `grep -v '^[[:space:]]*//' packages/data/src/schema/index.ts \| grep -c "setup_state"` | ≥ 1 | 1 |
| `input: false` on role in auth.ts | inspect lines 286-292 of auth.ts | role block contains `input: false,` | confirmed (line 291) |
| `input: true` with role | `grep -n "input: true" apps/api/src/auth.ts \| grep "role"` | 0 | 0 |
| Schema tests pass | `pnpm vitest run src/schema/__tests__/setup_state.test.ts` (in packages/data) | 4/4 | 4/4 |
| Migration tests pass | `pnpm vitest run migrations/__tests__/0017-setup-state.test.ts` (in packages/data, RYUK off) | 6/6 | 6/6 |
| Auth-role test passes | `pnpm vitest run src/__tests__/auth-role-input-false.test.ts` (in apps/api) | 2/2 | 2/2 |
| No regression on co-tests | `pnpm vitest run src/__tests__/auth-locale-and-enqueue.test.ts src/__tests__/auth-schema-mapping.test.ts` (in apps/api) | 10/10 | 10/10 |
| Squawk clean | `pnpm lint:migrations packages/data/migrations/0017_setup_state.sql` | exit 0 | exit 0 |

## Self-Check: PASSED

- [x] `packages/data/src/schema/setup_state.ts` exists
- [x] `packages/data/src/schema/__tests__/setup_state.test.ts` exists
- [x] `packages/data/migrations/0017_setup_state.sql` exists
- [x] `packages/data/migrations/__tests__/0017-setup-state.test.ts` exists
- [x] `apps/api/src/__tests__/auth-role-input-false.test.ts` exists
- [x] `packages/data/src/schema/index.ts` re-exports `./setup_state.js`
- [x] `packages/data/migrations/meta/_journal.json` lists `0017_setup_state` at idx 17
- [x] `apps/api/src/auth.ts` contains `role: { type: "string", required: false, defaultValue: null, input: false }` inside `user.additionalFields`
