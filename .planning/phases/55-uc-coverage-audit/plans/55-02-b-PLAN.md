---
phase: 55-uc-coverage-audit
plan: 02-b
type: execute
wave: 2
depends_on: [55-02-a]
files_modified:
  - apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx
  - apps/web/src/components/screens/auth/SignInForm.tsx
  - apps/web/src/components/screens/auth/SignUpForm.tsx
  - apps/web/src/components/screens/auth/ResetPasswordForm.tsx
  - apps/web/src/locales/en/end-user.json
  - apps/web/src/locales/ru/end-user.json
  - apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts
requirements:
  - UC-SIGNIN-EYE-TOGGLE
  - UC-SIGNUP-EYE-TOGGLE
  - UC-RESETPW-EYE-TOGGLE
  - BUG-55-EYE-TOGGLE-MISSING
must_haves:
  truths:
    - "PasswordInputWithToggle component shipped — wraps a controlled <Input> + eye/eye-off button, exposes showPassword state internally"
    - "Eye-toggle works on /sign-in (already existed) — clicking flips input type=password ↔ type=text"
    - "Eye-toggle works on /sign-up (NEW) — same flip behavior"
    - "Eye-toggle works on /reset-password (NEW) — same flip behavior, on BOTH password fields"
    - "Every toggle click is asserted via input[type] attribute change AND visually-hidden label text"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx
      provides: Reusable password input + eye-toggle building block
    - path: apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts
      provides: Long-form e2e cycling toggle on all 3 surfaces
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts
      to: apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx
      via: getByRole("button", { name: /show|hide password/i }) + input[type]
      pattern: 'PasswordInputWithToggle|togglePassword'
---

<objective>
Refactor the existing eye-toggle UI on `/sign-in` (`SignInForm.tsx:208-235`)
into a reusable `PasswordInputWithToggle` building block, then USE that
component on `/sign-up` (password field) and `/reset-password` (BOTH
new-password + confirm-password fields). Land a single long-form
acceptance spec that drives the toggle on all 3 surfaces.

`expectNoBrowserErrors` after every toggle click.

Closes 3 MISSING UCs + 1 BUG:
- **UC-SIGNIN-EYE-TOGGLE** — `SignInForm.tsx:208-235` never clicked
- **UC-SIGNUP-EYE-TOGGLE** — feature does not exist; this plan ships it
- **UC-RESETPW-EYE-TOGGLE** — feature does not exist; this plan ships it
- **BUG-55-EYE-TOGGLE-MISSING** — users type passwords blind on sign-up
  and reset-password

Output:
- `apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx` (new)
- 3 surface refactors (SignInForm, SignUpForm, ResetPasswordForm)
- `apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts` (new)
</objective>

## Context

`SignInForm.tsx:200-236` already implements the pattern: a `useState`
for `showPassword`, conditional `type={showPassword ? "text" : "password"}`,
an absolutely-positioned `<button>` with visually-hidden label and
`<Eye>` / `<EyeOff>` icons. The pattern is verified-good on EN+RU
locales (Phase 53 visual baselines).

The refactor extracts that pattern (lines 207-236) into a standalone
component. The component MUST be a `forwardRef` Input wrapper because
RHF's `FormControl` Slot still needs to forward `id` / `aria-describedby`
to the actual `<input>` DOM node. See `SignInForm.tsx:200-207` comment
for the existing Radix-Slot rationale — the new component must preserve
this contract (the toggle button is an absolute sibling of the input,
NOT a child).

`/sign-up` password field is at `SignUpForm.tsx:198-237`. The custom
`onChange` shadow (`SignUpForm.tsx:210-213` — `setPasswordValue` for the
strength meter) MUST be preserved when migrating to the new component.
`PasswordInputWithToggle` must accept an `onChange` prop that fires on
every keystroke.

`/reset-password` has TWO password fields (new + confirm). Need to
audit `ResetPasswordForm.tsx` and route both through the component.

i18n: add `end-user.signin.action.togglePassword.{show,hide}.label` keys
already exist (verify); add namespace-neutral keys for shared use OR
keep the same key prefix on sign-up and reset-password screens
(`end-user.signup.action.togglePassword.*`,
`end-user.resetPassword.action.togglePassword.*`). Recommended:
introduce a SHARED key `end-user.common.action.togglePassword.{show,hide}.label`
so the component doesn't have to be parameterized with a namespace.

## Files to create

- `apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx`
- `apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts`

## Files to modify

