---
phase: 55-uc-coverage-audit
plan: 01-b
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
  - .planning/deferred-items.md
autonomous: true
requirements:
  - BUG-55-DELETE-ACCOUNT-UNTESTED
  - UC-DELETE-ACCOUNT-OPEN
  - UC-DELETE-ACCOUNT-MISMATCH-DISABLED
  - UC-DELETE-ACCOUNT-MATCH-CONFIRMS
  - UC-DELETE-ACCOUNT-PUSH-SIGNIN
  - UC-DELETE-ACCOUNT-GUARD-REDIRECT
must_haves:
  truths:
    - "A throw-away user can sign in, navigate to /app/account, click 'Delete account', and complete the typed-email confirmation flow"
    - "Confirm button is disabled when typed email does not match the account email"
    - "Confirm button enables when typed email matches; clicking it calls Better Auth deleteAccount + signOut"
    - "After successful deletion the user lands on /sign-in"
    - "After deletion, attempting to sign in with the same credentials returns an error (the user no longer exists)"
    - "The deleted user's prior session cookie cannot reach /app — guard redirects to /sign-in"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
      provides: Long-form e2e covering the destructive delete-account flow end-to-end
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
      to: apps/web/src/components/screens/account/DeleteAccountDialog.tsx
      via: UI click-through (AlertDialog trigger, typed-email Input, confirm Button)
      pattern: 'data-testid="delete-account-confirm"'
    - from: apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
      to: /api/auth/delete-account
      via: Better Auth catch-all (driven by authClient.deleteAccount)
      pattern: 'delete-account'
    - from: apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
      to: apps/web/tests/e2e/support/mailpit.ts
      via: fetchVerificationLink (provisioning step)
      pattern: 'fetchVerificationLink'
---

<objective>
Land an end-to-end e2e covering the entire `DeleteAccountDialog` flow on
`/app/account` — open dialog, typed-email mismatch keeps confirm
disabled, match enables it, confirm triggers
`authClient.deleteAccount()`, success pushes to `/sign-in`, and attempting
to re-authenticate with the deleted creds fails. `expectNoBrowserErrors`
at every step.

Purpose: closes 5 MISSING UCs from RESEARCH.md §"`/app/account`" (the
five rows marked **bold MISSING** for DeleteAccountDialog) and
`BUG-55-DELETE-ACCOUNT-UNTESTED` from RESEARCH.md §"Backlog deltas" #3.
The dialog is destructive irreversible and currently has zero e2e
coverage — highest-leverage account-screen gap.

