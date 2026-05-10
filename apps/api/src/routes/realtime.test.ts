// Phase 03 / Plan 07 / Task 1 — WSS /v1/realtime route tests.
//
// Strategy:
//   * Spin up a real `ws.WebSocketServer` on an ephemeral localhost port
//     to act as a fake LiteLLM upstream. This lets us assert exactly
//     what headers + URL the proxy forwards on the upgrade — the only
//     reliable way to verify rewriteRequestHeaders without mocking
//     @fastify/http-proxy itself (CLAUDE.md: no mocks of the proxy lib).
//   * The Fastify app under test is built via the same handcrafted
//     buildApp pattern used by reason.test.ts / transcribe.test.ts: a
//     bare Fastify instance + registerErrorHandler + an onRequest hook
//     that synthesizes `req.user` so the dual-auth path is satisfied
//     without dragging Better Auth into the test.
//   * Auth-fail test uses `app.inject` because Fastify v5 fires the
//     onRequest → preHandler chain on inject() too — preHandler throws
//     AuthError → centralized handler emits the canonical 401 envelope
//     BEFORE any upgrade attempt is made.

import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import type { LitellmClient } from "@openwhispr/litellm-client";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { registerErrorHandler } from "../error-handler.js";
import {
  buildRealtimeRoutes,
  buildRewriteRequestHeaders,
  httpToWsScheme,
} from "./realtime.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000000";
const TEST_USER = "11111111-1111-1111-1111-111111111111";
const TEST_MASTER_KEY = "sk-litellm-master-test-only";

