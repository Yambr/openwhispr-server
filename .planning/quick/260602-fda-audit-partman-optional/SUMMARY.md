---
quick_id: 260602-fda
slug: audit-partman-optional
date: 2026-06-02
status: complete
---

# Summary: audit_log works without pg_partman (managed Postgres)

Blocker #1 of 3 upstream managed-Postgres deploy fixes (peer gr0flvsr).

## Problem

Migration `0014_audit_log_partition.sql` unconditionally called
`partman.create_parent('public.audit_log', …)`. pg_partman's CREATE EXTENSION
lives only in `migrations/init/02-pg-partman.sql` (docker-entrypoint-initdb.d on
a fresh volume, NOT the migrate runner), so on a managed Postgres without
partman the migration failed — and `recordAudit` (fail-closed, in-tx with the
business op) then blocked `auth.signin`. partman-maintenance also CALLed
`run_maintenance_proc()` unconditionally → threw every cron tick.

## Decision (with user): auto-detect + AUDIT_LOG_DISABLED

Minimal dependencies, partman OFF by default, "turn it on and it works". No
separate AUDIT_LOG_PARTITIONING env — presence of pg_partman IS the switch.

- **Migration 0014** — steps 1-4 unchanged (audit_log is always a partitioned
  parent, relkind='p'). Steps 5-6 wrapped in `DO $$ ... $$`:
  `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_partman')` →
  `partman.create_parent` + retention (full rotation); ELSE →
  `CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT`
  (native catch-all; INSERTs/auth.signin work, no auto monthly children).
  Safe to edit in place: drizzle-orm 0.45.2's migrator decides applied-vs-pending
  purely by `created_at` timestamp (pg-core dialect.js `migrate()`), never by
  hash → already-migrated DBs skip 0014, fresh DBs run the new SQL.
- **0014 down.sql** — guarded the `DELETE FROM partman.part_config` behind the
  same pg_extension check so the hand-run rollback also works on no-partman PG.
- **partman-maintenance worker** — probes `pg_extension` first; returns
  `{ detached: [] }` (no CALL, no client connect) when partman is absent, so the
  always-on daily cron does not burn BullMQ retries.
- **audit.ts** — `AUDIT_LOG_DISABLED` (1/true) → `recordAudit` early-returns a
  no-op (read via process.env like the existing AUDIT_REDACT_IP knob; not a
  NODE_ENV branch). Default OFF → audit stays fail-closed.
- **.env.full.example** — documents AUDIT_LOG_DISABLED + AUDIT_REDACT_IP +
  the auto-rotation/fallback posture.

## Verification (own eyes)

- NEW `audit-log-no-partman-fallback.test.ts` (stock `postgres:17-alpine`,
  NO partman): **5 passed** — migrate succeeds, audit_log relkind='p',
  `audit_log_default` exists, `auth.signin` INSERT routes to the DEFAULT child,
  pg_partman genuinely absent, RLS enabled+forced.
- Existing `audit-log-partitioning.test.ts` (partman image): **8 passed**
  (full rotation path preserved — no regression).
- `partman-maintenance.test.ts`: **6 passed**, source coverage **100/100/100/100**.
- `audit.test.ts` full: **52 passed** (incl. 4 new AUDIT_LOG_DISABLED cases).
- worker + data + api typechecks exit 0; biome clean; LOCKER
  no-env-branches/no-hardcode/no-suppressions clean; lint-migrations
  "No new migrations to lint" (edit-in-place not flagged).

## Acceptance

On Postgres without pg_partman (NOBYPASSRLS, non-superuser): migrate passes and
auth.signin (audit INSERT) works. ✓ With partman present: full rotation as
today. ✓ AUDIT_LOG_DISABLED=1 → recordAudit no-op. ✓

## Out of scope

Blocker #2 (claim-driven app.bypass RLS). No push / no release here.
