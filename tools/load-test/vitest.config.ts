// Phase 08 / Plan 02 — vitest config for @openwhispr/load-test.
//
// Mirrors apps/api/vitest.config.ts: V8 coverage provider with the
// constitutional 90/90/90/90 thresholds (per CLAUDE.md). Scoped to
// src/**/*.ts; the k6 entry (src/main.ts) and flow files are excluded
// because their runtime context is k6, not vitest. Fixtures and tests
// are excluded from coverage targets as well.
//
// CRITICAL (Vitest 4 silent-breakage trap): thresholds MUST be NESTED
// under `coverage.thresholds.*`. The flat shape is silently ignored.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      all: false,
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "src/main.ts", "src/flows/**", "src/fixtures/**"],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
