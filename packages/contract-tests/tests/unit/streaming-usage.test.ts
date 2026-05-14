// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 1 — POST /api/streaming-usage contract test
// (WIRE-09).
//
// Asserts the wire shape returned by /api/streaming-usage against the
// canonical `StreamingUsageResponse` zod schema (Plan 01) when run
// against a fully deployed compose stack. The route is DB-only (no
// LiteLLM dependency) so it's available in every compose profile.
//
// Idempotency: posts the SAME sessionId twice; second call MUST return
// 200 (NOT 409) and the wordsUsed MUST NOT inflate beyond the first
// call's contribution (first-writer-wins per D-10).
//
// Skip semantics match the other CONTRACT-01 tests: `describe.skipIf
// (!REACHABLE)` so when no backend is up the suite passes cleanly.

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "../../src/env.js";
import { signInFixture } from "../../src/helpers/sign-in-fixture.js";
import { ErrorEnvelope, StreamingUsageResponse } from "../../src/schemas.js";

const REACHABLE = await probeBackend();

function randomSessionId(): string {
  return `contract-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

describe.skipIf(!REACHABLE)("WIRE-09 — POST /api/streaming-usage", () => {
  it("returns canonical UsageResponse for a new sessionId", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const sessionId = randomSessionId();
    const res = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        audioDurationSeconds: 30,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const parsed = StreamingUsageResponse.parse(json);
    expect(parsed.plan).toBe("unlimited");
    expect(parsed.limitReached).toBe(false);
    expect(parsed.wordsRemaining).toBe(999_999_999);
    expect(parsed.wordsUsed).toBeGreaterThanOrEqual(30);
  });

  it("idempotent — same sessionId twice returns 200 both times (NOT 409, D-10)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const sessionId = randomSessionId();
    const payload = JSON.stringify({
      sessionId,
      audioDurationSeconds: 45,
    });
    const r1 = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    const r2 = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.status).not.toBe(409);
    const j1 = StreamingUsageResponse.parse(await r1.json());
    const j2 = StreamingUsageResponse.parse(await r2.json());
    // First-writer-wins: second call's wordsUsed must equal the first's
    // (the retry no-op'd, so the SUM aggregator returns the same total).
    expect(j2.wordsUsed).toBe(j1.wordsUsed);
  });

  it("returns 401 envelope when called without a session cookie or bearer", async () => {
    const res = await fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: randomSessionId(),
        audioDurationSeconds: 30,
      }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it("returns 400 envelope when sessionId is missing (zod rejection)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/streaming-usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioDurationSeconds: 30 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
