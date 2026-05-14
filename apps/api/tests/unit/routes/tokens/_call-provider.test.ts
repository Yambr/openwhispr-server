// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 03 / Task 1 — _call-provider.ts shared helper tests.
//
// Strategy: undici MockAgent intercepts a synthetic provider host
// (https://provider.test) so we exercise the real undici call surface.
// CLAUDE.md: only process/network boundary mocking (MockAgent) is
// allowed — no internal logic is mocked.
//
// Coverage matrix (8 tests, one per acceptance criterion in 04-03-PLAN.md):
//   1. 200 path → ok:true with parsed JSON
//   2. 401   → ok:false 503 "<Label> not configured (set <ENV> in .env)"
//   3. 403   → same not-configured envelope
//   4. 429   → ok:false 503 "<Label> token mint upstream error"
//   5. 500   → same upstream-error envelope
//   6. body-read timeout (>5s)        → ok:false 503 "<Label> token mint timed out"
//   7. malformed JSON body            → ok:false 503 "<Label> token mint malformed response"
//   8. connect failure (no responder) → ok:false 503 "<Label> token mint timed out"
//
// Strict-substring assertions are used per acceptance criteria so the
// public envelope wording cannot drift unnoticed.

import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callProvider } from "../../../../src/routes/tokens/_call-provider.js";

const PROVIDER_HOST = "https://provider.test";

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent({ connections: 1 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("callProvider — _call-provider.ts shared helper", () => {
  it("returns ok:true with parsed JSON on a 200 response", async () => {
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(200, { token: "abc-123" }, { headers: { "content-type": "application/json" } });

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "key-xyz" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toEqual({ token: "abc-123" });
    }
  });

  it("maps upstream 401 to 503 not-configured envelope including ENV var name", async () => {
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(401, { error: "unauthorized" });

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "bad" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test not configured (set TEST_API_KEY in .env)");
    }
  });

  it("maps upstream 403 to the same not-configured envelope", async () => {
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(403, { error: "forbidden" });

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "bad" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test not configured (set TEST_API_KEY in .env)");
    }
  });

  it("maps upstream 429 to 503 upstream-error envelope", async () => {
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(429, { error: "rate limited" });

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "ok" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test token mint upstream error");
    }
  });

  it("maps upstream 500 to 503 upstream-error envelope", async () => {
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(500, { error: "boom" });

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "ok" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test token mint upstream error");
    }
  });

  it("aborts and maps to 503 timed-out envelope when upstream exceeds 5s total budget", async () => {
    // MockAgent's `delay` defers the response by N milliseconds. With the
    // helper's AbortController firing at 5000ms we expect the fetch to
    // abort and the catch branch to map to "timed out".
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(200, { token: "ignored" })
      .delay(6000);

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "ok" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test token mint timed out");
    }
  }, 10_000);

  it("maps 200-with-malformed-JSON to 503 malformed-response envelope", async () => {
    agent
      .get(PROVIDER_HOST)
      .intercept({ path: "/mint", method: "GET" })
      .reply(200, "not json at all", { headers: { "content-type": "text/plain" } });

    const result = await callProvider({
      url: `${PROVIDER_HOST}/mint`,
      method: "GET",
      headers: { authorization: "ok" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test token mint malformed response");
    }
  });

  it("maps connect-failure (no responder, net-disconnected) to 503 timed-out envelope", async () => {
    // No intercept registered AND disableNetConnect() is on, so the
    // dispatcher throws synchronously inside fetch — the catch branch
    // surfaces as the timed-out envelope.
    const result = await callProvider({
      url: `${PROVIDER_HOST}/never-registered`,
      method: "GET",
      headers: { authorization: "ok" },
      envVarName: "TEST_API_KEY",
      providerLabel: "Test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.message).toBe("Test token mint timed out");
    }
  });
});
