// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 07 — U2 Sign-up Playwright spec.
import { expect, test } from "./_diagnostics-fixture.js";
import { FIXTURE_PASSWORD, fixtureEmail } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

test.describe("U2 Sign-up (Phase 07.1 / Plan 07)", () => {
  test.beforeEach(async ({ page }) => {
    await attachBrowserDiagnostics(page);
  });

  test("empty state — form renders pristine with no error alert", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel(/name/i)).toHaveValue("");
    await expect(page.getByLabel(/email/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: /^sign up$/i })).toBeVisible();
    await expect(page.getByText(/sign-up failed/i)).toHaveCount(0);
    expectNoBrowserErrors(page);
  });

  test("loading state — submit while /api/auth/sign-up/email is in flight keeps button disabled", async ({
    page,
  }) => {
    await page.route("**/api/auth/sign-up/email", async (route) => {
      await new Promise((r) => setTimeout(r, 30_000));
      await route.continue();
    });
    await page.goto("/sign-up");
    await page.getByLabel(/name/i).fill("Bob");
    await page.getByLabel(/email/i).fill(`bob+${Date.now()}@test.local`);
    await page.getByLabel(/^password$/i).fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();
    await expect(page.getByRole("button", { name: /sign up|loading/i })).toBeDisabled({
      timeout: 5_000,
    });
    expectNoBrowserErrors(page);
  });

  test("duplicate email — silent generic response prevents enumeration", async ({ page }, info) => {
    // Phase 53 / Plan 53-27 — Better Auth ≥ 1.6 returns a synthetic-200
    // for duplicate email submissions when `requireEmailVerification`
    // is enabled (our default). The handler hashes the password to
    // equalise timing and returns a fake user payload; no DB row is
    // created. This is anti-enumeration baseline per Better Auth's
    // security model. The UI must render the SAME "check your email"
    // success block as for a fresh sign-up — exposing an "already
    // registered" Alert would itself be an enumeration oracle.
    //
    // Prior wording of this spec asserted `/already registered/i` Alert
    // — that contract was valid only when Better Auth returned 422
    // USER_ALREADY_EXISTS, which it no longer does with verification
    // required. See deferred-items.md BUG-53-25 for the policy trail.
    const existingEmail = fixtureEmail(info.parallelIndex);
    await page.goto("/sign-up");
    await page.getByLabel(/name/i).fill("Alice");
    await page.getByLabel(/email/i).fill(existingEmail);
    await page.getByLabel(/^password$/i).fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();
    // Same success block as fresh sign-up — that's the whole point of
    // the generic response.
    await expect(page.getByText(/check your email/i).first()).toBeVisible({ timeout: 15_000 });
    // Negative invariant — duplicate-disclosure copy must NOT appear.
    await expect(page.getByText(/already registered/i)).toHaveCount(0);
    expectNoBrowserErrors(page);
  });

  test("success state — new email shows verification message", async ({ page }) => {
    const fresh = `bob+${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    await page.goto("/sign-up");
    await page.getByLabel(/name/i).fill("Bob");
    await page.getByLabel(/email/i).fill(fresh);
    await page.getByLabel(/^password$/i).fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15_000 });
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA scan on /sign-up", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: /^sign up$/i }).waitFor();
    await runAxe(page, "u2-sign-up");
    expectNoBrowserErrors(page);
  });
});
