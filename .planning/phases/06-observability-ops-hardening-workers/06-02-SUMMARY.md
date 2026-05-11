---
phase: 06-observability-ops-hardening-workers
plan: 02
subsystem: data
tags: [DATA-04, pg_partman, audit_log, partitioning, rls]
requires:
  - phase 1 RLS pattern (FORCE RLS + app.tenant_id GUC) — unchanged
  - phase 1 audit_log table (Phase 1 / Plan 03) — converted to partitioned parent here
provides:
  - monthly RANGE-partitioned audit_log managed by pg_partman 5.2.4
  - canonical 18-action D-A6 CHECK constraint at the DB layer
  - AUDIT_LOG_ACTIONS TypeScript const-union + AuditLogAction type
  - openwhispr/postgres:17.5-pgpartman custom image for compose + tests
  - provisionPgPartman() test helper
affects:
  - every test that boots a Postgres container + applies all migrations
    (now uses the partman image)
  - tools/lint-rls.ts (skips partman child partitions + accepts relkind 'p')
tech-stack:
  added:
    - pg_partman 5.2.4 (built from source on postgres:17.5-alpine)
  patterns:
    - rename → create empty parent → register with partman → copy rows
      → drop legacy (online conversion to declarative partitioning)
key-files:
  created:
    - compose/postgres/Dockerfile
    - packages/data/migrations/init/02-pg-partman.sql
    - packages/data/migrations/0014_audit_log_partition.sql
    - packages/data/migrations/0014_audit_log_partition.down.sql
    - packages/data/migrations/__tests__/0014-audit-log-partition.test.ts
    - packages/data/src/__tests__/audit-log-actions.test.ts
    - packages/data/src/__tests__/audit-log-partitioning.test.ts
  modified:
    - docker-compose.yml (postgres service: build + image)
    - packages/data/src/schema/audit_log.ts (AUDIT_LOG_ACTIONS, CHECK)
    - packages/data/migrations/meta/_journal.json (registers idx 14)
    - packages/data/src/__tests__/helpers.ts (partman image default,
      provisionPgPartman helper)
    - packages/data/src/__tests__/audit-log.test.ts (canonical action)
    - packages/data/src/__tests__/migration-rollback.test.ts (clears
      partman.part_config between forward applies)
    - packages/data/src/__tests__/rls-property.test.ts (fc generator
      now picks canonical D-A6 actions; partman image)
    - packages/data/src/__tests__/settings-rls.test.ts (partman image)
    - packages/data/src/__tests__/migration-0006-backfill.test.ts (partman image)
    - packages/data/src/__tests__/pgbouncer-interleave.test.ts (partman image)
    - tests/self-tests/rls-introspection.test.ts (partman image + grants)
    - tools/lint-rls.ts (recognizes partman child partitions; relkind 'p')
  deleted:
    - packages/data/migrations/__tests__/0011-audit-log-partition.test.ts
      (superseded RED stub from Plan 06-01)
decisions:
  - id: D-02-1
    summary: build pg_partman from source on postgres:17.5-alpine (vs switch
      to bitnami/postgresql)
  - id: D-02-2
    summary: use migration number 0014 instead of plan's referenced 0011
      because 0011-0013 are already occupied
  - id: D-02-3
    summary: partman maintenance runner deferred to Plan 06-08 (BullMQ
      recurring job calling partman.run_maintenance_proc); migration 0014
      sets infinite_time_partitions=true + premake=4 so the cluster
      survives indefinitely until the worker lands
  - id: D-02-4
    summary: rollback strategy is "snapshot + DROP CASCADE + recreate +
      restore" instead of partman.undo_partition — avoids internal-COMMIT
      restrictions that block use inside a wrapping transaction
  - id: D-02-5
    summary: bootMigratedPostgres() now defaults to the partman image and
      always provisions the extension; old `postgres:17-alpine`-only
      callers (5 test files) were updated in this commit
metrics:
  duration_minutes: 21
  completed: 2026-05-11
---

# Phase 6 Plan 02: audit_log Monthly RANGE Partitioning Summary

**One-liner:** Converted the Phase 1 flat `audit_log` table to a monthly
RANGE-partitioned parent managed by pg_partman 5.2.4 (premake=4, retention
13 months, keep_table=true, inherit_privileges=true, infinite_time_partitions),
locked the 18-action D-A6 CHECK constraint at the DB layer, shipped a
custom `openwhispr/postgres:17.5-pgpartman` image, and verified RLS
inheritance from parent to children with real-service testcontainer tests.

