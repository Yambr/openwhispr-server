// Phase 03 / Plan 06 / Task 2 — idempotency-cache.ts tests.
//
// Strategy: a hand-rolled in-memory RedisLike fake records every SET/GET
// invocation, including the options object — that's what we assert on
// (NX, EX, KEEPTTL semantics + key namespace + TTL value). The cache is
// pure logic on top of @redis/client primitives; the integration with a
// real Valkey is exercised by the diarization route's contract test.
//
// Coverage matrix (5 behaviors per plan, plus edges):
//   * fresh key  → state='reserved' + SET NX EX
//   * same body  → state='hit' (jobId returned)
//   * diff body  → state='conflict' (no overwrite)
//   * race       → state='in-flight' (reservation present, jobId null)
//   * bindJobId  → SET KEEPTTL preserves expiry
//   * key prefix 'diar:idem:'
//   * TTL 86400s

import { beforeEach, describe, expect, it } from "vitest";
import {
  createIdempotencyCache,
  type IdempotencyCache,
  type RedisLike,
  TTL_SECONDS,
} from "../idempotency-cache.js";

interface SetCall {
  key: string;
  value: string;
  opts?: { EX?: number; NX?: boolean; KEEPTTL?: boolean };
}

interface FakeRedis extends RedisLike {
  setCalls: SetCall[];
  getCalls: string[];
  /** Direct manipulation surface for setting up "race" / "expired" scenarios. */
  store: Map<string, string>;
}

