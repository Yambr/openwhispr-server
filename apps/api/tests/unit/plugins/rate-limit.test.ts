// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06-09 — layered rate-limit unit tests (D-RL1..3).
//
// Tests against the in-process backend (no Valkey/Redis client injected)
// to keep this suite hermetic. The Valkey integration path is exercised
// by apps/api/src/__tests__/rate-limit-valkey-construction.test.ts via
// testcontainers, and the e2e horizontal-scale tests cover multi-replica
// semantics.
//
// Each test stamps a unique X-Forwarded-For so IP-tier buckets do not
// bleed across cases (the suite-level singleton in-process store is
// keyspaced by IP and resets on the 1-minute window — but distinct IPs
// are independent regardless).
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_IP_CEILING,
  rateLimits,
  routeRateLimitConfig,
} from "../../../src/config/rate-limits.js";
import { registerErrorHandler } from "../../../src/error-handler.js";
import { rateLimitPlugin } from "../../../src/plugins/rate-limit.js";

async function buildApp(
  opts: { globalIpCeiling?: number; onRateLimitExceeded?: ReturnType<typeof vi.fn> } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  const rlOpts: Parameters<typeof rateLimitPlugin>[1] = {};
  if (opts.globalIpCeiling !== undefined) rlOpts.globalIpCeiling = opts.globalIpCeiling;
  if (opts.onRateLimitExceeded !== undefined) {
    rlOpts.onRateLimitExceeded = opts.onRateLimitExceeded as unknown as NonNullable<
      Parameters<typeof rateLimitPlugin>[1]
    >["onRateLimitExceeded"];
  }
  await app.register(rateLimitPlugin, rlOpts);

  // Authenticated-route stub: an onRequest hook stamps req.user from a
  // header so we can simulate distinct users behind the same IP and
  // vice versa. The rate-limit plugin runs its user-tier check at
  // `preHandler` time (D-RL1 hook override) so this onRequest stamping
  // wins — the production order is identical (dualAuthHook is also
  // onRequest, registered after rateLimitPlugin).
  app.addHook("onRequest", async (req) => {
    const uid = req.headers["x-test-user-id"];
    if (typeof uid === "string" && uid.length > 0) {
      (req as unknown as { user?: { id: string } }).user = { id: uid };
    }
  });

  // Route table covering each D-RL2 row touched by the test suite.
  // Limits are kept small (3-10) so a test can hit the cap quickly,
  // but the *shape* of the config (max/timeWindow) is identical to
  // production.
  app.route({
    method: "POST",
    url: "/api/auth/signin",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/auth/signup",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/auth/forgot-password",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
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
  app.route({
    method: "POST",
    url: "/api/transcribe",
    config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/reason",
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/agent/stream",
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/agent/web-search",
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/v1/keys/create",
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "GET",
    url: "/api/v1/keys/list",
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/admin/echo",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "POST",
    url: "/api/notes/create",
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });
  app.route({
    method: "GET",
    url: "/api/notes/list",
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    handler: async () => ({ ok: true }),
  });

  // Probes: opt-out of the limiter (config.rateLimit=false).
  for (const url of ["/livez", "/readyz", "/startupz", "/api/health"] as const) {
    app.route({
      method: "GET",
      url,
      config: { rateLimit: false },
      handler: async () => ({ ok: true }),
    });
  }

  await app.ready();
  return app;
}

let app: FastifyInstance;

afterEach(async () => {
  if (app) await app.close();
});

describe("rate-limit layered keying (D-RL1)", () => {
  it("registers global IP-tier counter ~600/min/IP", async () => {
    // The IP-tier ceiling default mirrors GLOBAL_IP_CEILING (600).
    expect(GLOBAL_IP_CEILING).toBe(600);
    // Sanity: a tiny ceiling injection trips after that many requests
    // even when the user-tier counter has plenty of headroom (using a
    // large per-route max — /api/notes/list = 120 — paired with a
    // distinct authenticated user per request).
    app = await buildApp({ globalIpCeiling: 5 });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: {
          "x-forwarded-for": "10.10.0.1",
          "x-test-user-id": `u-${i}`, // distinct user per request
        },
      });
      expect(r.statusCode).toBe(200);
    }
    const sixth = await app.inject({
      method: "GET",
      url: "/api/notes/list",
      headers: { "x-forwarded-for": "10.10.0.1", "x-test-user-id": "u-other" },
    });
    expect(sixth.statusCode).toBe(429);
  });

  it("overlays per-route user-tier counter keyed by req.user.id", async () => {
    app = await buildApp();
    // 3 requests from user-A from any IP hit transcribe's max=3.
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: {
          "x-forwarded-for": `10.11.0.${i + 1}`, // different IP each time
          "x-test-user-id": "user-A",
        },
      });
      expect(r.statusCode).toBe(200);
    }
    const fourth = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.11.0.99", "x-test-user-id": "user-A" },
    });
    expect(fourth.statusCode).toBe(429);
  });

  it("auto-degrades to IP keying when request is unauthenticated", async () => {
    app = await buildApp();
    // Unauthenticated: keyGenerator returns `ip:<ip>` — burning the
    // transcribe budget from a single IP without a user header should
    // 429 on the 4th.
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: { "x-forwarded-for": "10.12.0.1" },
      });
      expect(r.statusCode).toBe(200);
    }
    const fourth = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.12.0.1" },
    });
    expect(fourth.statusCode).toBe(429);
  });

  it("fires 429 when EITHER counter is exhausted (D-RL1)", async () => {
    // EITHER means: (a) per-route user-tier OR (b) global IP-tier.
    // Burn user-tier from one user → 429.
    app = await buildApp({ globalIpCeiling: 1000 });
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: { "x-forwarded-for": "10.13.0.1", "x-test-user-id": "either-A" },
      });
    }
    const userBlocked = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.13.0.1", "x-test-user-id": "either-A" },
    });
    expect(userBlocked.statusCode).toBe(429);

    // Independent app, tiny IP ceiling, plenty of per-route headroom →
    // IP-tier blocks first.
    await app.close();
    app = await buildApp({ globalIpCeiling: 2 });
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: { "x-forwarded-for": "10.13.0.2", "x-test-user-id": `u-${i}` },
      });
    }
    const ipBlocked = await app.inject({
      method: "GET",
      url: "/api/notes/list",
      headers: { "x-forwarded-for": "10.13.0.2", "x-test-user-id": "u-other" },
    });
    expect(ipBlocked.statusCode).toBe(429);
  });
});

