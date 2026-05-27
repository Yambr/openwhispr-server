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
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
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
      // Let Next.js settle in-flight chunk/RSC prefetches that get
      // aborted by the sign-in → /app navigation. Without this wait
      // the captured diagnostics include net::ERR_ABORTED for
      // _next/static/chunks/* — same framework-level class as the
      // _rsc=… ERR_ABORTED entries already in DEFAULT_ALLOWLIST.
      await page.waitForLoadState("networkidle");
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

    await test.step("step 6 — locale toggle en->ru->en with refresh persistence", async () => {
      // LanguageSwitcher renders two <Button>s (English / Russian) inside
      // a fieldset[aria-label="Language"] in the AppShell header. The
      // active one carries aria-pressed="true". Cyrillic literals below
      // are built from \u escapes to keep DOCS-09 (English-only sources)
      // clean — the strings match the runtime labels from
      // apps/web/src/locales/ru/common.json.
      // Russian labels encoded via \u escapes to satisfy DOCS-09
      // (English-only ASCII sources). The literal strings match the
      // runtime labels from apps/web/src/locales/ru/common.json:
      //   RU_RUSSIAN  = the language switcher "Russian" option label
      //   RU_SIGNOUT  = the AppShell header sign-out button label
      const RU_RUSSIAN = "Русский"; // "Russkij"
      const RU_SIGNOUT = "Выйти"; // "Vyjti"

      // Click the Russian option → header sign-out button flips into RU.
      await page.getByRole("button", { name: RU_RUSSIAN }).click();
      await expect(page.getByRole("button", { name: RU_SIGNOUT })).toBeVisible({ timeout: 5_000 });

      // Refresh — cookie-driven persistence; Russian copy must still render.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: RU_SIGNOUT })).toBeVisible({ timeout: 5_000 });

      // Toggle back to English; assert the English sign-out label returns.
      await page.getByRole("button", { name: "English" }).click();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 5_000 });
      expectNoBrowserErrors(page);
    });

    await test.step("step 7 — theme toggle with refresh persistence", async () => {
      // Capture the initial data-theme so we can assert a real flip
      // regardless of next-themes' system-default resolution.
      const initialTheme = await page.locator("html").getAttribute("data-theme");
      expect(initialTheme).not.toBeNull();

      // Pick a target that differs from the current value.
      const targetTheme = initialTheme === "dark" ? "light" : "dark";
      const targetLabel = targetTheme === "dark" ? /^Dark$/ : /^Light$/;

      // Open the ThemeSwitcher dropdown via its aria-label.
      await page.getByRole("button", { name: /toggle theme/i }).click();
      await page.getByRole("menuitem", { name: targetLabel }).click();

      // <html data-theme> flips to the target value.
      await expect(page.locator("html")).toHaveAttribute("data-theme", targetTheme, {
        timeout: 5_000,
      });

      // Refresh — next-themes persists via localStorage["theme"]; the
      // attribute must come back identically.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("data-theme", targetTheme, {
        timeout: 5_000,
      });

      // Toggle back to the initial value so step 8 runs against a
      // deterministic baseline (defensive — does not affect sign-out).
      const reverseLabel = initialTheme === "dark" ? /^Dark$/ : /^Light$/;
      const reverseTarget = initialTheme === "dark" ? "dark" : "light";
      await page.getByRole("button", { name: /toggle theme/i }).click();
      await page.getByRole("menuitem", { name: reverseLabel }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", reverseTarget, {
        timeout: 5_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 8 — UI sign-out + /app guard redirect", async () => {
      // Locale was returned to English at the end of step 6; theme was
      // returned to its initial value at the end of step 7. The sign-out
      // button label is therefore "Sign out" (English). PRD §8 is
      // explicit — sign-out MUST go through the UI button, NOT a direct
      // POST to /api/auth/sign-out (the legacy 100-fullflow spec uses
      // the API path; this long-form spec exercises the user-facing
      // button click that drives signOut() in auth-client.ts).
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 5_000 });
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);

      // Attempt to visit /app — the (auth)/layout.tsx server component
      // detects the cleared session and issues `redirect("/sign-in")`
      // (apps/web/src/app/(auth)/layout.tsx line 23). The plain redirect
      // does NOT carry a `from=` query param — PRD §8 only requires the
      // landing URL be /sign-in.
      await page.goto(`${WEB_BASE}/app`);
      await page.waitForURL(/\/sign-in(\?|$)/, { timeout: 5_000 });
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/sign-in(\?|$)/);
      expectNoBrowserErrors(page);
    });
  });
});
