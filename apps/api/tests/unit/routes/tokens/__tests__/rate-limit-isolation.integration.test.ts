// SPDX-License-Identifier: Apache-2.0
/**
 * Phase 04 / Plan 08 / Task 3 — Per-user rate-limit isolation integration
 * test (T-04-04 mitigation evidence).
 *
 * Source-of-record: 04-CONTEXT.md D-19 + 04-RESEARCH.md §2.6 lines 576-599.
 *
 * Stands up a real Valkey 8 container via testcontainers (CLAUDE.md
 * "Real services in tests" — no MockAgent on rate-limit calls), wires
 * the actual Phase-2 `@fastify/rate-limit` plugin against the container
 * via VALKEY_URL, and registers the three production token routes
 * (assemblyai / deepgram / openai-realtime) with a synthetic dual-auth
 * preHandler that mimics dualAuthHook's contract (sets req.user.id
 * from a known bearer; throws AuthError otherwise).
 *
 * Each provider call is intercepted by undici MockAgent so we exercise
 * the real route + real rate-limit + real Valkey + real keyGenerator
 * code path WITHOUT depending on third-party SaaS availability — the
 * load-bearing assertion is the bucket-isolation contract, not the
 * upstream provider.
 *
 * Six tests pin:
 *   T1: u1 burns 30/min on /api/streaming-token; 31st returns 429.
 *   T2: independent buckets — u1 at 30 AND u2 at 30 simultaneously
 *       both succeed (T-04-04 evidence — keyGenerator on req.user.id,
 *       not req.ip).
 *   T3: unauthenticated requests 401 BEFORE the rate-limit hook fires;
 *       the bucket count is unchanged (verified by inspecting the
 *       Valkey store directly via a separate ioredis client — same
 *       container, same nameSpace).
 *   T4: independent buckets per ROUTE — u1 at 30/min on AssemblyAI AND
 *       30/min on Deepgram both succeed (per-route config.rateLimit
 *       allocates separate buckets).
 *   T5: same as T1 for /api/openai-realtime-token.
 *   T6: bucket TTL — registers the rate-limit plugin with a 2-second
 *       timeWindow override; exhausts the bucket; awaits real wall-clock
 *       2.5s; issues another 30 requests, all of which return 200/503
 *       (NOT 429). Real wall-clock — fake timers do NOT advance the
 *       Valkey/Redis server clock.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../../src/error-handler.js";
import { AuthError } from "../../../../../src/errors.js";
import { rateLimitPlugin } from "../../../../../src/plugins/rate-limit.js";
import { buildAssemblyAITokenRoutes } from "../../../../../src/routes/tokens/assemblyai.js";
import { buildDeepgramTokenRoutes } from "../../../../../src/routes/tokens/deepgram.js";
import { buildOpenAIRealtimeTokenRoutes } from "../../../../../src/routes/tokens/openai-realtime.js";

const VALKEY_IMAGE = "valkey/valkey:8-alpine";

let container: StartedTestContainer | null = null;
let valkeyUrl = "";
let agent: MockAgent;
let inspector: Redis;

interface TestAppOpts {
  bearerMap?: Record<string, string>;
  /**
   * Optional override for the global rate-limit plugin's timeWindow.
   * Per-route configs (30/1m) shadow this in production; T6 needs a
   * fast wall-clock to assert TTL behavior so we register the plugin
   * with a 2-second window AND override the per-route configs via the
   * route factories below — but the route factories don't accept
   * overrides today, so we register a custom route with the override
   * inside T6 instead. See T6 body for details.
   */
  globalTimeWindow?: string | number;
}

async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, {
    timeWindow: opts.globalTimeWindow ?? "1 minute",
  });
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) throw new AuthError("unauthorized");
    const userId = opts.bearerMap?.[value];
    if (!userId) throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: userId,
      email: `${userId}@test.local`,
    };
  });
  await app.register(buildAssemblyAITokenRoutes());
  await app.register(buildDeepgramTokenRoutes());
  await app.register(buildOpenAIRealtimeTokenRoutes());
  await app.ready();
  return app;
}

