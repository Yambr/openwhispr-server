// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-10 — Long-form acceptance: /app/transcriptions list client-side
// navigation + delete confirm/cancel UCs.
//
// Closes three MISSING UCs from Phase 55 RESEARCH.md §"/app/transcriptions
// (list)":
//   UC-TRX-LIST-ROW-CLICK          — click row preview <a> → navigate to
//                                      /app/transcriptions/[id]
//                                      (TranscriptionsListClient.tsx:217-221)
//   UC-TRX-LIST-DELETE-CONFIRM     — Delete trigger → AlertDialog confirm
//                                      → DELETE /api/transcriptions/delete
//                                      → list invalidates + row drops
//                                      (TranscriptionsListClient.tsx:101-110,
//                                       229-251)
//   UC-TRX-LIST-DELETE-CANCEL      — Delete trigger → AlertDialog Cancel
//                                      → dialog closes, row count unchanged
//                                      (TranscriptionsListClient.tsx:243-245)
//
// Slim-only per the 100-acceptance suite contract. Uses the per-worker
// authenticated fixture user (alice+<parallelIndex>@test.local) via the
// storageState fixture inherited from ../fixtures/auth.ts. Seeds two
// transcriptions per test — one to navigate into (step 2), one to delete
// (steps 3 + 4) — and clears prior fixture-user data first.
//
// Selector caveats:
//   - The Delete button on each row AND the AlertDialogAction inside the
//     dialog both render the same accessible name "Delete" (i18n key
//     end-user.trx-list.row.action-delete.label). The row-level trigger
//     is selected via the table row containing the transcription preview
//     text; the confirm button is scoped inside getByRole("alertdialog").
//   - Row preview links use the (possibly truncated) text content via
//     truncate(row.text, 60). Seed text under 60 chars so the displayed
//     link text equals the seed text verbatim.
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — trx list navigation (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-10 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    // Phase 56: DELETE 204 + immediate router.push produces ERR_ABORTED on in-flight requests.
    allowBrowserErrors(page, [/ERR_ABORTED/i]);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("trx list navigation: row click + delete cancel + delete confirm — zero browser errors", async ({
    page,
    context,
  }) => {
    const navText = "Acceptance trx 55-10 nav";
    const delText = "Acceptance trx 55-10 del";

    const seed = bindToContext(context);

    const navId =
      await test.step("step 1 — seed 2 transcriptions + visit /app/transcriptions", async () => {
        const [delRow] = await seed.seedTranscriptions({ count: 1, text: delText });
        const [navRow] = await seed.seedTranscriptions({ count: 1, text: navText });
        if (!delRow || !navRow) throw new Error("seedTranscriptions returned no rows");
        await page.goto(`${WEB_BASE}/app/transcriptions`);
        await expect(page.getByRole("link", { name: navText })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("link", { name: delText })).toBeVisible({ timeout: 10_000 });
        expectNoBrowserErrors(page);
        return navRow.id;
      });

    await test.step("step 2 — UC-TRX-LIST-ROW-CLICK: click row preview <a> → /app/transcriptions/<id>", async () => {
      await page.getByRole("link", { name: navText }).click();
      await page.waitForURL(new RegExp(`/app/transcriptions/${navId}$`), { timeout: 10_000 });
      // TranscriptionDetailClient renders <h1>{trx-detail.title.heading}</h1>
      // → "Transcription" in en.
      await expect(page.getByRole("heading", { level: 1, name: /^Transcription$/ })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — UC-TRX-LIST-DELETE-CANCEL: Delete trigger → Cancel closes dialog, row stays", async () => {
      await page.goto(`${WEB_BASE}/app/transcriptions`);
      const delRowLocator = page.getByRole("row").filter({ hasText: delText });
      await expect(delRowLocator).toBeVisible({ timeout: 10_000 });
      await delRowLocator.getByRole("button", { name: /^Delete$/ }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Cancel$/ }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("link", { name: delText })).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — UC-TRX-LIST-DELETE-CONFIRM: Delete trigger → Confirm fires DELETE + row drops", async () => {
      const delRowLocator = page.getByRole("row").filter({ hasText: delText });
      await delRowLocator.getByRole("button", { name: /^Delete$/ }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const deletePromise = page.waitForResponse(
        (r) => r.url().includes("/api/transcriptions/delete") && r.request().method() === "DELETE",
      );
      await dialog.getByRole("button", { name: /^Delete$/ }).click();
      const deleteRes = await deletePromise;
      expect(deleteRes.status(), "delete returns 200 or 204").toBeLessThan(300);
      await expect(page.getByRole("link", { name: delText })).toHaveCount(0, { timeout: 10_000 });
      await expect(page.getByRole("link", { name: navText })).toBeVisible();
      expectNoBrowserErrors(page);
    });
  });
});
