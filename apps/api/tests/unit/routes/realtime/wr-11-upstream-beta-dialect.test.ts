// SPDX-License-Identifier: FSL-1.1-ALv2
// WR-11 — the relay must normalize a BETA-speaking upstream to GA before
// the frame reaches the desktop client.
//
// FIELD INCIDENT (2026-08-29, corporate deployment): realtime meeting
// transcription never started. The desktop opened the WSS, the socket
// STAYED open (`readyState: 1`), not one server event was recognized, and
// the client rejected on its own 15s ceiling with "OpenAI Realtime
// connection timeout" — `audioBytesSent: 0, segments: 0`. The api logged
// the incoming `/v1/realtime` upgrade and then nothing at all, because
// nothing had actually failed.
//
// Measured root cause:
//   1. The relay FORCES `?intent=transcription` on the upstream URL
//      (`buildUpstreamUrl`) — required by OpenAI GA in `direct` mode.
//   2. On the corporate upstream (LiteLLM -> GigaAM realtime stand) that
//      same param switches the event vocabulary to the retired BETA one:
//      WITH it the stand answers `transcription_session.created` /
//      `transcription_session.updated`; WITHOUT it the very same stand
//      answers GA `session.created` / `session.updated` and transcribes
//      the same audio identically (verified frame-by-frame on real
//      speech).
//   3. `translateUpstreamToClient` was an IDENTITY function — written
//      when the shipping client turned out to speak GA, on the assumption
//      that the upstream is always GA too.
//   4. The shipping client speaks GA ONLY: its switch table has
//      `case "session.created"` / `case "session.updated"` and ZERO
//      references to `transcription_session.*` (14 vs 0 occurrences in
//      the packaged app.asar). A Beta name matches no branch, so the
//      connect promise is never resolved.
//
// The relay declares itself the GA contract boundary. These tests pin
// that it actually holds it — for a Beta upstream AND, unchanged, for a
// GA one.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { bridgeRealtimeSockets } from "../../../../src/routes/realtime.js";

// R31 DEFECT 6 — the transcription config the relay injects on upstream
// open. Its content is irrelevant here, but the relay needs one.
const TEST_TRANSCRIPTION = {
  model: "gpt-4o-transcribe",
  inputAudioRate: 24_000,
  vadThreshold: 0.6,
  vadSilenceMs: 600,
  vadPrefixPaddingMs: 500,
} as const;

// Far longer than any test here — the heartbeat must not interfere.
const NO_HEARTBEAT = { intervalMs: 60_000, timeoutMs: 60_000 } as const;

interface Frame {
  type: string;
  [key: string]: unknown;
}

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

/**
 * Queue-backed frame reader.
 *
 * A bare `once("message")` per await would DROP any frame that lands
 * between two awaits — and the whole point here is asserting which frames
 * do and do not arrive, in order. The collector is attached once, at
 * setup, and buffers everything.
 */
function readFrames(socket: WebSocket): { next: () => Promise<Frame> } {
  const queued: Frame[] = [];
  const waiting: Array<(frame: Frame) => void> = [];
  socket.on("message", (raw: Buffer) => {
    const frame = JSON.parse(raw.toString()) as Frame;
    const waiter = waiting.shift();
    if (waiter) waiter(frame);
    else queued.push(frame);
  });
  return {
    next: async (): Promise<Frame> => {
      const buffered = queued.shift();
      if (buffered) return buffered;
      return await new Promise<Frame>((resolve) => waiting.push(resolve));
    },
  };
}

/** Reject instead of hanging, so a swallowed frame fails loudly. */
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
 *
 * Unlike the WR-10 harness this bridges BEFORE the upstream socket opens,
 * exactly as `buildRealtimeRoutes` does (`new WebSocket(...)` immediately
 * followed by `bridgeRealtimeSockets`). That ordering is what arms the
 * relay's self-injected `session.update` and its echo-swallow flag; the
 * echo assertion below is meaningless without it.
 */
