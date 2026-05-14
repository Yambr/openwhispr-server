// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 03 / Task 3 — POST /api/deepgram-streaming-token tests.
//
// Mirrors assemblyai.test.ts; differences: provider host, request body
// (JSON ttl_seconds), `Token <key>` Authorization prefix, response field
// rename access_token → token (per BACKEND_SPEC).
//
// Acceptance matrix (6 tests, see 04-03-PLAN.md Task 3 behavior).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { AuthError } from "../../../../src/errors.js";
import { rateLimitPlugin } from "../../../../src/plugins/rate-limit.js";
import { buildDeepgramTokenRoutes } from "../../../../src/routes/tokens/deepgram.js";

const DEEPGRAM_HOST = "https://api.deepgram.com";
const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const DEEPGRAM_FIXTURE = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "deepgram-grant-token-response.json"), "utf8"),
) as { access_token: string; expires_in: number };

let agent: MockAgent;

interface TestAppOpts {
  bearerMap?: Record<string, string>;
}

async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
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
  await app.register(buildDeepgramTokenRoutes());
  await app.ready();
  return app;
}

beforeEach(() => {
  agent = new MockAgent({ connections: 10 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  process.env.DEEPGRAM_API_KEY = "dg-test-key";
  delete process.env.DEEPGRAM_TOKEN_TTL;
});

afterEach(async () => {
  await agent.close();
  vi.restoreAllMocks();
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.DEEPGRAM_TOKEN_TTL;
});

describe("POST /api/deepgram-streaming-token (Deepgram Grant Token)", () => {
  it("renames upstream access_token → wire token field on success", async () => {
    let capturedAuth: string | undefined;
    let capturedBody: string | undefined;
    agent
      .get(DEEPGRAM_HOST)
      .intercept({
        path: "/v1/auth/grant",
        method: "POST",
      })
      .reply(200, (opts) => {
        capturedAuth = (opts.headers as Record<string, string>).authorization;
        capturedBody = opts.body as string;
        return DEEPGRAM_FIXTURE;
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ token: DEEPGRAM_FIXTURE.access_token });
      // D-15 verification: Token (NOT Bearer) prefix.
      expect(capturedAuth).toBe("Token dg-test-key");
      // Default TTL 30s in body.
      expect(JSON.parse(capturedBody as string)).toEqual({ ttl_seconds: 30 });
    } finally {
      await app.close();
    }
  });

  it("returns 503 with EXACT not-configured envelope when DEEPGRAM_API_KEY is unset", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({
        error: "Deepgram not configured (set DEEPGRAM_API_KEY in .env)",
      });
    } finally {
      await app.close();
    }
  });

  it("propagates DEEPGRAM_TOKEN_TTL=60 into the body ttl_seconds field", async () => {
    process.env.DEEPGRAM_TOKEN_TTL = "60";
    let capturedBody: string | undefined;
    agent
      .get(DEEPGRAM_HOST)
      .intercept({ path: "/v1/auth/grant", method: "POST" })
      .reply(200, (opts) => {
        capturedBody = opts.body as string;
        return DEEPGRAM_FIXTURE;
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(capturedBody as string)).toEqual({ ttl_seconds: 60 });
    } finally {
      await app.close();
    }
  });

  it("enforces 30/min per-user rate-limit; two userIds remain isolated", async () => {
    for (let i = 0; i < 70; i++) {
      agent
        .get(DEEPGRAM_HOST)
        .intercept({ path: "/v1/auth/grant", method: "POST" })
        .reply(200, DEEPGRAM_FIXTURE);
    }

    const app = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1", "Bearer ok-u2": "u2" },
    });
    try {
      for (let i = 0; i < 30; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/api/deepgram-streaming-token",
          headers: { authorization: "Bearer ok-u1" },
        });
        expect(r.statusCode).toBe(200);
      }
      const blocked = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: "Too many requests" });

      const u2Ok = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u2" },
      });
      expect(u2Ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("returns 503 malformed-response envelope when upstream lacks access_token", async () => {
    agent
      .get(DEEPGRAM_HOST)
      .intercept({ path: "/v1/auth/grant", method: "POST" })
      .reply(200, { not_access_token: "oops" });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ error: "Deepgram token mint malformed response" });
    } finally {
      await app.close();
    }
  });

  it("maps upstream 500 to 503 token-mint upstream-error envelope", async () => {
    agent
      .get(DEEPGRAM_HOST)
      .intercept({ path: "/v1/auth/grant", method: "POST" })
      .reply(500, { error: "internal" });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ error: "Deepgram token mint upstream error" });
    } finally {
      await app.close();
    }
  });

  it("returns 401 on missing bearer BEFORE consuming rate-limit bucket", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      for (let i = 0; i < 35; i++) {
        const r = await app.inject({ method: "POST", url: "/api/deepgram-streaming-token" });
        expect(r.statusCode).toBe(401);
      }
      agent
        .get(DEEPGRAM_HOST)
        .intercept({ path: "/v1/auth/grant", method: "POST" })
        .reply(200, DEEPGRAM_FIXTURE);
      const ok = await app.inject({
        method: "POST",
        url: "/api/deepgram-streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
