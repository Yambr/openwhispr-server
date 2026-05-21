---
phase: 55-uc-coverage-audit
plan: 03-b
type: execute
wave: 2
depends_on: [55-03-a]
files_modified:
  - apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
requirements:
  - UC-THEME-DROPDOWN-OPEN
  - UC-THEME-LIGHT-FLIP
  - UC-THEME-DARK-FLIP
  - UC-THEME-SYSTEM-RESOLVE
  - UC-THEME-PERSISTENCE
must_haves:
  truths:
    - "Theme button visible on /app (AppShell) — opens a dropdown menu with 3 options: Light / Dark / System"
    - "Clicking Light → <html class='light'> AND data-theme='light' (next-themes default applies both)"
    - "Clicking Dark → <html class='dark'>"
    - "Clicking System → resolves to the OS preference (test asserts <html data-theme='system'> attribute is set; the resolved-class swap depends on emulated mediaQuery prefersColorScheme)"
    - "After Dark + page reload, the theme remains dark (localStorage persistence)"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
      provides: Long-form e2e exercising all 3 theme options + persistence
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
      to: apps/web/src/components/screens/theme-switcher.tsx
      via: DropdownMenu click → next-themes setTheme → <html class>
      pattern: 'aria-label.*toggle.*theme|next-themes'
---

<objective>
Land a long-form acceptance e2e that exercises the theme switcher's
3-option dropdown on `/app` (authed): Light, Dark, System. Each option
flips `<html class>` (and/or `data-theme`) correctly. Then reload the
page and assert persistence.

`expectNoBrowserErrors` at every step.

