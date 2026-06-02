// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 1 Plan 04 / D-18 — `withTenant<T>` is the single chokepoint that
// every app-side database operation must flow through.
//
// Why this file exists:
//
//   The constitutional multi-tenancy invariant ("no row from tenant A is
//   ever visible to a request running under tenant B") is enforced at the
//   Postgres layer via FORCE ROW LEVEL SECURITY policies that reference
//   `current_setting('app.tenant_id', true)`. Those policies only work if
//   the GUC is actually set on the connection servicing the query — and
//   under PgBouncer transaction-mode the connection is multiplexed across
//   tenants, which means the GUC MUST be transaction-scoped (released at
//   COMMIT/ROLLBACK) rather than session-scoped.
//
//   Postgres exposes two ways to set a transaction-scoped GUC:
//     1. `SET LOCAL app.tenant_id = '<uuid>'` — string-only, NOT
//        parameterizable. Any user-supplied tenantId would have to be
//        concatenated into the SQL. SQL-injection risk.
//     2. `SELECT set_config('app.tenant_id', $1, true)` — accepts a bind
//        parameter for the value. The third argument (`true`) is the
//        LOCAL flag. Functionally equivalent to `SET LOCAL`, parameter-
//        safe.
//
//   We use form (2). The wire-format guarantee comes from Drizzle's `sql`
//   template tag: `${tenantId}` produces a Param node, NOT string
//   interpolation, and the underlying `pg` driver binds it at the protocol
//   level. The unit tests in __tests__/tenant-context.test.ts pin this
//   contract by inspecting the recorded SQL fragment + bound params.
//
//   We also gate the call with a UUID regex BEFORE opening the
//   transaction. This is defense in depth (drizzle would parameterize
//   garbage just fine, but the policy CAST would explode at execution
//   time and we'd burn a roundtrip for nothing) AND a clean error message
//   for callers who pass `undefined` or a malformed value.
//
// References:
//   - .planning/phases/01-core-infra-multi-tenant-data/01-RESEARCH-DB.md §"Pattern 2"
//   - .planning/phases/01-core-infra-multi-tenant-data/01-RESEARCH-DB.md §"Pitfall 1"
//   - .planning/phases/01-core-infra-multi-tenant-data/01-CONTEXT.md D-18
import { sql } from "drizzle-orm";

