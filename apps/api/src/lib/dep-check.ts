// SPDX-License-Identifier: FSL-1.1-ALv2
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
//   - 'litellm'  → undici GET `${litellmUrl}/health/readiness`, fail on >=500
//
// R29 (quick-task 20260522): the litellm probe hits `/health/readiness`,
// NOT `/health`. `/health` is a DEEP diagnostic — it fans out and
// actively probes every model in `model_list` (Groq, OpenRouter,
// OpenAI); if any provider is briefly slow / rate-limited it reports a
// non-200 and our probe flips to 503 even though the PROXY itself is
// fully able to serve requests. `/health/readiness` checks the proxy's
// OWN state (`{"status":"healthy","db":"connected"}`) with NO provider
// fan-out — the correct "is the proxy able to accept requests" signal
// for a tight readiness poll. Both `depCheck` consumers (`/readyz` and
// the compose healthcheck via `/api/ready`) want "deps able to serve",
// not "every provider model up", so `/health/readiness` is right for
// both.
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
  /**
   * Phase 59 / Track B — R16 facet 1. True when the dep was intentionally
   * NOT probed (e.g. a deploy whose `LITELLM_BASE_URL` is unset because a
   * corporate operator points the AI plane elsewhere, or a slim deploy
   * with no bundled litellm). A `skipped` dep is reported `ok:true` and
   * EXCLUDED from the `/readyz` aggregate — an intentionally-absent
   * subsystem must not 503 the readiness probe.
   */
  readonly skipped?: boolean;
}

export type DepName = "postgres" | "valkey" | "litellm";

export interface DepCheckDeps {
  readonly pg: Pool;
  readonly valkey: Redis;
  /**
   * LiteLLM base URL (probed at `/health/readiness`). When unset/empty the litellm probe is
   * SKIPPED (returns `{ok:true, skipped:true}`) instead of attempting an
   * outbound call — see `DepResult.skipped`.
   */
  readonly litellmUrl?: string;
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
    // Phase 59 / Track B — R16 facet 1: an unset/empty litellmUrl means
    // the AI plane is intentionally absent on this deploy. Report the
    // litellm dep `skipped` (ok:true) WITHOUT an outbound call; `/readyz`
    // excludes a skipped dep from its aggregate so an intentionally-
    // absent subsystem never 503s the readiness probe.
    if (name === "litellm" && !deps.litellmUrl?.trim()) {
      return { ok: true, latency_ms: 0, skipped: true };
    }
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
            // litellmUrl is guaranteed non-empty here — the `skipped`
            // short-circuit at the top of probe() handled the absent case.
            const url = (deps.litellmUrl as string).trim();
            // R29 — `/health/readiness` (proxy-state only), NOT `/health`
            // (deep provider fan-out that flaps 503 on any provider hiccup).
            const { statusCode, body } = await request(`${url}/health/readiness`, {
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
