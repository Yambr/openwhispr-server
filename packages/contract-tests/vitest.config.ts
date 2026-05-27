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
    // Quick 260527-pj6 — explicit project name pins the per-workspace
    // evidence-fragment filename. See tools/test-evidence-projects-manifest.json.
    name: "@openwhispr/contract-tests",
    // Phase 15 / Plan 02 (STRUCT-01) — tests live under tests/unit/.
    // Phase 56 (R9 folders, R11 transcriptions, R8 notes) — per-resource
    // CONTRACT-01 wire-shape tests (folders-shape.test.ts,
    // transcriptions-shape.test.ts, notes-shape.test.ts) assert
    // zod-schema + status-code invariants without a live BACKEND_URL.
    // Phase 68 / Plan 68-01 — REVIEW byok HIGH HI-01/02: those *-shape
    // test files were moved out of `src/` into `tests/unit/` so they no
    // longer ship in the package tarball; only `tests/**` is scanned.
    include: ["tests/**/*.test.ts"],
    reporters: ["dot"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 0,
    globals: false,
  },
});
