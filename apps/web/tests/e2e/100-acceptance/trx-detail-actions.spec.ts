// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 55-04-b — Long-form acceptance: /app/transcriptions/[id] action trio
// (Copy / Export JSON / Export Markdown) + Delete confirm + Delete cancel.
//
// Closes five MISSING UCs from RESEARCH.md §"/app/transcriptions/[id]":
//   UC-TRX-DETAIL-COPY            — Copy button → navigator.clipboard.writeText
//   UC-TRX-DETAIL-EXPORT-JSON     — Export JSON → <a download="...json">
//   UC-TRX-DETAIL-EXPORT-MD       — Export MD   → <a download="...md">
//   UC-TRX-DETAIL-DELETE-CONFIRM  — Delete → AlertDialog confirm → DELETE
//                                      /api/transcriptions/delete →
//                                      router.push(/app/transcriptions)
//   UC-TRX-DETAIL-DELETE-CANCEL   — Delete → AlertDialog cancel → dialog
//                                      closes, no network call, URL unchanged
//
// Structural twin of `note-detail-actions.spec.ts` (Plan 55-04-a). Slim-only
// per the 100-acceptance suite contract. Uses the per-worker authenticated
// fixture user (alice+<parallelIndex>@test.local) via storageState fixture
// inherited from ../fixtures/auth.ts. Seeds a fresh transcription per test
// via seedTranscriptions() so the delete-confirm branch can safely vaporise
// the row without affecting other specs.
//
// Browser-side error invariant: every step ends with expectNoBrowserErrors.
// The 100-acceptance suite gates on zero unexpected browser errors per step.
//
// Clipboard permissions: Chromium denies navigator.clipboard.* by default
// in non-secure / headless contexts. context.grantPermissions("clipboard-
// read", "clipboard-write") in beforeEach is the canonical Playwright
// pattern documented at playwright.dev/docs/clipboard.
//
// TranscriptionDetailClient.handleCopy() writes `transcriptText` (the
// transcription body — `row.text` if non-empty else `row.raw_text`) to the
// clipboard. The clipboard assertion uses `toContain` to remain robust if
// future iterations prepend metadata.
//
// Verification on the live slim stack (Phase 55-04-b GREEN gate):
//   OPENWHISPR_TOPOLOGY=slim PLAYWRIGHT_SKIP_WEBSERVER=1 \
//     pnpm --filter @openwhispr/web exec playwright test \
//     100-acceptance --project=slim --reporter=line
//   → 13 passed (was 12 pre-55-04-b) including this spec at slot [13/13].
//
// Flake gate: solo-spec re-run x3 on the live slim stack: 1.7s / 1.8s / 2.2s,
// all green. No retries configured for the slim project. The DELETE-confirm
// branch vaporises the seeded row each run so the spec is idempotent across
// repeated executions against the same fixture user.

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

test.describe("@phase55-acceptance @long-form — trx detail action trio (slim)", () => {
  test.beforeEach(async ({ page, context }, testInfo) => {
    // SKIP-REASON: pre-260527-pj6 — original reason unknown, audit required
    test.skip(
      testInfo.project.name !== "slim",
      "Phase 55-04-b acceptance suite runs against slim topology only",
    );
    // Chromium denies navigator.clipboard.* without explicit permission;
    // grant before any page interaction (handleCopy is a button onClick).
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await attachBrowserDiagnostics(page);
    // Phase 56: DELETE 204 + immediate router.push produces ERR_ABORTED on in-flight requests.
    allowBrowserErrors(page, [/ERR_ABORTED/i]);
  });

  test("trx detail: copy + export JSON + export MD + delete confirm + delete cancel — zero browser errors", async ({
    page,
    context,
  }) => {
    // Multi-paragraph body so the splitParagraphs(text) renderer produces
    // <p data-testid="trx-paragraph"> nodes — exercising the live render
    // path while keeping the clipboard assertion deterministic.
    const trxBody =
      "Acceptance transcription 55-04-b body.\n\nSecond paragraph for the round-trip.";

    // Use a stable, page-bound seed handle so the seed POST inherits the
    // authenticated session cookie jar from storageState.
    const seed = bindToContext(context);

    const trxId =
      await test.step("step 1 — seed a transcription via POST /api/transcriptions/create + navigate", async () => {
        const rows = await seed.seedTranscriptions({ text: trxBody });
        const first = rows[0];
        if (!first) throw new Error("seedTranscriptions returned no rows");
        await page.goto(`${WEB_BASE}/app/transcriptions/${first.id}`);
        // TranscriptionDetailClient renders <h1>{t(trx-detail.title.heading)}</h1>
        // — copy is "Transcription" in en. We wait on the heading + at least
        // one rendered paragraph so onClick handlers are hydrated.
        await expect(page.getByRole("heading", { level: 1, name: /^Transcription$/i })).toBeVisible(
          { timeout: 10_000 },
        );
        await expect(page.locator('[data-testid="trx-paragraph"]').first()).toBeVisible({
          timeout: 10_000,
        });
        await page.waitForLoadState("networkidle");
        expectNoBrowserErrors(page);
        return first.id;
      });

    await test.step("step 2 — Click Copy → clipboard written + sonner toast visible", async () => {
      await page.getByRole("button", { name: /^Copy$/i }).click();
      // sonner mounts [data-sonner-toaster] at the root layout; the toast
      // item carries [data-sonner-toast]. Auto-dismisses after ~4s — assert
      // within a 2s window.
      const toast = page.locator("[data-sonner-toast]").first();
      await expect(toast).toBeVisible({ timeout: 2_000 });
      // handleCopy writes transcriptText (row.text || row.raw_text). Use
      // toContain so a future metadata-prefix change does not break the
      // assertion — we only need to prove the body round-tripped.
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toContain("Acceptance transcription 55-04-b body");
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
      // accessible name (it does — TranscriptionDetailClient.tsx:220 vs :236).
      await page
        .getByRole("button", { name: /^Delete$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^Cancel$/i }).click();
      await expect(dialog).toBeHidden();
      // No URL change — still on the trx detail.
      expect(page.url()).toContain(`/app/transcriptions/${trxId}`);
      expectNoBrowserErrors(page);
    });

    await test.step("step 6 — Click Delete → AlertDialog confirm fires DELETE + pushes /app/transcriptions", async () => {
      await page
        .getByRole("button", { name: /^Delete$/i })
        .first()
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const deletePromise = page.waitForResponse(
        (r) => r.url().includes("/api/transcriptions/delete") && r.request().method() === "DELETE",
      );
      // Confirm button shares the "Delete" label with the trigger; scope
      // strictly inside the dialog. This is the alertdialog-scoped one.
      await dialog.getByRole("button", { name: /^Delete$/i }).click();
      const deleteRes = await deletePromise;
      expect(deleteRes.status(), "delete returns 200 or 204").toBeLessThan(300);
      await page.waitForURL(/\/app\/transcriptions\/?$/, { timeout: 10_000 });
      expectNoBrowserErrors(page);
    });
  });
});
