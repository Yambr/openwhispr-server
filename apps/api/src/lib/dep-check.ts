// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 06-04 / Task 1 — dependency health check library (D-P2).
//
// Surface: `makeDepCheck({ pg, valkey, litellmUrl })` returns a function
// `(name) => Promise<DepResult>` that probes the named dep with:
//   - LRU cache (max:16, ttl:5_000) keyed by dep name
//   - in-flight promise dedup keyed by dep name (concurrent callers
//     share ONE upstream call within a cache window)
//   - 2s hard timeout on each probe
//
// Probes:
//   - 'postgres' → `SELECT 1` via the app's pg.Pool
//   - 'valkey'   → ioredis `PING`
//   - 'litellm'  → undici GET `${litellmUrl}/health`, fail on >=500
//
// Source-of-truth: 06-CONTEXT.md D-P2; 06-RESEARCH.md §5.
//
// The result shape `{ok, latency_ms, error?}` is the body shape the
// /readyz route serializes per-dep; do not change without coordinating
// with the e2e in tests/e2e/probes-dependency.test.ts.
import type { Redis } from "ioredis";
import { LRUCache } from "lru-cache";
import type { Pool } from "pg";
import { request } from "undici";

export interface DepResult {
  readonly ok: boolean;
  readonly latency_ms: number;
  readonly error?: string;
}

export type DepName = "postgres" | "valkey" | "litellm";

export interface DepCheckDeps {
  readonly pg: Pool;
  readonly valkey: Redis;
  readonly litellmUrl: string;
}

export type DepCheck = (name: DepName) => Promise<DepResult>;

/**
 * Build a memoized dep-check function bound to the injected deps.
 *
 * Cache + in-flight dedup are PER-FACTORY-INSTANCE so test isolation
 * is automatic (each `makeDepCheck()` call gets its own caches).
 */
export const makeDepCheck = (deps: DepCheckDeps): DepCheck => {
  const cache = new LRUCache<DepName, DepResult>({ max: 16, ttl: 5_000 });
  const inflight = new Map<DepName, Promise<DepResult>>();

  // Hard ceiling per probe. The header comment promised 2s; without
  // this Promise.race the postgres + valkey probes have no wall-clock
  // cap and a paused/unresponsive upstream would hang /readyz
  // indefinitely (the e2e probes-dependency suite caught this when
  // `docker pause postgres` made pg.Pool.connect() block forever).
  // litellm already had bodyTimeout / headersTimeout inside undici;
  // this race is the unified ceiling across all three probes.
  const PROBE_TIMEOUT_MS = 2_000;

  const probe = async (name: DepName): Promise<DepResult> => {
    const start = Date.now();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`${name} probe exceeded ${PROBE_TIMEOUT_MS}ms`)),
        PROBE_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([
        (async () => {
          if (name === "postgres") {
            const client = await deps.pg.connect();
            try {
              await client.query("SELECT 1");
            } finally {
              client.release();
            }
          } else if (name === "valkey") {
            await deps.valkey.ping();
          } else {
            const { statusCode, body } = await request(`${deps.litellmUrl}/health`, {
              method: "GET",
              bodyTimeout: PROBE_TIMEOUT_MS,
              headersTimeout: PROBE_TIMEOUT_MS,
            });
            // Drain body to release the socket back to the undici pool —
            // otherwise repeated probes accumulate hung sockets.
            await body.dump();
            if (statusCode >= 500) {
              throw new Error(`litellm ${statusCode}`);
            }
          }
        })(),
        timeoutPromise,
      ]);
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        error: (err as Error).message,
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };

  const memoized = async (name: DepName): Promise<DepResult> => {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const existing = inflight.get(name);
    if (existing) return existing;
    // probe() is total — it captures every error into a DepResult, so
    // the awaited promise CANNOT reject. We exploit that contract here
    // to keep the inflight bookkeeping branch-free and 100% coverable.
    // Adding a `.catch` arm would be unreachable defensive code; if a
    // future refactor lets an unhandled rejection escape probe(), the
    // test suite will surface it as a real failure rather than silently
    // swallow it here.
    const p = probe(name).then((result) => {
      cache.set(name, result);
      inflight.delete(name);
      return result;
    });
    inflight.set(name, p);
    return p;
  };

  return memoized;
};
