---
phase: 01-core-infra-multi-tenant-data
plan: 03
subsystem: data-plane-schema-rls-roles
tags: [drizzle, postgres, rls, migrations, multi-tenant, two-pool, testcontainers]
requirements: [DATA-01, DATA-02, DATA-06]
dependency-graph:
  requires:
    - .planning/phases/01-core-infra-multi-tenant-data/01-01-PLAN.md (compose stack: postgres, pgbouncer, env)
    - .planning/phases/01-core-infra-multi-tenant-data/01-02-PLAN.md (.env populated by bootstrap.sh)
    - tools/lint-english.ts (Phase 0 — English-only lint covers new sources)
  provides:
    - packages/data/src/schema/{tenants,users,sessions,audit_log,usage_ledger}.ts (Drizzle schema)
    - packages/data/src/schema/index.ts with TENANT_SCOPED_TABLES literal (auto-discovery hook)
    - packages/data/src/client.ts (makeAppDb / makeOwnerDb two-pool factory)
    - packages/data/src/migrate.ts (programmatic migration runner)
    - packages/data/migrations/0000_initial.sql (5 tables + FORCE RLS + 4 policies + grants)
    - packages/data/migrations/init/00-roles.sql.tpl + 00-roles.sh (role init template + wrapper)
    - packages/data/migrations/meta/{_journal.json, 0000_snapshot.json} (drizzle-kit ledger)
    - Makefile migrate / migrate-rollback targets
    - root package.json migrate / migrate:rollback scripts
  affects:
    - Plan 01-04 (tenant-context.ts + RLS property test consume schema + clients)
    - Plan 01-05 (RLS lint introspects pg_class.relrowsecurity + relforcerowsecurity)
    - Plan 01-06 (Makefile backup/restore lands; migrate target now real)
tech-stack:
  added:
    - drizzle-orm 0.45.2 (verified npm 2026-05-09)
    - drizzle-kit 0.31.10 (verified npm 2026-05-09)
    - pg 8.20.0 (verified npm 2026-05-09)
    - "@testcontainers/postgresql ^11.14.0"
    - testcontainers ^11.14.0
  patterns:
    - Two-pool client factory (RESEARCH-DB Pattern 1): makeAppDb via PgBouncer/RLS-subject; makeOwnerDb DIRECT to Postgres/BYPASSRLS
    - drizzle-kit generate -> hand-augment for ENABLE+FORCE RLS DDL + CREATE POLICY (assumption A1 confirmed)
    - migrations bookkeeping in dedicated _meta schema (Pitfall 8) so the lint over public stays clean
    - Default-tenant seed via INSERT ... ON CONFLICT (id) DO NOTHING with stable UUID 00000000-0000-0000-0000-000000000000 (D-17)
    - sed-based password substitution wrapper (00-roles.sh) for the Postgres init step (envsubst not present in alpine image)
    - Real Postgres 17 via testcontainers (CLAUDE.md "no mocks") — never pg-mem
key-files:
  created:
    - packages/data/drizzle.config.ts
    - packages/data/src/schema/tenants.ts
    - packages/data/src/schema/users.ts
    - packages/data/src/schema/sessions.ts
    - packages/data/src/schema/audit_log.ts
    - packages/data/src/schema/usage_ledger.ts
    - packages/data/src/schema/index.ts
    - packages/data/src/client.ts
    - packages/data/src/migrate.ts
    - packages/data/src/__tests__/helpers.ts
    - packages/data/src/__tests__/migration-rollback.test.ts
    - packages/data/src/__tests__/usage-ledger.test.ts
    - packages/data/src/__tests__/audit-log.test.ts
    - packages/data/migrations/0000_initial.sql
    - packages/data/migrations/init/00-roles.sql.tpl
    - packages/data/migrations/init/00-roles.sh
    - packages/data/migrations/meta/_journal.json
    - packages/data/migrations/meta/0000_snapshot.json
  modified:
    - packages/data/package.json (drizzle-orm/pg deps; drizzle-kit/testcontainers devDeps; exports map; scripts)
    - packages/data/src/index.ts (replaced Phase 0 placeholder with schema + client re-export)
    - Makefile (real migrate / migrate-rollback targets)
    - package.json (root migrate / migrate:rollback scripts)
    - pnpm-workspace.yaml (allowBuilds: cpu-features/protobufjs/ssh2 set true so testcontainers native deps build)
    - pnpm-lock.yaml
  deleted:
    - packages/data/src/index.test.ts (Phase 0 placeholder isPlaceholder() test)
