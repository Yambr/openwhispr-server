// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 09 — U7 transcription detail (state matrix + axe).
//
// Step 0 result: GET /api/transcriptions/list does NOT support ?id filter
// (Branch B). U7 uses list-then-filter with bounded pagination; this spec
// intercepts the SAME list endpoint as U6.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const ROUTE = "**/api/transcriptions/list**";
const TRANSCRIPT_TEXT =
  "First paragraph of seeded content for U7 detail.\n\nSecond paragraph contains different words.\n\nThird paragraph closes the test fixture.";

test.describe("U7 — transcription detail (Phase 07.1 / Plan 09)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context }) => {
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton while list endpoint stalls (Branch B fetches list)", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(ROUTE);
    await page.goto("/app/transcriptions/00000000-0000-0000-0000-000000000000");
    await expect(page.locator('[data-testid="trx-detail-skeleton"]')).toBeVisible();
  });

  test("empty state — not-found UI for id missing from list", async ({ page }) => {
    await page.goto("/app/transcriptions/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/Transcription not found/i)).toBeVisible();
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(ROUTE, 500);
    await page.goto("/app/transcriptions/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/Could not load transcription/i)).toBeVisible();
  });

  test("success state — metadata + flat paragraphs render, NO timecodes in body", async ({
    page,
    context,
  }) => {
    const seed = bindToContext(context);
    const seeded = await seed.seedTranscriptions({ count: 1, text: TRANSCRIPT_TEXT });
    const id = seeded[0]!.id;
    await page.goto(`/app/transcriptions/${id}`);
    await expect(page.getByText(/First paragraph/i)).toBeVisible();
    await expect(page.getByText(/Second paragraph/i)).toBeVisible();
    await expect(page.getByText(/Third paragraph/i)).toBeVisible();
    // D-API1 constitutional — no timecode pattern anywhere inside the paragraphs.
    const paragraphsText = (
      await page.locator('[data-testid="trx-paragraph"]').allTextContents()
    ).join(" ");
    expect(paragraphsText).not.toMatch(/\d{1,2}:\d{2}/);
  });

  test("axe — WCAG 2.2 AA clean on populated detail", async ({ page, context }) => {
    const seed = bindToContext(context);
    const seeded = await seed.seedTranscriptions({ count: 1, text: TRANSCRIPT_TEXT });
    const id = seeded[0]!.id;
    await page.goto(`/app/transcriptions/${id}`);
    await expect(page.getByText(/First paragraph/i)).toBeVisible();
    await runAxe(page);
  });
});
