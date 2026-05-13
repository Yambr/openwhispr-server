// SPDX-License-Identifier: Apache-2.0
// Phase 07.1 / Plan 10 — U10 notes search (state matrix + axe).
//
// D-API: POST /api/notes/search (verified Plan 01) — NOT GET.

import { runAxe } from "./fixtures/axe.js";
import { bindToContext } from "./fixtures/seed.js";
import { expect, test } from "./fixtures/states.js";

const SEARCH_ROUTE = "**/api/notes/search";

test.describe("U10 — notes search (Phase 07.1 / Plan 10)", () => {
  // Plan 13.1 — auth provisioned by global-setup.ts; storageState is
  // applied per worker via the auth-extended `test`. Reset data state only.
  test.beforeEach(async ({ context }) => {
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("loading state — Skeleton while search endpoint is stalled", async ({
    page,
    loadingFor,
  }) => {
    await loadingFor(SEARCH_ROUTE);
    await page.goto("/app/notes/search?q=roadmap");
    await expect(page.locator('[data-testid="notes-search-skeleton"]')).toBeVisible();
  });

  test("empty state (type) — guidance copy when q is empty", async ({ page }) => {
    await page.goto("/app/notes/search");
    await expect(page.getByText(/Type a query to search your notes/i)).toBeVisible();
  });

  test("empty state (none) — no-matches copy when query yields zero rows", async ({ page }) => {
    await page.goto("/app/notes/search?q=zzzzzzzz_no_match_zzzzz");
    await expect(page.getByText(/No notes match this query/i)).toBeVisible();
  });

  test("error state — Alert when search endpoint returns 500", async ({ page, errorFor }) => {
    await errorFor(SEARCH_ROUTE, 500);
    await page.goto("/app/notes/search?q=roadmap");
    await expect(page.getByText(/Search failed/i)).toBeVisible();
  });

  test("success state — seeded matching note appears in results", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedNotes({
      count: 1,
      title: "Quarterly roadmap",
      content: "the quarterly roadmap document",
    });
    await page.goto("/app/notes/search?q=roadmap");
    await expect(page.getByText(/Quarterly roadmap/i)).toBeVisible();
  });

  test("axe — WCAG 2.2 AA clean on populated search results", async ({ page, context }) => {
    const seed = bindToContext(context);
    await seed.seedNotes({
      count: 1,
      title: "axe roadmap",
      content: "axe roadmap content",
    });
    await page.goto("/app/notes/search?q=roadmap");
    await expect(page.getByText(/axe roadmap/i)).toBeVisible();
    await runAxe(page);
  });
});