decisions:
  - drizzle-kit 0.31.10 does NOT emit ENABLE/FORCE ROW LEVEL SECURITY or CREATE POLICY natively (assumption A1 verified empirically) — 0000_initial.sql is hand-augmented after generation; future migrations follow the same pattern, Plan 05 lint catches drift.
  - Migrations bookkeeping table (__drizzle_migrations) lives in the _meta schema, not public — keeps the RLS lint scope clean and prevents the _app role from accidentally seeing the ledger.
  - Two independent Postgres roles, never GRANT role TO role — owner and app are isolated by default; init script DO-block RAISES if _app ever inherits BYPASSRLS.
  - Owner pool connects DIRECT to Postgres on 5432, never through PgBouncer — BYPASSRLS + transaction-pool reuse is the documented leak vector (RESEARCH-DB §Anti-Patterns).
  - migrate.ts refuses to run if DATABASE_URL_OWNER is unset (no fallback to DATABASE_URL) — failsafe against accidental DDL via PgBouncer.
  - 00-roles.sh uses portable sed substitution rather than envsubst (gettext is absent from postgres:17-alpine) — same wrapper works on every official image variant.
  - GRANTs to openwhispr_app guarded by a DO-block existence check on pg_roles — the migration is safely runnable in test contexts (testcontainers) where the role is created via a different path.
  - Migration-rollback equivalence asserted via pg_dump --schema-only after forward + DROP SCHEMA CASCADE + forward, with normalization for pg_dump's nondeterministic preamble (\restrict tokens, COMMENT ON SCHEMA public, wall-clock timestamps).
metrics:
  duration: ~30 minutes
  tasks: 2
  commits: 2 (TDD red f79abe7 + green d7871af)
  tests-added: 8 (4 migration-rollback + 2 usage-ledger + 2 audit-log)
  files-created: 18
  files-modified: 6
  files-deleted: 1
  completed: 2026-05-09
---

# Phase 1 Plan 03: Drizzle schema + first migration with FORCE RLS + role init Summary

Drizzle ORM data layer (5 schema files, two-pool client factory) + the first migration `0000_initial.sql` (drizzle-kit-generated, hand-augmented for `ENABLE`/`FORCE` row level security DDL + four canonical tenant-isolation policies) + the role-init template + shell wrapper that the Postgres container runs once on first volume init. `pnpm migrate` is now real.

## What Shipped

### Drizzle schema (5 files, RESEARCH-DB byte-for-byte)

- `tenants.ts` — root, NOT tenant-scoped, NO RLS. `id uuid PK / name text / created_at / updated_at`.
- `users.ts` — RLS-subject, FK to tenants `ON DELETE RESTRICT`. `users_tenant_id_idx` + `users_tenant_email_unique` (tenant_id, email).
- `sessions.ts` — RLS-subject. Custom `bytea` type for `token_hash`. FKs to tenants + users (`ON DELETE CASCADE`). `sessions_tenant_id_idx` + `sessions_token_hash_idx`.
- `audit_log.ts` — RLS-subject, append-only (no `updated_at`). JSONB `payload` default `'{}'`. `audit_log_tenant_id_idx` + `audit_log_created_at_idx` (B-tree). GIN on payload deferred per RESEARCH-DB.
- `usage_ledger.ts` — RLS-subject, append-only. `request_id text UNIQUE` for idempotency (DATA-03). FKs to tenants + users.
- `index.ts` — re-exports all + `TENANT_SCOPED_TABLES = ['users','sessions','audit_log','usage_ledger'] as const` for Plan 04 PgBouncer-interleave property test and Plan 05 RLS lint.

### Two-pool client factory

`packages/data/src/client.ts` — `makeAppDb()` connects via `DATABASE_URL` (PgBouncer, `max=20`); `makeOwnerDb()` connects via `DATABASE_URL_OWNER` (direct Postgres:5432, `max=2`, throws if env unset). Sharing a single pool is explicitly forbidden — the comment block explains why (BYPASSRLS-capable connection handed to RLS-subject app code is a tenant-isolation breach).

### `0000_initial.sql` — hand-augmented post drizzle-kit

drizzle-kit 0.31.10 emits CREATE TABLE / FK / CREATE INDEX (assumption A1 from RESEARCH-DB confirmed: it does NOT emit `ENABLE`/`FORCE ROW LEVEL SECURITY` or `CREATE POLICY`). The migration was generated, renamed from the auto-tag (`0000_gigantic_fallen_one`) to `0000_initial`, and the `meta/_journal.json` ledger updated to match. The hand-augmentation appends:

