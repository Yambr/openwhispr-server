# Phase 5 / Plan 01 — [BLOCKING] Migration & RLS-Lint Validation Log

**Date:** 2026-05-11
**Worktree branch:** `worktree-agent-a94ab34867b629047`
**Base commit:** `a761e7d` (Phase 4 closed; Phase 5 plans landed)
**Status:** PASSED via testcontainer harness (live-stack apply gated to orchestrator post-merge)

## Execution context

This plan is part of the Phase 5 Wave 0 parallel execution batch. Per the
parallel-worktree protocol declared in `CLAUDE.md` §9 and the executor
prompt's `<parallel_execution>` block, individual worktree agents run
with `--no-verify` and the orchestrator is responsible for the
post-merge live-stack validation pass. The local docker-compose stack is
NOT brought up inside the worktree (no `.env` is present, port
collisions across parallel agents would be guaranteed).

The constitutional invariant — "migrations apply cleanly to a fresh
PG 17 + PgBouncer harness; RLS lint reports FORCE RLS on every new
table; 100+ random cross-tenant attempts per new table all deny" —
is satisfied here against a real `@testcontainers/postgresql`
PG 17-alpine instance + edoburu/pgbouncer 1.23.1 sidecar. The
testcontainer is byte-identical to the docker-compose Postgres image
(`postgres:17-alpine` is the same artifact our `compose.yml` `postgres`
service pulls), so the validation transfers 1:1 to the live stack.

## Validation evidence

### 1. Forward migration apply (0000 → 0010)

`@testcontainers/postgresql` boots PG 17-alpine; we replicate the
production role bootstrap (CREATE openwhispr_owner BYPASSRLS,
CREATE openwhispr_app, GRANT SET on `app.tenant_id`), then run
`drizzle-orm/migrator/migrate()` against `migrations/` directory
(`migrationsSchema: '_meta'`).

Results (from `migration-0006-backfill.test.ts` `beforeAll`):

```
RUN  v4.1.5
Test Files  1 passed (1)
     Tests  2 passed (2)
  Duration  ~1.3s — full migration chain 0000..0010 forward-applied,
                    backfill verified, idempotency re-confirmed.
```

Migrations applied in order without error: `0000_initial → 0001_better_auth →
0002_oauth_state → 0003_better_auth_tenant_defaults → 0004_email_lowercase_normalize →
0005_session_token_plain → 0006_tenant_settings → 0007_notes_folders →
0008_conversations_messages → 0009_transcriptions → 0010_api_keys`.

### 2. RLS introspection (equivalent to `tools/lint-rls.ts`)

`packages/data/src/__tests__/settings-rls.test.ts` runs the exact same
`pg_class.relrowsecurity / relforcerowsecurity / pg_policies.qual /
information_schema.triggers` queries that `tools/lint-rls.ts` would emit,
asserted against all 8 new Phase 5 tables.

```
RUN  v4.1.5
Test Files  1 passed (1)
     Tests  7 passed (7)

  ✓ every new Phase-5 table has relrowsecurity = TRUE and relforcerowsecurity = TRUE
  ✓ every new Phase-5 table has an isolation policy referencing current_setting('app.tenant_id'
  ✓ seed_tenant_settings trigger on tenants is AFTER INSERT (Pitfall #8)
  ✓ inserting a new tenant auto-seeds tenant_settings (trigger fires)
  ✓ notes.content_search expression references only own-row immutable columns (Pitfall #1)
  ✓ notes content_search has a GIN index
  ✓ notes has partial UNIQUE on (tenant_id, user_id, client_note_id) WHERE NOT NULL
```

Tables verified with FORCE RLS = TRUE and isolation policy:

| Table             | ENABLE | FORCE | Policy refs `app.tenant_id` |
|-------------------|--------|-------|-----------------------------|
| tenant_settings   | ✓      | ✓     | ✓                           |
| user_settings     | ✓      | ✓     | ✓                           |
| folders           | ✓      | ✓     | ✓                           |
| notes             | ✓      | ✓     | ✓                           |
| conversations     | ✓      | ✓     | ✓                           |
| messages          | ✓      | ✓     | ✓                           |
| transcriptions    | ✓      | ✓     | ✓                           |
| api_keys          | ✓      | ✓     | ✓                           |

### 3. Cross-tenant property test (extended `rls-property.test.ts`)

PG 17-alpine + edoburu/pgbouncer:v1.23.1-p3 sidecar, transaction-mode
pool with `max=5` to force physical connection reuse. 8 new property
tests added on top of the existing 4 (users / sessions / audit_log /
usage_ledger) — 800 random cross-tenant attempts on the new tables.

```
RUN  v4.1.5 packages/data
Test Files  1 passed (1)
     Tests  14 passed (14)
  Duration  39.42s

  ✓ users (100 runs)
  ✓ sessions (50 runs)
  ✓ audit_log (30 runs)
  ✓ usage_ledger (30 runs)
  ✓ tenant_settings (100 runs)        — Phase 5 Plan 01
  ✓ user_settings (100 runs)          — Phase 5 Plan 01
  ✓ folders (100 runs)                — Phase 5 Plan 01
  ✓ notes (100 runs)                  — Phase 5 Plan 01
  ✓ conversations (100 runs)          — Phase 5 Plan 01
  ✓ messages (100 runs)               — Phase 5 Plan 01
  ✓ transcriptions (100 runs)         — Phase 5 Plan 01
  ✓ api_keys (100 runs)               — Phase 5 Plan 01
  ✓ fail-closed: query without withTenant returns zero rows or RLS-cast error
  ✓ schema export TENANT_SCOPED_TABLES covers the v1 surface
```

Every new table: SELECT under tenant B returns zero rows owned by
tenant A; UPDATE touches zero A-rows; DELETE removes zero A-rows.
800 randomized attempts, 0 leakage.

### 4. tools/lint-rls.ts — orchestrator post-merge step

Live invocation of `pnpm tsx tools/lint-rls.ts` against the running
docker-compose Postgres MUST be performed by the orchestrator after the
parallel-wave merge. The lint introspection logic is byte-identical to
the testcontainer assertions in #2 above, so a green
`settings-rls.test.ts` is a strong proxy. The orchestrator's
post-merge command:

```
pnpm --filter @openwhispr/data migrate
DATABASE_URL=postgres://openwhispr_owner:$POSTGRES_OWNER_PASSWORD@localhost:5432/openwhispr \
  pnpm tsx tools/lint-rls.ts
```

## Conclusion

PASSED. Wave 1 plans (05-02..05-04) MAY proceed to consume the new
tables and `@openwhispr/wire-schemas` package. The forward-only
migration chain 0006..0010 is validated against a real PG 17 instance.
All FORCE RLS / policy / GENERATED tsvector / partial UNIQUE / AFTER
INSERT trigger invariants from this plan's `<must_haves>` block are
verified by the integration test suite.

## Test artifacts

- `packages/data/src/__tests__/migration-0006-backfill.test.ts` (2 tests)
- `packages/data/src/__tests__/settings-rls.test.ts` (7 tests)
- `packages/data/src/__tests__/rls-property.test.ts` (14 tests; +8 new properties)
