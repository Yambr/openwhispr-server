// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 07 — WSS /v1/realtime route tests.
// R31 — rewritten for the frame-aware relay (replaced the
// @fastify/http-proxy passthrough). Covers BOTH backend modes.
//
// Strategy:
//   * A real `ws.WebSocketServer` on an ephemeral localhost port stands
//     in for the upstream (LiteLLM in `litellm` mode, OpenAI in `direct`
//     mode). It captures the upgrade URL + headers so we can assert
//     exactly what the relay forwarded — the only reliable way to verify
//     the GA-shape contract (no ?intent=, no OpenAI-Beta header).
//   * The Fastify app under test mounts the realtime route with an
//     onRequest hook that synthesizes `req.user` so the dual-auth path is
//     satisfied without dragging Better Auth into the test.
//   * Auth-fail test uses `app.inject` — Fastify fires onRequest →
//     preValidation on inject(), so AuthError → canonical 401 envelope
//     BEFORE any upgrade is attempted.

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { registerErrorHandler } from "../../../src/error-handler.js";
import {
  buildRealtimeRoutes,
  buildUpstreamHeaders,
  buildUpstreamUrl,
  httpToWsScheme,
  type RealtimeDeps,
} from "../../../src/routes/realtime.js";

const TEST_USER = "11111111-1111-1111-1111-111111111111";
const TEST_MASTER_KEY = "sk-litellm-master-test-only";
const TEST_REALTIME_MODEL = "realtime-default";

interface UpstreamCapture {
  url?: string;
  headers?: IncomingMessage["headers"];
}

/**
 * Stand up a real ws upstream on a random localhost port. It captures the
 * first upgrade's URL + headers and, on connection, sends a GA
 * `session.created` frame and echoes every `transcription_session.update`
 * it receives as a GA `session.updated`.
 */
async function startUpstream(): Promise<{
  httpUrl: string;
  close: () => Promise<void>;
  capture: UpstreamCapture;
  upgraded: Promise<void>;
  /** Frames the upstream received from the relay (parsed JSON). */
  received: Array<Record<string, unknown>>;
}> {
  const capture: UpstreamCapture = {};
  const received: Array<Record<string, unknown>> = [];
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  let resolveUpgraded!: () => void;
  const upgraded = new Promise<void>((res) => {
    resolveUpgraded = res;
  });
  wss.on("connection", (socket, request) => {
    capture.url = request.url;
    capture.headers = request.headers;
    resolveUpgraded();
    socket.send(JSON.stringify({ type: "session.created", session: { id: "sess_test" } }));
    socket.on("message", (data: RawData) => {
      try {
        received.push(JSON.parse(data.toString()));
      } catch {
        /* ignore non-JSON */
      }
    });
  });
  await new Promise<void>((res) => {
    http.listen(0, "127.0.0.1", () => res());
  });
  const port = (http.address() as AddressInfo).port;
  const close = async () => {
    await new Promise<void>((res) => wss.close(() => res()));
    await new Promise<void>((res) => http.close(() => res()));
  };
  return { httpUrl: `http://127.0.0.1:${port}`, close, capture, upgraded, received };
}

/** Build a Fastify app with the realtime relay mounted. */
async function buildApp(opts: {
  deps: Partial<RealtimeDeps> & { litellm: LitellmClient };
  authed?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  if (opts.authed !== false) {
    app.addHook("onRequest", async (req) => {
      (req as unknown as { user: { id: string; email: string } }).user = {
        id: TEST_USER,
        email: "fixture@conformance.test",
      };
    });
  }
  const deps: RealtimeDeps = {
    masterKey: TEST_MASTER_KEY,
    realtimeModel: TEST_REALTIME_MODEL,
    backend: "litellm",
    openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
    ...opts.deps,
  };
  await app.register(buildRealtimeRoutes(deps));
  await app.ready();
  return app;
}

/** Open a WS to the relay and wait for `open`. */
function dial(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = headers ? new WebSocket(url, { headers }) : new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", (err) => reject(err));
  });
}

