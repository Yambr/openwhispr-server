// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 / Plan 04 / Task 1 — minutesFromDuration helper tests.
//
// Semantics locked in docs/wire-contracts-phase-3.md (Decision: wordsUsed
// semantics) and the plan frontmatter must_haves: minutes-of-audio rounded
// up. The helper feeds both the response.wordsUsed field and the
// usage_ledger.units column for kind='transcribe_minutes'.

import { describe, expect, it } from "vitest";
import { minutesFromDuration } from "../../../src/lib/word-units.js";

describe("minutesFromDuration", () => {
  it("returns 0 for 0 seconds (no audio)", () => {
    expect(minutesFromDuration(0)).toBe(0);
  });

  it("returns 1 for 1 second (rounds up sub-minute)", () => {
    expect(minutesFromDuration(1)).toBe(1);
  });

  it("returns 1 for exactly 60 seconds (one full minute)", () => {
    expect(minutesFromDuration(60)).toBe(1);
  });

  it("returns 2 for 61 seconds (rounds up over 1m boundary)", () => {
    expect(minutesFromDuration(61)).toBe(2);
  });

  it("returns 2 for exactly 120 seconds (two full minutes)", () => {
    expect(minutesFromDuration(120)).toBe(2);
  });

  it("returns 0 for undefined (upstream omitted duration field)", () => {
    expect(minutesFromDuration(undefined)).toBe(0);
  });

  it("returns 0 for null (defensive)", () => {
    expect(minutesFromDuration(null)).toBe(0);
  });

  it("returns 0 for negative input (defensive)", () => {
    expect(minutesFromDuration(-5)).toBe(0);
  });

  it("rounds up fractional seconds (e.g. 0.5s -> 1)", () => {
    expect(minutesFromDuration(0.5)).toBe(1);
  });

  it("rounds up large fractional minutes (e.g. 61.4s -> 2)", () => {
    expect(minutesFromDuration(61.4)).toBe(2);
  });
});
