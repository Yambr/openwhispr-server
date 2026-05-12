// Phase 08 / Plan 06 — Task 2 RED: realtime-ws flow tests.
//
// The flow opens a wss connection, sends a ping, awaits the first
// message, and closes cleanly. We mock the WsSocket so the test runs
// instantly with no real network — we drive the handler synchronously
// via the `on` registry to assert the lifecycle.

import { describe, expect, it } from "vitest";

import type { HttpClient, WsParams, WsSocket } from "../utils/http-client.js";
import { createMockAdapter } from "../utils/http-client.js";
import { realtimeWs } from "./realtime-ws.js";

/** Tiny synthetic WS that records events and lets the test drive them. */
function makeSocket(): {
  socket: WsSocket;
  events: Record<string, ((p?: unknown) => void)[]>;
  sent: string[];
  closed: boolean;
  closeCode?: number;
} {
  const events: Record<string, ((p?: unknown) => void)[]> = {};
  const sent: string[] = [];
  const state = { closed: false, closeCode: undefined as number | undefined };
  const socket: WsSocket = {
    send(data: string) {
      sent.push(data);
    },
    on(event, cb) {
      const bucket = events[event] ?? [];
      bucket.push(cb);
      events[event] = bucket;
    },
    close(code) {
      state.closed = true;
      state.closeCode = code;
    },
    setTimeout() {
      /* noop in tests */
    },
  };
  return {
    socket,
    events,
    sent,
    get closed() {
      return state.closed;
    },
    get closeCode() {
      return state.closeCode;
    },
  };
}

function wsClient(
  handlerImpl: (url: string, params: WsParams, handler: (s: WsSocket) => void) => void,
): HttpClient {
  return createMockAdapter({
    ws: (url, params, handler) => {
      handlerImpl(url, params, handler);
      return { status: 101 };
    },
  });
}

describe("realtime-ws flow", () => {
  it("opens wss://api.localhost/v1/realtime with Authorization Bearer header", () => {
    const captured: { url?: string; params?: WsParams } = {};
    const client = wsClient((url, params, handler) => {
      captured.url = url;
      captured.params = params;
      // Don't drive events — just inspect params.
      const env = makeSocket();
      handler(env.socket);
    });
    realtimeWs({ email: "u@x", token: "tok-ws" }, client);
    expect(captured.url).toMatch(/^wss:\/\/api\.localhost\/v1\/realtime/);
    expect(captured.params?.headers?.authorization).toBe("Bearer tok-ws");
  });

  it("sends a ping on open, closes on first message", () => {
    let envRef: ReturnType<typeof makeSocket> | undefined;
    const client = wsClient((_url, _params, handler) => {
      const env = makeSocket();
      envRef = env;
      handler(env.socket);
      // Drive lifecycle synchronously: open → message → (handler closes).
      for (const cb of env.events.open ?? []) {
        cb();
      }
      for (const cb of env.events.message ?? []) {
        cb("pong");
      }
    });
    realtimeWs({ email: "u@x", token: "tok" }, client);
    expect(envRef).toBeDefined();
    expect(envRef?.sent.length).toBeGreaterThanOrEqual(1);
    expect(envRef?.closed).toBe(true);
    expect(envRef?.closeCode).toBe(1000);
  });

  it("tags the ws call with endpoint:'realtime-ws'", () => {
    let captured: WsParams | undefined;
    const client = wsClient((_url, params, handler) => {
      captured = params;
      const env = makeSocket();
      handler(env.socket);
    });
    realtimeWs({ email: "u@x", token: "tok" }, client);
    expect(captured?.tags?.endpoint).toBe("realtime-ws");
  });

  it("flow completes synchronously under the mock (no real network)", () => {
    const started = Date.now();
    const client = wsClient((_url, _params, handler) => {
      const env = makeSocket();
      handler(env.socket);
      for (const cb of env.events.open ?? []) {
        cb();
      }
      for (const cb of env.events.message ?? []) {
        cb("pong");
      }
    });
    realtimeWs({ email: "u@x", token: "tok" }, client);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
