// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08 / Plan 02 — vitest config for @openwhispr/load-test.
//
// Mirrors apps/api/vitest.config.ts: V8 coverage provider with the
// constitutional 90/90/90/90 thresholds (per CLAUDE.md). Scoped to
// src/**/*.ts. Only the k6 entry (src/main.ts) is excluded, because
// its runtime context is the k6 VM and cannot be loaded into vitest.
// Fixtures and tests are excluded from coverage targets as well.
// Plan 06 added the flows under coverage — they are pure functions
// taking an injectable HttpClient, so they ARE unit-testable.
//
// CRITICAL (Vitest 4 silent-breakage trap): thresholds MUST be NESTED
// under `coverage.thresholds.*`. The flat shape is silently ignored.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Quick 260527-pj6 — explicit project name pins the per-workspace
    // evidence-fragment filename. See tools/test-evidence-projects-manifest.json.
    name: "load-test",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      all: false,
      include: ["src/**/*.ts", "scripts/**/*.ts"],
      // k6.config.ts is pure constants consumed only by src/main.ts (the
      // k6 entrypoint). It cannot be unit-tested in isolation — the values
      // are static and their correctness is asserted by the plan-07 live
      // run, not vitest.
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "src/main.ts",
        "src/smoke.ts",
        // Phase 08.5-02: baseline.ts is the k6 entrypoint for the
        // realistic Mac baseline / operator H100 re-run. Same exclusion
        // rationale as main.ts — it imports k6/* runtime globals.
        // baseline-options.ts (the pure helper) IS covered.
        "src/baseline.ts",
        "src/k6.config.ts",
        "src/fixtures/**",
        // scripts/*.mjs are Node CLI helpers, not import-graph reachable.
        "scripts/**/*.mjs",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
