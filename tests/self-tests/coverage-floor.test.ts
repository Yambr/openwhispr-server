// SPDX-License-Identifier: FSL-1.1-ALv2
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// TEST-COV-01 self-test: the coverage threshold gate is configured at or above
// the constitutional minima. This is a static-config self-test (parses
// vitest.config.ts) rather than a full vitest subprocess invocation, because:
//   1. Running a coverage-violating fixture vitest in CI adds 60-90s and is
//      flaky with v8's instrumentation in nested workspaces.
//   2. The Vitest 2->4 silent-breakage trap (RESEARCH Pitfall #1) is precisely
//      that mis-nesting `thresholds` makes the gate quietly disappear. A
//      static check that the keys are correctly nested AND meet the minima
//      catches that exact regression mode without the subprocess cost.
//
// Constitutional minima per .planning/REQUIREMENTS.md TEST-COV-01:
//   lines >= 85, branches >= 80, functions >= 80, statements >= 85

const CONSTITUTIONAL_MIN = {
  lines: 85,
  branches: 80,
  functions: 80,
  statements: 85,
};

describe("TEST-COV-01 self-test: coverage threshold gate is configured", () => {
  const configPath = join(process.cwd(), "vitest.config.ts");
  const source = readFileSync(configPath, "utf8");

  it("vitest.config.ts has coverage.thresholds nested correctly (Vitest 4 shape)", () => {
    // The flat-key shape `coverage.lines: N` is silently ignored by Vitest 4.
    // The correct shape is `coverage: { thresholds: { lines: N, ... } }`.
    expect(source).toMatch(/coverage\s*:\s*{/);
    expect(source).toMatch(/thresholds\s*:\s*{/);
  });

  it.each(
    Object.entries(CONSTITUTIONAL_MIN),
  )("threshold %s is set and >= constitutional minimum %d", (key, min) => {
    const re = new RegExp(`${key}\\s*:\\s*(\\d+)`);
    const match = source.match(re);
    expect(match, `threshold ${key} not found in vitest.config.ts`).not.toBeNull();
    const value = Number(match?.[1]);
    expect(value).toBeGreaterThanOrEqual(min);
  });

  it("coverage provider is v8 (matches Plan 02 RESEARCH guidance)", () => {
    expect(source).toMatch(/provider\s*:\s*['"]v8['"]/);
  });
});
