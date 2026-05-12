// Phase 07.1 / Plan 12 — A2 Observability hub Playwright spec.
//
// Validates:
//   - With NEXT_PUBLIC_GRAFANA_BASE_URL set in the running web container, the
//     screen renders six dashboard cards + four quick-links; every external
//     anchor opens in a new tab (target="_blank") and carries
//     rel="noopener noreferrer".
//   - axe-core clean (WCAG 2.0 A + AA, WCAG 2.2 AA).
//
// Auth model (D-ADMIN-1): /admin/* is gated by Traefik basic-auth, NOT by
// session. We use Playwright's `httpCredentials` to attach the
// `Authorization: Basic ...` header on every request. The test compose stack
// publishes admin:testpw123 via the admin-basicauth middleware (Plan 03).
//
// State coverage (per UI-SPEC):
//   - success → covered: with env set, six cards + four quick-links present
//   - error   → covered separately by vitest (env is build-time inlined; the
//                running compose web image always builds with values set)
//   - loading → N/A (no async fetch — explicitly called out as N/A by spec)
//   - empty   → N/A (static list)
//   - a11y    → axe scan
import { expect, test } from "@playwright/test";
import { runAxe } from "./fixtures/axe";

const ADMIN_BASIC_USER = "admin";
const ADMIN_BASIC_PASS = "testpw123";

test.use({
  httpCredentials: { username: ADMIN_BASIC_USER, password: ADMIN_BASIC_PASS },
});

test.describe("A2 — Observability hub (Phase 07.1 / Plan 12)", () => {
  test("basic-auth header reaches the web container (no 401)", async ({ request }) => {
    const res = await request.get("/admin/observability");
    expect(res.status()).not.toBe(401);
    expect(res.status()).toBeLessThan(500);
  });

  test("success — heading, Open Grafana button, six dashboard cards", async ({ page }) => {
    await page.goto("/admin/observability");
    await expect(page.getByRole("heading", { level: 1, name: /observability/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /open grafana/i })).toBeVisible();
    // Six dashboard cards by canonical title.
    for (const title of [
      /api tier — request latency/i,
      /worker — stt job queue/i,
      /postgres — partitions and vacuum/i,
      /litellm — provider routing/i,
      /security — rate limits and auth failures/i,
      /system — cpu, ram, disk, network/i,
    ]) {
      await expect(page.getByRole("link", { name: title })).toBeVisible();
    }
  });

  test("success — four quick-links present", async ({ page }) => {
    await page.goto("/admin/observability");
    for (const title of [
      /loki — application logs/i,
      /mimir — prometheus metrics/i,
      /tempo — distributed tracing/i,
      /alertmanager — routing and silences/i,
    ]) {
      await expect(page.getByRole("link", { name: title })).toBeVisible();
    }
  });

  test("every dashboard anchor has target=_blank and rel includes noopener+noreferrer", async ({
    page,
  }) => {
    await page.goto("/admin/observability");
    const anchors = await page.locator("a[data-observability-card]").all();
    expect(anchors.length).toBeGreaterThanOrEqual(6);
    for (const a of anchors) {
      expect(await a.getAttribute("target")).toBe("_blank");
      const rel = (await a.getAttribute("rel")) ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    }
  });

  test("axe-core — no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto("/admin/observability");
    await expect(page.getByRole("heading", { level: 1, name: /observability/i })).toBeVisible();
    await runAxe(page);
  });
});
