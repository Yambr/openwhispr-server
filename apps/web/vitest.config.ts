// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 04 — Vitest config (D-TEST-2, D-TEST-4).
//
// Decisions enforced here:
//   - happy-dom test environment for React 19 + @testing-library/react. Faster
//     than jsdom on cold start and sufficient for the component surface we
//     test (no Web APIs beyond DOM events + fetch).
//   - v8 coverage provider; thresholds 90/90/90/90 per CLAUDE.md TDD-02.
//   - Coverage exclusions per RESEARCH § vitest.config.ts:
//       * `src/app/**/page.tsx`, `src/app/**/layout.tsx` — RSC routes are
//         exercised end-to-end by Playwright; vitest cannot meaningfully
//         render them and counting them dilutes the floor.
//       * `src/components/ui/**` — vendored shadcn primitives (covered by
//         upstream).
//       * `src/lib/__tests__/coverage-sentinel.test.ts` — keepalive sentinel
//         that gives vitest a passing file to run before real production code
//         exists; it would otherwise inflate coverage on itself.
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    // Playwright owns tests/e2e/**/*.spec.ts; vitest must not load those
    // files (their `test.describe` is the @playwright/test runner, not the
    // vitest one). Unit tests for the playwright support helpers live in
    // `tests/e2e/**/__tests__/*.test.ts` (Phase 54 / Plan 54-01) — they
    // mock the HTTP boundary and run under vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "tests/e2e/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        // RSC routes are exercised end-to-end by Playwright, not vitest.
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/app/**/route.ts",
        // Vendored shadcn primitives + the canonical shadcn `cn` helper.
        // Upstream covers these; counting them dilutes the diff floor.
        "src/components/ui/**",
        "src/lib/utils.ts",
      ],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
