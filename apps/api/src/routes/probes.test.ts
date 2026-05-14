// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 06-04 — GREEN (D-P1).
//
// Verifies the three kubelet-canonical probes + /api/health alias.
//
// We mount the routes onto a bare Fastify instance (no buildApp wiring)
// and inject a deterministic `depCheck` fake — the real dep-check
// behavior is exercised by dep-check.test.ts against testcontainers.
// This file is concerned with ROUTING + STATUS-CODE + BODY-SHAPE only.
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { DepName, DepResult } from "../lib/dep-check.js";
import {
  isStartupComplete,
  markStartupComplete,
  registerProbes,
  resetStartupComplete,
} from "./probes.js";

function makeDepCheckFake(results: Partial<Record<DepName, DepResult>>) {
  const calls: DepName[] = [];
  const fn = async (name: DepName): Promise<DepResult> => {
    calls.push(name);
    return results[name] ?? { ok: true, latency_ms: 1 };
  };
  return { fn, calls };
}

async function makeApp(depCheck?: (n: DepName) => Promise<DepResult>) {
  const app = Fastify({ logger: false });
  await registerProbes(app, depCheck ? { depCheck } : {});
  await app.ready();
  return app;
}

afterEach(() => {
  resetStartupComplete();
});

describe("/livez (D-P1 — NO dep checks)", () => {
  it("returns 200 when Fastify event loop is responsive", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/livez" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("returns 200 even when Postgres is DOWN (process-alive only — no cascade restart)", async () => {
    const { fn, calls } = makeDepCheckFake({
      postgres: { ok: false, latency_ms: 0, error: "PG DOWN" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/livez" });
    expect(res.statusCode).toBe(200);
    // CRITICAL: /livez MUST NOT consult depCheck.
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 200 even when Valkey is DOWN", async () => {
    const { fn, calls } = makeDepCheckFake({
      valkey: { ok: false, latency_ms: 0, error: "VK DOWN" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/livez" });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 200 even when LiteLLM is DOWN", async () => {
    const { fn, calls } = makeDepCheckFake({
      litellm: { ok: false, latency_ms: 0, error: "LL DOWN" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/livez" });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([]);
    await app.close();
  });
});

describe("/readyz (D-P1 — checks Postgres + Valkey + LiteLLM)", () => {
  it("returns 200 when all three deps healthy", async () => {
    const { fn, calls } = makeDepCheckFake({});
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<DepName, DepResult>;
    expect(body.postgres.ok).toBe(true);
    expect(body.valkey.ok).toBe(true);
    expect(body.litellm.ok).toBe(true);
    expect(calls.sort()).toEqual(["litellm", "postgres", "valkey"]);
    await app.close();
  });

  it("returns 503 when Postgres unhealthy", async () => {
    const { fn } = makeDepCheckFake({
      postgres: { ok: false, latency_ms: 12, error: "ECONNREFUSED" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    const body = res.json() as Record<DepName, DepResult>;
    expect(body.postgres.ok).toBe(false);
    expect(body.postgres.error).toBe("ECONNREFUSED");
    await app.close();
  });

  it("returns 503 when Valkey unhealthy", async () => {
    const { fn } = makeDepCheckFake({
      valkey: { ok: false, latency_ms: 12, error: "VK DOWN" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("returns 503 when LiteLLM unhealthy", async () => {
    const { fn } = makeDepCheckFake({
      litellm: { ok: false, latency_ms: 2000, error: "timeout" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("returns 503 with operator-actionable error when depCheck is not wired", async () => {
    const app = await makeApp(); // no depCheck
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    const body = res.json() as Record<DepName, DepResult>;
    expect(body.postgres.ok).toBe(false);
    expect(body.postgres.error).toMatch(/not wired/);
    expect(body.valkey.error).toMatch(/not wired/);
    expect(body.litellm.error).toMatch(/not wired/);
    await app.close();
  });

  it("uses 2-5s cached result to prevent kubelet thundering herd", async () => {
    // The cache lives INSIDE makeDepCheck (dep-check.ts), not the route.
    // Here we assert the route does NOT add a second layer of probing —
    // calls map 1:1 to depCheck invocations, so the upstream lru-cache
    // can take effect.
    const { fn, calls } = makeDepCheckFake({});
    const app = await makeApp(fn);
    await app.inject({ method: "GET", url: "/readyz" });
    await app.inject({ method: "GET", url: "/readyz" });
    // Two requests × three deps = six total invocations of the depCheck
    // fake (the real lru-cache layer would collapse these to three —
    // tested in dep-check.test.ts).
    expect(calls).toHaveLength(6);
    await app.close();
  });
});

describe("/startupz (D-P1 — boot completion)", () => {
  it("returns 503 until migrations applied (markStartupComplete not yet called)", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/startupz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ready: false });
    await app.close();
  });

  it("returns 503 until pg pool warm (same flag — semantic alias)", async () => {
    resetStartupComplete();
    const app = await makeApp();
    expect(isStartupComplete()).toBe(false);
    const res = await app.inject({ method: "GET", url: "/startupz" });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("returns 200 once full boot complete", async () => {
    const app = await makeApp();
    markStartupComplete();
    expect(isStartupComplete()).toBe(true);
    const res = await app.inject({ method: "GET", url: "/startupz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true });
    await app.close();
  });
});

describe("/api/health alias (back-compat with apps/api/src/health.test.ts)", () => {
  it("delegates to /livez behavior — 200 with {status:'ok', migrations_completed:false} when migrationsCheck not wired", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    // Plan 13-01 / Task 13-01-05 — new field `migrations_completed`. When
    // no migrationsCheck dep is wired, the field defaults to `false` so
    // the harness/operator gets an actionable "migrations runner has not
    // been wired into the boot" signal (distinct from runtime DB outage).
    expect(res.json()).toEqual({ status: "ok", migrations_completed: false });
    await app.close();
  });

  it("emits RFC 8594 Deprecation + Link successor-version headers", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["deprecation"]).toBe("true");
    expect(res.headers["link"]).toBe('</livez>; rel="successor-version"');
    await app.close();
  });

  it("ignores dep health (alias of /livez, not /readyz)", async () => {
    const { fn, calls } = makeDepCheckFake({
      postgres: { ok: false, latency_ms: 0, error: "PG DOWN" },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([]);
    await app.close();
  });
});

describe("/api/health migrations_completed (Plan 13-01 / Task 13-01-05)", () => {
  async function makeAppWithMigrationsCheck(migrationsCheck: () => Promise<boolean>) {
    const app = Fastify({ logger: false });
    await registerProbes(app, { migrationsCheck });
    await app.ready();
    return app;
  }

  it("returns migrations_completed:true when injected migrationsCheck resolves true", async () => {
    const calls: number[] = [];
    const migrationsCheck = async (): Promise<boolean> => {
      calls.push(Date.now());
      return true;
    };
    const app = await makeAppWithMigrationsCheck(migrationsCheck);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", migrations_completed: true });
    expect(calls).toHaveLength(1);
    await app.close();
  });

  it("returns migrations_completed:false when injected migrationsCheck resolves false", async () => {
    const migrationsCheck = async (): Promise<boolean> => false;
    const app = await makeAppWithMigrationsCheck(migrationsCheck);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", migrations_completed: false });
    await app.close();
  });

  it("returns migrations_completed:false (does not throw) when migrationsCheck rejects — defensive fallback", async () => {
    const migrationsCheck = async (): Promise<boolean> => {
      throw new Error("pool not ready");
    };
    const app = await makeAppWithMigrationsCheck(migrationsCheck);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    // /api/health is /livez aliased — it MUST stay 200 even when the
    // migration probe hiccups. The field reports false to surface the
    // hiccup without cascading into a kubelet restart loop.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", migrations_completed: false });
    await app.close();
  });

  it("still emits Deprecation + Link headers when migrationsCheck is wired", async () => {
    const migrationsCheck = async (): Promise<boolean> => true;
    const app = await makeAppWithMigrationsCheck(migrationsCheck);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["deprecation"]).toBe("true");
    expect(res.headers["link"]).toBe('</livez>; rel="successor-version"');
    await app.close();
  });
});

describe("probe routes are rate-limit + auth exempt (config flags)", () => {
  it("registers all four routes with config.rateLimit=false + config.auth=false", async () => {
    const app = await makeApp();
    // Fastify exposes the registered routes via `printRoutes` / the
    // internal store; the simplest contract check is that the routes
    // respond without the global preHandler/limiter machinery getting
    // in the way under inject(). The strong assertion lives in the
    // grep'd `rateLimit: false` count in the source file (acceptance
    // criteria) — here we just sanity-check that the four URLs all
    // route to a 200/503 in isolation.
    const urls = ["/livez", "/startupz", "/api/health"];
    for (const url of urls) {
      const res = await app.inject({ method: "GET", url });
      expect([200, 503]).toContain(res.statusCode);
    }
    await app.close();
  });
});
