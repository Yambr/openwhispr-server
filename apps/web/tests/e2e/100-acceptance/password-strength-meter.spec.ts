// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-02-a — Long-form acceptance: /sign-up password strength meter.
// Closes 4 MISSING UCs from RESEARCH.md §"/sign-up":
//
//   UC-SIGNUP-STRENGTH-WEAK   — score 0..1 → data-strength-band="weak"
//   UC-SIGNUP-STRENGTH-FAIR   — score 2    → data-strength-band="fair"
//   UC-SIGNUP-STRENGTH-GOOD   — score 3    → data-strength-band="good"
//   UC-SIGNUP-STRENGTH-STRONG — score 4    → data-strength-band="strong"
//
// SignUpForm.tsx:54-64 defines the inline `passwordStrength(value)`
// classifier (signals: len ≥ 12, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/).
// The meter (data-testid="password-strength-meter") only mounts when
// passwordValue.length > 0 (SignUpForm.tsx:217). Cleared → unmounted.
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts + delete-account.spec.ts + revoke-sessions.spec.ts)
// — production-equivalent routing is covered by Phase 53 sweep + CJM.
//
// No fixture user — the spec never submits the form. The strength meter
// is a client-side classifier; no API/auth/email infrastructure needed.
// Spec starts with empty storageState (signed-out).
//
// Browser-side error invariant: every step ends with
// `expectNoBrowserErrors(page)` — 6 calls total (one per step).

import { test as base, expect } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

// Override the per-worker fixture storageState — this spec runs
// signed-out and never touches the auth API.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — password strength meter (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-02-a done-gate grep
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-02-a acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
  });

  test("password strength meter cycles weak → fair → good → strong → empty with zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — visit /sign-up; meter hidden until typing", async () => {
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(
        page.getByRole("heading", {
          name: /create your.*account|создайте.*аккаунт/i,
        }),
      ).toBeVisible();
      // Meter is unmounted (passwordValue.length === 0 branch).
      await expect(page.locator('[data-testid="password-strength-meter"]')).toHaveCount(0);
      await expectNoBrowserErrors(page);
    });

    const passwordInput = page.getByLabel(/^Password|^Пароль/i);

    await test.step("step 2 — type WEAK password (`abc`, score 0)", async () => {
      await passwordInput.fill("abc");
      await expect(page.locator('[data-strength-band="weak"]')).toBeVisible();
      await expect(page.locator('[data-strength-band="weak"]')).toContainText(/weak|слабый/i);
      await expectNoBrowserErrors(page);
    });

    await test.step("step 3 — clear + type FAIR (`abcdefghijklM`, score 2)", async () => {
      await passwordInput.fill("");
      await passwordInput.fill("abcdefghijklM");
      await expect(page.locator('[data-strength-band="fair"]')).toBeVisible();
      await expect(page.locator('[data-strength-band="fair"]')).toContainText(/fair|средний/i);
      await expect(page.locator('[data-strength-band="weak"]')).toHaveCount(0);
      await expectNoBrowserErrors(page);
    });

    await test.step("step 4 — clear + type GOOD (`abcdefghijklM1`, score 3)", async () => {
      await passwordInput.fill("");
      await passwordInput.fill("abcdefghijklM1");
      await expect(page.locator('[data-strength-band="good"]')).toBeVisible();
      await expect(page.locator('[data-strength-band="good"]')).toContainText(/good|хороший/i);
      await expect(page.locator('[data-strength-band="fair"]')).toHaveCount(0);
      await expectNoBrowserErrors(page);
    });

    await test.step("step 5 — clear + type STRONG (`abcdefghijklM1!`, score 4)", async () => {
      await passwordInput.fill("");
      await passwordInput.fill("abcdefghijklM1!");
      await expect(page.locator('[data-strength-band="strong"]')).toBeVisible();
      await expect(page.locator('[data-strength-band="strong"]')).toContainText(/strong|сильный/i);
      await expect(page.locator('[data-strength-band="good"]')).toHaveCount(0);
      await expectNoBrowserErrors(page);
    });

    await test.step("step 6 — clear field; meter unmounts entirely", async () => {
      await passwordInput.fill("");
      // passwordValue.length === 0 branch — meter is fully unmounted
      // (NOT visibility:hidden). toHaveCount(0) is the safe assertion.
      await expect(page.locator('[data-testid="password-strength-meter"]')).toHaveCount(0);
      await expectNoBrowserErrors(page);
    });
  });
});
