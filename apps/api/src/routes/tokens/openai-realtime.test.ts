// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 04 / Task 1 — POST /api/openai-realtime-token tests.
//
// Strategy mirrors assemblyai.test.ts / deepgram.test.ts: hermetic Fastify
// app with the centralized error handler + rate-limit plugin + a synthetic
// auth hook standing in for the production dualAuthHook (per Plan 02 D-04
// the production hook is wired in buildApp). undici MockAgent intercepts
// https://api.openai.com so we exercise the real undici call surface.
//
// CLAUDE.md compliance: only the network process boundary (undici MockAgent)
// and the Better-Auth boundary (synthetic hook) are mocked. The route's
// own logic (Promise.all parallelism, secrets[0] selection, fail-fast
// secret-leakage prevention) is exercised end-to-end through Fastify
// inject — no internal mocks.
//
// Acceptance matrix (9 tests, see 04-04-PLAN.md Task 1 behavior):
//   1. streams=1 success → 200 with clientSecret + clientSecrets[1] both populated
//   2. streams=2 success → 200, clientSecret = first secret, clientSecrets length 2
//      AND both upstream calls fire within 50 ms of each other (parallel, not sequential)
//   3. streams=3 → 400 "streams must be 1 or 2"
//   4. streams=2 fail-fast → second mint 500 → 503; first secret NEVER leaked to wire
//   5. missing OPENAI_API_KEY → 503 with EXACT not-configured envelope
//   6. per-user 30/min — two userIds isolated (T-04-04 mitigation)
//   7. body.model='gpt-realtime-2025' → upstream POST body session.model = same
//      AND default 'gpt-realtime' applied when omitted
//   8. malformed upstream (no `value` field) → 503 malformed-response
//   9. unauthenticated → 401 BEFORE rate-limit bucket consumed

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, setGlobalDispatcher } from "undici";
import { rateLimitPlugin } from "../../plugins/rate-limit.js";
import { registerErrorHandler } from "../../error-handler.js";
import { AuthError } from "../../errors.js";
import { buildOpenAIRealtimeTokenRoutes } from "./openai-realtime.js";

const OPENAI_HOST = "https://api.openai.com";
const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const OPENAI_FIXTURE = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "openai-client-secret-response.json"), "utf8"),
) as { value: string; expires_at: number; session: Record<string, unknown> };

let agent: MockAgent;

interface TestAppOpts {
  bearerMap?: Record<string, string>;
}

async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  // Synthetic dual-auth — onRequest so it fires before rate-limit's
  // onRequest evaluates `keyGenerator(req)` (which reads req.user.id).
  app.addHook("onRequest", async (req) => {
    const auth = req.headers["authorization"];
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) throw new AuthError("unauthorized");
    const userId = opts.bearerMap?.[value];
    if (!userId) throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: userId,
      email: `${userId}@test.local`,
    };
  });
  await app.register(buildOpenAIRealtimeTokenRoutes());
  await app.ready();
  return app;
}

