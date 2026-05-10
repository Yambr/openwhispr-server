// Phase 3 / Plan 02 / Task 4 (HIGH-3 fix) — per-package coverage floor.
// See apps/api/vitest.config.ts for the architectural rationale.
//
// Invocation: `pnpm --filter @openwhispr/litellm-client test --coverage`.
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      coverage: {
        include: ["src/**/*.ts"],
        thresholds: {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  }),
);
