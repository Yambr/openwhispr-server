// Phase 6 / Plan 06 / SCALE-04 — SSRF env config parsing (D-S4).

import { describe, expect, it } from "vitest";
import { loadSSRFConfig } from "./ssrf.js";

describe("loadSSRFConfig", () => {
  it("parses an empty env to deny-all defaults", () => {
    const cfg = loadSSRFConfig({});
    expect(cfg.OUTBOUND_ALLOWED_HOSTS).toEqual([]);
    expect(cfg.OUTBOUND_PRIVATE_HOST_ALLOWLIST).toEqual([]);
    expect(cfg.OUTBOUND_ALLOW_LOOPBACK).toBe(false);
    expect(cfg.OUTBOUND_SSRF_MODE).toBe("enforce");
  });

  it("splits CSV allow-list and trims whitespace", () => {
    const cfg = loadSSRFConfig({
      OUTBOUND_ALLOWED_HOSTS: " openrouter.ai , api.tavily.com ,litellm",
    });
    expect(cfg.OUTBOUND_ALLOWED_HOSTS).toEqual(["openrouter.ai", "api.tavily.com", "litellm"]);
  });

  it("drops empty entries from CSV parsing", () => {
    const cfg = loadSSRFConfig({
      OUTBOUND_PRIVATE_HOST_ALLOWLIST: "a,,b,,",
    });
    expect(cfg.OUTBOUND_PRIVATE_HOST_ALLOWLIST).toEqual(["a", "b"]);
  });

  it("treats OUTBOUND_ALLOW_LOOPBACK=1 as true", () => {
    const cfg = loadSSRFConfig({ OUTBOUND_ALLOW_LOOPBACK: "1" });
    expect(cfg.OUTBOUND_ALLOW_LOOPBACK).toBe(true);
  });

  it("treats any non-'1' value as false (0, false, empty)", () => {
    expect(loadSSRFConfig({ OUTBOUND_ALLOW_LOOPBACK: "0" }).OUTBOUND_ALLOW_LOOPBACK).toBe(false);
    expect(loadSSRFConfig({ OUTBOUND_ALLOW_LOOPBACK: "false" }).OUTBOUND_ALLOW_LOOPBACK).toBe(
      false,
    );
    expect(loadSSRFConfig({ OUTBOUND_ALLOW_LOOPBACK: "" }).OUTBOUND_ALLOW_LOOPBACK).toBe(false);
  });

  it("accepts OUTBOUND_SSRF_MODE=warn", () => {
    const cfg = loadSSRFConfig({ OUTBOUND_SSRF_MODE: "warn" });
    expect(cfg.OUTBOUND_SSRF_MODE).toBe("warn");
  });

  it("rejects invalid OUTBOUND_SSRF_MODE (zod fail-loud)", () => {
    expect(() => loadSSRFConfig({ OUTBOUND_SSRF_MODE: "bogus" })).toThrow();
  });

  it("defaults to process.env when no argument is supplied", () => {
    // Just exercise the default-arg branch; we don't assert specific values
    // since the host env varies. Ensure no throw.
    expect(() => loadSSRFConfig()).not.toThrow();
  });
});
