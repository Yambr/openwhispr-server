// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 11 — U13 conversations search (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real seeded data via fixtures/seed.ts.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const ROUTE = "**/api/conversations/search**";

test.describe("U13 — conversations search (Phase 07.1 / Plan 11)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context }) => {
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton rows while search endpoint stalls", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(ROUTE);
    await page.goto("/app/conversations/search?q=seed");
    await expect(page.locator('[data-testid="conv-search-skeleton-row"]').first()).toBeVisible();
  });

  test("empty state — Type-a-query message when q is absent", async ({ page }) => {
    await page.goto("/app/conversations/search");
    await expect(page.getByText(/Type a query to search/i)).toBeVisible();
  });

  test("error state — Alert when search endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(ROUTE, 500);
    await page.goto("/app/conversations/search?q=anything");
    await expect(page.getByText(/Search failed/i)).toBeVisible();
  });

  test("success state — seeded conversation matches title query", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedConversations({ count: 1, title: "Quarterly roadmap planning" });
    await page.goto("/app/conversations/search?q=roadmap");
    await expect(page.getByText(/Quarterly roadmap planning/i)).toBeVisible();
  });

  test("axe — WCAG 2.2 AA clean on populated search", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedConversations({ count: 1, title: "Quarterly roadmap planning" });
    await page.goto("/app/conversations/search?q=roadmap");
    await expect(page.getByText(/Quarterly roadmap planning/i)).toBeVisible();
    await runAxe(page);
  });
});
