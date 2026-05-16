# Phase 32: RLS fail-closed — Research Synthesis

**Compiled:** 2026-05-16
**Source:** Distilled from 32-CONTEXT.md (commit `353520d`) + prior HALT findings on commit-tree archaeology.
**Skip rationale:** Pre-flight resolution already gathered the 9 needed facts; this file consolidates them so Plan/Executor agents have one entry point. No separate `gsd-phase-researcher` spawn.

## Q1 — Regression source location

`packages/data/migrations/0003_better_auth_tenant_defaults.sql:46-57`. Two artefacts to reverse:

1. **Lines 43-48 — `ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-...'`** — rolconfig binding the GUC at backend-connect time. Every PgBouncer-leased connection starts with this default. Fail-open by construction.
2. **Lines 51-57 — Four `ALTER TABLE ... ALTER COLUMN tenant_id SET DEFAULT current_setting('app.tenant_id', true)::uuid`** on `users`, `sessions`, `account`, `verification`. With (1) in place, bare INSERTs by Better Auth resolve to the default tenant. The other 12 tenant-scoped tables never had GUC-bound DEFAULTs — they require an explicit `tenant_id` value at insert time today.

## Q2 — Existing RLS policy shape (canonical pattern)

```sql
CREATE POLICY "<table>_tenant_isolation" ON "<table>"
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
```

The `true` (missing_ok) GUC flag returns `''` when unset. With the role-default also gone, `''::uuid` cast errors at execution time — that errors EVERY query, not just writes. We want **silent-deny-read + raise-write** (variant (a)).

## Q3 — Fail-closed variant (a) — silent-deny-read + raise-write

New policy body:

```sql
USING (
  current_setting('app.tenant_id', true) IS NOT NULL
  AND current_setting('app.tenant_id', true) <> ''
  AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
)
WITH CHECK (
  current_setting('app.tenant_id', true) IS NOT NULL
  AND current_setting('app.tenant_id', true) <> ''
  AND "tenant_id" = current_setting('app.tenant_id', true)::uuid
)
```

Semantics per (op, context) cell:

| op | with context (correct UUID) | without context (GUC NULL or '') |
| --- | --- | --- |
| SELECT | rows visible | empty result (0 rows) |
| INSERT | row admitted iff WITH CHECK passes | raises `42501 new row violates row-level security policy` |
| UPDATE | row admitted iff USING + WITH CHECK pass | raises `42501` (USING reduces target set to 0, but a WITH CHECK clause on default-tenant_id would still apply — net effect: 0 rows updated, no error). See note below. |
| DELETE | row admitted iff USING matches | 0 rows deleted, no error (USING reduces target set to 0). |

