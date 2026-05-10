// tests/e2e — Phase 04 / Plan 09 vitest config for the realtime+stream
// e2e suite (`make e2e-test` target).
//
// This config is DISTINCT from `vitest.config.ts` (the legacy
// DISCIPLINE rule 3 back-fill suite that discovers `*.e2e.test.ts`).
// Plan 09 introduces two new tests under the simpler `*.test.ts`
// glob to keep the realtime+stream suite independently runnable
// without dragging in the legacy diarization/transcribe/reason
// e2e fixtures (which require a different stack-up shape).
//
// Discovery:
//   include: ['tests/e2e/**/*.test.ts']
//   exclude: ['tests/e2e/mock-realtime/**']  // mock-realtime ships its own vitest config
//
// Timeouts:
//   testTimeout 600_000  // 10 min — covers the 5-min hermetic soak (+ buffer)
//   hookTimeout 600_000  // covers compose stack-up cold pull
//
// Sequencing:
//   fileParallelism false / sequence.concurrent false
//   The two tests share a single docker-compose stack via the e2e
//   profile; running them in parallel would saturate the api ingress.
//
// E2E gate:
//   Default include is empty unless E2E=1 — mirrors the convention from
//   tests/e2e/vitest.config.ts. The Makefile e2e-test target sets E2E=1.
import { defineConfig } from "vitest/config";

const E2E_ENABLED = process.env.E2E === "1";

export default defineConfig({
  test: {
    // Discover ONLY direct *.test.ts files in tests/e2e/ (not nested
    // dependency test files under tests/e2e/node_modules/**). Plan 09
    // adds two named files; the glob is shaped to match those exactly:
    //   tests/e2e/agent-stream-first-line-latency.test.ts
    //   tests/e2e/realtime-soak-hermetic.test.ts
    // Future Plan-09-class siblings drop into the same directory.
    include: E2E_ENABLED ? ["tests/e2e/*.test.ts"] : [],
    // Exclude:
    //   * mock-realtime — has its own vitest config (Plan 07)
    //   * legacy `*.e2e.test.ts` files — discovered by tests/e2e/vitest.config.ts
    //     (DISCIPLINE rule 3 back-fill; runs under `make e2e-hermetic`).
    //     This Plan-09 config owns ONLY `*.test.ts` (no `.e2e.` infix)
    //     so the two suites don't shadow each other.
    exclude: [
      "**/node_modules/**",
      "dist/**",
      "tests/e2e/mock-realtime/**",
      "tests/e2e/**/*.e2e.test.ts",
    ],
    reporters: ["verbose"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    retry: 0,
    globals: false,
    environment: "node",
  },
});