interface UpstreamCapture {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Stand up a real ws upstream on a random localhost port. The returned
 * promise resolves once the server is listening; the `capture` ref is
 * mutated on the first upgrade. `close()` shuts the upstream down so
 * Fastify can flush its outbound socket and the test exits cleanly.
 */
async function startUpstream(): Promise<{
  url: string;
  close: () => Promise<void>;
  capture: UpstreamCapture;
  // Resolves when the upstream has accepted an upgrade and captured headers/url.
  upgraded: Promise<void>;
}> {
  const capture: UpstreamCapture = {};
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
    // Echo any frame so the client can confirm the channel is live.
    socket.on("message", (data: RawData) => {
      socket.send(data);
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
  return { url: `http://127.0.0.1:${port}`, close, capture, upgraded };
}

/**
 * Build a Fastify app with the realtime route mounted, an onRequest
 * hook that populates req.user / req.tenant when `authed` is true,
 * and the centralized error handler so AuthError → 401 envelope.
 */
async function buildApp(opts: {
  upstream: string;
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
      (req as unknown as { tenant: string }).tenant = TEST_TENANT;
    });
  }
  // Stub LitellmClient — we only consume `baseUrl` in the realtime route.
  const litellm = {
    baseUrl: opts.upstream,
  } as unknown as LitellmClient;
  await app.register(
    buildRealtimeRoutes({ litellm, masterKey: TEST_MASTER_KEY }),
  );
  await app.ready();
  return app;
}

describe("httpToWsScheme — WR-03 case-insensitive scheme conversion", () => {
  it("converts http:// to ws://", () => {
    expect(httpToWsScheme("http://litellm:4000")).toBe("ws://litellm:4000");
  });
  it("converts https:// to wss://", () => {
    expect(httpToWsScheme("https://litellm.example.com:4000")).toBe(
      "wss://litellm.example.com:4000",
    );
  });
  it("normalizes uppercase HTTPS:// to wss:// (regression test for sloppy $1 capture)", () => {
    // Pre-fix: `replace(/^http(s?):/i, "ws$1:")` produced "wsS://" because
    // the $1 capture preserved the uppercase S. The new implementation
    // writes the literal replacement string and yields a clean "wss://".
    expect(httpToWsScheme("HTTPS://litellm:4000")).toBe("wss://litellm:4000");
  });
  it("normalizes uppercase HTTP:// to ws://", () => {
    expect(httpToWsScheme("HTTP://litellm:4000")).toBe("ws://litellm:4000");
  });
  it("normalizes mixed-case Https:// to wss://", () => {
    expect(httpToWsScheme("Https://litellm:4000")).toBe("wss://litellm:4000");
  });
});

describe("WSS /v1/realtime route — D-27 wsClientOptions tightening (Phase 04 Plan 07)", () => {
  // These tests assert the @fastify/http-proxy register call options
  // match D-27 (handshakeTimeout 10000ms, wsReconnect false) by
  // intercepting the register invocation via a Fastify decorator
  // wrapper. Direct option introspection is the only way to verify
  // these are applied — they affect failure-mode behavior that is
  // expensive and flaky to elicit at runtime in unit tests.

  // Capture register options for the http-proxy plugin using a
  // module-level spy installed via Fastify's onRoute hook + a small
  // adapter app that records the options object.
  it("registers @fastify/http-proxy with wsClientOptions.handshakeTimeout=10000 (D-27)", async () => {
    // Read the buildRealtimeRoutes source via dynamic introspection: the
    // returned plugin calls app.register(fastifyHttpProxy, opts). We
    // wrap fastify.register to capture opts.
    const upstream = await startUpstream();
    try {
      const app = Fastify({ logger: false });
      registerErrorHandler(app);
      const captured: Array<Record<string, unknown>> = [];
      const origRegister = app.register.bind(app);
      // @ts-expect-error — runtime monkey-patch for test introspection.
      app.register = (plugin: unknown, opts?: Record<string, unknown>) => {
        if (opts && typeof opts === "object") captured.push(opts);
        return origRegister(plugin as never, opts as never);
      };
      const litellm = { baseUrl: upstream.url } as unknown as LitellmClient;
      await app.register(
        buildRealtimeRoutes({ litellm, masterKey: TEST_MASTER_KEY }),
      );
      await app.ready();
      // Find the http-proxy register call (the one with `wsUpstream`).
      const proxyOpts = captured.find(
        (o) => typeof o.wsUpstream === "string",
      );
      expect(proxyOpts).toBeDefined();
      expect(proxyOpts).toHaveProperty("wsClientOptions");
      const wsClientOptions = proxyOpts!.wsClientOptions as Record<
        string,
        unknown
      >;
      expect(wsClientOptions.handshakeTimeout).toBe(10000);
      await app.close();
    } finally {
      await upstream.close();
    }
  });

  it("registers @fastify/http-proxy with wsReconnect=false (D-27 — let client handle reconnect)", async () => {
    const upstream = await startUpstream();
    try {
      const app = Fastify({ logger: false });
      registerErrorHandler(app);
      const captured: Array<Record<string, unknown>> = [];
      const origRegister = app.register.bind(app);
      // @ts-expect-error — runtime monkey-patch for test introspection.
      app.register = (plugin: unknown, opts?: Record<string, unknown>) => {
        if (opts && typeof opts === "object") captured.push(opts);
        return origRegister(plugin as never, opts as never);
      };
      const litellm = { baseUrl: upstream.url } as unknown as LitellmClient;
      await app.register(
        buildRealtimeRoutes({ litellm, masterKey: TEST_MASTER_KEY }),
      );
      await app.ready();
      const proxyOpts = captured.find(
        (o) => typeof o.wsUpstream === "string",
      );
      expect(proxyOpts).toBeDefined();
      // wsReconnect MUST be explicitly false at the top level of the
      // register options (sibling of wsClientOptions, NOT nested inside
      // it — per @fastify/http-proxy v11 API).
      expect(proxyOpts).toHaveProperty("wsReconnect", false);
      await app.close();
    } finally {
      await upstream.close();
    }
  });
});

describe("WSS /v1/realtime route", () => {
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

  it("registers /v1/realtime when LitellmClient + masterKey are supplied", async () => {
    upstream = await startUpstream();
    app = await buildApp({ upstream: upstream.url });
    const tree = app.printRoutes({ commonPrefix: false });
    // @fastify/http-proxy mounts an HTTP-side route at the prefix in
    // addition to the WS upgrade handler — the printed tree includes it.
    expect(tree).toContain("/v1/realtime");
  });

  it("rejects WS upgrade with 401 envelope when no req.user (auth fail)", async () => {
    upstream = await startUpstream();
    app = await buildApp({ upstream: upstream.url, authed: false });
    // Fastify's inject() fires the onRequest → preHandler chain. The
    // realtime preHandler throws AuthError when req.user is absent;
    // the centralized error handler emits the canonical 401 envelope.
    const res = await app.inject({
      method: "GET",
      url: "/v1/realtime",
      headers: {
        // Headers that would normally accompany a WS upgrade — included
        // so the proxy doesn't short-circuit on the HTTP-only path.
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    expect(res.statusCode).toBe(401);
    const json = res.json();
    expect(json).toMatchObject({ error: expect.any(String) });
    // Master-key shape MUST NOT leak into a 401 response (T-03-07-01).
    expect(JSON.stringify(json)).not.toContain("sk-litellm-master");
  });

  it("forwards WS upgrade to upstream with master-key + spend-logs headers and ?user=<userId> on the URL", async () => {
    upstream = await startUpstream();
    app = await buildApp({ upstream: upstream.url });
    // Listen on an ephemeral port so the WS client can dial us.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const proxyAddr = app.server.address() as AddressInfo;
    const wsUrl = `ws://127.0.0.1:${proxyAddr.port}/v1/realtime`;

    // Send a desktop-shaped bearer that MUST NOT reach the upstream.
    const desktopBearer = "Bearer opaque-desktop-token";
    const ws = new WebSocket(wsUrl, {
      headers: { authorization: desktopBearer },
    });
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", (err) => rej(err));
    });
    await upstream.upgraded;

    // 1. Master key replaced the desktop bearer (T-03-07-01 mitigation).
    const auth = upstream.capture.headers?.authorization;
    expect(auth).toBe(`Bearer ${TEST_MASTER_KEY}`);
    expect(auth).not.toBe(desktopBearer);

    // 2. Spend-logs metadata header carries openwhispr_request_id +
    //    openwhispr_user_id (D-03 attribution / OBS-04 correlation).
    const meta = upstream.capture.headers?.["x-litellm-spend-logs-metadata"];
    expect(typeof meta).toBe("string");
    const parsed = JSON.parse(meta as string);
    expect(parsed.openwhispr_user_id).toBe(TEST_USER);
    expect(typeof parsed.openwhispr_request_id).toBe("string");
    expect(parsed.openwhispr_request_id.length).toBeGreaterThan(0);

    // 3. ?user=<userId> appended to the upstream URL (LITELLM-04 / D-03).
    expect(upstream.capture.url).toBeDefined();
    const upstreamUrl = new URL(
      upstream.capture.url ?? "",
      "http://internal",
    );
    expect(upstreamUrl.pathname).toBe("/v1/realtime");
    expect(upstreamUrl.searchParams.get("user")).toBe(TEST_USER);

    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("overwrites a caller-supplied ?user= query with the authenticated user id (T-03-07-04 mitigation)", async () => {
    upstream = await startUpstream();
    app = await buildApp({ upstream: upstream.url });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const proxyAddr = app.server.address() as AddressInfo;
    // The desktop sends `?user=attacker` — the preHandler MUST replace it.
    const wsUrl = `ws://127.0.0.1:${proxyAddr.port}/v1/realtime?user=attacker-id&intent=transcription`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", (err) => rej(err));
    });
    await upstream.upgraded;
    const upstreamUrl = new URL(
      upstream.capture.url ?? "",
      "http://internal",
    );
    expect(upstreamUrl.searchParams.get("user")).toBe(TEST_USER);
    // Other query params (e.g. ?intent=transcription) are preserved.
    expect(upstreamUrl.searchParams.get("intent")).toBe("transcription");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  // ----- Stage B back-fill — close residual branch gaps to 90/90/90/90 ----

  it("buildRewriteRequestHeaders falls back to user='anonymous' when user.id is missing (line 115 idx 1)", () => {
    // Direct unit test on the exported closure factory.
    const rh = buildRewriteRequestHeaders(TEST_MASTER_KEY);
    // Case A: user is undefined.
    const out1 = rh({ authorization: "Bearer client" }, { id: "req-1" });
    expect(JSON.parse(out1["x-litellm-spend-logs-metadata"]!).openwhispr_user_id).toBe(
      "anonymous",
    );
    // Case B: user object present but id missing.
    const out2 = rh({}, { id: "req-2", user: {} });
    expect(JSON.parse(out2["x-litellm-spend-logs-metadata"]!).openwhispr_user_id).toBe(
      "anonymous",
    );
    // Sanity: when user.id is set, it's used verbatim.
    const out3 = rh({}, { id: "req-3", user: { id: "real-user" } });
    expect(JSON.parse(out3["x-litellm-spend-logs-metadata"]!).openwhispr_user_id).toBe(
      "real-user",
    );
    // Master key always swapped in; inbound bearer always stripped.
    expect(out1.authorization).toBe(`Bearer ${TEST_MASTER_KEY}`);
    expect(out1.authorization).not.toBe("Bearer client");
  });

  it("buildRewriteRequestHeaders strips both 'authorization' and 'Authorization' casings", () => {
    const rh = buildRewriteRequestHeaders(TEST_MASTER_KEY);
    const out = rh(
      {
        authorization: "Bearer lower",
        // @ts-expect-error — legacy mixed-case casing intentionally provided.
        Authorization: "Bearer upper",
      },
      { id: "r" },
    );
    // Final authorization is the master-key bearer (we set last).
    expect(out.authorization).toBe(`Bearer ${TEST_MASTER_KEY}`);
    // No stale upper-case Authorization left behind.
    expect((out as Record<string, unknown>).Authorization).toBeUndefined();
  });

  it("preHandler tolerates a missing req.raw.url (line 145 fallback to req.url)", async () => {
    // Pin line 145 binary-expr idx 1. Drive the preHandler directly with
    // a stub request whose `raw.url` is undefined; it must read from
    // `req.url` instead. We import the route builder and access its
    // preHandler via the registered route's options object.
    upstream = await startUpstream();
    app = await buildApp({ upstream: upstream.url });

    // Find the registered route and pluck its preHandler.
    let capturedPreHandler:
      | ((req: unknown, reply: unknown) => Promise<void>)
      | undefined;
    type RouteOpts = {
      url?: string;
      preHandler?: (req: unknown, reply: unknown) => Promise<void>;
    };
    // Fastify v5 exposes routes via printRoutes; intercept registration
    // via app.addHook('onRoute', ...).
    const localApp = Fastify({ logger: false });
    registerErrorHandler(localApp);
    localApp.addHook("onRequest", async (req) => {
      (req as unknown as { user: { id: string } }).user = { id: TEST_USER };
    });
    localApp.addHook("onRoute", (route: RouteOpts) => {
      if (route.url === "/v1/realtime" && route.preHandler) {
        capturedPreHandler = route.preHandler;
      }
    });
    const litellm = { baseUrl: upstream.url } as unknown as LitellmClient;
    await localApp.register(
      buildRealtimeRoutes({ litellm, masterKey: TEST_MASTER_KEY }),
    );
    await localApp.ready();
    expect(capturedPreHandler).toBeDefined();

    // Synthesize a Fastify-shaped request: raw.url undefined, req.url set.
    const fakeReq = {
      user: { id: TEST_USER },
      raw: { url: undefined },
      url: "/v1/realtime?intent=hello",
    };
    await capturedPreHandler!(fakeReq, {});
    // After preHandler the raw.url MUST be rewritten with ?user=...
    expect((fakeReq.raw as { url?: string }).url).toBeDefined();
    const u = new URL(
      (fakeReq.raw as { url: string }).url,
      "http://internal",
    );
    expect(u.searchParams.get("user")).toBe(TEST_USER);
    expect(u.searchParams.get("intent")).toBe("hello");
    await localApp.close();
  });

  it("derives the upstream ws:// URL from litellm.baseUrl (http→ws scheme swap)", async () => {
    // Indirect assertion via behavioral observation: if the scheme swap
    // were broken (e.g. left as http://), @fastify/http-proxy would emit
    // a non-WS-protocol error during register or upgrade. We assert the
    // upgrade succeeds against an `http://` baseUrl, proving the derived
    // `ws://` upstream URL is what the proxy used.
    upstream = await startUpstream();
    expect(upstream.url.startsWith("http://")).toBe(true);
    app = await buildApp({ upstream: upstream.url });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const proxyAddr = app.server.address() as AddressInfo;
    const ws = new WebSocket(
      `ws://127.0.0.1:${proxyAddr.port}/v1/realtime`,
    );
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", (err) => rej(err));
    });
    await upstream.upgraded;
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });
});