**UPDATE/DELETE without context is a 0-row-affected silent path**, not a raise. PG only raises on INSERT (WITH CHECK against a row that doesn't satisfy the predicate). For symmetry the migration ALSO adds a **NOT NULL constraint check** on the GUC via a session-level deferred trigger? — REJECTED. Simpler: the property test asserts UPDATE/DELETE without context = `rowCount === 0`, matching SELECT semantics; INSERT without context raises. This matches CONTEXT.md variant (a) precisely.

## Q4 — Production callers of `withTenant()` — fallback path audit

`packages/data/src/tenant-context.ts` is 84 lines. Single function `withTenant(db, tenantId, fn)`. NO fallback path to `DEFAULT_TENANT_ID`. The tenant UUID regex pre-check rejects empty/undefined/malformed values before opening a transaction. Behaviour change for Phase 32 is **migration-only** — `tenant-context.ts` ships JSDoc-only.

Grep on `apps/**/src/**` confirms no caller passes a falsy tenantId; all callsites resolve `req.tenantId` from `dualAuthHook` (already mandatory under Phase 34's planned `tenantPlugin` retirement; today it's at minimum a string).

## Q5 — TENANT_SCOPED_TABLES literal count

`packages/data/src/schema/index.ts:25-44` enumerates **16 entries**:

1. users
2. sessions
3. audit_log (partitioned via pg_partman; child partitions inherit parent RLS)
4. usage_ledger
5. account
6. verification
7. oauth_state
8. tenant_settings
9. user_settings
10. notes
11. folders
12. conversations
13. messages
14. transcriptions
15. api_keys
16. usage_rollup_daily (read-mostly materialization, write by daily worker)

**Property test case count: 16 × 4 ops × 2 contexts = 128.**

## Q6 — testcontainer fixture reuse pattern

`packages/data/src/__tests__/helpers.ts` `bootMigratedPostgres()` boots a single PG 17.5+pg_partman container with both roles (`openwhispr_owner` BYPASSRLS, `openwhispr_app` no-BYPASSRLS) and applies every migration including 0017. Mirror `0017-setup-state.test.ts` pattern: `beforeAll` boots once, individual `it()` blocks share the container, `afterAll` stops it. Per DISCIPLINE Rule 5 + memory:testcontainers-cleanup-audit — DO NOT spin up per-test containers.

For the 128-case property test, use a single boot, seed 2 tenants × 16 tables × 1 row each = 32 seed rows, then iterate ops with a fresh PG client connected as `openwhispr_app`.

## Q7 — Migration filename sequence

Next slot after 0017 → `0018_rls_fail_closed.sql`. Journal at `packages/data/migrations/meta/_journal.json` must gain an `idx: 18` entry. The sequence increments by 1 from 17.

Companion `0018_rls_fail_closed.down.sql` documented but **not** added to the journal (forward-only migrations). The `down.sql` file lives next to the up file with an explicit warning header that rollback re-introduces the fail-open posture.

## Q8 — Migration test pattern reference

`packages/data/migrations/__tests__/0017-setup-state.test.ts` is the canonical pattern: vitest, `beforeAll` boots `bootMigratedPostgres()`, individual `it()` blocks query the resulting database, `afterAll` stops the container. Squawk lint assertion via `execFileSync("pnpm", ["lint:migrations", "<file>"])` to gate forward-only DDL safety.

Phase 32 migration test scope:
1. After migration applies, the role openwhispr_app's `app.tenant_id` rolconfig is RESET (assert `pg_db_role_setting` returns empty for setconfig).
2. After migration applies, the 4 tables (users, sessions, account, verification) have NO column-level DEFAULT on `tenant_id` (`column_default IS NULL`).
3. After migration applies, every tenant-scoped table's RLS policy USING clause text contains `IS NOT NULL` (per `pg_policies.qual`).
4. Squawk lint exits 0 on `0018_rls_fail_closed.sql`.

## Q9 — E2E shape

`tests/e2e/rls-fail-closed.spec.ts` (vitest under `tests/e2e/vitest.e2e.config.ts`). Per Phase 31 lockers — must NOT introduce a synthetic test-only production route (LOCKER-04 + LOCKER-14 catch unauthenticated/unschema'd routes). Instead: the E2E test exercises an **existing** un-wrapped path on a fresh stack. Approach:
- Boot real compose stack (api + postgres + valkey).
- Connect directly to PG as `openwhispr_app` (no withTenant) and attempt INSERT into `notes` without setting GUC.
- Assert PG returns `42501` permission error.

This validates the fail-closed posture end-to-end without route surgery. The 128-case unit suite owns granular per-op coverage; the E2E owns the integration-level "real stack, real PG, real role" proof.

## Open grey-area decisions

- **GREY-1:** `audit_log` is partitioned via `pg_partman`. Child partitions inherit parent RLS — but the PROPERTY test seeds rows into the parent. Per CONTEXT.md decisions/Q5: include uniformly, but use `INSERT INTO audit_log` (parent) which PG routes to a child partition. INSERT should still respect RLS WITH CHECK on parent.
- **GREY-2:** `usage_rollup_daily` is read-mostly, written by `apps/worker/src/jobs/usage-rollup-daily.ts`. Same uniform treatment in property test.
- **GREY-3:** Should `tenant-context.ts` get an `assertTenantContextActive(tx)` helper? Decision: SKIP — DISCIPLINE Rule 1 says no extra surface without a failing test demanding it. The RLS body does the work.

## Verification commands

```sh
pnpm --filter @openwhispr/data test               # unit + integration
pnpm --filter @openwhispr/data test --coverage    # coverage assertion
E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/rls-fail-closed.spec.ts
pnpm lint:lockers                                  # Phase 31 gate
pnpm lint:migrations packages/data/migrations/0018_rls_fail_closed.sql
```
