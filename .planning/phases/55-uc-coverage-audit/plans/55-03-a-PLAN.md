---
phase: 55-uc-coverage-audit
plan: 03-a
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
requirements:
  - UC-LOCALE-VISIBLE-PUBLIC-PAGES
  - UC-LOCALE-ARIA-PRESSED
  - UC-LOCALE-EN-ACTIVE-NO-OP
  - UC-LOCALE-RU-LABELS-PUBLIC-PAGES
must_haves:
  truths:
    - "LanguageSwitcher is visible on /sign-in, /sign-up, /verify-email, /forgot-password, /reset-password, /setup (every public route)"
    - "Clicking RU when EN is active flips aria-pressed correctly: EN button aria-pressed becomes 'false', RU becomes 'true'"
    - "Clicking EN when EN is already active fires no POST /api/locale request (early return per language-switcher.tsx:31)"
    - "After switching to RU on /sign-in, navigating to /sign-up via the in-page link still renders RU labels (cookie persistence)"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
      provides: Long-form e2e exercising LanguageSwitcher on all 6 public routes
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
      to: apps/web/src/components/screens/language-switcher.tsx
      via: aria-pressed + click + POST /api/locale + router.refresh
      pattern: 'aria-pressed|/api/locale'
---

<objective>
Land a long-form acceptance e2e that walks all 6 public routes
(`/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`,
`/reset-password`, `/setup`) and asserts on EACH:
1. LanguageSwitcher renders with 2 buttons (EN / RU).
2. `aria-pressed` reflects the active locale.
3. Locale-cookie persistence — switching once, then navigating to
   another public route, retains the chosen locale.
4. Clicking the ACTIVE locale button does NOT fire `/api/locale`
   (early-return branch on `language-switcher.tsx:31`).

`expectNoBrowserErrors` at every step.

Closes 4 MISSING UCs from RESEARCH.md §"Locale toggle (LanguageSwitcher)":
- **UC-LOCALE-VISIBLE-PUBLIC-PAGES** — `(public)/layout.tsx:17`; only
  `/sign-in` exercised in `i18n-russian.spec.ts:15`.