function makeFakeRedis(): FakeRedis {
  const store = new Map<string, string>();
  const setCalls: SetCall[] = [];
  const getCalls: string[] = [];
  return {
    store,
    setCalls,
    getCalls,
    async set(key, value, opts) {
      setCalls.push({ key, value, opts });
      if (opts?.NX === true && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      getCalls.push(key);
      return store.get(key) ?? null;
    },
  };
}

const KEY = "client-supplied-idempotency-key";
const BODY_A = "sha256-of-body-a";
const BODY_B = "sha256-of-body-b";

describe("createIdempotencyCache.lookupOrReserve", () => {
  let redis: FakeRedis;
  let cache: IdempotencyCache;

  beforeEach(() => {
    redis = makeFakeRedis();
    cache = createIdempotencyCache(redis);
  });

  it("returns state='reserved' on first write and stores reservation with 24h TTL via NX", async () => {
    const result = await cache.lookupOrReserve(KEY, BODY_A);
    expect(result).toEqual({ state: "reserved", jobId: null });
    expect(redis.setCalls).toHaveLength(1);
    const call = redis.setCalls[0]!;
    expect(call.key).toBe(`diar:idem:${KEY}`);
    expect(call.opts?.NX).toBe(true);
    expect(call.opts?.EX).toBe(TTL_SECONDS);
    expect(TTL_SECONDS).toBe(86_400);
    const persisted = JSON.parse(call.value);
    expect(persisted.bodyHash).toBe(BODY_A);
    expect(persisted.jobId).toBeNull();
    expect(typeof persisted.createdAt).toBe("number");
  });

  it("returns state='hit' with bound jobId when same body posts again", async () => {
    await cache.lookupOrReserve(KEY, BODY_A);
    await cache.bindJobId(KEY, "job-12345", BODY_A);
    const second = await cache.lookupOrReserve(KEY, BODY_A);
    expect(second).toEqual({ state: "hit", jobId: "job-12345" });
  });

  it("returns state='conflict' when same key reused with different body hash (Stripe semantics)", async () => {
    await cache.lookupOrReserve(KEY, BODY_A);
    await cache.bindJobId(KEY, "job-A", BODY_A);
    const second = await cache.lookupOrReserve(KEY, BODY_B);
    expect(second).toEqual({ state: "conflict" });
  });

  it("returns state='in-flight' when reservation exists but jobId not yet bound (race window)", async () => {
    await cache.lookupOrReserve(KEY, BODY_A);
    // No bindJobId yet — second writer arrives.
    const second = await cache.lookupOrReserve(KEY, BODY_A);
    expect(second).toEqual({ state: "in-flight" });
  });

  it("conflict detection works even before jobId is bound (different body, no jobId)", async () => {
    await cache.lookupOrReserve(KEY, BODY_A);
    const second = await cache.lookupOrReserve(KEY, BODY_B);
    expect(second).toEqual({ state: "conflict" });
  });

  it("treats missing entry after NX-preempt as fresh (race: key expired in <1ms)", async () => {
    // Simulate: NX returns null AND the subsequent GET returns null
    // (key expired between the two operations).
    const racy: FakeRedis = makeFakeRedis();
    let setCount = 0;
    racy.set = async (key, value, opts) => {
      racy.setCalls.push({ key, value, opts });
      setCount += 1;
      if (setCount === 1 && opts?.NX) {
        // First call: pretend a value is present (NX returns null) but
        // the GET will see the expiry happen in the gap.
        return null;
      }
      racy.store.set(key, value);
      return "OK";
    };
    const c = createIdempotencyCache(racy);
    const result = await c.lookupOrReserve(KEY, BODY_A);
    expect(result).toEqual({ state: "reserved", jobId: null });
  });

  it("treats corrupted JSON entry as fresh (defensive)", async () => {
    redis.store.set(`diar:idem:${KEY}`, "not-json{");
    const result = await cache.lookupOrReserve(KEY, BODY_A);
    expect(result).toEqual({ state: "reserved", jobId: null });
  });

  it("namespaces all keys with 'diar:idem:' prefix", async () => {
    await cache.lookupOrReserve("alpha", BODY_A);
    await cache.lookupOrReserve("beta", BODY_A);
    expect(redis.setCalls.map((c) => c.key)).toEqual([
      "diar:idem:alpha",
      "diar:idem:beta",
    ]);
  });
});

describe("createIdempotencyCache.bindJobId", () => {
  let redis: FakeRedis;
  let cache: IdempotencyCache;

  beforeEach(() => {
    redis = makeFakeRedis();
    cache = createIdempotencyCache(redis);
  });

  it("updates the reservation with the new jobId via SET KEEPTTL (preserves expiry window)", async () => {
    await cache.lookupOrReserve(KEY, BODY_A);
    await cache.bindJobId(KEY, "job-55", BODY_A);
    // The bind call should have used KEEPTTL.
    const bindCall = redis.setCalls[redis.setCalls.length - 1]!;
    expect(bindCall.opts?.KEEPTTL).toBe(true);
    // KEEPTTL is mutually exclusive with EX (we want to keep the
    // remaining TTL from the original SET NX EX).
    expect(bindCall.opts?.EX).toBeUndefined();
    expect(bindCall.opts?.NX).toBeUndefined();
    const persisted = JSON.parse(bindCall.value);
    expect(persisted.jobId).toBe("job-55");
    expect(persisted.bodyHash).toBe(BODY_A); // bodyHash preserved
  });

  it("re-creates the entry with full TTL when reservation has expired (best-effort) — preserves bodyHash (WR-01)", async () => {
    // No prior reservation — bindJobId called against expired key.
    await cache.bindJobId(KEY, "job-rescue", BODY_A);
    const last = redis.setCalls[redis.setCalls.length - 1]!;
    expect(last.opts?.EX).toBe(TTL_SECONDS);
    expect(last.opts?.KEEPTTL).toBeUndefined();
    const persisted = JSON.parse(last.value);
    expect(persisted.jobId).toBe("job-rescue");
    // WR-01: rescue must persist the real bodyHash (not a sentinel "unknown")
    // or a subsequent identical retry surfaces a spurious 409 conflict.
    expect(persisted.bodyHash).toBe(BODY_A);
  });

  it("re-creates entry on corrupted JSON during bind (defensive) — preserves bodyHash (WR-01)", async () => {
    redis.store.set(`diar:idem:${KEY}`, "not-json{");
    await cache.bindJobId(KEY, "job-rescue", BODY_A);
    const last = redis.setCalls[redis.setCalls.length - 1]!;
    // Recreated with EX (full TTL), not KEEPTTL.
    expect(last.opts?.EX).toBe(TTL_SECONDS);
    const persisted = JSON.parse(last.value);
    expect(persisted.jobId).toBe("job-rescue");
    expect(persisted.bodyHash).toBe(BODY_A);
  });

  it("WR-01: legitimate retry after rescue path still returns state='hit' (no spurious 409)", async () => {
    // Simulate the rescue path: bindJobId called without a prior
    // reservation (key expired or corrupt). Pre-fix this wrote
    // bodyHash:"unknown" — the next lookupOrReserve with the real
    // body would see "unknown" !== bodyHash and return state='conflict'.
    // Post-fix: bodyHash is persisted, retry returns state='hit'.
    await cache.bindJobId(KEY, "job-rescue", BODY_A);
    const second = await cache.lookupOrReserve(KEY, BODY_A);
    expect(second).toEqual({ state: "hit", jobId: "job-rescue" });
  });

  it("bind followed by lookup with same body returns state='hit' with correct jobId", async () => {
    await cache.lookupOrReserve(KEY, BODY_A);
    await cache.bindJobId(KEY, "job-final", BODY_A);
    const lookup = await cache.lookupOrReserve(KEY, BODY_A);
    expect(lookup).toEqual({ state: "hit", jobId: "job-final" });
  });
});
