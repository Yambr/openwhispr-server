// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.3 / Plan 01 / Task 2 — GREEN for the /v1/realtime echo handler.
//
// Minimal Fastify plugin that lets the k6 realtime-ws flow (and the
// Run 4 plateau) record a non-zero `realtime_ws_roundtrip_ms` p95.
// Behavioural contract (08.3-PLAN.md success criteria):
//   - GET /v1/realtime upgrades to WebSocket (101).
//   - On the first inbound text frame from the client, the server emits
//     exactly one text frame shaped as an OpenAI Realtime API
//     `session.created` event envelope.
//   - The server leaves the socket open; the client (k6 flow) closes
//     with code 1000 after receipt.
//
// This is NOT a full Realtime session state machine — subsequent client
// messages are intentionally ignored to keep the mock cheap and the
// roundtrip metric clean (one message → one frame → close).

import { randomUUID } from "node:crypto";
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";

export async function realtimePlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyWebsocket);
  app.get("/v1/realtime", { websocket: true }, (socket) => {
    socket.once("message", () => {
      const event = {
        type: "session.created",
        event_id: randomUUID(),
        session: { id: `mock-${randomUUID()}` },
      };
      socket.send(JSON.stringify(event));
      // Do not close — the client (k6 flow) closes with code 1000
      // after receiving the frame.
    });
  });
}