1. `CREATE EXTENSION IF NOT EXISTS pgcrypto;` for `gen_random_uuid()`
2. The default-tenant seed: `INSERT INTO tenants (id, name) VALUES ('00000000-0000-0000-0000-000000000000', 'default') ON CONFLICT (id) DO NOTHING;` (D-17)
3. `ALTER TABLE <each tenant-scoped> ENABLE ROW LEVEL SECURITY;` + `FORCE ROW LEVEL SECURITY;` (Pitfall 5: ENABLE alone exempts the table owner)
4. Four `CREATE POLICY <table>_tenant_isolation` blocks using `current_setting('app.tenant_id', true)::uuid` for both `USING` and `WITH CHECK` (the `, true` is missing_ok — fail-closed: empty-string cast fails inside the policy and the row is denied)
5. `GRANT USAGE/SELECT/INSERT/UPDATE/DELETE` to `openwhispr_app` on each tenant-scoped table; `SELECT` only on `tenants`. The grants are wrapped in a `DO $$` block that checks for the role's existence so the migration is safely runnable from testcontainers where the role is created out-of-band.

### Roles init template + wrapper

`migrations/init/00-roles.sql.tpl` is the canonical template (`CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS PASSWORD '${POSTGRES_OWNER_PASSWORD}'`, plus the `_app` role without BYPASSRLS, plus the defensive `DO $$ ... RAISE EXCEPTION` if `_app` ever inherits BYPASSRLS). `00-roles.sh` is the executable wrapper docker mounts into `/docker-entrypoint-initdb.d/`: it sed-substitutes both passwords from the entrypoint env then pipes the result into `psql --variable ON_ERROR_STOP=1`. `envsubst` was not chosen because `postgres:17-alpine` does not ship gettext — `sed` is portable across every official image variant.

### Programmatic migration runner

`packages/data/src/migrate.ts` is invoked by `make migrate` and the `pnpm migrate` script. It refuses to start if `DATABASE_URL_OWNER` is unset (`exit 2`), passes `migrationsSchema: '_meta'` + `migrationsTable: '__drizzle_migrations'` so the bookkeeping stays in `_meta`, and always closes its pool (small `max=2` capacity).

### Makefile + root package.json

The Phase 0 stub `migrate: @echo "migrate target lands in Phase 1"; exit 1` is replaced with a real `pnpm --filter @openwhispr/data exec tsx src/migrate.ts` invocation. New `migrate-rollback` target wraps `drizzle-kit drop`. Root `package.json` adds matching `migrate` / `migrate:rollback` scripts.

## TDD Discipline

Two commits, both pre-commit-hook clean:

1. `f79abe7 test(01-03): add data-layer schema, client factory, and migration tests` — RED. The three integration tests fail because the migrations directory has no SQL yet (drizzle-kit reports "Can't find meta/_journal.json").
2. `d7871af feat(01-03): add Drizzle schema, first migration with FORCE RLS, role init` — GREEN. 8/8 tests pass against real Postgres 17 inside testcontainers.

```
$ pnpm --filter @openwhispr/data exec vitest run
 Test Files  3 passed (3)
      Tests  8 passed (8)
```

## Verify Block Results

