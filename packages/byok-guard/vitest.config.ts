// SPDX-License-Identifier: Apache-2.0
// Phase 14 / Plan 04 / Task 1 — per-package 90/90/90/90 coverage floor on
// the BYOK boot-time guard library. Mirrors packages/email/vitest.config.ts.
//
// Invocation: `pnpm --filter @openwhispr/byok-guard test --coverage`.
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
