// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 02 / Task 2 — GET /api/usage contract test (WIRE-10).
//
// Asserts the wire shape of /api/usage against the canonical
// `UsageResponse` zod schema. The route is DB-only (no LiteLLM
// dependency) so it's available in every compose profile.
//
// Cumulative semantics: a fresh fixture user MAY have non-zero
// wordsUsed if prior contract-test runs populated the ledger (the
// compose stack persists state across test files). We assert the
// shape conformance + that wordsUsed is a non-negative finite number.
//
// Skip semantics match the other CONTRACT-01 tests.

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope, UsageResponse } from "./schemas.js";

const REACHABLE = await probeBackend();

describe.skipIf(!REACHABLE)("WIRE-10 — GET /api/usage", () => {
  it("returns canonical UsageResponse for an authenticated user", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/usage`, { method: "GET" });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = UsageResponse.parse(json);
    expect(parsed.plan).toBe("unlimited");
    expect(parsed.limitReached).toBe(false);
    expect(parsed.wordsRemaining).toBe(999_999_999);
    expect(Number.isFinite(parsed.wordsUsed)).toBe(true);
    expect(parsed.wordsUsed).toBeGreaterThanOrEqual(0);
  });

  it("returns 401 envelope when called without a session cookie or bearer", async () => {
    const res = await fetch(`${BACKEND_URL}/api/usage`, { method: "GET" });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it("reflects ledger writes — POST /api/streaming-usage then GET /api/usage shows incremented sum", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const before = UsageResponse.parse(
      await (await jar.fetch(`${BACKEND_URL}/api/usage`)).json(),
    );
    const sessionId = `usage-contract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const post = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, audioDurationSeconds: 7 }),
    });
    expect(post.status).toBe(200);
    const after = UsageResponse.parse(
      await (await jar.fetch(`${BACKEND_URL}/api/usage`)).json(),
    );
    // First-writer-wins idempotency means the ledger gained exactly
    // round(7)=7 units from this call. The test is robust to concurrent
    // writes from other tests by asserting the >= relationship.
    expect(after.wordsUsed).toBeGreaterThanOrEqual(before.wordsUsed + 7);
  });
});
