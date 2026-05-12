// Phase 08 / Plan 06 — Task 2 GREEN: realtime-ws flow.
//
// Opens a wss://api.localhost/v1/realtime connection, sends a single
// ping frame, awaits one response message, then closes with code 1000
// (normal closure). The flow is engineered to fit inside an iteration
// budget of ~2 seconds under healthy conditions; an upstream stall
// surfaces as connection-establish or message-receive latency in the
// `endpoint:'realtime-ws'`-tagged metrics.

import { BASE_URL } from "../utils/http.js";
import type { HttpClient, WsSocket } from "../utils/http-client.js";
import type { User } from "./transcribe.js";

const REALTIME_PATH = "/v1/realtime";
const PING_PAYLOAD = JSON.stringify({ type: "session.update" });

function wsUrl(): string {
  // BASE_URL is `https://api.localhost`; swap scheme to wss to land
  // on the same Traefik vhost. We avoid URL() because k6 lacks the
  // global; manual string ops are byte-safe.
  return `${BASE_URL.replace(/^https:/, "wss:")}${REALTIME_PATH}`;
}

export function realtimeWs(user: User, client: HttpClient): void {
  client.ws(
    wsUrl(),
    {
      headers: {
        authorization: `Bearer ${user.token}`,
      },
      tags: { endpoint: "realtime-ws" },
    },
    (socket: WsSocket) => {
      socket.on("open", () => {
        socket.send(PING_PAYLOAD);
      });
      socket.on("message", () => {
        // Close after the first inbound frame — the load test cares
        // about establish+roundtrip latency, not steady-state streaming.
        socket.close(1000, "load-test-complete");
      });
      socket.on("error", () => {
        // Errors fail the iteration metric in k6 but must not throw —
        // closing here keeps fd counts clean on the worst case.
        socket.close(1011, "load-test-error");
      });
      // Hard ceiling so a stuck connection cannot pin the VU forever.
      socket.setTimeout(() => {
        socket.close(1000, "load-test-timeout");
      }, 2000);
    },
  );
}
