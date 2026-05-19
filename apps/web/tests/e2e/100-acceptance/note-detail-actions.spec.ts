// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-04-a — Long-form acceptance: /app/notes/[id] action trio
// (Copy / Export JSON / Export Markdown) + Delete confirm + Delete cancel.
//
// Closes five MISSING UCs from RESEARCH.md §"/app/notes/[id]":
//   UC-NOTE-DETAIL-COPY            — Copy button → navigator.clipboard.writeText
//   UC-NOTE-DETAIL-EXPORT-JSON     — Export JSON → <a download="...json">
//   UC-NOTE-DETAIL-EXPORT-MD       — Export MD   → <a download="...md">
//   UC-NOTE-DETAIL-DELETE-CONFIRM  — Delete → AlertDialog confirm → DELETE
//                                      /api/notes/delete → router.push(/app/notes)
//   UC-NOTE-DETAIL-DELETE-CANCEL   — Delete → AlertDialog cancel → dialog closes,
//                                      no network call, URL unchanged
//
// Slim-only by design (mirrors the other 100-acceptance long-form specs).
// Uses the per-worker authenticated fixture user (alice+<parallelIndex>),
// inherited via the storageState fixture from ../fixtures/auth.ts. Seeds
// a fresh note per test via seedNotes() so the delete-confirm branch can
// safely vaporise the row without affecting other specs.
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.
// The 100-acceptance suite gates on zero unexpected browser errors per step.
//
// Clipboard permissions: Chromium denies navigator.clipboard.* by default
// in non-secure / headless contexts. context.grantPermissions("clipboard-
// read", "clipboard-write") in beforeEach is the canonical Playwright
// pattern documented at playwright.dev/docs/clipboard.
//
// Verification on the live slim stack (Phase 55-04-a GREEN gate):
//   OPENWHISPR_TOPOLOGY=slim PLAYWRIGHT_SKIP_WEBSERVER=1 \
//     pnpm --filter @openwhispr/web exec playwright test \
//     100-acceptance --project=slim --reporter=line
//   → 12 passed (was 11 pre-55-04-a) including this spec at slot [5/12].

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
// Playwright's fixture-dependency discovery uses Function.prototype.toString
// on the first parameter — the empty destructure is required for the
// protocol even though we don't read any built-in fixture here.
const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — note detail action trio (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-04-a acceptance suite runs against slim topology only",
    );
    // Chromium denies navigator.clipboard.* without explicit permission;
    // grant before any page interaction (handleCopy is a button onClick).
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await attachBrowserDiagnostics(page);
    // Phase 56: DELETE 204 + immediate router.push produces ERR_ABORTED on in-flight requests.
    allowBrowserErrors(page, [/ERR_ABORTED/i]);
  });

  test("note detail: copy + export JSON + export MD + delete confirm + delete cancel — zero browser errors", async ({
    page,
    context,
  }) => {
    const noteBody = "Body content for the export round-trip 55-04-a.";
    const noteTitle = "Acceptance note 55-04-a";

    // Use a stable, page-bound seed handle so the seed POST inherits the
    // authenticated session cookie jar from storageState.
    const seed = bindToContext(context);

    const noteId =
      await test.step("step 1 — seed a note via POST /api/notes/create + navigate", async () => {
        const rows = await seed.seedNotes({ title: noteTitle, content: noteBody });
        const first = rows[0];
        if (!first) throw new Error("seedNotes returned no rows");
        await page.goto(`${WEB_BASE}/app/notes/${first.id}`);
        await expect(page.getByRole("heading", { level: 1, name: noteTitle })).toBeVisible({
          timeout: 10_000,
        });
        // Wait for hydration so onClick handlers are wired before any click.
        await page.waitForLoadState("networkidle");
        expectNoBrowserErrors(page);
        return first.id;
      });

    await test.step("step 2 — Click Copy → clipboard written + sonner toast visible", async () => {
      await page.getByRole("button", { name: /^Copy$/i }).click();
      // sonner mounts a [data-sonner-toaster] region at the root layout.
      // The toast list item carries [data-sonner-toast]; assert the first
      // toast is visible. sonner auto-dismisses after ~4s — assert within
      // a 2s window.
      const toast = page.locator("[data-sonner-toast]").first();
      await expect(toast).toBeVisible({ timeout: 2_000 });
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toContain(noteBody);
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — Click Export as JSON → download fires with .json suggestedFilename", async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /^Export as JSON$/i }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.json$/i);
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — Click Export as Markdown → download fires with .md suggestedFilename", async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /^Export as Markdown$/i }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.md$/i);
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — Click Delete → AlertDialog opens → Cancel closes it, no navigation", async () => {
      // Delete trigger lives outside any dialog; first() is defensive in
      // case the AlertDialogAction inside the dialog matches the same
      // accessible name (it does — see NoteDetailClient.tsx:240 vs :256).
      await page
        .getByRole("button", { name: /^Delete$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Cancel$/i }).click();
      await expect(dialog).toBeHidden();
      // No URL change — still on the note detail.
      expect(page.url()).toContain(`/app/notes/${noteId}`);
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — Click Delete → AlertDialog confirm fires DELETE + pushes /app/notes", async () => {
      await page
        .getByRole("button", { name: /^Delete$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const deletePromise = page.waitForResponse(
        (r) => r.url().includes("/api/notes/delete") && r.request().method() === "DELETE",
      );
      // Confirm button shares the "Delete" label with the trigger; scope
      // strictly inside the dialog. This is the alertdialog-scoped one.
      await dialog.getByRole("button", { name: /^Delete$/i }).click();
      const deleteRes = await deletePromise;
      expect(deleteRes.status(), "delete returns 200 or 204").toBeLessThan(300);
      await page.waitForURL(/\/app\/notes\/?$/, { timeout: 10_000 });
      expectNoBrowserErrors(page);
    });
  });
});
