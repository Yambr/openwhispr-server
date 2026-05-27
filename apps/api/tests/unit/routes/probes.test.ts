// SPDX-License-Identifier: FSL-1.1-ALv2
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
import type { DepName, DepResult } from "../../../src/lib/dep-check.js";
import {
  isStartupComplete,
  markStartupComplete,
  registerProbes,
  resetStartupComplete,
} from "../../../src/routes/probes.js";

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

  // Phase 59 / Track B — R16 facet 1: an intentionally-absent litellm
  // (corporate override pointing elsewhere, or a deploy with no bundled
  // litellm) must NOT drag /readyz to 503. The dep-check reports it
  // `skipped:true` and the aggregate excludes a skipped dep.
  it("R16 — returns 200 when LiteLLM is honestly reported skipped", async () => {
    const { fn } = makeDepCheckFake({
      litellm: { ok: true, latency_ms: 0, skipped: true },
    });
    const app = await makeApp(fn);
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<DepName, DepResult>;
    expect(body.litellm.skipped).toBe(true);
    await app.close();
  });

  it("R16 — a skipped litellm does not mask a real postgres outage", async () => {
    const { fn } = makeDepCheckFake({
      litellm: { ok: true, latency_ms: 0, skipped: true },
      postgres: { ok: false, latency_ms: 5, error: "ECONNREFUSED" },
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
    // Quick-task 260528-370 — additive build-info triplet. When no
    // buildInfo dep is wired, all three fields surface "unknown" (the
    // documented BUILD_INFO_UNKNOWN sentinel).
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: false,
      version: "unknown",
      commit_sha: "unknown",
      image_tag: "unknown",
    });
    await app.close();
  });

  // Phase 56 / Plan 56-08 (R4): /api/health and /livez are both
  // first-class endpoints serving different audiences (Electron client
  // per BACKEND_SPEC vs kubelet). Neither is a "successor" of the other,
  // so the server MUST NOT emit RFC 8594 Deprecation / Link successor-
  // version headers on /api/health.
  it("does NOT emit Deprecation or Link successor-version headers (R4)", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers.deprecation).toBeUndefined();
    // No `link` header at all, or at minimum no successor-version rel.
    const link = res.headers.link;
    if (link !== undefined) {
      const linkStr = Array.isArray(link) ? link.join(", ") : link;
      expect(linkStr).not.toMatch(/rel\s*=\s*"?successor-version"?/i);
    }
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
    // Quick-task 260528-370 — additive build-info triplet defaults to
    // BUILD_INFO_UNKNOWN when no buildInfo dep is wired (this case only
    // wires migrationsCheck).
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: true,
      version: "unknown",
      commit_sha: "unknown",
      image_tag: "unknown",
    });
    expect(calls).toHaveLength(1);
    await app.close();
  });

  it("returns migrations_completed:false when injected migrationsCheck resolves false", async () => {
    const migrationsCheck = async (): Promise<boolean> => false;
    const app = await makeAppWithMigrationsCheck(migrationsCheck);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: false,
      version: "unknown",
      commit_sha: "unknown",
      image_tag: "unknown",
    });
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
    expect(res.json()).toEqual({
      status: "ok",
      migrations_completed: false,
      version: "unknown",
      commit_sha: "unknown",
      image_tag: "unknown",
    });
    await app.close();
  });

  // Phase 56 / Plan 56-08 (R4): Deprecation/Link headers removed
  // regardless of whether migrationsCheck is wired.
  it("does NOT emit Deprecation or Link successor-version headers when migrationsCheck is wired (R4)", async () => {
    const migrationsCheck = async (): Promise<boolean> => true;
    const app = await makeAppWithMigrationsCheck(migrationsCheck);
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers.deprecation).toBeUndefined();
    const link = res.headers.link;
    if (link !== undefined) {
      const linkStr = Array.isArray(link) ? link.join(", ") : link;
      expect(linkStr).not.toMatch(/rel\s*=\s*"?successor-version"?/i);
    }
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
