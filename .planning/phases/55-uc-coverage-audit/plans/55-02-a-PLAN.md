---
phase: 55-uc-coverage-audit
plan: 02-a
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
requirements:
  - UC-SIGNUP-STRENGTH-WEAK
  - UC-SIGNUP-STRENGTH-FAIR
  - UC-SIGNUP-STRENGTH-GOOD
  - UC-SIGNUP-STRENGTH-STRONG
must_haves:
  truths:
    - "Typing a password that scores 0-1 signals renders <span data-strength-band='weak'> with the localized 'Weak' label"
    - "Typing a password that scores 2 signals renders <span data-strength-band='fair'> with the localized 'Fair' label"
    - "Typing a password that scores 3 signals renders <span data-strength-band='good'> with the localized 'Good' label"
    - "Typing a password that scores 4 signals renders <span data-strength-band='strong'> with the localized 'Strong' label"
    - "Clearing the password field hides the meter entirely (data-testid='password-strength-meter' not in DOM)"
    - "Every step emits zero browser console errors (expectNoBrowserErrors after each band change)"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
      provides: Long-form e2e exercising all 4 strength bands + hidden state
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
      to: apps/web/src/components/screens/auth/SignUpForm.tsx
      via: UI keystroke → passwordStrength() classifier → meter render
      pattern: 'data-strength-band|data-testid="password-strength-meter"'
---

<objective>
Land a long-form acceptance e2e that drives `/sign-up`'s password field
through 5 transitions (empty → weak → fair → good → strong → empty) and
asserts each band is rendered with the correct `data-strength-band`
attribute + localized label. `expectNoBrowserErrors` after EVERY band
change.

Closes 4 MISSING UCs from RESEARCH.md §"`/sign-up`":
**UC-SIGNUP-STRENGTH-WEAK/FAIR/GOOD/STRONG** —
`SignUpForm.tsx:54-64, 217-232` `data-strength-band="weak|fair|good|strong"`
never asserted in any spec.

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts`.
Slim-only. No fixture user needed (form is never submitted).
</objective>

## Context

`SignUpForm.tsx:54-64` defines the inline `passwordStrength(value)` band
classifier. Signal counters:
- `value.length >= 12` → +1
- `/[A-Z]/.test(value)` → +1
- `/[0-9]/.test(value)` → +1
- `/[^A-Za-z0-9]/.test(value)` → +1

Band mapping at `SignUpForm.tsx:60-63`:
- score ≤ 1 → `weak` (`bg-red-500`)
- score === 2 → `fair` (`bg-orange-500`)
- score === 3 → `good` (`bg-yellow-500`)
- score === 4 → `strong` (`bg-green-500`)

The meter only renders when `passwordValue.length > 0`
(`SignUpForm.tsx:217`). The band label key lives at
`end-user.signup.form.passwordStrength.${bandKey}.label`.

Test inputs (chosen to land EACH band deterministically):
| Band | Password | Signals (len≥12, upper, digit, symbol) | Score |
|---|---|---|---|
| weak | `abc` | 0 / 0 / 0 / 0 | 0 → weak |
| fair | `abcdefghijkl` | 1 / 0 / 0 / 0 → 1 (still weak!) — adjust → `abcdefghijklM` (1 + 1 = 2) | 2 → fair |
| good | `abcdefghijklM1` (1 + 1 + 1) | 3 | 3 → good |
| strong | `abcdefghijklM1!` (1 + 1 + 1 + 1) | 4 | 4 → strong |

Re-check: `weak` band covers scores 0 AND 1 (the `s <= 1` branch). The
weak band must be exercised at score 0 (empty-of-signals like `abc`) so
the assertion does not silently overlap with `fair`. Use `abc` for weak
(score 0).

## Files to create

- `apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts` —
  Playwright spec. Slim-only. Single test.

## Files to modify

(none — the strength meter surface is already shipped; this plan is
a pure coverage-closure spec, no production code touched)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create `apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts`.
   Header comment block mirrors `revoke-sessions.spec.ts:1-30` (Phase
   55-02-a provenance, slim-only justification, "no fixture user"
   justification).
2. Imports — exact set:
   - `test, expect` from `@playwright/test`
   - `attachBrowserDiagnostics, expectNoBrowserErrors` from
     `../support/browser-diagnostics.js`
3. `test.use({ storageState: { cookies: [], origins: [] } })` (no auth).
4. `beforeEach`: slim-only gate + `attachBrowserDiagnostics(page)`.
5. Test body — single test
   `"password strength meter cycles weak → fair → good → strong → empty with zero browser errors"`.
   Steps:
   - **step 1 — visit /sign-up**:
     `await page.goto(WEB_BASE + "/sign-up")`.
     Assert `await expect(page.getByRole("heading", { name: /create your account|создайте аккаунт/i })).toBeVisible()` —
     accommodates EN locale (default) but defensively allows RU if a
     prior spec leaked locale cookie.
     Assert meter is HIDDEN (no `data-testid="password-strength-meter"`).
     `expectNoBrowserErrors(page)`.
   - **step 2 — type WEAK password (`abc`)**:
     `await page.getByLabel(t("end-user.signup.form.password.label"))` —
     resolves the password input via FormLabel. Type `abc`.
     Assert `await expect(page.locator('[data-strength-band="weak"]')).toBeVisible()`.
     Assert visible text matches the localized "Weak" label (use
     `await expect(page.locator('[data-strength-band="weak"]')).toContainText(/weak|слабый/i)`).
     `expectNoBrowserErrors(page)`.
   - **step 3 — clear + type FAIR (`abcdefghijklM`)**:
     `await passwordInput.fill("")` then `await passwordInput.fill("abcdefghijklM")`.
     Assert `data-strength-band="fair"` visible; weak NOT in DOM.
     `expectNoBrowserErrors(page)`.
   - **step 4 — clear + type GOOD (`abcdefghijklM1`)**:
     Same shape, assert `data-strength-band="good"` visible; fair NOT in DOM.
     `expectNoBrowserErrors(page)`.
   - **step 5 — clear + type STRONG (`abcdefghijklM1!`)**:
     Same shape, assert `data-strength-band="strong"` visible; good NOT in DOM.
     `expectNoBrowserErrors(page)`.
   - **step 6 — clear field**:
     `await passwordInput.fill("")`.
     Assert `await expect(page.locator('[data-testid="password-strength-meter"]')).toHaveCount(0)` —
     meter is gone (passwordValue.length === 0 branch).
     `expectNoBrowserErrors(page)`.
6. Run
   `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/password-strength-meter --project=slim`.
   Spec MUST fail (file didn't exist before this commit). Take care:
   on RED commit the WORKER reads playwright config which requires
   `testIgnore: ["**/__tests__/**"]` — the new spec file path doesn't
   trigger that ignore. Standard slim invocation.
7. Commit:
   `test(55-02-a): RED — password strength meter long-form spec`

### Task 2 — GREEN: bring stack up, spec passes first try

1. Verify slim stack is up (`docker compose ps`); if down, bring up via
   `make up-with-dev-tools` (or operator's standard target).
2. Re-run the spec. MUST pass on first attempt (no production change).
3. Run the full acceptance suite to confirm no regression:
   `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim`.
4. Three consecutive runs of the new spec — assert no flake.
5. Run `pnpm --filter @openwhispr/web typecheck` → green.
6. Run `make lint` → green.
7. Commit:
   `test(55-02-a): GREEN — password strength meter spec passes 3x clean on slim`

## Done

Observable assertions:

```
$ ls apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
# file exists

