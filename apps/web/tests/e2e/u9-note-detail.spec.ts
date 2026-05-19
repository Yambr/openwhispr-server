// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 07.1 / Plan 10 — U9 note detail (state matrix + axe).
//
// Branch B: apps/api has no GET /api/notes/:id; we use the list endpoint
// with bounded pagination to locate a single note by id. Loading + error
// states intercept /api/notes/list per D-TEST-3.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "./support/browser-diagnostics.js";

const NOTES_ROUTE = "**/api/notes/list**";

test.describe("U9 — note detail (Phase 07.1 / Plan 10)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context, page }) => {
    await attachBrowserDiagnostics(page);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton while list endpoint stalls", async ({ page, loadingFor }) => {
    await loadingFor(NOTES_ROUTE);
    await page.goto("/app/notes/00000000-0000-0000-0000-000000000000");
    await expect(page.locator('[data-testid="note-detail-skeleton"]')).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("empty state — not-found UI for id missing from list", async ({ page }) => {
    await page.goto("/app/notes/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/Note not found/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(NOTES_ROUTE, 500);
    await page.goto("/app/notes/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/Could not load note/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("success state — Content tab renders for seeded note", async ({ page, context }) => {
    const seed = bindToContext(context);
    const seeded = await seed.seedNotes({ count: 1, content: "detail-body-content" });
    const first = seeded[0];
    if (!first) throw new Error("seedNotes returned no rows");
    const id = first.id;
    await page.goto(`/app/notes/${id}`);
    await expect(page.getByRole("tab", { name: /Content/i })).toBeVisible();
    await expect(page.getByText(/detail-body-content/i)).toBeVisible();
    expectNoBrowserErrors(page);
  });

  test("axe — WCAG 2.2 AA clean on populated detail", async ({ page, context }) => {
    const seed = bindToContext(context);
    const seeded = await seed.seedNotes({ count: 1, content: "axe-body" });
    const first = seeded[0];
    if (!first) throw new Error("seedNotes returned no rows");
    const id = first.id;
    await page.goto(`/app/notes/${id}`);
    await expect(page.getByRole("tab", { name: /Content/i })).toBeVisible();
    await runAxe(page);
    expectNoBrowserErrors(page);
  });
});