describe("httpToWsScheme — case-insensitive scheme conversion", () => {
  it("converts http:// to ws://", () => {
    expect(httpToWsScheme("http://litellm:4000")).toBe("ws://litellm:4000");
  });
  it("converts https:// to wss://", () => {
    expect(httpToWsScheme("https://litellm.example.com:4000")).toBe(
      "wss://litellm.example.com:4000",
    );
  });
  it("normalizes uppercase HTTPS:// to wss://", () => {
    expect(httpToWsScheme("HTTPS://litellm:4000")).toBe("wss://litellm:4000");
  });
});

describe("buildUpstreamUrl — DEFECT 1 (?intent strip) + ?model/?user injection", () => {
  const litellmDeps: RealtimeDeps = {
    litellm: { baseUrl: "http://litellm:4000" } as unknown as LitellmClient,
    masterKey: TEST_MASTER_KEY,
    realtimeModel: TEST_REALTIME_MODEL,
    backend: "litellm",
    openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
  };

  it("litellm mode: strips ?intent=, forces ?model and ?user", () => {
    const out = buildUpstreamUrl(litellmDeps, "/v1/realtime?intent=transcription", TEST_USER);
    const u = new URL(out);
    expect(u.protocol).toBe("ws:");
    expect(u.searchParams.get("intent")).toBeNull();
    expect(u.searchParams.get("model")).toBe(TEST_REALTIME_MODEL);
    expect(u.searchParams.get("user")).toBe(TEST_USER);
  });

  it("litellm mode: overwrites a client-supplied ?model and ?user (tamper-normalization)", () => {
    const out = buildUpstreamUrl(
      litellmDeps,
      "/v1/realtime?model=gpt-realtime&user=attacker&intent=transcription",
      TEST_USER,
    );
    const u = new URL(out);
    expect(u.searchParams.get("model")).toBe(TEST_REALTIME_MODEL);
    expect(u.searchParams.get("user")).toBe(TEST_USER);
    expect(u.searchParams.get("intent")).toBeNull();
  });

  it("direct mode: targets the configured OpenAI URL, strips ?intent, forces the OpenAI ?model, NO ?user", () => {
    const directDeps: RealtimeDeps = {
      ...litellmDeps,
      backend: "direct",
      openaiRealtimeModel: "gpt-realtime",
    };
    const out = buildUpstreamUrl(directDeps, "/v1/realtime?intent=transcription", TEST_USER);
    const u = new URL(out);
    expect(`${u.protocol}//${u.host}${u.pathname}`).toBe("wss://api.openai.com/v1/realtime");
    expect(u.searchParams.get("intent")).toBeNull();
    // OpenAI's GA /v1/realtime requires a real OpenAI model name.
    expect(u.searchParams.get("model")).toBe("gpt-realtime");
    // OpenAI has no spend-attribution param — the relay must NOT leak the
    // openwhispr user id to a third party.
    expect(u.searchParams.get("user")).toBeNull();
  });

  it("direct mode: a client-supplied ?model is never forwarded (operator-controlled)", () => {
    const directDeps: RealtimeDeps = {
      ...litellmDeps,
      backend: "direct",
      openaiRealtimeModel: "gpt-realtime",
    };
    const u = new URL(buildUpstreamUrl(directDeps, "/v1/realtime?model=attacker-model", TEST_USER));
    expect(u.searchParams.get("model")).toBe("gpt-realtime");
  });
});

describe("buildUpstreamHeaders — credential swap + NO OpenAI-Beta header", () => {
  const base: RealtimeDeps = {
    litellm: { baseUrl: "http://litellm:4000" } as unknown as LitellmClient,
    masterKey: TEST_MASTER_KEY,
    realtimeModel: TEST_REALTIME_MODEL,
    backend: "litellm",
    openaiRealtimeUrl: "wss://api.openai.com/v1/realtime",
  };

  it("litellm mode: master-key bearer + spend-logs metadata, NO OpenAI-Beta", () => {
    const h = buildUpstreamHeaders(base, TEST_USER, "req-1");
    expect(h.authorization).toBe(`Bearer ${TEST_MASTER_KEY}`);
    const meta = JSON.parse(h["x-litellm-spend-logs-metadata"]);
    expect(meta.openwhispr_user_id).toBe(TEST_USER);
    expect(meta.openwhispr_request_id).toBe("req-1");
    expect(h["openai-beta"]).toBeUndefined();
    expect(h["OpenAI-Beta"]).toBeUndefined();
  });

  it("direct mode: OpenAI api-key bearer only, NO OpenAI-Beta, NO spend-logs", () => {
    const h = buildUpstreamHeaders(
      { ...base, backend: "direct", openaiApiKey: "sk-direct" },
      TEST_USER,
      "req-2",
    );
    expect(h.authorization).toBe("Bearer sk-direct");
    expect(h["x-litellm-spend-logs-metadata"]).toBeUndefined();
    expect(h["openai-beta"]).toBeUndefined();
    expect(h["OpenAI-Beta"]).toBeUndefined();
  });
});

