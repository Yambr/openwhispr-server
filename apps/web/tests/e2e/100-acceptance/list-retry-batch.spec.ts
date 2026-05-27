// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-06-batch — Long-form acceptance: list/detail Retry button click
// across 4 surfaces (precedent: usage-retry.spec.ts).
//
// Closes 4 UCs from RESEARCH.md §"list/detail retry":
//   - UC-NOTES-LIST-RETRY-CLICK
//   - UC-TRX-LIST-RETRY-CLICK
//   - UC-CONV-LIST-RETRY-CLICK
//   - UC-CONV-DETAIL-RETRY-CLICK
//
// Pattern (mirrors usage-retry.spec.ts, intentionally identical):
//   1. goto page — RSC server-side prefetch hits api:3000 inside docker,
//      bypassing browser-attached page.route. We DO NOT try to intercept
//      the initial RSC fetch — let it succeed so the list renders.
//   2. INVALIDATE the cache via the Refresh button (Phase 55-06-batch
//      production change) WHILE a 500 stub is armed → client refetches
//      via the browser, page.route intercepts → 500.
//   3. Cache flips to isError → Alert + Retry render (Client component
//      isError branch).
//   4. unroute, click Retry → cache flips back to success, content
//      re-renders.
//
// Why one consolidated spec for 4 surfaces:
//   All 4 list/detail screens share the IDENTICAL Refresh → 500 → Retry
//   → 200 flow (only the route URL + post-success anchor differ). A
//   single spec with four steps amortises the per-worker fixture-user
//   login cost AND keeps the suite count to a minimum (one new spec,
//   not four).
//
// Slim-only by design — production-equivalent routing is covered by the
// per-list 100-acceptance navigation specs already in the suite.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";

const NOTES_ROUTE = "**/api/notes/list**";
const TRX_ROUTE = "**/api/transcriptions/list**";
const CONV_LIST_ROUTE = "**/api/conversations/list**";
const CONV_MSG_ROUTE = "**/api/conversations/messages**";

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — list/detail retry across 4 surfaces (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-06-batch acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    // Deliberate 500 stub fires per step — allowlist matches usage-retry.spec.ts.
    allowBrowserErrors(page, [
      /api\/(notes|transcriptions|conversations)[^\n]*500/i,
      /Failed to load resource[^\n]*\/api\/(notes|transcriptions|conversations)/i,
    ]);
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test.setTimeout(120_000);

  test("list/detail retry: 4 surfaces — Refresh-into-500 → Alert + Retry → click → 200 → content re-renders — zero browser errors", async ({
    page,
    context,
  }) => {
    const seed = bindToContext(context);

    await test.step("surface 1 — /app/notes: seed → Refresh-into-500 → Alert + Retry → click → list re-renders", async () => {
      await seed.seedNotes({ count: 1, title: "Retry Seed Note" });
      await page.goto(`${WEB_BASE}/app/notes`);
      await expect(page.getByText("Retry Seed Note", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });

      // Arm 500 stub, click Refresh — client refetch hits the stub.
      await page.route(NOTES_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-500" }),
        }),
      );
      await page
        .getByRole("button", { name: /^Refresh$/ })
        .first()
        .click();
      await expect(page.getByRole("button", { name: /^Retry$/ })).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);

      // Unroute, click Retry — success branch.
      await page.unroute(NOTES_ROUTE);
      await page.getByRole("button", { name: /^Retry$/ }).click();
      await expect(page.getByText("Retry Seed Note", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: /^Retry$/ })).toHaveCount(0);
      expectNoBrowserErrors(page);
      await seed.clearAllData();
    });

    await test.step("surface 2 — /app/transcriptions: seed → Refresh-into-500 → Alert + Retry → click → list re-renders", async () => {
      await seed.seedTranscriptions({ count: 1, text: "Retry Seed Transcription" });
      await page.goto(`${WEB_BASE}/app/transcriptions`);
      await expect(page.getByText("Retry Seed Transcription", { exact: true }).first()).toBeVisible(
        { timeout: 15_000 },
      );

      await page.route(TRX_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-500" }),
        }),
      );
      await page.getByRole("button", { name: /^Refresh$/ }).click();
      await expect(page.getByRole("button", { name: /^Retry$/ })).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);

      await page.unroute(TRX_ROUTE);
      await page.getByRole("button", { name: /^Retry$/ }).click();
      await expect(page.getByText("Retry Seed Transcription", { exact: true }).first()).toBeVisible(
        { timeout: 10_000 },
      );
      await expect(page.getByRole("button", { name: /^Retry$/ })).toHaveCount(0);
      expectNoBrowserErrors(page);
      await seed.clearAllData();
    });

    await test.step("surface 3 — /app/conversations: seed → Refresh-into-500 → Alert + Retry → click → list re-renders", async () => {
      await seed.seedConversations({ count: 1, title: "Retry Seed Conversation" });
      await page.goto(`${WEB_BASE}/app/conversations`);
      await expect(page.getByText("Retry Seed Conversation", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });

      await page.route(CONV_LIST_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-500" }),
        }),
      );
      await page.getByRole("button", { name: /^Refresh$/ }).click();
      await expect(page.getByRole("button", { name: /^Retry$/ })).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);

      await page.unroute(CONV_LIST_ROUTE);
      await page.getByRole("button", { name: /^Retry$/ }).click();
      await expect(page.getByText("Retry Seed Conversation", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: /^Retry$/ })).toHaveCount(0);
      expectNoBrowserErrors(page);
      // Keep this conversation seeded for surface 4 (detail page needs an id).
    });

    await test.step("surface 4 — /app/conversations/[id]: seed conv+messages → Refresh-into-500 → Alert + Retry → click → messages re-render", async () => {
      await seed.clearAllData();
      const convs = await seed.seedConversations({
        count: 1,
        title: "Retry Seed Detail",
        withMessages: 2,
      });
      const convId = convs[0]?.id;
      expect(convId).toBeTruthy();
      await page.goto(`${WEB_BASE}/app/conversations/${convId}`);
      await expect(page.getByText("seed message 0", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });

      await page.route(CONV_MSG_ROUTE, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture-500" }),
        }),
      );
      await page.getByRole("button", { name: /^Refresh$/ }).click();
      await expect(page.getByRole("button", { name: /^Retry$/ })).toBeVisible({ timeout: 10_000 });
      expectNoBrowserErrors(page);

      await page.unroute(CONV_MSG_ROUTE);
      await page.getByRole("button", { name: /^Retry$/ }).click();
      await expect(page.getByText("seed message 0", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: /^Retry$/ })).toHaveCount(0);
      expectNoBrowserErrors(page);
    });
  });
});
