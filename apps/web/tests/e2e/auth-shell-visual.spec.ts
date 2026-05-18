// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 18.1.1 / Plan 05 / Task 05-05 — Visual regression for the four
// auth-shell screens (D-34).
//
// Strategy:
//   * Navigate to /sign-in, /sign-up, /verify-email (no-token → error
//     branch), /setup. Each screen mounts the same AuthShell side
//     panel; the visual baselines guard against accidental side-panel
//     drift.
//   * Mask the locale switcher (it briefly flashes during hydration
//     and is irrelevant to the shell layout).
//   * maxDiffPixelRatio: 0.01 — Playwright's published default tolerance
//     for shell-level layout regressions.
//
// Baselines are baked by running:
//   `pnpm --filter @openwhispr/web exec playwright test \
//      auth-shell-visual --update-snapshots`
// against a live Docker stack. Without a baseline the test FAILS (RED)
// — operators bake the baseline in Task 05-05 GREEN, then commit the
// snapshots under auth-shell-visual.spec.ts-snapshots/.
import { expect, test } from "./_diagnostics-fixture.js";

const MASKS = (page: import("@playwright/test").Page) => [
  page.locator("[data-testid='locale-switcher']"),
];

test.describe("AuthShell visual regression (Phase 18.1.1 / Plan 05)", () => {
  test("sign-in matches the AuthShell baseline", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /^sign in$/i }).waitFor();
    await expect(page).toHaveScreenshot("sign-in.png", {
      mask: MASKS(page),
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("sign-up matches the AuthShell baseline", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: /^sign up$/i }).waitFor();
    await expect(page).toHaveScreenshot("sign-up.png", {
      mask: MASKS(page),
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("verify-email error branch matches the AuthShell baseline", async ({ page }) => {
    await page.goto("/verify-email");
    await page.getByText(/verification failed/i).waitFor();
    await expect(page).toHaveScreenshot("verify-email-error.png", {
      mask: MASKS(page),
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });

  test("setup matches the AuthShell baseline", async ({ page }) => {
    const response = await page.goto("/setup");
    if (!response?.ok()) {
      test.skip(true, "setup already completed — skipping visual regression");
      return;
    }
    await page.getByText(/set up your openwhispr server/i).waitFor({ timeout: 15_000 });
    await expect(page).toHaveScreenshot("setup.png", {
      mask: MASKS(page),
      maxDiffPixelRatio: 0.01,
      fullPage: true,
    });
  });
});
