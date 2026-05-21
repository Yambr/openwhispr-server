---
phase: 55-uc-coverage-audit
plan: 02-c
type: execute
wave: 3
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
requirements:
  - UC-SIGNIN-EMAIL-NOT-VERIFIED-ALERT
  - UC-SIGNIN-RESEND-VERIFICATION-CLICK
  - UC-SIGNIN-RESEND-SENT-STATE
must_haves:
  truths:
    - "Signing in with valid credentials of an UNVERIFIED user renders the data-testid='signin-unverified-alert' Alert"
    - "Inside that alert, the 'Resend verification email' button is clickable and not disabled"
    - "Clicking the resend button transitions the alert to the 'sent' copy variant; the button is removed from the DOM"
    - "A NEW verification email arrives in Mailpit addressed to the unverified user (asserted via fetchVerificationLink with a since-cursor AFTER the click)"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
      provides: Long-form e2e covering the EMAIL_NOT_VERIFIED branch end-to-end
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
      to: apps/web/src/components/screens/auth/SignInForm.tsx
      via: signIn.email → EMAIL_NOT_VERIFIED branch → resend button → sendVerificationEmail
      pattern: 'signin-unverified-alert|resendVerification'
    - from: apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
      to: Mailpit /api/v1/search
      via: fetchVerificationLink with since-cursor after the resend click
      pattern: 'fetchVerificationLink'
---

<objective>
Land a long-form acceptance e2e that:
1. Creates an UNVERIFIED user (sign-up but do NOT click the verification
   link).
2. Drives `/sign-in` with that user's credentials.
3. Asserts the `EMAIL_NOT_VERIFIED` Alert renders
   (`data-testid="signin-unverified-alert"`).
4. Clicks the "Resend verification email" button.
5. Asserts the alert transitions to the "sent" copy variant; the button
   is removed.
6. Asserts a NEW verification email lands in Mailpit (since-cursor).

`expectNoBrowserErrors` at every step.

Closes 3 MISSING UCs from RESEARCH.md §"`/sign-in`":
- **UC-SIGNIN-EMAIL-NOT-VERIFIED-ALERT** — `SignInForm.tsx:126-151`
- **UC-SIGNIN-RESEND-VERIFICATION-CLICK** — `SignInForm.tsx:152-160`
- **UC-SIGNIN-RESEND-SENT-STATE** — `SignInForm.tsx:148-150`

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts`.
Slim-only. Dedicated fixture user `alice+55c@test.local`.
</objective>

## Context

`SignInForm.tsx:93-94`:
```ts
if (result.error.code === "EMAIL_NOT_VERIFIED") {
  setState({ kind: "error-unverified", resend: "idle" });
}
```

Alert at `SignInForm.tsx:139-164`:
- `data-testid="signin-unverified-alert"` (line 143)
- Body shows `error-unverified.body.text` while `resend !== "sent"`,
  `error-unverified.sent.text` after success
- Button at line 152-161 renders only when `resend !== "sent"` —
  clicking calls `authClient.sendVerificationEmail({ email })`

This spec must NOT reuse `alice+55` (revoke-sessions fixture) because
that user IS verified (full-flow verification ran on first sign-up).
Use `alice+55c@test.local` — sign-up, then DO NOT visit the
verification link. The user stays in the `email_verified = false` state.

Mailpit cursor pattern: `fetchVerificationLink` accepts `{ since: Date,
timeoutMs }`. Use a fresh `cursor = new Date()` IMMEDIATELY before
clicking the resend button, so the helper only matches the new mail
(not the original sign-up email).

## Files to create

- `apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts`

## Files to modify

(none — surface already shipped)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create the spec. Header comment: Phase 55-02-c, slim-only, dedicated
   user, "user is provisioned but NEVER verified" justification.
2. Imports: `test, expect`, `attachBrowserDiagnostics`,
   `expectNoBrowserErrors`, `fetchVerificationLink`.
3. Constants:
   - `WEB_BASE = "http://localhost:3000"`
   - `FIXTURE_EMAIL = "alice+55c@test.local"`
   - `FIXTURE_PASSWORD = "Resend55c!#StrongTest"`
4. `test.use({ storageState: empty })`. `beforeEach` — slim-only +
   diagnostics.
5. Single test:
   `"unverified user sign-in shows resend CTA; click resends and transitions to sent state; new email arrives — zero browser errors"`.
6. Steps:
   - **step 1 — idempotent sign-up (DO NOT verify)**:
     `await page.goto("/sign-up")`. Fill name/email/password with
     fixture creds. Submit. Either success "Check your email" panel
     OR `USER_ALREADY_EXISTS` (duplicate handling from
     `revoke-sessions.spec.ts` step 1). DO NOT fetch + click the
     verification link.
     `expectNoBrowserErrors(page)`.
   - **step 2 — visit /sign-in**:
     `await page.goto("/sign-in")`. Fill email + password. Submit.
     Assert
     `await expect(page.getByTestId("signin-unverified-alert")).toBeVisible()`.
     Assert the button labelled per
     `t("end-user.signin.action.resendVerification.label")` is
     present (case-insensitive: `/resend verification|повторно отправить/i`).
     `expectNoBrowserErrors(page)`.
   - **step 3 — click resend, set since-cursor FIRST**:
     `const cursor = new Date();`
     `await page.getByRole("button", { name: /resend verification|повторно отправить/i }).click();`
     Assert the alert text transitions to the "sent" body
     (`/email sent|письмо отправлено|sent/i` against the alert region
     — pull copy keys at spec edit time, use a regex union).
     Assert the resend button is removed
     (`await expect(page.getByRole("button", { name: /resend verification/i })).toHaveCount(0)`).
     `expectNoBrowserErrors(page)`.
   - **step 4 — assert NEW email lands in Mailpit**:
     `const link = await fetchVerificationLink(FIXTURE_EMAIL, { since: cursor, timeoutMs: 15_000 });`
     Assert `expect(link).toMatch(/\/api\/auth\/verify-email\?token=/)`.
     Do NOT actually visit the link (this spec doesn't care if the
     user reaches verified — just that the resend produced a new
     email). Future Phase 55 work can extend.
7. Run on slim → MUST fail (file didn't exist).
8. Commit:
   `test(55-02-c): RED — resend-verification long-form spec`

### Task 2 — GREEN: spec passes first try

1. Verify slim stack is up; mailpit container responding at
   `http://localhost:8025/api/v1`.
