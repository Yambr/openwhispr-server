// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 3 / Plan 02 / Task 4 (HIGH-3 fix) — per-package coverage floor.
//
// CLAUDE.md mandates a per-phase ≥90% coverage floor on all new/modified
// code. The root `vitest.config.ts` enforces 85/80/80/85 project-wide;
// Phase-3 plans 03..08 ship their `<done>` blocks with a 90% claim. This
// config raises the floor to 90/90/90/90 for files in `apps/api/src/**`,
// scoped narrowly to this package via `coverage.include`.
//
// CRITICAL (RESEARCH Pitfall #1 — Vitest 4 silent-breakage trap):
// thresholds MUST be NESTED under `coverage.thresholds.*`. The flat
// shape (`coverage.lines`, `coverage.branches`) is silently ignored
// by Vitest 4 — it parses without error and runs without enforcement,
// which is the single highest-risk failure mode for the constitutional
// coverage gate. See the long comment block in the root vitest.config.ts.
//
// Invocation: `pnpm --filter @openwhispr/api test --coverage` (used by
// Plans 03..06 in their `<done>` blocks).
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // Phase 13 / Plan 01 / Task 02 — install SIGINT/SIGTERM handlers that
      // prune leaked testcontainers when a vitest run is interrupted. See
      // tools/global-vitest-teardown.ts and `.planning/deferred-items.md §1`.
      setupFiles: ["./vitest.setup.ts"],
      coverage: {
        // Narrow to this package's source files. The root config's
        // exclude list still applies (placeholder modules etc.); when
        // Plan 03 Task 2 fills out apps/api/src/index.ts with real
        // multipart-registration lines, drop the root-level exclusion
        // for that file in the SAME commit.
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
