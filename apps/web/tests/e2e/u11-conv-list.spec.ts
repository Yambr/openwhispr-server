// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U11 conversations list (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real seeded data via fixtures/seed.ts.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

const ROUTE = "**/api/conversations/list**";

test.describe("U11 — conversations list (Phase 07.1 / Plan 11)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context, page }) => {
    await attachBrowserDiagnostics(page);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton rows while list endpoint is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(ROUTE);
    await page.goto("/app/conversations");
    await expect(page.locator('[data-testid="conv-list-skeleton-row"]').first()).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("empty state — friendly empty card after clearAllData", async ({ page }) => {
    await page.goto("/app/conversations");
    await expect(page.getByText(/No conversations yet/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(ROUTE, 500);
    await page.goto("/app/conversations");
    await expect(page.getByText(/Could not load conversations/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("success state — N seeded rows render", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedConversations({ count: 3 });
    await page.goto("/app/conversations");
    await expect(page.getByText(/Seed Conversation 0/)).toBeVisible();
    await expect(page.getByText(/Seed Conversation 1/)).toBeVisible();
    await expect(page.getByText(/Seed Conversation 2/)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA clean on populated list", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedConversations({ count: 1 });
    await page.goto("/app/conversations");
    await expect(page.getByText(/Seed Conversation 0/)).toBeVisible();
    await runAxe(page);
    expectNoBrowserErrors(page);
  });
});
