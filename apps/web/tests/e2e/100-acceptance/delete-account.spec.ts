// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-01-b — Long-form acceptance: destructive delete-account flow
// via DeleteAccountDialog on /app/account. Closes
// BUG-55-DELETE-ACCOUNT-UNTESTED + 5 MISSING UCs:
//
//   UC-DELETE-ACCOUNT-OPEN — trigger click reveals the AlertDialog.
//   UC-DELETE-ACCOUNT-MISMATCH-DISABLED — typed != userEmail keeps
//     confirm disabled.
//   UC-DELETE-ACCOUNT-MATCH-CONFIRMS — typed == userEmail enables
//     confirm and click invokes authClient.deleteAccount().
//   UC-DELETE-ACCOUNT-PUSH-SIGNIN — router.push('/sign-in') on success.
//   UC-DELETE-ACCOUNT-GUARD-REDIRECT — (auth)/layout.tsx guard sends
//     /app -> /sign-in after the cookie is cleared.
//
// Slim-only by design (mirrors apps/web/tests/e2e/100-acceptance/
// full-flow.spec.ts) — production-equivalent routing is covered by the
// Phase 53 u1..u13 sweep + Phase 19a CJM step suite.
//
// Throw-away user: delete55+${Date.now()}@local.test. We intentionally
// do NOT inherit the per-worker alice+N fixture storageState (the
// spec's job is to delete the user — wiping alice mid-suite would
// invalidate every downstream spec's cookie jar).
//
// Mailpit access lives behind apps/web/tests/e2e/support/mailpit.ts
// (Phase 54 / Plan 54-01) — the spec is forbidden from re-implementing
// inline mailpit polling.