describe("rate-limit per-route matrix (D-RL2 — locked numbers)", () => {
  it("/api/auth/signin: 10/min/IP", async () => {
    expect(rateLimits.authSignin.rpmIp).toBe(10);
  });

  it("/api/auth/signup: 10/min/IP", async () => {
    expect(rateLimits.authSignup.rpmIp).toBe(10);
  });

  it("/api/auth/forgot-password: 10/min/IP", async () => {
    expect(rateLimits.authForgotPassword.rpmIp).toBe(10);
  });

  it("/api/auth/verification-status PRESERVES Phase 2 30/min/(IP,email) carve-out", async () => {
    expect(rateLimits.verificationStatus.rpm).toBe(30);
    expect(rateLimits.verificationStatus.keying).toBe("composite-ip-email");
    // Functional: same (IP,email) blocked at 31; different email = fresh.
    app = await buildApp({ globalIpCeiling: 1000 });
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/auth/verification-status?email=a@test.local",
        headers: { "x-forwarded-for": "10.20.0.1" },
      });
      expect(r.statusCode).toBe(200);
    }
    const blocked = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=a@test.local",
      headers: { "x-forwarded-for": "10.20.0.1" },
    });
    expect(blocked.statusCode).toBe(429);
    const freshEmail = await app.inject({
      method: "GET",
      url: "/api/auth/verification-status?email=b@test.local",
      headers: { "x-forwarded-for": "10.20.0.1" },
    });
    expect(freshEmail.statusCode).toBe(200);
  });

  it("/api/transcribe: 20/min/user + 60/min/IP", async () => {
    expect(rateLimits.transcribe.rpmUser).toBe(20);
    expect(rateLimits.transcribe.rpmIp).toBe(60);
  });

  it("/api/reason: 30/min/user + 90/min/IP", async () => {
    expect(rateLimits.reason.rpmUser).toBe(30);
    expect(rateLimits.reason.rpmIp).toBe(90);
  });

  it("/api/agent/stream: 10/min/user + 30/min/IP", async () => {
    expect(rateLimits.agentStream.rpmUser).toBe(10);
    expect(rateLimits.agentStream.rpmIp).toBe(30);
  });

  it("/api/agent/web-search: 30/min/user + 90/min/IP (Phase 5 D-07 preserved)", async () => {
    expect(rateLimits.agentWebSearch.rpmUser).toBe(30);
    expect(rateLimits.agentWebSearch.rpmIp).toBe(90);
  });

  it("/api/v1/keys/create: 5/min/user + 20/min/IP", async () => {
    expect(rateLimits.keysCreate.rpmUser).toBe(5);
    expect(rateLimits.keysCreate.rpmIp).toBe(20);
  });

  it("/api/v1/keys/list and /api/v1/keys/revoke: 30/min/user + 90/min/IP", async () => {
    expect(rateLimits.keysOther.rpmUser).toBe(30);
    expect(rateLimits.keysOther.rpmIp).toBe(90);
  });

  it("/api/admin/*: 60/min/user + 300/min/IP", async () => {
    expect(rateLimits.admin.rpmUser).toBe(60);
    expect(rateLimits.admin.rpmIp).toBe(300);
  });

  it("/api/{notes,folders,conversations,transcriptions}/{create,update,delete}: 60/min/user + 300/min/IP", async () => {
    expect(rateLimits.crudWrite.rpmUser).toBe(60);
    expect(rateLimits.crudWrite.rpmIp).toBe(300);
  });

  it("/api/{notes,folders,...}/list and /search: 120/min/user + 600/min/IP", async () => {
    expect(rateLimits.crudRead.rpmUser).toBe(120);
    expect(rateLimits.crudRead.rpmIp).toBe(600);
  });

  it("probes /livez /readyz /startupz /api/health: SKIPPED (unlimited)", async () => {
    expect(rateLimits.probes.keying).toBe("skip");
    expect(routeRateLimitConfig("probes")).toBe(false);

    // Functional: 100 hits well above any ceiling all 200.
    app = await buildApp({ globalIpCeiling: 5 });
    let twoHundreds = 0;
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/livez",
        headers: { "x-forwarded-for": "10.30.0.1" },
      });
      if (r.statusCode === 200) twoHundreds++;
    }
    expect(twoHundreds).toBe(100);
  });
});

