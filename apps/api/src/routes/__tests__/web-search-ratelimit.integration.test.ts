// SPDX-License-Identifier: Apache-2.0
// Phase 05 / Plan 03 / Task 3 — POST /api/agent/web-search rate-limit
// integration test.
//
// Asserts D-07: 30/min/user via @fastify/rate-limit; the 31st request in
// the same minute returns 429 with the canonical `{error:"Too many
// requests"}` envelope. Two users with separate identities are isolated
// (T-05-10 mitigation — bucket keyed on req.user.id, not req.ip).
//
// Mocks: NONE in route logic. We register the production rateLimitPlugin
// with an in-process backend (no Valkey) — `@fastify/rate-limit` falls
// back to an in-memory store when `redis` is omitted, which is what
// the rate-limit-plugin's own unit tests already exercise.

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../error-handler.js";
import { zodTypeProvider } from "../../plugins/zod-type-provider.js";
import { rateLimitPlugin } from "../../plugins/rate-limit.js";
import { AuthError } from "../../errors.js";
import type { WebSearchProvider } from "../../lib/web-search/types.js";
import { buildWebSearchRoutes } from "../agent/web-search.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";

function makeFakeDb(): Parameters<typeof buildWebSearchRoutes>[0]["db"] {
  const tx = {
    async execute(): Promise<unknown> {
      return { rows: [] };
    },
  };
  return {
    async transaction<T>(cb: (t: typeof tx) => Promise<T>): Promise<T> {
      return cb(tx);
    },
  };
}

const happyProvider: WebSearchProvider = {
  name: "tavily",
  isConfigured: () => true,
  search: async () => ({
    results: [{ title: "ok", url: "https://example", snippet: "ok" }],
  }),
};

async function buildApp(bearerMap: Record<string, string>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  await app.register(zodTypeProvider);
  // Synthetic dual-auth: req.user.id resolved from a bearer-map; rate-limit
  // plugin's keyGenerator reads req.user.id (matches production ordering).
  app.addHook("onRequest", async (req) => {
    const auth = req.headers["authorization"];
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) throw new AuthError("unauthorized");
    const userId = bearerMap[value];
    if (!userId) throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: userId,
      email: `${userId}@test.local`,
    };
    (req as unknown as { tenant: string }).tenant = TEST_TENANT;
  });
  await app.register(
    buildWebSearchRoutes({ db: makeFakeDb(), provider: happyProvider }),
  );
  await app.ready();
  return app;
}

async function postSearch(
  app: FastifyInstance,
  bearer: string,
): Promise<ReturnType<FastifyInstance["inject"]>> {
  return app.inject({
    method: "POST",
    url: "/api/agent/web-search",
    headers: {
      "content-type": "application/json",
      authorization: bearer,
    },
    payload: JSON.stringify({ query: "ping" }),
  });
}

describe("POST /api/agent/web-search rate-limit (D-07: 30/min/user)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("31st request within the same minute returns 429 with canonical envelope", async () => {
    app = await buildApp({ "Bearer userA": "user-A" });
    for (let i = 0; i < 30; i++) {
      const r = await postSearch(app, "Bearer userA");
      expect(r.statusCode).toBe(200);
    }
    const blocked = await postSearch(app, "Bearer userA");
    expect(blocked.statusCode).toBe(429);
    const env = ErrorEnvelope.parse(blocked.json());
    expect(env.error).toBe("Too many requests");
  });

  it("two users with distinct identities are isolated (T-05-10 mitigation)", async () => {
    app = await buildApp({
      "Bearer userA": "user-A",
      "Bearer userB": "user-B",
    });
    for (let i = 0; i < 30; i++) {
      const r = await postSearch(app, "Bearer userA");
      expect(r.statusCode).toBe(200);
    }
    // user A is now exhausted; user B's bucket is untouched.
    const blockedA = await postSearch(app, "Bearer userA");
    expect(blockedA.statusCode).toBe(429);
    const okB = await postSearch(app, "Bearer userB");
    expect(okB.statusCode).toBe(200);
  });
});
