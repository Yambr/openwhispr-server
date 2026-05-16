// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 37 / Task 1 — RED tests for CR-9 (LitellmUpstreamError bodyText leak).
//
// pino's default `err` serializer enumerates OWN ENUMERABLE properties of
// Error instances and ships them to Loki. `public readonly bodyText: string`
// holding the full upstream body therefore exfiltrates secret-shaped
// upstream responses into log storage (STRIDE Info-Disclosure, threat V7).
//
// These tests assert the post-fix invariants:
//   1. JSON.stringify(err) is bounded (no full body echo).
//   2. JSON.stringify(err) does NOT contain a 201-char run of payload bytes.
//   3. err.toJSON() returns exactly { name, message, status } — what
//      pino's serializer calls if present, guaranteeing bodyText is dropped.

import { describe, expect, it } from "vitest";
import { LitellmUpstreamError } from "../../src/errors.js";

describe("LitellmUpstreamError — bodyText truncation (CR-9)", () => {
  const HUGE = "x".repeat(10000);

  it("JSON.stringify(err) is bounded below 500 bytes", () => {
    const err = new LitellmUpstreamError(500, HUGE);
    expect(JSON.stringify(err).length).toBeLessThan(500);
  });

  it("JSON.stringify(err) does not echo the full body (no 201-char run)", () => {
    const err = new LitellmUpstreamError(500, HUGE);
    expect(JSON.stringify(err)).not.toContain("x".repeat(201));
  });

  it("err.toJSON() returns only { name, message, status }", () => {
    const err = new LitellmUpstreamError(502, HUGE);
    expect(err.toJSON()).toEqual({
      name: "LitellmUpstreamError",
      message: expect.any(String),
      status: 502,
    });
    expect(JSON.stringify(err.toJSON())).not.toContain("x".repeat(10000));
  });

  it("preserves status field for route mapping", () => {
    const err = new LitellmUpstreamError(503, "boom");
    expect(err.status).toBe(503);
  });

  it("custom message override still respected", () => {
    const err = new LitellmUpstreamError(500, HUGE, "custom-msg");
    expect(err.message).toBe("custom-msg");
    expect(JSON.stringify(err)).not.toContain("x".repeat(201));
  });
});
