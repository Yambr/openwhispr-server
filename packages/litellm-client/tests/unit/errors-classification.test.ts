// SPDX-License-Identifier: FSL-1.1-ALv2
// litellm-patterns A3 — RED tests for typed upstream error classification.
//
// Today every status >= 400 throws a single LitellmUpstreamError carrying
// only `status`; a caller cannot tell a retryable 429 from a non-retryable
// 401. A3 adds a `kind` discriminant + an optional parsed `retryAfterMs`,
// derived inside the client from two exported pure helpers.

import { describe, expect, it } from "vitest";
import {
  classifyUpstreamStatus,
  type LitellmErrorKind,
  LitellmUpstreamError,
  parseRetryAfterMs,
} from "../../src/errors.js";

describe("classifyUpstreamStatus", () => {
  it("classifies 429 as rate_limit", () => {
    expect(classifyUpstreamStatus(429)).toBe<LitellmErrorKind>("rate_limit");
  });

  it("classifies 401 and 403 as auth", () => {
    expect(classifyUpstreamStatus(401)).toBe<LitellmErrorKind>("auth");
    expect(classifyUpstreamStatus(403)).toBe<LitellmErrorKind>("auth");
  });

  it("classifies 5xx (other than 429) as server", () => {
    expect(classifyUpstreamStatus(500)).toBe<LitellmErrorKind>("server");
    expect(classifyUpstreamStatus(503)).toBe<LitellmErrorKind>("server");
    expect(classifyUpstreamStatus(599)).toBe<LitellmErrorKind>("server");
  });

  it("classifies other 4xx as client", () => {
    expect(classifyUpstreamStatus(400)).toBe<LitellmErrorKind>("client");
    expect(classifyUpstreamStatus(404)).toBe<LitellmErrorKind>("client");
    expect(classifyUpstreamStatus(409)).toBe<LitellmErrorKind>("client");
    expect(classifyUpstreamStatus(418)).toBe<LitellmErrorKind>("client");
  });
});

describe("parseRetryAfterMs", () => {
  const NOW = 1_700_000_000_000;

  it("parses integer delta-seconds", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
  });

  it("parses an HTTP-date form relative to now", () => {
    const future = new Date(NOW + 12_000).toUTCString();
    expect(parseRetryAfterMs(future, NOW)).toBe(12_000);
  });

  it("returns undefined for an absent header", () => {
    expect(parseRetryAfterMs(undefined, NOW)).toBeUndefined();
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfterMs("not-a-number", NOW)).toBeUndefined();
  });

  it("returns undefined for a negative delta", () => {
    expect(parseRetryAfterMs("-5", NOW)).toBeUndefined();
  });

  it("returns undefined for a past HTTP-date", () => {
    const past = new Date(NOW - 60_000).toUTCString();
    expect(parseRetryAfterMs(past, NOW)).toBeUndefined();
  });

  it("caps at 60_000 ms", () => {
    expect(parseRetryAfterMs("3600", NOW)).toBe(60_000);
    const farFuture = new Date(NOW + 3_600_000).toUTCString();
    expect(parseRetryAfterMs(farFuture, NOW)).toBe(60_000);
  });

  it("accepts a string[] header value (uses the first entry)", () => {
    expect(parseRetryAfterMs(["15", "99"], NOW)).toBe(15_000);
  });

  it("treats 0 seconds as a valid zero wait", () => {
    expect(parseRetryAfterMs("0", NOW)).toBe(0);
  });
});

describe("LitellmUpstreamError — A3 typed classification", () => {
  it("derives `kind` from status when not supplied (back-compat ctor)", () => {
    expect(new LitellmUpstreamError(429, "body").kind).toBe<LitellmErrorKind>("rate_limit");
    expect(new LitellmUpstreamError(401, "body").kind).toBe<LitellmErrorKind>("auth");
    expect(new LitellmUpstreamError(500, "body").kind).toBe<LitellmErrorKind>("server");
    expect(new LitellmUpstreamError(404, "body").kind).toBe<LitellmErrorKind>("client");
  });

  it("honors an explicitly supplied kind + retryAfterMs", () => {
    const err = new LitellmUpstreamError(429, "body", {
      kind: "rate_limit",
      retryAfterMs: 5_000,
    });
    expect(err.kind).toBe<LitellmErrorKind>("rate_limit");
    expect(err.retryAfterMs).toBe(5_000);
  });

  it("retryAfterMs is undefined when not supplied", () => {
    expect(new LitellmUpstreamError(503, "body").retryAfterMs).toBeUndefined();
  });

  it("still supports the positional message override via opts.message", () => {
    const err = new LitellmUpstreamError(500, "body", { message: "custom-msg" });
    expect(err.message).toBe("custom-msg");
  });

  it("toJSON() includes kind but NOT bodyText", () => {
    const err = new LitellmUpstreamError(429, "x".repeat(10000), { retryAfterMs: 2_000 });
    const json = err.toJSON();
    expect(json.kind).toBe<LitellmErrorKind>("rate_limit");
    expect(json.status).toBe(429);
    expect(JSON.stringify(json)).not.toContain("x".repeat(201));
    expect(JSON.stringify(json)).not.toMatch(/bodyText/);
  });

  it("instanceof LitellmUpstreamError still catches a rate_limit instance", () => {
    const err: unknown = new LitellmUpstreamError(429, "body");
    expect(err).toBeInstanceOf(LitellmUpstreamError);
  });
});