async function bridgeUnderTest(): Promise<{
  desktop: WebSocket;
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
  bridgeRealtimeSockets(
    clientSocket,
    upstreamSocket,
    TEST_TRANSCRIPTION,
    undefined,
    undefined,
    NO_HEARTBEAT,
  );
  const upstreamServerSide = track(await upstreamServerSideReady);
  await once(upstreamSocket, "open");

  return { desktop, upstreamServerSide };
}

afterEach(async () => {
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

describe("realtime — WR-11 the relay normalizes a Beta upstream to GA", () => {
  it("WR-11: an upstream transcription_session.created reaches the client as session.created", async () => {
    const { desktop, upstreamServerSide } = await bridgeUnderTest();
    const fromRelay = readFrames(desktop);

    upstreamServerSide.send(
      JSON.stringify({ type: "transcription_session.created", session: { id: "sess_1" } }),
    );

    const frame = await withDeadline(fromRelay.next(), 3_000, "the client-leg frame");
    // The client's switch table resolves the connect promise ONLY on
    // `session.created`; the Beta name would match no branch and the
    // client would time out after 15s with the socket still open.
    expect(frame.type).toBe("session.created");
    expect(frame.session).toEqual({ id: "sess_1" });
  });

  it("WR-11: the relay's own session.update echo is swallowed, a later one is forwarded as session.updated", async () => {
    const { desktop, upstreamServerSide } = await bridgeUnderTest();
    const fromRelay = readFrames(desktop);
    const fromClientLeg = readFrames(upstreamServerSide);

    // R31 DEFECT 6 — on open the relay injects its own GA session.update.
    // That is what arms the echo-swallow flag.
    const injected = await withDeadline(
      fromClientLeg.next(),
      3_000,
      "the relay's self-injected session.update",
    );
    expect(injected.type).toBe("session.update");

    // The stand answers that injected update with a BETA-named echo.
    upstreamServerSide.send(
      JSON.stringify({ type: "transcription_session.updated", session: { type: "transcription" } }),
    );
    // ...followed by the session-created event the client is waiting for.
    upstreamServerSide.send(JSON.stringify({ type: "transcription_session.created", session: {} }));

    // The FIRST frame the client sees must be session.created — proving
    // the echo was swallowed after translation, not forwarded. Keying the
    // swallow on the raw Beta name is what breaks here.
    const first = await withDeadline(fromRelay.next(), 3_000, "the first client-leg frame");
    expect(first.type).toBe("session.created");

    // A SECOND updated event is a real one (a non-preconfigured client's
    // own update echo — the stand echoes every session.update separately,
    // verified live) and must reach the client, renamed.
    upstreamServerSide.send(
      JSON.stringify({ type: "transcription_session.updated", session: { id: "sess_2" } }),
    );
    const second = await withDeadline(fromRelay.next(), 3_000, "the second client-leg frame");
    expect(second.type).toBe("session.updated");
    expect(second.session).toEqual({ id: "sess_2" });
  });

  it("WR-11: a GA upstream is untouched — session.created still arrives as session.created", async () => {
    const { desktop, upstreamServerSide } = await bridgeUnderTest();
    const fromRelay = readFrames(desktop);

    // Regression guard for operators whose upstream really is OpenAI GA:
    // the normalization must be a strict no-op for them.
    upstreamServerSide.send(
      JSON.stringify({ type: "session.created", session: { id: "sess_ga" } }),
    );

    const frame = await withDeadline(fromRelay.next(), 3_000, "the client-leg frame");
    expect(frame.type).toBe("session.created");
    expect(frame.session).toEqual({ id: "sess_ga" });
  });

  it("WR-11: transcription result events are never renamed", async () => {
    const { desktop, upstreamServerSide } = await bridgeUnderTest();
    const fromRelay = readFrames(desktop);

    // The result events are byte-identical in both dialects. Renaming one
    // would reproduce the empty-transcript symptom the relay already
    // carries scar tissue for (R31 DEFECT 4).
    upstreamServerSide.send(
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.delta",
        delta: "hello there",
      }),
    );

    const frame = await withDeadline(fromRelay.next(), 3_000, "the client-leg frame");
    expect(frame.type).toBe("conversation.item.input_audio_transcription.delta");
    expect(frame.delta).toBe("hello there");
  });
});
