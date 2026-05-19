// SPDX-License-Identifier: FSL-1.1-ALv2
// Infrastructure smoke spec.
//
// Verifies docker-compose wiring works end-to-end:
//   1. /api/health returns 200
//   2. / returns 200 or 307 (root redirects to /app)
//   3. /admin/* without an admin session returns the 403 role-gate
//      fallback (no Traefik basic-auth — admin gate is users.role)
//   4. axe-core baseline scan on / produces no critical violations
//
// D-TEST-3: no internal-logic mocks — every assertion goes through the
// real stack (slim or traefik topology, both with role-only admin gate).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./_diagnostics-fixture.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

test.describe("infra smoke (WEB-IMPL-03)", () => {
  test.beforeEach(async ({ page }) => {
    await attachBrowserDiagnostics(page);
  });

  test("GET /api/health → 200", async ({ page, request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expectNoBrowserErrors(page);
  });

  test("GET / → 200 or 307 (root redirects to /app)", async ({ page, request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    expect([200, 307]).toContain(res.status());
    expectNoBrowserErrors(page);
  });

  test("GET /admin/observability without admin session → role-gate 403 surface (page status 200)", async ({
    page,
  }) => {
    // /admin/* is gated by users.role via AdminLayout. An anonymous or
    // non-admin visitor sees the inline 403 fallback (rendered by the
    // layout — HTTP status remains 200, the body carries the role-gate
    // message). No Traefik basic-auth, no 401 challenge.
    await page.goto("/admin/observability");
    await expect(page.getByText(/403|forbidden/i).first()).toBeVisible({ timeout: 10_000 });
    expectNoBrowserErrors(page);
  });

  test("axe-core baseline scan on / has no critical violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical).toEqual([]);
    expectNoBrowserErrors(page);
  });
});
