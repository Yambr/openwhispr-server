// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-03-a — Long-form acceptance: LanguageSwitcher coverage across
// the 6 public routes wrapped by `apps/web/src/app/(public)/layout.tsx`.
// Closes 4 MISSING UCs from the Phase 55 RESEARCH.md
// §"Locale toggle (LanguageSwitcher)" gap audit:
//
//   UC-LOCALE-VISIBLE-PUBLIC-PAGES   — (public)/layout.tsx:17 mounts
//                                      <LanguageSwitcher /> on every
//                                      public route; only /sign-in was
//                                      previously exercised (i18n-russian
//                                      .spec.ts:15-44). This spec walks
//                                      all six.
//   UC-LOCALE-ARIA-PRESSED           — language-switcher.tsx:53 sets
//                                      aria-pressed on each button — never
//                                      asserted before this spec.
//   UC-LOCALE-EN-ACTIVE-NO-OP        — language-switcher.tsx:31 early-
//                                      returns when `next === active`,
//                                      meaning clicking the already-active
//                                      locale button fires no POST
//                                      /api/locale and no router.refresh.
//                                      This spec asserts the request is
//                                      ABSENT.
//   UC-LOCALE-RU-LABELS-PUBLIC-PAGES — locale cookie persists across
//                                      navigations between public routes
//                                      (NEXT_LOCALE written by /api/locale
//                                      survives the in-page link hop from
//                                      /sign-in to /sign-up).
//
// Slim-only by design — mirrors the established pattern from
// apps/web/tests/e2e/100-acceptance/full-flow.spec.ts +
// resend-verification.spec.ts + revoke-sessions.spec.ts. Traefik routing
// of the LanguageSwitcher mount is covered by the Phase 53 sweep.
//
// No fixture user — every route under test is public. `test.use({
// storageState: empty })` opts out of the per-worker authenticated
// fixture so the spec starts cold and exits clean.
//
// Constitutional EN-only matchers (per Plan 55-02-c precedent +
// tools/lint-english.ts). Both EN and RU buttons render with their
// native-language labels ("English" and "Russian" respectively per
// `common.language.{english,russian}.label`) even when the surrounding
// page is in EN locale — so EN regex matchers (`/english/i`,
// `/russian/i`) are sufficient and remain English-source-only.
// The `aria-pressed` attribute is locale-independent.
//
// Bounded `waitForTimeout(1500)` in step 2 is the deliberate exception
// to the Plan 53 ban: ABSENCE-of-event assertions cannot use auto-
// retrying matchers because there is no signal to retry against. The
// bound is small enough to not impact suite duration materially.

import { test as base, expect } from "@playwright/test";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

const PUBLIC_ROUTES: readonly string[] = [
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password?token=spec-fake-token-xyz",
  "/setup",
];

// Override the per-worker authenticated storageState — the LanguageSwitcher
// + the routes under test are all public; the spec starts signed-out.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

// Positional button access into the fieldset. LOCALES = ["en", "ru"] at
// `language-switcher.tsx:23` anchors the order: nth(0) is EN, nth(1) is RU.
// We use positional access instead of `getByRole("button", { name: /russian/i })`
// because the RU button label is the localized RU label in BOTH EN and RU
// locale bundles (see `apps/web/src/locales/en/common.json` —
// the RU locale bundle key common.language.russian.label). The EN-only matchers required
// by `tools/lint-english.ts` cannot resolve a Cyrillic label, so the fieldset
// children order is the only reliable selector.
function enButton(sw: import("@playwright/test").Locator): import("@playwright/test").Locator {
  return sw.getByRole("button").nth(0);
}
function ruButton(sw: import("@playwright/test").Locator): import("@playwright/test").Locator {
  return sw.getByRole("button").nth(1);
}
function switcher(page: import("@playwright/test").Page): import("@playwright/test").Locator {
  // Use the DOM <fieldset> selector instead of getByRole with name match.
  // The fieldset's aria-label is i18n-translated ("Language" in EN,
  // the RU translation in RU locale) — a single locator must work across BOTH locales after
  // the RU switch in step 3, so we cannot match on the label text. The
  // language-switcher is the only fieldset rendered on these public
  // routes, making `<fieldset>` a stable selector.
  return page.locator("fieldset").first();
}

