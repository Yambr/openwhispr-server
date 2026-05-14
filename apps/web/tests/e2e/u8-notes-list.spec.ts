// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 10 — U8 notes list + folder sidebar (state matrix + axe).
//
// D-TEST-3 boundary rule:
//   - loading + error states use page.route() (network-boundary intercept).
//   - empty + success states use real seeded data via fixtures/seed.ts.
//
// D-UX5 assertion: no folder mutation UI is reachable from /app/notes.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const NOTES_ROUTE = "**/api/notes/list**";

test.describe("U8 — notes list with folder sidebar (Phase 07.1 / Plan 10)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context }) => {
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton rows while list endpoint is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(NOTES_ROUTE);
    await page.goto("/app/notes");
    await expect(page.locator('[data-testid="notes-list-skeleton-row"]').first()).toBeVisible();
  });

  test("empty state — friendly empty card after clearAllData", async ({ page }) => {
    await page.goto("/app/notes");
    await expect(page.getByText(/No notes yet/i)).toBeVisible();
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(NOTES_ROUTE, 500);
    await page.goto("/app/notes");
    await expect(page.getByText(/Could not load notes/i)).toBeVisible();
  });

  test("success state — N seeded rows render + D-UX5 zero folder mutation UI", async ({
    page,
    context,
  }) => {
    const seed = bindToContext(context);
    await seed.seedNotes({ count: 3 });
    await page.goto("/app/notes");
    await expect(page.getByText(/Seed Note 0/i)).toBeVisible();
    await expect(page.getByText(/Seed Note 1/i)).toBeVisible();
    await expect(page.getByText(/Seed Note 2/i)).toBeVisible();

    // D-UX5 — no folder-mutation affordance visible on the page.
    const offending = await page
      .locator("button", {
        hasText: /create folder|new folder|rename folder|delete folder|edit folder/i,
      })
      .count();
    expect(offending).toBe(0);
  });

  test("axe — WCAG 2.2 AA clean on populated list", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedNotes({ count: 1 });
    await page.goto("/app/notes");
    await expect(page.getByText(/Seed Note 0/i)).toBeVisible();
    await runAxe(page);
  });
});