$ grep -c "expectNoBrowserErrors" apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
# returns ≥ 6 (one per step)

$ grep -c 'data-strength-band="\(weak\|fair\|good\|strong\)"' apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
# returns 4 (all 4 bands asserted)

$ grep -cE 'page\.route|MSW' apps/web/tests/e2e/100-acceptance/password-strength-meter.spec.ts
# returns 0

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/password-strength-meter --project=slim
# exit code 0, "1 passed"

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim
# exit code 0, all acceptance specs green (5 specs after this lands)
```

## Risks

- **Locale-state leakage from prior specs.** Acceptance specs run with
  empty storageState — the i18n cookie is cleared per test. EN is
  Better Auth default. Spec assertions on RU labels use case-insensitive
  regex unions (`/weak|слабый/i`) as defense.
- **Score-0 vs score-1 weak collision.** Both fall into the `weak` band
  (`s <= 1`). The chosen input `abc` is score 0 (zero signals);
  internal collapse is invisible at the DOM layer (same `bandKey`).
  No assertion ambiguity.
- **passwordValue lag.** The meter mounts on `setPasswordValue` which
  fires in the `onChange` shadow handler (`SignUpForm.tsx:210-213`).
  Playwright's `fill()` triggers the React change synchronously enough
  that `toBeVisible()` auto-waits with default timeout cover it.
- **FormLabel selector.** `getByLabel` resolves through the
  RHF `<FormLabel>` → `<FormControl>` (Radix Slot) chain, which
  forwards the `htmlFor` correctly per `form.tsx`. Verified pattern
  from `p53-signup-smoke.spec.ts:38` (`getByLabel(...password)`).
- **Empty-field hidden assertion.** The meter renders inside
  `passwordValue.length > 0 ? (...) : null` — fully unmounted, so
  `toHaveCount(0)` is the safe assertion (NOT `toBeHidden`, which
  matches displayed-but-`visibility:hidden` elements).
