// SPDX-License-Identifier: Apache-2.0
// Phase 08 / Plan 06 — Task 2 GREEN: realtime-ws flow.
// Phase 08.1 / Plan 01 / Task 3 — custom Trend metric (RED→GREEN).
//
// Opens a wss://api.localhost:8443/v1/realtime connection, sends a single
// ping frame, awaits one response message, then closes with code 1000
// (normal closure). The flow is engineered to fit inside an iteration
// budget of ~2 seconds under healthy conditions; an upstream stall
// surfaces as connection-establish or message-receive latency in the
// `endpoint:'realtime-ws'`-tagged metrics.
//
// Plan 08-07 reported `iteration_duration{endpoint:'realtime-ws'}=0` in
// the live run — root cause: k6/websockets `addEventListener('message',
// cb)` is async — `client.ws()`'s outer callback returns BEFORE the
// roundtrip completes, so the iteration timer captures the pre-roundtrip
// duration only. Plan 08.1-01 Task 3 fix: emit a custom Trend metric
// `realtime_ws_roundtrip_ms` that records `Date.now() - start` INSIDE the
// `message` listener, so the value is anchored to the actual round-trip.

import { BASE_URL } from "../utils/http.js";
import type { HttpClient, WsSocket } from "../utils/http-client.js";
import type { User } from "./transcribe.js";

const REALTIME_PATH = "/v1/realtime";
const PING_PAYLOAD = JSON.stringify({ type: "session.update" });

/** The minimal Trend surface our flow consumes — k6 ships `new Trend('name')` */
export interface TrendLike {
  add(value: number, tags?: Record<string, string>): void;
}

export interface RealtimeWsDeps {
  /** Custom Trend metric for end-to-end round-trip duration in ms. */
  roundtripMs: TrendLike;
  /**
   * Injectable clock so the test can drive deterministic deltas. Default
   * is Date.now in the runtime path.
   */
  now?: () => number;
}

function wsUrl(): string {
  // BASE_URL is `https://api.localhost`; swap scheme to wss AND switch to
  // the dedicated :8443 websecure-realtime entrypoint where Traefik routes
  // /v1/realtime (Phase 04 Plan 05 — long-running WSS sessions are isolated
  // from short-JSON :443 to avoid head-of-line blocking and to allow a 1h
  // ingress timeout). The :443 vhost has NO router for /v1/realtime, so
  // hitting it directly returns Traefik's plain-text 404 — which the
  // browser-style addEventListener in k6/experimental/websockets silently
  // drops (no `error` event for a non-101 upstream response on upgrade).
  //
  // Phase 08.4 — H8 fix (Phase 04 Plan 05 awareness): without this, every
  // VU in Run 5 produced ws_sessions=1/ws_msgs_sent=0 because the upgrade
  // 404'd at Traefik and the `open` event never fired.
  return `${BASE_URL.replace(/^https:/, "wss:")}:8443${REALTIME_PATH}`;
}

export function realtimeWs(user: User, client: HttpClient, deps: RealtimeWsDeps): void {
  const clock = deps.now ?? Date.now;
  // Captured by the open listener; read by the message listener.
  let start = 0;
  client.ws(
    wsUrl(),
    {
      headers: {
        authorization: `Bearer ${user.token}`,
      },
      tags: { endpoint: "realtime-ws" },
    },
    (socket: WsSocket) => {
      // k6's `k6/websockets` module uses browser-style addEventListener
      // semantics, NOT the node-style `.on()` event-emitter API used by
      // the older `k6/ws` module. Plan 08-07 fix.
      socket.addEventListener("open", () => {
        start = clock();
        socket.send(PING_PAYLOAD);
      });
      socket.addEventListener("message", () => {
        // 08.1-01 Task 3: emit the custom roundtrip Trend BEFORE closing
        // so the metric is recorded even if the close call throws.
        deps.roundtripMs.add(clock() - start, { endpoint: "realtime-ws" });
        // Close after the first inbound frame — the load test cares
        // about establish+roundtrip latency, not steady-state streaming.
        socket.close(1000, "load-test-complete");
      });
      socket.addEventListener("error", () => {
        // Errors fail the iteration metric in k6 but must not throw —
        // closing here keeps fd counts clean on the worst case.
        socket.close(1011, "load-test-error");
      });
      // Hard ceiling so a stuck connection cannot pin the VU forever.
      // setTimeout is a k6 global in main.ts but not on the socket
      // surface; use a top-level setTimeout instead.
      setTimeout(() => {
        socket.close(1000, "load-test-timeout");
      }, 2000);
    },
  );
}
