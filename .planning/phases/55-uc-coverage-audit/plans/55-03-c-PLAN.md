---
phase: 55-uc-coverage-audit
plan: 03-c
type: execute
wave: 2
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts
requirements:
  - UC-GUARD-SIGNED-OUT-APP-REDIRECT-WITH-FROM
  - UC-GUARD-SIGNED-OUT-SIGNIN-NO-LOOP
  - UC-GUARD-SIGNED-OUT-ADMIN-NO-MIDDLEWARE-REDIRECT
must_haves:
  truths:
    - "Visiting /app while signed out 302s to /sign-in?from=/app (the from query param round-trips so post-sign-in can route back)"
    - "Visiting /sign-in while signed out renders the page (no redirect loop, no infinite 302 chain)"
    - "Visiting /admin while signed out — middleware does NOT redirect (per spec; admin is gated by Traefik basic-auth at the edge, but on slim there's no Traefik. The page should either render the admin shell with a 401-shape, or return 401 — assert the behavior the SHIPPED middleware actually implements)"
    - "Every step emits zero browser console errors (with allowlist for deliberate 401/302 redirects)"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts
      provides: Long-form e2e exercising 3 middleware-guard paths
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts
      to: apps/web/src/middleware.ts
      via: request → middleware redirect → final URL assertion
      pattern: 'middleware|/sign-in\?from='
---

<objective>
Land a long-form acceptance e2e that exercises the auth middleware on
3 cross-cutting paths:
1. Signed-out `/app/*` → `/sign-in?from=...`
2. Signed-out `/sign-in` → no redirect (renders normally)
3. Signed-out `/admin` — assert whatever the SHIPPED middleware does
   (this is a discovery-driven assertion; read `apps/web/src/middleware.ts`
   before writing the assertion).

`expectNoBrowserErrors` at every step (with allowlist for deliberate
302s and 401s, mirroring the precedent from `delete-account.spec.ts`).