/**
 * Saturate a route to its 30/min bucket — issue exactly 30 requests for
 * the given bearer, asserting each one returns 200 or 503 (both consume
 * the bucket; we tolerate either since the unit-level success/error
 * paths are exercised in the per-route .test.ts files).
 */
async function burn30(app: FastifyInstance, url: string, bearer: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const r = await app.inject({
      method: "POST",
      url,
      headers: { authorization: bearer },
      payload: {},
    });
    expect([200, 503]).toContain(r.statusCode);
  }
}

beforeAll(async () => {
  container = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(60_000)
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(6379);
  valkeyUrl = `redis://${host}:${port}`;
  process.env.VALKEY_URL = valkeyUrl;
  inspector = new Redis(valkeyUrl, { maxRetriesPerRequest: null, lazyConnect: false });
}, 120_000);

afterAll(async () => {
  delete process.env.VALKEY_URL;
  if (inspector) await inspector.quit();
  if (container) await container.stop();
});

beforeEach(async () => {
  agent = new MockAgent({ connections: 100 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  process.env.ASSEMBLYAI_API_KEY = "test-key";
  process.env.DEEPGRAM_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-key";
  // Pre-load enough upstream interceptors that no test exhausts them.
  // Each call may consume 1 (assemblyai/deepgram) or 2 (openai-realtime
  // streams=2) intercepts; we register many to be safe.
  for (let i = 0; i < 200; i++) {
    agent
      .get("https://streaming.assemblyai.com")
      .intercept({ path: /^\/v3\/token/, method: "GET" })
      .reply(200, { token: `aai-${i}` });
    agent
      .get("https://api.deepgram.com")
      .intercept({ path: "/v1/auth/grant", method: "POST" })
      .reply(200, { access_token: `dg-${i}` });
    agent
      .get("https://api.openai.com")
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, { value: `ek_${i}` });
  }
  // Flush every Valkey key under the rate-limit plugin's "owrl:"
  // namespace so each test starts with empty buckets.
  const keys = await inspector.keys("owrl:*");
  if (keys.length > 0) await inspector.del(...keys);
});

afterEach(async () => {
  await agent.close();
  delete process.env.ASSEMBLYAI_API_KEY;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe("rate-limit-isolation — real Valkey 8 testcontainer + real plugin (T-04-04)", () => {
  it("T1: u1 burns 30/min on /api/streaming-token; 31st returns 429", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      await burn30(app, "/api/streaming-token", "Bearer ok-u1");
      const blocked = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: "Too many requests" });
    } finally {
      await app.close();
    }
  });

  it("T2: per-userId bucket isolation — u1 at 30 AND u2 at 30 both succeed (T-04-04)", async () => {
    const app = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1", "Bearer ok-u2": "u2" },
    });
    try {
      await burn30(app, "/api/streaming-token", "Bearer ok-u1");
      // u2's first call MUST succeed — its bucket is independent.
      const u2First = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u2" },
      });
      expect([200, 503]).toContain(u2First.statusCode);
      // u2 burns its own 29-remainder.
      for (let i = 0; i < 29; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/api/streaming-token",
          headers: { authorization: "Bearer ok-u2" },
        });
        expect([200, 503]).toContain(r.statusCode);
      }
      // u2's 31st → 429 (independent bucket but same 30/min limit).
      const u2Blocked = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u2" },
      });
      expect(u2Blocked.statusCode).toBe(429);
      // u1 is also still 429 (bucket NOT shared with u2 in either direction).
      const u1Blocked = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(u1Blocked.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("T3: unauthenticated requests 401 BEFORE the rate-limit hook fires; bucket count unchanged", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      // Snapshot the Valkey keyspace before the unauthenticated burst.
      const keysBefore = await inspector.keys("owrl:*");
      const valuesBefore = keysBefore.length > 0 ? await inspector.mget(keysBefore) : [];
      // 35 unauthenticated requests — if the bucket were consumed
      // pre-auth, the 31st onward would 429 instead of 401.
      for (let i = 0; i < 35; i++) {
        const r = await app.inject({ method: "POST", url: "/api/streaming-token" });
        expect(r.statusCode).toBe(401);
      }
      // Snapshot after — keyspace under owrl: must be UNCHANGED.
      const keysAfter = await inspector.keys("owrl:*");
      const valuesAfter = keysAfter.length > 0 ? await inspector.mget(keysAfter) : [];
      // Same set of keys, same values — proves the rate-limit hook
      // was never reached for the 35 unauthenticated requests.
      expect(keysAfter.sort()).toEqual(keysBefore.sort());
      expect(valuesAfter).toEqual(valuesBefore);
      // Final positive control: an authenticated call STILL succeeds
      // (bucket fresh — 35 401s did not consume it).
      const ok = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect([200, 503]).toContain(ok.statusCode);
    } finally {
      await app.close();
    }
  });

  it("T4: independent buckets per route — u1 at 30 on assemblyai AND 30 on deepgram both succeed", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      await burn30(app, "/api/streaming-token", "Bearer ok-u1");
      // Deepgram bucket for u1 is INDEPENDENT — the per-route config
      // allocates a separate bucket per (route, key) tuple.
      await burn30(app, "/api/deepgram-streaming-token", "Bearer ok-u1");
      // Both routes are now exhausted.
      const aaiBlocked = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(aaiBlocked.statusCode).toBe(429);
      const dgBlocked = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(dgBlocked.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("T5: u1 burns 30/min on /api/openai-realtime-token; 31st returns 429", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      // openai-realtime defaults to streams=1 when body.streams is absent.
      // burn30() sends payload:{} so the route mints exactly 1 client_secret
      // per call, consuming 1 upstream intercept apiece.
      await burn30(app, "/api/openai-realtime-token", "Bearer ok-u1");
      const blocked = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1" },
        payload: {},
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: "Too many requests" });
    } finally {
      await app.close();
    }
  });

  it("T6: bucket TTL — register a 2s-timeWindow route, exhaust it, wait 2.5s real wall-clock, fresh 30 succeed (no fake timers)", async () => {
    // Per-route config can be set inline on a custom route — the
    // production token-route factories hardcode '1 minute' but the
    // semantics under test (TTL release) are a property of the
    // RedisStore + Valkey, not of the specific route. We register a
    // dedicated /test-ttl route with a 2-second per-route window.
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(rateLimitPlugin, {});
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      if (auth !== "Bearer ok-u1") throw new AuthError("unauthorized");
      (req as unknown as { user: { id: string } }).user = { id: "u1" };
    });
    app.route({
      method: "POST",
      url: "/test-ttl",
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "2 seconds",
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
      handler: async (_req, reply) => reply.send({ ok: true }),
    });
    await app.ready();
    try {
      // Exhaust the 30-bucket.
      for (let i = 0; i < 30; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/test-ttl",
          headers: { authorization: "Bearer ok-u1" },
        });
        expect(r.statusCode).toBe(200);
      }
      // 31st → 429 (bucket exhausted).
      const blocked = await app.inject({
        method: "POST",
        url: "/test-ttl",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(blocked.statusCode).toBe(429);
      // Real wall-clock wait — fake timers do NOT advance Valkey's
      // server-side clock, so the only honest way to assert TTL
      // semantics is to actually sleep the test process.
      await new Promise<void>((r) => setTimeout(r, 2500));
      // Fresh 30 must all succeed.
      for (let i = 0; i < 30; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/test-ttl",
          headers: { authorization: "Bearer ok-u1" },
        });
        expect(r.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  }, 20_000);
});
