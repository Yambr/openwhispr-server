// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-02-c — Long-form acceptance: EMAIL_NOT_VERIFIED branch on
// /sign-in + the "Resend verification email" CTA inside the unverified
// Alert (SignInForm.tsx:134-159). Closes 3 MISSING UCs from the
// Phase 55 RESEARCH.md §"`/sign-in`" gap audit:
//
//   UC-SIGNIN-EMAIL-NOT-VERIFIED-ALERT     — SignInForm.tsx:134-159
//   UC-SIGNIN-RESEND-VERIFICATION-CLICK    — SignInForm.tsx:147-156
//   UC-SIGNIN-RESEND-SENT-STATE            — SignInForm.tsx:143-145
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts + delete-account.spec.ts + revoke-sessions.spec.ts)
// — production-equivalent routing is covered by the Phase 53 u1..u13
// sweep + CJM suite.
//
// Fixture-user isolation rationale — this spec is forbidden from
// reusing `alice+55@test.local` (Plan 55-01-c revoke-sessions fixture).
// The revoke-sessions fixture is VERIFIED on first run (full sign-up +
// verify-link hop) and its `email_verified=true` state persists across
// runs. That state is incompatible with the EMAIL_NOT_VERIFIED branch
// this spec needs to exercise. We provision our OWN dedicated user
// `alice+55c@test.local` and never click the verification link, so the
// user stays `email_verified=false` permanently across runs.
//
// User row persists across runs (only resource rows are cleaned by
// `clearAllData`). First run sign-ups; subsequent runs detect
// USER_ALREADY_EXISTS — either way, the user stays unverified because
// we never visit the verification link from mailpit.
//
// Mailpit access lives behind apps/web/tests/e2e/support/mailpit.ts —
// the spec is forbidden from re-implementing inline mailpit polling.
//
// Since-cursor pattern: we set `cursor = new Date()` IMMEDIATELY before
// clicking the resend button, so `fetchVerificationLink` matches ONLY
// the new mail (not the original sign-up email from a fresh run).
//
// Browser-side error invariant: every step ends with a call to
// `expectNoBrowserErrors(page)`. Any new real error must be diagnosed
// + filed as BUG-55-*, NOT silenced with a new allowlist entry.