- `apps/web/src/components/screens/auth/SignInForm.tsx` — replace the
  inline eye-toggle block with `<PasswordInputWithToggle>`. Behavior
  must be byte-identical; visual baselines should NOT regress (verify
  with `auth-shell-visual.spec.ts` if it has a baseline for sign-in).
- `apps/web/src/components/screens/auth/SignUpForm.tsx` — replace the
  raw `<Input type="password">` at line 205-214 with
  `<PasswordInputWithToggle onChange={(e) => { field.onChange(e); setPasswordValue(e.target.value); }}>` —
  preserving the shadow setState for the strength meter.
- `apps/web/src/components/screens/auth/ResetPasswordForm.tsx` — both
  password fields route through `PasswordInputWithToggle`.
- `apps/web/src/locales/en/end-user.json` — add
  `common.action.togglePassword.{show,hide}.label` if introducing shared
  keys; else add per-namespace keys.
- `apps/web/src/locales/ru/end-user.json` — Russian translations.

## Tasks

### Task 1 — RED: ship a failing acceptance spec (component does not yet exist on sign-up / reset-password)

1. Create `apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts`.
   Header comment: Phase 55-02-b, slim-only, drives 3 surfaces.
2. Imports: `test, expect`, `attachBrowserDiagnostics`,
   `expectNoBrowserErrors`. No fixture user needed (forms are not
   submitted; only the toggle is exercised). `test.use({ storageState:
   empty })`. `beforeEach` — slim-only gate + attach diagnostics.
3. Single test:
   `"eye-toggle flips password ↔ text on sign-in, sign-up, and reset-password — zero browser errors"`.