## What landed

### Custom Postgres image (Task 1)

- `compose/postgres/Dockerfile` builds pg_partman 5.2.4 from source on
  top of `postgres:17.5-alpine` with `NO_BGW=1` (background worker
  skipped — maintenance will run via a BullMQ job per D-A4).
- `docker-compose.yml` postgres service switched from `image:` to
  `build:` + an explicit local `image:` tag for cache hits.
- `packages/data/migrations/init/02-pg-partman.sql` provisions the
  `partman` schema + `CREATE EXTENSION pg_partman` + the GRANT chain
  required for `openwhispr_owner` to drive `partman.create_parent` and
  `run_maintenance_proc` (CREATE on schema + all on tables/sequences +
  EXECUTE on functions+procedures).
- Smoke-verified on arm64: image boots and reports `pg_partman 5.2.4`
  available via `pg_available_extensions`.

### Migration 0014 (Task 2)

- `0014_audit_log_partition.sql` — forward migration. Renames flat
  `audit_log` to `audit_log_legacy`, recreates it as a RANGE-partitioned
  parent keyed on `created_at` with PK `(id, created_at)`, restores the
  Phase 1 FK + indexes + RLS policy on the parent (children inherit
  natively per PG 13+), registers with pg_partman, sets retention 13
  months / keep_table=true / inherit_privileges=true / premake=4 /
  infinite_time_partitions=true, copies legacy rows into the parent
  (PG routes them to monthly children by `created_at`), drops legacy,
  and re-grants DML to `openwhispr_app`.
- `0014_audit_log_partition.down.sql` — rollback. Snapshots all rows,
  removes the partman registration row, `DROP TABLE audit_log CASCADE`
  (drops parent + every child + the default partition in one shot),
  recreates the original flat shape, restores rows, and re-grants.

### Tests flipped to GREEN

- `audit-log-actions.test.ts` (24 cases): every D-A6 action INSERTs;
  `auth.unknown`, `""`, `"auth.signin "` all rejected with SQLSTATE
  23514; drift detector asserts exactly 18 entries in the const-union.
- `audit-log-partitioning.test.ts` (8 cases): pg_partman extension
  present (v5.x), `audit_log.relkind='p'`, part_config row present with
  `1 mon` interval, `run_maintenance_proc()` is idempotent, RLS
  ENABLE+FORCE on parent, children inherit RLS functionally (tenant-A
  context only sees tenant-A rows; tenant-B context only sees tenant-B
  rows), INSERTs route to a monthly child (`tableoid::regclass`).
- `0014-audit-log-partition.test.ts` (6 cases): forward assertions
  (RANGE on created_at, full 18-action CHECK content, RLS + policy on
  parent, partman registration with retention 13 months / keep_table,
  >=5 child partitions including >=1 true monthly partition); rollback
  preserves the seeded row and restores a non-partitioned shape.

### Cross-test ripple

5 test files that booted their own `PostgreSqlContainer("postgres:17-alpine")`
plus 1 in `tests/self-tests/` needed to switch to the partman image and
call `provisionPgPartman()` so migration 0014 could apply. The
`bootMigratedPostgres()` helper in `packages/data/src/__tests__/helpers.ts`
now defaults to the partman image and provisions the extension, so any
new test that uses it is unaffected.

### lint-rls updated

`tools/lint-rls.ts` now:
- Accepts `relkind='p'` (partitioned parent) on tenant-scoped tables.
- Excludes `audit_log_p<YYYYMMDD>` and `audit_log_default` child
  partitions from the policy-existence check (children inherit RLS
  from the parent natively; no pg_policies row is created for them).

## Verification

- 42/42 targeted tests GREEN (migration-0014 + audit-log-actions +
  audit-log-partitioning + audit-log + migration-rollback).
- 14/14 rls-property tests GREEN against the partman image.
- 2/2 pgbouncer-interleave tests GREEN.
- 1/1 self-test (lint-rls catches injected RLS-less table) GREEN.
- `pnpm exec tsx tools/lint-english.ts` — 495 files scanned, passed.
- Pre-commit hooks (biome + english + commitlint) all passed on both
  task commits.

