// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 54 / Plan 54-02 — Long-form acceptance: full sign-up → verify →
// sign-in → per-screen walk → locale toggle → theme toggle → UI sign-out
// + guard check, all asserted against the slim dev-tools stack with zero
// browser console errors at every PRD step boundary (PRD §1-8).
//
// This is the brand-new-user OOB happy path. It does NOT inherit the
// per-worker fixture user (Phase 53's alice+N storageState) — it
// provisions its OWN unique user via the web UI on every run so the
// sign-up + verify legs are exercised end-to-end. The unique email is
// `flow54+${Date.now()}@local.test` to disambiguate from prior runs in
// the same mailpit DB / postgres volume.
//
// Slim-only by design: the spec hardcodes localhost ports
// (http://localhost:3000 web, http://localhost:4000 api,
// http://localhost:8025 mailpit) because the traefik project covers
// the production-equivalent routing path via Phase 53's u1..u13 sweep
// and 100-fullflow legacy spec. Running this against traefik would
// require host-based URL rewrites without adding signal.
//
// Mailpit access lives behind apps/web/tests/e2e/support/mailpit.ts
// (Phase 54 / Plan 54-01) — the spec is forbidden from re-implementing
// inline mailpit polling.
//
// Browser-side error invariant: every PRD step ends with a call to
// `expectNoBrowserErrors(page)`. The DEFAULT_ALLOWLIST in
// browser-diagnostics.ts covers framework-level aborts only
// (_rsc=… ERR_ABORTED, POST /api/locale ERR_ABORTED). Any new real
// error must be diagnosed + filed as BUG-54-*, NOT silenced with a
// new allowlist entry.

import { test as base, expect } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";
import { fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";
const API_BASE = "http://localhost:4000";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out and provisions its own user via the UI.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase54-acceptance @long-form — full flow (slim OOB)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 54 acceptance suite runs against slim topology only — traefik path is covered by Phase 53 sweep + 100-fullflow",
    );
    await attachBrowserDiagnostics(page);
  });

  test("registers, verifies, signs in, walks every authed screen, toggles locale + theme, signs out, and asserts guard — all with zero browser errors", async ({
    page,
    context,
  }) => {
    const uniq = `flow54+${Date.now()}@local.test`;
    const password = "correct-horse-battery-staple-9";
    const cursor = new Date();

    await test.step("step 1 — sign-up via UI", async () => {
      await page.goto(`${WEB_BASE}/sign-up`);
      await expect(page).toHaveURL(/\/sign-up$/);
      await page.getByLabel(/^Name/i).fill("Flow54 User");
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
      const checkEmailVisible = await page
        .getByText(/check your email|verify|verification/i)
        .first()
        .isVisible()
        .catch(() => false);
      const onSignIn = page.url().endsWith("/sign-in") || page.url().includes("/sign-in?");
      expect(checkEmailVisible || onSignIn).toBe(true);
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
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — walk every authed screen with empty-state assertions", async () => {
      // /app dashboard — KPI card is the stable smoke landmark (matches 99-cross-screen-smoke).
      await page.goto(`${WEB_BASE}/app`);
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.getByTestId("kpi-words-used")).toBeVisible();
      expectNoBrowserErrors(page);

      // /app/transcriptions — empty-state user; heading is the stable landmark.
      await page.goto(`${WEB_BASE}/app/transcriptions`);
      await expect(page).toHaveURL(/\/app\/transcriptions$/);
      await expect(page.getByRole("heading", { name: /transcriptions/i })).toBeVisible();
      expectNoBrowserErrors(page);

      // /app/notes — heading visible on empty state.
      await page.goto(`${WEB_BASE}/app/notes`);
      await expect(page).toHaveURL(/\/app\/notes$/);
      await expect(page.getByRole("heading", { name: /notes/i })).toBeVisible();
      expectNoBrowserErrors(page);

      // /app/conversations — heading visible on empty state.
      await page.goto(`${WEB_BASE}/app/conversations`);
      await expect(page).toHaveURL(/\/app\/conversations$/);
      await expect(page.getByRole("heading", { name: /conversations/i })).toBeVisible();
      expectNoBrowserErrors(page);

      // /app/account — profile card carries the freshly signed-up email.
      await page.goto(`${WEB_BASE}/app/account`);
      await expect(page).toHaveURL(/\/app\/account$/);
      await expect(page.getByText(uniq).first()).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — locale toggle en→ru→en with refresh persistence", async () => {
      expect(false).toBe(true);
      expectNoBrowserErrors(page);
    });

    await test.step("step 7 — theme toggle with refresh persistence", async () => {
      expect(false).toBe(true);
      expectNoBrowserErrors(page);
    });

    await test.step("step 8 — UI sign-out + /app guard redirect", async () => {
      expect(false).toBe(true);
      expectNoBrowserErrors(page);
    });
  });
});