- **UC-LOCALE-ARIA-PRESSED** — `language-switcher.tsx:53`; never asserted.
- **UC-LOCALE-EN-ACTIVE-NO-OP** — `language-switcher.tsx:31` early return.
- **UC-LOCALE-RU-LABELS-PUBLIC-PAGES** — only `/sign-in` rendered in RU.

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts`.
Slim-only. No fixture user (all routes are public).

Constitutional: EN-only matchers in the spec body (per Plan 55-02-c
precedent + `tools/lint-english.ts`). RU label assertions go through
heading-presence shape checks (h1 visible, page didn't crash) rather
than RU text-content matches.
</objective>

## Context

Public routes (`apps/web/src/app/(public)/`):
- `/sign-in`
- `/sign-up`
- `/verify-email` (renders without `?token=` → error variant with Mail icon)
- `/forgot-password` (shipped in Plan 55-01-a)
- `/reset-password?token=fake` (form renders even for invalid token)
- `/setup` (renders pristine wizard when setup is incomplete; redirects to /admin when complete — fixture environment is NEVER setup-complete since alice users don't have admin role; if `/setup` redirects, treat as expected and skip the route-specific assertion)

`(public)/layout.tsx` mounts `<LanguageSwitcher />` at the top right of
the AuthShell. The fieldset has `aria-label="Language"` (EN) /
`"Язык"` (RU; not asserted in spec — EN-only matchers).

Locale cookie: `NEXT_LOCALE` (verify in spec at first switch).
`/api/locale` accepts `{ locale: "en" | "ru" }` and writes the cookie.

Test mechanics:
- Use `page.waitForRequest('/api/locale', { timeout: 2000 })` wrapped
  in a try/catch to assert ABSENCE for the no-op case (no request
  fires when clicking EN while EN active). Pattern: arm the waiter,
  click, race against a 1.5s timeout; if the waiter resolves the
  spec FAILS, if it rejects (timeout) the assertion PASSES.
- `getByRole("button", { name: /english/i })` and `/russian|русский/`
  — wait, no Cyrillic. Use the i18n-namespace-resolved EN label only
  via the `getByRole` with `name: /english/i` and `/russian/i` (the
  EN labels for both buttons are "English" and "Russian" per
  `common.language.{english,russian}.label`).

## Files to create

- `apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts`

## Files to modify

(none — surface ships)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create the spec. Header comment: Phase 55-03-a, slim-only,
   no fixture user, walks 6 public routes.
2. Imports: `test, expect`, `attachBrowserDiagnostics`,
   `expectNoBrowserErrors`.
3. `test.use({ storageState: empty })`. `beforeEach`: slim-only +
   diagnostics.
4. Constants:
   - `WEB_BASE = "http://localhost:3000"`
   - `PUBLIC_ROUTES = ["/sign-in", "/sign-up", "/verify-email", "/forgot-password", "/reset-password?token=spec-fake-token-xyz", "/setup"]`
5. Single test:
   `"language switcher visible + aria-pressed correct + en-active no-op + cookie persists across navigations — zero browser errors"`.
6. Steps:
   - **step 1 — visit each public route, assert switcher visible + aria-pressed defaults to EN**:
     `for (const route of PUBLIC_ROUTES)`:
       - `await page.goto(WEB_BASE + route)`.
       - **If `/setup` redirected to `/admin` or `/app`** (setup complete
         in this docker instance), skip the route with a `test.step.skip`
         message and continue.
       - Locate the switcher: `const sw = page.getByRole("group", { name: /language/i }).first();`
       - Assert `await expect(sw).toBeVisible();`.
       - Assert the EN button is `aria-pressed="true"` and RU is `"false"`:
         `await expect(sw.getByRole("button", { name: /english/i })).toHaveAttribute("aria-pressed", "true");`
         `await expect(sw.getByRole("button", { name: /russian/i })).toHaveAttribute("aria-pressed", "false");`
       - `expectNoBrowserErrors(page)`.
   - **step 2 — clicking EN while EN active fires no /api/locale POST**:
     On `/sign-in`, set up a request-listener waiting for
     `POST /api/locale`. Click the EN button (already-active).
     Wait 1500ms; assert NO request was captured. The cleanest pattern:
     ```ts
     let localeReqCount = 0;
     page.on("request", req => {
       if (req.method() === "POST" && req.url().endsWith("/api/locale")) localeReqCount++;
     });
     await page.goto(WEB_BASE + "/sign-in");
     await sw.getByRole("button", { name: /english/i }).click();
     await page.waitForTimeout(1500);
     expect(localeReqCount).toBe(0);
     ```
     (`waitForTimeout` is normally banned per Plan 53 — but this is the
     ONLY way to assert request ABSENCE; it's a deliberate, bounded
     spec-only wait, not a flake-cover.)
     `expectNoBrowserErrors(page)`.
   - **step 3 — click RU on /sign-in, assert aria-pressed flips**:
     Pre-arm `page.waitForResponse(r => r.url().endsWith('/api/locale') && r.status() === 204)`.
     Click `getByRole("button", { name: /russian/i })`. Await the
     response (so the cookie write completes).
     Assert RU button is now `aria-pressed="true"` and EN is `"false"`.
     `expectNoBrowserErrors(page)`.
   - **step 4 — navigate to /sign-up via link, assert cookie persisted**:
     Click the `/sign-up` link in the SignInForm footer
     (`getByRole("link", { name: /sign up|don.t have/i })`).
     After navigation, assert switcher on `/sign-up` shows RU is
     `aria-pressed="true"` and EN is `"false"`.
     Assert the page heading exists (DOM didn't crash) — use a
     selector-only check: `await expect(page.locator("h1").first()).toBeVisible();`
     `expectNoBrowserErrors(page)`.
   - **step 5 — restore EN for cleanup**:
     Click EN button on `/sign-up`. Await the response.
     Assert EN button is `aria-pressed="true"`.
     `expectNoBrowserErrors(page)`.
7. Run on slim → MUST fail (file didn't exist).
8. Commit: `test(55-03-a): red — locale toggle public-pages long-form spec`

### Task 2 — GREEN: spec passes first try (no production change)

1. Verify slim stack up.
2. Re-run spec. MUST pass first try.
3. **If /setup unexpectedly redirects when no admin exists** — that's
   actually a feature gap (the SetupForm should render); surface as
   BUG-55-03-a-SETUP-REDIRECT, investigate `apps/web/src/app/(public)/setup/page.tsx`,
   may need to skip the route in the spec rather than fail. Allow
   /setup to be skipped if the slim docker instance has setup
   complete.
4. **If `/reset-password?token=fake` renders an error variant instead
   of the form** — the LanguageSwitcher is still in the AuthShell
   layout, so the test should pass; but if it doesn't, surface as
   BUG-55-03-a-RESET-PAGE-LAYOUT.
5. Three consecutive runs — no flake.
6. Full slim acceptance sweep → must be 9 passed (was 8).
7. typecheck + lint green.
8. Commit: `test(55-03-a): green — locale toggle on 6 public routes`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
# exists

$ grep -c 'aria-pressed' apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
# ≥ 4 (EN-active + RU-active assertions)

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
# ≥ 5 (one per major step)

$ grep -c '/api/locale' apps/web/tests/e2e/100-acceptance/locale-toggle-public-pages.spec.ts
# ≥ 2 (no-op assertion + response wait)

$ OPENWHISPR_TOPOLOGY=slim ... 100-acceptance --project=slim
# 9 passed
```

## Risks

- **`/setup` redirect.** If the slim docker instance has setup
  complete, `/setup` 302s to `/admin` or `/app`. Spec MUST detect this
  and skip the route, not fail. Use `page.url()` after `goto` to
  branch.
- **`/reset-password` requires `?token=`.** Without it, the page shows
  an error state — but the LanguageSwitcher is still in the AuthShell
  layout (the layout mounts it OUTSIDE the page content). Use a fake
  token query string for stability.
- **`/verify-email` without `?token=`** renders the error variant with
  Mail icon. The switcher is mounted in the layout, so it's still
  visible. No spec change.
- **`/forgot-password` and `/reset-password` are sibling routes.** Both
  added in Plan 55-01-a. Both use the AuthShell layout. The LanguageSwitcher
  is on every AuthShell-wrapped page.
- **Cookie state leakage.** Each test has empty storageState. Cookie is
  cleared between tests automatically. Step 5 restores EN for
  good-citizen behavior, but Playwright's per-test context cleanup
  also handles it.
- **`waitForTimeout` for absence assertion.** Banned in Plan 53. The
  only justification: ABSENCE-of-event assertions cannot use auto-
  retrying matchers because there's nothing to retry against. The 1.5s
  bound is small enough to not slow the suite materially.
- **Constitutional EN-only matchers.** All `getByRole` name regexes use
  EN copy. The `aria-pressed` attribute is locale-independent.
