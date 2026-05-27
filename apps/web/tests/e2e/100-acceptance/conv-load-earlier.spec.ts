// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-17 — Long-form acceptance: ConvDetail "Load earlier messages"
// pagination. Closes UC-CONV-DETAIL-LOAD-EARLIER from RESEARCH.md
// §"/app/conversations/[id]".
//
// `ConversationDetailClient.tsx:41 PAGE_LIMIT=50`. Seeding 51 messages
// triggers `hasMore` → renders the Load earlier button at line 240-249.
// Clicking it advances the keyset cursor + prepends the older page.
//
// Slim-only. Per-worker authenticated fixture (alice+0).

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import { attachBrowserDiagnostics, expectNoBrowserErrors } from "../support/browser-diagnostics.js";

const test = base.extend({});

test.describe("@phase55-acceptance @long-form — conv detail load-earlier (slim)", () => {
  test.use({ storageState: storageStatePath(0) });

  test.beforeEach(async ({ page }, testInfo) => {
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-17 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    const seed = bindToContext(page.context());
    await seed.clearAllData();
  });

  test("conv detail load-earlier: seed 51 messages → Load earlier button visible → click prepends older page — zero browser errors", async ({
    page,
  }) => {
    const seed = bindToContext(page.context());
    const seeded = await seed.seedConversations({
      title: "Acceptance conv 55-17 load-earlier",
      withMessages: 51,
    });
    const convId = seeded[0]?.id;
    if (!convId) throw new Error("seedConversations returned no rows");

    await page.goto(`/app/conversations/${convId}`);
    await page.waitForLoadState("networkidle");

    // First page renders 50 messages (PAGE_LIMIT=50 from
    // ConversationDetailClient.tsx:41).
    const messages = page.locator('[data-testid="conv-message-bubble"]');
    await expect(messages.first()).toBeVisible({ timeout: 10_000 });
    const initialCount = await messages.count();
    expect(initialCount).toBe(50);

    // Load earlier button only renders when hasMore=true (51 > 50).
    const loadEarlier = page.getByRole("button", { name: /load earlier/i });
    await expect(loadEarlier).toBeVisible();
    expectNoBrowserErrors(page);

    // Click — fetches the older page, prepends to the thread.
    await loadEarlier.click();
    await expect.poll(async () => await messages.count()).toBe(51);
    expectNoBrowserErrors(page);

    // NOTE: `showLoadEarlier = firstPageMessages.length >= PAGE_LIMIT`
    // (ConversationDetailClient.tsx:196) is a STATIC check on the first
    // page only — the button stays visible after we exhaust older pages.
    // The handler's empty-page guard (line 114-117) bumps the cursor
    // without re-rendering. UX gap (filed as FEATURE-CONV-LOAD-EARLIER-
    // EXHAUSTION in a future audit), not in scope here.
    expectNoBrowserErrors(page);
  });
});
