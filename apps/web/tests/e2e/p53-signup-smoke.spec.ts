// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 53 / Plan 53-05 — @cjm-web-signup-1 — end-to-end sign-up via the
// rendered web UI form with the browser-diagnostics helper attached.
//
// This is the regression sentinel that would have caught the
// 2026-05-18 manual smoke bugs:
//   1. POST /api/auth/sign-up/email 404'ing from the web origin
//      (Plan 53-06 fixed via next.config rewrites())
//   2. theme-init inline script firing SecurityPolicyViolationEvent
//      (Plan 53-07 fixed by forwarding x-nonce → next-themes)
//
// Targets the SLIM-CORE base topology (no Traefik): `BASE_URL` defaults
// to http://localhost:3000 unless the caller overrides for a host-split
// dev env. Specs in this file deliberately ignore the playwright.config
// baseURL (https://api.localhost) and hit the web origin directly via
// page.goto absolute URL so the rewrite path is exercised.

import { expect, test } from "./_diagnostics-fixture.js";
// Helper auto-attach happens via the fixture's auto:true hook; the
// spec asserts business invariants and lets _attachDiagnostics handle
// the diagnostics flush + (gated by PHASE53_STRICT_DIAGNOSTICS) the
// zero-errors assertion.
import { allowBrowserErrors, expectNoBrowserErrors } from "./support/browser-diagnostics.js";
import { getOrigins } from "./support/topology.js";

test.describe("@cjm-web-signup-1 — sign-up via web UI form", () => {
  // Diagnostics attach + flush happens in `_diagnostics-fixture.ts` via
  // an auto:true fixture — no per-spec hooks needed.
  test("sign-up form submit returns 200 and surfaces 'check your email' block — zero browser errors", async ({
    page,
  }, testInfo) => {
    // Plan 53-09 — RSC pre-fetch aborts on navigation are expected
    // and not user-visible. Next.js cancels in-flight `_rsc=` requests
    // when the user moves off the page. Allowlist the abort error so
    // the helper does not flag it as a real bug.
    allowBrowserErrors(page, [/_rsc=.*FAILED: net::ERR_ABORTED/, /sign-in\?_rsc=.*FAILED/]);

    // Phase 53 / Plan 53-14 — topology-aware web origin (slim → :3000,
    // traefik → https://web.localhost). 1. Load the sign-up page.
    // Plan 53-06 rewrites() proxies /api/auth/providers (called by
    // useAuthProviders on render) to the api; pre-fix that hook 404'd.
    await page.goto(`${getOrigins(testInfo).webOrigin}/sign-up`, {
      waitUntil: "networkidle",
    });

    // 2. Fill the form. Field names match the i18n labels rendered by
    //    apps/web/src/app/(public)/sign-up/page.tsx.
    const email = `cjm-web-signup-${Date.now()}@example.test`;
    await page.getByLabel(/^Name$/i).fill("CJM Web Signup");
    await page.getByLabel(/^Email$/i).fill(email);
    await page.getByLabel(/^Password$/i, { exact: true }).fill("strongPass-Test-123!");

    // 3. Submit. Plan 53-06 rewrites() proxies the POST through to api.
    //    Pre-fix this 404'd and the UI rendered the "Sign-up failed"
    //    block instead of the "Check your email" success block.
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().endsWith("/api/auth/sign-up/email") && resp.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^Sign up$/i }).click();
    const response = await responsePromise;
    expect(response.status(), `POST /api/auth/sign-up/email status`).toBe(200);

    // 4. Success block visible.
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 });

    // 5. ZERO browser-side errors via the helper. Catches a regression
    //    of EITHER the rewrite bug (network entry for /api/auth/* 404)
    //    OR the CSP bug (csp entry for theme-init unsafe-inline).
    expectNoBrowserErrors(page);
  });
});