test.describe("@phase55-acceptance @long-form — locale toggle on public pages (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-03-a acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
    // /api/auth/providers ERR_ABORTED is a known OidcButtons race on slim
    // (no OIDC providers configured → fetch aborted as component unmounts).
    allowBrowserErrors(page, [/\/api\/auth\/providers.*ERR_ABORTED/i]);
  });

  test("language switcher visible + aria-pressed correct + en-active no-op + cookie persists across navigations — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — visit each public route; switcher renders; aria-pressed defaults to EN", async () => {
      for (const route of PUBLIC_ROUTES) {
        await page.goto(`${WEB_BASE}${route}`);
        // /setup may 302 to /admin or /app when setup is already complete
        // in this slim instance — detect via final URL and skip the route
        // assertion (not a failure; the wizard's "render only when no admin
        // exists" branch is what's executing).
        if (route.startsWith("/setup")) {
          const finalUrl = page.url();
          if (!/\/setup\b/.test(finalUrl)) {
            // Setup-complete instance: redirect is the expected behaviour.
            // Move on to the next route without asserting on this one.
            continue;
          }
        }
        const sw = switcher(page);
        await expect(sw, `LanguageSwitcher missing on ${route}`).toBeVisible();
        await expect(enButton(sw), `EN button aria-pressed wrong on ${route}`).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(ruButton(sw), `RU button aria-pressed wrong on ${route}`).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        expectNoBrowserErrors(page);
      }
    });

    await test.step("step 2 — clicking EN while EN active fires no POST /api/locale (early-return branch)", async () => {
      let localeReqCount = 0;
      const counter = (req: import("@playwright/test").Request): void => {
        if (req.method() === "POST" && req.url().endsWith("/api/locale")) {
          localeReqCount += 1;
        }
      };
      page.on("request", counter);
      try {
        await page.goto(`${WEB_BASE}/sign-in`);
        const sw = switcher(page);
        await expect(sw).toBeVisible();
        await enButton(sw).click();
        // ABSENCE-of-event assertion — bounded wait per spec header.
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(
          localeReqCount,
          "clicking EN while EN active must early-return without firing POST /api/locale",
        ).toBe(0);
      } finally {
        page.off("request", counter);
      }
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — clicking RU on /sign-in flips aria-pressed + writes NEXT_LOCALE", async () => {
      const sw = switcher(page);
      const localeResponse = page.waitForResponse(
        (r) => r.url().endsWith("/api/locale") && r.request().method() === "POST",
      );
      await ruButton(sw).click();
      const resp = await localeResponse;
      expect(resp.status(), "POST /api/locale must succeed").toBeGreaterThanOrEqual(200);
      expect(resp.status()).toBeLessThan(300);
      // Wait on <html lang="ru"> as the gating signal that router.refresh()
      // has completed and the new RSC subtree has hydrated. The previous
      // sub-agent verified this is the canonical pattern (see
      // `i18n-russian.spec.ts:39`).
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      // Re-resolve the switcher locator AFTER refresh — the RSC subtree
      // is replaced wholesale so the old locator handle is stale.
      const sw2 = switcher(page);
      await expect(ruButton(sw2)).toHaveAttribute("aria-pressed", "true");
      await expect(enButton(sw2)).toHaveAttribute("aria-pressed", "false");
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — navigate to /sign-up via in-page link; RU persists; page renders without crash", async () => {
      // SignInForm footer link target is /sign-up. Don't match on label
      // text (Cyrillic after RU switch). Match by href instead.
      const signUpLink = page.locator('a[href="/sign-up"]').first();
      await signUpLink.click();
      await page.waitForURL(/\/sign-up\b/);
      // Wait on <html lang> being "ru" (cookie persisted across nav).
      await expect(page.locator("html")).toHaveAttribute("lang", "ru");
      const sw = switcher(page);
      await expect(sw).toBeVisible();
      await expect(ruButton(sw)).toHaveAttribute("aria-pressed", "true");
      await expect(enButton(sw)).toHaveAttribute("aria-pressed", "false");
      // Selector-only DOM-shape check — heading exists, page didn't
      // crash. We deliberately do NOT match the heading text (Cyrillic
      // in RU locale, violating lint-english.ts).
      await expect(page.locator("h1").first()).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — restore EN locale (good-citizen cleanup)", async () => {
      const sw = switcher(page);
      const localeResponse = page.waitForResponse(
        (r) => r.url().endsWith("/api/locale") && r.request().method() === "POST",
      );
      await enButton(sw).click();
      const resp = await localeResponse;
      expect(resp.status()).toBeGreaterThanOrEqual(200);
      expect(resp.status()).toBeLessThan(300);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      const sw2 = switcher(page);
      await expect(enButton(sw2)).toHaveAttribute("aria-pressed", "true");
      expectNoBrowserErrors(page);
    });
  });
});
