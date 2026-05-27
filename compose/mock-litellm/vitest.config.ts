// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 08 / Plan 03 — package-local vitest config for @openwhispr/mock-litellm.
//
// CLAUDE.md mandates ≥90/90/90/90 coverage on diff. We pin those
// thresholds here so the package is verified in isolation via
// `pnpm --filter @openwhispr/mock-litellm test:coverage`.
//
// CRITICAL: thresholds MUST be nested under `coverage.thresholds.*` —
// the flat shape is silently ignored by Vitest 4.
//
// `src/server-bootstrap.ts` is the single untestable line (it calls
// `startServer()` when the module is the process entrypoint) and is
// excluded from coverage accounting.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Quick 260527-pj6 — explicit project name pins the per-workspace
    // evidence-fragment filename. See tools/test-evidence-projects-manifest.json.
    name: "mock-litellm",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/server-bootstrap.ts", "dist/**", "node_modules/**"],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