const TENANT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Minimal db shape `withTenant` requires. Plan 03 ships a fully-typed
 * `NodePgDatabase<typeof schema>`; we accept the structural minimum here
 * so this file compiles independently of `packages/data/src/schema/index.ts`
 * (which is Plan 03's scope) and stays unit-testable with a hand-rolled
 * spy. The real Drizzle DB satisfies this shape.
 */
export interface TransactionalDb<TX> {
  transaction<T>(cb: (tx: TX) => Promise<T>): Promise<T>;
}

export interface ExecutableTx {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Open a Postgres transaction, set the `app.tenant_id` GUC for its
 * duration via `set_config(name, value, true)`, run `fn(tx)`, and let
 * Drizzle's transaction wrapper commit on resolve / roll back on reject.
 *
 * The TENANT_UUID_RE pre-check rejects `''`, `undefined`, numbers, and
 * malformed strings before any wire activity.
 *
 * Phase 32 contract — fail-closed RLS posture (migration `0018_rls_fail_closed.sql`):
 *
 *   Any query executed AGAINST a tenant-scoped table OUTSIDE this helper
 *   (i.e. without a transaction-scoped `app.tenant_id` GUC set via
 *   `set_config`) is REFUSED by Row-Level Security as follows:
 *
 *     - SELECT  → returns 0 rows (silent deny-read).
 *     - INSERT  → raises PostgreSQL error `42501` ("new row violates
 *                 row-level security policy").
 *     - UPDATE  → affects 0 rows (the USING predicate reduces the target
 *                 set to empty).
 *     - DELETE  → affects 0 rows (same reason as UPDATE).
 *
 *   The pre-Phase-32 fail-open fallback — Better Auth role-default
 *   binding `app.tenant_id` to the placeholder default tenant — is
 *   REMOVED. Calling code MUST flow through `withTenant()` (this
 *   function) or `withSystemContext()` for system-scoped jobs that
 *   explicitly opt out of tenant isolation via BYPASSRLS roles.
 *
 *   See `packages/data/tests/unit/__tests__/rls-fail-closed.property.test.ts`
 *   for the 16-tables × 4-ops × 2-contexts = 128-case property proof.
 */
export async function withTenant<TX extends ExecutableTx, T>(
  db: TransactionalDb<TX>,
  tenantId: string,
  fn: (tx: TX) => Promise<T>,
): Promise<T> {
  if (typeof tenantId !== "string" || !TENANT_UUID_RE.test(tenantId)) {
    throw new Error(`withTenant: invalid tenant UUID: ${String(tenantId)}`);
  }
  return db.transaction(async (tx) => {
    // drizzle's `sql` template tag binds ${tenantId} as a parameter
    // rather than string-interpolating it. Verified by the unit test
    // `opens a tx and binds the tenantId via set_config`.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Quick 260602-j9z / blocker #2 — claim-driven privileged/cross-tenant escape
 * (Supabase `service_role` style). Opens a transaction, sets the
 * transaction-scoped `app.bypass='on'` GUC, runs `fn(tx)`, commits/rolls back.
 *
 * Migration `0033_rls_claim_driven_bypass.sql` makes every tenant-table RLS
 * policy honor this claim via an OR arm, so a SINGLE NOBYPASSRLS Postgres role
 * (corporate managed `svcdb_*`) can run system jobs + bootstrap that need
 * cross-tenant access — without the owner role's `BYPASSRLS` attribute.
 *
 * SECURITY CONTRACT — this MUST only be called from system jobs (worker
 * cross-tenant aggregates/ingest) and first-tenant bootstrap, NEVER from a
 * request-hot-path. A normal request flows through `withTenant` which sets ONLY
 * `app.tenant_id`; it never sets `app.bypass`, so the policy's bypass arm is
 * false and tenant isolation is unchanged. `set_config(..., true)` is
 * transaction-scoped, so the claim is released at COMMIT/ROLLBACK and cannot
 * leak across PgBouncer connection reuse. The 16-table × 3-context property
 * test (`rls-claim-bypass.property.test.ts`) is the proof.
 *
 * This Drizzle-transaction variant is for callers already on a Drizzle `db`.
 * Raw `pg.Pool` call sites use {@link withSystemBypassClient}.
 */
export async function withSystemBypass<TX extends ExecutableTx, T>(
  db: TransactionalDb<TX>,
  fn: (tx: TX) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass', 'on', true)`);
    return fn(tx);
  });
}

/** Minimal pg.PoolClient surface used by {@link withSystemBypassClient}. */
export interface BypassPoolClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

/** Minimal pg.Pool surface that hands out a {@link BypassPoolClient}. */
export interface BypassPool {
  connect(): Promise<BypassPoolClient>;
}

/**
 * Raw-`pg.Pool` sibling of {@link withSystemBypass}. Checks out a client,
 * opens a transaction, sets the transaction-scoped `app.bypass='on'` claim, runs
 * `fn(client)`, then COMMITs (or ROLLBACKs on throw) and releases the client.
 *
 * Same SECURITY CONTRACT as {@link withSystemBypass}: system jobs + bootstrap
 * only. Use this for the worker's `appOwnerPool.query(...)` cross-tenant call
 * sites (ingest-litellm-spend, reconciliation-daily-check, usage-rollup
 * dispatcher) and the bootstrap owner-pool `users` writes, which issue raw
 * `pg` queries rather than Drizzle transactions.
 */
export async function withSystemBypassClient<T>(
  pool: BypassPool,
  fn: (client: BypassPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass', 'on', true)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure — surface the original error.
    }
    throw err;
  } finally {
    client.release();
  }
}
