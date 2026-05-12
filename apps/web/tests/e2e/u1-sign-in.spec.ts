// Phase 07.1 / Plan 07 — U1 Sign-in Playwright spec.
//
// D-TEST-1 state matrix (loading, empty, error, success) + axe-core scan.
// D-TEST-3: route() ONLY for loading + error; success + empty hit real
// Better Auth via the seeded fixture user (apps/web/tests/e2e/fixtures/auth.ts).
import { expect, test } from "@playwright/test";
import { FIXTURE_PASSWORD, fixtureEmail, provisionTestUser } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";

test.describe("U1 Sign-in (Phase 07.1 / Plan 07)", () => {
  test("empty state — form renders pristine with no error alert", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel(/email/i)).toHaveValue("");
    await expect(page.getByLabel(/password/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText(/sign-in failed/i)).toHaveCount(0);
  });

  test("loading state — submit while /api/auth/sign-in/email is in flight keeps button disabled", async ({
    page,
  }) => {
    await page.route("**/api/auth/sign-in/email", async (route) => {
      await new Promise((r) => setTimeout(r, 30_000));
      await route.continue();
    });
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill("alice@test.local");
    await page.getByLabel(/password/i).fill("Pwa9!testStrong");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    // Button stays disabled (or text swaps to a loading label) while the
    // mocked request hangs. We assert by waiting for the disabled attribute.
    await expect(page.getByRole("button", { name: /sign in|loading/i })).toBeDisabled({
      timeout: 5_000,
    });
  });

  test("error state — invalid credentials show the error Alert", async ({ page }) => {
    // Use route() per D-TEST-3 — the alternative (sending bad creds to the
    // real backend) hits Better Auth's anti-abuse rate limiter on retries.
    await page.route("**/api/auth/sign-in/email", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" }),
      }),
    );
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill("nobody@test.local");
    await page.getByLabel(/password/i).fill("Pwa9!testStrong");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText(/sign-in failed/i)).toBeVisible();
  });

  test("success state — valid credentials redirect to /app", async ({ page, request }, info) => {
    await provisionTestUser(request, info.workerIndex);
    const email = fixtureEmail(info.workerIndex);
    await page.goto("/sign-in");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/app(\/|$)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/app(\/|$)/);
  });

  test("axe — WCAG 2.2 AA scan on /sign-in", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /^sign in$/i }).waitFor();
    await runAxe(page);
  });
});
