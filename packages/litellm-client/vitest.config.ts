// SPDX-License-Identifier: FSL-1.1-ALv2
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
      // Quick 260527-pj6 — explicit project name pins the per-workspace
      // evidence-fragment filename. See tools/test-evidence-projects-manifest.json.
      name: "@openwhispr/litellm-client",
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
