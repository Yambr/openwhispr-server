// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-12 — Long-form acceptance: detail-page Back anchor UCs.
//
// Closes three MISSING UCs from Phase 55 RESEARCH.md:
//
//   §"/app/notes/[id]":
//     UC-NOTE-DETAIL-BACK-LINK     — not-found / empty card Back anchor
//                                    href="/app/notes" → /app/notes
//                                    (NoteDetailClient.tsx:171-174)
//
//   §"/app/conversations/[id]":
//     UC-CONV-DETAIL-BACK-LINK     — empty-state (no messages) Back anchor
//                                    href="/app/conversations"
//                                    (ConversationDetailClient.tsx:165-167)
//     UC-CONV-DETAIL-FOOTER-BACK   — populated-state footer Back anchor
//                                    href="/app/conversations"
//                                    (ConversationDetailClient.tsx:257-259)
//
// Selector strategy:
//   - Both NoteDetailClient empty + ConversationDetailClient empty render
//     an <a className="text-sm hover:underline" href="/app/notes" |
//     "/app/conversations">{back-label}</a>. The label is i18n-driven
//     (`end-user.{note,conv}-detail.action.back.label`); under RU locale
//     it would be Cyrillic. To stay locale-independent we locate by
//     href attribute rather than accessible name.
//   - AppShell.tsx:30-36 mounts sidebar nav links with the SAME href
//     (`/app/notes`, `/app/conversations`). To avoid strict-mode
//     ambiguity we scope every selector to `main a[href="..."]` — the
//     <main> element wraps {children} in AppShell.tsx:84 and excludes
//     the <aside> primary navigation.
//   - The populated ConversationDetailClient renders ONE Back anchor in
//     the footer (line 257-259). The empty branch renders a DIFFERENT
//     Back anchor at line 165-167. They never co-exist on the same render
//     because the empty branch returns early before the populated JSX.
//     Step 2 (empty) and Step 3 (populated footer) therefore both target
//     `main a[href="/app/conversations"]` with a single match per render.
//
// Slim-only per the 100-acceptance suite contract. Uses the per-worker
// authenticated fixture user via the storageState fixture inherited from
// ../fixtures/auth.ts. Seeds:
//   - Step 1: no seed (goto a non-existent note UUID)
//   - Step 2: 1 conversation with 0 messages → empty branch
//   - Step 3: 1 conversation with 1 message → populated branch + footer
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.
//
// GREEN (55-12-b-02): RED spec passed 3/3 clean on slim — the production
// wiring (NoteDetailClient empty Back + ConversationDetailClient empty Back
// + footer Back) was always live; this commit is the GREEN gate marker
// confirming 3x clean execution against the running slim stack.

import { test as base, expect } from "@playwright/test";
import { storageStatePath } from "../fixtures/auth.js";
import { bindToContext } from "../fixtures/seed.js";
import {
  allowBrowserErrors,
  attachBrowserDiagnostics,
  expectNoBrowserErrors,
} from "../support/browser-diagnostics.js";

const WEB_BASE = "http://localhost:3000";
const NONEXISTENT_NOTE_ID = "11111111-2222-3333-4444-555555555555";

const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: required by Playwright fixture protocol
  storageState: async ({}, use, testInfo) => {
    await use(storageStatePath(testInfo.parallelIndex));
  },
});

test.describe("@phase55-acceptance @long-form — detail back links (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-12 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    // Phase 56: DELETE 204 + immediate router.push produces ERR_ABORTED on in-flight requests.
    allowBrowserErrors(page, [/ERR_ABORTED/i]);
    // Per-worker fixture user accumulates rows across re-runs; clear so the
    // empty-state branch in step 2 fires deterministically (no leaked
    // messages from prior runs flipping it into populated mode).
    const seed = bindToContext(context);
    await seed.clearAllData();
  });

  test("detail back links: note-detail empty Back + conv-detail empty Back + conv-detail footer Back — zero browser errors", async ({
    page,
    context,
  }) => {
    const seed = bindToContext(context);

    await test.step("step 1 — UC-NOTE-DETAIL-BACK-LINK: empty-state Back → /app/notes", async () => {
      // Visit a UUID that doesn't exist for this user. NoteDetailClient
      // uses Branch B (list-then-filter); a non-matching id resolves to
      // `row === undefined` and renders the empty Card with the Back
      // anchor.
      await page.goto(`${WEB_BASE}/app/notes/${NONEXISTENT_NOTE_ID}`);
      // Wait for the empty Card to render — the skeleton resolves once
      // the list pages have all been fetched + filtered.
      const backLink = page.locator('main a[href="/app/notes"]');
      await expect(backLink).toBeVisible({ timeout: 15_000 });
      await backLink.click();
      await page.waitForURL(/\/app\/notes$/, { timeout: 10_000 });
      expectNoBrowserErrors(page);
    });

    await test.step("step 2 — UC-CONV-DETAIL-BACK-LINK: empty-state Back → /app/conversations", async () => {
      const convs = await seed.seedConversations({
        title: "Acceptance conv 55-12 empty back",
        withMessages: 0,
      });
      const c = convs[0];
      if (!c) throw new Error("seedConversations returned no rows");
      await page.goto(`${WEB_BASE}/app/conversations/${c.id}`);
      // Empty-state Card renders the Back anchor exactly once.
      const backLink = page.locator('main a[href="/app/conversations"]');
      await expect(backLink).toBeVisible({ timeout: 15_000 });
      await backLink.click();
      await page.waitForURL(/\/app\/conversations$/, { timeout: 10_000 });
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — UC-CONV-DETAIL-FOOTER-BACK: populated-state footer Back → /app/conversations", async () => {
      const convs = await seed.seedConversations({
        title: "Acceptance conv 55-12 footer back",
        withMessages: 1,
      });
      const c = convs[0];
      if (!c) throw new Error("seedConversations returned no rows");
      await page.goto(`${WEB_BASE}/app/conversations/${c.id}`);
      // Populated branch: wait for the heading then the footer Back anchor.
      // Populated render has exactly one a[href="/app/conversations"] —
      // the footer link at line 257-259.
      const backLink = page.locator('main a[href="/app/conversations"]');
      await expect(backLink).toBeVisible({ timeout: 15_000 });
      await backLink.click();
      await page.waitForURL(/\/app\/conversations$/, { timeout: 10_000 });
      expectNoBrowserErrors(page);
    });
  });
});