Output: a single long-form acceptance spec at
`apps/web/tests/e2e/100-acceptance/delete-account.spec.ts`. A new entry
in `.planning/deferred-items.md` for `BUG-55-DELETE-ACCOUNT-UNTESTED`
gets DELETED in the same commit as part of the test landing (per the
file's triage convention).
</objective>

## Context

This plan solves five MISSING UCs from the Phase 55 audit:

- **UC-DELETE-ACCOUNT-OPEN** — `DeleteAccountDialog.tsx:76-77` trigger
  never clicked by any spec.
- **UC-DELETE-ACCOUNT-MISMATCH-DISABLED** — `DeleteAccountDialog.tsx:46,
  103-105`: confirm button is disabled when `typed !== userEmail`.
- **UC-DELETE-ACCOUNT-MATCH-CONFIRMS** — `DeleteAccountDialog.tsx:48-72`:
  match enables the button, click invokes `authClient.deleteAccount()`.
- **UC-DELETE-ACCOUNT-PUSH-SIGNIN** — `DeleteAccountDialog.tsx:68`:
  successful delete → `router.push('/sign-in')`.
- **UC-DELETE-ACCOUNT-GUARD-REDIRECT** — implicit consequence: after
  deletion, the (auth)/layout.tsx guard redirects /app → /sign-in
  (cited in `full-flow.spec.ts:230-239`).

Pre-existing surface this plan composes on top of:

- `attachBrowserDiagnostics(page)` + `expectNoBrowserErrors(page)` from
  `apps/web/tests/e2e/support/browser-diagnostics.ts`.
- `fetchVerificationLink(email, opts)` from
  `apps/web/tests/e2e/support/mailpit.ts:93` — needed for the throw-away
  user provisioning step (sign-up emits a verification link the user
  must click before sign-in).
- Sign-up UI pattern from `full-flow.spec.ts:61-85` (step 1).
- Sign-in UI pattern from `full-flow.spec.ts:100-114` (step 4).
- `data-testid="delete-account-confirm"` on
  `DeleteAccountDialog.tsx:104` — stable selector for the confirm
  button.

## Files to create

- `apps/web/tests/e2e/100-acceptance/delete-account.spec.ts` — Playwright
  spec. Slim-only. Single test that walks the full destructive flow.

## Files to modify

- `.planning/deferred-items.md` — append (or update if a sibling Plan
  55-* already landed a Phase 55 backlog block) the
  `### Phase 55 — UC coverage backlog` section noting that
  `BUG-55-DELETE-ACCOUNT-UNTESTED` is now CLOSED by this plan and
  delete the entry per the file's triage convention. If the entry was
  never filed (RESEARCH.md says it should be — line 526), this plan can
  skip the deferred-items.md edit entirely.

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create `apps/web/tests/e2e/100-acceptance/delete-account.spec.ts`.
   Header comment block mirrors `full-flow.spec.ts:1-30` (Phase 55-01-b
   provenance, slim-only justification, mailpit-helper attribution).
2. Imports — exact set:
   - `test as base, expect` from `@playwright/test`
   - `attachBrowserDiagnostics, expectNoBrowserErrors` from
     `../support/browser-diagnostics.js`
   - `fetchVerificationLink` from `../support/mailpit.js`
3. Constants:
   - `WEB_BASE = "http://localhost:3000"`
   - `API_BASE = "http://localhost:4000"`
4. Override storageState to empty (`test.use({ storageState: { cookies:
   [], origins: [] } })`) — the spec MUST start signed-out so it can
   sign up a unique throw-away user.
5. `beforeEach`: slim-only gate + `attachBrowserDiagnostics(page)`:
   ```ts
   test.skip(testInfo.project.name !== "slim", "slim only");
   await attachBrowserDiagnostics(page);
   ```
6. Test body — single test
   `"signs up a throwaway user, deletes the account via dialog, verifies signed-out + credentials invalidated — zero browser errors"`.
   Each step ends with `expectNoBrowserErrors(page)`:
   - **step 1 — sign-up via UI**:
     `uniq = "delete55+${Date.now()}@local.test"`,
     `password = "ToDelete55!#Strong"`,
     `cursor = new Date()`.
     Mirror `full-flow.spec.ts:61-85` closely.
   - **step 2 — fetch verification link from mailpit**:
     `verifyLink = await fetchVerificationLink(uniq, { since: cursor,
     timeoutMs: 15_000 })`. Assert `verifyLink` matches `/token=/`.
   - **step 3 — open verify link**:
     `verifyRes = await context.request.get(verifyLink)`. Assert status
     in `[200, 302, 303]`.
   - **step 4 — sign in via UI lands on /app**: mirror
     `full-flow.spec.ts:100-114`.
   - **step 5 — navigate to /app/account**:
     `await page.goto(WEB_BASE + "/app/account")`. Assert profile card
     shows `uniq`.
   - **step 6 — open delete-account dialog**:
     Click `page.getByRole("button", { name: /delete account/i })`.
     Assert `getByRole("alertdialog")` is visible. Assert
     `data-testid="delete-account-confirm"` is disabled
     (`await expect(page.getByTestId("delete-account-confirm")).toBeDisabled()`).
   - **step 7 — typed-email mismatch keeps confirm disabled**:
     `page.getByLabel(/email|delete-account-email/i).fill("wrong@example.com")`.
     Assert confirm still disabled.
   - **step 8 — typed-email match enables confirm**:
     Clear the input, fill with `uniq`, assert confirm is enabled.
   - **step 9 — confirm delete + redirect**:
     Click `page.getByTestId("delete-account-confirm")`. Wait for URL
     `/sign-in(\?|$)` with timeout 10_000.
     `await page.waitForLoadState("networkidle")`.
   - **step 10 — re-auth with deleted credentials fails**:
     Fill sign-in form with `uniq` + `password`. Click submit. Assert
     EITHER the page stays on `/sign-in` AND an error Alert is visible
     OR the error toast appears. Allow ≤ 8s for the network round-trip.
     Specifically: `await expect(page.getByText(/check your email and
     password|invalid credentials|user not found/i)).toBeVisible()`.
     Confirm URL has NOT navigated to `/app`.
   - **step 11 — guard check on `/app`**:
     `await page.goto(WEB_BASE + "/app")`. Wait for URL to match
     `/sign-in(\?|$)` (mirror `full-flow.spec.ts:235-238`).
7. Run `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/delete-account --project=slim`.
   Spec MUST fail (no fixture support or stack down).
8. Commit:
   `test(55-01-b): RED — delete-account long-form acceptance spec`

### Task 2 — GREEN: bring up stack + run spec

1. Bring up slim stack via the project's standard target (see
   `Makefile` — `make e2e-slim-up` or equivalent).
