// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-02-b — Long-form acceptance: password eye-toggle on the 3
// password-bearing auth surfaces. Closes 3 MISSING UCs + 1 BUG from
// RESEARCH.md §"auth eye-toggle audit":
//
//   UC-SIGNIN-EYE-TOGGLE   — /sign-in toggle exists (Phase 18.1.1 D-23)
//                            but had no e2e click coverage. Verified here.
//   UC-SIGNUP-EYE-TOGGLE   — /sign-up never shipped a toggle. Shipped
//                            in this same plan via PasswordInputWithToggle.
//   UC-RESETPW-EYE-TOGGLE  — /reset-password never shipped a toggle on
//                            either of its two password fields. Shipped
//                            in this same plan via PasswordInputWithToggle.
//   BUG-55-EYE-TOGGLE-MISSING — users typed passwords blind on sign-up
//                               and reset-password. Closed here.
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts + password-reset.spec.ts + password-strength-meter.spec.ts)
// — production-equivalent routing is covered by Phase 53 sweep + CJM.
//
// No fixture user — the spec never submits a form. Eye-toggle is purely
// client-side UI; no API/auth/email infrastructure touched. Spec runs
// with empty storageState (signed-out) and uses a fake `?token=` query
// on /reset-password so the form renders (server-side validation only
// runs on submit, see ResetPasswordForm.tsx:77-99).
//
// Browser-side error invariant: every step ends with
// `expectNoBrowserErrors(page)`. The helper internally also asserts
// no errors after each toggle click (multiple calls per surface).

import { test as base, expect, type Page } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

// Override the per-worker fixture storageState — this spec runs
// signed-out and never touches the auth API.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * Drive a single password input's eye-toggle through both directions:
 * password → text → password. Assert the input[type] attribute flips
 * and zero browser errors fire on each click.
 *
 * `passwordLabel` is the FormLabel regex (e.g. /^Password/i).
 * `toggleShowLabel` / `toggleHideLabel` are the visually-hidden toggle
 * button name regexes. The slim stack defaults to the EN locale; RU
 * coverage is by Phase 53 visual-baseline sweep (auth-shell-visual).
 */
async function exerciseToggle(
  page: Page,
  passwordLabel: RegExp,
  toggleShowLabel: RegExp,
  toggleHideLabel: RegExp,
): Promise<void> {
  const passwordInput = page.getByLabel(passwordLabel).first();
  await expect(passwordInput).toHaveAttribute("type", "password");
  // First click: show. The button's accessible name is the SHOW label
  // when the input is masked.
  const showToggle = page.getByRole("button", { name: toggleShowLabel }).first();
  await showToggle.click();
  await expect(passwordInput).toHaveAttribute("type", "text");
  expectNoBrowserErrors(page);
  // After flipping to text the button's accessible name swaps to HIDE.
  const hideToggle = page.getByRole("button", { name: toggleHideLabel }).first();
  await hideToggle.click();
  await expect(passwordInput).toHaveAttribute("type", "password");
  expectNoBrowserErrors(page);
}

test.describe("@phase55-acceptance @long-form — password eye-toggle (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-02-b done-gate grep
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-02-b acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
  });

  test("eye-toggle flips password ↔ text on sign-in, sign-up, and reset-password — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — /sign-in toggle flips password ↔ text", async () => {
      await page.goto(`${WEB_BASE}/sign-in`);
      await expect(page).toHaveURL(/\/sign-in(\?|$)/);
      await exerciseToggle(page, /^Password$/i, /show password/i, /hide password/i);
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — /sign-up toggle flips password ↔ text (NEW surface)", async () => {
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(page).toHaveURL(/\/sign-up(\?|$)/);
      await exerciseToggle(page, /^Password$/i, /show password/i, /hide password/i);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — /reset-password toggle flips each of two password fields independently (NEW surface)", async () => {
      // ResetPasswordForm.tsx:77-99 — the form only renders when a
      // non-empty `?token=` is present. Validation only runs on submit
      // (POST /api/auth/reset-password); the fake token below never
      // reaches the server because the spec never submits.
      await page.goto(`${WEB_BASE}/reset-password?token=spec-55-02-b-fake-token`);
      await expect(page).toHaveURL(/\/reset-password\?token=/);

      // Field 1 — "New password". Both fields share the same toggle
      // label copy ("Show password" / "Hide password") because the
      // component is namespace-agnostic and the SAME common.* keys are
      // passed in from the form. We therefore locate by FormLabel
      // proximity: each toggle button is a sibling of its own <Input>,
      // and `page.getByLabel(/New password/i).first()` resolves to
      // newPassword while the second matching label is confirmPassword.
      const newPasswordInput = page.getByLabel(/^New password$/i);
      const confirmPasswordInput = page.getByLabel(/Confirm new password/i);
      await expect(newPasswordInput).toHaveAttribute("type", "password");
      await expect(confirmPasswordInput).toHaveAttribute("type", "password");

      // Locate the two toggle buttons by DOM order. Each <FormItem>
      // wraps its own toggle, so the first SHOW button toggles
      // newPassword and the second toggles confirmPassword.
      const showButtons = page.getByRole("button", { name: /show password/i });
      await expect(showButtons).toHaveCount(2);

      // Toggle field 1 (newPassword): password → text.
      await showButtons.nth(0).click();
      await expect(newPasswordInput).toHaveAttribute("type", "text");
      // Field 2 must remain masked — independent state per instance.
      await expect(confirmPasswordInput).toHaveAttribute("type", "password");
      expectNoBrowserErrors(page);

      // Toggle field 2 (confirmPassword) — but field 1 is now in HIDE
      // state, so only the SHOW button on field 2 remains. Use
      // getByRole with name=/show/i; the remaining SHOW button is
      // field 2's. Validate by asserting the count.
      const remainingShow = page.getByRole("button", { name: /show password/i });
      await expect(remainingShow).toHaveCount(1);
      await remainingShow.click();
      await expect(confirmPasswordInput).toHaveAttribute("type", "text");
      await expect(newPasswordInput).toHaveAttribute("type", "text");
      expectNoBrowserErrors(page);

      // Flip both back to password via the HIDE buttons.
      const hideButtons = page.getByRole("button", { name: /hide password/i });
      await expect(hideButtons).toHaveCount(2);
      await hideButtons.nth(0).click();
      await hideButtons.nth(0).click(); // The remaining HIDE button after the first hides.
      await expect(newPasswordInput).toHaveAttribute("type", "password");
      await expect(confirmPasswordInput).toHaveAttribute("type", "password");
      expectNoBrowserErrors(page);
    });
  });
});