function makeFixtureWithValue(value: string): typeof OPENAI_FIXTURE {
  return { ...OPENAI_FIXTURE, value };
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

describe("POST /api/openai-realtime-token", () => {
  it("streams=1 (default) returns 200 with clientSecret and clientSecrets[1]", async () => {
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, makeFixtureWithValue("ek_xxx"), {
        headers: { "content-type": "application/json" },
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { clientSecret: string; clientSecrets: string[] };
      expect(body.clientSecret).toBe("ek_xxx");
      expect(body.clientSecrets).toEqual(["ek_xxx"]);
      expect(body.clientSecrets).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("streams=2 returns clientSecrets length 2 and fires the two upstream calls in parallel (<=50ms apart)", async () => {
    const callTimestamps: number[] = [];
    // Reply factory is invoked exactly once per dispatched request (when the
    // intercept actually serves), unlike path/body matchers which MockAgent
    // re-invokes per candidate during matching. Stamping in the reply
    // callback gives us a true per-request timestamp.
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, () => {
        callTimestamps.push(Date.now());
        return makeFixtureWithValue("ek_aaa");
      });
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, () => {
        callTimestamps.push(Date.now());
        return makeFixtureWithValue("ek_bbb");
      });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { streams: 2 },
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { clientSecret: string; clientSecrets: string[] };
      expect(body.clientSecrets).toHaveLength(2);
      expect(body.clientSecret).toBe(body.clientSecrets[0]);
      // Both ek_aaa and ek_bbb present (order may swap depending on which
      // intercept matches first — the spec requires clientSecret = first
      // RESOLVED, which Promise.all preserves by input order, but MockAgent
      // matches on registration order so we just assert set membership).
      expect(new Set(body.clientSecrets)).toEqual(new Set(["ek_aaa", "ek_bbb"]));
      // Parallelism: two upstream calls within 50 ms of each other.
      expect(callTimestamps).toHaveLength(2);
      expect(Math.abs(callTimestamps[1] - callTimestamps[0])).toBeLessThan(50);
    } finally {
      await app.close();
    }
  });

  it("returns 400 when streams is not 1 or 2", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { streams: 3 },
      });
      expect(r.statusCode).toBe(400);
      const body = r.json() as { error: string };
      expect(body.error).toContain("streams must be 1 or 2");
    } finally {
      await app.close();
    }
  });

  it("streams=2 fail-fast: second mint 500 → 503 and first secret NEVER appears in body", async () => {
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, makeFixtureWithValue("ek_first_should_not_leak"));
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(500, { error: "boom" });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { streams: 2 },
      });
      expect(r.statusCode).toBe(503);
      const raw = r.body;
      // T-04-01: the first successful secret must NEVER cross the wire on
      // partial failure.
      expect(raw).not.toContain("ek_first_should_not_leak");
      const body = r.json() as { error: string };
      expect(body.error).toContain("token mint upstream error");
    } finally {
      await app.close();
    }
  });

  it("returns 503 with EXACT not-configured envelope when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({
        error: "OpenAI Realtime not configured (set OPENAI_API_KEY in .env)",
      });
    } finally {
      await app.close();
    }
  });

  it("enforces 30/min per-user rate-limit; two userIds remain isolated", async () => {
    for (let i = 0; i < 70; i++) {
      agent
        .get(OPENAI_HOST)
        .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
        .reply(200, makeFixtureWithValue(`ek_${i}`));
    }
    const app = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1", "Bearer ok-u2": "u2" },
    });
    try {
      for (let i = 0; i < 30; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/api/openai-realtime-token",
          headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
          payload: {},
        });
        expect(r.statusCode).toBe(200);
      }
      const blocked = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(blocked.statusCode).toBe(429);
      const u2Ok = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u2", "content-type": "application/json" },
        payload: {},
      });
      expect(u2Ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("forwards body.model into upstream session.model and defaults to 'gpt-realtime' when omitted", async () => {
    const captured: Array<Record<string, unknown>> = [];
    // Reply factory receives the dispatch options including request body —
    // captured exactly once per served request (vs body matchers re-invoked
    // per candidate during MockAgent matching).
    const captureReply = (value: string) => (opts: { body?: unknown }) => {
      try {
        const raw = typeof opts.body === "string" ? opts.body : String(opts.body ?? "");
        captured.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        captured.push({});
      }
      return makeFixtureWithValue(value);
    };
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, captureReply("ek_custom"));
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, captureReply("ek_default"));

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      // Override model.
      const r1 = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: { model: "gpt-realtime-2025" },
      });
      expect(r1.statusCode).toBe(200);
      // Default model.
      const r2 = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r2.statusCode).toBe(200);
      expect(captured).toHaveLength(2);
      const sess1 = captured[0].session as { type: string; model: string };
      const sess2 = captured[1].session as { type: string; model: string };
      expect(sess1.type).toBe("realtime");
      expect(sess1.model).toBe("gpt-realtime-2025");
      expect(sess2.model).toBe("gpt-realtime");
    } finally {
      await app.close();
    }
  });

  it("returns 503 malformed-response envelope when upstream JSON lacks the value field", async () => {
    agent
      .get(OPENAI_HOST)
      .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
      .reply(200, { not_value: "oops" });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({ error: "OpenAI Realtime token mint malformed response" });
    } finally {
      await app.close();
    }
  });

  it("returns 401 on missing bearer BEFORE consuming rate-limit bucket (T-04-04 mitigation)", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      for (let i = 0; i < 35; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/api/openai-realtime-token",
          headers: { "content-type": "application/json" },
          payload: {},
        });
        expect(r.statusCode).toBe(401);
      }
      // Authenticated request afterwards still succeeds — bucket not consumed.
      agent
        .get(OPENAI_HOST)
        .intercept({ path: "/v1/realtime/client_secrets", method: "POST" })
        .reply(200, makeFixtureWithValue("ek_after_unauth"));
      const ok = await app.inject({
        method: "POST",
        url: "/api/openai-realtime-token",
        headers: { authorization: "Bearer ok-u1", "content-type": "application/json" },
        payload: {},
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
