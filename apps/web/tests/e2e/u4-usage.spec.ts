// Phase 07.1 / Plan 08 — U4 usage dashboard (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real /api/usage from a signed-in fixture
//     user (clearAllData ensures wordsUsed=0 — the "empty-as-N/A" branch per
//     UI-SPEC; success path uses seedUsage to push the wordsUsed sum above 0).

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const ROUTE = "**/api/usage";

test.describe("U4 — usage dashboard (Phase 07.1 / Plan 08)", () => {
  // Plan 13.1 — auth is provisioned by global-setup.ts and applied via the
  // per-worker `storageState` override on the auth-extended `test`. Each
  // test starts already signed in; only data state needs resetting here.
  test.beforeEach(async ({ context }) => {
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton cards while usage endpoint is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(ROUTE);
    await page.goto("/app");
    await expect(page.locator('[data-testid="usage-skeleton"]').first()).toBeVisible();
  });

  test("empty state (N/A per UI-SPEC) — four KPI cards still render with 0", async ({ page }) => {
    await page.goto("/app");
    // wordsUsed defaults to 0 after clearAllData; cards still render
    await expect(page.getByTestId("kpi-words-used")).toBeVisible();
    await expect(page.getByTestId("kpi-words-remaining")).toBeVisible();
    await expect(page.getByTestId("kpi-plan")).toBeVisible();
    await expect(page.getByTestId("kpi-limit-reached")).toBeVisible();
  });

  test("error state — Alert when /api/usage returns 500", async ({ page, errorFor }) => {
    await errorFor(ROUTE, 500);
    await page.goto("/app");
    await expect(page.getByText(/Could not load usage/i)).toBeVisible();
  });

  test("success state — KPI cards populate after seeded usage", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedUsage({ inputTokens: 100, outputTokens: 50 });
    await page.goto("/app");
    await expect(page.getByTestId("kpi-words-used")).toBeVisible();
    await expect(page.getByTestId("kpi-plan")).toContainText(/unlimited/i);
  });

  test("axe — WCAG 2.2 AA clean on populated dashboard", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByTestId("kpi-words-used")).toBeVisible();
    await runAxe(page);
  });
});
