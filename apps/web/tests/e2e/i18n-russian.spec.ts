// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 10 / Plan 02 — Russian rendering + hydration smoke (RED before GREEN).
//
// Validates the locale-negotiation chain end-to-end against the real
// Next.js dev/prod server fronted by Traefik (D-TEST-3). The test:
//   1. Sets the NEXT_LOCALE=ru cookie before navigating.
//   2. Visits /sign-in and asserts <html lang="ru">.
//   3. Asserts a known Russian phrase appears in the rendered DOM.
//   4. Captures the browser console and fails on any React hydration
//      mismatch error.
import { expect, test } from "./_diagnostics-fixture.js";

// Phase 53 / Plan 53-11 — derive cookie domain from WEB_ORIGIN so the
// spec runs against both Traefik host-split (https://web.localhost)
// and slim-core (http://localhost:3000) without code changes. Default
// matches the host-split topology that pre-Phase-53 specs assumed.
const COOKIE_DOMAIN = (() => {
  const origin = process.env.WEB_ORIGIN ?? "https://api.localhost";
  try {
    return new URL(origin).hostname;
  } catch {
    return "api.localhost";
  }
})();

test.describe("i18n — Russian rendering", () => {
  test("renders /sign-in in Russian with no hydration mismatch", async ({ context, page }) => {
    // Inject NEXT_LOCALE cookie before the first navigation so middleware
    // resolves x-locale=ru on the initial request.
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: "ru",
        domain: COOKIE_DOMAIN,
        path: "/",
        sameSite: "Lax",
      },
    ]);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    // The sign-in heading is the highest-traffic Russian surface in v1.
    await expect(page.getByRole("heading", { name: /Вход в OpenWhispr/ })).toBeVisible();

    const hydrationErrors = consoleErrors.filter((e) => /hydrat/i.test(e));
    expect(hydrationErrors, hydrationErrors.join("\n")).toEqual([]);
  });

  test("language switcher persists locale across reload", async ({ context, page }) => {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /Русский/ }).click();

    // The /api/locale POST sets NEXT_LOCALE; router.refresh re-renders ru.
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    const cookies = await context.cookies();
    const locale = cookies.find((c) => c.name === "NEXT_LOCALE");
    expect(locale?.value).toBe("ru");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  });
});
