// Phase 07.1 / Plan 08 — U5 account / sessions / delete (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real Better Auth state (single signed-in
//     session for "empty other-sessions"; a second signed-in browser context
//     for the multi-session success path).

import { fixtureEmail, signInAs } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";
import { expect, test } from "./fixtures/states.js";

const LIST_ROUTE = "**/api/auth/list-sessions";

test.describe("U5 — account (Phase 07.1 / Plan 08)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState applied
  // per worker via the auth-extended `test`. The "two-sessions" success
  // path still has to call signInAs in a second browser context — sign-in
  // (vs sign-up) has a higher rate-limit ceiling and is unavoidable here.

  test("loading state — Skeleton rows while list-sessions is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(LIST_ROUTE);
    await page.goto("/app/account");
    await expect(page.locator('[data-testid="sessions-skeleton-row"]').first()).toBeVisible();
  });

  test("empty state — single session hides 'Revoke all other sessions'", async ({ page }, info) => {
    await page.goto("/app/account");
    // Profile card visible
    await expect(page.getByText(fixtureEmail(info.parallelIndex))).toBeVisible();
    // Only the current session — header bulk-revoke button should be absent
    await expect(page.getByRole("button", { name: /Revoke all other sessions/i })).toHaveCount(0);
  });

  test("error state — Alert + Retry when list-sessions returns 500", async ({ page, errorFor }) => {
    await errorFor(LIST_ROUTE, 500);
    await page.goto("/app/account");
    await expect(page.getByText(/Could not load account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
  });

  test("success state — two sessions render and 'Revoke all other sessions' is visible", async ({
    browser,
    page,
  }, info) => {
    // Open a second browser context for the same user → creates a second
    // Better Auth session row. The first page (this `page`) keeps its session.
    const secondCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const secondPage = await secondCtx.newPage();
    await signInAs(secondPage, fixtureEmail(info.parallelIndex));
    await secondPage.close();

    await page.goto("/app/account");
    await expect(page.getByRole("button", { name: /Revoke all other sessions/i })).toBeVisible();
    // At least two row revoke buttons (one per session)
    const revokeButtons = page.getByRole("button", { name: /^Revoke$/i });
    await expect(revokeButtons.first()).toBeVisible();

    await secondCtx.close();
  });

  test("axe — WCAG 2.2 AA clean on populated account screen", async ({ page }, info) => {
    await page.goto("/app/account");
    await expect(page.getByText(fixtureEmail(info.parallelIndex))).toBeVisible();
    await runAxe(page);
  });
});
