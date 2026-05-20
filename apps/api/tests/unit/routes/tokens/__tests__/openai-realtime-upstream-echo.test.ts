// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-01 + WR-02 regression tests.
//
// WR-01 (already-closed guard) — confirms the openai-realtime upstream-failure
// path emits the class-default literal, NOT a raw upstream `.message`. Phase 62
// HI-03 swept the throw sites to code+literal pairs; this is a GREEN-only guard.
//
// WR-02 (RED→GREEN) — the upstream-400 branch must NOT echo the raw
// `upstream400.upstreamBody` blob onto the wire. A crafted upstream 400 body
// carrying a free-form sentinel must not place attacker-controlled text on the
// response.
//
// Strategy mirrors openai-realtime.test.ts: hermetic Fastify app + undici
// MockAgent intercepting https://api.openai.com (the only mock boundary).

import Fastify, { type FastifyInstance } from "fastify";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../../src/error-handler.js";
import { AuthError } from "../../../../../src/errors.js";
import { rateLimitPlugin } from "../../../../../src/plugins/rate-limit.js";
import { buildOpenAIRealtimeTokenRoutes } from "../../../../../src/routes/tokens/openai-realtime.js";

const OPENAI_HOST = "https://api.openai.com";

let agent: MockAgent;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (value !== "Bearer ok-u1") throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: "u1",
      email: "u1@test.local",
    };
  });
  await app.register(buildOpenAIRealtimeTokenRoutes());
  await app.ready();
  return app;
}

beforeEach(() => {
  agent = new MockAgent({ connections: 10 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  process.env.OPENAI_API_KEY = "test-openai-key";
});

afterEach(async () => {
  await agent.close();
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
});

describe("openai-realtime — WR-01 / WR-02 upstream-body echo", () => {
  it("WR-01: upstream 5xx failure does not leak the upstream .message to the wire", async () => {
    // The upstream returns a 500 with a recognizable sentinel in its body —
    // the route's failure path must surface the class-default literal only.
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(
        500,
        { error: { message: "WR01_SENTINEL_LEAK_upstream_message" } },
        { headers: { "content-type": "application/json" } },
      );

    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r.statusCode).toBe(503);
      expect(r.body).not.toContain("WR01_SENTINEL_LEAK_upstream_message");
      const body = r.json() as { error: string };
      expect(body.error).toBe("Service temporarily unavailable");
    } finally {
      await app.close();
    }
  });

  it("WR-02: a crafted upstream 400 body cannot place free-form text on the wire", async () => {
    // The upstream rejects with 400 and a free-form sentinel embedded in the
    // body. Pre-fix the route echoed `upstream: upstream400.upstreamBody`
    // verbatim → the sentinel reaches the desktop client.
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(
        400,
        {
          error: {
            message: "WR02_SENTINEL_LEAK_xyz",
            code: "bad_request",
            type: "invalid_request_error",
            param: "WR02_PARAM_SENTINEL",
          },
        },
        { headers: { "content-type": "application/json" } },
      );

    const app = await buildTestApp();
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r.statusCode).toBe(400);
      // The raw upstream blob must not appear anywhere in the response.
      expect(r.body).not.toContain("WR02_SENTINEL_LEAK_xyz");
      expect(r.body).not.toContain("WR02_PARAM_SENTINEL");
      const body = r.json() as { error: { code: string; message: string } };
      // The fixed, route-controlled fields stay.
      expect(body.error.code).toBe("UPSTREAM_REJECTED");
      expect(body.error.message).toBe("OpenAI Realtime rejected the request");
    } finally {
      await app.close();
    }
  });
});
