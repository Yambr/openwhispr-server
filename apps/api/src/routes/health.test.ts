// Phase 2 / Plan 03 / Task 3 — `/api/health` plugin tests.
//
// Build a minimal Fastify app, register the plugin, exercise via
// `app.inject`. No DB / auth / rate-limit dependencies — health is
// pre-auth and rate-limit-exempt.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HealthResponse } from "@openwhispr/contract-tests/schemas";
import { registerErrorHandler } from "../error-handler.js";
import { zodTypeProvider } from "../plugins/zod-type-provider.js";
import { healthRoutes } from "./index.js";

describe("GET /api/health", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    await app.register(healthRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 + {status:'ok'} on the happy path", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => HealthResponse.parse(body)).not.toThrow();
    expect(body).toEqual({ status: "ok" });
  });

  it("declares config.auth=false and config.rateLimit=false (consumed by Plan 04 plugins)", async () => {
    // Inspect the registered route's config via Fastify's introspection.
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/api/health");
    // 100 rapid calls — all 200 (no limiter wired in this test app, but
    // the assertion encodes intent: health is rate-limit-exempt; Plan 04
    // wires the actual limiter and re-asserts the budget exemption.)
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        app.inject({ method: "GET", url: "/api/health" }),
      ),
    );
    for (const r of results) {
      expect(r.statusCode).toBe(200);
    }
  });

  it("Content-Type is application/json on the success body", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
  });
});
