// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 41.b / HI-03 — POST /api/agent/stream per-user rate-limit
// integration test.
//
// Asserts D-2 (41-b-DECISIONS): 20/min/user via @fastify/rate-limit; the
// 21st request in the same minute returns 429 with the canonical
// {error:"Too many requests"} envelope. Two users with separate
// identities are isolated (bucket keyed on req.user.id, not req.ip).
//
// /api/agent/stream is the most expensive endpoint in the codebase (paid
// LLM, streaming response). The review explicitly flagged absence of a
// per-route rate-limit override as cost-exposure.

import { ErrorEnvelope } from "@openwhispr/contract-tests/schemas";
import { buildLitellmClient, type LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { Agent, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { AuthError } from "../../../../src/errors.js";
import { rateLimitPlugin } from "../../../../src/plugins/rate-limit.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildAgentStreamRoutes } from "../../../../src/routes/agent/stream.js";

const LITELLM_BASE = "http://litellm.test:4000";
const LITELLM_PATH = "/v1/chat/completions";

let agent: MockAgent;

function fakeLitellm(): LitellmClient {
  return buildLitellmClient(
    {
      baseUrl: LITELLM_BASE,
      masterKey: "sk-master-test",
      providerKeys: {
        openrouter: "sk-or-test",
        groq: "gsk-test",
        pyannote: "hf-test",
      },
      defaultChatModel: "qwen3.6-plus",
    },
    { isOverride: true },
  );
}

function fakeDb(): {
  transaction<T>(cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>): Promise<T>;
} {
  return {
    async transaction(cb) {
      return cb({
        async execute() {
          return { rows: [] };
        },
      });
    },
  };
}

function sseTextOnly(): string {
  return (
    'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n' +
    "data: [DONE]\n\n"
  );
}

async function buildApp(bearerMap: Record<string, string>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(rateLimitPlugin, { redis: undefined });
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) throw new AuthError("unauthorized");
    const userId = bearerMap[value];
    if (!userId) throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: userId,
      email: `${userId}@test.local`,
    };
  });
  await app.register(buildAgentStreamRoutes({ db: fakeDb() as never, litellm: fakeLitellm() }));
  await app.ready();
  return app;
}

async function postStream(
  app: FastifyInstance,
  bearer: string,
): Promise<ReturnType<FastifyInstance["inject"]>> {
  return app.inject({
    method: "POST",
    url: "/api/agent/stream",
    headers: { authorization: bearer, "content-type": "application/json" },
    payload: { messages: [{ role: "user", content: "hi" }] },
  });
}

beforeEach(() => {
  agent = new MockAgent({ connections: 50 });
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  // Reusable per-request intercept; persist=true to handle the 21 calls.
  agent
    .get(LITELLM_BASE)
    .intercept({ path: LITELLM_PATH, method: "POST" })
    .reply(200, sseTextOnly(), {
      headers: { "content-type": "text/event-stream" },
    })
    .persist();
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(new Agent());
});

describe("POST /api/agent/stream rate-limit (HI-03 / D-2: 20/min/user)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("21st request within the same minute returns 429 with canonical envelope", async () => {
    app = await buildApp({ "Bearer userA": "user-A" });
    for (let i = 0; i < 20; i++) {
      const r = await postStream(app, "Bearer userA");
      expect(r.statusCode).toBe(200);
    }
    const blocked = await postStream(app, "Bearer userA");
    expect(blocked.statusCode).toBe(429);
    const env = ErrorEnvelope.parse(blocked.json());
    expect(env.error).toBe("Too many requests");
  });

  it("two users with distinct identities are isolated (per-user bucket)", async () => {
    app = await buildApp({
      "Bearer userA": "user-A",
      "Bearer userB": "user-B",
    });
    for (let i = 0; i < 20; i++) {
      const r = await postStream(app, "Bearer userA");
      expect(r.statusCode).toBe(200);
    }
    const blockedA = await postStream(app, "Bearer userA");
    expect(blockedA.statusCode).toBe(429);
    const okB = await postStream(app, "Bearer userB");
    expect(okB.statusCode).toBe(200);
  });
});
