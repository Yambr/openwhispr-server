// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 2 / Plan 06 — CONTRACT-01 conformance suite vitest config.
//
// Runs against a real deployed backend (not in-process). Tests reach the
// API exclusively through `globalThis.fetch` keyed on env BACKEND_URL /
// AUTH_URL — see env.ts. When neither is set the tests default to
// `http://api.localhost` (Plan 02 docker-compose Traefik route).
//
// retry: 0 — flaky tests fail loudly so the root cause must be fixed
// rather than masked. testTimeout: 60s accommodates the 100-concurrent
// rotation test and full sign-in flow round trips.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    reporters: ["dot"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 0,
    globals: false,
  },
});