| Check | Status |
|---|---|
| `grep -c 'FORCE  ROW LEVEL SECURITY' 0000_initial.sql` | 4 (one per tenant-scoped table) |
| `grep -q "00000000-0000-0000-0000-000000000000"` | 1 occurrence (default-tenant seed) |
| `grep -c 'CREATE POLICY'` | 4 DDL policies + 1 in the file's comment header |
| `grep -q 'BYPASSRLS' init/00-roles.sql.tpl` | present |
| `grep -q 'rolbypassrls' init/00-roles.sql.tpl` | present (defensive RAISE EXCEPTION) |
| `test -f migrations/meta/_journal.json` | exists, tag = `0000_initial` |
| Vitest 8/8 | pass |
| `pnpm --filter @openwhispr/data exec tsc --noEmit` | clean |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] `pnpm-workspace.yaml` placeholder `allowBuilds` entries.**
- **Found during:** Task 1 verify (`pnpm install` failed `ERR_PNPM_IGNORED_BUILDS` so the test runner's pre-install check aborted before vitest could run).
- **Issue:** Plan 01-02 left `cpu-features: set this to true or false`, `protobufjs: set this to true or false`, `ssh2: set this to true or false` as literal placeholders. Adding testcontainers (which depends on ssh2 + cpu-features and transitively protobufjs) made the placeholder check fail.
- **Fix:** Set all three to `true` in `pnpm-workspace.yaml` — testcontainers needs the native ssh2 binding to talk to Docker. The change is minimal and is the same call the operator would have to make eventually.
- **Files modified:** `pnpm-workspace.yaml` (+3 -3).
- **Commit:** `f79abe7` (TDD red).

**2. [Rule 1 — Bug] `migration-rollback.test.ts` `normalize()` was too tight.**
- **Found during:** Task 2 verify — first run of the green tests failed the byte-stable schema-dump assertion.
- **Issue:** PG17 `pg_dump --schema-only` emits a per-dump `\restrict <random-token>` / `\unrestrict <token>` pair to bracket the dump body, and the bootstrap container's auto-created `public` schema carries an empty `COMMENT ON SCHEMA public IS '';` that our DROP SCHEMA CASCADE + CREATE SCHEMA round-trip strips on the second pass. Neither difference reflects an actual schema change.
- **Fix:** Extended `normalize()` to drop `\restrict`/`\unrestrict` lines, the `COMMENT ON SCHEMA public` line, the surrounding banner+`--` framing, and to collapse runs of blank lines. Also added the same logic for `-- Started on` / `-- Completed on` headers for completeness.
- **Files modified:** `packages/data/src/__tests__/migration-rollback.test.ts`.
- **Commit:** `d7871af` (TDD green).

**3. [Rule 3 — Blocking issue] English-only lint failed pre-commit on a leftover Plan 04 file.**
- **Found during:** GREEN commit attempt — lefthook ran `pnpm lint:english` against the whole repo; an untracked `pgbouncer-interleave.test.ts` (Plan 04 territory, present in the working tree from a prior aborted attempt before this plan started) carried a Russian comment that tripped the Cyrillic scan.
- **Issue:** lefthook scans the whole working tree, not just staged files; one Cyrillic comment blocked any commit.
- **Fix:** Translated the offending one-line comment to English (`"не использовать моки"` -> `"no mocks"`); semantic content unchanged. The file is still untracked and remains Plan 04's responsibility — only the comment was edited.
- **Files modified:** `packages/data/src/__tests__/pgbouncer-interleave.test.ts` (working tree only, NOT staged or committed by this plan).
- **Commit:** none (untracked file).

### Pre-existing untracked artifacts (NOT touched by this plan)

A prior aborted attempt at Plan 04 left `packages/data/src/tenant-context.ts`, `packages/data/src/encryption/` (empty directory), `packages/data/src/__tests__/{tenant-context,pgbouncer-interleave}.test.ts`, and `apps/api/src/middleware/` in the working tree as untracked. They are Plan 04's territory; this plan did not stage, commit, or otherwise modify them (with the single English-only fix above). `apps/api/package.json` also carries an unstaged `@openwhispr/data` workspace dep that Plan 04 will commit.

## Authentication Gates

None.

## Threat Flags

None — all surface introduced (new tables, new role, new policies) is pre-declared in the plan's `<threat_model>` and mitigated as specified (T-01-03-01 through T-01-03-05). No new endpoints, no new auth paths, no new schema changes outside the approved set.

## Follow-ups (Plan 04 + Plan 05 forward refs)

- **Plan 04** consumes `makeAppDb()` and the schema export to build `withTenant<T>`, the Fastify `onRequest` tenant-extraction hook, and the PgBouncer-interleave property test. The encryption envelope (`encryption/{key-provider,env-key-provider,vault-key-provider,kms-key-provider,envelope}.ts`) also lands there.
- **Plan 05** introspects `pg_class.relrowsecurity`, `relforcerowsecurity`, and `pg_policies` to enforce that every public-schema table with a `tenant_id` column has both flags set and a policy referencing `current_setting('app.tenant_id')` — the lint that catches future forgotten-RLS regressions.
- **Phase 6+** open question: should `tenants` itself be RLS-protected once tenant resolution stops happening through this table? RESEARCH-DB Open Q1; revisit when per-tenant install patterns make the names sensitive.

## Self-Check: PASSED

All 18 created files verified on disk. Both per-task commits (`f79abe7` TDD red, `d7871af` TDD green) verified in `git log --all`. 8/8 vitest cases green against real Postgres 17 in testcontainers. drizzle-kit 0.31.10 + drizzle-orm 0.45.2 + pg 8.20.0 locked in `pnpm-lock.yaml`. Migration grep contracts met (4× FORCE RLS, 4 CREATE POLICY DDLs, 1 default-tenant seed UUID).
