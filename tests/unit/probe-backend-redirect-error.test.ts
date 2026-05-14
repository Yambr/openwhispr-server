// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.7 / D-05 — probeBackend() must loud-fail on http→https 308 redirect
 * instead of silently treating it as "backend unreachable" → skip-all-25.
 *
 * Source-of-record commit: <filled at commit time>
 *
 * Reverts: this test goes RED if `redirect: "error"` is removed from
 *   probeBackend's fetch options. Without it, fetch follows the 308 from
 *   Traefik's HTTPS redirect, eventually returns res.ok=true on the new URL
 *   (or follows redirects silently), causing probeBackend → true → suite runs
 *   against the wrong scheme. With redirect:"error", fetch throws a TypeError
 *   on the 308, the catch block returns false, suite skips loudly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeBackend } from "../../packages/contract-tests/src/env";

describe("Phase 02.7 D-05 — probeBackend redirect:'error' loud-fail", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes redirect:'error' to fetch (D-05 loud-fail contract)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await probeBackend();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init, "fetch must be called with init options").toBeDefined();
    expect(init?.redirect, "probeBackend must pass redirect:'error' (D-05)").toBe("error");
  });

  it("returns false when fetch throws on a 308 redirect (caught by try/catch)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("redirect mode is set to error"));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await probeBackend();
    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns true on a 200 OK response (regression guard for happy path)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await probeBackend();
    expect(result).toBe(true);
  });

  it("returns false on a non-2xx response (e.g. 503)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("err", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await probeBackend();
    expect(result).toBe(false);
  });
});

describe("Phase 02.7 D-04 — env.ts module-load constants (BACKEND_URL_EXPLICIT branches)", () => {
  // Module-isolation tests via vi.resetModules() + dynamic import to exercise
  // the BACKEND_URL_EXPLICIT short-circuit branches. Without these, the
  // `process.env.BACKEND_URL.length > 0` branch is unreachable through the
  // normal probeBackend path and coverage stays at 83%.

  it("BACKEND_URL_EXPLICIT is true when BACKEND_URL env is set non-empty", async () => {
    vi.resetModules();
    const prev = process.env.BACKEND_URL;
    process.env.BACKEND_URL = "https://api.example.test";
    try {
      const mod = await import("../../packages/contract-tests/src/env.ts");
      expect(mod.BACKEND_URL_EXPLICIT).toBe(true);
      expect(mod.BACKEND_URL).toBe("https://api.example.test");
      expect(mod.AUTH_URL).toBe("https://api.example.test"); // D-04 collapse
    } finally {
      if (prev === undefined) delete process.env.BACKEND_URL;
      else process.env.BACKEND_URL = prev;
    }
  });

  it("BACKEND_URL_EXPLICIT is false when BACKEND_URL env is unset", async () => {
    vi.resetModules();
    const prev = process.env.BACKEND_URL;
    delete process.env.BACKEND_URL;
    try {
      const mod = await import("../../packages/contract-tests/src/env.ts");
      expect(mod.BACKEND_URL_EXPLICIT).toBe(false);
    } finally {
      if (prev !== undefined) process.env.BACKEND_URL = prev;
    }
  });

  it("AUTH_URL env override is preserved when set explicitly (D-04)", async () => {
    vi.resetModules();
    const prevAuth = process.env.AUTH_URL;
    const prevBackend = process.env.BACKEND_URL;
    process.env.BACKEND_URL = "https://api.localhost";
    process.env.AUTH_URL = "https://auth.example.test";
    try {
      const mod = await import("../../packages/contract-tests/src/env.ts");
      expect(mod.AUTH_URL).toBe("https://auth.example.test");
      expect(mod.BACKEND_URL).toBe("https://api.localhost");
    } finally {
      if (prevAuth === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = prevAuth;
      if (prevBackend === undefined) delete process.env.BACKEND_URL;
      else process.env.BACKEND_URL = prevBackend;
    }
  });
});
