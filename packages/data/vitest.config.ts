// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 3 / Plan 02 / Task 4 (HIGH-3 fix) — per-package coverage floor.
// See apps/api/vitest.config.ts for the architectural rationale.
//
// Invocation: `pnpm --filter @openwhispr/data test --coverage`.
//
// NOTE: the root config already excludes `packages/data/src/schema/**`
// (Drizzle declarative tables — phantom v8 sourcemap branches per ADR-0002)
// and `packages/data/src/migrate.ts` (one-shot CLI). Those exclusions
// flow through via mergeConfig and the 90% floor applies to the
// remaining business-logic surface (tenant-context, encryption, etc.).
import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      // D-08 (Phase 18.1.1 / Plan 03) — share the testcontainer-reaper
      // SIGINT/SIGTERM hook so an interrupted packages/data test run prunes
      // orphan postgres containers like apps/api + apps/worker.
      setupFiles: ["../../tools/testcontainer-reaper-setup.ts"],
      // Phase 53 / Plan 53-10 — testcontainer postgres tests in this
      // package collide on Docker container teardown when run in parallel
      // (Dockerd HTTP 409 `removal already in progress`); the Ryuk reaper
      // races with vitest's afterAll cleanups across worker forks.
      // fileParallelism=false + singleFork forces strictly-sequential
      // execution within the package. Every test boots its own ephemeral
      // container regardless of pool, so the runtime cost is bounded and
      // the tradeoff is determinism over wall-clock seconds.
      fileParallelism: false,
      pool: "forks",
      singleFork: true,
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
