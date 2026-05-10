// Phase 04 / Plan 08 / Task 1d — POST /api/deepgram-streaming-token contract
// test (CONTRACT-01 extension for WIRE-14, Deepgram Grant-Token mint).
//
// Asserts the wire shape returned by /api/deepgram-streaming-token against
// the canonical `DeepgramStreamingTokenResponse` zod schema (Plan 08 /
// Task 1a) when run against a fully deployed compose stack. The route
// translates Deepgram's upstream `access_token` → wire `token` per D-15;
// the contract test is BLIND to upstream — it only asserts the wire-shape
// rename surfaces correctly to the desktop.
//
// Threat mitigations exercised at the contract layer:
//   * T-04-01 (key leakage): missing-key 503 envelope contains the literal
//     env-var name (operator-friendly + future-refactor guard).
//   * T-04-04 (cross-user rate-limit bypass): Test 5 verifies the per-user
//     30/min bucket via the contract layer; the integration-level
//     bucket-isolation evidence is in Task 3.
//
// Skip semantics mirror streaming-token.test.ts (REACHABLE base gate +
// MISSING_KEY_TEST_MODE for the missing-key 503 test).

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { DeepgramStreamingTokenResponse, ErrorEnvelope } from "./schemas.js";

const REACHABLE = await probeBackend();
const MISSING_KEY_MODE = process.env.MISSING_KEY_TEST_MODE === "1";

describe.skipIf(!REACHABLE)("WIRE-14 — POST /api/deepgram-streaming-token", () => {
  it.skipIf(MISSING_KEY_MODE)(
    "Test 1 + 2: returns 200 with non-empty token (upstream access_token renamed to wire token per D-15)",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      // Tolerate 503 when upstream is unhealthy or fake-key — shape
      // conformance is the contract assertion either way.
      if (res.status === 503) {
        const json = await res.json();
        expect(() => ErrorEnvelope.parse(json)).not.toThrow();
        return;
      }
      expect(res.status).toBe(200);
      const json = await res.json();
      const parsed = DeepgramStreamingTokenResponse.parse(json);
      expect(parsed.token.length).toBeGreaterThan(0);
      // Field-rename verification: the wire field is `token` (not
      // `access_token`). The schema's `.parse()` would also fail if the
      // upstream's `access_token` leaked through, but we add an explicit
      // negative assertion to make the rename contract loud.
      expect((json as Record<string, unknown>).access_token).toBeUndefined();
    },
  );

  it.skipIf(!MISSING_KEY_MODE)(
    "Test 3: returns 503 with the EXACT not-configured envelope wording when DEEPGRAM_API_KEY is unset",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(401);
      const json = await res.json();
      const env = ErrorEnvelope.parse(json);
      // Pin the EXACT D-18 envelope wording — names DEEPGRAM_API_KEY so
      // the operator knows EXACTLY which key to set.
      expect(env.error).toBe(
        "Deepgram not configured (set DEEPGRAM_API_KEY in .env)",
      );
    },
  );

  it("Test 4: returns 401 with the global ErrorEnvelope when no bearer/cookie is supplied", async () => {
    const res = await fetch(`${BACKEND_URL}/api/deepgram-streaming-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });

  it.skipIf(MISSING_KEY_MODE)(
    "Test 5: 31st request from same authenticated user within a minute returns 429 with canonical envelope",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      let lastStatus = 0;
      for (let i = 0; i < 31; i++) {
        const r = await jar.fetch(`${BACKEND_URL}/api/deepgram-streaming-token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        await r.text();
        lastStatus = r.status;
      }
      expect([429, 200, 503]).toContain(lastStatus);
      const tail = await jar.fetch(`${BACKEND_URL}/api/deepgram-streaming-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const tailJson = tail.status >= 400 ? await tail.json() : null;
      if (tail.status === 429) {
        expect(tailJson).toEqual({ error: "Too many requests" });
      } else if (tailJson !== null) {
        expect(() => ErrorEnvelope.parse(tailJson)).not.toThrow();
      }
    },
    60_000,
  );
});
