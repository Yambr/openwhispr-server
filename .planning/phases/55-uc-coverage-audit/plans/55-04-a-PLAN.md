---
phase: 55-uc-coverage-audit
plan: 04-a
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
requirements:
  - UC-NOTE-DETAIL-COPY
  - UC-NOTE-DETAIL-EXPORT-JSON
  - UC-NOTE-DETAIL-EXPORT-MD
  - UC-NOTE-DETAIL-DELETE-CONFIRM
  - UC-NOTE-DETAIL-DELETE-CANCEL
must_haves:
  truths:
    - "Seed a note via POST /api/notes/create using the per-worker authenticated fixture user; navigate to /app/notes/[id]"
    - "Click Copy button → navigator.clipboard.writeText is called; sonner toast appears (data-sonner-toaster region)"
    - "Click Export JSON → page.waitForEvent('download') resolves; suggestedFilename ends .json"
    - "Click Export MD → page.waitForEvent('download') resolves; suggestedFilename ends .md"
    - "Click Delete → AlertDialog opens; cancel closes it without DELETE call; confirm fires DELETE and pushes /app/notes"
    - "Every step emits zero browser console errors (with allowBrowserErrors for deliberate clipboard-API errors on insecure context)"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
      provides: Long-form e2e covering note detail action trio + delete confirm/cancel
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
      to: apps/web/src/components/screens/notes/NoteDetailClient.tsx
      via: button clicks → clipboard / download / DELETE wire
      pattern: 'data-testid="note-copy"|note-export-json|note-export-md|note-delete'
---

<objective>
Land a long-form acceptance e2e that drives `/app/notes/[id]` through
all 4 action buttons and the delete confirm/cancel branches. Seed data
via the existing `seedNotes` helper in `apps/web/tests/e2e/fixtures/seed.ts`.

