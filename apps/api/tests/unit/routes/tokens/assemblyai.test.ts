// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 03 / Task 2 — POST /api/streaming-token (AssemblyAI v3) tests.
//
// Strategy: hermetic Fastify app with the centralized error handler +
// rate-limit plugin + a synthetic auth hook that mimics dual-auth (sets
// req.user on a known bearer, throws AuthError otherwise — same envelope
// emission point as production). undici MockAgent intercepts
// streaming.assemblyai.com so we exercise the real undici call surface.
//
// CLAUDE.md compliance: only the network process boundary (undici MockAgent)
// and the Better-Auth boundary (the synthetic hook stands in for the real
// dualAuthHook — Plan 02 D-04 wires the production hook in buildApp; this
// test covers the route's own behavior, not Better Auth's). No internal
// logic of the route under test is mocked.
//
// Acceptance matrix (7 tests, see 04-03-PLAN.md Task 2 behavior):
//   1. success: fixture token round-trips
//   2. missing-key 503 with EXACT envelope string
//   3. unauthenticated 401 BEFORE rate-limit bucket consumption (T-04-04)
//   4. provider 401 → 503 not-configured envelope
//   5. ASSEMBLYAI_TOKEN_TTL=120 surfaces in upstream URL
//   6. per-user 30/min — 31st 429; two userIds isolated (T-04-04 mitigation)
//   7. malformed provider response (no `token` field) → 503 malformed

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { AuthError } from "../../../../src/errors.js";
import { rateLimitPlugin } from "../../../../src/plugins/rate-limit.js";
import { buildAssemblyAITokenRoutes } from "../../../../src/routes/tokens/assemblyai.js";

const ASSEMBLYAI_HOST = "https://streaming.assemblyai.com";
const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "src",
  "routes",
  "tokens",
  "__fixtures__",
);
const ASSEMBLYAI_FIXTURE_PATH = resolve(FIXTURE_DIR, "assemblyai-v3-token-response.json");
if (!existsSync(ASSEMBLYAI_FIXTURE_PATH))
  throw new Error(`source-contract path moved: ${ASSEMBLYAI_FIXTURE_PATH}`);
const ASSEMBLYAI_FIXTURE = JSON.parse(readFileSync(ASSEMBLYAI_FIXTURE_PATH, "utf8")) as {
  token: string;
};

let agent: MockAgent;

interface TestAppOpts {
  /** Map "Bearer <tok>" → user id; missing/unknown bearer → 401. */
  bearerMap?: Record<string, string>;
  /** Optional operator-overridden AssemblyAI token endpoint base URL. */
  tokenUrl?: string;
}

async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  // Synthetic dual-auth — runs as a preHandler (NOT onRequest) so per-route
  // `config.rateLimit` is evaluated AFTER auth, matching production
  // ordering (Plan 02 D-04: dualAuthHook runs first, only authenticated
  // requests reach the rate-limit hook). We attach via addHook("preHandler")
  // at the app level so it fires before per-route preHandlers; rate-limit
  // is an onRequest hook from @fastify/rate-limit and would fire FIRST
  // by default — but its `keyGenerator` reads req.user.id which we set
  // here. To match production order (auth → rate-limit), we use onRequest
  // to populate req.user before rate-limit's onRequest evaluates.
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
  await app.register(
    buildAssemblyAITokenRoutes(opts.tokenUrl !== undefined ? { tokenUrl: opts.tokenUrl } : {}),
  );
  await app.ready();
  return app;
}

