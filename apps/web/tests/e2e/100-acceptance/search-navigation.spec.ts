// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-12 — Long-form acceptance: notes-search + conv-search client-side
// navigation UCs.
//
// Closes four MISSING UCs from Phase 55 RESEARCH.md:
//
//   §"/app/notes/search":
//     UC-NOTES-SEARCH-RESULT-CLICK — click result row title <a> → navigate
//                                    to /app/notes/[id]
//                                    (NotesSearchClient.tsx:168)
//     UC-NOTES-SEARCH-CLEAR        — Clear button → router.push to
//                                    /app/notes/search (no ?q)
//                                    (NotesSearchClient.tsx:83-86, 116-118)
//
//   §"/app/conversations/search":
//     UC-CONV-SEARCH-RESULT-CLICK  — row title <a> → navigate to
//                                    /app/conversations/[id]
//                                    (ConversationsSearchClient.tsx:152-154)
//     UC-CONV-SEARCH-CLEAR         — Clear button → router.push to
//                                    /app/conversations/search (no ?q)
//                                    (ConversationsSearchClient.tsx:76-79,
//                                     96-98)
//
// Slim-only per the 100-acceptance suite contract. Uses the per-worker
// authenticated fixture user (alice+<parallelIndex>@test.local) via the
// storageState fixture inherited from ../fixtures/auth.ts. Seeds one note
// + one conversation (with title that matches the conv-search backend's
// title-matching predicate, per u13-conv-search.spec.ts §"success state").
//
// Selector caveats:
//   - Both client components render Clear via translated label
//     `end-user.{notes,conv}-search.action.clear.label` — selected via
//     getByRole("button", { name: <RegExp> }) with the EN label "Clear".
//   - notes-search backend is POST /api/notes/search; React Query fires it
//     on mount when q.length >= 2. Aborting navigation surfaces
//     net::ERR_ABORTED on the in-flight POST — allowlist that exact path
//     (the notes-navigation spec at Phase 55-09 established this pattern).
//   - conv-search has the SAME aborted-POST pattern at
//     /api/conversations/search; allowlist it the same way.
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.
//
// GREEN (55-12-a-02): RED spec passed 3/3 clean on slim — the production
// wiring (NotesSearchClient row <a> + Clear button + ConversationsSearchClient
// row <a> + Clear button) was always live; this commit is the GREEN gate
// marker confirming 3x clean execution against the running slim stack.

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

test.describe("@phase55-acceptance @long-form — search navigation (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-12 acceptance suite runs against slim topology only",
    );
    await attachBrowserDiagnostics(page);
    // Per-worker fixture user accumulates rows across re-runs; clear so the
    // strict-mode link-by-name resolves to exactly one match.
    const seed = bindToContext(context);
    await seed.clearAllData();
    // Search POSTs are aborted by client-side router.push() navigations
    // (Clear handler in particular). React Query fires the POST on mount;
    // navigating before the response lands triggers net::ERR_ABORTED.
    // Framework-level expected behaviour — allowlist both endpoints.
    allowBrowserErrors(page, [
      /POST [^ ]+\/api\/notes\/search → FAILED: net::ERR_ABORTED/,
      /POST [^ ]+\/api\/conversations\/search → FAILED: net::ERR_ABORTED/,
    ]);
  });

  test("search navigation: notes-search row click + clear + conv-search row click + clear — zero browser errors", async ({
    page,
    context,
  }) => {
    const noteTitle = "Acceptance match 55-12 query";
    const convTitle = "Acceptance conv 55-12 search match";

    const seed = bindToContext(context);

    const { noteId, convId } =
      await test.step("step 1 — seed 1 note + 1 conversation with matching titles", async () => {
        const notes = await seed.seedNotes({
          title: noteTitle,
          content: "searchable body for 55-12 spec",
        });
        const n = notes[0];
        if (!n) throw new Error("seedNotes returned no rows");
        const convs = await seed.seedConversations({
          title: convTitle,
          withMessages: 0,
        });
        const c = convs[0];
        if (!c) throw new Error("seedConversations returned no rows");
        return { noteId: n.id, convId: c.id };
      });

    await test.step("step 2 — UC-NOTES-SEARCH-RESULT-CLICK: click row title → /app/notes/<id>", async () => {
      await page.goto(`${WEB_BASE}/app/notes/search?q=match`);
      const resultLink = page.getByRole("link", { name: noteTitle });
      await expect(resultLink).toBeVisible({ timeout: 15_000 });
      await resultLink.click();
      await page.waitForURL(new RegExp(`/app/notes/${noteId}$`), {
        timeout: 10_000,
      });
      await expect(page.getByRole("heading", { level: 1, name: noteTitle })).toBeVisible({
        timeout: 10_000,
      });
      expectNoBrowserErrors(page);
    });

    await test.step("step 3 — UC-NOTES-SEARCH-CLEAR: Clear button → /app/notes/search (no ?q)", async () => {
      await page.goto(`${WEB_BASE}/app/notes/search?q=match`);
      // Wait until results render so we know the page mounted past the
      // type-empty branch.
      await expect(page.getByRole("link", { name: noteTitle })).toBeVisible({
        timeout: 15_000,
      });
      const clearBtn = page.getByRole("button", { name: /^Clear$/ });
      await expect(clearBtn).toBeVisible({ timeout: 5_000 });
      await clearBtn.click();
      await page.waitForURL(/\/app\/notes\/search$/, { timeout: 10_000 });
      expect(page.url()).not.toContain("?q=");
      expect(page.url()).not.toContain("&q=");
      expectNoBrowserErrors(page);
    });

    await test.step("step 4 — UC-CONV-SEARCH-RESULT-CLICK: click row title → /app/conversations/<id>", async () => {
      await page.goto(`${WEB_BASE}/app/conversations/search?q=Acceptance`);
      const resultLink = page.getByRole("link", { name: convTitle });
      await expect(resultLink).toBeVisible({ timeout: 15_000 });
      await resultLink.click();
      await page.waitForURL(new RegExp(`/app/conversations/${convId}$`), {
        timeout: 10_000,
      });
      // ConversationDetailClient renders the heading in both empty and
      // populated branches; the empty branch renders the CardTitle
      // "No messages" copy. Either way the URL assertion above is the
      // authoritative navigation gate.
      expectNoBrowserErrors(page);
    });

    await test.step("step 5 — UC-CONV-SEARCH-CLEAR: Clear button → /app/conversations/search (no ?q)", async () => {
      await page.goto(`${WEB_BASE}/app/conversations/search?q=Acceptance`);
      // Wait for the row to render so we know the success branch mounted.
      await expect(page.getByRole("link", { name: convTitle })).toBeVisible({
        timeout: 15_000,
      });
      const clearBtn = page.getByRole("button", { name: /^Clear$/ });
      await expect(clearBtn).toBeVisible({ timeout: 5_000 });
      await clearBtn.click();
      await page.waitForURL(/\/app\/conversations\/search$/, { timeout: 10_000 });
      expect(page.url()).not.toContain("?q=");
      expect(page.url()).not.toContain("&q=");
      expectNoBrowserErrors(page);
    });
  });
});