2. Re-run spec. MUST pass first try (no production-code change).
3. Three consecutive runs — no flake.
4. Full acceptance suite green.
5. `pnpm typecheck` + `make lint` green.
6. Commit:
   `test(55-02-c): GREEN — resend-verification passes 3x clean on slim`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
# exists

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
# ≥ 4

$ grep -c 'signin-unverified-alert' apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
# ≥ 1

$ grep -c 'fetchVerificationLink' apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
# ≥ 1

$ grep -c 'alice+55c' apps/web/tests/e2e/100-acceptance/resend-verification.spec.ts
# ≥ 1

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/resend-verification --project=slim
# "1 passed"
```

## Risks

- **Mailpit since-cursor precision.** Mailpit timestamps mails at
  receive-time with sub-second granularity. The `since` filter in
  `fetchVerificationLink` (verified pattern from `mailpit.ts`)
  compares against the message timestamp. Setting `cursor` immediately
  BEFORE the click guarantees the new email's timestamp is strictly
  after the cursor.
- **Initial sign-up email collision.** On a FRESH spec run, sign-up
  produces an email at T0. If the test then sets `cursor` at T1 > T0
  and clicks resend, the fetched email at T2 > T1 will be the NEW
  one. On a DUPLICATE run (user already exists), sign-up returns
  USER_ALREADY_EXISTS — no email at T0 — so the resend at T2 is the
  only one matching the cursor. Both paths converge.
- **Rate limiting on sendVerificationEmail.** Better Auth ships a
  default rate limiter on this endpoint. The dev-tools overlay disables
  rate-limits per `compose/docker-compose.dev-tools.yml` (verify by
  reading the overlay before RED). If rate limiting fires (429), the
  Alert transitions to "error-generic" instead of "sent" — spec must
  fail in that case, not silently pass. The current assertion shape
  (alert body text matches "sent") naturally guards this.
- **Locale leak.** `getByRole("button", { name: ... })` uses
  case-insensitive regex union (EN+RU) as defense.
- **resend button DOM removal vs disable.** `SignInForm.tsx:152`
  renders the button only when `resend !== "sent"`. After click,
  the button is REMOVED from the DOM (not just disabled). Use
  `toHaveCount(0)`, not `toBeDisabled()`.
- **alice+55c user persistence across runs.** Like alice+55, the user
  row survives across runs. The spec MUST be idempotent — duplicate
  sign-up handled gracefully, user stays unverified (we never click
  the link). Subsequent runs go straight to sign-in.
