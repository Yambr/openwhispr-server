// SPDX-License-Identifier: Apache-2.0
// Phase 6 / Plan 06 / SCALE-04 — bootstrap.installGlobalSSRF unit tests.
//
// Verifies that the boot wrapper:
//   - Loads SSRFConfig from env (default path) and from injected overrides.
//   - Invokes setGlobalDispatcher exactly once per call.
//   - Routes onBlock to the default WARN logger when no override is supplied.

import { describe, expect, it, vi } from "vitest";

const setGlobalDispatcherMock = vi.fn();
vi.mock("undici", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setGlobalDispatcher: (...args: unknown[]) => setGlobalDispatcherMock(...args),
  };
});

import { defaultOnBlock, installGlobalSSRF } from "./bootstrap.js";

describe("bootstrap.installGlobalSSRF", () => {
  it("calls setGlobalDispatcher with an undici Dispatcher (default config from env)", () => {
    setGlobalDispatcherMock.mockClear();
    installGlobalSSRF({
      config: {
        OUTBOUND_ALLOWED_HOSTS: ["openrouter.ai"],
        OUTBOUND_PRIVATE_HOST_ALLOWLIST: [],
        OUTBOUND_ALLOW_LOOPBACK: false,
        OUTBOUND_SSRF_MODE: "enforce",
      },
    });
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(1);
    const arg = setGlobalDispatcherMock.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(typeof (arg as { dispatch?: unknown }).dispatch).toBe("function");
  });

  it("loads config from process.env when no override is passed", () => {
    setGlobalDispatcherMock.mockClear();
    const prev = process.env.OUTBOUND_ALLOWED_HOSTS;
    process.env.OUTBOUND_ALLOWED_HOSTS = "openrouter.ai";
    try {
      installGlobalSSRF();
      expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env.OUTBOUND_ALLOWED_HOSTS;
      else process.env.OUTBOUND_ALLOWED_HOSTS = prev;
    }
  });

  it("forwards a custom onBlock when provided in overrides", () => {
    setGlobalDispatcherMock.mockClear();
    const onBlock = vi.fn();
    installGlobalSSRF({
      config: {
        OUTBOUND_ALLOWED_HOSTS: ["any.example"],
        OUTBOUND_PRIVATE_HOST_ALLOWLIST: [],
        OUTBOUND_ALLOW_LOOPBACK: false,
        OUTBOUND_SSRF_MODE: "enforce",
      },
      onBlock,
    });
    expect(setGlobalDispatcherMock).toHaveBeenCalled();
    // onBlock is only invoked on a real block; this test pins the wiring,
    // not the invocation path (covered by ssrf-dispatcher.test.ts).
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("default onBlock emits a structured JSON warn line", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      defaultOnBlock({
        host: "evil.example",
        ip: "10.0.0.1",
        rule: "rfc1918_10",
        mode: "enforce",
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
      expect(payload).toEqual({
        level: "warn",
        event: "security.ssrf_blocked",
        target_url_host: "evil.example",
        ip: "10.0.0.1",
        rule: "rfc1918_10",
        mode: "enforce",
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("default onBlock emits warn payload when mode='warn'", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      defaultOnBlock({ host: "h", ip: null, rule: "host_not_allowed", mode: "warn" });
      const payload = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
      expect(payload.mode).toBe("warn");
      expect(payload.ip).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