## [BLOCKING] schema push

The plan's `[BLOCKING] CI=true pnpm -F @openwhispr/data db:push` gate
was reinterpreted as "migration applies successfully end-to-end via the
canonical migrate() runner" because no `db:push` script existed in
`packages/data/package.json` and the project's discipline is
hand-augmented `.sql` migrations (not drizzle-kit schema push). The
migration-rollback test exercises forward-apply + drop-everything +
forward-apply, which is the strongest available proof that the
migration set applies cleanly to a fresh DB. **Verified GREEN.**

If a literal `db:push` script is required in CI later, it should run
`pnpm exec tsx packages/data/src/migrate.ts` (the existing migrate
runner) — adding a one-line `"db:push": "tsx src/migrate.ts"` to
`packages/data/package.json` is a single-commit follow-up.

## Deviations from Plan

### Rule 3 — blocking issues auto-fixed

**1. [Rule 3 — migration number collision]** Plan referenced
`0011_audit_log_partition.sql`; 0011/0012/0013 were already occupied
by Phase 5's notes/folders/transcriptions cloud-column migrations.
Used `0014` to preserve linear migration order. Test file mirrors the
SQL filename (`0014-audit-log-partition.test.ts`); the Wave 0 stub
file `0011-audit-log-partition.test.ts` (created by parallel Plan 06-01)
was removed since it referenced a migration number that does not
exist.

**2. [Rule 3 — pg_partman procedural COMMITs incompatible with drizzle
migrator's transaction]** `partman.run_maintenance_proc()` issues an
internal COMMIT, which is illegal inside a wrapping transaction.
Removed the call from the migration; the daily BullMQ
`partman-maintenance` job (Plan 06-08) will run it. The migration's
`create_parent` already premakes 4 future months, so the cluster is
serviceable without immediate maintenance.

**3. [Rule 3 — `partman.undo_partition*` not usable in rollback]**
Same internal-COMMIT issue; rewrote `0014_*.down.sql` to use a
snapshot + `DROP TABLE ... CASCADE` + recreate-flat approach. Simpler
and deterministic.

**4. [Rule 3 — test-image collision]** Forcing migration 0014 to
require pg_partman broke 5 existing tests that booted the stock
`postgres:17-alpine` image. Fixed by switching `bootMigratedPostgres`
to default to the partman image and exporting a `provisionPgPartman()`
helper for tests that boot their own containers. All 5 affected tests
plus 1 in `tests/self-tests/` updated in this commit.

**5. [Rule 3 — pre-existing test assumptions about action freedom]**
`audit-log.test.ts` inserted `"test.event"`; `rls-property.test.ts`
fuzzed arbitrary strings into `action`. Both broke under the new
CHECK constraint. Updated to use canonical D-A6 values; the RLS
isolation property the tests were proving is preserved.

### Rule 2 — auto-added missing critical functionality

**6. [Rule 2 — partman child GRANT propagation]** Migration sets
`inherit_privileges=true` in `partman.part_config` so future monthly
children automatically inherit the openwhispr_app DML grants from the
parent. Without this, every new child would need an explicit GRANT
after creation, which is a foot-gun the BullMQ maintenance worker
would have to remember to issue.

## Known stubs

None. All three Wave 0 stubs originally referenced by Plan 06-01 have
been flipped to GREEN with real-service implementations:
- `audit-log-actions.test.ts` — GREEN (24 cases pass).
- `audit-log-partitioning.test.ts` — GREEN (8 cases pass).
- `0014-audit-log-partition.test.ts` — GREEN (6 cases pass).

## Self-Check: PASSED

- `compose/postgres/Dockerfile` — FOUND
- `packages/data/migrations/init/02-pg-partman.sql` — FOUND
- `packages/data/migrations/0014_audit_log_partition.sql` — FOUND
- `packages/data/migrations/0014_audit_log_partition.down.sql` — FOUND
- `packages/data/migrations/__tests__/0014-audit-log-partition.test.ts` — FOUND
- `packages/data/src/__tests__/audit-log-actions.test.ts` — FOUND
- `packages/data/src/__tests__/audit-log-partitioning.test.ts` — FOUND
- commit `c1f1eb8` (Task 1 — custom postgres image) — FOUND
- commit `b4b0a15` (Task 2 — migration + tests) — FOUND