import { test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";
import { fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";
const FIXTURE_EMAIL = "alice+55c@test.local";
const FIXTURE_PASSWORD = "Resend55c!#StrongTest";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out and provisions its own dedicated user via the UI.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — resend verification round-trip (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-02-c acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
    // Multi-navigation flow (sign-up -> /sign-in -> resend click) cancels
    // in-flight Next.js chunk prefetches that surface as
    // `GET /_next/static/chunks/<hash>.js -> net::ERR_ABORTED`. Same
    // framework-level abort class as the `_rsc=…` entries already in
    // DEFAULT_ALLOWLIST — not a real bug. Mirrors revoke-sessions.spec.ts.
    allowBrowserErrors(page, [
      /GET [^ ]+\/_next\/static\/chunks\/[^ ]+ → FAILED: net::ERR_ABORTED/,
      // Phase 55-02-c: step 2 deliberately submits credentials of an
      // unverified user; Better Auth rejects with 403 EMAIL_NOT_VERIFIED
      // (the very signal that drives the unverified-Alert + resend-CTA
      // render this spec asserts). The network + console entries are
      // the intended verification, not a real bug. Same allowlist
      // pattern as delete-account.spec.ts:59-64 for the deliberate 401
      // INVALID_EMAIL_OR_PASSWORD signal there.
      /POST [^ ]+\/api\/auth\/sign-in\/email[^ ]* → 403\b/,
      /Failed to load resource:.*\b403\b/,
    ]);
  });

  test("unverified user sign-in shows resend CTA; click resends and transitions to sent state; new email arrives — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — idempotent sign-up of alice+55c (DO NOT visit verification link)", async () => {
      // Strategy: navigate to /sign-up and submit. Two converging
      // outcomes:
      //   (a) Fresh user → server returns success, UI shows the
      //       "Check your email" panel OR redirects to /sign-in. A
      //       verification email lands in mailpit but we IGNORE it —
      //       the user must stay unverified for step 2.
      //   (b) Duplicate run → SignUpForm sees USER_ALREADY_EXISTS
      //       (line 96 of SignUpForm.tsx) and renders the duplicate-
      //       email error. The user row already exists in postgres
      //       with email_verified=false (because no run ever clicks
      //       the link).
      // Both paths converge on "user exists in postgres, unverified".
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(page).toHaveURL(/\/sign-up$/);
      await page.getByLabel(/^Name/i).fill("Alice55c Resend");
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
      // DO NOT fetch + visit the verification link — the user must
      // stay `email_verified=false` so step 2's sign-in surfaces the
      // EMAIL_NOT_VERIFIED branch.
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — sign in with unverified user → EMAIL_NOT_VERIFIED alert renders with resend CTA", async () => {
      await page.goto(`${WEB_BASE}/sign-in`);
      await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
      await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      // The unverified Alert at SignInForm.tsx:134-159 carries the
      // dedicated test id. The render happens after Better Auth
      // returns `{ error: { code: "EMAIL_NOT_VERIFIED" } }`.
      await expect(page.getByTestId("signin-unverified-alert")).toBeVisible({ timeout: 15_000 });
      // Resend button copy key (en: "Resend verification email"). The
      // spec runs against the default EN locale (no locale toggle hop),
      // so an EN-only matcher is sufficient. RU branches are explicitly
      // forbidden by the English-only source-artifact rule (lint-
      // english.ts) — the RU translation is exercised by the i18n
      // bundle-completeness suite, not e2e.
      await expect(page.getByRole("button", { name: /resend verification/i })).toBeVisible();
      // Spec MUST stay on /sign-in — no redirect to /app on failure.
      expect(page.url()).toMatch(/\/sign-in$/);
      expectNoBrowserErrors(page);
    });

    let cursor: Date;
    await test.step("step 3 — click resend → alert transitions to 'sent' variant; button removed from DOM", async () => {
      // Set cursor IMMEDIATELY before clicking. Mailpit timestamps
      // mails at receive-time with sub-second granularity; the
      // `since - 1s` slack inside fetchVerificationLink means anything
      // delivered AFTER cursor minus 1s matches. By scoping the cursor
      // tight to the click, we guarantee any pre-existing mail in the
      // mailbox (e.g. sign-up email from step 1) is excluded.
      cursor = new Date();
      await page.getByRole("button", { name: /resend verification/i }).click();
      // Sent-state copy (en: "Verification email sent. Check your
      // inbox."). Asserted inside the alert region so we don't
      // accidentally match a stray "sent" string elsewhere on the
      // page. EN-only per English-only source-artifact rule.
      const alert = page.getByTestId("signin-unverified-alert");
      await expect(alert).toContainText(/verification email sent/i, {
        timeout: 10_000,
      });
      // SignInForm.tsx:147 — button is REMOVED from the DOM (the
      // surrounding `{state.resend !== "sent" ? <Button … /> : null}`
      // returns null after success), not just disabled. Use
      // toHaveCount(0), NOT toBeDisabled().
      await expect(page.getByRole("button", { name: /resend verification/i })).toHaveCount(0);
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — a NEW verification email lands in mailpit (since-cursor scoped to the resend click)", async () => {
      // cursor is captured in step 3 — Playwright executes steps
      // sequentially so we know the cursor is set by the time we
      // reach here.
      const link = await fetchVerificationLink(FIXTURE_EMAIL, {
        since: cursor!,
        timeoutMs: 15_000,
      });
      // Better Auth verification URL shape (also matched by the
      // shared VERIFY_LINK_PATTERN in mailpit.ts).
      expect(link).toMatch(/\/(?:verify-email|api\/auth\/verify-email)\?[^\s]*token=/);
      // We deliberately do NOT visit the verification link. This
      // spec's invariant is "resend produced a new email" — not
      // "user becomes verified". Keeping the user unverified across
      // runs is what makes the spec idempotent.
      expectNoBrowserErrors(page);
    });
  });
});
