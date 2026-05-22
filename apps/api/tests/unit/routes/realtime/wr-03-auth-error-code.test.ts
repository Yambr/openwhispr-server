// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 65 / Plan 65-01 — WR-03 + WR-09 regression tests for realtime.ts.
//
// WR-03 — realtime.ts must throw the two-arg `AuthError("UNAUTHORIZED", ...)`
// form so `code === "UNAUTHORIZED"`, matching every other route in scope.
// The legacy single-arg form yields `code="AUTH_ERROR"`, which mis-keys the
// centralized handler's i18n lookup (`errors.<code>`) and breaks client
// switch-on-code.
//
// The 401 wire envelope is `{error:<string>}` — the `code` drives i18n
// localization, not a wire field. The test decorates `req.i18n` with a fake
// translator that maps `errors.UNAUTHORIZED` vs `errors.AUTH_ERROR` to
// distinct strings, so the emitted `error` reflects which code was thrown.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { buildRealtimeRoutes } from "../../../../src/routes/realtime.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";
const TEST_MASTER_KEY = "sk-litellm-master-test-only";

// Fake i18n: maps `errors.<CODE>` to a distinctive string so the wire
// `error` field reveals which AuthError code reached the handler.
function fakeI18n() {
  return {
    t(key: string, opts?: { defaultValue?: string }) {
      if (key === "errors.UNAUTHORIZED") return "I18N_UNAUTHORIZED";
      if (key === "errors.AUTH_ERROR") return "I18N_AUTH_ERROR";
      return opts?.defaultValue ?? key;
    },
  };
}

async function startUpstream(): Promise<{ url: string; close: () => Promise<void> }> {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  await new Promise<void>((res) => {
    http.listen(0, "127.0.0.1", () => res());
  });
  const port = (http.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((res) => wss.close(() => res()));
      await new Promise<void>((res) => http.close(() => res()));
    },
  };
}

async function buildApp(opts: { upstream: string; authed?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { i18n: ReturnType<typeof fakeI18n> }).i18n = fakeI18n();
    if (opts.authed !== false) {
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: TEST_USER,
        email: "fixture@conformance.test",
      };
      (req as unknown as { tenant: string }).tenant = TEST_TENANT;
    }
  });
  const litellm = { baseUrl: opts.upstream } as unknown as LitellmClient;
  await app.register(
    buildRealtimeRoutes({
      litellm,
      masterKey: TEST_MASTER_KEY,
      realtimeModel: "realtime-default",
      backend: "litellm",
      openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
      transcription: {
        model: "gpt-4o-transcribe-diarize",
        inputAudioRate: 24_000,
        vadThreshold: 0.6,
        vadSilenceMs: 600,
        vadPrefixPaddingMs: 500,
      },
    }),
  );
  await app.ready();
  return app;
}

describe("realtime — WR-03 canonical AuthError code", () => {
  let app: FastifyInstance | undefined;
  let upstream: { url: string; close: () => Promise<void> } | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (upstream) {
      await upstream.close();
      upstream = undefined;
    }
  });

  it("WR-03: unauthenticated WS upgrade emits the UNAUTHORIZED code (not AUTH_ERROR)", async () => {
    upstream = await startUpstream();
    app = await buildApp({ upstream: upstream.url, authed: false });
    const res = await app.inject({
      method: "GET",
      url: "/v1/realtime",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    expect(res.statusCode).toBe(401);
    const json = res.json() as { error: string };
    // The fake i18n resolves `errors.UNAUTHORIZED` → "I18N_UNAUTHORIZED".
    // Pre-fix the single-arg form keyed `errors.AUTH_ERROR`.
    expect(json.error).toBe("I18N_UNAUTHORIZED");
  });
});
