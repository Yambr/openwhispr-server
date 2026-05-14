// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 04 / Task 2 — buildAllRoutes registry tests.
//
// Verifies the conditional registration semantics for the litellm-backed
// routes (transcribe in Plan 04, reason/diarization/realtime arriving in
// Plans 05/06/07). When `deps.litellm` is omitted, the transcribe route
// is NOT registered — operators get a canonical 404 envelope on
// /api/transcribe via the centralized notFoundHandler. When `deps.litellm`
// is present, the transcribe route appears in the plugin array.

import type { LitellmClient } from "@openwhispr/litellm-client";
import { describe, expect, it } from "vitest";
import { type AllRoutesDeps, buildAllRoutes } from "../../../src/routes/index.js";

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
    // Stub Better Auth's universal handler so buildBetterAuthHandlerRoutes
    // accepts the instance under test.
    handler: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  } as unknown as AllRoutesDeps["auth"];
}

describe("buildAllRoutes — Phase 03 conditional registration", () => {
  it("does NOT register the transcribe plugin when deps.litellm is omitted", () => {
    const routes = buildAllRoutes({ db: fakeDb(), auth: fakeAuth() });
    // Plugin functions are anonymous; we count the array length under
    // the documented baseline (Phase 02 wired 7 mainline + optional
    // test-only). This test asserts no extra plugin appears WITHOUT
    // litellm.
    const baselineCount = routes.length;
    expect(baselineCount).toBeGreaterThanOrEqual(7);
    // Now add litellm — count must increase by exactly 3 (transcribe +
    // reason + agent/stream register together when the shared LiteLLM
    // client is constructed at boot). agent/stream landed in Phase 04
    // Plan 06 alongside the three Phase-4 token routes (which register
    // unconditionally and are already in the baseline).
    const withLitellm = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    expect(withLitellm.length).toBe(baselineCount + 3);
  });

  it("registers the transcribe + reason plugins when deps.litellm is provided", () => {
    const routes = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    expect(routes.length).toBeGreaterThanOrEqual(9);
  });

  it("registers reason plugin alongside transcribe — both routes reachable", async () => {
    const Fastify = (await import("fastify")).default;
    const { registerErrorHandler } = await import("../../../src/error-handler");
    const { zodTypeProvider } = await import("../../../src/plugins/zod-type-provider");
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      req.user = {
        id: "11111111-1111-1111-1111-111111111111",
        email: "x@y.test",
      };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    const routes = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    for (const plugin of routes) {
      await app.register(plugin);
    }
    await app.ready();
    // Both LiteLLM-backed routes appear in the route tree.
    const tree = app.printRoutes({ commonPrefix: false });
    expect(tree).toMatch(/\/api\/transcribe/);
    expect(tree).toMatch(/\/api\/reason/);
    await app.close();
  });

  it("does NOT register the realtime plugin when deps.litellmMasterKey is absent (Plan 07)", () => {
    // Both `litellm` and `litellmMasterKey` are required for the WSS
    // /v1/realtime reverse-proxy mount. With litellm but no master key
    // the route is NOT pushed — operators get a 404 on /v1/realtime via
    // the canonical notFoundHandler, which is the right "you forgot to
    // wire LITELLM_MASTER_KEY" signal (distinct from a 503 on a
    // registered-but-dead route).
    const litellmOnly = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    const both = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
      litellmMasterKey: "sk-litellm-master-test-only",
    });
    expect(both.length).toBe(litellmOnly.length + 1);
  });

  it("registers /v1/realtime in the route tree when litellm + litellmMasterKey are both provided (Plan 07)", async () => {
    const Fastify = (await import("fastify")).default;
    const { registerErrorHandler } = await import("../../../src/error-handler");
    const { zodTypeProvider } = await import("../../../src/plugins/zod-type-provider");
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(zodTypeProvider);
    app.addHook("onRequest", async (req) => {
      req.user = {
        id: "11111111-1111-1111-1111-111111111111",
        email: "x@y.test",
      };
      req.tenant = "00000000-0000-0000-0000-000000000000";
    });
    const routes = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
      litellmMasterKey: "sk-litellm-master-test-only",
    });
    for (const plugin of routes) {
      await app.register(plugin);
    }
    await app.ready();
    const tree = app.printRoutes({ commonPrefix: false });
    expect(tree).toContain("/v1/realtime");
    await app.close();
  });

  it("returns plugin functions (not promises) — Fastify register signature", () => {
    const routes = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    for (const plugin of routes) {
      expect(typeof plugin).toBe("function");
    }
  });

  // ----- Stage B back-fill — close residual gaps to 90/90/90/90 -----------

  it("registers the test-only plugin when deps.testOnly === true even with NODE_ENV unset", async () => {
    // Pins line 184 if idx 1 — the explicit testOnly opt-in branch.
    // Save NODE_ENV state and set it to a non-test value so the
    // OR-fallthrough doesn't accidentally pass.
    const prevNodeEnv = process.env.NODE_ENV;
    const prevOpenwhispr = process.env.OPENWHISPR_TEST_ROUTES;
    process.env.NODE_ENV = "production";
    delete process.env.OPENWHISPR_TEST_ROUTES;
    try {
      const withTestOnly = buildAllRoutes({
        db: fakeDb(),
        auth: fakeAuth(),
        testOnly: true,
      });
      const withoutTestOnly = buildAllRoutes({
        db: fakeDb(),
        auth: fakeAuth(),
        testOnly: false,
      });
      // Plan 04+ baseline plugins are registered regardless; the diff
      // between the two arrays is exactly the test-only plugin.
      expect(withTestOnly.length).toBe(withoutTestOnly.length + 1);
    } finally {
      if (prevNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
      if (prevOpenwhispr !== undefined) {
        process.env.OPENWHISPR_TEST_ROUTES = prevOpenwhispr;
      }
    }
  });
});
