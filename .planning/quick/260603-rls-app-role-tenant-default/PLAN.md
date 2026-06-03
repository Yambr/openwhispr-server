---
quick_id: 260603-rls
slug: app-role-tenant-default
date: 2026-06-03
status: planned
validate: true
---

# Plan: bind `app.tenant_id` rolconfig on a renamed managed app-role (upstream #7)

## Problem (verified own-eyes)

Migrations `0003_better_auth_tenant_defaults.sql:43-48` and
`0024_better_auth_tenant_id_defaults.sql:40-45` both run, inside a
`DO $$ … IF EXISTS (… rolname = 'openwhispr_app') $$` guard:

```sql
ALTER ROLE openwhispr_app SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'
```

This rolconfig is what binds the GUC `app.tenant_id` at backend-connect for
the app role, so Better Auth's bare adapter INSERTs (the pre-auth
`verification` row on sign-in, plus `users`/`sessions`/`account`) resolve their
`tenant_id` column DEFAULT (`current_setting('app.tenant_id', true)::uuid`) to
the default tenant. Without it the GUC is unset → the column DEFAULT is NULL →
the row violates the `FORCE RLS` WITH CHECK → **500 on sign-in**
(CLAUDE.md rule 16 documents this exact cohort).

On a managed Postgres where the single app role is named `svcdb_*` (not
`openwhispr_app`), the `IF EXISTS … 'openwhispr_app'` guard is false → the
rolconfig is NEVER applied to the role the app actually connects as → GUC
unset → sign-in 500s. Same root cause as blocker #2 (the GRANT chain), already
solved there by `DATABASE_APP_ROLE` + `grantAppRoleMembership`.

## Fix — mirror `grantAppRoleMembership` exactly

Add a sibling post-migrate runtime step `bindAppRoleTenantDefault(pool, env, log)`
in `packages/data/src/migrate.ts`, called from `main()` immediately AFTER
`grantAppRoleMembership(pool, process.env)` (line 249). It:

1. Reads `env.DATABASE_APP_ROLE?.trim()`. No-op when unset OR equals the
   canonical `openwhispr_app` (the bundled compose path — migrations already
   covered it; re-running would be a harmless duplicate but we skip for clarity
   and symmetry with the sibling).
2. `pgIdent(appRole)` — rejects any identifier outside `[A-Za-z_][A-Za-z0-9_]*`
   (DDL-injection guard; `ALTER ROLE` takes no parameterized bind for the role
   name, same constraint as the GRANT).
3. Probes `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)` — skips + logs
   when the role is absent (fresh compose that hasn't created the custom role).
4. `ALTER ROLE <appRole> SET app.tenant_id TO '00000000-0000-0000-0000-000000000000'`.
   The default-tenant UUID is the nil-UUID literal (LOCKER-03 allowlisted,
   matches `MIGRATE_SESSION_OPTIONS` + both migrations). Idempotent — `ALTER
   ROLE … SET` overwrites any prior value.

**Migrations 0003/0024 stay byte-identical** — they correctly bind the bundled
`openwhispr_app` and MUST NOT change (CLAUDE.md rule 1: never edit production
SQL to chase a managed-role edge; the runtime step is additive). The rolconfig
applies at the NEXT backend connect after migrate; PgBouncer recycling picks it
up — same semantic the migrations already rely on for `openwhispr_app`.

### Why not parameterize the tenant UUID
It is a fixed constitutional constant (`DEFAULT_TENANT_ID`, nil-UUID). Both
migrations + `MIGRATE_SESSION_OPTIONS` hardcode the same literal; introducing
an env knob would be scope-creep and a new RLS-posture surface. Keep it literal.

## TDD (RED → GREEN, same commit)

New `packages/data/tests/unit/__tests__/migrate-bind-app-role-tenant.test.ts`
mirroring `migrate-grant-app-role.test.ts` (stub `pg.Pool.query`, assert emitted
SQL + guard branches). Cases:
- no-ops when `DATABASE_APP_ROLE` unset (0 calls)
- no-ops when it equals `openwhispr_app` (0 calls)
- emits `ALTER ROLE svcdb_owhspr SET app.tenant_id TO '00000000-…'` when custom
  role set + role exists (probe + ALTER = 2 calls; assert exact SQL text)
- skips the ALTER when the role is absent (probe only = 1 call)
- rejects an unsafe role name via `pgIdent` before any query (`rejects.toThrow(/pgIdent/)`)

No integration churn — this is a pure-unit stubbed-pool surface exactly like the
#2 sibling. (The live managed-role path is exercised by the operator's deploy;
`migration-fresh-nobypassrls.test.ts` already covers the single-role replay.)

## Acceptance
On a managed PG with `DATABASE_APP_ROLE=svcdb_owhspr`, after `node migrate.cjs`
the role carries `app.tenant_id` in `pg_db_role_setting` → Better Auth sign-in
`verification` INSERT resolves the default tenant → no 500. Bundled
`openwhispr_app` compose path unchanged. Closes #7.

## Risk / security
RLS GUC binding = security-sensitive (rule 16). The new step only ADDS a
rolconfig to an operator-named role that already needs the app GRANT chain
(blocker #2); it cannot widen exposure (single-tenant v1, exactly one tenant,
nil-UUID). `pgIdent` blocks DDL injection. → ran via `--validate` (plan-checker
before code).
