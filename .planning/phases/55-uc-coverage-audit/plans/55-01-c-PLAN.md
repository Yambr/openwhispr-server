---
phase: 55-uc-coverage-audit
plan: 01-c
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
  - .planning/deferred-items.md
autonomous: true
requirements:
  - BUG-55-SESSION-REVOKE-UNTESTED
  - UC-SESSIONS-REVOKE-ONE-CLICK
  - UC-SESSIONS-REVOKE-OTHERS-CLICK
must_haves:
  truths:
    - "A dedicated fixture user (alice+55) can sign in twice across two browser contexts, producing two real Better Auth session rows"
    - "On /app/account the SessionsTable renders both rows, each with a Revoke button; the current row has the 'This device' badge"
    - "Clicking Revoke on a specific non-current row removes that row from the table"
    - "Clicking 'Revoke all other sessions' on a multi-session table removes every non-current row and hides the bulk button"
    - "The current session remains authenticated after both revoke operations (current cookie still resolves /app)"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
      provides: Long-form e2e covering both revoke flows on /app/account
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
      to: apps/web/src/components/screens/account/SessionsTable.tsx
      via: UI click-through (per-row Revoke + bulk Revoke-all-other-sessions)
      pattern: 'data-testid="session-row-this-device"|Revoke all other sessions'
    - from: apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
      to: /api/auth/revoke-session
      via: Better Auth catch-all (driven by authClient.revokeSession)
      pattern: 'revoke-session'
    - from: apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
      to: /api/auth/revoke-other-sessions
      via: Better Auth catch-all (driven by authClient.revokeOtherSessions)
      pattern: 'revoke-other-sessions'
---

<objective>
Land an end-to-end e2e covering the two revoke flows on
`/app/account/SessionsTable.tsx`: (1) per-row Revoke click removes that
specific session; (2) "Revoke all other sessions" click removes every
non-current row. Both flows leave the current session functional.
`expectNoBrowserErrors` at every step.

Purpose: closes 2 MISSING UCs from RESEARCH.md §"`/app/account`":
**UC-SESSIONS-REVOKE-ONE-CLICK** (`SessionsTable.tsx:198-205` —
`u5-account.spec.ts:103` only asserts visibility, never clicks) and
**UC-SESSIONS-REVOKE-OTHERS-CLICK** (`SessionsTable.tsx:155-163` —
`u5-account.spec.ts:79` only asserts absence in single-session case).
Closes `BUG-55-SESSION-REVOKE-UNTESTED` from RESEARCH.md §"Backlog
deltas" #4.

Output: a single long-form acceptance spec at
`apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts`. Uses a
dedicated fixture user `alice+55@test.local` provisioned inline (NOT
the per-worker `alice+${parallelIndex}` pool from
`fixtures/auth.ts:54`) so it doesn't disrupt the 60-spec Phase 53 sweep.
</objective>

## Context

This plan solves two MISSING UCs from the Phase 55 audit:

- **UC-SESSIONS-REVOKE-ONE-CLICK** — `SessionsTable.tsx:198-205`. The
  existing `u5-account.spec.ts:103-105` asserts the revoke buttons are
  visible but never clicks one. The mutation
  (`authClient.revokeSession({ token })`) is never exercised end-to-end.
- **UC-SESSIONS-REVOKE-OTHERS-CLICK** — `SessionsTable.tsx:155-163`. The
  existing `u5-account.spec.ts:75-81` only asserts the bulk button is
  ABSENT in the single-session case; the click + invalidation path is
  never tested.

Pre-existing surface this plan composes on top of:

- `attachBrowserDiagnostics(page)` + `expectNoBrowserErrors(page)` from
  `apps/web/tests/e2e/support/browser-diagnostics.ts`.
- Sign-up + verification pattern from
  `apps/web/tests/e2e/100-acceptance/full-flow.spec.ts:61-98` — used to
  provision `alice+55` inline.
- `fetchVerificationLink` from `apps/web/tests/e2e/support/mailpit.ts:93`.
- `data-testid="session-row-this-device"` on `SessionsTable.tsx:187` —
  stable selector for the current-session badge.
- The pattern for opening a second browser context for the same user
  (creates a real second session row) from
  `apps/web/tests/e2e/u5-account.spec.ts:96-99` — re-use this two-context
  pattern verbatim.

This spec MUST NOT reuse the per-worker `alice+${parallelIndex}` pool
because (a) Phase 53 fixtures depend on a single stable session per
worker and revoke-all-other-sessions would orphan the storageState
cookie of any concurrent spec; (b) `alice+55` is well outside the
parallelIndex range (workers cap at 1 on slim per
`playwright.config.ts:76`), guaranteeing no collision.

## Files to create

- `apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts` —
  Playwright spec. Slim-only. Single test that walks both revoke flows
  in sequence.

## Files to modify

