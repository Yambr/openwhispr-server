// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 2 — rate-limit integration test for
// /api/auth/verification-status (30/min keyed on (ip, email)).
//
// Asserts:
//   1. First 30 GETs with the same email succeed (200).
//   2. The 31st is 429 with envelope-conformant body.
//   3. Changing the email moves to a fresh bucket (separate keyGenerator
//      output per email).
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { rateLimitPlugin } from "../../../src/plugins/rate-limit.js";

async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  app.route({
    method: "GET",
    url: "/api/auth/verification-status",
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
        keyGenerator: (req) => {
          const email = (req.query as { email?: string }).email ?? "_";
          return `${req.ip}:${email}`;
        },
      },
    },
    handler: async () => ({ verified: false }),
  });
  await app.ready();
  return app;
}

describe("rate-limit /api/auth/verification-status (30/min/(ip,email))", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    app = await buildTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("permits 30 calls then 429s the 31st with envelope body", async () => {
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/auth/verification-status?email=a@test.local",
        headers: { "x-forwarded-for": "10.0.0.10" },
      });
      expect(r.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=a@test.local",
      headers: { "x-forwarded-for": "10.0.0.10" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "Too many requests" });
    expect(Object.keys(blocked.json()).length).toBe(1);
  });

  it("different email = different bucket (keyGenerator includes email)", async () => {
    // Burn email A's budget from the same IP.
    for (let i = 0; i < 30; i++) {
      await app.inject({
        method: "GET",
        url: "/api/auth/verification-status?email=a@test.local",
        headers: { "x-forwarded-for": "10.0.0.20" },
      });
    }
    const aBlocked = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=a@test.local",
      headers: { "x-forwarded-for": "10.0.0.20" },
    });
    expect(aBlocked.statusCode).toBe(429);

    // Email B from same IP -> fresh bucket.
    const bFresh = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=b@test.local",
      headers: { "x-forwarded-for": "10.0.0.20" },
    });
    expect(bFresh.statusCode).toBe(200);
  });
});
