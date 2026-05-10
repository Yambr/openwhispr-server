// tests/e2e — host-side e2e vitest config (DISCIPLINE rule 3 back-fill).
//
// Opt-in via `E2E=1`. Without the env flag the suite bails immediately
// so `pnpm test` (root) never picks these up — the host-side e2e is
// gated on a live docker-compose stack and would fail-by-fetch otherwise.
//
// testTimeout: 600s — the global setup brings the entire compose stack
// up via `docker compose --profile default --profile contract-test up
// -d --wait` which can take 60-180s on a cold cache. Individual test
// bodies typically resolve in <2s.
//
// pool: forks (vitest default) + maxConcurrency 1 — every e2e test
// shares the SAME compose stack instance and the same fixture user
// rate-limit buckets at Better Auth. Sequential execution keeps the
// rate-limit interactions deterministic.
import { defineConfig } from "vitest/config";

const E2E_ENABLED = process.env.E2E === "1";

export default defineConfig({
  test: {
    include: E2E_ENABLED ? ["**/*.e2e.test.ts"] : [],
    exclude: ["node_modules/**", "dist/**"],
    reporters: ["verbose"],
    // Compose stack-up dominates wall time; 10 minutes covers worst-case
    // cold image pulls on CI runners.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Force sequential execution: shared compose stack, shared fixture
    // users, shared Better-Auth rate-limit buckets.
    fileParallelism: false,
    sequence: { concurrent: false },
    retry: 0,
    globals: false,
    globalSetup: ["./setup.ts"],
  },
});