- `.planning/deferred-items.md` — if a `Phase 55 — UC coverage backlog`
  block exists from a sibling Plan 55-* landing, update the
  `BUG-55-SESSION-REVOKE-UNTESTED` line to CLOSED + delete per triage
  convention. If the entry was never filed (likely — Phase 55 backlog
  hasn't been added per `deferred-items.md` head), this plan skips the
  edit.

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create `apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts`.
   Header comment block mirrors `full-flow.spec.ts:1-30` (Phase 55-01-c
   provenance, slim-only justification, fixture-user-isolation
   justification — explain WHY alice+55 not alice+N).
2. Imports — exact set:
   - `test as base, expect` from `@playwright/test`
   - `attachBrowserDiagnostics, expectNoBrowserErrors` from
     `../support/browser-diagnostics.js`
   - `fetchVerificationLink` from `../support/mailpit.js`
3. Constants:
   - `WEB_BASE = "http://localhost:3000"`
   - `API_BASE = "http://localhost:4000"`
   - `FIXTURE_EMAIL = "alice+55@test.local"`
   - `FIXTURE_PASSWORD = "Revoke55!#StrongTest"`
4. Override storageState to empty (`test.use({ storageState: { cookies:
   [], origins: [] } })`).
5. `beforeEach`: slim-only gate + `attachBrowserDiagnostics(page)`
   (identical shape to 55-01-b's beforeEach).
6. Test body — single test
   `"revokes a specific session, then all other sessions, current session stays valid — zero browser errors"`.
   Steps (each ends with `expectNoBrowserErrors(page)` on the PRIMARY
   page; secondary contexts don't carry diagnostics):
   - **step 1 — provision alice+55 idempotently via web sign-up UI**:
     `cursor = new Date()`. Visit `/sign-up`. Fill name/email/password
     with `FIXTURE_EMAIL` + `FIXTURE_PASSWORD`. Submit.
     Handle the "user already exists" case gracefully — if the spec has
     run before, the user is already provisioned; detect by checking
     EITHER the success "check your email" panel OR the
     `USER_ALREADY_EXISTS` error path (mirror the duplicate-handling
     branch in `fixtures/auth.ts:97-103`). On a fresh run, fetch the
     verification link via `fetchVerificationLink(FIXTURE_EMAIL,
     { since: cursor, timeoutMs: 15_000 })` and open it via
     `context.request.get`. On a re-run, skip the verification step.
   - **step 2 — sign in on primary context (`page`)**:
     Mirror `full-flow.spec.ts:100-114`. Capture the current session
     cookie via `await page.context().cookies()`. Find the cookie
     whose name is `openwhispr.session_token` (per
     `u5-account.spec.ts:36`). Hold its value as
     `primarySessionTokenCookie`.
   - **step 3 — open a second browser context, sign in same user**:
     Mirror `u5-account.spec.ts:90-99` — `secondCtx = await
     browser.newContext({ ignoreHTTPSErrors: true })`,
     `secondPage = await secondCtx.newPage()`, sign in via the UI
     (NOT via the `signInAs` helper — this spec does not import from
     `fixtures/auth.ts`, it stays self-contained).
   - **step 4 — primary context navigates to /app/account**:
     `await page.goto(WEB_BASE + "/app/account")`. Wait for at least
     two `<TableRow>` entries to render (assert at least 2 rows
     visible via `await expect(page.getByRole("row")).toHaveCount(>= 3)`
     — header + 2 data rows). Assert the `data-testid="session-row-this-device"`
     badge is visible (current-session badge).
   - **step 5 — click Revoke on a non-current row**:
     The current row is the one with the `session-row-this-device`
     badge. Use a locator chain to find a Revoke button on a row that
     does NOT contain that badge:
     `const otherRow = page.getByRole("row").filter({ hasNot: page.getByTestId("session-row-this-device") }).filter({ has: page.getByRole("button", { name: /^Revoke$/i }) }).first();`
     `await otherRow.getByRole("button", { name: /^Revoke$/i }).click();`
     Assert the row count drops to header + 1 data row
     (`await expect(page.getByRole("row")).toHaveCount(2)`) within 5s.
     Assert the bulk button "Revoke all other sessions" is now hidden
     (`hasOthers` flips to false per `SessionsTable.tsx:147`).
   - **step 6 — open a THIRD context, sign in same user again** so
     there's a non-current row to bulk-revoke:
     Mirror step 3 with `thirdCtx`. Close the page after sign-in to
     keep the context alive but drop the DOM resource.
   - **step 7 — primary page refresh + click "Revoke all other sessions"**:
     `await page.reload()`. Wait for `await expect(page.getByRole("row")).toHaveCount(3)`.
     Click `page.getByRole("button", { name: /Revoke all other sessions/i })`.
     Assert row count drops to header + 1 data row within 5s. Assert
     the "Revoke all other sessions" button disappears (it only renders
     when `hasOthers` is true per `SessionsTable.tsx:155`).
   - **step 8 — primary session still valid**:
     `await page.goto(WEB_BASE + "/app")`. Assert URL ends `/app`
     (NOT `/sign-in` — current session was not revoked). Assert the
     KPI card is visible (mirror `full-flow.spec.ts:120`).
   - **step 9 — cleanup**: `await secondCtx.close()`, `await
     thirdCtx.close()`. (Phase 53/Plan 53-32c's DB-direct cleanup in
     `u5-account.spec.ts:28-64` does not apply here because alice+55 is
     not in the per-worker pool — sessions die with context disposal.)
7. Run `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/revoke-sessions --project=slim`.
   Spec MUST fail (stack not up or spec genuinely red).
8. Commit:
   `test(55-01-c): RED — revoke-sessions long-form acceptance spec`

### Task 2 — GREEN: bring up stack + run spec

1. Bring up slim stack via the project's standard target.
2. Re-run the spec. MUST pass on first attempt (no production-code
   changes needed — the spec exercises an already-shipped surface).
3. Run the full acceptance suite to confirm no regression:
   `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim`.
   All specs (full-flow, password-reset if 55-01-a landed, delete-account
   if 55-01-b landed, revoke-sessions) MUST be green.
4. Run `pnpm --filter @openwhispr/web typecheck` → green.
5. Run `make lint` → green.
6. Commit:
   `test(55-01-c): GREEN — revoke-sessions spec passes on slim`

## Done

Observable assertions:

```
$ ls apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
# file exists

$ grep -c "expectNoBrowserErrors" apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
# returns at least 7 (one per step that ends with the check)

$ grep -c 'test.skip(testInfo.project.name !== "slim"' apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
# returns 1

$ grep -c 'alice+55' apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
# returns at least 1 — dedicated user (NOT alice+${parallelIndex})

$ grep -cE 'fixtures/auth|signInAs|fixtureEmail' apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
# returns 0 — spec is self-contained, does not import the per-worker pool

$ grep -cE 'page\.route|page\.routeFromHAR|MSW' apps/web/tests/e2e/100-acceptance/revoke-sessions.spec.ts
# returns 0 — no internal-logic mocks

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/revoke-sessions --project=slim
# exit code 0, "1 passed"

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim
# exit code 0, all acceptance specs green
```

## Risks

- **alice+55 collision with future per-worker pool expansion (LOW).** The
  current slim config caps workers at 1 (`playwright.config.ts:76`).
  If a future change raises this beyond 55 the fixture user would
  collide. Mitigation: alice+55 is far outside any plausible worker
  count; document the constraint in the spec header.
- **Sign-up duplicate handling.** alice+55 will persist across runs
  (DB rows survive — only resource rows are cleaned by `clearAllData`).
  The first run sign-ups and verifies; subsequent runs must detect the
  USER_ALREADY_EXISTS shape and skip the verify step. Mirror the
  duplicate-handling branch in `fixtures/auth.ts:97-103` —
  `parsed.code === "USER_ALREADY_EXISTS" || /already exists/i.test(...)`.
  On duplicate, sign-in directly without re-verifying.
- **Multi-context cookie isolation.** `browser.newContext()` returns a
  fresh cookie jar — signing in twice from two contexts creates two
  distinct sessions even for the same user. This is the proven pattern
  from `u5-account.spec.ts:96-99`. Do NOT use `page.context().newPage()`
  — that would share cookies and create only one session.
- **Row-count assertion timing.** After clicking Revoke, the TanStack
  Query invalidation (`SessionsTable.tsx:82, 93`) re-fetches and
  re-renders. Use Playwright's auto-retrying matchers
  (`toHaveCount(N)`, `toBeHidden()`, `toBeVisible()`) — they poll up
  to the global timeout. Do NOT use `page.waitForTimeout`.
- **Current-row identification.** `SessionsTable.tsx:179` compares
  `row.id === currentSessionId` and renders the `session-row-this-device`
  badge only on the matching row. Filter by `hasNot:` on the badge
  testid to find a non-current row safely. Do NOT assume row order.
- **Second/third context cleanup.** Always `secondCtx.close()` +
  `thirdCtx.close()` in a `finally`-shaped block at the end of the
  test. Orphan contexts leak resources and can poison subsequent
  spec runs. Phase 53's testcontainer-leak audit (see global MEMORY.md
  `feedback_testcontainers_cleanup_audit`) underscores this — apply the
  same discipline to browser contexts.
- **Race between sign-out and table re-render.** When the spec navigates
  primary `page` to `/app/account` after a sign-in from a second
  context, the second context's session row may not yet be visible
  (Better Auth's session-creation INSERT plus the
  `authClient.listSessions()` GET have to both complete). Use
  `await expect(page.getByRole("row")).toHaveCount(N, { timeout: 10_000 })`
  to allow a comfortable poll window. The auto-retrying matcher handles
  this without explicit sleeps.
- **`hasOthers` button visibility.** `SessionsTable.tsx:155-164` only
  renders the bulk button when `rows.length > 1`. After the per-row
  revoke in step 5, the rows drop to 1 → bulk button disappears.
  The spec MUST re-add a session (step 6) before testing the bulk
  flow. Do not assert the bulk button is present immediately after
  the per-row revoke.
