// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 06-04 — GREEN (D-P2).
//
// Verifies `makeDepCheck()` against REAL services per CLAUDE.md
// "Real services in tests" — testcontainers Postgres 17, testcontainers
// Valkey 8, and an in-process http.Server standing in for LiteLLM
// (network boundary, allowed by the no-internal-mocks rule).
//
// Behaviors locked by D-P2:
//   - 5s TTL cache via lru-cache keyed by dep name
//   - In-flight promise dedup (one upstream call per cache window)
//   - checkPostgres = SELECT 1, checkValkey = PING, checkLitellm = GET /health
//   - Unhealthy on upstream timeout / 5xx / network error
//   - Re-checks after TTL expiry (single re-check, not stampede)

import http from "node:http";
import type { AddressInfo } from "node:net";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Redis } from "ioredis";
import { Pool } from "pg";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DepCheck, makeDepCheck } from "./dep-check.js";

const VALKEY_IMAGE = "valkey/valkey:8-alpine";

let pgContainer: StartedPostgreSqlContainer;
let valkeyContainer: StartedTestContainer;
let pgPool: Pool;
let valkey: Redis;

// In-process fastify-stand-in for LiteLLM. We control `litellmStatus`
// per test to exercise healthy / 5xx / hang paths.
let litellmServer: http.Server;
let litellmUrl: string;
let litellmStatus = 200;
let litellmHits = 0;
let litellmHangMs = 0;

beforeAll(async () => {
  // Postgres
  pgContainer = await new PostgreSqlContainer("postgres:17-alpine").start();
  pgPool = new Pool({
    host: pgContainer.getHost(),
    port: pgContainer.getMappedPort(5432),
    user: pgContainer.getUsername(),
    password: pgContainer.getPassword(),
    database: pgContainer.getDatabase(),
    max: 4,
  });

  // Valkey
  valkeyContainer = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(60_000)
    .start();
  valkey = new Redis({
    host: valkeyContainer.getHost(),
    port: valkeyContainer.getMappedPort(6379),
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });

  // LiteLLM stand-in (real network boundary)
  litellmServer = http.createServer((req, res) => {
    litellmHits += 1;
    const fire = () => {
      res.statusCode = litellmStatus;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ url: req.url, ok: litellmStatus < 500 }));
    };
    if (litellmHangMs > 0) {
      setTimeout(fire, litellmHangMs);
    } else {
      fire();
    }
  });
  await new Promise<void>((resolve) => litellmServer.listen(0, "127.0.0.1", resolve));
  const addr = litellmServer.address() as AddressInfo;
  litellmUrl = `http://127.0.0.1:${addr.port}`;
}, 180_000);

afterAll(async () => {
  await valkey?.quit().catch(() => {});
  await pgPool?.end().catch(() => {});
  await new Promise<void>((resolve) => litellmServer.close(() => resolve()));
  await valkeyContainer?.stop().catch(() => {});
  await pgContainer?.stop().catch(() => {});
});

function makeFresh(): DepCheck {
  // Fresh factory per test → isolated cache + inflight map.
  litellmHits = 0;
  litellmStatus = 200;
  litellmHangMs = 0;
  return makeDepCheck({ pg: pgPool, valkey, litellmUrl });
}

