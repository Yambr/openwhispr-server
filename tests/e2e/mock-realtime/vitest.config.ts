import { defineConfig } from "vitest/config";

// Phase 04 Plan 07 — package-local vitest config.
//
// The repo-root vitest.config.ts excludes `tests/**` from coverage so the
// monorepo-wide thresholds are not skewed by fixture or e2e helper code.
// This package, however, is itself a tiny standalone service with real
// branches/lines (the OpenAI Realtime mock protocol handler) and Phase 04
// constitutional rule mandates >=90/90/90/90 on new/modified code. We
// therefore set local coverage thresholds + include only this package's
// `server.ts`. CI runs `pnpm --filter @openwhispr/mock-realtime test` so
// this config is the one that fires.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["server.ts"],
      exclude: ["**/*.test.ts", "dist/**", "node_modules/**"],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
