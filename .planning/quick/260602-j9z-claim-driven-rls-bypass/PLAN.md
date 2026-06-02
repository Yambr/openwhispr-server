---
quick_id: 260602-j9z
slug: claim-driven-rls-bypass
date: 2026-06-02
status: complete
validate: true
---

# Quick Task: claim-driven app.bypass RLS (no BYPASSRLS role required)

Blocker #2 of 3 upstream managed-Postgres deploy fixes (peer gr0flvsr). The
LAST + most security-sensitive — touches CLAUDE.md rule 16 (RLS posture ledger).

## Problem (verified)

The privileged/cross-tenant DB path relies on the OWNER role's `BYPASSRLS`
attribute (apps/worker withSystemContext sets NO GUC + no tx; bootstrap
/api/setup/admin uses the owner pool). Corporate managed Postgres issues ONE
`svcdb_*` role that is NOBYPASSRLS + non-superuser; security won't grant
BYPASSRLS. So bootstrap + worker system jobs fail under FORCE RLS.

## Decision (with user): claim-driven `app.bypass` GUC (Supabase service_role style)

Add a transaction-scoped bypass CLAIM that the RLS policies honor, so a single
NOBYPASSRLS role passes every path. The RLS model (set_config app.tenant_id
per-tx, FORCE RLS, fail-closed 0018) is preserved — we ADD a bypass arm, we do
NOT weaken isolation.

### 1. Migration 0033_rls_claim_driven_bypass.sql (idx 34, when 1781798400000)
Reshape ALL 16 tenant-table RLS policies (DROP POLICY IF EXISTS + CREATE POLICY,
mirroring 0018) to:
```
USING (current_setting('app.bypass', true) = 'on'
       OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (current_setting('app.bypass', true) = 'on'
       OR "tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```
16 tables (0018 order): users, sessions, account, verification, audit_log,
usage_ledger, oauth_state, tenant_settings, user_settings, notes, folders,
conversations, messages, transcriptions, api_keys, usage_rollup_daily.
Note policy NAMES per 0018 (mix of `<t>_tenant_isolation` and `<t>_isolation`).
Idempotent (safe on a DB already at 0018). Companion `.down.sql` restores the
exact 0018 bodies (no app.bypass arm). Add `meta/_journal.json` entry + the
drizzle snapshot if drizzle-kit requires one (check 0018's snapshot handling —
hand-authored migrations may skip the snapshot; mirror 0018 exactly).

### 2. TWO bypass helpers (packages/data/src/tenant-context.ts, siblings of withTenant)
The call sites are a MIX: bootstrap setup_state uses Drizzle `db.transaction`,
but the worker jobs + bootstrap users-writes use raw `pg.Pool.query`. So provide
BOTH shapes (plan-checker BLOCKER 2):

```
// Drizzle-tx variant (for code already on Drizzle txns).
export async function withSystemBypass<TX extends ExecutableTx, T>(
  db: TransactionalDb<TX>, fn: (tx: TX) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass', 'on', true)`);
    return fn(tx);
  });
}

