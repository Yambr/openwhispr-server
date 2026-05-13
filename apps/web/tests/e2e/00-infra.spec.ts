// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 04 — Infrastructure smoke spec (WEB-IMPL-03).
//
// Verifies the Plan 03 docker-compose wiring works end-to-end:
//   1. /api/health returns 200 (api routed by Traefik via api@file)
//   2. / returns 200 or 307 (web router catch-all; root redirects to /app)
//   3. /admin/* without basic auth returns 401 (admin-basicauth middleware
//      engaged on web-admin@docker router)
//   4. /admin/* with `admin:testpw123` basic auth returns 200 or 404
//      (200 if the admin page exists, 404 if the route hasn't shipped yet
//      — either proves the basic-auth middleware passed)
//   5. axe-core baseline scan on / produces no critical violations
//
// D-TEST-3: no internal-logic mocks — every assertion goes through the
// real Traefik + Next.js + api stack.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ADMIN_BASIC_USER = "admin";
const ADMIN_BASIC_PASS = "testpw123";

test.describe("infra smoke (WEB-IMPL-03)", () => {
  test("GET /api/health → 200", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
  });

  test("GET / → 200 or 307 (root redirects to /app)", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    expect([200, 307]).toContain(res.status());
  });

  test("GET /admin/observability without auth → 401", async ({ request }) => {
    const res = await request.get("/admin/observability", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test("GET /admin/observability with basic auth → 200 or 404", async ({ request }) => {
    const credentials = Buffer.from(`${ADMIN_BASIC_USER}:${ADMIN_BASIC_PASS}`).toString("base64");
    const res = await request.get("/admin/observability", {
      headers: { authorization: `Basic ${credentials}` },
      maxRedirects: 0,
    });
    // 200 = page exists (post Plan 12), 404 = page not built yet (pre Plan 12).
    // Either proves the basic-auth middleware accepted the credentials and
    // forwarded the request to the web service.
    expect([200, 404]).toContain(res.status());
  });

  test("axe-core baseline scan on / has no critical violations", async ({ page }) => {
    // Some auth-guarded redirects may push us to /sign-in which is fine —
    // axe runs against whatever DOM the browser settles on.
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical).toEqual([]);
  });
});
