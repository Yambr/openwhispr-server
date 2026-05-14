// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 04 / Plan 07 / Task 1 — hermetic mock-realtime WS server.
//
// Speaks the minimum subset of the OpenAI Realtime protocol the soak
// test (plan 04-09) needs:
//   * `session.created` on connect (with a `sess_<ts>` id)
//   * `response.done` reply for every `response.create` frame the client
//     sends (with a `resp_<ts>` id)
//   * Ping/pong is handled at the WebSocket protocol layer by the `ws`
//     library that backs `@fastify/websocket`; no explicit handler.
//
// Topology in `compose/e2e/docker-compose.e2e.yml` (plan 04-07 Task 2):
//
//     api  ──ws──▶  litellm  ──ws──▶  mock-realtime (this service, :8765)
//
// Wave 3 plan 04-09 wires LiteLLM's realtime model upstream URL to
// `ws://mock-realtime:8765/v1/realtime` via env override and runs the
// 5-min soak; this file only needs to be a stable, protocol-correct,
// zero-cost upstream.

import websocket from "@fastify/websocket";
import Fastify from "fastify";

export interface MockRealtimeServerOptions {
  /** Port to bind. Pass 0 for an ephemeral OS-assigned port. */
  port: number;
  /** Hostname to bind. Defaults to "127.0.0.1". */
  host?: string;
}

export interface StopHandle {
  /** Full ws:// URL the test client should dial. */
  url: string;
  /** Closes all open connections + the underlying Fastify HTTP server. */
  stop: () => Promise<void>;
}

/**
 * Start a Fastify-backed mock OpenAI Realtime WS server.
 *
 * Returns a {url, stop} handle. `stop()` is idempotent-friendly: callers
 * SHOULD only call it once per startMockRealtimeServer invocation; the
 * underlying Fastify close is awaited so the OS port is released before
 * the promise resolves.
 */
export async function startMockRealtimeServer(
  opts: MockRealtimeServerOptions,
): Promise<StopHandle> {
  const host = opts.host ?? "127.0.0.1";
  const app = Fastify({ logger: false });
  await app.register(websocket);

  // Track open sockets so stop() can close them with code 1000 BEFORE
  // app.close() — Fastify's close awaits in-flight HTTP requests but does
  // not gracefully shut WS clients, so without this set callers see a
  // hang on the close handshake.
  const openSockets = new Set<{
    close: (code?: number, reason?: string) => void;
  }>();

  app.get("/v1/realtime", { websocket: true }, (socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
    // @fastify/websocket v11 hands the raw `ws.WebSocket` directly as the
    // first argument (the v10 `connection.socket` shape was removed).
    // Send the opening session.created frame so any client that follows
    // the OpenAI Realtime protocol sees the canonical handshake.
    socket.send(
      JSON.stringify({
        type: "session.created",
        session: {
          id: `sess_${Date.now()}`,
          object: "realtime.session",
        },
      }),
    );

    socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      // The ws library hands `data` as Buffer, ArrayBuffer, or Buffer[]
      // depending on the framing. Normalize via `String()` — JSON.parse
      // surfaces malformed payloads which we silently swallow (the soak
      // test only exercises well-formed frames; garbage-tolerance is a
      // hardening property, not a feature).
      let msg: { type?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        // Non-JSON garbage → drop the frame, keep the connection alive.
        return;
      }
      if (msg.type === "response.create") {
        socket.send(
          JSON.stringify({
            type: "response.done",
            response: { id: `resp_${Date.now()}` },
          }),
        );
      }
      // Any other message type is silently ignored — the real OpenAI
      // Realtime API has dozens of message types we don't model here.
    });
    // Ping/pong is handled by the underlying ws library at the WebSocket
    // protocol layer (RFC 6455 §5.5.2/5.5.3); no explicit handler.
  });

  // Fastify v5's listen returns the resolved http(s):// URL string with
  // the actual bound port (so port:0 ephemeral binding still yields a
  // concrete URL). Swap the http:// scheme for ws:// and append the
  // route — no need to introspect server.address().
  const httpUrl = await app.listen({ port: opts.port, host });
  const url = httpUrl.replace(/^http:/, "ws:") + "/v1/realtime";

  return {
    url,
    stop: async () => {
      // Close client connections cleanly with normal-closure code 1000
      // before the underlying server shuts down. Without this Fastify's
      // app.close() leaves clients waiting for the close handshake.
      for (const socket of openSockets) {
        socket.close(1000, "server stopping");
      }
      openSockets.clear();
      await app.close();
    },
  };
}

export default startMockRealtimeServer;
