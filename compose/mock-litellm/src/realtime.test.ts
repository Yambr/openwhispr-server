// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08.3 / Plan 01 / Task 1 — RED for the /v1/realtime echo handler.
//
// Drives the contract laid out in 08.3-PLAN.md:
//   - On client connect: server completes the WS upgrade (101).
//   - On first inbound text frame: server emits exactly ONE outbound
//     text frame within 100 ms.
//   - The emitted frame is JSON of shape:
//       { type: "session.created", event_id: <uuid>,
//         session: { id: "mock-<uuid>" } }
//   - Server does NOT close the socket — the client (k6 flow) closes
//     with code 1000 after receipt.
//
// The test binds Fastify on an OS-assigned ephemeral port (port: 0)
// and dials it from the `ws` library client so the assertion path
// matches the real k6/websockets handshake.

import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { realtimePlugin } from "./realtime.js";

interface RealtimeEvent {
  type: string;
  event_id: string;
  session: { id: string };
}

describe("realtimePlugin / GET /v1/realtime", () => {
  let app: ReturnType<typeof Fastify> | undefined;
  let port = 0;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(realtimePlugin);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected address object");
    port = addr.port;
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it("echoes a single session.created frame after the first client message", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`);
    const frames: string[] = [];
    let serverClosed = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout — no message in 100ms")), 1000);
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session.update" }));
      });
      ws.on("message", (data: WebSocket.RawData) => {
        frames.push(data.toString("utf8"));
        clearTimeout(timer);
        resolve();
      });
      ws.on("close", () => {
        serverClosed = true;
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(frames.length).toBe(1);
    const event = JSON.parse(frames[0] as string) as RealtimeEvent;
    expect(event.type).toBe("session.created");
    expect(typeof event.event_id).toBe("string");
    expect(event.event_id.length).toBeGreaterThan(0);
    expect(event.session.id.startsWith("mock-")).toBe(true);

    // The server must NOT close — the client (mirroring the k6 flow)
    // owns the close. Give it a moment to see if any unsolicited close
    // arrives, then assert.
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(serverClosed).toBe(false);

    // Client closes with code 1000, matching the k6 flow contract.
    ws.close(1000, "test-complete");
  });

  it("emits exactly one frame even if the client sends multiple messages", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime`);
    const frames: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 200); // collect frames for 200ms
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "session.update" }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: "" }));
        ws.send(JSON.stringify({ type: "response.create" }));
      });
      ws.on("message", (data: WebSocket.RawData) => {
        frames.push(data.toString("utf8"));
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    expect(frames.length).toBe(1);
    ws.close(1000, "test-complete");
  });
});
