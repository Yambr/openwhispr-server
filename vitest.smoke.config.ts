// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 22 / Plan 22-01 / SR-22.1 — vitest config for tests/smoke/**.
//
// Smoke probes are HTTP-driven synthetic transactions that run AFTER
// `docker compose up --wait` and BEFORE the heavier `make e2e-cjm`. The
// suite targets < 5 s total wall-clock and surfaces broken routes /
// host-split / auth-gate regressions in milliseconds instead of waiting
// for a 60 s Playwright cycle.
//
// This config intentionally:
//   - does NOT enforce coverage (probes are I/O-bound, not unit-tested code)
//   - does NOT inherit the root `projects` array (a single flat suite)
//   - sets a hard 10 s per-test timeout (each probe budgets < 1 s but
//     occasionally TLS handshake or container warm-up needs slack)
//   - uses globalTeardown to share testcontainer-prune behaviour with the
//     root config so any leaked container is cleaned up if a probe crashes.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/**/*.smoke.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 5_000,
    globalTeardown: ["./tools/global-vitest-teardown.ts"],
    reporters: ["default"],
    // Run probes sequentially — they all hit the same Traefik instance
    // and may share rate-limit buckets; serial is cheaper than tuning
    // parallelism for ~5 tiny probes.
    fileParallelism: false,
  },
});