4. Helper inside the spec (NOT in support/, since it's spec-local):
   ```ts
   async function exerciseToggle(page, passwordLabel: RegExp, toggleLabel: RegExp) {
     const passwordInput = page.getByLabel(passwordLabel);
     await expect(passwordInput).toHaveAttribute("type", "password");
     const toggle = page.getByRole("button", { name: toggleLabel });
     await toggle.click();
     await expect(passwordInput).toHaveAttribute("type", "text");
     await expectNoBrowserErrors(page);
     await toggle.click();
     await expect(passwordInput).toHaveAttribute("type", "password");
     await expectNoBrowserErrors(page);
   }
   ```
5. Steps:
   - **step 1 — /sign-in**: `await page.goto("/sign-in")`. Call
     `exerciseToggle(page, /password/i, /show password|показать пароль/i)`.
     `expectNoBrowserErrors(page)` at navigation completion.
   - **step 2 — /sign-up**: `await page.goto("/sign-up")`. Same
     pattern. THIS WILL FAIL ON RED because the toggle doesn't exist yet.
   - **step 3 — /forgot-password → /reset-password?token=…**: The
     `/reset-password` route needs a `?token=` to render the form
     (otherwise it shows the error variant). Hit the API directly to
     create a token (mirror `password-reset.spec.ts` pattern), OR
     visit `/reset-password?token=spec-fake-token-xyz` — the form
     renders even for an invalid token; only the SUBMIT path validates.
     Call `exerciseToggle(page, /new password|новый пароль/i, ...)`.
     Then locate the SECOND password field (confirm) by label
     `/confirm/i` and exercise the second toggle independently.
6. Run
   `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/password-eye-toggle --project=slim`.
   MUST fail (sign-up + reset-password don't have toggle buttons yet).
7. Commit:
   `test(55-02-b-01): RED — eye-toggle long-form spec, sign-up + reset-password missing toggle`

### Task 2 — GREEN: ship PasswordInputWithToggle component + i18n keys

1. Create `apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx`.
   Implementation: `React.forwardRef<HTMLInputElement, Props>` where
   `Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">`.
   Wraps `<Input ref={ref} type={showPassword ? "text" : "password"} {...rest}>`
   in a `<div className="relative">` and adds the `<button>` toggle
   sibling. Internal `useState` for `showPassword`. Component accepts
   `togglePasswordShowLabel` + `togglePasswordHideLabel` props OR reads
   them from `useTranslation` with shared keys — pick one and document.
   Recommended: PROPS, not `useTranslation` (keeps the component
   namespace-agnostic, callers translate their own labels).
2. Update i18n:
   - In `apps/web/src/locales/en/end-user.json` add
     `common.action.togglePassword.show.label: "Show password"` and
     `common.action.togglePassword.hide.label: "Hide password"`.
   - In `apps/web/src/locales/ru/end-user.json` add equivalent
     `Показать пароль` / `Скрыть пароль`.
3. Refactor `SignInForm.tsx` lines 200-236:
   - Replace the entire `<div className="relative"><FormControl>...`
     block with a single `<PasswordInputWithToggle>` inside `<FormControl>`.
   - `togglePasswordShowLabel` + `togglePasswordHideLabel` resolved from
     `t("end-user.common.action.togglePassword.show.label")`.
   - Remove the now-orphan `showPassword` `useState` + `togglePasswordLabel`
     local from `SignInForm`.
   - Remove the `Eye, EyeOff` import from `SignInForm` (moved into
     `PasswordInputWithToggle`).
4. Refactor `SignUpForm.tsx`:
   - Replace `<Input type="password" ... />` with
     `<PasswordInputWithToggle autoComplete="new-password" disabled={submitting} {...field} onChange={(e) => { field.onChange(e); setPasswordValue(e.target.value); }} togglePasswordShowLabel={...} togglePasswordHideLabel={...} />`.
   - Preserve the `passwordValue.length > 0` strength-meter render gate
     (sibling, not child of the toggle component).
5. Refactor `ResetPasswordForm.tsx`:
   - Locate both password inputs (new + confirm). Each routes through
     `PasswordInputWithToggle` independently. Each has its OWN
     `showPassword` state — exposed by the component's internal
     `useState`, so two component instances mean two independent
     toggles (correct UX).
6. Re-run the spec on slim — MUST pass first try.
7. Run `pnpm --filter @openwhispr/web typecheck` → green.
8. Run `make lint` → green.
9. Run the full acceptance suite + the visual baseline specs
   (`auth-shell-visual.spec.ts`). If the sign-in visual baseline drifts
   ONLY due to a 1px alignment change in the eye-toggle button, update
   the snapshot with `--update-snapshots` and commit alongside. If the
   drift is non-trivial, halt and surface.
10. Commit (single atomic GREEN — component + 3 refactors + i18n + spec
    passes):
    `feat(55-02-b-02): GREEN — PasswordInputWithToggle on sign-in, sign-up, reset-password`

### Task 3 — verify backlog state

1. If `.planning/deferred-items.md` ever gains a `BUG-55-EYE-TOGGLE-MISSING`
   entry, delete it. If not, skip.
2. Three consecutive slim-sweep runs of the new spec — no flake.
3. Commit if changes to backlog:
   `chore(55-02-b): drop BUG-55-EYE-TOGGLE-MISSING from backlog`

## Done

```
$ ls apps/web/src/components/screens/auth/PasswordInputWithToggle.tsx
# exists

$ grep -c 'PasswordInputWithToggle' apps/web/src/components/screens/auth/SignInForm.tsx apps/web/src/components/screens/auth/SignUpForm.tsx apps/web/src/components/screens/auth/ResetPasswordForm.tsx
# ≥ 3 (one per file)

$ grep -c 'common.action.togglePassword' apps/web/src/locales/{en,ru}/end-user.json
# ≥ 4 (show + hide × 2 locales)

$ ls apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts
# exists

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/password-eye-toggle.spec.ts
# ≥ 6 (one per step + helper internals)

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim
# all acceptance specs green
```

## Risks

- **Visual baseline drift on /sign-in.** The refactor preserves DOM
  shape (toggle is still an absolute sibling, same Eye/EyeOff icons,
  same Tailwind classes). If the snapshot drifts, treat as expected
  and update; do NOT mask drift by reverting the refactor.
- **`onChange` prop forwarding on sign-up.** The strength meter depends
  on `setPasswordValue` firing on every keystroke. The new component
  MUST spread `...rest` props onto the underlying `<Input>` so RHF's
  `field.onChange` + the shadow `setPasswordValue` both fire.
- **forwardRef contract.** RHF passes `ref` via the field spread.
  `PasswordInputWithToggle` must `forwardRef` to the inner `<input>`
  via the `<Input>` component (which already does this — see
  `shadcn/ui` Input).
- **Two-toggle reset-password.** Both fields use the SAME component
  but each has its OWN internal `useState`. Verify the second click
  on field 1 does NOT toggle field 2. Spec step 3 verifies this by
  checking field 2's `type` attribute stays unchanged after toggling
  field 1.
- **`/reset-password` route ungated.** The page accepts any `?token=…`
  query and renders the form even for invalid tokens (validation runs
  on submit). Spec uses a fake token like `spec-fake-token-xyz` and
  never submits — no DB side-effects.
- **i18n shared-namespace pattern.** This is the first time a shared
  `common.*` key is introduced in `end-user.json`. If the project
  has a stronger convention (e.g., separate `common.json` namespace),
  switch to that instead — read `apps/web/src/locales/en/` first.
