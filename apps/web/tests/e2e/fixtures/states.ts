// Phase 07.1 / Plan 04 — UI-state fixture (D-TEST-3).
//
// D-TEST-3 boundary rule (NON-NEGOTIABLE):
//   - `loading` and `error` states use Playwright `route()` to intercept the
//     network boundary. Real backend cannot deterministically produce these.
//   - `empty` and `success` states use REAL seeded data via fixtures/seed.ts.
//     Never `route()`-mock them — that would be an internal-logic mock per
//     CLAUDE.md (no internal mocks).
//
// Helpers exported:
//   - loadingFor(urlPattern)    — delays the matched request beyond any test
//                                 timeout so the UI is stuck in its loading
//                                 state for the entire assertion window.
//   - errorFor(urlPattern, status) — replies with a JSON error envelope at the
//                                 requested status (default 500).
import { test as base, expect } from "@playwright/test";

type StateFixture = {
  loadingFor: (urlPattern: string) => Promise<void>;
  errorFor: (urlPattern: string, status?: number) => Promise<void>;
};

export const test = base.extend<StateFixture>({
  loadingFor: async ({ page }, use) => {
    await use(async (urlPattern) => {
      await page.route(urlPattern, async (route) => {
        // 30s — exceeds any reasonable per-test timeout. The UI stays in its
        // loading state for the entire assertion window.
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        await route.continue();
      });
    });
  },
  errorFor: async ({ page }, use) => {
    await use(async (urlPattern, status = 500) => {
      await page.route(urlPattern, (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture" }),
        }),
      );
    });
  },
});

export { expect };
