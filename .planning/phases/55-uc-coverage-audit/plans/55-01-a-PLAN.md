---
phase: 55-uc-coverage-audit
plan: 01-a
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/src/app/(public)/forgot-password/page.tsx
  - apps/web/src/app/(public)/reset-password/page.tsx
  - apps/web/src/components/screens/auth/ForgotPasswordForm.tsx
  - apps/web/src/components/screens/auth/ResetPasswordForm.tsx
  - apps/web/src/components/screens/auth/SignInForm.tsx
  - apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx
  - apps/web/src/components/screens/auth/__tests__/ForgotPasswordForm.test.tsx
  - apps/web/src/components/screens/auth/__tests__/ResetPasswordForm.test.tsx
  - apps/web/src/locales/en/end-user.json
  - apps/web/src/locales/ru/end-user.json
  - apps/web/tests/e2e/100-acceptance/password-reset.spec.ts
  - .planning/deferred-items.md
autonomous: true
requirements:
  - BUG-54-PRD-RESET-UI-MISSING
  - UC-BLOCKED-forgot-password-route
must_haves:
  truths:
    - "User on /sign-in sees a real link reading 'Forgot password?' that navigates to /forgot-password"
    - "/forgot-password renders an email input and submit button; submit POSTs /api/auth/request-password-reset"
    - "After submit, /forgot-password renders an enumeration-safe confirmation (same copy regardless of whether email is registered)"
    - "/reset-password reads ?token=… from the URL, renders new-password + confirm fields, submit POSTs /api/auth/reset-password"
    - "Successful reset redirects the user to /sign-in where the new password authenticates"
    - "Every step in the acceptance spec emits zero browser console errors"
  artifacts:
    - path: apps/web/src/app/(public)/forgot-password/page.tsx
      provides: RSC route shell for /forgot-password
    - path: apps/web/src/app/(public)/reset-password/page.tsx
      provides: RSC route shell parsing ?token=… and forwarding to ResetPasswordForm
    - path: apps/web/src/components/screens/auth/ForgotPasswordForm.tsx
      provides: Email input + submit + enumeration-safe success panel
    - path: apps/web/src/components/screens/auth/ResetPasswordForm.tsx
      provides: New-password + confirm fields + submit calling Better Auth resetPassword
    - path: apps/web/tests/e2e/100-acceptance/password-reset.spec.ts
      provides: Long-form e2e walking sign-in → forgot → mailpit → reset → sign-in
  key_links:
    - from: apps/web/src/components/screens/auth/SignInForm.tsx
      to: apps/web/src/app/(public)/forgot-password/page.tsx
      via: Next.js <Link href="/forgot-password">
      pattern: 'href=\"/forgot-password\"'
    - from: apps/web/src/components/screens/auth/ForgotPasswordForm.tsx
      to: /api/auth/request-password-reset
      via: authClient.forgetPassword / authClient.requestPasswordReset
      pattern: 'request-password-reset|forgetPassword|requestPasswordReset'
    - from: apps/web/src/components/screens/auth/ResetPasswordForm.tsx
      to: /api/auth/reset-password
      via: authClient.resetPassword
      pattern: 'resetPassword|reset-password'
    - from: apps/web/tests/e2e/100-acceptance/password-reset.spec.ts
      to: apps/web/tests/e2e/support/mailpit.ts
      via: fetchPasswordResetLink
      pattern: 'fetchPasswordResetLink'
---

<objective>
Close BUG-54-PRD-RESET-UI-MISSING by shipping the `/forgot-password` and
`/reset-password` Next.js routes + matching client forms, reversing the
D-UX2 muted sentinel on `SignInForm.tsx:247-253` to a live anchor, and
landing a long-form acceptance e2e that walks the entire reset round-trip
(sign-in screen → forgot → mailpit → reset link → reset form → sign-in
with the new password) with `expectNoBrowserErrors` at every step.

