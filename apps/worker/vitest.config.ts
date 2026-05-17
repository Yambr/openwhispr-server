// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 03 Plan 08 — per-package coverage floor for apps/worker.
//
// CLAUDE.md mandates a per-phase ≥90% coverage floor on all new/modified
// code. The root `vitest.config.ts` enforces 85/80/80/85 project-wide;
// this plan creates the apps/worker package and so MUST author the
// per-package threshold raise to 90/90/90/90 (Plan 02 Task 4 wired the
// same shape for apps/api and packages/data).
//
// CRITICAL (RESEARCH Pitfall #1 — Vitest 4 silent-breakage trap):
// thresholds MUST be NESTED under `coverage.thresholds.*`. The flat
// shape (`coverage.lines`, `coverage.branches`) is silently ignored
// by Vitest 4.
//
// Invocation: `pnpm --filter @openwhispr/worker test --coverage`.
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // D-08 (Phase 18.1.1 / Plan 03) — share the testcontainer-reaper
      // SIGINT/SIGTERM hook with apps/api + packages/data so an interrupted
      // worker test run prunes orphan postgres containers identically.
      setupFiles: ["../../tools/testcontainer-reaper-setup.ts"],
      // Phase 53 / Plan 53-11 — same docker-container-removal race seen
      // in packages/data: parallel testcontainer teardowns collide with
      // the Ryuk reaper, producing intermittent HTTP 409 "removal already
      // in progress" cascade-fails. fileParallelism=false + singleFork
      // serializes container lifecycle across files inside this package.
      fileParallelism: false,
      pool: "forks",
      singleFork: true,
      coverage: {
        include: ["src/**/*.ts"],
        // Exclude the entry point and integration test container bootstrap —
        // entry is a thin process-level wiring layer covered by a smoke test;
        // integration test files are themselves test code.
        exclude: ["src/index.ts", "**/*.test.ts"],
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
