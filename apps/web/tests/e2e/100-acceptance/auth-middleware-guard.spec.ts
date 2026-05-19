// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-03-c — Long-form acceptance: auth middleware guard cross-cuts
// 3 distinct paths through `apps/web/src/middleware.ts`. Closes 3
// PARTIAL UCs from Phase 55 RESEARCH.md §"Authentication middleware
// guard":
//
//   UC-GUARD-SIGNED-OUT-APP-REDIRECT-WITH-FROM — middleware.ts:133-140
//     `/app/*` while signed-out is 302'd to `/sign-in?from=<path>`. The
//     `from` query param is URL-encoded because `URL.searchParams.set`
//     percent-encodes path separators.
//   UC-GUARD-SIGNED-OUT-SIGNIN-NO-LOOP — middleware.ts (no auth gate on
//     /sign-in): visiting /sign-in signed-out renders normally; the
//     auth-gate matcher only intercepts paths starting with "/app/".
//   UC-GUARD-SIGNED-OUT-ADMIN-NO-MIDDLEWARE-REDIRECT — middleware.ts
//     comment-block lines 22-25 + the literal `startsWith("/app/")`
//     filter at line 133: /admin is EXPLICITLY NOT widened (D-ADMIN-1
//     keeps Traefik basic-auth authoritative for admin). On slim,
//     Traefik is absent — the AdminLayout defense-in-depth at
//     `apps/web/src/app/(admin)/layout.tsx` then renders an inline
//     "403 — Forbidden" surface because `checkAdminAccess(null, false)`
//     returns "forbidden" (post-Phase-51 CR-6 fail-closed default).
//     The HTTP response itself is 200 with the 403-shape HTML body —
//     the spec asserts on the visible heading, not status.
//
// Slim-only by design (mirrors all other 100-acceptance specs) —
// production-equivalent routing is covered by the Phase 53 u1..u13
// sweep + CJM suite.
//
// No fixture user. This spec is signed-out from first goto to last
// assertion — there is nothing to provision and nothing to clean up.
// `test.use({ storageState: empty })` forces an empty cookie jar so we
// never inherit a per-worker pooled sign-in.
//
// `from=` encoding contract — `URL.searchParams.set("from", "/app/notes")`
// emits `from=%2Fapp%2Fnotes`. We assert URL-encoded shape only; the
// raw `/app` form is rejected because it would indicate the middleware
// stopped using `URL.searchParams` (a real bug, not a test bug).
//
// Browser-side error invariant: every step ends with a call to
// `expectNoBrowserErrors(page)`. The /admin step needs no allowlist
// because the 403 inline surface is rendered by the layout — no API
// call fires, no console error appears.

import { test as base, expect } from "@playwright/test";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

// Override the per-worker fixture storageState — this spec MUST start
// signed-out for every step.
const test = base.extend({});
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("@phase55-acceptance @long-form — auth middleware guard (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-03-c acceptance suite runs against slim topology only — traefik path covered by Phase 53 sweep + CJM suite",
    );
    await attachBrowserDiagnostics(page);
  });

  test("middleware redirects /app/* to /sign-in?from=, /sign-in renders without loop, /admin reaches AdminLayout 403 — zero browser errors", async ({
    page,
  }) => {
    await test.step("step 1 — signed-out /app redirects to /sign-in with ?from=%2Fapp", async () => {
      // Phase 55-03-c fix (commit landed in same series): middleware
      // now matches BOTH bare /app and /app/* via explicit equality
      // check (apps/web/src/middleware.ts:135). Both paths preserve the
      // ?from= param for post-sign-in deep-link recovery.
      await page.goto(`${WEB_BASE}/app`);
      await expect(page).toHaveURL(/\/sign-in\?from=%2Fapp$/);
      await expect(page.getByRole("heading", { name: /Sign in to OpenWhispr/i })).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — signed-out /app/notes/some-id round-trips from= deeply", async () => {
      await page.goto(`${WEB_BASE}/app/notes/some-id`);
      await expect(page).toHaveURL(/\/sign-in\?from=%2Fapp%2Fnotes%2Fsome-id$/);
      await expect(page.getByRole("heading", { name: /Sign in to OpenWhispr/i })).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — signed-out /sign-in renders the page (no redirect loop)", async () => {
      await page.goto(`${WEB_BASE}/sign-in`);
      // No `from=` because the auth gate only matches `/app/` paths
      // (middleware.ts:133). A direct /sign-in visit is locale-resolved
      // and CSP-stamped but not redirected.
      await expect(page).toHaveURL(/\/sign-in$/);
      await expect(page.getByRole("heading", { name: /Sign in to OpenWhispr/i })).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — signed-out /admin reaches the AdminLayout 403 surface (no middleware redirect)", async () => {
      const response = await page.goto(`${WEB_BASE}/admin`);
      // Middleware does NOT redirect /admin (D-ADMIN-1). The
      // AdminLayout fail-closed defense-in-depth renders the inline
      // "403 — Forbidden" page when the session is null and
      // ADMIN_EDGE_AUTH_ENFORCED is unset (which is the slim default).
      // Critically: final URL is /admin, NOT /sign-in. HTTP status is
      // 200 because the layout returns JSX, not a 4xx response.
      await expect(page).toHaveURL(/\/admin$/);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: /403 — Forbidden/i })).toBeVisible();
      expectNoBrowserErrors(page);
    });
  });
});