// Raw pg.Pool/PoolClient variant (for appOwnerPool.query call sites).
export async function withSystemBypassClient<T>(
  pool: { connect(): Promise<PoolClientLike> },
  fn: (client: PoolClientLike) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass', 'on', true)");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) { try { await client.query("ROLLBACK"); } catch {} throw e; }
  finally { client.release(); }
}
```
Both transaction-scoped (set_config 3rd arg true / wrapped in BEGIN/COMMIT) →
released at COMMIT/ROLLBACK; never leaks to a pooled connection. `PoolClientLike`
= minimal `{ query, release }` structural type (no hard `pg` dep in data pkg if
avoidable; pg IS a data-pkg dep so importing the type is fine). Export both from
packages/data index. NOTE: app-pool.ts:88-94 lets `set_config(...)` through its
tenant-guard primer + the system-mode short-circuit fires under withSystemContext
→ the bypass set_config won't trip the guard. Unit-test the param-binding shape.

### 3. Wire the claim into ALL FORCE-RLS-touching system paths (plan-checker BLOCKER 1+3)
Full inventory verified by plan-checker (touch one of the 16 FORCE-RLS tables via
the NOBYPASSRLS pool → MUST wrap; else break on managed single-role deploy):
- **ingest-litellm-spend** (apps/worker/src/jobs/ingest-litellm-spend.ts) — the
  `INSERT INTO usage_ledger` (~line 381) + `SELECT FROM users` (~242, 341) on
  `appOwnerPool`. Wrap runIngestOnce's DB work in withSystemBypassClient. (On
  NOBYPASSRLS the INSERT raises 42501 → billing ingest dies — CORE revenue path.)
- **reconciliation-daily-check** (reconciliation-daily-check.ts ~169, 192) — the
  cross-tenant `SELECT FROM users` + `SELECT FROM usage_ledger`. Wrap.
- **usage-rollup-daily DISPATCHER** (usage-rollup-daily.ts ~81) — `SELECT DISTINCT
  tenant_id FROM usage_ledger`. Wrap. (The tenant CHILD already uses
  withTenantContext → sets app.tenant_id → NO bypass needed; leave it.)
- **bootstrap** apps/api/src/index.ts setup-admin: the OWNER-POOL `users`
  statements specifically — `SELECT FROM users` (~329), `UPDATE users SET role`
  (~376), `DELETE FROM users` (~385). Wrap THESE in withSystemBypassClient. The
  `setup_state` Drizzle txn (~316) touches a NON-RLS table → no bypass. `tenants`
  is NOT one of the 16 → no bypass (but verify it inserts fine on NOBYPASSRLS).
- **NO wrap needed (verified)**: partman-maintenance (partman/pg_class only),
  audit-archive (DROP TABLE partition DDL, runs as table owner), reconciliation-
  discrepancy + usage-rollup tenant-child (already withTenantContext).
- CRITICAL: app.bypass is set ONLY in these system/bootstrap paths, NEVER in any
  request-hot-path. withTenant stays untouched (tenant-scoped only). grep
  confirmed ZERO existing app.bypass usages → no request handler can set it.

### 4. Role names from env (GRANTs not silently skipped on svcdb_*)
DATABASE_APP_ROLE (default 'openwhispr_app') / DATABASE_OWNER_ROLE (default
'openwhispr_owner'). The in-migration GRANTs to literal `openwhispr_app` under
IF EXISTS silently skip on a corp role name. RESOLUTION (minimal-dep): the
migrate runner (packages/data/src/migrate.ts, a boundary file) runs a templated
GRANT step AFTER drizzle migrate() using pgIdent()-validated role names from
env — OR a DO block in the migration resolves the role from a GUC the runner
sets. DECISION: do the post-migrate templated GRANT in migrate.ts (it already
has pgIdent + an admin connection pattern); the GRANT chain mirrors what
init/00-roles.sql.tpl + the existing migration grants give openwhispr_app
(SELECT/INSERT/UPDATE/DELETE on the app tables, USAGE on sequences). FLAG: this
is the one structural choice — surface in plan-check. Keep the literal-role
GRANTs in old migrations (idempotent / IF EXISTS) for back-compat.

### 5. Keep makeOwnerDb() / owner pool
On single-role deploy DATABASE_URL_OWNER == DATABASE_URL role (svcdb_*); bypass
now comes from the GUC claim, not the role attribute. No code removal.

### 6. Docs
docs/security.md §11 (RLS posture) + §11.1: BYPASSRLS NO LONGER REQUIRED
(claim-driven default); single NOBYPASSRLS role supported. .env.full.example:
DATABASE_APP_ROLE / DATABASE_OWNER_ROLE. Update RLS posture ledger note.

## Tests (TDD RED→GREEN) — property test is the security proof

NEW `rls-claim-bypass.property.test.ts` (sibling of rls-fail-closed.property,
reuses bootMigratedPostgres + the appPool which is ALREADY NOBYPASSRLS — this is
the managed-PG scenario). Per the 16 tables:
- (a) **bypass works**: inside a tx with `set_config('app.bypass','on',true)` on
  the NOBYPASSRLS appPool, cross-tenant SELECT sees BOTH tenants' rows, and
  INSERT of a foreign-tenant row succeeds (system path works w/o BYPASSRLS).
- (b) **isolation preserved**: WITHOUT app.bypass, under withCtx(TENANT_A),
  tenant-B row invisible (SELECT 0) AND tenant-B INSERT refused (42501) — the OR
  arm does NOT leak.
- (c) **fail-closed preserved**: with NEITHER GUC, SELECT 0 / INSERT 42501
  (0018 posture intact).
Plus a unit test for withSystemBypass (binds set_config('app.bypass','on',true)
via the sql template — mirror tenant-context.test.ts param-binding assertion).
Plus: keep ALL existing RLS tests green (rls-fail-closed.property,
worker-rls-property, rls-posture-boundary, rls-property, settings-rls).

## Acceptance

Service boots + bootstraps first user + runs bg maintenance/rollup on a managed
DB with ONE NOBYPASSRLS role; tenant isolation fully preserved.

## Constraints

Strict TDD; tests+code same commit; ≥90% diff coverage. No NODE_ENV outside
boundary. lint-migrations must pass the new migration (mirror 0018 policy DDL
shape). Local commits only — NO push/release (Nick releases all 3 together).
