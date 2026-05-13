// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 2 — rate-limit integration test for
// /api/check-user (10/min/IP).
//
// Asserts:
//   1. First 10 sequential POSTs from the same simulated IP succeed (200).
//   2. The 11th call is 429.
//   3. The 429 body is EXACTLY `{error:"Too many requests"}` — strict
//      one-key shape (CONTRACT-01 / D-13). No statusCode, no code, no
//      message.
//   4. trustProxy bucketing: requests with different X-Forwarded-For
//      land in different buckets (Pitfall #2).
//
// We use the Plan 03 check-user route's config.rateLimit ({max:10,
// timeWindow:"1 minute"}) by registering a minimal test handler under
// the same URL with the same config. This keeps the test focused on
// the rate-limit behavior — Plan 03 already covers the route's
// validation/SQL surface.
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rateLimitPlugin } from "../plugins/rate-limit.js";
import { registerErrorHandler } from "../error-handler.js";

interface TestApp {
  app: ReturnType<typeof Fastify>;
}

async function buildTestApp(): Promise<TestApp> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  app.route({
    method: "POST",
    url: "/api/check-user",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ exists: false }),
  });
  await app.ready();
  return { app };
}

describe("rate-limit /api/check-user (10/min/IP)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it("permits 10 sequential calls and 429s the 11th from the same IP", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/check-user",
        payload: { email: "u@test.local" },
        // Simulate a single client IP behind Traefik via X-Forwarded-For.
        // Fastify trustProxy:true honors this for req.ip.
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      expect(res.statusCode).toBe(200);
    }
    const eleventh = await app.inject({
      method: "POST",
      url: "/api/check-user",
      payload: { email: "u@test.local" },
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(eleventh.statusCode).toBe(429);
  });

  it("429 body is EXACTLY {error:'Too many requests'} — single key", async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: "POST",
        url: "/api/check-user",
        payload: { email: "u@test.local" },
        headers: { "x-forwarded-for": "10.0.0.2" },
      });
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/check-user",
      payload: { email: "u@test.local" },
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json();
    expect(body).toEqual({ error: "Too many requests" });
    // Strict single-key assertion: no statusCode, no code, no message.
    expect(Object.keys(body).length).toBe(1);
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("trustProxy bucketing: different X-Forwarded-For lands in different buckets", async () => {
    // Burn through the budget for IP A.
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: "POST",
        url: "/api/check-user",
        payload: { email: "u@test.local" },
        headers: { "x-forwarded-for": "1.1.1.1" },
      });
    }
    // Now IP A is at the limit.
    const aBlocked = await app.inject({
      method: "POST",
      url: "/api/check-user",
      payload: { email: "u@test.local" },
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    expect(aBlocked.statusCode).toBe(429);

    // IP B should be in a fresh bucket.
    const bFresh = await app.inject({
      method: "POST",
      url: "/api/check-user",
      payload: { email: "u@test.local" },
      headers: { "x-forwarded-for": "2.2.2.2" },
    });
    expect(bFresh.statusCode).toBe(200);
  });
});
