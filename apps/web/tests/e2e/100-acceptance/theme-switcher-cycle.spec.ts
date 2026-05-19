// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-03-b — Long-form acceptance: theme switcher 3-option dropdown
// + persistence on /app. Closes 4 MISSING UCs + upgrades 1 PARTIAL from
// RESEARCH.md §"Theme switcher":
//
//   UC-THEME-DROPDOWN-OPEN — clicking the Toggle-theme button renders the
//     3 menuitem options (Light / Dark / System) in a Radix portal.
//   UC-THEME-LIGHT-FLIP — clicking the "Light" menuitem drives
//     next-themes.setTheme("light") → <html data-theme="light">.
//   UC-THEME-DARK-FLIP — clicking the "Dark" menuitem → <html data-theme="dark">.
//   UC-THEME-SYSTEM-RESOLVE — emulateMedia({colorScheme:"light"}) then
//     clicking "System" → next-themes resolves to the OS preference;
//     under the `attribute="data-theme"` config the resolved value
//     replaces the attribute (no separate `class` flip — see contract
//     note below).
//   UC-THEME-PERSISTENCE — after Dark, a full page reload still yields
//     <html data-theme="dark"> (localStorage key "theme" carries it).
//
// Contract note — next-themes config (apps/web/src/lib/theme-provider.tsx):
//   <NextThemesProvider attribute="data-theme" defaultTheme="system"
//     enableSystem storageKey="theme">
// With `attribute="data-theme"` (single string, NOT "class"), next-themes
// writes the RESOLVED theme value to `<html data-theme="…">` and does
// NOT touch `class`. Tailwind 4 in globals.css keys off
// `[data-theme="dark"]` so this is the intentional contract.
//
// Slim-only — production-equivalent routing is covered by Phase 53 u1..u13
// sweep + CJM suite (mirrors revoke-sessions.spec.ts:13-15 rationale).
//
// Fixture user — `alice+55e@test.local`, dedicated to this spec to avoid
// collision with sibling 55-* fixture users (alice+55, +55c, +55d).
// User row persists across runs (only resource rows are cleaned by
// `clearAllData`). The first run sign-ups + verifies; subsequent runs
// detect USER_ALREADY_EXISTS on sign-up and skip the verify hop.
//
// Browser-side error invariant: every step ends with `expectNoBrowserErrors(page)`.

import { expect, test } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";
import { fetchVerificationLink } from "../support/mailpit.js";

const WEB_BASE = "http://localhost:3000";
const FIXTURE_EMAIL = "alice+55e@test.local";
const FIXTURE_PASSWORD = "Theme55e!#StrongTest";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — theme switcher 3-option cycle (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // eslint-disable-next-line prettier/prettier -- single-line skip required by Plan 55-03-b done-gate grep
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-03-b acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
    // Multi-navigation flow (sign-up -> /sign-in -> /app -> theme flips
    // -> reload) cancels in-flight Next.js chunk prefetches that surface
    // as `GET /_next/static/chunks/<hash>.js -> net::ERR_ABORTED`. Same
    // framework-level abort class as the `_rsc=…` entries already in
    // DEFAULT_ALLOWLIST — not a real bug. Mirrors
    // revoke-sessions.spec.ts:109-111.
    allowBrowserErrors(page, [
      /GET [^ ]+\/_next\/static\/chunks\/[^ ]+ → FAILED: net::ERR_ABORTED/,
      // Step 1's "try sign-in first" probe deliberately fails with 401
      // INVALID_EMAIL_OR_PASSWORD on the first ever run (alice+55e
      // doesn't exist yet → fall through to sign-up + verify). Mirrors
      // delete-account.spec.ts:57-65. Not a real bug.
      /POST [^ ]+\/api\/auth\/sign-in\/email[^ ]* → 401\b/,
      /Failed to load resource:.*\b401\b/,
    ]);
  });

  test("theme switcher cycles Light → Dark → System on /app; reload preserves Dark; zero browser errors", async ({
    page,
    context,
  }) => {
    await test.step("step 1 — provision + sign in alice+55e idempotently via web UI", async () => {
      // Strategy mirrors revoke-sessions.spec.ts:119-168: try sign-in
      // first; on failure, fall back to sign-up + mailpit verify.
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
        await page.goto(`${WEB_BASE}/sign-up`);
        await expect(page).toHaveURL(/\/sign-up$/);
        await page.getByLabel(/^Name/i).fill("Alice55e Theme");
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

        await page.goto(`${WEB_BASE}/sign-in`);
        await page.getByLabel(/^Email/i).fill(FIXTURE_EMAIL);
        await page.getByLabel(/^Password/i).fill(FIXTURE_PASSWORD);
        await page.getByRole("button", { name: /sign in|log in/i }).click();
        await page.waitForURL(/\/app(\/.*)?$/, { timeout: 15_000 });
      }

      await expect(page).toHaveURL(/\/app(\/.*)?$/);
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — open theme dropdown, assert 3 menuitem options visible", async () => {
      const toggle = page.getByRole("button", { name: /toggle theme/i });
      await expect(toggle).toBeVisible();
      await toggle.click();

      // Radix renders the DropdownMenuContent in a portal at body level.
      // `getByRole("menuitem")` resolves through the accessibility tree.
      await expect(page.getByRole("menuitem", { name: /^light$/i })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /^dark$/i })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: /^system$/i })).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — click Light → <html data-theme='light'>", async () => {
      await page.getByRole("menuitem", { name: /^light$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light", {
        timeout: 5_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — re-open dropdown, click Dark → <html data-theme='dark'>", async () => {
      // DropdownMenu auto-closes on menuitem click → must re-open.
      await page.getByRole("button", { name: /toggle theme/i }).click();
      await page.getByRole("menuitem", { name: /^dark$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", {
        timeout: 5_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — emulate OS=light, click System → resolves to light", async () => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.getByRole("button", { name: /toggle theme/i }).click();
      await page.getByRole("menuitem", { name: /^system$/i }).click();

      // Under `attribute="data-theme"` config, next-themes writes the
      // resolved theme (the OS preference) to `data-theme`. With
      // emulated colorScheme=light, the resolved value is "light".
      // localStorage key "theme" stores the literal user choice
      // ("system"); the data-theme attribute reflects the resolved
      // value used by Tailwind 4's [data-theme="dark"] selector.
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light", {
        timeout: 5_000,
      });
      // The user's literal choice IS "system" — verify localStorage
      // persisted it so future loads can re-resolve from OS preference.
      const storedTheme = await page.evaluate(() => window.localStorage.getItem("theme"));
      expect(storedTheme).toBe("system");
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — switch to Dark, reload, assert persistence", async () => {
      await page.getByRole("button", { name: /toggle theme/i }).click();
      await page.getByRole("menuitem", { name: /^dark$/i }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", {
        timeout: 5_000,
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      // localStorage "theme" survives the reload → next-themes
      // re-applies "dark" on hydration. Auto-retrying matcher polls
      // while the inline theme-init script fires.
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", {
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });
  });
});