Closes 3 PARTIAL UCs from RESEARCH.md §"Authentication middleware guard":
- **UC-GUARD-SIGNED-OUT-APP-REDIRECT-WITH-FROM**
- **UC-GUARD-SIGNED-OUT-SIGNIN-NO-LOOP**
- **UC-GUARD-SIGNED-OUT-ADMIN-NO-MIDDLEWARE-REDIRECT**

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts`.
Slim-only. No fixture user (signed-out only).
</objective>

## Context

`apps/web/src/middleware.ts` is the Next.js middleware that runs on
every navigation. It reads the Better Auth session cookie and decides
whether to redirect.

Existing related coverage:
- `05-auth-middleware.spec.ts:18` — PARTIAL: redirects but doesn't
  assert the `from` query param
- `05-auth-middleware.spec.ts:26` — admin path PARTIAL
- `05-auth-middleware.spec.ts:42` — /sign-in PARTIAL

This plan promotes all three to COVERED with `expectNoBrowserErrors`
and explicit query-param assertions.

## Files to create

- `apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts`

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. **Read `apps/web/src/middleware.ts` first** to confirm the exact
   contract:
   - What path patterns match
   - What query param is appended on redirect (`from` vs `next` vs
     `returnTo`)
   - What `/admin` does (likely passes through; Traefik gates at the
     edge in production, slim doesn't have Traefik)
   - Encode the `from` value carefully: `/app/notes` vs `/app/notes?x=1`
2. Create the spec. Header: Phase 55-03-c, slim-only, signed-out only.
3. Imports: `test, expect`, `attachBrowserDiagnostics`,
   `expectNoBrowserErrors`.
4. `test.use({ storageState: empty })`. `beforeEach`: slim-only +
   diagnostics. Allowlist deliberate 401s if the admin path emits them
   (mirror `delete-account.spec.ts:59-64` pattern).
5. Single test:
   `"middleware redirects /app/* to /sign-in?from=, /sign-in renders without loop, /admin reaches middleware terminus — zero browser errors"`.
6. Steps:
   - **step 1 — visit /app while signed out**:
     `await page.goto(WEB_BASE + "/app");`
     `await expect(page).toHaveURL(/\/sign-in\?from=%2Fapp$|\/sign-in\?from=\/app$/);`
     (Try both URL-encoded and raw; the middleware's URL.searchParams
     should emit URL-encoded.)
     Assert the SignInForm heading is visible.
     `expectNoBrowserErrors(page)`.
   - **step 2 — visit /app/notes/some-id while signed out**:
     Should redirect with `from=/app/notes/some-id` (or URL-encoded).
     Confirm the from-param round-trips deeply.
     `expectNoBrowserErrors(page)`.
   - **step 3 — visit /sign-in directly while signed out**:
     `await page.goto(WEB_BASE + "/sign-in");`
     `await expect(page).toHaveURL(/\/sign-in$/);` (no redirect loop)
     Assert the SignInForm heading is visible.
     `expectNoBrowserErrors(page)`.
   - **step 4 — visit /admin while signed out**:
     `const response = await page.goto(WEB_BASE + "/admin", { waitUntil: 'commit' });`
     Capture the final URL + status. ASSERT the behavior matches what
     `apps/web/src/middleware.ts` actually does. Likely:
     - Final URL is `/admin` (middleware passes through; on slim
       Traefik is absent so the AdminShell may render OR return 401
       from the API call)
     - Status is 200 (RSC renders) OR 401/302 — read middleware
       behavior FIRST, encode assertion to MATCH it (not to invent).
     `expectNoBrowserErrors(page)` with allowlist if needed.
7. Run on slim → fails (file missing).
8. Commit: `test(55-03-c): red — auth middleware guard long-form spec`

### Task 2 — GREEN: spec passes first try

1. Re-run spec.
2. **If a path-pattern mismatch emerges** (e.g. middleware uses
   `next=` not `from=`), update the assertion to match production
   contract (NEVER touch middleware to make the test pass — that
   violates CLAUDE.md hard rule 1). Document in the spec comment.
3. **If /admin behavior is surprising** (e.g. unexpectedly redirects
   on slim where Traefik is absent), file BUG-55-03-c-ADMIN-SLIM-GAP
   in `.planning/deferred-items.md` and adjust the spec to assert the
   observed behavior. If observed behavior is itself wrong (e.g.
   middleware was meant to handle /admin in slim too), surface for
   user direction — don't unilaterally fix.
4. Three runs no flake.
5. Full slim acceptance sweep → 11 passed.
6. typecheck + lint green.
7. Commit: `test(55-03-c): green — auth middleware guard 3-path coverage`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts
# exists

$ grep -c 'from=' apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts
# ≥ 2 (from= asserted on /app + /app/notes/...)

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/auth-middleware-guard.spec.ts
# ≥ 4

$ OPENWHISPR_TOPOLOGY=slim ... 100-acceptance --project=slim
# 11 passed
```

## Risks

- **`from` query encoding.** The middleware may URL-encode the path
  (`%2F` for `/`) or leave it raw. Use a regex union in the assertion
  to accept either: `/from=(%2F|\/)app/`.
- **`/admin` slim behavior.** Without Traefik basic-auth at the edge,
  the admin page handler must defend itself. If it doesn't (renders
  the AdminShell unauthenticated), that's a SECURITY-PARITY bug, not
  a test bug. File for user review.
- **Deliberate 401 in console.** If `/admin` triggers a server-side
  API call that 401s, the page logs an error. Allowlist via
  `attachBrowserDiagnostics` allowlist or `allowBrowserErrors` config.
- **Redirect-loop assertion.** `toHaveURL(/\/sign-in$/)` after visiting
  `/sign-in` confirms no infinite 302 chain. If Playwright detects
  too many redirects, it throws before the assertion — that error
  IS the spec failure (which is correct behavior — flake means real
  loop).
- **CLAUDE.md hard rule 1 trigger.** If the middleware doesn't behave
  as expected and the spec is RED, DO NOT modify `middleware.ts` to
  make the test pass. Update the spec to assert observed behavior +
  file the divergence as a backlog item.