describe("WSS /v1/realtime route — relay behaviour", () => {
  let app: FastifyInstance | undefined;
  let upstream: Awaited<ReturnType<typeof startUpstream>> | undefined;

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

  it("registers /v1/realtime", async () => {
    upstream = await startUpstream();
    app = await buildApp({
      deps: { litellm: { baseUrl: upstream.httpUrl } as unknown as LitellmClient },
    });
    expect(app.printRoutes({ commonPrefix: false })).toContain("/v1/realtime");
  });

  it("rejects WS upgrade with 401 envelope when no req.user (auth fail)", async () => {
    upstream = await startUpstream();
    app = await buildApp({
      deps: { litellm: { baseUrl: upstream.httpUrl } as unknown as LitellmClient },
      authed: false,
    });
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
    expect(JSON.stringify(res.json())).not.toContain("sk-litellm-master");
  });

  it("litellm mode: forwards the upgrade with master-key + GA-shape URL (no ?intent), ?user injected", async () => {
    upstream = await startUpstream();
    app = await buildApp({
      deps: { litellm: { baseUrl: upstream.httpUrl } as unknown as LitellmClient },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = await dial(`ws://127.0.0.1:${port}/v1/realtime?intent=transcription`, {
      authorization: "Bearer opaque-desktop-token",
    });
    await upstream.upgraded;

    expect(upstream.capture.headers?.authorization).toBe(`Bearer ${TEST_MASTER_KEY}`);
    expect(upstream.capture.headers?.["openai-beta"]).toBeUndefined();
    const u = new URL(upstream.capture.url ?? "", "http://internal");
    expect(u.searchParams.get("intent")).toBeNull();
    expect(u.searchParams.get("user")).toBe(TEST_USER);
    expect(u.searchParams.get("model")).toBe(TEST_REALTIME_MODEL);

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("direct mode: refuses the WS upgrade when no OPENAI_API_KEY is configured", async () => {
    upstream = await startUpstream();
    app = await buildApp({
      deps: {
        litellm: { baseUrl: upstream.httpUrl } as unknown as LitellmClient,
        backend: "direct",
        // no openaiApiKey
      },
    });
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
  });

  it("translates frames bidirectionally: client Beta update -> upstream GA, upstream GA created -> client Beta", async () => {
    upstream = await startUpstream();
    app = await buildApp({
      deps: { litellm: { baseUrl: upstream.httpUrl } as unknown as LitellmClient },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const ws = await dial(`ws://127.0.0.1:${port}/v1/realtime?intent=transcription`);

    // The relay forwards the upstream's GA session.created back to the
    // client AS the Beta transcription_session.created.
    const firstFrame = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once("message", (raw: RawData) => resolve(JSON.parse(raw.toString())));
    });
    expect(firstFrame.type).toBe("transcription_session.created");

    // The client sends a Beta transcription_session.update; the upstream
    // must receive the GA session.update{ session.type: "transcription" }.
    ws.send(
      JSON.stringify({
        type: "transcription_session.update",
        session: { input_audio_format: "pcm16" },
      }),
    );
    await new Promise<void>((resolve) => {
      const check = () => {
        if (upstream?.received.some((f) => f.type === "session.update")) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
    const gaUpdate = upstream.received.find((f) => f.type === "session.update");
    expect(gaUpdate).toBeDefined();
    expect((gaUpdate?.session as Record<string, unknown>).type).toBe("transcription");
    expect((gaUpdate?.session as Record<string, unknown>).input_audio_format).toBe("pcm16");

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });
});
