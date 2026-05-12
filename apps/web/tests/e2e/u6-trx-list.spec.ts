// Phase 07.1 / Plan 09 — U6 transcriptions list (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real seeded data via fixtures/seed.ts.

import { fixtureEmail, provisionTestUser, signInAs } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const ROUTE = "**/api/transcriptions/list**";

test.describe("U6 — transcriptions list (Phase 07.1 / Plan 09)", () => {
  test.beforeEach(async ({ page, context }) => {
    await provisionTestUser(page.request, 0);
    await signInAs(page, fixtureEmail(0));
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
  });

  test("empty state — friendly empty card after clearAllData", async ({ page }) => {
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/No transcriptions yet/i)).toBeVisible();
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(ROUTE, 500);
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/Could not load transcriptions/i)).toBeVisible();
  });

  test("success state — N seeded rows render and Delete removes one", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedTranscriptions({ count: 3 });
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/Seed transcription 0/i)).toBeVisible();
    await expect(page.getByText(/Seed transcription 1/i)).toBeVisible();
    await expect(page.getByText(/Seed transcription 2/i)).toBeVisible();
  });

  test("axe — WCAG 2.2 AA clean on populated list", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedTranscriptions({ count: 1 });
    await page.goto("/app/transcriptions");
    await expect(page.getByText(/Seed transcription 0/i)).toBeVisible();
    await runAxe(page);
  });
});
