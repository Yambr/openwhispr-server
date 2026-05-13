// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 04 — Vitest sentinel.
//
// Reason for existence: vitest exits with code 1 if no test files match.
// Until Plans 05+ land real production code with real vitest specs, this
// sentinel keeps `pnpm --filter @openwhispr/web test:unit` green so the
// coverage thresholds (90/90/90/90) configured in vitest.config.ts have
// a passing baseline to fire against. Excluded from coverage reporting
// in vitest.config.ts so it doesn't inflate the floor on itself.
import { describe, expect, it } from "vitest";

describe("vitest sentinel", () => {
  it("keeps the test runner alive until real specs ship", () => {
    expect(true).toBe(true);
  });
});