Closes 4 MISSING UCs + upgrades 1 PARTIAL from RESEARCH.md §"Theme switcher":
- **UC-THEME-DROPDOWN-OPEN** — `theme-switcher.tsx:24-31` trigger
- **UC-THEME-LIGHT-FLIP** (upgrade from PARTIAL — full-flow asserts flip
  but doesn't open the dropdown explicitly)
- **UC-THEME-DARK-FLIP** (upgrade from PARTIAL — same)
- **UC-THEME-SYSTEM-RESOLVE** — `theme-switcher.tsx:41-43`; never tested
- **UC-THEME-PERSISTENCE** — COVERED only on dark flip in full-flow.spec.ts;
  we add a System persistence assertion

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts`.
Slim-only. Dedicated fixture user `alice+55e@test.local` (acceptance
suite convention).
</objective>

## Context

`theme-switcher.tsx` uses `next-themes`'s `setTheme(...)`. By default
next-themes sets BOTH `<html class>` (light or dark) AND a
`data-theme` attribute. When `System` is set, it falls back to the
OS preference. Playwright can emulate via
`page.emulateMedia({ colorScheme: 'dark' | 'light' })` before clicking
System to test resolution.

Dropdown menu open pattern (shadcn/ui DropdownMenu wraps Radix):
- Click the trigger button (aria-label="Toggle theme")
- The 3 DropdownMenuItem elements render in a portal — query with
  `page.getByRole("menuitem", { name: /light/i })` etc.

User must be signed in to reach `/app`. Need a fixture user with
verified email. Use `alice+55e@test.local` to stay isolated from
sibling plans (alice+55, +55c, +55d).

## Files to create

- `apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts`

## Files to modify

(none)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create the spec. Header: Phase 55-03-b, slim-only, dedicated user.
2. Imports: `test, expect`, `attachBrowserDiagnostics`,
   `expectNoBrowserErrors`, `fetchVerificationLink`.
3. Constants:
   - `WEB_BASE = "http://localhost:3000"`
   - `FIXTURE_EMAIL = "alice+55e@test.local"`
   - `FIXTURE_PASSWORD = "Theme55e!#StrongTest"`
4. `test.use({ storageState: empty })`. `beforeEach`: slim-only +
   diagnostics.
5. Single test:
   `"theme switcher cycles Light → Dark → System on /app; reload preserves Dark; zero browser errors"`.
6. Steps:
   - **step 1 — provision alice+55e idempotently + sign-in + reach /app**:
     Mirror `revoke-sessions.spec.ts` step 1+2. Sign-up handles
     USER_ALREADY_EXISTS; sign-in via UI; await `/app`.
   - **step 2 — open theme dropdown, assert 3 options visible**:
     `const toggle = page.getByRole("button", { name: /toggle theme/i });`
     `await toggle.click();`
     Assert `await expect(page.getByRole("menuitem", { name: /light/i })).toBeVisible();`
     Same for Dark and System.
     `expectNoBrowserErrors(page)`.
   - **step 3 — click Light**:
     `await page.getByRole("menuitem", { name: /^light$/i }).click();`
     Assert `<html>` has class `light` OR data-theme `light`:
     ```ts
     await expect(page.locator('html')).toHaveAttribute('class', /light/);
     // OR (next-themes also sets data-theme):
     // await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
     ```
     `expectNoBrowserErrors(page)`.
   - **step 4 — click Dark**:
     Open dropdown again (DropdownMenu auto-closes after click).
     Click Dark menuitem.
     Assert `<html class>` contains `dark`.
     `expectNoBrowserErrors(page)`.
   - **step 5 — emulate OS=light, click System**:
     `await page.emulateMedia({ colorScheme: 'light' });`
     Open dropdown, click System.
     Assert `<html data-theme>` attribute equals `system` OR
     resolved class is `light`. next-themes sets `data-theme="system"`
     when System is chosen but the resolved class is derived from
     mediaQuery — assert the data-theme is "system" (the explicit
     choice) AND the class contains 'light' (the resolved state):
     ```ts
     await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
     await expect(page.locator('html')).toHaveClass(/light/);
     ```
     `expectNoBrowserErrors(page)`.
   - **step 6 — switch back to Dark, reload, assert persistence**:
     Open dropdown, click Dark.
     Wait for `<html class>` to contain dark.
     `await page.reload({ waitUntil: 'domcontentloaded' });`
     Assert `<html class>` STILL contains `dark` (localStorage carries it).
     `expectNoBrowserErrors(page)`.
7. Run on slim → fails (file missing).
8. Commit: `test(55-03-b): red — theme switcher cycle long-form spec`

### Task 2 — GREEN: spec passes first try

1. Stack up. Re-run spec.
2. **If next-themes attribute schema doesn't match assumption**
   (e.g. `class="light"` not in classList, or `data-theme` not present
   on `<html>` but on `<body>`), inspect via
   `await page.evaluate(() => document.documentElement.outerHTML)` and
   adjust assertions. Document the actual contract in a comment.
3. **If System resolution doesn't auto-resolve to light** after
   `emulateMedia({ colorScheme: 'light' })`, investigate
   `next-themes` SSR hydration — possibly need to wait for hydration:
   `await page.waitForFunction(() => document.documentElement.classList.length > 0);`
4. Three runs no flake.
5. Full slim acceptance sweep → 10 passed.
6. typecheck + lint green.
7. Commit: `test(55-03-b): green — theme switcher 3-option cycle + persistence`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
# exists

$ grep -cE 'menuitem.*light|menuitem.*dark|menuitem.*system' apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
# ≥ 3

$ grep -c 'emulateMedia' apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
# ≥ 1

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/theme-switcher-cycle.spec.ts
# ≥ 5

$ OPENWHISPR_TOPOLOGY=slim ... 100-acceptance --project=slim
# 10 passed
```

## Risks

- **DropdownMenu portal location.** Radix renders portals at body
  level. `getByRole("menuitem")` resolves through the accessible
  tree, not the DOM tree — should work cleanly. If not, fall back to
  `page.locator('[role="menuitem"]')` or query by data-radix-* attr.
- **next-themes class vs data-theme.** The library can be configured
  with attribute `class` (default) or `data-theme`. Read
  `apps/web/src/app/layout.tsx` or `ThemeProvider` config to confirm.
  If config is `attribute="class"`, assert via classList; if `data-theme`,
  use attribute. If both, assert both for robustness.
- **System resolution lag.** `emulateMedia` is synchronous but
  next-themes may have a useEffect that resolves on the next render.
  Use Playwright's auto-retrying matchers (toHaveClass) — they poll.
- **Reload state.** next-themes uses localStorage by default. Reload
  preserves localStorage. The Dark assertion after reload validates
  this end-to-end.
- **Existing PARTIAL spec.** `full-flow.spec.ts:178-213` already flips
  the theme. This spec doesn't conflict — it walks the FULL dropdown
  including System, and asserts the dropdown UI explicitly.
- **alice+55e isolation.** Like sibling 55-* fixture users, this user
  persists across runs; idempotent sign-up + skip-if-already-exists
  pattern from `revoke-sessions.spec.ts`.
