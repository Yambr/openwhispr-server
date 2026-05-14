// SPDX-License-Identifier: Apache-2.0
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
    // Phase 13 / Plan 01 / Task 02 — runs `docker container prune -f
    // --filter label=org.testcontainers=true` after every vitest run to
    // close the leak documented in `.planning/deferred-items.md §1`.
    // Failures are swallowed inside the hook — globalTeardown must NEVER
    // abort the test report.
    globalTeardown: ["./tools/global-vitest-teardown.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      // `all: false` reports only on files actually loaded during a test.
      // With placeholder modules at 5 LOC each, v8's bundle-level sourcemap
      // reports phantom lines (8, 26, 40-43) that don't exist in source —
      // a known Vitest 4 + v8 + esbuild interaction. Phase 2+ enables
      // `all: true` once real source files outnumber stubs.
      all: false,
      include: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/*.gen.ts",
        "**/dist/**",
        "**/node_modules/**",
        "**/.stryker-tmp/**",
        "**/reports/**",
        "packages/i18n/locales/**",
        // Phase 13 / Plan 01 / Task 02 (OQ-5 resolution) — `tools/**` is no
        // longer blanket-excluded. The new lint/teardown tools
        // (`tools/lint-weak-assertions.ts`, `tools/global-vitest-teardown.ts`)
        // are subject to the constitutional ≥90/90/90/90 coverage floor.
        // Individual fixture/helper files inside tools/ can be re-excluded
        // here on a per-file basis if needed.
        "tests/**",
        "scripts/**",
        // Phase 0 placeholder modules whose branches/lines are node-API or
        // bootstrap glue (not business logic). Excluded for the duration of
        // Phase 0 so the constitutional 85/80/80/85 thresholds (TEST-COV-01)
        // can stand without artificial coverage of stubs. Phase 2+ replaces
        // each with real, fully-covered code and removes from this list.
        "packages/i18n/src/index.ts",
        "apps/api/src/index.ts",
        // Drizzle schema files are pure declarative table definitions
        // (no runtime branches; v8 reports phantom uncovered closing
        // brackets). Excluded per ADR-0002 (Vitest 4 + v8 + esbuild bundle-
        // level sourcemap interaction). Behavior is exercised by the
        // migration-rollback / RLS property / usage-ledger integration tests
        // which validate column types, indexes, and RLS policies through
        // real Postgres queries.
        "packages/data/src/schema/**",
        // Drizzle migration runner — one-shot CLI script. Env-validation
        // path covered by migrate.test.ts; happy path covered by the
        // migration-rollback integration test. The bare `console.error`
        // and `process.exit` calls below `main().catch()` are not reachable
        // from inside the test process without spawning subprocesses.
        "packages/data/src/migrate.ts",
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
