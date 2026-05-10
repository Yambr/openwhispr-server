// Phase 04 / Plan 08 / Task 1e — POST /api/openai-realtime-token contract
// test (CONTRACT-01 extension for WIRE-15, OpenAI Realtime ephemeral
// client_secret mint).
//
// Asserts the wire shape returned by /api/openai-realtime-token against
// the canonical `OpenAIRealtimeTokenResponse` zod schema (Plan 08 / Task
// 1a) when run against a fully deployed compose stack. The route mints
// 1 OR 2 ephemeral OpenAI Realtime client_secrets via parallel
// Promise.all calls per D-17; this test pins both arities.
//
// Threat mitigations exercised at the contract layer:
//   * T-04-01 partial-success leakage: per D-17 the route's Promise.all
//     is fail-fast — a partial failure 503s BEFORE any successful secret
//     is serialized. Test 4 (missing-key 503) and Test 3 (bad streams=3
//     400) pin the fast-fail envelope shape; the unit-level partial
//     -success guard lives in tokens/openai-realtime.test.ts.
//   * T-04-INPUT (streams tampering): Test 3 pins the explicit allowlist
//     {1,2}; values outside the set return 400 with a structured
//     envelope.
//
// Skip semantics mirror streaming-token.test.ts (REACHABLE base gate +
// MISSING_KEY_TEST_MODE for the missing-key 503 test).

import { describe, expect, it } from "vitest";
import { BACKEND_URL, probeBackend } from "./env.js";
import { signInFixture } from "./helpers/sign-in-fixture.js";
import { ErrorEnvelope, OpenAIRealtimeTokenResponse } from "./schemas.js";

const REACHABLE = await probeBackend();
const MISSING_KEY_MODE = process.env.MISSING_KEY_TEST_MODE === "1";

describe.skipIf(!REACHABLE)("WIRE-15 — POST /api/openai-realtime-token", () => {
  it.skipIf(MISSING_KEY_MODE)(
    "Test 1: streams=1 returns 200 with clientSecrets length === 1; clientSecret === clientSecrets[0]",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/openai-realtime-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streams: 1 }),
      });
      // Tolerate 503 — upstream OpenAI may be unhealthy or key may be
      // a contract-profile fake. Shape conformance is the contract
      // assertion either way.
      if (res.status === 503) {
        const json = await res.json();
        expect(() => ErrorEnvelope.parse(json)).not.toThrow();
        return;
      }
      expect(res.status).toBe(200);
      const json = await res.json();
      const parsed = OpenAIRealtimeTokenResponse.parse(json);
      expect(parsed.clientSecrets).toHaveLength(1);
      expect(parsed.clientSecret).toBe(parsed.clientSecrets[0]);
    },
  );

  it.skipIf(MISSING_KEY_MODE)(
    "Test 2: streams=2 returns 200 with clientSecrets length EXACTLY 2; desktop assertion pinned",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/openai-realtime-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streams: 2 }),
      });
      if (res.status === 503) {
        const json = await res.json();
        expect(() => ErrorEnvelope.parse(json)).not.toThrow();
        return;
      }
      expect(res.status).toBe(200);
      const json = await res.json();
      const parsed = OpenAIRealtimeTokenResponse.parse(json);
      // Desktop asserts clientSecrets.length >= 2 when streams=2. The
      // server promises EXACTLY 2 (D-17 — Promise.all over Array(streams));
      // tighter assertion catches a regression where streams gets clamped.
      expect(parsed.clientSecrets).toHaveLength(2);
      expect(parsed.clientSecret).toBe(parsed.clientSecrets[0]);
      // Each secret is independent — they MUST NOT be equal (otherwise
      // the second mint failed to round-trip and the route silently fell
      // back to dup-ing the first secret). T-04-01 — a duplicated secret
      // would burn one mint while the desktop thinks it has two.
      expect(parsed.clientSecrets[0]).not.toBe(parsed.clientSecrets[1]);
    },
  );

  it("Test 3: streams=3 returns 400 with envelope mentioning the streams allowlist (T-04-INPUT)", async () => {
    const jar = await signInFixture("fixture@conformance.test");
    const res = await jar.fetch(`${BACKEND_URL}/api/openai-realtime-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streams: 3 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    const env = ErrorEnvelope.parse(json);
    expect(env.error).toMatch(/streams must be 1 or 2/);
  });

  it.skipIf(!MISSING_KEY_MODE)(
    "Test 4: returns 503 with the EXACT not-configured envelope wording when OPENAI_API_KEY is unset",
    async () => {
      const jar = await signInFixture("fixture@conformance.test");
      const res = await jar.fetch(`${BACKEND_URL}/api/openai-realtime-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ streams: 1 }),
      });
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(401);
      const json = await res.json();
      const env = ErrorEnvelope.parse(json);
      expect(env.error).toBe(
        "OpenAI Realtime not configured (set OPENAI_API_KEY in .env)",
      );
    },
  );

  it("Test 5: returns 401 with the global ErrorEnvelope when no bearer/cookie is supplied", async () => {
    const res = await fetch(`${BACKEND_URL}/api/openai-realtime-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streams: 1 }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(() => ErrorEnvelope.parse(json)).not.toThrow();
  });
});
