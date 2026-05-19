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
    // Phase 15 / Plan 02 (STRUCT-01) — tests live under tests/unit/ post-move.
    // Phase 56 (R9 folders, R11 transcriptions, R8 notes) — per-resource
    // CONTRACT-01 wire-shape tests colocated under src/ are also picked
    // up (e.g. folders-shape.test.ts, transcriptions-shape.test.ts,
    // notes-shape.test.ts). They assert zod-schema + status-code
    // invariants without needing a live BACKEND_URL.
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    reporters: ["dot"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 0,
    globals: false,
  },
});
