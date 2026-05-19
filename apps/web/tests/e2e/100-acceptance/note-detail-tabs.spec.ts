// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-15-a — Long-form acceptance: /app/notes/[id] tab switching.
//
// Closes four MISSING UCs from RESEARCH.md §"/app/notes/[id]":
//   UC-NOTE-DETAIL-TAB-CONTENT       — Content tab visible + active by default
//   UC-NOTE-DETAIL-TAB-TRANSCRIPT    — Transcript tab renders only when
//                                       row.transcript is populated
//                                       (NoteDetailClient.tsx:269-273, 285-291)
//   UC-NOTE-DETAIL-TAB-ENHANCED      — Enhanced tab renders only when
//                                       row.enhanced_content is populated
//                                       (NoteDetailClient.tsx:274-278, 292-301)
//   UC-NOTE-DETAIL-TAB-SWITCH-CLICK  — Tab switching reveals matching panel
//                                       (NoteDetailClient.tsx:264-302)
//
// The Radix Tabs primitive renders only the *active* TabsContent at any
// time; assertions therefore key off panel-text visibility immediately
// after a tab click rather than off all three panels being mounted at
// once.
//
// Slim-only by design (matches the rest of the 100-acceptance suite).
// Uses the per-worker authenticated fixture user inherited via
// storageState, and seeds a fresh note carrying transcript +
// enhanced_content via the extended seedNotes() helper (Plan 55-15-a
// extends SeedNoteArgs with `transcript` + `enhancedContent` and passes
// them through to POST /api/notes/create — wire fields already accepted
// by apps/api/src/routes/notes/create.ts:53,61).
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — note detail tabs (slim)", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-15-a acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
  });

  test("note detail: Content / Transcript / Enhanced tabs all visible + switch on click — zero browser errors", async ({
    page,
    context,
  }) => {
    const noteTitle = "Acceptance note 55-15-a";
    const noteBody = "Body content for tabs 55-15-a.";
    const transcriptText = "Test transcript text 55-15-a";
    const enhancedText = "Test enhanced markdown 55-15-a";

    const seed = bindToContext(context);

    await test.step("step 1 — seed a note with transcript + enhanced_content, navigate", async () => {
      const rows = await seed.seedNotes({
        title: noteTitle,
        content: noteBody,
        transcript: transcriptText,
        enhancedContent: enhancedText,
      });
      const first = rows[0];
      if (!first) throw new Error("seedNotes returned no rows");
      await page.goto(`${WEB_BASE}/app/notes/${first.id}`);
      await expect(page.getByRole("heading", { level: 1, name: noteTitle })).toBeVisible({
        timeout: 10_000,
      });
      await page.waitForLoadState("networkidle");
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — all three tab triggers visible (Content / Transcript / Enhanced)", async () => {
      await expect(page.getByRole("tab", { name: /^Content$/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Transcript$/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /^Enhanced$/i })).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — Content tab active by default, body visible", async () => {
      await expect(page.getByText(noteBody)).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — click Transcript tab → transcript text visible", async () => {
      await page.getByRole("tab", { name: /^Transcript$/i }).click();
      await expect(page.getByText(transcriptText)).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — click Enhanced tab → enhanced content visible", async () => {
      await page.getByRole("tab", { name: /^Enhanced$/i }).click();
      await expect(page.getByText(enhancedText)).toBeVisible();
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — click Content tab → original body visible again", async () => {
      await page.getByRole("tab", { name: /^Content$/i }).click();
      await expect(page.getByText(noteBody)).toBeVisible();
      expectNoBrowserErrors(page);
    });
  });
});
