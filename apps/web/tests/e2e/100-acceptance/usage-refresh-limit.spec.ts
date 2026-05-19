// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-13 — Long-form acceptance: /app UsageDashboardClient surfaces.
//
// Closes two UCs flagged MISSING by the Phase 55 UC coverage audit
// (RESEARCH.md §"/app"):
//
//   1. UC-USAGE-REFRESH-BUTTON
//      UsageDashboardClient.tsx:112-119 — Refresh button onClick calls
//      `queryClient.invalidateQueries({ queryKey: queryKeys.usage() })`
//      which triggers a fresh GET /api/usage from the browser.
//
//   2. UC-USAGE-LIMIT-REACHED-BADGE
//      UsageDashboardClient.tsx:154-166 — when `data.limitReached === true`
//      the Badge renders with variant="destructive" and text "Yes".
//
// Why this surface is e2e-able under slim (mirrors sessions-retry.spec.ts):
//   The /app page server-prefetches /api/usage via internalApiUrl, so the
//   first paint reads from the dehydrated cache (page.route MISSES that RSC
//   fetch — it goes api:3000 directly inside the docker network). BUT the
//   CLIENT useQuery invalidation on Refresh click fires from the browser,
//   so `page.route('**/api/usage')` wins that round-trip. The Phase 53-33
//   slim-skip on `errorFor` does NOT apply — we are intentionally letting
//   the RSC fetch through and only intercepting the post-hydration refetch.
//
// Per-worker fixture-user inheritance — uses the standard alice+N pool
// (storageState comes from fixtures/auth.ts via the chained `test` from
// fixtures/states.ts).
//
// Slim-only by design — production-equivalent routing is covered by the
// Phase 07.1 u4-usage state matrix.

import { expect, test } from "../fixtures/states.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const USAGE_ROUTE = "**/api/usage";

test.describe("@phase55-acceptance @long-form — usage dashboard refresh + limit-reached (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-13 done-gate grep
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-13 acceptance suite runs against slim topology only — traefik path covered by Phase 07.1 u4-usage state matrix",
    );
    await attachBrowserDiagnostics(page);
  });

  test("usage dashboard: refresh click invalidates query + limit-reached badge renders destructive Yes — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — pre-arm route stub returning limitReached=true for client-side /api/usage refetch", async () => {
      // The RSC server-side prefetch goes api:3000 directly and bypasses
      // page.route under slim, so the first paint shows the real (empty)
      // usage. The post-hydration client refetch on Refresh click WILL hit
      // this stub because it originates inside the browser.
      await page.route(USAGE_ROUTE, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            wordsUsed: 100,
            wordsRemaining: 0,
            plan: "free",
            limitReached: true,
          }),
        }),
      );
    });

    await test.step("step 2 — goto /app, wait for hydration, assert KPI cards visible", async () => {
      await page.goto("/app");
      await expect(page).toHaveURL(/\/app$/);
      // All four KPI cards render after hydration (regardless of the
      // actual wordsUsed/limitReached values from RSC prefetch).
      await expect(page.getByTestId("kpi-words-used")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("kpi-words-remaining")).toBeVisible();
      await expect(page.getByTestId("kpi-plan")).toBeVisible();
      await expect(page.getByTestId("kpi-limit-reached")).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — UC-USAGE-REFRESH-BUTTON: click Refresh → fresh GET /api/usage fires from the browser", async () => {
      // Pre-arm the waitForRequest BEFORE the click so we deterministically
      // observe the in-flight refetch (queryClient.invalidateQueries triggers
      // a refetch for any active observer of queryKeys.usage()).
      const refetchPromise = page.waitForRequest(
        (req) => req.url().includes("/api/usage") && req.method() === "GET",
        { timeout: 10_000 },
      );
      await page.getByRole("button", { name: /^Refresh$/i }).click();
      const req = await refetchPromise;
      expect(req.method()).toBe("GET");
      expect(req.url()).toMatch(/\/api\/usage(\?|$)/);
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — UC-USAGE-LIMIT-REACHED-BADGE: after stubbed refetch resolves, badge shows destructive Yes", async () => {
      // The stubbed response (limitReached=true) becomes the new query
      // data after the Refresh-triggered refetch resolves. The Badge in
      // the kpi-limit-reached card flips to variant="destructive" with
      // text "Yes" (UsageDashboardClient.tsx:162-163).
      const limitReachedCard = page.getByTestId("kpi-limit-reached");
      await expect(limitReachedCard).toBeVisible();
      // Constitutional EN-only matcher.
      await expect(limitReachedCard.getByText("Yes", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      // Defence-in-depth: destructive variant of shadcn/ui Badge carries
      // the bg-destructive class. We assert the badge element receives it
      // so the visual signal is what UI-SPEC asks for, not just the text.
      const badge = limitReachedCard.getByText("Yes", { exact: true });
      await expect(badge).toHaveClass(/bg-destructive/);
      // Cross-card invariant — the stubbed payload propagated to every KPI,
      // not just limit-reached. wordsUsed=100 and plan=free prove the
      // post-Refresh data replaced the RSC-prefetched values (which would
      // have been wordsUsed=0 + plan=unlimited from the real /api/usage).
      // This upgrades UC-USAGE-REFRESH-BUTTON from "request fired" to
      // "request resolved + state updated" — the actual user-visible effect
      // the Refresh button promises.
      await expect(page.getByTestId("kpi-words-used")).toContainText("100");
      await expect(page.getByTestId("kpi-plan")).toContainText("free");
      expectNoBrowserErrors(page);
    });
  });
});
