// SPDX-License-Identifier: FSL-1.1-ALv2
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
// Plan 13.1 — chain the auth-fixture's `test` so specs importing from
// states.ts inherit the worker-scoped `storageState` override. Specs that
// need to start signed-out import from `@playwright/test` directly.
import { test as base, expect } from "./auth.js";

type StateFixture = {
  loadingFor: (urlPattern: string) => Promise<void>;
  errorFor: (urlPattern: string, status?: number) => Promise<void>;
};

export const test = base.extend<StateFixture>({
  loadingFor: async ({ page }, use, testInfo) => {
    await use(async (urlPattern) => {
      // Phase 53 / Plan 53-33 — under slim the RSC pages prefetch via
      // internalApiUrl() (api:3000 inside the docker network). The
      // fetch fires server-side, BEFORE the spec gets a chance to
      // attach page.route(). The Skeleton never renders. Until a
      // server-side intercept lands (BUG-53-27), auto-skip these tests
      // under the slim project. Traefik project routes /api/* through
      // the same ingress as the browser, so page.route still wins
      // there. Caller can opt out by setting OPENWHISPR_FORCE_RSC=1.
      if (
        testInfo.project.metadata.topology === "slim" &&
        process.env.OPENWHISPR_FORCE_RSC !== "1"
      ) {
        testInfo.skip(true, "loading-state spec needs server-side intercept under slim");
        return;
      }
      await page.route(urlPattern, async (route) => {
        // 30s — exceeds any reasonable per-test timeout. The UI stays in its
        // loading state for the entire assertion window.
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        await route.continue();
      });
    });
  },
  errorFor: async ({ page }, use, testInfo) => {
    await use(async (urlPattern, status = 500) => {
      // Phase 53 / Plan 53-33 — same RSC prefetch reason as loadingFor.
      if (
        testInfo.project.metadata.topology === "slim" &&
        process.env.OPENWHISPR_FORCE_RSC !== "1"
      ) {
        testInfo.skip(true, "error-state spec needs server-side intercept under slim");
        return;
      }
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