beforeEach(() => {
  agent = new MockAgent({ connections: 10 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  process.env.ASSEMBLYAI_API_KEY = "test-key";
  delete process.env.ASSEMBLYAI_TOKEN_TTL;
});

afterEach(async () => {
  await agent.close();
  vi.restoreAllMocks();
  delete process.env.ASSEMBLYAI_API_KEY;
  delete process.env.ASSEMBLYAI_TOKEN_TTL;
});

describe("POST /api/streaming-token (AssemblyAI v3)", () => {
  it("returns 200 with fixture token when ASSEMBLYAI_API_KEY is set", async () => {
    agent
      .get(ASSEMBLYAI_HOST)
      .intercept({ path: "/v3/token?expires_in_seconds=60", method: "GET" })
      .reply(200, ASSEMBLYAI_FIXTURE, { headers: { "content-type": "application/json" } });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ token: ASSEMBLYAI_FIXTURE.token });
    } finally {
      await app.close();
    }
  });

  it("returns 503 with EXACT not-configured envelope when ASSEMBLYAI_API_KEY is unset", async () => {
    delete process.env.ASSEMBLYAI_API_KEY;
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toEqual({
        error: "AssemblyAI not configured (set ASSEMBLYAI_API_KEY in .env)",
      });
    } finally {
      await app.close();
    }
  });

  it("returns 401 on missing bearer BEFORE consuming rate-limit bucket (T-04-04 mitigation)", async () => {
    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      // 35 unauthenticated requests — if the bucket were consumed pre-auth
      // the 31st onward would 429 instead of 401.
      for (let i = 0; i < 35; i++) {
        const r = await app.inject({ method: "POST", url: "/api/streaming-token" });
        expect(r.statusCode).toBe(401);
      }
      // Confirm rate-limit bucket for ip is still available — an
      // authenticated call from the same connection succeeds (intercepts
      // the upstream).
      agent
        .get(ASSEMBLYAI_HOST)
        .intercept({ path: "/v3/token?expires_in_seconds=60", method: "GET" })
        .reply(200, ASSEMBLYAI_FIXTURE);
      const ok = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("HI-03 — maps upstream 401 to 503 with class-default literal (no upstream detail leak)", async () => {
    agent
      .get(ASSEMBLYAI_HOST)
      .intercept({ path: "/v3/token?expires_in_seconds=60", method: "GET" })
      .reply(401, { error: "bad key" });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(503);
      // HI-03 (Phase 62): the upstream-failure detail is logged server-side;
      // the wire envelope emits the class-default literal.
      expect(r.json()).toEqual({ error: "Service temporarily unavailable" });
    } finally {
      await app.close();
    }
  });

  it("propagates ASSEMBLYAI_TOKEN_TTL=120 into expires_in_seconds query param", async () => {
    process.env.ASSEMBLYAI_TOKEN_TTL = "120";
    let capturedPath: string | undefined;
    agent
      .get(ASSEMBLYAI_HOST)
      .intercept({
        path: (p) => {
          capturedPath = p;
          return p.startsWith("/v3/token");
        },
        method: "GET",
      })
      .reply(200, ASSEMBLYAI_FIXTURE);

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(200);
      expect(capturedPath).toBe("/v3/token?expires_in_seconds=120");
    } finally {
      await app.close();
    }
  });

  it("enforces 30/min per-user rate-limit; two userIds remain isolated", async () => {
    // Pre-load 31 + 31 + 1 successful upstream interceptors. We add 70 to
    // be safe (intercepts auto-clean as consumed).
    for (let i = 0; i < 70; i++) {
      agent
        .get(ASSEMBLYAI_HOST)
        .intercept({ path: "/v3/token?expires_in_seconds=60", method: "GET" })
        .reply(200, ASSEMBLYAI_FIXTURE);
    }

    const app = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1", "Bearer ok-u2": "u2" },
    });
    try {
      // u1 burns its 30-budget.
      for (let i = 0; i < 30; i++) {
        const r = await app.inject({
          method: "POST",
          url: "/api/streaming-token",
          headers: { authorization: "Bearer ok-u1" },
        });
        expect(r.statusCode).toBe(200);
      }
      // 31st call from u1 → 429 with envelope.
      const blocked = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({ error: "Too many requests" });

      // u2 has its own bucket — first call succeeds.
      const u2Ok = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u2" },
      });
      expect(u2Ok.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("calls a caller-supplied tokenUrl instead of the bundled default host", async () => {
    // Operator-overridden ASSEMBLYAI_TOKEN_URL is threaded into the route
    // factory by index.ts (the env boundary). The route appends the
    // dynamic expires_in_seconds query param to whatever base URL it is
    // given — proving the host literal is no longer baked into the route.
    const CUSTOM_HOST = "https://assemblyai.proxy.internal";
    agent
      .get(CUSTOM_HOST)
      .intercept({ path: "/edge/v3/token?expires_in_seconds=60", method: "GET" })
      .reply(200, ASSEMBLYAI_FIXTURE, { headers: { "content-type": "application/json" } });

    const app = await buildTestApp({
      bearerMap: { "Bearer ok-u1": "u1" },
      tokenUrl: `${CUSTOM_HOST}/edge/v3/token`,
    });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ token: ASSEMBLYAI_FIXTURE.token });
    } finally {
      await app.close();
    }
  });

  it("returns 503 malformed-response envelope when upstream JSON lacks the token field", async () => {
    agent
      .get(ASSEMBLYAI_HOST)
      .intercept({ path: "/v3/token?expires_in_seconds=60", method: "GET" })
      .reply(200, { not_token: "oops" });

    const app = await buildTestApp({ bearerMap: { "Bearer ok-u1": "u1" } });
    try {
      const r = await app.inject({
        method: "POST",
        url: "/api/streaming-token",
        headers: { authorization: "Bearer ok-u1" },
      });
      expect(r.statusCode).toBe(503);
      // HI-03 (Phase 62): class-default literal — no leaked detail.
      expect(r.json()).toEqual({ error: "Service temporarily unavailable" });
    } finally {
      await app.close();
    }
  });
});
