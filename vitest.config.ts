import { defineConfig } from "vitest/config";

// Vitest 4 root config for the pnpm monorepo. Discovers tests across all
// workspaces and enforces v8 native coverage thresholds.
//
// CRITICAL (RESEARCH Pitfall #1, the v2->v4 silent-breakage trap):
// `thresholds` MUST be NESTED under `coverage.thresholds.*`. The Vitest 2
// flat-key shape (`coverage.lines`, `coverage.branches`) is silently ignored
// by Vitest 4 — it parses without error and runs without enforcement, which
// is the single highest-risk failure mode for the constitutional coverage
// gate. Do not move these keys to the flat shape.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      include: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.gen.ts",
        "**/dist/**",
        "**/node_modules/**",
        "packages/i18n/locales/**",
        "tools/**",
        "tests/**",
        "scripts/**",
      ],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 80,
        statements: 85,
      },
    },
  },
});
