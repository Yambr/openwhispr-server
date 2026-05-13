// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 07 — U2 Sign-up Playwright spec.
import { expect, test } from "@playwright/test";
import { FIXTURE_PASSWORD, fixtureEmail } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";

test.describe("U2 Sign-up (Phase 07.1 / Plan 07)", () => {
  test("empty state — form renders pristine with no error alert", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel(/name/i)).toHaveValue("");
    await expect(page.getByLabel(/email/i)).toHaveValue("");
    await expect(page.getByRole("button", { name: /^sign up$/i })).toBeVisible();
    await expect(page.getByText(/sign-up failed/i)).toHaveCount(0);
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
  });

  test("error state — duplicate email shows duplicate Alert", async ({ page }, info) => {
    // Plan 13.1 — the global-setup hook (tests/e2e/global-setup.ts) has
    // already provisioned `alice+<workerIndex>@test.local` via the real
    // Better Auth sign-up + Postgres email-verified flip. Submitting the
    // sign-up form with that same email triggers USER_ALREADY_EXISTS from
    // real Better Auth — no internal mock, no extra /api/auth/sign-up
    // request beyond the form submit itself.
    const existingEmail = fixtureEmail(info.parallelIndex);
    await page.goto("/sign-up");
    await page.getByLabel(/name/i).fill("Alice");
    await page.getByLabel(/email/i).fill(existingEmail);
    await page.getByLabel(/^password$/i).fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();
    // Plan 13.2 — the Alert renders the same copy in both AlertTitle and
    // AlertDescription, so `getByText` resolves to two nodes. `.first()`
    // picks the title; the duplicate-email Alert is considered visible
    // either way.
    await expect(page.getByText(/already registered/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("success state — new email shows verification message", async ({ page }) => {
    const fresh = `bob+${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
    await page.goto("/sign-up");
    await page.getByLabel(/name/i).fill("Bob");
    await page.getByLabel(/email/i).fill(fresh);
    await page.getByLabel(/^password$/i).fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: /^sign up$/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15_000 });
  });

  test("axe — WCAG 2.2 AA scan on /sign-up", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: /^sign up$/i }).waitFor();
    await runAxe(page);
  });
});
