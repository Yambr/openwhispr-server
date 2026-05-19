// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-a — Long-form acceptance: password-reset round-trip via
// mailpit. Closes BUG-54-PRD-RESET-UI-MISSING by walking the entire
// flow end-to-end against the slim dev-tools stack:
//
//   sign-up via UI -> verify via mailpit -> sign-in (legacy password)
//   -> click "Forgot password?" link on /sign-in -> /forgot-password
//   submit -> mailpit reset email -> /reset-password form -> /sign-in
//   with new password -> lands on /app, all with zero browser console
//   errors at every step boundary (PRD pattern from full-flow.spec.ts).
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts) — production-equivalent routing is covered by the
// Phase 53 u1..u13 sweep + Phase 19a CJM step suite.
//
// Throw-away user: reset55+${Date.now()}@local.test. We intentionally
// do NOT inherit the per-worker alice+N fixture storageState — flipping
// alice's password mid-suite would invalidate every downstream spec's
// cookie jar (RESEARCH risk #4 in Phase 55-01-a-PLAN.md).

import { test as base, expect } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";
import { fetchPasswordResetLink, fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out and provisions its own user via the UI.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — password reset round-trip (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-01-a acceptance suite runs against slim topology only — traefik path covered by Phase 19a CJM suite",
    );
    await attachBrowserDiagnostics(page);
  });

  test("registers, requests password reset, follows mailpit link, sets new password, signs in successfully — zero browser errors", async ({
    page,
    context,
  }) => {
    const uniq = `reset55+${Date.now()}@local.test`;
    const initialPassword = "InitialPass-55a!";
    const newPassword = "NewReset55!#Pass";
    const signupCursor = new Date();

    await test.step("step 1 — sign-up via web UI", async () => {
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(page).toHaveURL(/\/sign-up$/);
      await page.getByLabel(/^Name/i).fill("Reset55 User");
      await page.getByLabel(/^Email/i).fill(uniq);
      await page.getByLabel(/^Password/i).fill(initialPassword);
      const confirm = page.getByLabel(/Confirm password/i);
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.fill(initialPassword);
      }
      await page.getByRole("button", { name: /sign up|create account|register/i }).click();
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — fetch verification link from mailpit and confirm via GET", async () => {
      const verifyLink = await fetchVerificationLink(uniq, {
        since: signupCursor,
        timeoutMs: 15_000,
      });
      expect(verifyLink).toMatch(/token=/);
      const verifyRes = await context.request.get(verifyLink);
      expect([200, 302, 303]).toContain(verifyRes.status());
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — /sign-in renders live 'Forgot password?' link to /forgot-password", async () => {
      await page.goto(`${WEB_BASE}/sign-in`);
      await expect(page).toHaveURL(/\/sign-in(\?|$)/);
      const forgotLink = page.getByRole("link", { name: /forgot password/i });
      await expect(forgotLink).toBeVisible();
      await expect(forgotLink).toHaveAttribute("href", "/forgot-password");
      await forgotLink.click();
      await expect(page).toHaveURL(/\/forgot-password(\?|$)/);
      expectNoBrowserErrors(page);
    });

    // CRITICAL: cursor is captured BEFORE submitting the forgot-password
    // form so fetchPasswordResetLink does NOT race the earlier
    // verification email (the mailpit poll matches by URL regex, not by
    // subject keyword — see apps/web/tests/e2e/support/mailpit.ts:56).
    const resetCursor = new Date();

    await test.step("step 4 — submit /forgot-password and assert enumeration-safe panel", async () => {
      await page.getByLabel(/^Email/i).fill(uniq);
      await page.getByRole("button", { name: /send reset link/i }).click();
      await expect(
        page.getByText(/if your email is registered, we have sent you a reset link/i),
      ).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);
    });

    let resetLink = "";
    await test.step("step 5 — fetch password-reset link from mailpit (post-cursor)", async () => {
      resetLink = await fetchPasswordResetLink(uniq, {
        since: resetCursor,
        timeoutMs: 15_000,
      });
      expect(resetLink).toMatch(/\/reset-password\?[^\s"'<>]*token=[^\s"'<>&]+/);
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — open /reset-password, set new password, land on /sign-in", async () => {
      // The mailpit link is an absolute URL pointing at the configured
      // public host (likely web.localhost via Traefik). We strip down
      // to the path+query so the spec exercises the slim-mode
      // localhost:3000 host instead of routing through Traefik.
      const url = new URL(resetLink);
      const localReset = `${WEB_BASE}${url.pathname}${url.search}`;
      await page.goto(localReset);
      await expect(page.getByLabel(/^new password$/i)).toBeVisible();
      await page.getByLabel(/^new password$/i).fill(newPassword);
      await page.getByLabel(/confirm new password/i).fill(newPassword);
      await page.getByRole("button", { name: /set new password/i }).click();
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 15_000 });
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 7 — sign in with new password lands on /app", async () => {
      await page.getByLabel(/^Email/i).fill(uniq);
      await page.getByLabel(/^Password/i).fill(newPassword);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/app(\/.*)?$/);
      expectNoBrowserErrors(page);
    });
  });
});
