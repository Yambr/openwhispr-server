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
