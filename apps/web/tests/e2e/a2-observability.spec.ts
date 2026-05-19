// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 12 — A2 Observability hub Playwright spec.
//
// Validates:
//   - With NEXT_PUBLIC_GRAFANA_BASE_URL set in the running web container, the
//     screen renders six dashboard cards + four quick-links; every external
//     anchor opens in a new tab (target="_blank") and carries
//     rel="noopener noreferrer".
//   - axe-core clean (WCAG 2.0 A + AA, WCAG 2.2 AA).
//
// Auth model: admin = regular user with users.role='admin'. The
// per-worker fixture (`fixtures/auth.ts` patchEmailVerified) grants
// role=admin to the worker's alice+<index>@test.local row at
// global-setup, so the inherited storageState carries an admin session.
// No Traefik basic-auth, no httpCredentials — the role gate in
// AdminLayout via getServerSession is the only check.
//
// State coverage (per UI-SPEC):
//   - success → covered: with env set, six cards + four quick-links present
//   - error   → covered separately by vitest (env is build-time inlined)
//   - loading → N/A
//   - empty   → N/A
//   - a11y    → axe scan
import { expect, test } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe";

test.describe("A2 — Observability hub (Phase 07.1 / Plan 12)", () => {
  // Phase 53 / Plan 53-29 — three "success" specs below require the
  // web container to be built with NEXT_PUBLIC_GRAFANA_BASE_URL set
  // (Phase 12 contract). Slim quickstart base does NOT bundle the
  // observability overlay so the var is empty — the page renders the
  // "Grafana endpoint not configured" alert instead of dashboard cards.
  // These specs belong to the observability-overlay e2e config; under
  // slim they are skipped. Operators running with the observability
  // overlay AND a real Grafana set the env and these specs activate.
  // Detection: page.locator('a[data-observability-card]').count() > 0.
  test.beforeEach(async ({ page }, testInfo) => {
    if (
      !testInfo.title.startsWith("success") &&
      testInfo.title !==
        "every dashboard anchor has target=_blank and rel includes noopener+noreferrer"
    ) {
      return;
    }
    await page.goto("/admin/observability");
    const cardCount = await page.locator("a[data-observability-card]").count();
    if (cardCount === 0) {
      testInfo.skip(
        true,
        "NEXT_PUBLIC_GRAFANA_BASE_URL not configured — observability overlay required",
      );
    }
  });

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