Closes 5 MISSING UCs from RESEARCH.md §"`/app/notes/[id]`":
- UC-NOTE-DETAIL-COPY (NoteDetailClient.tsx:188-192)
- UC-NOTE-DETAIL-EXPORT-JSON (NoteDetailClient.tsx:194-197)
- UC-NOTE-DETAIL-EXPORT-MD (NoteDetailClient.tsx:199-219)
- UC-NOTE-DETAIL-DELETE-CONFIRM (NoteDetailClient.tsx:127-137, 238-260)
- UC-NOTE-DETAIL-DELETE-CANCEL (NoteDetailClient.tsx:255 — Cancel button)

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts`. Slim-only.
Uses the per-worker authenticated fixture user (alice+0@test.local).
</objective>

## Context

`NoteDetailClient.tsx` action surface:
- **Copy button** (lines 188-192): `navigator.clipboard.writeText(...)` + `toast.success(...)`. The button is `<Button onClick={onCopy}>` — locate by data-testid OR by accessible name `/^Copy$/i` (English label only — `tools/lint-english.ts` enforces).
- **Export JSON** (194-197): `download` attribute on a Blob URL — Playwright catches via `page.waitForEvent("download")`.
- **Export MD** (199-219): same pattern.
- **Delete** (127-137, 238-260): opens AlertDialog (Radix portal). AlertDialog has `<AlertDialogAction>` (confirm) + `<AlertDialogCancel>` (cancel). Confirm: DELETE `/api/notes/delete` → push `/app/notes`. Cancel: close dialog, no network call.

Toast surface: sonner. The `<Toaster>` is mounted in `(auth)/layout.tsx` or
`AppShell.tsx`. Locator: `page.locator("[data-sonner-toaster]")` exists once mounted.

Clipboard: Playwright's chromium context grants clipboard read/write
when running with `--enable-clipboard-read` flag OR via
`context.grantPermissions(["clipboard-read", "clipboard-write"])`.
Assert by reading back `navigator.clipboard.readText()` via
`page.evaluate`.

## Files to create

- `apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts`

## Files to modify

(none — production surface ships)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create the spec. Header: Phase 55-04-a, slim-only, uses per-worker
   `signInAs` fixture (alice+0), seeds note via `seedNotes`.
2. Imports:
   - `test as base, expect` from `@playwright/test`
   - `attachBrowserDiagnostics, expectNoBrowserErrors` from `../support/browser-diagnostics.js`
   - `signInAs` from `../fixtures/auth.js` if available; else compose with the existing fixture user pattern
   - `seedNotes` from `../fixtures/seed.js`
3. Use existing per-worker storageState (DO NOT override to empty —
   we need an authenticated session to seed + navigate).
4. `beforeEach`: slim-only + diagnostics + grant clipboard permissions:
   ```ts
   await context.grantPermissions(["clipboard-read", "clipboard-write"]);
   ```
5. Single test:
   `"note detail: copy + export JSON + export MD + delete confirm + delete cancel — zero browser errors"`.
6. Steps:
   - **step 1 — seed a note**:
     ```ts
     const [{ id: noteId }] = await seedNotes(request, {
       title: "Acceptance note 55-04-a",
       content: "Body content for the export round-trip.",
     });
     ```
     Navigate to `/app/notes/${noteId}`.
     Assert `<h1>` heading visible (the note title).
     `expectNoBrowserErrors(page)`.
   - **step 2 — Click Copy → clipboard written + toast visible**:
     Locate Copy button — prefer `getByRole("button", { name: /^Copy$/i })`;
     fall back to `[data-testid="note-copy"]` if accessible name conflicts
     with another button. CLICK it.
     Assert toast region contains success copy:
     ```ts
     await expect(page.locator("[data-sonner-toaster] li").first()).toBeVisible();
     ```
     Assert clipboard content matches the note body:
     ```ts
     const clip = await page.evaluate(() => navigator.clipboard.readText());
     expect(clip).toContain("Body content for the export round-trip.");
     ```
     Dismiss the toast (`page.locator("[data-sonner-toaster] li").first().click()` or wait it out).
     `expectNoBrowserErrors(page)`.
   - **step 3 — Click Export JSON → download fires**:
     ```ts
     const downloadPromise = page.waitForEvent("download");
     await page.getByRole("button", { name: /export.*json/i }).click();
     const download = await downloadPromise;
     expect(download.suggestedFilename()).toMatch(/\.json$/i);
     ```
     `expectNoBrowserErrors(page)`.
   - **step 4 — Click Export MD → download fires**:
     Same pattern, assert `.md`.
     `expectNoBrowserErrors(page)`.
   - **step 5 — Click Delete → confirm-cancel branch**:
     Click `getByRole("button", { name: /^Delete$/i })`. Assert AlertDialog
     opens (`getByRole("alertdialog")` visible). Click the Cancel button
     (`getByRole("button", { name: /^Cancel$/i })`). Assert dialog closes.
     Assert URL still ends `/app/notes/${noteId}` (no navigation).
     `expectNoBrowserErrors(page)`.
   - **step 6 — Click Delete → confirm branch**:
     Click Delete again. AlertDialog opens. Click the Confirm button
     (label probably "Delete" inside dialog — find it via
     `page.getByRole("alertdialog").getByRole("button", { name: /^Delete$/i })`).
     Wait for DELETE response: `page.waitForResponse(r => r.url().includes("/api/notes/delete"))`.
     Wait for URL: `await page.waitForURL(/\/app\/notes\/?$/)`.
     `expectNoBrowserErrors(page)`.
7. Run on slim → MUST fail (file didn't exist).
8. Commit: `test(55-04-a): red — note detail action trio long-form spec`

### Task 2 — GREEN: spec passes first try

1. Verify slim stack up.
2. Re-run spec.
3. **If clipboard read fails** with permission error — verify
   `context.grantPermissions` is called BEFORE the seedNotes step.
   Browsers default-deny clipboard in unfocused contexts.
4. **If sonner toast isn't visible** — check that `<Toaster>` is mounted
   in AppShell. If toast appears in a different DOM region, adjust
   the locator. Allow `data-sonner-toast` or `[role="status"]`.
5. **If download event doesn't fire** — the export buttons may use
   `URL.createObjectURL + anchor.click()` synchronously. Playwright's
   `waitForEvent("download")` only fires for actual `<a download="...">`
   navigations. If the implementation uses `window.open` or a different
   approach, surface as BUG-55-04-a-EXPORT-NO-DOWNLOAD-EVENT and adjust.
6. **If the AlertDialog uses a different role** (e.g., `dialog` not
   `alertdialog`) — Radix usually emits `alertdialog`; verify.
7. Three runs no flake.
8. Full slim 100-acceptance sweep → 12 passed.
9. typecheck + lint green.
10. Commit: `test(55-04-a): green — note detail action trio + delete confirm/cancel`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
# exists

$ grep -c 'waitForEvent("download")' apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
# ≥ 2 (JSON + MD)

$ grep -c 'clipboard' apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
# ≥ 2 (permissions + read)

$ grep -c 'alertdialog' apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
# ≥ 2 (cancel + confirm)

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/note-detail-actions.spec.ts
# ≥ 6

$ OPENWHISPR_TOPOLOGY=slim ... 100-acceptance --project=slim
# 12 passed
```

## Risks

- **Clipboard permission.** Chromium needs explicit grant in headless
  mode. `context.grantPermissions(["clipboard-read", "clipboard-write"])`
  in `beforeEach` is the canonical pattern.
- **Toast lifetime.** sonner toasts auto-dismiss after ~4s. Capture the
  assertion within that window. Use `toBeVisible({ timeout: 2000 })`
  to avoid waiting past auto-dismiss.
- **Download event timing.** If the production button uses synchronous
  `URL.createObjectURL`, Playwright should still catch it via the
  download event for `<a download>` clicks. If not, check the source
  for `window.open` or other paths.
- **AlertDialog role.** Radix AlertDialog has `role="alertdialog"`,
  not `role="dialog"`. Confirm via DOM inspection if needed.
- **Per-worker fixture user state.** seedNotes adds rows to the user.
  Other tests sharing the worker (slim=1) see these rows. The 100-acceptance
  suite runs sequentially per worker — no interference, but cleanup is
  unnecessary because each delete removes the row anyway.
- **Race between DELETE 200 and router push.** `waitForResponse` then
  `waitForURL` is the standard pattern. The router push happens in the
  same tick as the optimistic update; if the wait order is reversed,
  the URL assertion races the DELETE.
- **Constitutional EN-only matchers.** All button names in EN locale.
  No Cyrillic regex unions.
