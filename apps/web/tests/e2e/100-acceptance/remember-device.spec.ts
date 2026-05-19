// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-02-d — Long-form acceptance: rememberMe payload + cookie
// lifetime split on /sign-in. Closes 2 MISSING UCs from Phase 55
// RESEARCH.md §"`/sign-in`":
//
//   UC-SIGNIN-REMEMBER-DEVICE-CHECKED   — SignInForm.tsx:241-258 + 88
//   UC-SIGNIN-REMEMBER-DEVICE-UNCHECKED — same surface, default branch
//
// The surface has shipped since Phase 18.1.1 (D-21) — `SignInForm.tsx:87`
// forwards `rememberMe: values.rememberDevice` to Better Auth's typed
// `authClient.signIn.email`. No phase ever asserted the request payload
// shape or the resulting cookie lifetime end-to-end. This spec is the
// bug-catching surface for both: it intercepts the `/api/auth/sign-in/email`
// POST and reads `req.postDataJSON()` to assert the wire key name +
// boolean value, then reads `page.context().cookies()` to assert the
// `openwhispr.session_token` cookie has either Session lifetime
// (`expires === -1`) or a finite future Max-Age depending on the branch.
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts + delete-account.spec.ts + revoke-sessions.spec.ts +
// resend-verification.spec.ts) — production-equivalent routing is
// covered by the Phase 53 u1..u13 sweep + CJM suite.
//
// Fixture-user isolation rationale — this spec is forbidden from reusing
// any `alice+55*` fixture from sibling 55-* plans. Reasons:
//   1. This spec signs in TWICE in sequence (rememberMe=false, then
//      sign-out, then rememberMe=true). The double sign-in writes two
//      session rows; sharing a fixture user with revoke-sessions.spec.ts
//      (which wipes ALL sessions for its user at beforeEach) would race
//      across workers.
//   2. The spec needs a stable verified state machine: first run
//      sign-ups + verifies; subsequent runs sign in directly. Sharing
//      with resend-verification.spec.ts's `alice+55c` would break since
//      that user is intentionally kept UNVERIFIED forever.
// Dedicated user: `alice+55d@test.local`.
//
// User row persists across runs (only resource rows are cleaned by
// `clearAllData`). First run sign-ups + verifies; subsequent runs
// detect the verified user and skip the sign-up + verify legs by
// signing in directly.
//
// Mailpit access lives behind apps/web/tests/e2e/support/mailpit.ts —
// the spec is forbidden from re-implementing inline mailpit polling.
//
// Browser-side error invariant: every step ends with a call to
// `expectNoBrowserErrors(page)`. The DEFAULT_ALLOWLIST + the per-spec
// allowlist below cover framework-level aborts only.

