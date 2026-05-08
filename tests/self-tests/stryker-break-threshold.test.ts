import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// TEST-MUTATION-01 self-test: the Stryker mutation gate is configured with a
// `thresholds.break` value at or above the constitutional floor. This is a
// static-config self-test (parses stryker.config.json) rather than a full
// `stryker run` against a fixture, because:
//   1. A real Stryker run on a small fixture takes 60-180s and is flaky in
//      shared CI runners; running it inside vitest as a subprocess compounds
//      that flake.
//   2. The failure mode this test protects against is a regression that
//      removes or weakens `thresholds.break` (the only enforcement bit) — a
//      static check on the config file catches it deterministically.
//
// Constitutional floor: thresholds.break >= 50 (per Plan 02 / TEST-MUTATION-01).

interface StrykerConfig {
  thresholds?: { high?: number; low?: number; break?: number };
  testRunner?: string;
  mutate?: string[];
}

describe("TEST-MUTATION-01 self-test: Stryker break threshold is configured", () => {
  const configPath = join(process.cwd(), "stryker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as StrykerConfig;

  it("stryker.config.json has thresholds.break set", () => {
    expect(config.thresholds, "thresholds object missing").toBeDefined();
    expect(
      config.thresholds?.break,
      "thresholds.break must be set for the mutation gate to fire",
    ).toBeTypeOf("number");
  });

  it("thresholds.break is >= constitutional floor of 50", () => {
    const breakValue = config.thresholds?.break ?? 0;
    expect(breakValue).toBeGreaterThanOrEqual(50);
  });

  it("thresholds are well-ordered: high >= low >= break", () => {
    const high = config.thresholds?.high ?? 0;
    const low = config.thresholds?.low ?? 0;
    const breakValue = config.thresholds?.break ?? 0;
    expect(high).toBeGreaterThanOrEqual(low);
    expect(low).toBeGreaterThanOrEqual(breakValue);
  });

  it("testRunner is vitest (matches Plan 02 stack pick)", () => {
    expect(config.testRunner).toBe("vitest");
  });

  it("mutate globs are non-empty", () => {
    expect(Array.isArray(config.mutate)).toBe(true);
    expect((config.mutate ?? []).length).toBeGreaterThan(0);
  });
});
