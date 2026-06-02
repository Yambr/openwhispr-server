---
quick_id: 260602-fda
slug: audit-partman-optional
date: 2026-06-02
status: complete
---

# Quick Task: audit_log works without pg_partman (managed Postgres)

Blocker #1 of 3 upstream managed-Postgres deploy fixes (peer gr0flvsr, verified
v1.0.19; see memory `project_managed_pg_upstream_blockers`).

## Problem (verified)

- `packages/data/migrations/0014_audit_log_partition.sql:99-115` unconditionally
  calls `partman.create_parent('public.audit_log', …)` + `UPDATE
  partman.part_config`. pg_partman's `CREATE EXTENSION` lives ONLY in
  `migrations/init/02-pg-partman.sql`, which runs via docker-entrypoint-initdb.d
  on a fresh volume — NOT via the migrate runner. On managed Postgres (no
  partman, not superuser) the extension is absent → migration 0014 fails.
- `apps/api/src/lib/audit.ts:381 recordAudit` INSERTs into audit_log fail-closed
  IN-TX with the business op (e.g. `auth.signin`). No working partition → INSERT
  fails → can't log in. Audit cannot be disabled.
- `apps/worker/src/jobs/partman-maintenance.ts:70` calls
  `CALL partman.run_maintenance_proc()` unconditionally → throws every run when
  partman is absent (BullMQ retries forever).

## Decision (with user): auto-detect + AUDIT_LOG_DISABLED

Minimal dependencies. partman OFF by default; present partman = the switch.
NO separate `AUDIT_LOG_PARTITIONING` env.

1. **Migration 0014** — keep steps 1-4 (rename → partitioned parent → indexes →
   RLS) unchanged; audit_log is ALWAYS a partitioned parent (`relkind='p'`).
   Wrap steps 5-6 in a `DO $$ ... $$` block:
   - `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_partman')` →
     `partman.create_parent(...)` + `UPDATE partman.part_config` (rotation).
   - ELSE → `CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;`
     so INSERTs route to a native catch-all child; login works, no auto monthly
     children, zero partman dependency.
   Safe to edit 0014 in place: drizzle's migrator (v0.45.2) decides applied-vs-
   pending purely by `created_at` timestamp (pg-core dialect.js `migrate()`),
   NEVER by hash — already-migrated DBs skip 0014; fresh DBs run the new SQL.

2. **partman-maintenance worker** — guard `CALL partman.run_maintenance_proc()`
   behind a `pg_extension` presence check; return `{ detached: [] }` (no-op)
   when partman is absent, so the always-on cron does not burn retries.

3. **audit.ts** — `AUDIT_LOG_DISABLED` (`1`/`true`) → `recordAudit` early-returns
   a no-op (read `process.env` directly, same precedent as `AUDIT_REDACT_IP` at
   audit.ts:371; NOT a NODE_ENV branch so LOCKER-01 is unaffected). Default OFF
   → audit stays fail-closed.

## Tests (TDD RED→GREEN)

- **Migration no-partman fallback** (NEW test, `postgres:17-alpine`,
  `withPgPartman:false`): `bootMigratedPostgres` applies ALL migrations on stock
  PG with NO partman → currently RED (0014 throws). GREEN: migrate succeeds;
  `audit_log` relkind='p'; an `audit_log_default` DEFAULT child exists; an
  INSERT into audit_log succeeds and routes to a child (not the parent);
  `pg_extension` has no partman row. Mirror existing
  `audit-log-partitioning.test.ts` structure.
- **Migration partman path** — existing `audit-log-partitioning.test.ts`
  (partman image) MUST stay GREEN (the IF-EXISTS branch still create_parent's).
- **partman-maintenance** unit: when the `pg_extension` probe returns no
  partman, the handler does NOT `CALL run_maintenance_proc` and returns
  `{detached:[]}`; when present, current behaviour. Boundary-mock the pg pool
  (query stub) per the existing job-test pattern.
- **audit.ts** unit: `AUDIT_LOG_DISABLED=1`/`true` → recordAudit performs NO
  tx.execute (no-op), validation still applies? (decide: skip entirely — pure
  no-op, no INSERT). Flag unset/`0`/`false` → INSERT happens (current). Use the
  existing audit unit-test harness (tx stub).

## Acceptance

On Postgres without pg_partman (only pgcrypto, NOBYPASSRLS, non-superuser),
`migrate` passes and `auth.signin` (audit INSERT) works. With partman present,
full rotation as today. `AUDIT_LOG_DISABLED=1` → recordAudit no-op.

## Out of scope

Blocker #2 (claim-driven RLS). No push / no release here.
