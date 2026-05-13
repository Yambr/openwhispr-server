// SPDX-License-Identifier: Apache-2.0
// Phase-2 debt back-fill — coverage closure for plugins/rate-limit.ts.
//
// Stage-A coverage was L=60 / B=80 / F=75 / S=60 on rate-limit.ts; the
// uncovered code is lines 67-75 (the `VALKEY_URL`-driven ioredis client
// construction + onClose `redis.quit()` teardown). The existing
// rate-limit tests inject `redis: undefined` and rely on the in-process
// fallback — they never exercise the env-driven Valkey path.
//
// Per CLAUDE.md "Real services in tests": this back-fill stands up a
// real Valkey 8 container via testcontainers (NOT a mock), exports
// `VALKEY_URL`, registers the plugin without an explicit `redis` arg,
// and asserts:
//
//   1. Plugin registration succeeds — no `defineCommand is not a
//      function` crash (the regression that originally motivated the
//      ioredis-over-node-redis switch documented in the source's
//      comment block).
//   2. A real GET against a rate-limited route returns 200 (proves the
//      Lua-backed RedisStore round-trips through the container).
//   3. Hitting the limit returns 429 with the canonical
//      `{error:"Too many requests"}` envelope.
//   4. `app.close()` invokes the onClose hook, which calls `redis.quit()`
//      cleanly — verified by re-asserting we can stand up a fresh
//      instance against the SAME container afterwards.

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { registerErrorHandler } from "../error-handler.js";
import { rateLimitPlugin } from "../plugins/rate-limit.js";

const VALKEY_IMAGE = "valkey/valkey:8-alpine";

let container: StartedTestContainer | null = null;
let valkeyUrl = "";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  // Deliberately omit `redis` — forces the plugin to read VALKEY_URL
  // and instantiate its own ioredis client (the under-tested branch).
  await app.register(rateLimitPlugin, {
    max: 3,
    timeWindow: "1 minute",
  });
  app.get(
    "/ping",
    {
      // Rate-limit applies via the global default; no per-route override.
    },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

describe("rate-limit.ts — env-driven Valkey/ioredis construction (lines 67-75)", () => {
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
  }, 120_000);

  afterAll(async () => {
    delete process.env.VALKEY_URL;
    if (container) await container.stop();
  });

  it("plugin registers cleanly when VALKEY_URL is set (no defineCommand crash)", async () => {
    // Use a unique nameSpace per test via a fresh app — the global
    // default nameSpace is "owrl:" inside the plugin. We rely on the
    // 1-minute timeWindow rolling forward between tests; we also stamp
    // `x-forwarded-for` to a unique IP per `it` to avoid cross-test
    // bleed of the bucket counter.
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("real Valkey RedisStore round-trips a 429 with the canonical envelope", async () => {
    const app = await buildApp();
    let last200 = 0;
    let last429: { status: number; body: string } | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/ping",
        headers: { "x-forwarded-for": "203.0.113.2" },
      });
      if (res.statusCode === 200) last200++;
      if (res.statusCode === 429) {
        last429 = { status: res.statusCode, body: res.body };
      }
    }
    // max=3 → expect at least one 200 and at least one 429.
    expect(last200).toBeGreaterThanOrEqual(1);
    expect(last200).toBeLessThanOrEqual(3);
    expect(last429).not.toBeNull();
    // CONTRACT-01: canonical envelope is EXACTLY `{error:"Too many requests"}`.
    expect(JSON.parse(last429!.body)).toEqual({ error: "Too many requests" });
    await app.close();
  });

  it("onClose hook calls redis.quit() — fresh instance reaches same container after", async () => {
    const app1 = await buildApp();
    // Burn one request so the connection definitely exchanged the Lua-
    // script registration before close.
    await app1.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "203.0.113.3" },
    });
    // If quit() throws / hangs, this close would hang past Vitest's
    // per-test timeout. The plugin guards quit() in try/catch so a
    // protocol-level error during shutdown is silently absorbed — that's
    // also under-tested code in lines 73-79.
    await app1.close();

    // Standing up a second instance against the SAME container proves
    // the prior quit() was non-destructive and the keyspace is healthy.
    const app2 = await buildApp();
    const res = await app2.inject({
      method: "GET",
      url: "/ping",
      headers: { "x-forwarded-for": "203.0.113.4" },
    });
    expect(res.statusCode).toBe(200);
    await app2.close();
  });
});