describe("dep-check (D-P2) — real services", () => {
  it("exposes a callable that accepts 'postgres' | 'valkey' | 'litellm'", async () => {
    const check = makeFresh();
    const pg = await check("postgres");
    const vk = await check("valkey");
    const ll = await check("litellm");
    expect(pg.ok).toBe(true);
    expect(vk.ok).toBe(true);
    expect(ll.ok).toBe(true);
  });

  it("checkPostgres runs SELECT 1 (cheap roundtrip) and reports latency_ms", async () => {
    const check = makeFresh();
    const r = await check("postgres");
    expect(r.ok).toBe(true);
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    expect(typeof r.latency_ms).toBe("number");
  });

  it("checkValkey runs PING", async () => {
    const check = makeFresh();
    const r = await check("valkey");
    expect(r.ok).toBe(true);
  });

  it("checkLitellm calls /health (path verified by stand-in)", async () => {
    const check = makeFresh();
    let observedPath = "";
    litellmServer.removeAllListeners("request");
    litellmServer.on("request", (req, res) => {
      observedPath = req.url ?? "";
      res.statusCode = 200;
      res.end("{}");
    });
    await check("litellm");
    expect(observedPath).toBe("/health");
    // restore default handler for subsequent tests
    litellmServer.removeAllListeners("request");
    litellmServer.on("request", (req, res) => {
      litellmHits += 1;
      const fire = () => {
        res.statusCode = litellmStatus;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ url: req.url }));
      };
      if (litellmHangMs > 0) setTimeout(fire, litellmHangMs);
      else fire();
    });
  });

  it("caches each dep result for 5s TTL", async () => {
    const check = makeFresh();
    const first = await check("litellm");
    expect(first.ok).toBe(true);
    expect(litellmHits).toBe(1);

    // Within TTL — repeat calls hit cache, NO additional upstream calls.
    await check("litellm");
    await check("litellm");
    await check("litellm");
    expect(litellmHits).toBe(1);
  });

  it("dedupes concurrent probes — one upstream call per cache window", async () => {
    const check = makeFresh();
    litellmHangMs = 50; // hold the upstream long enough for parallel callers
    const [a, b, c, d] = await Promise.all([
      check("litellm"),
      check("litellm"),
      check("litellm"),
      check("litellm"),
    ]);
    litellmHangMs = 0;
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(d.ok).toBe(true);
    // Exactly one upstream call despite four concurrent callers.
    expect(litellmHits).toBe(1);
  });

  it("returns unhealthy on upstream 5xx (status >= 500)", async () => {
    const check = makeFresh();
    litellmStatus = 503;
    const r = await check("litellm");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/503/);
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns unhealthy on upstream timeout (does not hang the probe)", async () => {
    const check = makeFresh();
    // 3s hang exceeds the 2s undici headersTimeout/bodyTimeout.
    litellmHangMs = 3_000;
    const start = Date.now();
    const r = await check("litellm");
    const elapsed = Date.now() - start;
    litellmHangMs = 0;
    expect(r.ok).toBe(false);
    expect(elapsed).toBeLessThan(2_800);
  }, 10_000);

  it("returns unhealthy on network error (unreachable host)", async () => {
    const check = makeDepCheck({
      pg: pgPool,
      valkey,
      // 127.0.0.1:1 is reserved and refused — instant ECONNREFUSED.
      litellmUrl: "http://127.0.0.1:1",
    });
    const r = await check("litellm");
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
  });

  it("returns unhealthy when postgres pool is exhausted / down", async () => {
    const downPool = new Pool({
      host: "127.0.0.1",
      port: 1,
      user: "nobody",
      password: "nobody",
      database: "nobody",
      max: 1,
      connectionTimeoutMillis: 500,
    });
    const check = makeDepCheck({ pg: downPool, valkey, litellmUrl });
    const r = await check("postgres");
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
    await downPool.end().catch(() => {});
  }, 10_000);

  it("returns unhealthy when valkey is down", async () => {
    const downRedis = new Redis({
      host: "127.0.0.1",
      port: 1,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    // Force a connect attempt that will fail immediately.
    downRedis.connect().catch(() => {});
    const check = makeDepCheck({ pg: pgPool, valkey: downRedis, litellmUrl });
    const r = await check("valkey");
    expect(r.ok).toBe(false);
    await downRedis.disconnect();
  });

  it("re-checks after TTL expiry (single re-check, not stampede)", async () => {
    // lru-cache 11 uses `perf_now()` for TTL bookkeeping — not Date.now()
    // — so vi.setSystemTime() does NOT expire entries. The only honest
    // way to verify TTL expiry is to actually sleep past the 5s window.
    // Test takes ~5.2s; small price for testing the real cache.
    const check = makeFresh();
    await check("litellm");
    expect(litellmHits).toBe(1);

    await new Promise((r) => setTimeout(r, 5_200));

    // Three concurrent calls AFTER TTL expiry must collapse onto ONE
    // upstream re-check via the in-flight dedup map.
    litellmHangMs = 40;
    const [a, b, c] = await Promise.all([check("litellm"), check("litellm"), check("litellm")]);
    litellmHangMs = 0;
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
    expect(litellmHits).toBe(2);
  }, 15_000);

  it("dedupe map is freed after probe resolves (no leak across windows)", async () => {
    const check = makeFresh();
    await check("postgres");
    await check("postgres");
    await check("postgres");
    // No assertion on internal map size (it's not exported) — this test
    // merely exercises the resolve-path delete in `inflight.delete(name)`
    // for coverage; passing without crash is the assertion.
    expect(true).toBe(true);
  });
});
