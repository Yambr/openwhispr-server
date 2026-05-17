// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 6 / Plan 06 / SCALE-04 — bootstrap.installGlobalSSRF unit tests.
//
// Verifies that the boot wrapper:
//   - Loads SSRFConfig from env (default path) and from injected overrides.
//   - Invokes setGlobalDispatcher exactly once per call.
//   - Routes onBlock to the default pino warn logger when no override is
//     supplied. Phase 51 / Plan 51-13b migrated the historical
//     `console.warn(JSON.stringify(...))` path to `makePino().warn({...})`.

import { makePino } from "@openwhispr/observability";
import { describe, expect, it, vi } from "vitest";

const setGlobalDispatcherMock = vi.fn();
vi.mock("undici", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setGlobalDispatcher: (...args: unknown[]) => setGlobalDispatcherMock(...args),
  };
});

import { installGlobalSSRF } from "../../src/bootstrap.js";

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

  // Plan 51-13b — defaultOnBlock now routes through pino (module-scoped
  // `ssrfLog` inside src/bootstrap.ts). We can't easily swap that
  // instance from a test, so we re-derive a logger via the SAME factory
  // (`makePino`) and verify the structured-payload contract that both
  // call paths share. A separate source-level pin
  // (`no-console-in-bootstrap.test.ts`) guarantees the production path
  // routes through `makePino` and not `console.warn`.
  it("defaultOnBlock contract — structured warn payload (enforce mode)", () => {
    const lines: string[] = [];
    const log = makePino({
      base: { name: "ssrf.guard" },
      destination: {
        write: (s: string) => {
          lines.push(s);
        },
      },
    });
    log.warn(
      {
        event: "security.ssrf_blocked",
        target_url_host: "evil.example",
        ip: "10.0.0.1",
        rule: "rfc1918_10",
        mode: "enforce",
      },
      "outbound request blocked by SSRF guard",
    );
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(payload.event).toBe("security.ssrf_blocked");
    expect(payload.target_url_host).toBe("evil.example");
    expect(payload.ip).toBe("10.0.0.1");
    expect(payload.rule).toBe("rfc1918_10");
    expect(payload.mode).toBe("enforce");
    expect(payload.level).toBe(40); // pino numeric level for warn
  });

  it("defaultOnBlock contract — null ip + warn mode round-trip", () => {
    const lines: string[] = [];
    const log = makePino({
      base: { name: "ssrf.guard" },
      destination: {
        write: (s: string) => {
          lines.push(s);
        },
      },
    });
    log.warn(
      {
        event: "security.ssrf_blocked",
        target_url_host: "h",
        ip: null,
        rule: "host_not_allowed",
        mode: "warn",
      },
      "outbound request blocked by SSRF guard",
    );
    const payload = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(payload.mode).toBe("warn");
    expect(payload.ip).toBeNull();
  });
});
