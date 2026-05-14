// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 06 / Task 3 — buildAllRoutes registration tests for the
// four new Phase-4 routes:
//   * POST /api/agent/stream                  (gated on deps.litellm)
//   * POST /api/streaming-token                (always — calls AssemblyAI direct)
//   * POST /api/deepgram-streaming-token       (always — calls Deepgram direct)
//   * POST /api/openai-realtime-token          (always — calls OpenAI direct)
//
// Token routes are registered UNCONDITIONALLY (D-13: they call provider
// HTTP APIs directly, NOT via LiteLLM, so they don't need the litellm
// dep). agent/stream is registered ONLY when deps.litellm is present
// because it forwards to LiteLLM's chat completions endpoint.
//
// Regression: /v1/realtime (Phase 3 wsUpstream) MUST still appear in the
// route tree when both litellm + litellmMasterKey are wired — Phase 4
// must not regress Phase 3 ordering.

import type { LitellmClient } from "@openwhispr/litellm-client";
import { describe, expect, it } from "vitest";
import { type AllRoutesDeps, buildAllRoutes } from "../../../../src/routes/index.js";

function fakeLitellm(): LitellmClient {
  return {
    baseUrl: "http://litellm.test:4000",
    chatCompletions: () => Promise.reject(new Error("not used")),
    audioTranscriptions: () => Promise.reject(new Error("not used")),
    passthrough: () => Promise.reject(new Error("not used")),
  };
}

function fakeDb(): AllRoutesDeps["db"] {
  return {
    async transaction<T>(
      cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>,
    ): Promise<T> {
      return cb({
        async execute() {
          return { rows: [] };
        },
      });
    },
  };
}

function fakeAuth(): AllRoutesDeps["auth"] {
  return {
    api: { getSession: async () => null },
    handler: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as AllRoutesDeps["auth"];
}

async function buildRouteTree(deps: AllRoutesDeps): Promise<string> {
  const Fastify = (await import("fastify")).default;
  const { registerErrorHandler } = await import("../../../../src/error-handler");
  const { zodTypeProvider } = await import("../../../../src/plugins/zod-type-provider");
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: "11111111-1111-1111-1111-111111111111", email: "x@y.test" };
    req.tenant = "00000000-0000-0000-0000-000000000000";
  });
  const routes = buildAllRoutes(deps);
  for (const plugin of routes) {
    await app.register(plugin);
  }
  await app.ready();
  const tree = app.printRoutes({ commonPrefix: false });
  await app.close();
  return tree;
}

describe("buildAllRoutes — Phase 04 registration of agent/stream + 3 token routes", () => {
  it("Test 1 — with full deps (litellm + litellmMasterKey), all four new Phase-4 routes are registered", async () => {
    const tree = await buildRouteTree({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
      litellmMasterKey: "sk-test",
    });
    expect(tree).toContain("/api/agent/stream");
    expect(tree).toContain("/api/streaming-token");
    expect(tree).toContain("/api/deepgram-streaming-token");
    expect(tree).toContain("/api/openai-realtime-token");
  });

  it("Test 2 — three token routes register EVEN WHEN litellm is undefined (D-13: providers called direct)", async () => {
    const tree = await buildRouteTree({
      db: fakeDb(),
      auth: fakeAuth(),
    });
    expect(tree).toContain("/api/streaming-token");
    expect(tree).toContain("/api/deepgram-streaming-token");
    expect(tree).toContain("/api/openai-realtime-token");
    // /api/agent/stream MUST NOT register without litellm.
    expect(tree).not.toContain("/api/agent/stream");
  });

  it("Test 3 — /api/agent/stream is registered ONLY when litellm dep is present", async () => {
    const treeNo = await buildRouteTree({ db: fakeDb(), auth: fakeAuth() });
    const treeYes = await buildRouteTree({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    expect(treeNo).not.toContain("/api/agent/stream");
    expect(treeYes).toContain("/api/agent/stream");
  });

  it("Test 6 (branch coverage) — auth-callback honors deps.mintBearer when supplied", async () => {
    // Pre-existing line-119 branch: deps.mintBearer ? {...,mintBearer} : {...}
    const fakeMintBearer = (async () => "tk") as unknown as NonNullable<
      AllRoutesDeps["mintBearer"]
    >;
    const tree = await buildRouteTree({
      db: fakeDb(),
      auth: fakeAuth(),
      mintBearer: fakeMintBearer,
    });
    expect(tree).toContain("/api/auth/desktop-callback");
  });

  it("Test 7 (branch coverage) — diarization mockMode flips on MOCK_DIARIZATION env even when mockDiarization opt is undefined", async () => {
    const fakeRedis = {
      get: async () => null,
      set: async () => "OK",
    } as unknown as AllRoutesDeps["redis"];
    const prev = process.env.MOCK_DIARIZATION;
    process.env.MOCK_DIARIZATION = "true";
    try {
      const tree = await buildRouteTree({
        db: fakeDb(),
        auth: fakeAuth(),
        redis: fakeRedis,
      });
      expect(tree).toContain("/v1/audio/diarization");
    } finally {
      if (prev === undefined) delete process.env.MOCK_DIARIZATION;
      else process.env.MOCK_DIARIZATION = prev;
    }
  });

  it("Test 8 (branch coverage) — test-only routes register when OPENWHISPR_TEST_ROUTES env is true", async () => {
    const prevNode = process.env.NODE_ENV;
    const prevOw = process.env.OPENWHISPR_TEST_ROUTES;
    process.env.NODE_ENV = "production";
    process.env.OPENWHISPR_TEST_ROUTES = "true";
    try {
      const tree = await buildRouteTree({
        db: fakeDb(),
        auth: fakeAuth(),
      });
      // The test-only plugin registers a /api/_test/* surface.
      expect(tree).toContain("/api/_test/");
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevOw === undefined) delete process.env.OPENWHISPR_TEST_ROUTES;
      else process.env.OPENWHISPR_TEST_ROUTES = prevOw;
    }
  });

  it("Test 5 (branch coverage) — diarization route registers when deps.redis is provided", async () => {
    const fakeRedis = {
      get: async () => null,
      set: async () => "OK",
    } as unknown as AllRoutesDeps["redis"];
    const tree = await buildRouteTree({
      db: fakeDb(),
      auth: fakeAuth(),
      redis: fakeRedis,
      mockDiarization: true,
    });
    expect(tree).toContain("/v1/audio/diarization");
  });

  it("Test 4 — existing /v1/realtime route is still registered when litellm + masterKey are wired (Phase 3 regression guard)", async () => {
    const tree = await buildRouteTree({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
      litellmMasterKey: "sk-test",
    });
    expect(tree).toContain("/v1/realtime");
    // Plus all Phase 4 routes still present alongside.
    expect(tree).toContain("/api/agent/stream");
    expect(tree).toContain("/api/streaming-token");
    expect(tree).toContain("/api/deepgram-streaming-token");
    expect(tree).toContain("/api/openai-realtime-token");
  });
});
