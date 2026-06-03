---
quick_id: 260603-rls
slug: app-role-tenant-default
date: 2026-06-03
status: complete
validate: true
---

# Summary: bind `app.tenant_id` rolconfig on a renamed managed app-role (upstream #7)

Migrations `0003`/`0024` bind the default-tenant GUC via
`ALTER ROLE openwhispr_app SET app.tenant_id …` under an
`IF EXISTS (… rolname = 'openwhispr_app')` guard. On a managed Postgres whose
single login role is `svcdb_*`, that guard is false → the GUC is never bound for
the role the app connects as → Better Auth's pre-auth `verification` INSERT lands
`tenant_id = NULL` (the column DEFAULT `current_setting('app.tenant_id', true)`
resolves to nothing) → FORCE RLS WITH CHECK violation → **500 on sign-in**.

## Fix (ran --validate; plan-checker GO, 2 WARNINGs addressed)

New exported `bindAppRoleTenantDefault(pool, env, log)` in
`packages/data/src/migrate.ts`, called from `main()` right after
`grantAppRoleMembership` — a faithful sibling of the #2 GRANT-inheritance step:
- No-op when `DATABASE_APP_ROLE` is unset or equals canonical `openwhispr_app`
  (migrations already cover the bundled role).
- `pgIdent(appRole)` guards the identifier (no parameterized bind for
  `ALTER ROLE <ident>` — DDL-injection guard).
- Probes `pg_roles`; skips + logs when the role is absent (fresh compose).
- `ALTER ROLE <role> SET app.tenant_id TO '<nil-uuid>'` — idempotent rolconfig,
  same nil-UUID literal the migrations + `MIGRATE_SESSION_OPTIONS` use.

**Migrations 0003/0024 left byte-identical** (CLAUDE.md rule 1: the runtime step
is additive; never mutate frozen migration history to chase a managed-role edge).

### plan-checker WARNINGs addressed
- **W1** (stub matcher): probe SELECTs a `present` column (not `both`); stub keys
  on `/pg_roles/`; the `ALTER ROLE` statement contains no `pg_roles` token and
  falls through to `rows: []`. Exact ALTER SQL text + nil-UUID pinned in the test.
- **W2** (LOGIN-role + docs): added a code comment that `DATABASE_APP_ROLE` must
  be the LOGIN role, and extended `docs/security.md` §Role-name-independence so
  both halves of the renamed-role contract (GRANT + rolconfig) live together.

## Verification (own eyes)

- TDD RED: 5 tests failed (`bindAppRoleTenantDefault is not a function`).
- GREEN: new test **5 passed**; sibling `migrate-grant-app-role` **8 passed**;
  `migrate.test.ts` **3 passed** — no regression (13/16/27 across widening sets).
- Branch coverage: all 5 reachable branches (unset / equals-canonical / pgIdent-
  throw / role-absent / exists+ALTER) have one test each → 100% on the new diff.
- typecheck `@openwhispr/data` exit **0**; biome clean on both changed files.
- Merge-gating lockers (no-hardcode, no-suppressions, no-env-branches,
  shell-credential-interpolation, secret-shape-in-error) all **PASS**. nil-UUID
  on migrate.ts:339 allowlisted in LOCKER-03 (matching the :57 MIGRATE_SESSION
  entry).
- LOCKER-04 (nightly, non-merge-blocking, Phase-41-deferred): my function is a
  **WARN** (allowlisted); the 6 remaining FAILs are byte-identical to clean HEAD
  (pre-existing Phase-38 backlog incl. the shipped `grantAppRoleMembership`).
  **Zero new FAILs introduced.**

## Acceptance

Managed PG with `DATABASE_APP_ROLE=svcdb_owhspr`: after `node migrate.cjs` the
role carries `app.tenant_id` in `pg_db_role_setting` → sign-in `verification`
INSERT resolves the default tenant → no 500. Bundled `openwhispr_app` compose
path unchanged. Closes #7.

## Out of scope / next

Local commit on main only — batches with #5/#10 (and the pending #9) for one
release. Pre-existing LOCKER-04 migrate.ts backlog realignment is the owner's
Phase-41 work, not this blocker fix (CLAUDE.md rule 2).
