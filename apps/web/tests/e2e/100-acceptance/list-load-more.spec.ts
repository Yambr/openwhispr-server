// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-14 — Long-form acceptance: "Load more" button on 3 list screens.
//
// Closes three MISSING UCs from Phase 55 RESEARCH.md (UC coverage audit):
//
//   1. UC-NOTES-LOAD-MORE
//      NotesListClient.tsx:282-288 — Load more <Button> renders when
//      list.data.notes.length >= PAGE_LIMIT (20).
//
//   2. UC-CONV-LIST-LOAD-MORE
//      ConversationsListClient.tsx:227-233 — Load more <Button> renders
//      when items.length >= PAGE_LIMIT (20).
//
//   3. UC-TRX-LIST-LOAD-MORE
//      TranscriptionsListClient.tsx:257-263 — Load more <Button> renders
//      when items.length >= PAGE_LIMIT (20).
//
// Observable contract under test:
//   - Page hydrates 20 visible rows for the seeded resource type.
//   - "Load more" button is visible (hasMore branch is rendered).
//   - Clicking the button fires a fresh GET against the list endpoint —
//     production currently wires onClick to `list.refetch()` so the
//     visible-row count does NOT increase (the cursor is fixed at 20).
//     Asserting the refetch network round-trip is the strongest UC-visible
//     signal we can lock today without changing production behaviour.
//   - Zero browser-side errors across the whole flow.
//
// Why one consolidated spec for all three screens:
//   The 3 list screens share the identical pagination shape (PAGE_LIMIT=20,
//   hasMore = items.length >= PAGE_LIMIT, onClick = list.refetch()). A single
//   spec with three steps amortises the per-worker fixture-user login cost
//   (RESEARCH.md §Slim authenticated cost budget) and keeps the suite count
//   at 25 specs total (was 24 before 55-14).
//
// Slim-only by design — production-equivalent routing is covered by the
// per-list 100-acceptance navigation specs already in the suite.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";
// PAGE_LIMIT mirrored from NotesListClient.tsx / ConversationsListClient.tsx /
// TranscriptionsListClient.tsx — all three lists share the same constant.
const PAGE_LIMIT = 20;
// Seed exactly PAGE_LIMIT rows to hit the `items.length >= PAGE_LIMIT` branch.
const SEED_COUNT = PAGE_LIMIT;

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — list load-more on 3 screens (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-14 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("list load-more: notes + conversations + transcriptions — button renders + refetches on click — zero browser errors", async ({
    page,
    context,
  }) => {
    const seed = bindToContext(context);

    await test.step("step 1 — UC-NOTES-LOAD-MORE: seed 20 notes → /app/notes → Load more visible + refetches on click", async () => {
      await seed.seedNotes({ count: SEED_COUNT });
      await page.goto(`${WEB_BASE}/app/notes`);
      // Hydration completes when the table renders the seeded rows. We pick
      // the first seeded title ("Seed Note 0") as a stable anchor.
      await expect(page.getByText("Seed Note 0", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      const loadMore = page.getByRole("button", { name: /^Load more$/ });
      await expect(loadMore).toBeVisible({ timeout: 10_000 });
      // Click fires a fresh GET /api/notes/list?limit=20 (production currently
      // wires onClick to list.refetch() — same query key, same limit).
      const refetchPromise = page.waitForRequest(
        (req) => req.url().includes("/api/notes/list") && req.method() === "GET",
        { timeout: 10_000 },
      );
      await loadMore.click();
      const req = await refetchPromise;
      expect(req.url()).toMatch(/\/api\/notes\/list\?limit=20(?:$|&)/);
      expectNoBrowserErrors(page);
      await seed.clearAllData();
    });

    await test.step("step 2 — UC-CONV-LIST-LOAD-MORE: seed 20 conversations → /app/conversations → Load more visible + refetches on click", async () => {
      await seed.seedConversations({ count: SEED_COUNT });
      await page.goto(`${WEB_BASE}/app/conversations`);
      await expect(page.getByText("Seed Conversation 0", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      const loadMore = page.getByRole("button", { name: /^Load more$/ });
      await expect(loadMore).toBeVisible({ timeout: 10_000 });
      const refetchPromise = page.waitForRequest(
        (req) => req.url().includes("/api/conversations/list") && req.method() === "GET",
        { timeout: 10_000 },
      );
      await loadMore.click();
      const req = await refetchPromise;
      expect(req.url()).toMatch(/\/api\/conversations\/list\?limit=20(?:$|&)/);
      expectNoBrowserErrors(page);
      await seed.clearAllData();
    });

    await test.step("step 3 — UC-TRX-LIST-LOAD-MORE: seed 20 transcriptions → /app/transcriptions → Load more visible + refetches on click", async () => {
      await seed.seedTranscriptions({ count: SEED_COUNT });
      await page.goto(`${WEB_BASE}/app/transcriptions`);
      await expect(page.getByText("Seed transcription 0", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      const loadMore = page.getByRole("button", { name: /^Load more$/ });
      await expect(loadMore).toBeVisible({ timeout: 10_000 });
      const refetchPromise = page.waitForRequest(
        (req) => req.url().includes("/api/transcriptions/list") && req.method() === "GET",
        { timeout: 10_000 },
      );
      await loadMore.click();
      const req = await refetchPromise;
      expect(req.url()).toMatch(/\/api\/transcriptions\/list\?limit=20(?:$|&)/);
      expectNoBrowserErrors(page);
    });
  });
});
