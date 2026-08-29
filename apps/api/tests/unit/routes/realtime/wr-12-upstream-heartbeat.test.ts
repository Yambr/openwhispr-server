// SPDX-License-Identifier: FSL-1.1-ALv2
// WR-12 — the relay must also detect a frozen UPSTREAM, not just a frozen
// client. This is WR-10's hole on the other leg, and its symptom is worse
// because it is completely silent.
//
// WR-10 gave the relay a heartbeat on its CLIENT leg. The upstream leg
// kept nothing but `handshakeTimeout` — a ceiling on the handshake only,
// with no liveness check once the socket is open. So when the path to the
// gateway/stand dies WITHOUT a close frame (a proxy dropping the
// connection, a firewall losing state, a gateway pod evicted mid-session)
// the relay:
//
//   * never learns the upstream is gone — no close, no error, nothing to
//     react to;
//   * keeps forwarding audio into a black hole;
//   * keeps its CLIENT leg perfectly healthy, because the client really
//     is alive and answers every ping.
//
// The client cannot notice either: its own keepalive pings are answered
// by US, automatically, below the application. The user just sees the
// live transcript stop updating — no error, no close, no reconnect.
//
// A cleanly dying upstream is already handled (its close frame reaches
// `closeBoth`); this covers the case where NO frame ever arrives. The
// relay is again the only party positioned to tell a frozen upstream from
// a quiet one, so it pings the upstream itself and tears BOTH legs down
// when the pongs stop — the client then sees a definitive close and
// reconnects.
//
// `pause()` on the far end is an exact emulation: the receiver stops
// processing frames, so ping is never answered, while the socket stays
// open at the TCP level.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { bridgeRealtimeSockets } from "../../../../src/routes/realtime.js";

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
 *   desktop  ──ws──>  [edge server]      = the relay's CLIENT leg
 *   relay    ──ws──>  [upstream server]  = the relay's UPSTREAM leg
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

describe("realtime — WR-12 upstream-leg heartbeat surfaces a silently dead upstream", () => {
  it("WR-12: a frozen upstream (answers no pong) makes the relay tear the CLIENT leg down", async () => {
    const { desktop, upstreamServerSide } = await bridgeUnderTest(HEARTBEAT);

    const clientClosed = new Promise<void>((resolve) => desktop.once("close", () => resolve()));

    // The field failure: the upstream socket stays open at the TCP level,
    // but the peer stops processing frames, so ping is never answered.
    // The desktop meanwhile stays perfectly healthy — which is exactly why
    // the CLIENT-leg heartbeat cannot catch this.
    upstreamServerSide.pause();

    await expect(
      withDeadline(clientClosed, 3_000, "the relay to close the client leg"),
    ).resolves.toBeUndefined();
  });

  it("WR-12: a frozen upstream also tears the UPSTREAM leg down, releasing its session slot", async () => {
    const { upstreamSocket, upstreamServerSide } = await bridgeUnderTest(HEARTBEAT);

    upstreamServerSide.pause();

    await withDeadline(
      new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (upstreamSocket.readyState === WebSocket.CLOSED) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      }),
      3_000,
      "the relay to tear down its own upstream socket",
    );
    expect(upstreamSocket.readyState).toBe(WebSocket.CLOSED);
  });

  it("WR-12: a healthy pair survives several heartbeat intervals untouched", async () => {
    const { desktop, upstreamSocket } = await bridgeUnderTest(HEARTBEAT);

    let closed = false;
    desktop.once("close", () => {
      closed = true;
    });

    // Six intervals — long past the interval+timeout ceiling. Guards
    // against a heartbeat so aggressive it kills working sessions.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, HEARTBEAT.intervalMs * 6 + HEARTBEAT.timeoutMs),
    );

    expect(closed).toBe(false);
    expect(desktop.readyState).toBe(WebSocket.OPEN);
    expect(upstreamSocket.readyState).toBe(WebSocket.OPEN);
  });
});
