// SPDX-License-Identifier: FSL-1.1-ALv2
// AUDIT-LIB-01 (LIB-1) — shared positive-number env parser unit tests.

import { describe, expect, it, vi } from "vitest";
import { parsePositiveIntEnv, parsePositiveNumberEnv } from "../../src/env-parse.js";

describe("AUDIT-LIB-01 — parsePositiveNumberEnv", () => {
  it("returns fallback for undefined / empty / whitespace", () => {
    expect(parsePositiveNumberEnv(undefined, 7)).toBe(7);
    expect(parsePositiveNumberEnv("", 7)).toBe(7);
    expect(parsePositiveNumberEnv("   ", 7)).toBe(7);
  });

  it("returns fallback for non-numeric / non-positive / non-finite input", () => {
    expect(parsePositiveNumberEnv("abc", 7)).toBe(7);
    expect(parsePositiveNumberEnv("0", 7)).toBe(7);
    expect(parsePositiveNumberEnv("-3", 7)).toBe(7);
    expect(parsePositiveNumberEnv("Infinity", 7)).toBe(7);
    expect(parsePositiveNumberEnv("NaN", 7)).toBe(7);
  });

  it("accepts a finite positive value and trims surrounding whitespace", () => {
    expect(parsePositiveNumberEnv("12", 7)).toBe(12);
    expect(parsePositiveNumberEnv("  42  ", 7)).toBe(42);
  });

  it("accepts a positive float when integer enforcement is off (default)", () => {
    expect(parsePositiveNumberEnv("0.5", 7)).toBe(0.5);
    expect(parsePositiveNumberEnv("1.25", 7)).toBe(1.25);
  });

  it("rejects a positive float when integer: true", () => {
    expect(parsePositiveNumberEnv("0.5", 7, { integer: true })).toBe(7);
    expect(parsePositiveNumberEnv("1.25", 7, { integer: true })).toBe(7);
    expect(parsePositiveNumberEnv("9", 7, { integer: true })).toBe(9);
  });

  it("invokes onInvalid with the trimmed raw value only for present-but-invalid input", () => {
    const onInvalid = vi.fn();
    // Unset / empty → fallback, NO onInvalid.
    expect(parsePositiveNumberEnv(undefined, 7, { onInvalid })).toBe(7);
    expect(parsePositiveNumberEnv("  ", 7, { onInvalid })).toBe(7);
    expect(onInvalid).not.toHaveBeenCalled();
    // Present but invalid → fallback + onInvalid with the trimmed string.
    expect(parsePositiveNumberEnv("  bogus  ", 7, { onInvalid })).toBe(7);
    expect(onInvalid).toHaveBeenCalledExactlyOnceWith("bogus");
    // Valid → no onInvalid.
    onInvalid.mockClear();
    expect(parsePositiveNumberEnv("3", 7, { onInvalid })).toBe(3);
    expect(onInvalid).not.toHaveBeenCalled();
  });
});

describe("AUDIT-LIB-01 — parsePositiveIntEnv convenience wrapper", () => {
  it("enforces integer + positive, else fallback", () => {
    expect(parsePositiveIntEnv("500", 100)).toBe(500);
    expect(parsePositiveIntEnv("12.5", 100)).toBe(100);
    expect(parsePositiveIntEnv("0", 100)).toBe(100);
    expect(parsePositiveIntEnv(undefined, 100)).toBe(100);
    expect(parsePositiveIntEnv("", 100)).toBe(100);
  });
});
