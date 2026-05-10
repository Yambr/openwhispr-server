// Phase 03 / Plan 06 / Task 2 — Stripe-style idempotency cache (D-07 REVISED).
//
// Backed by Valkey (or Redis 7.x) via @redis/client — the same client family
// already used by @fastify/rate-limit (apps/api/src/plugins/rate-limit.ts).
// Choosing @redis/client over ioredis here keeps the runtime dependency
// surface single-vendor; the plan's example ioredis snippet is treated as
// pseudocode and adapted to @redis/client's options-object API.
//
// Semantics (mirrors Stripe's Idempotency-Key contract):
//   * lookupOrReserve(key, bodyHash):
//       - state='reserved'  → first writer; caller proceeds with submit
//       - state='hit'        → previous writer bound a jobId; caller skips submit
//       - state='in-flight'  → reservation present but no jobId yet (race window)
//       - state='conflict'   → same key, DIFFERENT bodyHash → 409 (T-03-06-03)
//   * bindJobId(key, jobId): updates the reservation; preserves TTL via KEEPTTL
//
// Key namespace: 'diar:idem:<key>'
// TTL: 24h (TTL_SECONDS = 86_400) — long enough that legitimate desktop
// retries within a session window hit the cache; short enough that orphaned
// reservations don't accumulate.

const KEY_PREFIX = "diar:idem:";
export const TTL_SECONDS = 86_400; // 24h

/** Persisted entry shape inside Valkey. */
interface CacheEntry {
  bodyHash: string;
  jobId: string | null;
  createdAt: number;
}

export type LookupState =
  | { state: "reserved"; jobId: null }
  | { state: "hit"; jobId: string }
  | { state: "in-flight" }
  | { state: "conflict" };

/**
 * Minimal subset of the @redis/client RedisClientType surface used by this
 * module. Declared as an interface so tests can inject a fake without
 * depending on the full client type (which carries a heavy generic
 * signature).
 */
export interface RedisLike {
  set(
    key: string,
    value: string,
    opts?: { EX?: number; NX?: boolean; KEEPTTL?: boolean },
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

export interface IdempotencyCache {
  lookupOrReserve(key: string, bodyHash: string): Promise<LookupState>;
  bindJobId(key: string, jobId: string): Promise<void>;
}

export function createIdempotencyCache(redis: RedisLike): IdempotencyCache {
  return {
    async lookupOrReserve(key, bodyHash) {
      const k = KEY_PREFIX + key;
      const reservation: CacheEntry = {
        bodyHash,
        jobId: null,
        createdAt: Date.now(),
      };
      // Atomic SET NX EX — first-writer-wins. Returns 'OK' on success,
      // null when the key already exists (NX preempted).
      const setResult = await redis.set(k, JSON.stringify(reservation), {
        EX: TTL_SECONDS,
        NX: true,
      });
      if (setResult === "OK") {
        return { state: "reserved", jobId: null };
      }
      // Key already existed — fetch and decide.
      const raw = await redis.get(k);
      if (!raw) {
        // Race: key expired between SET NX and GET. Treat as fresh — the
        // caller will go through the submit path. Idempotency window
        // collapsed to <1ms; cost is one duplicate pyannote job (still
        // covered by pyannote's billing-on-success-only invariant).
        return { state: "reserved", jobId: null };
      }
      let existing: CacheEntry;
      try {
        existing = JSON.parse(raw) as CacheEntry;
      } catch {
        // Corrupted entry (shouldn't happen unless an out-of-band writer
        // inserted garbage). Treat as fresh — safe regression to "submit"
        // path; pyannote billing-on-success-only protects against double
        // billing.
        return { state: "reserved", jobId: null };
      }
      if (existing.bodyHash !== bodyHash) {
        return { state: "conflict" };
      }
      if (existing.jobId) {
        return { state: "hit", jobId: existing.jobId };
      }
      return { state: "in-flight" };
    },

    async bindJobId(key, jobId) {
      const k = KEY_PREFIX + key;
      const raw = await redis.get(k);
      if (!raw) {
        // Reservation expired between submit and bind (would only happen
        // if the submit step took >24h, which is impossible — the
        // POLL_CEILING_MS is 5min). Best-effort: re-create the entry at
        // full TTL so an immediate retry hits the cache.
        const entry: CacheEntry = {
          bodyHash: "unknown",
          jobId,
          createdAt: Date.now(),
        };
        await redis.set(k, JSON.stringify(entry), { EX: TTL_SECONDS });
        return;
      }
      let existing: CacheEntry;
      try {
        existing = JSON.parse(raw) as CacheEntry;
      } catch {
        const entry: CacheEntry = {
          bodyHash: "unknown",
          jobId,
          createdAt: Date.now(),
        };
        await redis.set(k, JSON.stringify(entry), { EX: TTL_SECONDS });
        return;
      }
      existing.jobId = jobId;
      // KEEPTTL preserves the original 24h window so retries within that
      // window still hit the cached jobId.
      await redis.set(k, JSON.stringify(existing), { KEEPTTL: true });
    },
  };
}

export default createIdempotencyCache;
