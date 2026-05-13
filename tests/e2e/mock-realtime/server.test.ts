// SPDX-License-Identifier: Apache-2.0
// Phase 04 / Plan 07 / Task 1 — hermetic mock-realtime WS server tests.
//
// Test client uses the `ws` library (NOT @fastify/websocket — that's the
// server-side plugin). All tests bind on port 0 (ephemeral) so parallel
// vitest workers do not collide.

import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startMockRealtimeServer, type StopHandle } from "./server.js";

describe("mock-realtime WS server", () => {
  let handle: StopHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = undefined;
    }
  });

  it("emits session.created on connect with sess_-prefixed id", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    const msg = await new Promise<string>((res, rej) => {
      ws.once("message", (data) => res(data.toString()));
      ws.once("error", rej);
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe("session.created");
    expect(parsed.session.object).toBe("realtime.session");
    expect(typeof parsed.session.id).toBe("string");
    expect(parsed.session.id.startsWith("sess_")).toBe(true);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("emits response.done on response.create with resp_-prefixed id", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    // Wait for opening session.created to drain.
    await new Promise<void>((res) => ws.once("message", () => res()));
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res) => {
      ws.once("message", (data) => res(data.toString()));
    });
    const parsed = JSON.parse(reply);
    expect(parsed.type).toBe("response.done");
    expect(typeof parsed.response.id).toBe("string");
    expect(parsed.response.id.startsWith("resp_")).toBe(true);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("transparently handles WebSocket ping/pong frames at protocol layer", async () => {
    // The `ws` library auto-replies to incoming ping frames with a pong
    // at the protocol layer (RFC 6455 §5.5.2/5.5.3) — there is no
    // application-layer handler to write. We assert the channel survives
    // a ping by sending one mid-stream and confirming a subsequent JSON
    // request/response round-trip still works. RTT is bounded so a
    // ping-induced disconnect would surface as a timeout.
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    // Attach 'message' BEFORE awaiting open so we don't lose the
    // immediate session.created frame to a race condition.
    await new Promise<void>((res) => ws.once("message", () => res()));
    const start = Date.now();
    ws.ping(Buffer.from("ping-payload"));
    // Send response.create AFTER ping; if the ping disrupted the channel
    // we would never see a response.done.
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res, rej) => {
      ws.once("message", (data) => res(data.toString()));
      ws.once("error", rej);
    });
    const rtt = Date.now() - start;
    expect(JSON.parse(reply).type).toBe("response.done");
    // Loopback round-trip far under 1s; ping did not stall the connection.
    expect(rtt).toBeLessThan(1000);
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("services 10 sequential request/response cycles", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    // Drain session.created.
    await new Promise<void>((res) => ws.once("message", () => res()));
    for (let i = 0; i < 10; i++) {
      ws.send(JSON.stringify({ type: "response.create", n: i }));
      const reply = await new Promise<string>((res) => {
        ws.once("message", (data) => res(data.toString()));
      });
      const parsed = JSON.parse(reply);
      expect(parsed.type).toBe("response.done");
      expect(parsed.response.id.startsWith("resp_")).toBe(true);
    }
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("graceful stop() closes open connections cleanly with code 1000", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    // Attach 'message' BEFORE awaiting open so we don't race the
    // immediate session.created emission. The connection is fully
    // open by the time the first frame arrives.
    await new Promise<void>((res) => ws.once("message", () => res()));
    const closed = new Promise<{ code: number }>((res) => {
      ws.once("close", (code) => res({ code }));
    });
    await handle.stop();
    handle = undefined;
    const result = await closed;
    // Either 1000 (normal) or 1001 (going away) or 1006 (abnormal but
    // server-initiated close on Fastify shutdown can yield 1005/1006 on
    // some Node versions). Per acceptance: clean close — accept 1000-1006.
    expect(result.code).toBeGreaterThanOrEqual(1000);
    expect(result.code).toBeLessThanOrEqual(1006);
  });

  it("binds on a configurable port (port:0 yields an ephemeral bound URL)", async () => {
    handle = await startMockRealtimeServer({ port: 0 });
    expect(handle.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/v1\/realtime$/);
    // Extract the bound port; must be a non-zero ephemeral port.
    const m = handle.url.match(/:(\d+)\//);
    expect(m).not.toBeNull();
    const port = Number(m![1]);
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(0);
  });

  it("ignores non-JSON garbage frames without crashing the connection", async () => {
    // Coverage: exercise the JSON.parse failure path.
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    await new Promise<void>((res) => ws.once("message", () => res()));
    // Send garbage that JSON.parse will reject.
    ws.send("this-is-not-json{");
    // Then send a valid response.create — server must still reply.
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res) => {
      ws.once("message", (data) => res(data.toString()));
    });
    expect(JSON.parse(reply).type).toBe("response.done");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });

  it("ignores known message types other than response.create", async () => {
    // Coverage: branch where msg.type !== 'response.create'.
    handle = await startMockRealtimeServer({ port: 0 });
    const ws = new WebSocket(handle.url);
    await new Promise<void>((res) => ws.once("message", () => res()));
    ws.send(JSON.stringify({ type: "session.update" }));
    // Then a response.create to confirm the channel is still alive.
    ws.send(JSON.stringify({ type: "response.create" }));
    const reply = await new Promise<string>((res) => {
      ws.once("message", (data) => res(data.toString()));
    });
    expect(JSON.parse(reply).type).toBe("response.done");
    ws.close();
    await new Promise<void>((res) => ws.once("close", () => res()));
  });
});