import { test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";
import { fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";
const FIXTURE_EMAIL = "alice+55d@test.local";
const FIXTURE_PASSWORD = "Remember55d!#StrongTest";
const SIGNIN_URL_FRAGMENT = "/api/auth/sign-in/email";
const SESSION_COOKIE_NAME = "openwhispr.session_token";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out and provisions its own dedicated user via the UI.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — remember-device payload + cookie lifetime (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-02-d acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
    // Multi-navigation flow (sign-up/sign-in -> /app -> sign-out ->
    // /sign-in -> /app) cancels in-flight Next.js chunk prefetches that
    // surface as `GET /_next/static/chunks/<hash>.js -> net::ERR_ABORTED`.
    // Same framework-level abort class as the `_rsc=…` entries already
    // in DEFAULT_ALLOWLIST — not a real bug. Mirrors revoke-sessions.spec.ts.
    allowBrowserErrors(page, [
      /GET [^ ]+\/_next\/static\/chunks\/[^ ]+ → FAILED: net::ERR_ABORTED/,
    ]);
  });

  test("rememberDevice unchecked → rememberMe:false + Session cookie; checked → rememberMe:true + Max-Age cookie — zero browser errors", async ({
    page,
    context,
  }) => {
    await test.step("step 1 — provision alice+55d idempotently via web UI", async () => {
      // Try sign-in first. If alice+55d exists AND is verified (from a
      // prior run), sign-in succeeds → skip sign-up. Otherwise fall
      // back to sign-up + mailpit-verify. Mirrors
      // revoke-sessions.spec.ts step 1.
      const cursor = new Date();
      await page.goto(`${WEB_BASE}/sign-in`);
      await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
      await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      const signedIn = await page
        .waitForURL(/\/app(\/.*)?$/, { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

      if (!signedIn) {
        // Fresh-user path.
        await page.goto(`${WEB_BASE}/sign-up`);
        await expect(page).toHaveURL(/\/sign-up$/);
        await page.getByLabel(/^Name/i).fill("Alice55d Remember");
        await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        const confirm = page.getByLabel(/Confirm password/i);
        if (await confirm.isVisible().catch(() => false)) {
          await confirm.fill(FIXTURE_PASSWORD);
        }
        const terms = page.getByRole("checkbox", { name: /terms/i });
        if (await terms.isVisible().catch(() => false)) {
          await terms.check();
        }
        await page.getByRole("button", { name: /sign up|create account|register/i }).click();
        await page.waitForLoadState("networkidle");

        const verifyLink = await fetchVerificationLink(FIXTURE_EMAIL, {
          since: cursor,
          timeoutMs: 15_000,
        });
        expect(verifyLink).toMatch(/token=/);
        const verifyRes = await context.request.get(verifyLink);
        expect([200, 302, 303]).toContain(verifyRes.status());

        // Sign-in for real to land on /app.
        await page.goto(`${WEB_BASE}/sign-in`);
        await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        await page.getByRole("button", { name: /sign in|log in/i }).click();
        await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      }

      await expect(page).toHaveURL(/\/app(\/.*)?$/);
      await page.waitForLoadState("networkidle");

      // Sign out so step 2 starts from a clean signed-out state. Use
      // the UI sign-out button (same pattern as full-flow.spec.ts:225).
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 8_000 });
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — sign-in #1 with rememberDevice UNCHECKED → rememberMe:false + Session cookie", async () => {
      await page.goto(`${WEB_BASE}/sign-in`);
      await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
      await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);

      // Confirm the rememberDevice checkbox is in its RHF default
      // (unchecked) — defensive against accidental defaultValue drift
      // in SignInForm.tsx:69.
      const rememberCheckbox = page.getByRole("checkbox", { name: /remember this device/i });
      await expect(rememberCheckbox).not.toBeChecked();

      // Pre-arm the request waiter BEFORE the submit click. Filter on
      // method=POST so the GET preflight (if any) is ignored.
      const signInReq = page.waitForRequest(
        (req) => req.url().includes(SIGNIN_URL_FRAGMENT) && req.method() === "POST",
      );
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      const req = await signInReq;
      // Bug-catching assertion #1 — the wire key name + value.
      // If this fails, surface as BUG-55-02-d-PAYLOAD-DRIFT.
      expect(req.postDataJSON()).toMatchObject({ rememberMe: false });

      await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      // Bug-catching assertion #2 — Session-cookie lifetime.
      // Playwright surfaces a Session cookie (no Max-Age, browser-close
      // lifetime) as `expires === -1`. If this returns a positive
      // timestamp, surface as BUG-55-02-d-COOKIE-LIFETIME-DRIFT.
      const cookies = await page.context().cookies();
      const session = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(session, "session_token cookie must be present after sign-in").toBeDefined();
      // If `session` is undefined, surface as BUG-55-02-d-COOKIE-NAME-DRIFT.
      expect(session?.expires).toBe(-1);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — sign-out via UI button", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 8_000 });
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — sign-in #2 with rememberDevice CHECKED → rememberMe:true + Max-Age cookie", async () => {
      // Already on /sign-in from step 3's sign-out redirect, but
      // navigate explicitly for spec-readability + idempotency.
      await page.goto(`${WEB_BASE}/sign-in`);
      await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
      await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);

      // Check the rememberDevice checkbox; assert the check landed.
      const rememberCheckbox = page.getByRole("checkbox", { name: /remember this device/i });
      await rememberCheckbox.check();
      await expect(rememberCheckbox).toBeChecked();

      // Fresh waiter — the previous one was consumed in step 2.
      const signInReq = page.waitForRequest(
        (req) => req.url().includes(SIGNIN_URL_FRAGMENT) && req.method() === "POST",
      );
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      const req = await signInReq;
      expect(req.postDataJSON()).toMatchObject({ rememberMe: true });

      await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      const cookies = await page.context().cookies();
      const session = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(session, "session_token cookie must be present after sign-in").toBeDefined();
      // Persistent cookie — expires is seconds-since-epoch, in the
      // future. Loose ">= now + 24h" check accommodates a future config
      // tweak from the current Better Auth `expiresIn: 30d` to e.g. 7d.
      // If Better Auth ever drops this below 1 day, the assertion fires
      // and the operator must update the config + the assertion together.
      const nowSec = Date.now() / 1000;
      expect(session?.expires).toBeGreaterThan(nowSec);
      expect(session?.expires).toBeGreaterThan(nowSec + 86400);
      expectNoBrowserErrors(page);
    });
  });
});
