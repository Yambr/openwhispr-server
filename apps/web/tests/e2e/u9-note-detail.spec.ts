// Phase 07.1 / Plan 10 — U9 note detail (state matrix + axe).
//
// Branch B: apps/api has no GET /api/notes/:id; we use the list endpoint
// with bounded pagination to locate a single note by id. Loading + error
// states intercept /api/notes/list per D-TEST-3.

import { fixtureEmail, provisionTestUser, signInAs } from "./fixtures/auth.js";
import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const NOTES_ROUTE = "**/api/notes/list**";

test.describe("U9 — note detail (Phase 07.1 / Plan 10)", () => {
  test.beforeEach(async ({ page, context }) => {
    await provisionTestUser(page.request, 0);
    await signInAs(page, fixtureEmail(0));
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton while list endpoint stalls", async ({ page, loadingFor }) => {
    await loadingFor(NOTES_ROUTE);
    await page.goto("/app/notes/00000000-0000-0000-0000-000000000000");
    await expect(page.locator('[data-testid="note-detail-skeleton"]')).toBeVisible();
  });

  test("empty state — not-found UI for id missing from list", async ({ page }) => {
    await page.goto("/app/notes/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/Note not found/i)).toBeVisible();
  });

  test("error state — Alert when list endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(NOTES_ROUTE, 500);
    await page.goto("/app/notes/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/Could not load note/i)).toBeVisible();
  });

  test("success state — Content tab renders for seeded note", async ({ page, context }) => {
    const seed = bindToContext(context);
    const seeded = await seed.seedNotes({ count: 1, content: "detail-body-content" });
    const id = seeded[0]!.id;
    await page.goto(`/app/notes/${id}`);
    await expect(page.getByRole("tab", { name: /Content/i })).toBeVisible();
    await expect(page.getByText(/detail-body-content/i)).toBeVisible();
  });

  test("axe — WCAG 2.2 AA clean on populated detail", async ({ page, context }) => {
    const seed = bindToContext(context);
    const seeded = await seed.seedNotes({ count: 1, content: "axe-body" });
    const id = seeded[0]!.id;
    await page.goto(`/app/notes/${id}`);
    await expect(page.getByRole("tab", { name: /Content/i })).toBeVisible();
    await runAxe(page);
  });
});
