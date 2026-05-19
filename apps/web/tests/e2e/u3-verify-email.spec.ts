// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U3 Verify-email Playwright spec.
//
// Token success path is exercised by the VerifyEmailClient unit test (mocked
// authClient.verifyEmail). The live success path requires extracting the
// verification link from the dev SMTP capture, which Plan 04 did not wire;
// we cover the loading/error/empty states here and rely on unit coverage for
// the success branch.
import { expect, test } from "./_diagnostics-fixture.js";
import { runAxe } from "./fixtures/axe.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

test.describe("U3 Verify-email (Phase 07.1 / Plan 07)", () => {
  test.beforeEach(async ({ page }) => {
    await attachBrowserDiagnostics(page);
  });

  test("empty state — visiting without ?token= renders error variant", async ({ page }) => {
    await page.goto("/verify-email");
    await expect(page.getByText(/verification failed/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("loading state — request hanging keeps the loading body visible", async ({ page }) => {
    await page.route("**/api/auth/verify-email**", async (route) => {
      await new Promise((r) => setTimeout(r, 30_000));
      await route.continue();
    });
    await page.goto("/verify-email?token=abcDEF123");
    await expect(page.getByText(/verifying your email/i)).toBeVisible({ timeout: 5_000 });
    expectNoBrowserErrors(page);
  });

  test("error state — invalid token renders error variant", async ({ page }) => {
    await page.route("**/api/auth/verify-email**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "INVALID_TOKEN", message: "invalid token" }),
      }),
    );
    await page.goto("/verify-email?token=invalidTokenXYZ");
    await expect(page.getByText(/verification failed/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("success state — verify-email returns success", async ({ page }) => {
    await page.route("**/api/auth/verify-email**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: true }),
      }),
    );
    await page.goto("/verify-email?token=goodTokenABC");
    await expect(page.getByText(/email verified/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign in$/i })).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA scan on /verify-email", async ({ page }) => {
    await page.goto("/verify-email");
    await page.getByText(/verification failed/i).waitFor();
    await runAxe(page, "u3-verify-email");
    expectNoBrowserErrors(page);
  });
});
