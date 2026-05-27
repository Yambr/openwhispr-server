// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-11 — Long-form acceptance: auth-screen cross-link navigation.
//
// Closes THREE MISSING UCs from Phase 55 RESEARCH.md §"Auth-screen
// cross-links":
//
//   - UC-SIGNIN-SIGNUP-LINK
//       SignInForm footer "Don't have an account? Sign up" Link → /sign-up
//       (apps/web/src/components/screens/auth/SignInForm.tsx:255-260)
//
//   - UC-SIGNUP-SIGNIN-LINK
//       SignUpForm footer "Already have an account? Sign in" Link → /sign-in
//       (apps/web/src/components/screens/auth/SignUpForm.tsx:260-265)
//
//   - UC-VERIFY-EMAIL-ERROR-SIGNUP-CTA
//       VerifyEmailClient error-branch CardFooter Button(asChild) Link
//       "Back to sign up" → /sign-up
//       (apps/web/src/components/screens/auth/VerifyEmailClient.tsx:158-161)
//
// Spec-only coverage-closure: production surface is already correct in
// all three components. No production code changes ship with this plan.
//
// Strict TDD posture: this file constitutes the RED commit on its own
// merit (a test that did not exist previously). On the GREEN commit the
// spec passes against the running slim stack with no production changes
// because the cross-link wiring was always there — only its long-form
// acceptance coverage was missing.
//
// Slim-only. No fixture user — all three routes (/sign-in, /sign-up,
// /verify-email) are public and render without authentication.
//
// EN-only matchers per constitutional rule; matched primarily by
// `href="/sign-up"` / `href="/sign-in"` to be locale-agnostic on the
// link selectors and only the heading/error-state copy is asserted
// against English text. expectNoBrowserErrors at every step.

import { expect, test } from "@playwright/test";
import {
  allowDeliberateRouteStub,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — auth cross-link navigation (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-11 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
  });

  test("SignIn → SignUp → SignIn cross-links navigate correctly; VerifyEmail error branch routes to /sign-up — zero browser errors", async ({
    page,
  }) => {
    // ────────────────────────────────────────────────────────────────
    // Step 1 — /sign-in → /sign-up via the SignInForm footer link.
    // UC-SIGNIN-SIGNUP-LINK.
    // ────────────────────────────────────────────────────────────────
    await page.goto(`${WEB_BASE}/sign-in`);
    await expect(page.getByRole("heading", { name: /Sign in to OpenWhispr/i })).toBeVisible();

    const toSignUp = page.locator('a[href="/sign-up"]').first();
    await expect(toSignUp, "SignInForm must expose a live /sign-up link").toBeVisible();
    await toSignUp.click();

    await page.waitForURL(`${WEB_BASE}/sign-up`);
    expect(new URL(page.url()).pathname).toBe("/sign-up");
    await expect(
      page.getByRole("heading", { name: /Create your OpenWhispr account/i }),
    ).toBeVisible();
    expectNoBrowserErrors(page);

    // ────────────────────────────────────────────────────────────────
    // Step 2 — /sign-up → /sign-in via the SignUpForm footer link.
    // UC-SIGNUP-SIGNIN-LINK.
    // ────────────────────────────────────────────────────────────────
    const toSignIn = page.locator('a[href="/sign-in"]').first();
    await expect(toSignIn, "SignUpForm must expose a live /sign-in link").toBeVisible();
    await toSignIn.click();

    await page.waitForURL(`${WEB_BASE}/sign-in`);
    expect(new URL(page.url()).pathname).toBe("/sign-in");
    await expect(page.getByRole("heading", { name: /Sign in to OpenWhispr/i })).toBeVisible();
    expectNoBrowserErrors(page);

    // ────────────────────────────────────────────────────────────────
    // Step 3 — /verify-email error branch → /sign-up.
    // UC-VERIFY-EMAIL-ERROR-SIGNUP-CTA. The bad token forces the
    // production verify-email API to respond 4xx; that browser-side
    // network error is deliberate and is allowlisted on the diagnostics
    // channel so expectNoBrowserErrors below remains meaningful for any
    // *other* unexpected error.
    // ────────────────────────────────────────────────────────────────
    // The captured diagnostic for the deliberate 401 lives in two
    // shapes — `[network/error] GET … → 401` and `[console/error]
    // Failed to load resource: … 401` — with the URL parked in the
    // entry's `detail` field, not the message body. allowDeliberateRouteStub
    // seeds both shapes so expectNoBrowserErrors below stays meaningful
    // for any OTHER unexpected error.
    allowDeliberateRouteStub(page, /\/api\/auth\/verify-email/, 401);

    await page.goto(`${WEB_BASE}/verify-email?token=bad-token-spec-55-11`);
    await expect(page.getByRole("heading", { name: /Verify your email/i })).toBeVisible();
    // Error-branch alert (role="alert") proves we are in the failure
    // variant and not the success or no-token branch.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(/Verification failed/i)).toBeVisible();

    const errorToSignUp = page.locator('a[href="/sign-up"]').first();
    await expect(
      errorToSignUp,
      "VerifyEmailClient error branch must expose a live /sign-up CTA",
    ).toBeVisible();
    await errorToSignUp.click();

    await page.waitForURL(`${WEB_BASE}/sign-up`);
    expect(new URL(page.url()).pathname).toBe("/sign-up");
    await expect(
      page.getByRole("heading", { name: /Create your OpenWhispr account/i }),
    ).toBeVisible();
    expectNoBrowserErrors(page);
  });
});
