// SPDX-License-Identifier: Apache-2.0
// Phase 03 Plan 08 — pg.Pool factory for the openwhispr application database
// connecting as `openwhispr_owner` (BYPASSRLS).
//
// Phase 6 Plan 06-07 / D-W4 layer 2 — runtime tenant-context guard:
//   - Wraps `pool.connect()` so the returned client's `query` method is
//     monkey-patched. On the FIRST query of each checkout, the wrapper runs
//     `SELECT current_setting('app.tenant_id', true)`:
//       * If the GUC is `''` (unset) AND the caller is NOT in system-mode
//         (checked via the AsyncLocalStorage published by
//         `apps/worker/src/lib/with-tenant-context.ts`), throws
//         `TenantContextMissingError`.
//       * If the caller IS in system-mode (withSystemContext), the guard
//         short-circuits and skips the check — BYPASSRLS is the expected
//         posture.
//     After the first check the per-checkout `guardChecked` flag flips to
//     true and subsequent queries take the fast path with zero overhead.
//   - The wrapper purposefully does NOT touch the un-RLS'd `openwhispr_owner`
//     role's GRANT chain — RLS isolation is enforced INSIDE each tenant
//     transaction via the GUC binding the HOF performs.
//
// Same Pitfall #9 defensive guard as the LiteLLM pool: must point DIRECT
// to postgres:5432, never to pgbouncer.
import pg from "pg";
import { getTenantContext } from "../lib/with-tenant-context.js";

const { Pool } = pg;

/**
 * Thrown by the D-W4 layer 2 runtime guard when an app-pool checkout issues
 * its first query without an `app.tenant_id` GUC bound AND without
 * explicit system-mode opt-in via `withSystemContext`.
 */
export class TenantContextMissingError extends Error {
  readonly code = "TENANT_CONTEXT_MISSING";
  constructor() {
    super(
      "app.tenant_id GUC is not set; wrap the handler in withTenantContext " +
        "or withSystemContext before issuing queries on the app pool.",
    );
    this.name = "TenantContextMissingError";
  }
}

/**
 * Wrap a `pg.Pool` so every client returned by `.connect()` enforces the
 * D-W4 layer 2 runtime guard on its first query. Exported so callers (and
 * tests) can instrument arbitrary pools beyond the one constructed by
 * `makeAppOwnerPool`.
 *
 * The wrapper preserves all pg.Pool method signatures by returning a
 * Proxy. Methods other than `connect` flow through unchanged.
 */
export function wrapPoolWithTenantGuard(pool: pg.Pool): pg.Pool {
  // Tag the pool object so we don't double-wrap (idempotent — useful when
  // both makeAppOwnerPool and ad-hoc tests call wrapPoolWithTenantGuard).
  const tagged = pool as pg.Pool & { __tenantGuardWrapped?: boolean };
  if (tagged.__tenantGuardWrapped) return pool;
  const origConnect = pool.connect.bind(pool);
  // biome-ignore lint/suspicious/noExplicitAny: pg overloads are not statically expressible here.
  (pool as unknown as { connect: any }).connect = function patchedConnect(cb?: unknown): unknown {
    // pg's internal `pool.query(...)` calls `pool.connect((err, client, done) => ...)`
    // with a node-style callback. We MUST NOT wrap the client when the
    // caller passed a callback — pool.query manages the client lifecycle
    // itself and our wrapper would interfere. The guard only fires when
    // user code calls `pool.connect()` without arguments and receives a
    // `Promise<PoolClient>`.
    if (typeof cb === "function") {
      // biome-ignore lint/suspicious/noExplicitAny: forwarding callback form
      return (origConnect as any)(cb);
    }
    return (async (): Promise<pg.PoolClient> => {
      // biome-ignore lint/suspicious/noExplicitAny: forwarding promise form
      const client = (await (origConnect as any)()) as pg.PoolClient;
      let guardChecked = false;
      const origQuery = client.query.bind(client);
      // biome-ignore lint/suspicious/noExplicitAny: pg.Client.query has 6 overloads
      (client as unknown as { query: any }).query = async (
        ...args: unknown[]
      ): Promise<unknown> => {
        // Identify "primer" queries — BEGIN, COMMIT, ROLLBACK, SET, RESET,
        // and `set_config()` calls — that the HOF issues to bind the GUC
        // BEFORE any real work. Primer queries pass through without
        // triggering the guard so the HOF can install the GUC; the first
        // NON-primer query triggers the probe.
        const text = typeof args[0] === "string" ? (args[0] as string) : "";
        const isPrimer =
          /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET\b|RESET\b)/i.test(text) ||
          /\bset_config\s*\(/i.test(text);
        if (!guardChecked && !isPrimer) {
          guardChecked = true;
          const ctx = getTenantContext();
          if (ctx?.mode !== "system") {
            const result = (await (origQuery as (...a: unknown[]) => Promise<unknown>)(
              "SELECT current_setting('app.tenant_id', true) AS tid",
            )) as { rows: Array<{ tid: string }> };
            const tid = result.rows[0]?.tid ?? "";
            if (!tid) {
              // Release the checkout before throwing so we don't leak it.
              try {
                client.release();
              } catch {
                /* swallow — checkout may already be released */
              }
              throw new TenantContextMissingError();
            }
          }
        }
        // biome-ignore lint/suspicious/noExplicitAny: forwarding
        return (origQuery as any)(...args);
      };
      return client;
    })();
  };

  // Also wrap `pool.query` directly so callers that bypass `pool.connect()`
  // and issue one-shot queries still go through the guard. Each pool.query
  // invocation is a self-contained checkout, so we check on every call.
  const origPoolQuery = pool.query.bind(pool);
  // biome-ignore lint/suspicious/noExplicitAny: pg.Pool.query has 6 overloads
  (pool as unknown as { query: any }).query = async (...args: unknown[]): Promise<unknown> => {
    const ctx = getTenantContext();
    if (ctx?.mode !== "system") {
      // We must run the probe on the SAME checkout as the real query.
      // Acquire a client manually, probe, then run the user's query, then
      // release. This sacrifices a hair of throughput for correctness.
      // biome-ignore lint/suspicious/noExplicitAny: promise form via origConnect
      const probeClient = (await (origConnect as any)()) as pg.PoolClient;
      try {
        const probe = (await probeClient.query(
          "SELECT current_setting('app.tenant_id', true) AS tid",
        )) as { rows: Array<{ tid: string }> };
        const tid = probe.rows[0]?.tid ?? "";
        if (!tid) throw new TenantContextMissingError();
        // biome-ignore lint/suspicious/noExplicitAny: forward to client.query
        return await (probeClient.query as any)(...args);
      } finally {
        probeClient.release();
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: forwarding
    return (origPoolQuery as any)(...args);
  };

  tagged.__tenantGuardWrapped = true;
  return pool;
}

export function makeAppOwnerPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const url = env.DATABASE_URL_OWNER;
  if (!url) {
    throw new Error("DATABASE_URL_OWNER is required");
  }
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // pg.Pool will surface a clearer error below.
  }
  if (host && /pgbouncer/i.test(host)) {
    throw new Error(
      `DATABASE_URL_OWNER must point DIRECT to postgres:5432, not pgbouncer host "${host}"`,
    );
  }
  const pool = new Pool({ connectionString: url, max: 5 });
  return wrapPoolWithTenantGuard(pool);
}
