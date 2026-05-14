// SPDX-License-Identifier: Apache-2.0
// Phase 2 / Plan 04 / Task 2 — /api/health is rate-limit-exempt.
//
// `config.rateLimit = false` opts the route out of the global limiter.
// Asserts: 100 rapid GETs (well above the global 60/min default) all
// return 200, zero 429.
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../error-handler.js";
import { rateLimitPlugin } from "../plugins/rate-limit.js";
import { zodTypeProvider } from "../plugins/zod-type-provider.js";
import { registerProbes } from "../routes/probes.js";

async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  // Lower the global default for this test so we'd see 429s within 100
  // calls if the exemption were broken — defensive against accidental
  // regression where rateLimit:false stops being honored.
  await app.register(rateLimitPlugin, {
    redis: undefined,
    max: 5,
    timeWindow: "1 minute",
  });
  // Phase 6 / Plan 06-04 (D-P1): `/api/health` is owned by registerProbes
  // (the prior `routes/health.ts` plugin was dead code; deleted in
  // Plan 13-01 / Task 13-01-05). This test still asserts the SAME
  // contract: `config.rateLimit:false` on /api/health is honored.
  await registerProbes(app);
  await app.ready();
  return app;
}

describe("rate-limit /api/health is exempt (config.rateLimit=false)", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => {
    app = await buildTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("100 rapid GETs all 200, zero 429", async () => {
    let twoHundreds = 0;
    let fourTwentyNines = 0;
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { "x-forwarded-for": "10.0.0.42" },
      });
      if (r.statusCode === 200) twoHundreds++;
      if (r.statusCode === 429) fourTwentyNines++;
    }
    expect(twoHundreds).toBe(100);
    expect(fourTwentyNines).toBe(0);
  });
});
