// SPDX-License-Identifier: FSL-1.1-ALv2
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Phase 15 / Plan 02 (STRUCT-01) — root-relative anchor so the
// `projects` array resolves correctly even when this config is
// `mergeConfig`'d into a child workspace config (e.g.
// apps/api/vitest.config.ts), which would otherwise re-anchor the
// relative paths against the child's directory.
const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const p = (rel: string): string => resolve(ROOT_DIR, rel);

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
    // Phase 15 / Plan 02 (STRUCT-01) — Vitest 3.2+ `projects` array
    // replacing the deprecated `workspace` field (CONTEXT Q4). Each
    // entry is a glob to a workspace vitest.config.ts that declares
    // its own test surface (anchored at `tests/**/*.test.ts` post-
    // migrate-tests-codemod from 15-01). Workspaces without an inline
    // vitest.config.ts are not standalone projects; their tests are
    // discovered via the apps/* and packages/* globs against the
    // inherited root config.
    projects: [
      // Explicit configs for workspaces that customize coverage /
      // timeouts. Paths are anchored at the root via `p(...)` so a
      // child workspace mergeConfig'ing this root doesn't re-anchor
      // the relative entries against its own dir.
      p("apps/api/vitest.config.ts"),
      p("apps/web/vitest.config.ts"),
      p("apps/worker/vitest.config.ts"),
      p("packages/byok-guard/vitest.config.ts"),
      p("packages/contract-tests/vitest.config.ts"),
      p("packages/data/vitest.config.ts"),
      p("packages/email/vitest.config.ts"),
      p("packages/litellm-client/vitest.config.ts"),
      p("tools/load-test/vitest.config.ts"),
      p("tools/test-probe/vitest.config.ts"),
      p("compose/mock-litellm/vitest.config.ts"),
      p("tests/e2e/vitest.config.ts"),
      p("tests/e2e/mock-realtime/vitest.config.ts"),
      // Workspaces WITHOUT an inline vitest.config.ts: declare an
      // inline project so `pnpm exec vitest run` discovers their
      // tests/ trees post-migrate-tests codemod.
      {
        extends: true,
        test: {
          name: "@openwhispr/auth-stub",
          root: p("packages/auth"),
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "@openwhispr/i18n-stub",
          root: p("packages/i18n"),
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "@openwhispr/observability",
          root: p("packages/observability"),
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "@openwhispr/wire-schemas",
          root: p("packages/wire-schemas"),
          include: ["tests/**/*.test.ts"],
        },
      },
      // Phase 15 / Plan 03 — `tools/` ships standalone CLI codemods +
      // linters (spdx-header, lint-*, migrate-tests) tested via sibling
      // *.test.ts and __tests__/*.test.ts files. After the Plan 15-02
      // switch to a `projects:` array, these files were no longer
      // covered by any project entry; this entry restores them so
      // `pnpm test:spdx-header` and `pnpm test:lint-*` run.
      {
        extends: true,
        test: {
          name: "tools",
          root: p("tools"),
          include: ["*.test.ts", "__tests__/*.test.ts"],
          // Exclude per-workspace tools/ subdirs that ship their own
          // vitest.config.ts (load-test, test-probe) — those are
          // separate projects above.
          exclude: ["load-test/**", "test-probe/**", "node_modules/**", "dist/**"],
        },
      },
      // Phase 17 / WR-01 (review-fix) — pure-helper unit tests that live
      // alongside the Gherkin step modules under tests/e2e-cjm/steps/.
      // The Gherkin runtime itself (playwright-bdd) is invoked via
      // `pnpm test:e2e-cjm`, NOT vitest; this entry only picks up the
      // sibling __tests__/*.test.ts unit-test files that exercise pure
      // predicates extracted from steps for testability.
      {
        extends: true,
        test: {
          name: "tests-e2e-cjm-steps",
          root: p("tests/e2e-cjm/steps"),
          include: ["__tests__/*.test.ts"],
        },
      },
      // Phase 53 / Plan 53-01 — browser-diagnostics helper unit tests.
      // Sibling to the Gherkin step modules; picks up *.test.ts files
      // colocated with the helper module in tests/e2e-cjm/support/.
      {
        extends: true,
        test: {
          name: "tests-e2e-cjm-support",
          root: p("tests/e2e-cjm/support"),
          include: ["*.test.ts"],
        },
      },
      // Phase 23 / Plan 23-01 / SR-23.1 — tests/integration/ surface.
      // Pre-Phase-23 these files (docs-operations-byok-matrix.test.ts,
      // compose-overlays.test.ts, env-slim-example.test.ts, …) had NO
      // explicit project entry — they were picked up incidentally by
      // an earlier flat-glob root config. After the v3 projects-array
      // migration the surface drifted out of discovery. This entry
      // restores it so the BYOK provider-matrix integration test (and
      // every other tests/integration/*.test.ts file) is part of
      // `pnpm test`.
      {
        extends: true,
        test: {
          name: "tests-integration",
          root: p("tests/integration"),
          include: ["**/*.test.ts"],
        },
      },
      // Phase 44 / Plan 44-01 — self-tests project entry. Same drift as
      // tests/integration above: no project entry post-v3 migration, so
      // the new load-smoke-cost-discipline self-test was undiscovered.
      {
        extends: true,
        test: {
          name: "tests-self-tests",
          root: p("tests/self-tests"),
          include: ["**/*.test.ts"],
          // Self-tests own the same `openwhispr` docker-compose project
          // exclusively — running them in parallel makes each test's
          // `afterAll: down -v` rip out the other test's containers
          // mid-flight, producing a 200ms cascade fail. Force a single
          // forked worker so the docker-compose-touching tests are
          // strictly sequential. CPU-cheap because each test is
          // I/O-bound on `docker compose up --wait`.
          // Vitest 4 flattened `poolOptions.forks.singleFork` into the
          // top-level `singleFork` flag (migration: vitest.dev/guide/
          // migration#pool-rework). The deprecated nested form here
          // emitted DEPRECATED at startup and cascaded to a file-level
          // `not ok` result even when every contained `it()` passed.
          fileParallelism: false,
          pool: "forks",
          singleFork: true,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json", "lcov"],
      reportsDirectory: "./coverage",
      // Vitest defaults `reportOnFailure: false`, meaning a single failed
      // test file aborts the whole coverage finalize step — including the
      // `json-summary` reporter — and CI's `davelosert/vitest-coverage-
      // report-action` step crashes with ENOENT on
      // `coverage/coverage-summary.json`. Flip it on so coverage is always
      // written, regardless of test outcome; the test step's own non-zero
      // exit code remains the legitimate failure signal for CI.
      reportOnFailure: true,
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
        // BUG-53-36 — `__tests__/**` directories are test scaffolding
        // (setup.ts, fixtures, shared helpers) colocated next to the
        // source they exercise. v8 reports phantom uncovered branches
        // in their conditional fallbacks (e.g. `process.env.X ?? "…"`
        // in test setup) that have no production analog. Excluding the
        // directory mirrors how `*.test.ts` is already excluded above
        // — it's test code, not the unit under test.
        "**/__tests__/**",
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
        // BUG-53-36 — worker entrypoint is boot-wiring (BYOK guard,
        // encryption boot gate, OTel bootstrap, BullMQ worker construct)
        // mirroring apps/api/src/index.ts which is already excluded
        // above. Process-level branches (env-checks, exit codes) are
        // exercised through compose-stack integration tests, not unit
        // tests. v8 reports 0/14 branches because no unit test loads
        // the entrypoint.
        "apps/worker/src/index.ts",
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
