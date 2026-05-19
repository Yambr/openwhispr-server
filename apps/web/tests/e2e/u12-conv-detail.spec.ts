// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 11 — U12 conversation detail (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real seeded data via fixtures/seed.ts.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

const MESSAGES_ROUTE = "**/api/conversations/messages**";

test.describe("U12 — conversation detail (Phase 07.1 / Plan 11)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context, page }) => {
    await attachBrowserDiagnostics(page);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton while messages endpoint stalls", async ({
    page,
    loadingFor,
    context,
  }) => {
    const seed = bindToContext(context);
    const convs = await seed.seedConversations({ count: 1, withMessages: 1 });
    await loadingFor(MESSAGES_ROUTE);
    await page.goto(`/app/conversations/${convs[0]!.id}`);
    await expect(page.locator('[data-testid="conv-detail-skeleton"]').first()).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("empty state — No messages card when conversation has zero messages", async ({
    page,
    context,
  }) => {
    const seed = bindToContext(context);
    const convs = await seed.seedConversations({ count: 1, withMessages: 0 });
    await page.goto(`/app/conversations/${convs[0]!.id}`);
    await expect(page.getByText(/No messages/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("error state — Alert when messages endpoint returns 500", async ({
    page,
    errorFor,
    context,
  }) => {
    const seed = bindToContext(context);
    const convs = await seed.seedConversations({ count: 1, withMessages: 1 });
    await errorFor(MESSAGES_ROUTE, 500);
    await page.goto(`/app/conversations/${convs[0]!.id}`);
    await expect(page.getByText(/Could not load conversation/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("success state — seeded messages render in thread", async ({ page, context }) => {
    const seed = bindToContext(context);
    const convs = await seed.seedConversations({ count: 1, withMessages: 4 });
    await page.goto(`/app/conversations/${convs[0]!.id}`);
    await expect(page.getByText(/seed message 0/i)).toBeVisible();
    await expect(page.getByText(/seed message 1/i)).toBeVisible();
    await expect(page.getByText(/seed message 2/i)).toBeVisible();
    await expect(page.getByText(/seed message 3/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA clean on populated detail", async ({ page, context }) => {
    const seed = bindToContext(context);
    const convs = await seed.seedConversations({ count: 1, withMessages: 2 });
    await page.goto(`/app/conversations/${convs[0]!.id}`);
    await expect(page.getByText(/seed message 0/i)).toBeVisible();
    await runAxe(page);
    expectNoBrowserErrors(page);
  });
});
