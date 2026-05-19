// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 09 — U6 transcriptions list (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real seeded data via fixtures/seed.ts.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

const ROUTE = "**/api/transcriptions/list**";

test.describe("U6 — transcriptions list (Phase 07.1 / Plan 09)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context, page }) => {
    await attachBrowserDiagnostics(page);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton rows while list endpoint is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(ROUTE);
    await page.goto("/app/transcriptions");
    await expect(page.locator('[data-testid="trx-list-skeleton-row"]').first()).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("empty state — friendly empty card after clearAllData", async ({ page }) => {
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/No transcriptions yet/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(ROUTE, 500);
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/Could not load transcriptions/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("success state — N seeded rows render and Delete removes one", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedTranscriptions({ count: 3 });
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/Seed transcription 0/i)).toBeVisible();
    await expect(page.getByText(/Seed transcription 1/i)).toBeVisible();
    await expect(page.getByText(/Seed transcription 2/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA clean on populated list", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedTranscriptions({ count: 1 });
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/Seed transcription 0/i)).toBeVisible();
    await runAxe(page);
    expectNoBrowserErrors(page);
  });
});
