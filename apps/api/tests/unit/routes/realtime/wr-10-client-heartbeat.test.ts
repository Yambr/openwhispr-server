// SPDX-License-Identifier: FSL-1.1-ALv2
// WR-10 — the relay must detect a client that died WITHOUT a FIN/RST and
// tear the upstream leg down, so the upstream session slot is released.
//
// FIELD INCIDENT (2026-08, corporate deployment): realtime meeting
// transcription stopped working with "All 8 session slots are in use" on
// the upstream ASR stand. Root cause was NOT the stand — it drains a slot
// 30s after a peer dies. The leak was HERE:
//
//   1. The desktop client dies silently — VPN drop, laptop sleep. The TCP
//      connection `client -> api` stays ESTABLISHED; no FIN, no RST.
//   2. `clientSocket.on("close")` therefore NEVER fires, so `closeBoth()`
//      is never called and the relay keeps its upstream leg open.
//   3. Both `ws` (here) and the upstream's own WS library answer ping
//      frames AUTOMATICALLY, below the application. The stand's keepalive
//      (uvicorn ws_ping_interval=20/ws_ping_timeout=20) therefore sees a
//      healthy peer — us — while the real client is long gone.
//   4. The slot stays held until the edge proxy's read timeout (1h).
//
// The relay is the only party that can tell a frozen client from a quiet
// one, so the relay must run its OWN ping/pong heartbeat on the client
// leg. `ws.pause()` below is an exact emulation of the field failure: the
// receiver stops processing frames, so ping frames are never answered,
// while the socket itself stays open at the TCP level.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { bridgeRealtimeSockets } from "../../../../src/routes/realtime.js";

// R31 DEFECT 6 — the transcription config the relay injects on upstream
// open. Irrelevant to the heartbeat contract, but `bridgeRealtimeSockets`
// requires it.
const TEST_TRANSCRIPTION = {
  model: "gpt-4o-transcribe",
  inputAudioRate: 24_000,
  vadThreshold: 0.6,
  vadSilenceMs: 600,
  vadPrefixPaddingMs: 500,
} as const;

// Short enough to keep the suite fast, long enough to survive CI jitter.
const HEARTBEAT = { intervalMs: 60, timeoutMs: 60 } as const;

interface Harness {
  url: string;
  wss: WebSocketServer;
  server: Server;
}

const openHarnesses: Harness[] = [];
const openSockets: WebSocket[] = [];

async function startWsServer(): Promise<Harness> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const harness: Harness = { url: `ws://127.0.0.1:${port}`, wss, server };
  openHarnesses.push(harness);
  return harness;
}

function track<T extends WebSocket>(socket: T): T {
  openSockets.push(socket);
  return socket;
}

async function once(emitter: WebSocket, event: string): Promise<void> {
  await new Promise<void>((resolve) => emitter.once(event, () => resolve()));
}

/** Reject instead of hanging, so a missing heartbeat fails loudly. */
async function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Stand up the full relay socket pair:
 *   desktop  ──ws──>  [edge server]        = the relay's CLIENT leg
 *   relay    ──ws──>  [upstream server]    = the relay's UPSTREAM leg
 * and bridge the two inner sockets exactly as the route does.
 */
async function bridgeUnderTest(heartbeat?: { intervalMs: number; timeoutMs: number }): Promise<{
  desktop: WebSocket;
  clientSocket: WebSocket;
  upstreamSocket: WebSocket;
  upstreamServerSide: WebSocket;
}> {
  const edge = await startWsServer();
  const upstream = await startWsServer();

  const clientSocketReady = new Promise<WebSocket>((resolve) =>
    edge.wss.once("connection", (socket) => resolve(socket)),
  );
  const upstreamServerSideReady = new Promise<WebSocket>((resolve) =>
    upstream.wss.once("connection", (socket) => resolve(socket)),
  );

  const desktop = track(new WebSocket(edge.url));
  await once(desktop, "open");
  const clientSocket = track(await clientSocketReady);

  const upstreamSocket = track(new WebSocket(upstream.url));
  const upstreamServerSide = track(await upstreamServerSideReady);
  await once(upstreamSocket, "open");

  bridgeRealtimeSockets(
    clientSocket,
    upstreamSocket,
    TEST_TRANSCRIPTION,
    undefined,
    undefined,
    heartbeat,
  );

  return { desktop, clientSocket, upstreamSocket, upstreamServerSide };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of openSockets.splice(0)) {
    try {
      socket.terminate();
    } catch {
      /* already gone */
    }
  }
  for (const harness of openHarnesses.splice(0)) {
    await new Promise<void>((resolve) => {
      harness.wss.close(() => harness.server.close(() => resolve()));
    });
  }
});

describe("realtime — WR-10 client-leg heartbeat releases the upstream slot", () => {
  it("WR-10: a frozen client (answers no pong) makes the relay tear down the upstream leg", async () => {
    const { desktop, upstreamServerSide } = await bridgeUnderTest(HEARTBEAT);

    const upstreamClosed = new Promise<void>((resolve) =>
      upstreamServerSide.once("close", () => resolve()),
    );

    // The field failure: the socket stays open at the TCP level, but the
    // peer stops processing frames, so ping is never answered.
    desktop.pause();

    await expect(
      withDeadline(upstreamClosed, 3_000, "the relay to close the upstream leg"),
    ).resolves.toBeUndefined();
  });

  it("WR-10: a healthy client survives several heartbeat intervals", async () => {
    const { upstreamServerSide } = await bridgeUnderTest(HEARTBEAT);

    let closedEarly = false;
    upstreamServerSide.once("close", () => {
      closedEarly = true;
    });

    // `ws` answers ping automatically, so a live client stays live.
    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT.intervalMs * 6));

    expect(closedEarly).toBe(false);
    expect(upstreamServerSide.readyState).toBe(WebSocket.OPEN);
  });

  it("WR-10: the heartbeat timer is cleared when the sockets go away", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const { desktop, upstreamServerSide } = await bridgeUnderTest(HEARTBEAT);

    const timerId = setSpy.mock.results.at(-1)?.value;
    expect(timerId, "the relay must arm a heartbeat interval").toBeDefined();

    const upstreamClosed = new Promise<void>((resolve) =>
      upstreamServerSide.once("close", () => resolve()),
    );
    desktop.close(1000, "done");
    await withDeadline(upstreamClosed, 3_000, "the upstream leg to close");

    // A timer outliving its sockets is itself a leak.
    expect(clearSpy).toHaveBeenCalledWith(timerId);
  });
});
