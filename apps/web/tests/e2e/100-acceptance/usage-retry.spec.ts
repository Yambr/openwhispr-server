// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-06-a — Long-form acceptance: /app usage Retry button click.
// Closes UC-USAGE-RETRY-CLICK from RESEARCH.md §"/app" (Network error →
// Retry button → refetch succeeds).
//
// Pattern: the RSC server-side prefetch in `apps/web/src/app/(auth)/app/page.tsx`
// hits api:3000 inside docker, bypassing browser-attached page.route.
// We DO NOT try to intercept the initial RSC fetch — let it succeed.
// Then we INVALIDATE the cache via the Refresh button while a 500 stub
// is armed, which forces a CLIENT-side refetch (which page.route DOES
// intercept). Cache flips to isError → UsageDashboardClient.tsx:80-95
// renders Alert + Retry. Unroute, click Retry, cache flips back to
// success.
//
// Slim-only. Per-worker authenticated fixture (alice+0).

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const test = base.extend({});

const USAGE_ROUTE = "**/api/usage";

test.describe("@phase55-acceptance @long-form — usage retry button (slim)", () => {
  test.use({ storageState: storageStatePath(0) });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "slim", "Phase 55-06-a runs against slim topology only");
    await attachBrowserDiagnostics(page);
    allowBrowserErrors(page, [
      /api\/usage[^\n]*500/i,
      /Failed to load resource[^\n]*\/api\/usage/i,
    ]);
  });

  test("usage retry: refresh-into-500 → Alert + Retry → click → 200 → KPI cards populate — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — initial RSC prefetch succeeds; KPI cards render", async () => {
      await page.goto("/app");
      // Wait for at least one KPI card (hydration done).
      await expect(page.getByTestId("kpi-words-used")).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — arm 500 stub on /api/usage, then click Refresh to force client refetch", async () => {
      await page.route(USAGE_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-500" }),
        }),
      );
      // Refresh invalidates queryKeys.usage() → client refetches via
      // browser-attached fetch, which page.route NOW intercepts → 500.
      await page.getByRole("button", { name: /^Refresh$/i }).click();
      // Cache flipped to isError → Alert + Retry render.
      await expect(page.getByRole("button", { name: /^Retry$/i })).toBeVisible({
        timeout: 10_000,
      });
      // KPI cards unmounted (we're in the error branch).
      await expect(page.getByTestId("kpi-words-used")).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — unroute, click Retry, KPI cards re-render", async () => {
      await page.unroute(USAGE_ROUTE);
      await page.getByRole("button", { name: /^Retry$/i }).click();
      // Success branch — KPI cards back, Retry gone.
      await expect(page.getByTestId("kpi-words-used")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: /^Retry$/i })).toHaveCount(0);
      expectNoBrowserErrors(page);
    });
  });
});