import { test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";
import { fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out and provisions its own user via the UI.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — delete account round-trip (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-01-b acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
    // Multi-navigation flow: sign-up -> /sign-in -> /app -> /app/account
    // -> deleteAccount -> /sign-in -> retry sign-in -> /app guard ->
    // /sign-in. Each hop cancels in-flight Next.js chunk prefetches
    // that the browser surfaces as
    // `GET /_next/static/chunks/<hash>.js -> net::ERR_ABORTED`.
    // Same framework-level abort class as the `_rsc=…` entries already
    // in DEFAULT_ALLOWLIST — not a real bug.
    allowBrowserErrors(page, [
      /GET [^ ]+\/_next\/static\/chunks\/[^ ]+ → FAILED: net::ERR_ABORTED/,
      // BUG-55-01-b-01 follow-up: step 10 deliberately re-tries
      // sign-in with the deleted credentials and expects Better Auth to
      // reject with 401 INVALID_EMAIL_OR_PASSWORD. The network + console
      // entries are the intended verification, not a real bug.
      /POST [^ ]+\/api\/auth\/sign-in\/email[^ ]* → 401\b/,
      /Failed to load resource:.*\b401\b/,
    ]);
  });

  test("signs up a throwaway user, deletes the account via dialog, verifies signed-out + credentials invalidated — zero browser errors", async ({
    page,
    context,
  }) => {
    const uniq = `delete55+${Date.now()}@local.test`;
    const password = "ToDelete55!#Strong";
    const cursor = new Date();

    await test.step("step 1 — sign-up via web UI", async () => {
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(page).toHaveURL(/\/sign-up$/);
      await page.getByLabel(/^Name/i).fill("Delete55 User");
      await page.getByLabel(/^Email/i).fill(uniq);
      await page.getByLabel(/^Password/i).fill(password);
      const confirm = page.getByLabel(/Confirm password/i);
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.fill(password);
      }
      const terms = page.getByRole("checkbox", { name: /terms/i });
      if (await terms.isVisible().catch(() => false)) {
        await terms.check();
      }
      await page.getByRole("button", { name: /sign up|create account|register/i }).click();
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    let verifyLink = "";
    await test.step("step 2 — verification email arrives in mailpit", async () => {
      verifyLink = await fetchVerificationLink(uniq, { since: cursor, timeoutMs: 15_000 });
      expect(verifyLink).toMatch(/token=/);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — verify link returns 200/302/303", async () => {
      const verifyRes = await context.request.get(verifyLink);
      expect([200, 302, 303]).toContain(verifyRes.status());
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — sign-in via UI lands on /app", async () => {
      await page.goto(`${WEB_BASE}/sign-in`);
      await page.getByLabel(/^Email/i).fill(uniq);
      await page.getByLabel(/^Password/i).fill(password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      await expect(page).toHaveURL(/\/app(\/.*)?$/);
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — navigate to /app/account, profile card shows throwaway email", async () => {
      await page.goto(`${WEB_BASE}/app/account`);
      await expect(page).toHaveURL(/\/app\/account$/);
      await expect(page.getByText(uniq).first()).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — open delete-account dialog, confirm starts disabled", async () => {
      // The danger-zone trigger reads "Delete account" (i18n key
      // end-user.account.danger.delete.label). The AlertDialogAction
      // inside the dialog ALSO reads "Delete account" (dialog-confirm.label),
      // so we MUST scope the trigger click to the page (not the dialog)
      // and use the testid to disambiguate the confirm button.
      // Scope by region: the trigger lives in the profile screen body;
      // the confirm lives inside role=alertdialog. We use first() on the
      // trigger before the dialog is open.
      await page
        .getByRole("button", { name: /^Delete account$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const confirmBtn = page.getByTestId("delete-account-confirm");
      await expect(confirmBtn).toBeDisabled();
      expectNoBrowserErrors(page);
    });

    await test.step("step 7 — typed-email mismatch keeps confirm disabled", async () => {
      const dialog = page.getByRole("alertdialog");
      // Scope by id within the dialog to avoid collision with the
      // sign-in/sign-up Email <Label>; #delete-account-email is the
      // canonical selector (DeleteAccountDialog.tsx:94).
      await dialog.locator("#delete-account-email").fill("wrong@example.com");
      await expect(page.getByTestId("delete-account-confirm")).toBeDisabled();
      expectNoBrowserErrors(page);
    });

    await test.step("step 8 — typed-email match enables confirm", async () => {
      const dialog = page.getByRole("alertdialog");
      const input = dialog.locator("#delete-account-email");
      await input.fill("");
      await input.fill(uniq);
      await expect(page.getByTestId("delete-account-confirm")).toBeEnabled();
      expectNoBrowserErrors(page);
    });

    await test.step("step 9 — confirm delete pushes to /sign-in", async () => {
      await page.getByTestId("delete-account-confirm").click();
      // DeleteAccountDialog awaits authClient.deleteAccount() then
      // best-effort signOut() then router.push("/sign-in"). The whole
      // chain is bounded by 10s in normal conditions.
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 10_000 });
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 10 — re-auth with deleted credentials fails", async () => {
      // We may already be on /sign-in from step 9.
      await expect(page).toHaveURL(/\/sign-in(\?|$)/);
      await page.getByLabel(/^Email/i).fill(uniq);
      await page.getByLabel(/^Password/i).fill(password);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      // SignInForm renders <Alert role="alert"> with title
      // "Sign-in failed" + body "Check your email and password, then try
      // again." on result.error (any code other than EMAIL_NOT_VERIFIED).
      // Better Auth returns INVALID_EMAIL_OR_PASSWORD for a missing user,
      // which falls through to the generic alert. The visibility
      // assertion is therefore robust to either hard- or soft-delete
      // semantics on the server side.
      await expect(
        page.getByText(/check your email and password|invalid credentials|user not found/i),
      ).toBeVisible({ timeout: 8_000 });
      await expect(page).not.toHaveURL(/\/app(\/|$)/);
      expectNoBrowserErrors(page);
    });

    await test.step("step 11 — /app guard redirects to /sign-in", async () => {
      await page.goto(`${WEB_BASE}/app`);
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 5_000 });
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/sign-in(\?|$)/);
      expectNoBrowserErrors(page);
    });
  });
});
