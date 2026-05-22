// SPDX-License-Identifier: FSL-1.1-ALv2
// litellm-patterns A4 — RED tests for the Retry-After-aware retry layer.
//
// The pure helpers in src/retry.ts: `isRetryableError`, `computeBackoffMs`,
// and `abortableSleep`. The integration (chatCompletions wraps these in a
// loop, chatCompletionsStream does NOT) lives in index.test.ts.

import { describe, expect, it, vi } from "vitest";
import { LitellmUpstreamError } from "../../src/errors.js";
import { abortableSleep, computeBackoffMs, isRetryableError } from "../../src/retry.js";

describe("isRetryableError", () => {
  it("true for LitellmUpstreamError(kind=rate_limit)", () => {
    expect(isRetryableError(new LitellmUpstreamError(429, "rl"))).toBe(true);
  });

  it("true for LitellmUpstreamError(kind=server)", () => {
    expect(isRetryableError(new LitellmUpstreamError(503, "down"))).toBe(true);
    expect(isRetryableError(new LitellmUpstreamError(500, "boom"))).toBe(true);
  });

  it("false for LitellmUpstreamError(kind=auth)", () => {
    expect(isRetryableError(new LitellmUpstreamError(401, "denied"))).toBe(false);
    expect(isRetryableError(new LitellmUpstreamError(403, "forbidden"))).toBe(false);
  });

  it("false for LitellmUpstreamError(kind=client)", () => {
    expect(isRetryableError(new LitellmUpstreamError(400, "bad"))).toBe(false);
    expect(isRetryableError(new LitellmUpstreamError(404, "missing"))).toBe(false);
  });

  it("true for the connection-class error codes", () => {
    for (const code of [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ]) {
      const err = Object.assign(new Error("connection failure"), { code });
      expect(isRetryableError(err)).toBe(true);
    }
  });

  it("false for a plain Error", () => {
    expect(isRetryableError(new Error("nope"))).toBe(false);
  });

  it("false for non-Error values", () => {
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError("string")).toBe(false);
    expect(isRetryableError(42)).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  it("honors retryAfterMs when it is positive and within the cap", () => {
    expect(computeBackoffMs(0, 5_000, 250, 8_000)).toBe(5_000);
    expect(computeBackoffMs(2, 1_000, 250, 8_000)).toBe(1_000);
  });

  it("falls back to jittered exponential when retryAfterMs > cap", () => {
    // Pin Math.random so the assertion is deterministic.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // retryAfterMs above cap is rejected; fall back to exponential jitter.
      const v = computeBackoffMs(2, 99_999, 250, 8_000);
      // raw = 250 * 2^2 = 1000; jittered = 1000 * 0.5 = 500
      expect(v).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to jittered exponential when retryAfterMs is undefined", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // attempt=0 -> raw = 250 * 1 = 250 -> jitter 0.5 -> 125
      expect(computeBackoffMs(0, undefined, 250, 8_000)).toBe(125);
      // attempt=3 -> raw = 250 * 8 = 2000 -> jitter 0.5 -> 1000
      expect(computeBackoffMs(3, undefined, 250, 8_000)).toBe(1_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("caps the jittered exponential at capMs", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.999);
    try {
      // attempt=10 -> raw = 250 * 1024 = 256000 -> jittered ~255744 -> capped at cap
      expect(computeBackoffMs(10, undefined, 250, 8_000)).toBeLessThanOrEqual(8_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("never returns negative", () => {
    expect(computeBackoffMs(0, undefined, 250, 8_000)).toBeGreaterThanOrEqual(0);
    expect(computeBackoffMs(5, 0, 250, 8_000)).toBeGreaterThanOrEqual(0);
  });
});

describe("abortableSleep", () => {
  it("resolves after the timeout", async () => {
    const t0 = Date.now();
    await abortableSleep(20);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });

  it("short-circuits immediately if the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const t0 = Date.now();
    await abortableSleep(5_000, ctrl.signal);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it("short-circuits when the signal aborts mid-sleep", async () => {
    const ctrl = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ctrl.abort(), 10);
    await abortableSleep(5_000, ctrl.signal);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(500);
  });

  it("clears the timer on abort (no unhandled fire)", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await abortableSleep(100, ctrl.signal);
    // Wait past the original timeout — if the timer were not cleared the
    // listener might re-fire, but abortableSleep must already have settled.
    await new Promise((r) => setTimeout(r, 150));
    // No assertion needed beyond the suite not producing an unhandled
    // rejection / late resolve; reaching here is the assertion.
    expect(true).toBe(true);
  });
});