2. Re-run the spec. MUST pass.
3. Run the entire `100-acceptance/` suite to confirm no regression on
   `full-flow.spec.ts` or `password-reset.spec.ts` (if 55-01-a landed):
   `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim`.
4. Run `pnpm --filter @openwhispr/web typecheck` → green.
5. Run `make lint` → green (the spec uses real URLs in `WEB_BASE` and
   `API_BASE`; LOCKER-03 allowlist already covers `apps/web/tests/**`).
6. Commit: `test(55-01-b): GREEN — delete-account spec passes on slim`.

## Done

Observable assertions:

```
$ ls apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
# file exists

$ grep -c "expectNoBrowserErrors" apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
# returns at least 8 (one per step that ends with the check)

$ grep -c 'test.skip(testInfo.project.name !== "slim"' apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
# returns 1

$ grep -c 'alice' apps/web/tests/e2e/100-acceptance/delete-account.spec.ts
# returns 0 — throw-away user, NOT alice+N

$ grep -E 'page\.route|page\.routeFromHAR|MSW' apps/web/tests/e2e/100-acceptance/delete-account.spec.ts | wc -l
# returns 0 — no internal-logic mocks

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/delete-account --project=slim
# exit code 0, "1 passed"

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim
# exit code 0, all acceptance specs green
```

## Risks

- **alice+N collision (CRITICAL).** Phase 53's per-worker fixture user
  pool (`fixtures/auth.ts:54`) MUST NOT be deleted by this spec.
  Use `delete55+${Date.now()}@local.test` exclusively. The throw-away
  user is signed-up fresh per run; never reuse alice+N. Verified by
  the `grep -c alice` gate above.
- **Mailpit `since` cursor must be set BEFORE the sign-up POST.** Same
  reason as 55-01-a — otherwise `fetchVerificationLink` may pick up
  unrelated earlier emails. The spec captures `cursor` before step 1's
  form submit.
- **Better Auth `deleteAccount` callback timing.** `DeleteAccountDialog.tsx:60-67`
  calls `signOut()` defensively AFTER `deleteAccount()` returns. The
  spec MUST `waitForURL(/sign-in/)` not `waitForLoadState` alone —
  there is a brief window where the `signOut()` is in-flight and the
  page hasn't navigated yet. Timeout 10_000 is appropriate.
- **Sign-out cleanup vs guard timing.** The guard at
  `apps/web/src/app/(auth)/layout.tsx:23` runs on the server and may
  cache for a few ms after the cookie is cleared. `page.goto("/app")`
  followed by `waitForURL(/sign-in/)` is the canonical pattern (mirrors
  `full-flow.spec.ts:235-238`).
- **Re-auth assertion brittleness in step 10.** Better Auth's response
  to "sign in as a deleted user" depends on whether the row is hard-
  deleted (Better Auth default with cascade) or soft-deleted (depends
  on the project's `deleteUser` hook). The SignInForm error envelope
  in `SignInForm.tsx:79-86` shows generic "error" alert for any
  unknown code — the spec asserts the generic error Alert is visible,
  which is robust to either deletion semantic.
- **Mailpit lingering verification mail.** If a prior test run left a
  mail for `delete55+${earlierTs}@local.test` in mailpit, the `since`
  cursor handles ordering — but if `Date.now()` collisions occur
  (unlikely at ms resolution), the lookup may pick up a stale mail.
  Acceptable risk — same pattern as `full-flow.spec.ts`.
- **`page.getByLabel(/email/i)` collision in the dialog.** The dialog
  has a `<Label htmlFor="delete-account-email">` (line 89) and the
  sign-in page has `<Label>Email</Label>`. Inside the dialog, prefer
  `page.locator("#delete-account-email")` or
  `page.getByRole("alertdialog").getByLabel(/email/i)` to scope the
  selector — avoids ambiguity.
