// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-15-b — Long-form acceptance: /sign-up generic-error Alert.
//
// Closes one MISSING UC from RESEARCH.md §"/sign-up":
//   UC-SIGNUP-GENERIC-ERROR — SignUpForm.tsx:39 + 150-162.
//
// The form distinguishes two error variants:
//   - duplicate: result.error.code === "USER_ALREADY_EXISTS" OR
//                message matches /already exists/i
//   - generic:  anything else (incl. 500s and thrown exceptions)
//
// This spec exercises the GENERIC branch by stubbing the Better Auth
// sign-up endpoint with a 500 from a server-side route handler before
// any navigation. The duplicate branch is covered elsewhere (full-flow
// and dedicated specs) — this one specifically asserts the generic
// title + body copy and that the duplicate copy is NOT shown.
//
// Slim-only (matches the rest of the 100-acceptance suite). No fixture
// user — the spec runs signed-out via empty storageState. The 500 is
// expected as a deliberate browser error and is allowlisted.

import { test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";
const SIGN_UP_ROUTE = "**/api/auth/sign-up/email**";

const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — sign-up generic error (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-15-b acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    allowBrowserErrors(page, [/sign-up.*500/i, /Failed to load resource[^\n]*sign-up/i]);
  });

  test("sign-up generic-error Alert renders on 500 (not duplicate copy) — zero unexpected browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — pre-arm 500 stub on /api/auth/sign-up/email BEFORE navigating", async () => {
      await page.route(SIGN_UP_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "server explosion" } }),
        }),
      );
    });

    await test.step("step 2 — goto /sign-up, form renders", async () => {
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(page.getByRole("heading", { name: /create your.*account/i })).toBeVisible({
        timeout: 10_000,
      });
      // No error-Alert yet (scope by the destructive variant via the
      // generic-error title regex — sonner / other layout roles=alert
      // are not in play before submit). We assert the absence of the
      // signup-error copy specifically.
      await expect(page.getByText(/Sign-up failed/i)).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — fill valid form fields", async () => {
      await page.getByLabel(/^Name$/i).fill("Generic Error Tester");
      await page.getByLabel(/^Email$/i).fill("generic-error-55-15-b@test.local");
      // Strong password (length ≥ 12 + upper + digit + symbol) so the
      // client-side zod schema does not block submit on field-level
      // validation — we want the API 500 path, not a form validation path.
      await page.getByLabel(/^Password$/i).fill("StrongPass!2345");
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — submit → generic-error Alert visible, NOT duplicate copy", async () => {
      await page.getByRole("button", { name: /^Sign up$/i }).click();
      // Generic-error EN copy from end-user.json:
      //   title: "Sign-up failed"
      //   body:  "Sign-up failed. Please review the form and try again."
      // Scope by the title text so we don't collide with sonner / layout
      // role=alert nodes that may be present.
      // Two nodes match the regex (alert-title + alert-description copy
      // both start with "Sign-up failed"); .first() pins to alert-title.
      const errorTitle = page.getByText(/Sign-up failed/i).first();
      await expect(errorTitle).toBeVisible({ timeout: 10_000 });
      // Duplicate copy MUST NOT appear (would indicate variant mismatch).
      await expect(page.getByText(/already registered/i)).toHaveCount(0);
      expectNoBrowserErrors(page);
    });
  });
});