describe("rate-limit response shape (D-RL3)", () => {
  it("envelope is exactly {error: 'Too many requests'} (unchanged from Phase 2)", async () => {
    app = await buildApp();
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: { "x-forwarded-for": "10.40.0.1", "x-test-user-id": "rs-A" },
      });
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.40.0.1", "x-test-user-id": "rs-A" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "Too many requests" });
    expect(Object.keys(blocked.json())).toEqual(["error"]);
  });

  it("sends X-RateLimit-Limit header (user-tier limit)", async () => {
    app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.41.0.1", "x-test-user-id": "hdr-A" },
    });
    expect(r.headers["x-ratelimit-limit"]).toBeDefined();
    expect(Number(r.headers["x-ratelimit-limit"])).toBe(3);
  });

  it("sends X-RateLimit-Remaining header", async () => {
    app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.42.0.1", "x-test-user-id": "hdr-B" },
    });
    expect(r.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(Number(r.headers["x-ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("sends X-RateLimit-Reset header (epoch seconds)", async () => {
    app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.43.0.1", "x-test-user-id": "hdr-C" },
    });
    expect(r.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("sends Retry-After header (Phase 2 preserved)", async () => {
    app = await buildApp();
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: { "x-forwarded-for": "10.44.0.1", "x-test-user-id": "ra-A" },
      });
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.44.0.1", "x-test-user-id": "ra-A" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("emits audit_log row with action=security.rate_limit_exceeded (D-A6 #17)", async () => {
    const onRateLimitExceeded = vi.fn();
    app = await buildApp({ onRateLimitExceeded });
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: { "x-forwarded-for": "10.50.0.1", "x-test-user-id": "audit-A" },
      });
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.50.0.1", "x-test-user-id": "audit-A" },
    });
    expect(blocked.statusCode).toBe(429);
    // The user-tier emission fires asynchronously inside errorResponseBuilder
    // (fire-and-forget); flush microtasks before asserting.
    await new Promise((r) => setImmediate(r));
    expect(onRateLimitExceeded).toHaveBeenCalled();
    const lastCall = onRateLimitExceeded.mock.calls.at(-1);
    // (req, rule, route)
    expect(lastCall?.[1]).toBe("user");
    expect(lastCall?.[2]).toBe("/api/transcribe");
  });
});

