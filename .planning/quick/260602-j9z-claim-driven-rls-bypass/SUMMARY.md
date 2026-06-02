---
quick_id: 260602-j9z
slug: claim-driven-rls-bypass
date: 2026-06-02
status: complete
validate: true
---

# Summary: claim-driven app.bypass RLS (no BYPASSRLS role required)

Blocker #2 of 3 upstream managed-Postgres deploy fixes (peer gr0flvsr). The most
security-sensitive — touches CLAUDE.md rule 16 (RLS posture ledger). Ran with
`--validate`: the plan-checker caught an incomplete system-job inventory (see
below) BEFORE execution, which would otherwise have shipped a broken deploy.

## Problem

The privileged/cross-tenant DB path relied on the owner role's `BYPASSRLS`
attribute. Corporate managed Postgres issues ONE `svcdb_*` role (NOBYPASSRLS,
non-superuser); security won't grant BYPASSRLS. So bootstrap (/api/setup/admin)
+ worker system jobs failed under FORCE RLS.

## Solution: Supabase service_role-style claim

- **Migration `0033_rls_claim_driven_bypass.sql`** — all 16 tenant-table RLS
  policies reshaped to `USING/WITH CHECK (current_setting('app.bypass',true)='on'
  OR tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)`.
  Exact 0018 policy names preserved; DROP POLICY IF EXISTS + CREATE (idempotent
  on a DB already at 0018). Companion `.down.sql` restores the 0018 bodies.
  Journal entry idx 34. Safe to edit-adjacent: drizzle 0.45.2 migrator applies
  by created_at timestamp, not hash.
- **`withSystemBypass(db, fn)`** (Drizzle) + **`withSystemBypassClient(pool, fn)`**
  (raw pg.Pool) in `packages/data/src/tenant-context.ts` — open a tx, set
  `set_config('app.bypass','on',true)` (transaction-scoped), run fn,
  commit/rollback. Exported from the data index.
- **System paths wired** (full inventory per plan-checker BLOCKER 1): worker
  `usage-rollup-daily` dispatcher, `ingest-litellm-spend` (users SELECT +
  usage_ledger INSERT), `reconciliation-daily-check` (users + usage_ledger
  cross-tenant SELECTs, combined into ONE bypass tx), and bootstrap
  `setup-admin` (the `users` SELECT/UPDATE/DELETE on the owner pool). Each was
  using `appOwnerPool.query`/`ownerPool.query` (raw pg) — hence the pool-client
  helper variant (plan-checker BLOCKER 2). partman-maintenance, audit-archive,
  reconciliation-discrepancy, usage-rollup tenant-child NOT wrapped (verified:
  no FORCE-RLS table touch / already withTenantContext).
- **Env role names** (decision: doc + role-membership GRANT) — `migrate.ts`
  `grantAppRoleMembership()`: when `DATABASE_APP_ROLE` ≠ `openwhispr_app`,
  `GRANT openwhispr_app TO <role>` after migrate so a custom role inherits the
  GRANT chain in one statement (pgIdent-safe, skipped when unset/default/absent).
  `DATABASE_APP_ROLE`/`DATABASE_OWNER_ROLE` documented in `.env.full.example`.
- **Docs** — `docs/security.md` §11 operator note updated (BYPASSRLS no longer
  required) + new §11.2 (claim-driven posture, isolation proof, role-name
  independence).

## Security invariant (preserved)

A normal request flows through `withTenant()` which sets ONLY `app.tenant_id`,
never `app.bypass` → the OR-arm's left side is false → tenant isolation
unchanged. `app.bypass` is set ONLY by the two system helpers (system jobs +
bootstrap), never a request-hot-path (grep confirmed zero other usages).
Transaction-scoped → no PgBouncer leak.

## Verification (own eyes)

- NEW `rls-claim-bypass.property.test.ts` — 16 tables × {bypass-works /
  isolation-preserved / fail-closed-preserved} on a **NOBYPASSRLS** appPool
  (proves the CLAIM, not a role attribute, grants access; first asserts
  `rolbypassrls=false`): **81 passed**.
- Existing RLS regression (rls-fail-closed 128 + rls-property + worker-rls +
  settings-rls + rls-posture-boundary): **169 passed** — fail-closed posture
  intact (OR-arm adds no fail-open path when app.bypass unset).
- `tenant-context.test.ts` (withSystemBypass/Client call-shape): 10 passed.
- `migrate-grant-app-role.test.ts` (GRANT builder + guards + pgIdent reject):
  5 passed.
- Worker jobs: reconciliation 17, ingest 23, usage-rollup 10 — all green.
- api setup-admin (main 10, rollback 3, auth-bypass 2): 15 passed.
- Coverage on new-logic source: 100/100/100/100.
- data + worker + api typecheck exit 0; biome clean; LOCKER lints clean.

## Debug note

The reconciliation "consistent snapshot mid-handler" test deadlocked under the
full file (passed in isolation). Root cause: the spyPool test (and the
rollback test's failing-pool Proxy) mutated the POOLED client's `query` method
in place; the mutation persisted on the physical connection and the next test's
`usage_ledger` BEGIN blocked. Fixed properly by returning a per-checkout PROXY
around the real client (no in-place mutation; real `release` delegated) — NOT
by widening timeouts. Reconciliation handler also combined into one bypass tx
(cheaper + consistent snapshot).

## Acceptance

Service boots + bootstraps first user + runs bg maintenance/rollup on a managed
DB with ONE NOBYPASSRLS role; tenant isolation fully preserved. ✓

## Out of scope

Full env-templating of role names in init/00-roles.tpl + every in-migration
GRANT (deferred — the membership GRANT covers the corp single-role case with
minimal dependencies). No push / no release here — Nick releases all three
blockers together.
