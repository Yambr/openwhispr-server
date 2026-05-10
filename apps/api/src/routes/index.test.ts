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
import { buildAllRoutes, type AllRoutesDeps } from "./index.js";

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
    async transaction<T>(cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>): Promise<T> {
      return cb({ async execute() { return { rows: [] }; } });
    },
  };
}

function fakeAuth(): AllRoutesDeps["auth"] {
  return {
    api: { getSession: async () => null },
  };
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
    // Now add litellm — count must increase by exactly 1.
    const withLitellm = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    expect(withLitellm.length).toBe(baselineCount + 1);
  });

  it("registers the transcribe plugin when deps.litellm is provided", () => {
    const routes = buildAllRoutes({
      db: fakeDb(),
      auth: fakeAuth(),
      litellm: fakeLitellm(),
    });
    expect(routes.length).toBeGreaterThanOrEqual(8);
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
});
