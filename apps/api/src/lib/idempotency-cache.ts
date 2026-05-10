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
/** WR-02: jobId is stored on a sibling key so SETNX provides
 * first-writer-wins atomicity against concurrent binds. */
const JOBID_SUFFIX = ":jobid";
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
  /**
   * WR-01: `bodyHash` is required so the rescue path (cache expired /
   * corrupt between reserve and bind) can re-create the entry with the
   * real body fingerprint instead of a sentinel "unknown" — without it,
   * a legitimate retry with the same body would compare against
   * "unknown" and surface a spurious 409 conflict.
   */
  bindJobId(key: string, jobId: string, bodyHash: string): Promise<void>;
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
      // WR-02: jobId now lives on a sibling key (atomic SETNX-bound).
      // Fall back to existing.jobId for backward-compat with entries
      // written by older builds (first 24h after deploy).
      const siblingJobId = await redis.get(k + JOBID_SUFFIX);
      const jobId = siblingJobId ?? existing.jobId;
      if (jobId) {
        return { state: "hit", jobId };
      }
      return { state: "in-flight" };
    },

    async bindJobId(key, jobId, bodyHash) {
      const k = KEY_PREFIX + key;
      // WR-02: write jobId to the sibling :jobid key with SET NX EX.
      // If another concurrent writer beat us, the SETNX is a no-op —
      // first-writer-wins. The losing job becomes orphaned (mitigated by
      // pyannote billing-on-success-only); attribution converges on the
      // winner for all subsequent retries.
      await redis.set(k + JOBID_SUFFIX, jobId, {
        EX: TTL_SECONDS,
        NX: true,
      });
      const raw = await redis.get(k);
      if (!raw) {
        // Reservation expired between submit and bind (would only happen
        // if the submit step took >24h, which is impossible — the
        // POLL_CEILING_MS is 5min). Best-effort: re-create the entry at
        // full TTL so an immediate retry hits the cache.
        // WR-01: persist the real bodyHash (NOT "unknown") so a
        // subsequent identical retry returns state='hit' instead of
        // state='conflict' against a sentinel.
        const entry: CacheEntry = {
          bodyHash,
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
        // WR-01: same fix on the corrupted-JSON branch.
        const entry: CacheEntry = {
          bodyHash,
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