Purpose: this unblocks the single BLOCKED UC in the Phase 55 audit
(RESEARCH.md §"Top 10 gaps" #1) and closes BUG-54-PRD-RESET-UI-MISSING in
`.planning/deferred-items.md:18`. The API wire is already GREEN
(`tests/e2e-cjm/steps/password-reset.steps.ts` proves
`/api/auth/request-password-reset` + `/api/auth/reset-password` work);
only the web UI surface is missing.

Output: two new public routes, two new client forms, one new long-form
acceptance spec, i18n copy flipped from "coming soon" → active CTA, and
the deferred-items.md BUG entry deleted (git history retains the record
per the file's own triage convention).
</objective>

## Context

This plan solves the single BLOCKED UC in the Phase 55 audit:

- **UC-BLOCKED-forgot-password-route** — `apps/web/src/components/screens/auth/SignInForm.tsx:251-253`
  renders muted static text instead of a real link; `apps/web/src/app/(public)/`
  has no `forgot-password/` or `reset-password/` directory. Every user
  who forgets their password is stuck.

Pre-existing wire surface this plan composes on top of (do NOT re-build):

- `POST /api/auth/request-password-reset` — Better Auth 1.6.9 (proven
  GREEN by `tests/e2e-cjm/steps/password-reset.steps.ts:71`).
- `POST /api/auth/reset-password` — Better Auth 1.6.9 (proven GREEN by
  `tests/e2e-cjm/steps/password-reset.steps.ts:118`).
- `fetchPasswordResetLink(email, opts)` in
  `apps/web/tests/e2e/support/mailpit.ts:99` — already shipped by Plan
  54-01, ready to use.
- `DEFAULT_ALLOWLIST` in `apps/web/tests/e2e/support/browser-diagnostics.ts`
  — already covers `_rsc=… ERR_ABORTED` and `POST /api/locale
  ERR_ABORTED` framework noise.

## Files to create

- `apps/web/src/app/(public)/forgot-password/page.tsx` — RSC entry that
  renders `<ForgotPasswordForm />` inside `<AuthShell>` (mirrors the
  `/sign-in/page.tsx:8-12` pattern).
- `apps/web/src/app/(public)/reset-password/page.tsx` — RSC entry. Reads
  `searchParams.token` (Next.js 15 App Router signature:
  `{ searchParams: Promise<{ token?: string }> }`), awaits it, forwards
  to `<ResetPasswordForm token={token ?? null} />`.
- `apps/web/src/components/screens/auth/ForgotPasswordForm.tsx` — Client
  Component. RHF + zod (single-field schema, email only). Calls
  `authClient.forgetPassword({ email })` (Better Auth 1.6.9 exposes
  this name; if the typed client surface lacks it, cast through the
  same `ExtendedAuthClient` pattern used in `SignInForm.tsx:69-71`).
  Renders enumeration-safe success panel ("If your email is registered,
  we've sent you a reset link.") on ANY response (success, error, or
  network failure). Uses AuthShell wrapper.
- `apps/web/src/components/screens/auth/ResetPasswordForm.tsx` — Client
  Component. RHF + zod (newPassword + confirmPassword, with cross-field
  refine for equality + strength from
  `apps/web/src/lib/schemas/auth.ts`'s existing password constraints).
  Receives `token: string | null` prop from the RSC parent. If
  `token === null` or empty, renders an error Alert with a Link back to
  `/forgot-password`. Otherwise calls `authClient.resetPassword({
  newPassword, token })` and on success `router.push('/sign-in')`.
- `apps/web/src/components/screens/auth/__tests__/ForgotPasswordForm.test.tsx`
  — vitest unit. RTL render + happy path + zod validation + enumeration-safe
  panel renders even when the auth client rejects.
- `apps/web/src/components/screens/auth/__tests__/ResetPasswordForm.test.tsx`
  — vitest unit. Renders error Alert when `token` prop is null/empty;
  RTL submit happy path with mocked authClient; password-mismatch zod
  error; password-strength refine.
- `apps/web/tests/e2e/100-acceptance/password-reset.spec.ts` — long-form
  e2e. Slim-only gate. Provisions a throw-away user via the web sign-up
  UI (NOT the alice+N fixture — see Risks). Mirrors the structure of
  `apps/web/tests/e2e/100-acceptance/full-flow.spec.ts` (override
  storageState to empty, `test.skip(testInfo.project.name !== "slim",
  ...)` in `beforeEach`).

## Files to modify

- `apps/web/src/components/screens/auth/SignInForm.tsx:247-253` — replace
  the muted `<p aria-disabled="true">…</p>` (lines 251-253) with
  `<Link href="/forgot-password" className="text-sm text-primary
  underline underline-offset-4 hover:opacity-80">{t("end-user.signin.action.forgotPassword.link.label")}</Link>`.
  Update the file-header comment block at lines 12-13 to mark D-UX2 as
  REVERSED (cite Phase 55-01-a). The existing `import Link from
  "next/link"` (line 21) is already in scope.
- `apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx`
  (lines 189 + 450 — the two D-UX2 sentinel assertions per
  `.planning/deferred-items.md:73`) — flip from "assert muted text is
  present and disabled" to "assert anchor with `href=/forgot-password`
  is present and clickable".
- `apps/web/src/locales/en/end-user.json:422-426` — replace the
  `forgotPassword.link.disabled` key with `forgotPassword.link.label`
  whose value is `"Forgot password?"`. Add a sibling key
  `end-user.forgot-password.*` block (heading, subtitle, email label,
  submit label, success panel title + body) AND
  `end-user.reset-password.*` block (heading, subtitle, new-password
  label, confirm-password label, submit label, generic error body, token-missing
  error body). Mirror the existing `signin` / `signup` namespace shape.
- `apps/web/src/locales/ru/end-user.json:422-426` — same shape; Russian
  translations. Source-artifact-language rule: the JSON values are
  end-user runtime copy, NOT source artifacts, so Cyrillic literals ARE
  permitted here (see existing `/sign-in` RU copy in this file for
  precedent).
- `.planning/deferred-items.md` — delete the entire
  `### BUG-54-PRD-RESET-UI-MISSING` block (lines 18-83). Decrement the
  bug count on line 10 from `1` to `0`. Per the file's own triage
  convention (lines 6-8): "When a fix lands, delete the entry rather
  than marking it closed — git history preserves the record."

## Tasks

### Task 1 — RED: unit tests for both new forms

1. Create `__tests__/ForgotPasswordForm.test.tsx` with cases:
   (a) renders email input + submit button;
   (b) zod rejects empty email + invalid email shape;
   (c) successful auth client call → enumeration-safe panel renders;
   (d) rejected auth client call → SAME panel renders (no enumeration leak).
2. Create `__tests__/ResetPasswordForm.test.tsx` with cases:
   (a) `token=null` prop → error Alert + back-link rendered, no form;
   (b) `token="abc"` prop → form renders;
   (c) zod rejects mismatched newPassword/confirm;
   (d) zod rejects weak passwords (reuse `signUpSchema` constraints);
   (e) successful submit → `router.push('/sign-in')` invoked.
3. Run `pnpm --filter @openwhispr/web test ForgotPasswordForm ResetPasswordForm`
   → MUST fail (forms don't exist yet).
4. Commit:
   `test(55-01-a): RED — ForgotPasswordForm + ResetPasswordForm unit specs`

### Task 2 — GREEN: ship the two forms + two RSC routes + flip SignInForm + i18n

1. Create `ForgotPasswordForm.tsx` + `ResetPasswordForm.tsx` per the
   "Files to create" spec.
2. Create `(public)/forgot-password/page.tsx` + `(public)/reset-password/page.tsx`.
3. Flip `SignInForm.tsx:247-253` from `<p>` to `<Link href="/forgot-password">`.
4. Update `__tests__/SignInForm.test.tsx:189` + `:450` to assert anchor presence
   instead of muted-text presence (D-UX2 reversal).
5. Update `locales/en/end-user.json` + `locales/ru/end-user.json` per the
   "Files to modify" spec.
6. Run `pnpm --filter @openwhispr/web test` → all green. Run
   `pnpm --filter @openwhispr/web typecheck` → green.
7. Delete `BUG-54-PRD-RESET-UI-MISSING` block from
   `.planning/deferred-items.md` and decrement count.
8. Commit:
   `feat(55-01-a): GREEN — forgot/reset password web UI + reverse D-UX2`

### Task 3 — RED: long-form acceptance e2e

1. Create `apps/web/tests/e2e/100-acceptance/password-reset.spec.ts`.
   Structure mirrors `full-flow.spec.ts`:
   - Override `storageState: { cookies: [], origins: [] }`.
   - `beforeEach`: `test.skip(testInfo.project.name !== "slim", "slim only")`
     and `attachBrowserDiagnostics(page)`.
   - Single test:
     `"registers, requests password reset, follows mailpit link, sets new password, signs in successfully — zero browser errors"`.
   - Step structure (each ends with `expectNoBrowserErrors(page)`):
     - **step 1** — provision throw-away user via web sign-up UI
       (`uniq = "reset55+${Date.now()}@local.test"`).
     - **step 2** — fetch verification link from mailpit
       (`fetchVerificationLink`), open via `context.request.get` (asserts
       200/302/303), verify the user is flipped to verified.
     - **step 3** — navigate to `/sign-in`. Click `getByRole("link", {
       name: /forgot password/i })`. Assert URL is `/forgot-password`.
     - **step 4** — fill email field with `uniq`. Click submit. Assert
       enumeration-safe panel visible (heading or body text from the
       new i18n key).
     - **step 5** — capture a fresh `cursor = new Date()` BEFORE step 4
       (re-order if necessary so the mailpit poll sees only the reset
       email). Call `fetchPasswordResetLink(uniq, { since: cursor,
       timeoutMs: 15_000 })`. Assert link matches `/reset-password\?token=/`.
     - **step 6** — `await page.goto(resetLink)`. Assert form fields
       visible. Fill new password + confirm with `"NewReset55!#Pass"`.
       Click submit. Assert URL is `/sign-in`.
     - **step 7** — fill email + new password in `/sign-in` form, submit,
       assert URL ends `/app`.
   - Cyrillic-free source — use `\u` escapes if any RU strings appear
     (they shouldn't for the EN-locale spec).
2. Run `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/password-reset --project=slim`
   → MUST fail (we haven't run docker compose up yet, or the spec is
   genuinely red against an old build).
3. Commit:
   `test(55-01-a): RED — long-form password-reset e2e`

### Task 4 — GREEN + verify

1. Bring up slim stack: `make e2e-slim-up` (or whatever the project's
   slim-compose target is; consult `Makefile`).
2. Re-run the spec from Task 3. MUST pass.
3. Run `OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance --project=slim`
   to confirm no regression on `full-flow.spec.ts`.
4. Run `pnpm --filter @openwhispr/web typecheck` + `pnpm --filter @openwhispr/web test`
   → both green.
5. Run `make lint` to confirm no LOCKER violations.
6. Commit:
   `test(55-01-a): GREEN — password-reset e2e passes on slim`

## Done

Observable assertions:

```
$ ls apps/web/src/app/\(public\)/forgot-password/page.tsx apps/web/src/app/\(public\)/reset-password/page.tsx
# both files exist

$ grep -n 'href="/forgot-password"' apps/web/src/components/screens/auth/SignInForm.tsx
# returns at least one match (the new <Link>)

$ grep -c "aria-disabled" apps/web/src/components/screens/auth/SignInForm.tsx
# returns 0 — D-UX2 sentinel removed

$ grep -c "coming soon" apps/web/src/locales/en/end-user.json
# returns 0 — disabled copy removed

$ grep -c "BUG-54-PRD-RESET-UI-MISSING" .planning/deferred-items.md
# returns 0 — entry deleted

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/password-reset --project=slim
# exit code 0, "1 passed"

$ pnpm --filter @openwhispr/web test
# exit code 0, all unit specs green including the new __tests__/ pair

$ pnpm --filter @openwhispr/web typecheck
# exit code 0, no type errors

$ make lint
# exit code 0, no LOCKER violations
```

## Risks

- **D-UX2 reversal MUST cite Phase 55 audit + user sign-off.** RESEARCH
  §"Top 10 gaps" #1 + the prompt's "user has signed off" both authorize
  this. The reversal is NOT a unilateral executor decision —
  the audit + user are the chain of authority. Cite both in the
  SignInForm.tsx file-header comment block.
- **Better Auth client API surface uncertainty.** Better Auth 1.6.9
  exposes `request-password-reset` over the wire, but the typed
  `authClient.*` surface name varies by version
  (`forgetPassword` vs `requestPasswordReset` vs `forgotPassword`). The
  CJM step at `tests/e2e-cjm/steps/password-reset.steps.ts:71` POSTs raw
  JSON to `/api/auth/request-password-reset` — so the wire path is
  certain; the typed client name needs a grep against
  `node_modules/better-auth/...` or the `apps/web/src/lib/auth-client.ts`
  export. If the typed name is absent on `ExtendedAuthClient`, fall
  back to a raw `fetch('/api/auth/request-password-reset', { method:
  'POST', body: JSON.stringify({ email }) })` — Better Auth gates CSRF
  by Origin, and the web origin is trusted.
- **Mailpit `since` cursor ordering.** The acceptance spec MUST capture
  `cursor = new Date()` BEFORE submitting the forgot-password form in
  step 4 — otherwise `fetchPasswordResetLink` may race the earlier
  verification email if it scans subject-keyword-agnostic. The helper
  IS subject-agnostic per `mailpit.ts:99` (it matches by URL regex), so
  if cursor ordering is wrong the wrong link gets picked up. Confirm by
  reading `mailpit.ts:60-87` before writing the spec.
- **Throw-away user vs alice+N collision.** Use
  `reset55+${Date.now()}@local.test` — NOT alice+N. The alice+N pool
  carries cross-spec storageState (`fixtures/auth.ts:54`); flipping
  alice+N's password mid-suite would invalidate every subsequent spec's
  cookie jar.
- **i18n DOCS-09 (English-only sources).** The Russian translations are
  end-user runtime copy in a JSON values, not source artifacts.
  Precedent: existing `/sign-in` RU copy in `locales/ru/end-user.json`.
  The acceptance spec itself MUST stay ASCII-only — use `\u` escapes
  if any RU strings appear (none should — the spec runs in default EN
  locale).
- **Better Auth `originCheck` on reset URL.** Per
  `tests/e2e-cjm/steps/password-reset.steps.ts:68-70`, Better Auth 1.6.9's
  `originCheck` rejects mismatched `redirectTo`. Do NOT pass `redirectTo`
  to `authClient.forgetPassword` — let Better Auth construct the URL
  from `ctx.context.baseURL`. The reset email URL pattern is verified
  by `RESET_LINK_PATTERN` in `mailpit.ts:56`.
