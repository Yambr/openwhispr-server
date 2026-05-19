// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-09 — Long-form acceptance: /app/notes client-side navigation UCs.
//
// Closes four MISSING UCs from Phase 55 RESEARCH.md §"/app/notes (list +
// FoldersSidebar)":
//   UC-NOTES-SEARCH-SUBMIT         — type query + submit → router.push to
//                                      /app/notes/search?q=...
//                                      (NotesListClient.tsx:144-149)
//   UC-NOTES-ROW-CLICK-NAVIGATE    — click row title → navigate to
//                                      /app/notes/[id]
//                                      (NotesListClient.tsx:243)
//   UC-FOLDERS-CLICK-FILTER        — folder click in sidebar → push
//                                      /app/notes?folder=<id>
//                                      (FoldersSidebar.tsx:43-49, 91-108)
//   UC-FOLDERS-ALL-NOTES-CLICK     — "All notes" click → clear ?folder=
//                                      (FoldersSidebar.tsx:65-78)
//
// Slim-only by design (mirrors the other 100-acceptance long-form specs).
// Uses the per-worker authenticated fixture user (alice+<parallelIndex>),
// inherited via the storageState fixture from ../fixtures/auth.ts. Seeds
// one folder + one note inside that folder so the filter UC has a real
// folder_id to push and the row-navigation UC has a real id to click.
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.
// The 100-acceptance suite gates on zero unexpected browser errors per step.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

// Inherit the per-worker storageState so the spec runs as the
// authenticated fixture user (alice+<parallelIndex>@test.local).
const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — notes list navigation (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-09 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    // Per-worker fixture user accumulates rows across re-runs; clear so the
    // strict-mode `getByRole("link", { name: noteTitle })` resolves to exactly
    // one match.
    const seed = bindToContext(context);
    await seed.clearAllData();
    // /app/notes/search auto-fires POST /api/notes/search on mount via
    // React Query; navigating away (step 3 `goto /app/notes`) aborts that
    // in-flight POST with net::ERR_ABORTED. Framework-level expected
    // behaviour — allowlist the specific aborted endpoint.
    allowBrowserErrors(page, [/POST [^ ]+\/api\/notes\/search → FAILED: net::ERR_ABORTED/]);
  });

  test("notes navigation: search submit + row click + folder filter + All notes clear — zero browser errors", async ({
    page,
    context,
  }) => {
    const folderName = "Acceptance folder 55-09";
    const noteTitle = "Acceptance note 55-09";

    const seed = bindToContext(context);

    const { folderId, noteId } =
      await test.step("step 1 — seed 1 folder + 1 note in that folder + visit /app/notes", async () => {
        const folders = await seed.seedFolders({ name: folderName });
        const f = folders[0];
        if (!f) throw new Error("seedFolders returned no rows");
        const notes = await seed.seedNotes({ title: noteTitle, folderId: f.id });
        const n = notes[0];
        if (!n) throw new Error("seedNotes returned no rows");
        await page.goto(`${WEB_BASE}/app/notes`);
        // The notes list table populates after the React Query fetch
        // resolves. Assert the seeded row is visible before exercising
        // any navigation handler.
        await expect(page.getByRole("link", { name: noteTitle })).toBeVisible({
          timeout: 10_000,
        });
        expectNoBrowserErrors(page);
        return { folderId: f.id, noteId: n.id };
      });

    await test.step("step 2 — UC-NOTES-SEARCH-SUBMIT: type query + Enter → router.push /app/notes/search?q=...", async () => {
      const input = page.getByRole("searchbox", { name: /Search/i });
      await input.click();
      await input.fill("test");
      await input.press("Enter");
      await page.waitForURL(/\/app\/notes\/search\?q=test$/, { timeout: 10_000 });
      // Confirm we landed on the search screen, not a stale list.
      await expect(page.getByRole("heading", { level: 1, name: /^Search notes$/ })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — UC-NOTES-ROW-CLICK-NAVIGATE: click row title → /app/notes/<id>", async () => {
      await page.goto(`${WEB_BASE}/app/notes`);
      const rowLink = page.getByRole("link", { name: noteTitle });
      await expect(rowLink).toBeVisible({ timeout: 10_000 });
      await rowLink.click();
      await page.waitForURL(new RegExp(`/app/notes/${noteId}$`), { timeout: 10_000 });
      await expect(page.getByRole("heading", { level: 1, name: noteTitle })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — UC-FOLDERS-CLICK-FILTER: click folder in sidebar → ?folder=<id> + filtered list", async () => {
      await page.goto(`${WEB_BASE}/app/notes`);
      const sidebar = page.getByTestId("folders-sidebar");
      await expect(sidebar).toBeVisible({ timeout: 10_000 });
      const folderLink = sidebar.getByRole("link", { name: folderName });
      await expect(folderLink).toBeVisible({ timeout: 10_000 });
      await folderLink.click();
      await page.waitForURL(new RegExp(`/app/notes\\?folder=${folderId}$`), {
        timeout: 10_000,
      });
      // Filtered list still shows the seeded note (it belongs to that folder).
      await expect(page.getByRole("link", { name: noteTitle })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — UC-FOLDERS-ALL-NOTES-CLICK: click 'All notes' → ?folder= cleared", async () => {
      const sidebar = page.getByTestId("folders-sidebar");
      const allNotes = sidebar.getByRole("link", { name: /^All notes$/ });
      await expect(allNotes).toBeVisible({ timeout: 10_000 });
      await allNotes.click();
      // Router.push(pathname) with no query string → URL ends at /app/notes
      // (no ?folder= segment).
      await page.waitForURL(/\/app\/notes$/, { timeout: 10_000 });
      expect(page.url()).not.toContain("folder=");
      // Unfiltered list still shows the seeded note.
      await expect(page.getByRole("link", { name: noteTitle })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });
  });
});
