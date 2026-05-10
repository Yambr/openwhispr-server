// Phase-2 debt back-fill — coverage closure for lib/default-tenant.ts.
//
// The module is a memoised constant resolver (Phase 2 / Plan 01 / Task 3).
// Before back-fill: B=50 S=83 — the cache-hit short-circuit at line 30 was
// never exercised. This file pins both legs of the memoisation branch:
//   1. cold call → returns stable default-tenant UUID, populates cache
//   2. warm call → returns cached value WITHOUT recomputing
//   3. reset hook (`_resetDefaultTenantCacheForTesting`) clears the cache
//
// Pure-JS unit test; no Fastify, DB, or testcontainer needed — the module
// has no external dependencies and the constant is stable per the Phase-1
// seed contract.

import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetDefaultTenantCacheForTesting,
  resolveDefaultTenantId,
} from "../default-tenant.js";

const SEEDED_DEFAULT_TENANT = "00000000-0000-0000-0000-000000000000";

describe("resolveDefaultTenantId — memoisation contract", () => {
  beforeEach(() => {
    _resetDefaultTenantCacheForTesting();
  });

  it("cold call returns the Phase-1 seeded default-tenant UUID", async () => {
    const id = await resolveDefaultTenantId();
    expect(id).toBe(SEEDED_DEFAULT_TENANT);
  });

  it("warm call returns the SAME reference (cache hit, line 30 short-circuit)", async () => {
    const first = await resolveDefaultTenantId();
    const second = await resolveDefaultTenantId();
    // Both calls land the same value AND the second call exercises the
    // `if (cached) return cached;` branch — the only branch missing from
    // Stage-A coverage.
    expect(second).toBe(first);
    expect(second).toBe(SEEDED_DEFAULT_TENANT);
  });

  it("_resetDefaultTenantCacheForTesting clears the memoised value", async () => {
    await resolveDefaultTenantId();
    _resetDefaultTenantCacheForTesting();
    // After reset, the next call recomputes (cold path) — strict-equal
    // by value is enough; identity isn't part of the contract.
    const after = await resolveDefaultTenantId();
    expect(after).toBe(SEEDED_DEFAULT_TENANT);
  });

  it("three sequential warm calls all hit the cache", async () => {
    const a = await resolveDefaultTenantId();
    const b = await resolveDefaultTenantId();
    const c = await resolveDefaultTenantId();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
