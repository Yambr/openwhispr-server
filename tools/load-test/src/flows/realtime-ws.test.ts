// Phase 08.1 / Plan 01 / Task 3 RED→GREEN — realtime-ws flow tests.
//
// The flow opens a wss connection, sends a ping, records the round-trip
// duration into a custom Trend metric on `message`, and closes cleanly.
// We mock the WsSocket so the test runs instantly with no real network —
// we drive the lifecycle synchronously via the captured addEventListener
// callbacks to assert the Trend.add() value matches the synthetic delay.

import { describe, expect, it, vi } from "vitest";
import type { HttpClient, WsParams, WsSocket } from "../utils/http-client.js";
import { createMockAdapter } from "../utils/http-client.js";
import { realtimeWs } from "./realtime-ws.js";

/** Tiny synthetic WS that records events and lets the test drive them. */
interface SocketHarness {
  socket: WsSocket;
  events: Record<string, ((p?: unknown) => void)[]>;
  sent: string[];
  readonly closed: boolean;
  readonly closeCode: number | undefined;
}

function makeSocket(): SocketHarness {
  const events: Record<string, ((p?: unknown) => void)[]> = {};
  const sent: string[] = [];
  const state = { closed: false, closeCode: undefined as number | undefined };
  const socket: WsSocket = {
    send(data: string) {
      sent.push(data);
    },
    addEventListener(event, cb) {
      const bucket = events[event] ?? [];
      bucket.push(cb);
      events[event] = bucket;
    },
    close(code) {
      state.closed = true;
      state.closeCode = code;
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

function makeTrend() {
  const calls: Array<{ value: number; tags?: Record<string, string> }> = [];
  return {
    trend: {
      add(value: number, tags?: Record<string, string>) {
        calls.push({ value, ...(tags !== undefined ? { tags } : {}) });
      },
    },
    calls,
  };
}

describe("realtime-ws flow", () => {
  it("opens wss://api.localhost/v1/realtime with Authorization Bearer header", () => {
    const captured: { url?: string; params?: WsParams } = {};
    const client = wsClient((url, params, handler) => {
      captured.url = url;
      captured.params = params;
      const env = makeSocket();
      handler(env.socket);
    });
    const { trend } = makeTrend();
    realtimeWs({ email: "u@x", token: "tok-ws" }, client, { roundtripMs: trend });
    expect(captured.url).toMatch(/^wss:\/\/api\.localhost\/v1\/realtime/);
    expect(captured.params?.headers?.authorization).toBe("Bearer tok-ws");
  });

  it("tags the ws call with endpoint:'realtime-ws'", () => {
    let captured: WsParams | undefined;
    const client = wsClient((_url, params, handler) => {
      captured = params;
      const env = makeSocket();
      handler(env.socket);
    });
    const { trend } = makeTrend();
    realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend });
    expect(captured?.tags?.endpoint).toBe("realtime-ws");
  });

  it("sends the ping on open and closes 1000 on first message", () => {
    let envRef: SocketHarness | undefined;
    const client = wsClient((_url, _params, handler) => {
      const env = makeSocket();
      envRef = env;
      handler(env.socket);
      for (const cb of env.events.open ?? []) cb();
      for (const cb of env.events.message ?? []) cb("pong");
    });
    const { trend } = makeTrend();
    realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend });
    expect(envRef?.sent.length).toBeGreaterThanOrEqual(1);
    expect(envRef?.closed).toBe(true);
    expect(envRef?.closeCode).toBe(1000);
  });

  it("records the roundtrip duration into the custom Trend on message (Task 3)", () => {
    // Synthesise a controlled clock: open at t=100, message at t=247 → delta 147ms.
    const ticks = [100, 247];
    const now = vi.fn(() => ticks.shift() ?? 0);
    const { trend, calls } = makeTrend();
    const client = wsClient((_url, _params, handler) => {
      const env = makeSocket();
      handler(env.socket);
      for (const cb of env.events.open ?? []) cb();
      for (const cb of env.events.message ?? []) cb("pong");
    });
    realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend, now });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.value).toBe(147);
    expect(calls[0]?.tags).toEqual({ endpoint: "realtime-ws" });
  });

  it("emits the Trend BEFORE close so a close-throw cannot drop the metric", () => {
    let messageHandlerInvoked = false;
    const order: string[] = [];
    const trend = {
      add(_value: number) {
        order.push("trend.add");
      },
    };
    const env = makeSocket();
    // Override close to throw — value must already be recorded.
    const originalClose = env.socket.close;
    env.socket.close = (code, reason) => {
      order.push("socket.close");
      originalClose.call(env.socket, code, reason);
    };
    const client = wsClient((_url, _params, handler) => {
      handler(env.socket);
      for (const cb of env.events.open ?? []) cb();
      messageHandlerInvoked = true;
      for (const cb of env.events.message ?? []) cb("pong");
    });
    realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend });
    expect(messageHandlerInvoked).toBe(true);
    expect(order).toEqual(["trend.add", "socket.close"]);
  });

  it("closes with code 1011 when the socket reports an error", () => {
    let envRef: SocketHarness | undefined;
    const client = wsClient((_url, _params, handler) => {
      const env = makeSocket();
      envRef = env;
      handler(env.socket);
      for (const cb of env.events.error ?? []) cb(new Error("boom"));
    });
    const { trend } = makeTrend();
    realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend });
    expect(envRef?.closed).toBe(true);
    expect(envRef?.closeCode).toBe(1011);
  });

  it("schedules a 2-second setTimeout fallback that closes the socket on stall", () => {
    // Patch setTimeout to record without running.
    const scheduled: Array<{ ms: number; cb: () => void }> = [];
    const origST = globalThis.setTimeout;
    // @ts-expect-error — narrow override for test
    globalThis.setTimeout = (cb: () => void, ms: number) => {
      scheduled.push({ ms, cb });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };
    try {
      let envRef: SocketHarness | undefined;
      const client = wsClient((_url, _params, handler) => {
        const env = makeSocket();
        envRef = env;
        handler(env.socket);
      });
      const { trend } = makeTrend();
      realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend });
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]?.ms).toBe(2000);
      scheduled[0]?.cb();
      expect(envRef?.closed).toBe(true);
      expect(envRef?.closeCode).toBe(1000);
    } finally {
      globalThis.setTimeout = origST;
    }
  });

  it("Trend metric is reported as the `realtime_ws_roundtrip_ms` shape (non-zero value, tagged)", () => {
    // Defensive: regression guard. If a future refactor renames or drops
    // the tag, the summary JSON path metrics.realtime_ws_roundtrip_ms in
    // the live run would once again be undefined or untagged.
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(50);
    const { trend, calls } = makeTrend();
    const client = wsClient((_url, _params, handler) => {
      const env = makeSocket();
      handler(env.socket);
      for (const cb of env.events.open ?? []) cb();
      for (const cb of env.events.message ?? []) cb("pong");
    });
    realtimeWs({ email: "u@x", token: "tok" }, client, { roundtripMs: trend, now });
    expect(calls[0]?.value).toBeGreaterThan(0);
    expect(calls[0]?.tags).toEqual({ endpoint: "realtime-ws" });
  });
});