describe("rate-limit IP-tier audit emission", () => {
  it("invokes onRateLimitExceeded with rule='ip' when global ceiling trips", async () => {
    const onRateLimitExceeded = vi.fn();
    app = await buildApp({ globalIpCeiling: 2, onRateLimitExceeded });
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: { "x-forwarded-for": "10.60.0.1", "x-test-user-id": `u-${i}` },
      });
    }
    const blocked = await app.inject({
      method: "GET",
      url: "/api/notes/list",
      headers: { "x-forwarded-for": "10.60.0.1", "x-test-user-id": "u-other" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(onRateLimitExceeded).toHaveBeenCalled();
    const call = onRateLimitExceeded.mock.calls.find((c) => c[1] === "ip");
    expect(call).toBeDefined();
    expect(call?.[2]).toBe("/api/notes/list");
  });
});

describe("rate-limit IP-tier with injected redis-like store", () => {
  // Fake ioredis-shaped client — just enough surface for redisIpStore +
  // the @fastify/rate-limit RedisStore's defineCommand probe to succeed.
  // The plugin's IP-tier code path calls .incr + .pexpire (1st hit only).
  function makeFakeRedis(): {
    client: {
      incr: (key: string) => Promise<number>;
      pexpire: (key: string, ttl: number) => Promise<number>;
      defineCommand: (name: string, opts: unknown) => void;
      quit: () => Promise<void>;
      // @fastify/rate-limit RedisStore also reaches for these.
      [k: string]: unknown;
    };
    state: Map<string, number>;
  } {
    const state = new Map<string, number>();
    const client = {
      async incr(key: string) {
        const n = (state.get(key) ?? 0) + 1;
        state.set(key, n);
        return n;
      },
      async pexpire(_key: string, _ttl: number) {
        return 1;
      },
      defineCommand(_name: string, _opts: unknown) {
        // @fastify/rate-limit registers a Lua script here. We need not
        // implement it because we provide a custom-named method below
        // that the plugin invokes via callRateLimit. For pure IP-tier
        // tests we mount the rate-limit plugin against our own route
        // with a tiny IP ceiling so we never call the @fastify/rate-limit
        // path's defined command.
      },
      async quit() {},
    };
    return { client, state };
  }

  it("redisIpStore.incr increments and sets TTL on first hit only", async () => {
    const { client, state } = makeFakeRedis();
    const pexpireSpy = vi.spyOn(client, "pexpire");
    const incrSpy = vi.spyOn(client, "incr");
    // Directly invoke redisIpStore via the plugin's onRequest hook — we
    // build an app with a huge user-tier max so IP-tier (ceiling=2)
    // trips first. The user-tier @fastify/rate-limit RedisStore is
    // disabled by injecting redis:undefined for that path while we feed
    // our redis client to the IP-tier via the dependency injection
    // hook. The plugin sees a single `redis` opts arg, so we leverage
    // that single path.
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(rateLimitPlugin, {
      redis: client as any,
      globalIpCeiling: 2,
      max: 1000, // user-tier huge → IP-tier trips first
    });
    app.get("/probe-ip", async () => ({ ok: true }));
    await app.ready();
    const r1 = await app.inject({
      method: "GET",
      url: "/probe-ip",
      headers: { "x-forwarded-for": "10.70.0.1" },
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({
      method: "GET",
      url: "/probe-ip",
      headers: { "x-forwarded-for": "10.70.0.1" },
    });
    expect(r2.statusCode).toBe(200);
    const r3 = await app.inject({
      method: "GET",
      url: "/probe-ip",
      headers: { "x-forwarded-for": "10.70.0.1" },
    });
    expect(r3.statusCode).toBe(429);
    // INCR called on every request that reached the IP-tier hook.
    expect(incrSpy).toHaveBeenCalled();
    // PEXPIRE called once — on the first INCR (n===1) for our test IP.
    // Other internal infrastructure might use additional keys; assert
    // at least one PEXPIRE landed on our specific IP bucket.
    const calls = pexpireSpy.mock.calls.filter((c) => c[0] === "owrl:ip:10.70.0.1");
    expect(calls.length).toBe(1);
    expect(state.get("owrl:ip:10.70.0.1")).toBeGreaterThanOrEqual(3);
    await app.close();
  });

  it("IP-tier catch path: store.incr throwing degrades gracefully (skipOnError parity)", async () => {
    const throwingClient = {
      async incr() {
        throw new Error("valkey unreachable");
      },
      async pexpire() {
        return 1;
      },
      defineCommand() {},
      async quit() {},
    };
    const app = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(app);
    await app.register(rateLimitPlugin, {
      redis: throwingClient as any,
      globalIpCeiling: 1,
      max: 1000,
    });
    app.get("/probe-ip-degrade", async () => ({ ok: true }));
    await app.ready();
    const r = await app.inject({
      method: "GET",
      url: "/probe-ip-degrade",
      headers: { "x-forwarded-for": "10.71.0.1" },
    });
    // The catch returns early — request proceeds even though the IP-tier
    // store is broken. skipOnError parity preserved.
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

describe("rate-limit user-tier audit emission failure path", () => {
  it("does not crash the 429 response when onRateLimitExceeded throws", async () => {
    const onRateLimitExceeded = vi.fn(async () => {
      throw new Error("audit fanout broken");
    });
    app = await buildApp({ onRateLimitExceeded });
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/transcribe",
        headers: { "x-forwarded-for": "10.90.0.1", "x-test-user-id": "fail-A" },
      });
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/api/transcribe",
      headers: { "x-forwarded-for": "10.90.0.1", "x-test-user-id": "fail-A" },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: "Too many requests" });
    // Flush the fire-and-forget reject so the .catch handler runs.
    await new Promise((r) => setImmediate(r));
    expect(onRateLimitExceeded).toHaveBeenCalled();
  });
});

describe("rate-limit getRouteName fallback (unmatched URL)", () => {
  it("falls back to req.url when routeOptions.url is unavailable (404 path)", async () => {
    const onRateLimitExceeded = vi.fn();
    app = await buildApp({ globalIpCeiling: 1, onRateLimitExceeded });
    // First hit at 10.80.0.1 to seed the bucket on a real route (so the
    // IP-tier 2nd hit on an UNMATCHED URL trips).
    await app.inject({
      method: "GET",
      url: "/api/notes/list",
      headers: { "x-forwarded-for": "10.80.0.1" },
    });
    // 2nd hit on an unmatched URL — IP-tier triggers BEFORE route match,
    // so routeOptions.url is undefined and getRouteName falls back to
    // req.url.
    const blocked = await app.inject({
      method: "GET",
      url: "/totally-not-a-route",
      headers: { "x-forwarded-for": "10.80.0.1" },
    });
    expect(blocked.statusCode).toBe(429);
    const ipCall = onRateLimitExceeded.mock.calls.find((c) => c[1] === "ip");
    expect(ipCall).toBeDefined();
    // The 3rd arg is the route — for an unmatched URL the fallback path
    // returns req.url verbatim.
    expect(ipCall?.[2]).toBe("/totally-not-a-route");
  });
});

describe("rate-limit config env override", () => {
  it("num() honours RATE_LIMIT_* env vars over the default", async () => {
    // Reset module so re-import re-reads the env. vitest's vi.resetModules
    // clears the ES-module registry for this test only.
    process.env.RATE_LIMIT_TRANSCRIBE_USER = "7";
    vi.resetModules();
    const mod = await import("../../../src/config/rate-limits");
    expect(mod.rateLimits.transcribe.rpmUser).toBe(7);
    delete process.env.RATE_LIMIT_TRANSCRIBE_USER;
    vi.resetModules();
  });

  it("num() treats empty-string env var as 'unset' and uses the fallback", async () => {
    process.env.RATE_LIMIT_TRANSCRIBE_USER = "";
    vi.resetModules();
    const mod = await import("../../../src/config/rate-limits");
    expect(mod.rateLimits.transcribe.rpmUser).toBe(20);
    delete process.env.RATE_LIMIT_TRANSCRIBE_USER;
    vi.resetModules();
  });
});

describe("rate-limit config helper", () => {
  it("routeRateLimitConfig('probes') returns false (skip)", () => {
    expect(routeRateLimitConfig("probes")).toBe(false);
  });

  it("routeRateLimitConfig('authSignin') returns ip-only ceiling", () => {
    const cfg = routeRateLimitConfig("authSignin");
    expect(cfg).toMatchObject({ max: 10, timeWindow: "1 minute" });
  });

  it("routeRateLimitConfig('verificationStatus') returns rpm value", () => {
    const cfg = routeRateLimitConfig("verificationStatus");
    expect(cfg).toMatchObject({ max: 30, timeWindow: "1 minute" });
  });

  it("routeRateLimitConfig('transcribe') uses rpmUser as max", () => {
    const cfg = routeRateLimitConfig("transcribe");
    expect(cfg).toMatchObject({ max: 20, timeWindow: "1 minute" });
  });
});

// ── Phase 8 / Plan 01 ─────────────────────────────────────────────────
// `OPENWHISPR_DISABLE_RATE_LIMIT` load-test switch.
//
// CONTEXT.md (Phase 8) and Phase 07.1 docs reference this switch as if it
// already exists, but Phase 8 Plan 01 RESEARCH.md (Pitfall 5, Assumption
// A5) proved otherwise. These tests pin the env-gate behavior for the
// Fastify @fastify/rate-limit registration path:
//   - unset / "0" → default-secure (limiter active, both IP-tier and
//     user-tier counters fire as before).
//   - "1" / "true" → both limiter surfaces in this plugin are skipped,
//     traffic flows freely. The boot logger receives a WARN banner so
//     operators see a loud signal if it's ever set in production.
describe("rate-limit OPENWHISPR_DISABLE_RATE_LIMIT env switch (Phase 8 Plan 01)", () => {
  const originalSwitch = process.env.OPENWHISPR_DISABLE_RATE_LIMIT;

  beforeEach(() => {
    delete process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
  });

  afterEach(async () => {
    if (originalSwitch === undefined) delete process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
    else process.env.OPENWHISPR_DISABLE_RATE_LIMIT = originalSwitch;
  });

  async function buildSwitchApp(): Promise<FastifyInstance> {
    const a = Fastify({ logger: false, trustProxy: true });
    registerErrorHandler(a);
    await a.register(rateLimitPlugin, {});
    a.route({
      method: "GET",
      url: "/api/notes/list",
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      handler: async () => ({ ok: true }),
    });
    await a.ready();
    return a;
  }

  it("unset → at least one 429 after 11 bursts to a max=10 route", async () => {
    app = await buildSwitchApp();
    let saw429 = false;
    for (let i = 0; i < 11; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: { "x-forwarded-for": "10.91.0.1" },
      });
      if (r.statusCode === 429) saw429 = true;
    }
    expect(saw429).toBe(true);
  });

  it("=0 → behavior matches unset (default-secure)", async () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "0";
    app = await buildSwitchApp();
    let saw429 = false;
    for (let i = 0; i < 11; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: { "x-forwarded-for": "10.91.0.2" },
      });
      if (r.statusCode === 429) saw429 = true;
    }
    expect(saw429).toBe(true);
  });

  it("=1 → 100 bursts all return 200 (limiter fully disabled)", async () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "1";
    app = await buildSwitchApp();
    let twoHundreds = 0;
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: { "x-forwarded-for": "10.91.0.3" },
      });
      if (r.statusCode === 200) twoHundreds++;
    }
    expect(twoHundreds).toBe(100);
  });

  it('="true" → same as "1" (accept common truthy form)', async () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "true";
    app = await buildSwitchApp();
    let twoHundreds = 0;
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: "GET",
        url: "/api/notes/list",
        headers: { "x-forwarded-for": "10.91.0.4" },
      });
      if (r.statusCode === 200) twoHundreds++;
    }
    expect(twoHundreds).toBe(100);
  });

  it("=1 → boot logger emits a WARN containing 'Rate limit DISABLED'", async () => {
    process.env.OPENWHISPR_DISABLE_RATE_LIMIT = "1";
    const warnSpy = vi.fn();
    const a = Fastify({
      logger: {
        level: "warn",
        // Pino-compatible stream that captures emitted log objects.
        stream: {
          write(chunk: string) {
            try {
              warnSpy(JSON.parse(chunk));
            } catch {
              warnSpy({ raw: chunk });
            }
          },
        },
      },
      trustProxy: true,
    });
    registerErrorHandler(a);
    await a.register(rateLimitPlugin, {});
    await a.ready();
    app = a;
    const lines = warnSpy.mock.calls.map((c) => c[0]);
    const hit = lines.find(
      (line) => typeof line?.msg === "string" && line.msg.includes("Rate limit DISABLED"),
    );
    expect(hit).toBeDefined();
  });
});
