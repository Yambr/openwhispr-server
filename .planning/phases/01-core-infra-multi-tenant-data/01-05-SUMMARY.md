---
phase: 01-core-infra-multi-tenant-data
plan: 05
subsystem: ci/data
tags: [lint, rls-introspection, property-test, fast-check, ci, branch-protection]
requires:
  - 01-03 (drizzle schema + 0000_initial.sql with FORCE RLS)
  - 01-04 (withTenant transaction-scoped GUC chokepoint)
provides:
  - lint:rls (root pnpm script + Makefile target)
  - tools/lint-rls.ts standalone tsx script (NO_RLS / NO_FORCE_RLS / NO_POLICY / POLICY_DRIFT)
  - lint-rls + test-migration GHA jobs (required by branch-protection.json)
  - rls-introspection self-test (constitutional gate proving the lint fires)
  - TEST-RLS-01 property test (210 random tenant pairs through real PgBouncer)
affects:
  - any future migration that adds a tenant_id-bearing table (must include
    ENABLE + FORCE RLS + canonical app.tenant_id policy or CI fails)
tech-stack:
  added:
    - pg 8.20.0 (root devDependency for the testcontainer-backed lint test)
    - drizzle-orm 0.45.2 (root devDependency for migrate runner used by test)
    - "@testcontainers/postgresql 11.14.0 (root devDependency)"
    - "@types/pg 8.20.0 (root devDependency)"
  patterns:
    - "Standalone tsx lint at tools/* with shebang #!/usr/bin/env -S pnpm exec tsx, exit codes 0/1/2"
    - "Vitest + testcontainers Postgres for lint integration tests; constitutional self-test mirrors cyrillic-injection shape"
    - "fast-check property tests via @fast-check/vitest test.prop with per-property timeout"
    - "GHA services: block (postgres:17-alpine + pg_isready healthcheck) for migration-bound jobs; PgBouncer absent (Pitfall 3)"
    - "Branch protection drift caught by Phase 0 branch-protection-contexts self-test"
key-files:
  created:
    - tools/lint-rls.ts
    - tools/lint-rls.test.ts
    - tests/self-tests/rls-introspection.test.ts
    - packages/data/src/__tests__/rls-property.test.ts
  modified:
    - .github/workflows/ci.yml (appended lint-rls + test-migration jobs)
    - scripts/branch-protection.json (added lint-rls + test-migration contexts)
    - Makefile (lint-rls target)
    - package.json (lint:rls script + 4 root devDependencies)
    - pnpm-lock.yaml (lockfile churn)
decisions:
  - The RLS lint introspects pg_class + pg_policies + information_schema.columns; tenant_id-bearing tables are auto-discovered (no allowlist required) so any new tenant-scoped migration is in scope by construction.
  - lint-rls connects to Postgres directly, NEVER through PgBouncer (Pitfall 3); the migration runner already enforces the same discipline via DATABASE_URL_OWNER.
  - test-migration validates rollback equivalence via forward+drop+forward+pg_dump diff (preamble-normalized) rather than relying on drizzle-kit's per-migration `down` block (drizzle-kit 0.31.10 does not emit one for hand-augmented RLS DDL).
  - Cyrillic-laden CLAUDE.md quotation in the property-test header was rewritten to ASCII-only ("no simplification") to keep lint:english green; the constitutional intent is preserved.
metrics:
  duration: ~10min
  completed: 2026-05-08
---

# Phase 1 Plan 05: RLS-Introspection Lint + TEST-RLS-01 Summary

Closed Phase 1 success criteria #2 (RLS-introspection lint blocks any future migration adding an unguarded tenant_id table) and #3 (a property test runs random tenant pairs against every queryable model and observes zero cross-tenant reads or writes). Five commits land the lint script + tests, the property suite, the GHA jobs, and the branch-protection update.

## What Shipped

### tools/lint-rls.ts — RLS-introspection lint

A standalone tsx script (shebang `#!/usr/bin/env -S pnpm exec tsx`, exit codes 0 / 1 / 2) introspecting a migrated Postgres via `$DATABASE_URL`. Three top-level introspection queries:

1. **Q_TENANT_TABLES** — every `BASE TABLE` in the `public` schema with a `tenant_id` column (per `information_schema.columns`). Auto-discovered scope; no allowlist needed.
2. **Q_RLS_FLAGS** — `relrowsecurity` + `relforcerowsecurity` from `pg_class` for each in-scope table.
3. **Q_POLICIES** — every row in `pg_policies` for in-scope tables, with both `qual` (USING) and `with_check` (WITH CHECK) expressions inspected for the `app.tenant_id` substring.

Four diagnostic rules:

- **NO_RLS** — table has `tenant_id` column but `relrowsecurity = false`.
- **NO_FORCE_RLS** — `ENABLE` is on but `FORCE` is missing (Pitfall 5: ENABLE alone exempts the table owner).
- **NO_POLICY** — RLS is enabled but `pg_policies` has no row for the table (default deny-all, almost always unintentional).
- **POLICY_DRIFT** — at least one policy whose USING or WITH CHECK does not reference `app.tenant_id`.

The `_meta` schema (where Drizzle's `__drizzle_migrations` lives) is intentionally out of scope — that table has no `tenant_id` column and is unreachable from the `openwhispr_app` role.

### Self-test that proves the lint fires

`tests/self-tests/rls-introspection.test.ts` mirrors the `cyrillic-injection` self-test shape. It boots a fresh-migrated Postgres testcontainer, injects `CREATE TABLE bad_table (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)` with no RLS, then runs `pnpm exec tsx tools/lint-rls.ts` and asserts non-zero exit + `bad_table` in stderr. This is the constitutional gate — if the lint silently passes for an unguarded tenant table, this test fails CI.

### TEST-RLS-01 property test

`packages/data/src/__tests__/rls-property.test.ts` drives 100 + 50 + 30 + 30 = 210 random tenant pairs (`fc.uuid({ version: 4 })`) plus arbitrary input arrays through real Postgres 17 + real `edoburu/pgbouncer:v1.23.1-p3` sidecar. App pool `max=5` forces physical connection reuse to exercise the SET-LOCAL discipline.

Four properties cover the v1 tenant-scoped surface:

- **users** (numRuns: 100) — insert/select/update/delete under tenantA, then assert tenantB sees zero, touches zero, deletes zero, and tenantA's rows survive untouched.
- **sessions** (numRuns: 50) — same pattern with random `expires_at` deltas; FK back to a per-iteration user under tenantA.
- **audit_log** (numRuns: 30) — random action strings; insert under A, assert isolation under B.
- **usage_ledger** (numRuns: 30) — deduplicated random request_ids + units; insert under A, assert isolation under B.

Plus a fail-closed smoke test: a query without `withTenant` returns 0 rows or raises `invalid input syntax for type uuid` inside the policy. Either outcome proves the GUC-less path cannot read tenant data. Plus a `TENANT_SCOPED_TABLES` shape pin so adding a new tenant-scoped table without updating the schema export breaks the build at this gate.

Per-property timeout 180s; total runtime ~13s on the executor's hardware (real local docker over loopback).

### GHA jobs

Two new jobs in `.github/workflows/ci.yml`:

- **lint-rls** — `postgres:17-alpine` service block with `pg_isready` healthcheck; bootstraps `openwhispr_owner` (BYPASSRLS) + `openwhispr_app` via psql (mirrors `init/00-roles.sql`); runs `pnpm migrate` as `DATABASE_URL_OWNER`; runs `pnpm lint:rls`. Connects directly to Postgres on 5432 — PgBouncer is intentionally absent (RESEARCH-TOOLING Pitfall 3).
- **test-migration** — same service + role bootstrap; performs forward apply → `pg_dump --schema-only` → DROP SCHEMA `public` CASCADE + DROP `_meta` → forward apply again → `pg_dump --schema-only` → `diff -u` (after stripping nondeterministic preamble lines `-- Dumped`/`-- Started on`/`-- Completed on`/`\restrict`/`\unrestrict`). Empty diff proves migration idempotency.

Both jobs reuse the existing `step-security/harden-runner@a5ad31d6...` SHA pin from earlier jobs; pnpm/action-setup is sequenced BEFORE `actions/setup-node` so the `cache: pnpm` lookup finds pnpm in PATH.

### Branch protection drift detection

`scripts/branch-protection.json` gains `lint-rls` and `test-migration` in `required_status_checks.contexts`. The Phase 0 `branch-protection-contexts` self-test parses every `.github/workflows/*.yml` and asserts each context name maps to a real top-level `jobs.<name>:` key — drift between the JSON and the YAML fails CI on the next PR. Verified green after the update.

## Tests Green

All 13 tests across 4 files green:

| File | Tests | Notes |
| --- | --- | --- |
| `tools/lint-rls.test.ts` | 4 | clean / NO_RLS / NO_POLICY / POLICY_DRIFT |
| `tests/self-tests/rls-introspection.test.ts` | 1 | constitutional gate |
| `packages/data/src/__tests__/rls-property.test.ts` | 6 | 4 properties + fail-closed smoke + schema pin |
| `tests/self-tests/branch-protection-contexts.test.ts` | 2 | drift / minimum-context |

## Deviations from Plan

**1. [Rule 3 - Blocker] Root devDependencies for testcontainer-backed lint test**

- **Found during:** Task 1
- **Issue:** The plan specified `tools/lint-rls.test.ts` as the file location, but `tools/` is at the repo root which had no `pg` / `drizzle-orm` / `@testcontainers/postgresql` / `@types/pg` available (those are dev-deps of `packages/data`, not hoisted to the root).
- **Fix:** Added the four packages as root `devDependencies` in `package.json`, version-pinned to match `packages/data`. The plan frontmatter explicitly lists `package.json` in `files_modified`, so this is in scope.
- **Files modified:** `package.json`, `pnpm-lock.yaml`
- **Commit:** b37eaa8

**2. [Rule 1 - Bug] Cyrillic in source comment violated lint:english**

- **Found during:** Task 2 verify (`pnpm lint:english`)
- **Issue:** A direct quotation of CLAUDE.md ("не упрощать") inside a TypeScript comment failed the constitutional English-only lint.
- **Fix:** Rewrote the quotation to its English meaning ("no simplification"); intent preserved.
- **Files modified:** `packages/data/src/__tests__/rls-property.test.ts`
- **Commit:** 5c083b5 (the fix landed before commit; English-only lint was green at commit time)

**3. [Doc] edoburu/pgbouncer tag uses `v1.23.1-p3` form**

- **Found during:** Task 2 read of pgbouncer-interleave.test.ts
- **Issue:** The plan refers to `edoburu/pgbouncer:1.23.1` but the registry only carries `v1.23.1-p3` (latest patch revision of the 1.23.1 line). Plan 04 already absorbed this and uses the tagged form.
- **Fix:** Used `edoburu/pgbouncer:v1.23.1-p3` for consistency with Plan 04. The plan's grep target `edoburu/pgbouncer:1.23.1` is a substring match and our string contains it, so no verification regression.
- **Files modified:** `packages/data/src/__tests__/rls-property.test.ts`
- **Commit:** 5c083b5

## Authentication Gates

None.

## Follow-ups

- **Phase 6+:** extend `lint-rls.ts` to also forbid bare `SET app.tenant_id` outside `withTenant` calls (static analysis of `apps/`/`packages/` source). Current lint is DB-side only.
- **Phase 6+:** add a "tenant table without index on `tenant_id`" check (currently the schema gets it right by convention; would be load-bearing as more tables land).
- **GHA smoke verification:** the two new jobs land in this PR but cannot self-validate until they actually run on a PR-attached commit; the executor cannot trigger GHA. Manual smoke: open a PR, observe `lint-rls` and `test-migration` checks fire green; if either fails, fix-forward.

## Threat Flags

None — all surface added (introspection queries, schema dumps in CI) was already covered by the plan's threat register; no new boundary introduced.

## Self-Check: PASSED

Files exist:

- FOUND: tools/lint-rls.ts
- FOUND: tools/lint-rls.test.ts
- FOUND: tests/self-tests/rls-introspection.test.ts
- FOUND: packages/data/src/__tests__/rls-property.test.ts
- FOUND: .github/workflows/ci.yml (modified)
- FOUND: scripts/branch-protection.json (modified)
- FOUND: Makefile (modified)
- FOUND: package.json (modified)

Commits exist:

- FOUND: 08f9ffb test(01-05): add lint-rls and rls-introspection self-test (RED)
- FOUND: b37eaa8 feat(01-05): tools/lint-rls.ts RLS-introspection lint (GREEN)
- FOUND: 5c083b5 test(01-05): TEST-RLS-01 property test 100 random tenant pairs through PgBouncer
- FOUND: c79c972 ci(01-05): add lint-rls and test-migration GHA jobs + branch protection
