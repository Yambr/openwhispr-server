// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-04-c — Long-form acceptance: /app/conversations/[id] action trio
// (Copy / Export JSON) + Delete confirm + Delete cancel.
//
// Closes four MISSING UCs from RESEARCH.md §"/app/conversations/[id]":
//   UC-CONV-DETAIL-COPY            — Copy button → navigator.clipboard.writeText
//   UC-CONV-DETAIL-EXPORT-JSON     — Export JSON → <a download="...json">
//   UC-CONV-DETAIL-DELETE-CONFIRM  — Delete → AlertDialog confirm → DELETE
//                                      /api/conversations/delete →
//                                      router.push(/app/conversations)
//   UC-CONV-DETAIL-DELETE-CANCEL   — Delete → AlertDialog cancel → dialog
//                                      closes, no network call, URL unchanged
//
// Structural twin of `note-detail-actions.spec.ts` (Plan 55-04-a) and
// `trx-detail-actions.spec.ts` (Plan 55-04-b). Conversation detail differs:
// it exposes Copy + Export JSON only — there is NO "Export as Markdown"
// button (see ConversationDetailClient.tsx:198-235). The spec asserts the
// JSON download once and does NOT assert a Markdown download.
//
// Slim-only per the 100-acceptance suite contract. Uses the per-worker
// authenticated fixture user (alice+<parallelIndex>@test.local) via the
// storageState fixture inherited from ../fixtures/auth.ts. Seeds a fresh
// conversation with one message per test via seedConversations({ count: 1,
// withMessages: 1 }) so the delete-confirm branch can safely vaporise the
// row without affecting other specs.
//
// Why `withMessages: 1` and not zero: ConversationDetailClient renders the
// "No messages" empty-state card when the message list is empty (see
// lines 157-171 of ConversationDetailClient.tsx) — in that branch the
// Copy / Export JSON / Delete buttons are NOT rendered. Seeding one
// message advances the component into the populated branch where the
// action trio mounts.
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.
// The 100-acceptance suite gates on zero unexpected browser errors per step.
//
// Clipboard permissions: Chromium denies navigator.clipboard.* by default
// in non-secure / headless contexts. context.grantPermissions("clipboard-
// read", "clipboard-write") in beforeEach is the canonical Playwright
// pattern documented at playwright.dev/docs/clipboard.
//
// ConversationDetailClient.handleCopy() concatenates "### <role-label>\n
// <content>\n" for every message in chronological-ascending order. The
// clipboard assertion uses `toContain("seed message 0")` to remain robust
// if future iterations adjust the role-label format.
//
// Accessible-name caveats:
//   - The "Copy" trigger is rendered with label "Copy transcript"
//     (end-user.conv-detail.action.copy.label).
//   - The "Delete" trigger AND the AlertDialogAction inside the dialog
//     both render the same label "Delete conversation"
//     (end-user.conv-detail.action.delete.label) — so `.first()` is used
//     on the outer trigger and the inner action is scoped via
//     dialog.getByRole("button", { name: /^Delete conversation$/i }).
//   - AlertDialogCancel renders "Cancel" (common.action.cancel.label).
//
// Verification on the live slim stack (Phase 55-04-c GREEN gate):
//   OPENWHISPR_TOPOLOGY=slim PLAYWRIGHT_SKIP_WEBSERVER=1 \
//     pnpm --filter @openwhispr/web exec playwright test \
//     100-acceptance --project=slim --reporter=line
//   → 14 passed (was 13 pre-55-04-c) including this spec at slot [2/14].
//
// Flake gate: solo-spec re-run x3 on the live slim stack: 1.7s / 1.7s / 1.7s,
// all green. No retries configured for the slim project. The DELETE-confirm
// branch vaporises the seeded row each run so the spec is idempotent across
// repeated executions against the same fixture user.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

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

test.describe("@phase55-acceptance @long-form — conv detail action trio (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-04-c acceptance suite runs against slim topology only",
    );
    // Chromium denies navigator.clipboard.* without explicit permission;
    // grant before any page interaction (handleCopy is a button onClick).
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await attachBrowserDiagnostics(page);
  });

  test("conv detail: copy + export JSON + delete confirm + delete cancel — zero browser errors", async ({
    page,
    context,
  }) => {
    // Use a stable, page-bound seed handle so the seed POST inherits the
    // authenticated session cookie jar from storageState.
    const seed = bindToContext(context);

    const convId =
      await test.step("step 1 — seed a conversation + 1 message + navigate", async () => {
        const rows = await seed.seedConversations({ count: 1, withMessages: 1 });
        const first = rows[0];
        if (!first) throw new Error("seedConversations returned no rows");
        await page.goto(`${WEB_BASE}/app/conversations/${first.id}`);
        // ConversationDetailClient renders <h1>{t(conv-detail.title.heading)}</h1>
        // — copy is "Conversation" in en. Wait on the heading + at least one
        // seeded message so onClick handlers are hydrated.
        await expect(page.getByRole("heading", { level: 1, name: /^Conversation$/i })).toBeVisible({
          timeout: 10_000,
        });
        await expect(page.getByText(/seed message 0/i)).toBeVisible({ timeout: 10_000 });
        await page.waitForLoadState("networkidle");
        expectNoBrowserErrors(page);
        return first.id;
      });

    await test.step("step 2 — Click Copy transcript → clipboard written + sonner toast visible", async () => {
      await page.getByRole("button", { name: /^Copy transcript$/i }).click();
      // sonner mounts [data-sonner-toaster] at the root layout; the toast
      // item carries [data-sonner-toast]. Auto-dismisses after ~4s — assert
      // within a 2s window.
      const toast = page.locator("[data-sonner-toast]").first();
      await expect(toast).toBeVisible({ timeout: 2_000 });
      // handleCopy concatenates "### <role-label>\n<content>\n" per message.
      // Assert the seeded body round-tripped; toContain is robust against
      // future role-label format changes.
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toContain("seed message 0");
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — Click Export as JSON → download fires with .json suggestedFilename", async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /^Export as JSON$/i }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.json$/i);
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — Click Delete conversation → AlertDialog opens → Cancel closes it, no navigation", async () => {
      // Delete trigger lives outside any dialog; first() is defensive in
      // case the AlertDialogAction inside the dialog matches the same
      // accessible name (it does — ConversationDetailClient.tsx:213 vs :228).
      await page
        .getByRole("button", { name: /^Delete conversation$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Cancel$/i }).click();
      await expect(dialog).toBeHidden();
      // No URL change — still on the conv detail.
      expect(page.url()).toContain(`/app/conversations/${convId}`);
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — Click Delete conversation → AlertDialog confirm fires DELETE + pushes /app/conversations", async () => {
      await page
        .getByRole("button", { name: /^Delete conversation$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const deletePromise = page.waitForResponse(
        (r) => r.url().includes("/api/conversations/delete") && r.request().method() === "DELETE",
      );
      // Confirm button shares the "Delete conversation" label with the
      // outer trigger; scope strictly inside the dialog.
      await dialog.getByRole("button", { name: /^Delete conversation$/i }).click();
      const deleteRes = await deletePromise;
      expect(deleteRes.status()).toBe(200);
      await page.waitForURL(/\/app\/conversations\/?$/, { timeout: 10_000 });
      expectNoBrowserErrors(page);
    });
  });
});
