// SPDX-License-Identifier: Apache-2.0
// Phase 13 / Plan 01 / Task 04 — per-package 90/90/90/90 coverage floor on
// the shared email-sending library. Mirrors packages/litellm-client/vitest.config.ts.
//
// Invocation: `pnpm --filter @openwhispr/email test --coverage`.
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
