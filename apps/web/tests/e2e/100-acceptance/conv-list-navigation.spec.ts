// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-10 — Long-form acceptance: /app/conversations list client-side
// navigation + delete confirm/cancel UCs.
//
// Closes three MISSING UCs from Phase 55 RESEARCH.md §"/app/conversations
// (list)":
//   UC-CONV-LIST-ROW-CLICK         — click row title <a> → navigate to
//                                      /app/conversations/[id]
//                                      (ConversationsListClient.tsx:192-194)
//   UC-CONV-LIST-DELETE-CONFIRM    — Delete trigger → AlertDialog confirm
//                                      → DELETE /api/conversations/delete
//                                      → list invalidates + row drops
//                                      (ConversationsListClient.tsx:83-92,
//                                       197-220)
//   UC-CONV-LIST-DELETE-CANCEL     — Delete trigger → AlertDialog Cancel
//                                      → dialog closes, row count unchanged
//                                      (ConversationsListClient.tsx:212-214)
//
// Slim-only per the 100-acceptance suite contract. Uses the per-worker
// authenticated fixture user (alice+<parallelIndex>@test.local) via the
// storageState fixture inherited from ../fixtures/auth.ts. Seeds two
// conversations per test — one to navigate into (step 2), one to delete
// (steps 3 + 4) — and clears prior fixture-user data first so the
// "row count drops by 1" assertion is precise.
//
// Selector caveats:
//   - The Delete button on each row AND the AlertDialogAction inside the
//     dialog both render the same accessible name "Delete" (i18n key
//     end-user.conv-list.row.action-delete.label). The row-level trigger
//     is selected via the table row containing the conversation title;
//     the confirm button is scoped inside getByRole("alertdialog").
//   - Row titles are <a href="/app/conversations/{id}"> — selected via
//     getByRole("link", { name: titleDisplay }).
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

test.describe("@phase55-acceptance @long-form — conv list navigation (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-10 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    // Phase 56: DELETE 204 + immediate router.push produces ERR_ABORTED on in-flight requests.
    allowBrowserErrors(page, [/ERR_ABORTED/i]);
    // Per-worker fixture user accumulates rows across re-runs; clear so
    // the seeded-row count assertion in step 4 is deterministic.
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("conv list navigation: row click + delete cancel + delete confirm — zero browser errors", async ({
    page,
    context,
  }) => {
    const navTitle = "Acceptance conv 55-10 nav";
    const delTitle = "Acceptance conv 55-10 del";

    const seed = bindToContext(context);

    const navId =
      await test.step("step 1 — seed 2 conversations + visit /app/conversations", async () => {
        // Seed the row destined for deletion first so it sits in the list
        // alongside the navigation target; both must appear in the table.
        // navRow gets one seeded message so ConversationDetailClient renders
        // the populated branch (which mounts the <h1>); the empty-message
        // branch shows only an empty card. delRow stays message-less — the
        // list-page Delete trigger does not depend on message presence.
        const [delRow] = await seed.seedConversations({ count: 1, title: delTitle });
        const [navRow] = await seed.seedConversations({
          count: 1,
          title: navTitle,
          withMessages: 1,
        });
        if (!delRow || !navRow) throw new Error("seedConversations returned no rows");
        await page.goto(`${WEB_BASE}/app/conversations`);
        await expect(page.getByRole("link", { name: navTitle })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("link", { name: delTitle })).toBeVisible({ timeout: 10_000 });
        expectNoBrowserErrors(page);
        return navRow.id;
      });

    await test.step("step 2 — UC-CONV-LIST-ROW-CLICK: click row title <a> → /app/conversations/<id>", async () => {
      await page.getByRole("link", { name: navTitle }).click();
      await page.waitForURL(new RegExp(`/app/conversations/${navId}$`), { timeout: 10_000 });
      // ConversationDetailClient renders <h1>{conv-detail.title.heading}</h1>
      // → "Conversation" in en.
      await expect(page.getByRole("heading", { level: 1, name: /^Conversation$/ })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — UC-CONV-LIST-DELETE-CANCEL: Delete trigger → Cancel closes dialog, row stays", async () => {
      await page.goto(`${WEB_BASE}/app/conversations`);
      const delRowLocator = page.getByRole("row").filter({ hasText: delTitle });
      await expect(delRowLocator).toBeVisible({ timeout: 10_000 });
      await delRowLocator.getByRole("button", { name: /^Delete$/ }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Cancel$/ }).click();
      await expect(dialog).toBeHidden();
      // Row count for the to-delete title is still 1.
      await expect(page.getByRole("link", { name: delTitle })).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — UC-CONV-LIST-DELETE-CONFIRM: Delete trigger → Confirm fires DELETE + row drops", async () => {
      const delRowLocator = page.getByRole("row").filter({ hasText: delTitle });
      await delRowLocator.getByRole("button", { name: /^Delete$/ }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const deletePromise = page.waitForResponse(
        (r) => r.url().includes("/api/conversations/delete") && r.request().method() === "DELETE",
      );
      await dialog.getByRole("button", { name: /^Delete$/ }).click();
      const deleteRes = await deletePromise;
      expect(deleteRes.status(), "delete returns 200 or 204").toBeLessThan(300);
      // Row drops out after list invalidates + refetches.
      await expect(page.getByRole("link", { name: delTitle })).toHaveCount(0, { timeout: 10_000 });
      // The other seeded row (nav target) survives.
      await expect(page.getByRole("link", { name: navTitle })).toBeVisible();
      expectNoBrowserErrors(page);
    });
  });
});
