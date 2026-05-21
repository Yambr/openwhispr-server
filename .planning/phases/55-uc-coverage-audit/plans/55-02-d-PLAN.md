---
phase: 55-uc-coverage-audit
plan: 02-d
type: execute
wave: 3
depends_on: []
files_modified:
  - apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
requirements:
  - UC-SIGNIN-REMEMBER-DEVICE-CHECKED
  - UC-SIGNIN-REMEMBER-DEVICE-UNCHECKED
must_haves:
  truths:
    - "When 'Remember this device' is CHECKED at sign-in, the signIn.email request payload contains rememberMe: true"
    - "When 'Remember this device' is UNCHECKED, the payload contains rememberMe: false (RHF default)"
    - "Checked path: the session cookie persists across context close + reopen (Better Auth long-lived session)"
    - "Unchecked path: the session cookie has Session lifetime (no Max-Age) — closes-with-browser semantics"
    - "Every step emits zero browser console errors"
  artifacts:
    - path: apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
      provides: Long-form e2e asserting rememberMe payload + cookie lifetime split
  key_links:
    - from: apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
      to: apps/web/src/components/screens/auth/SignInForm.tsx
      via: rememberDevice form field → signIn.email rememberMe arg
      pattern: 'rememberDevice|rememberMe'
    - from: apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
      to: Better Auth signIn.email server route
      via: Network request intercept via page.waitForRequest
      pattern: '/api/auth/sign-in/email'
---

<objective>
Land a long-form acceptance e2e that:
1. Signs in with `rememberDevice = false` (default), captures the
   request payload, asserts `rememberMe: false`. Then asserts the
   resulting session cookie has Session lifetime (no Max-Age).
2. Signs out, signs in AGAIN with `rememberDevice = true`. Captures
   payload, asserts `rememberMe: true`. Asserts the resulting cookie
   has a persistent Max-Age (Better Auth long-lived TTL, typically
   30 days).
3. `expectNoBrowserErrors` at every step.

Closes 2 MISSING UCs from RESEARCH.md §"`/sign-in`":
- **UC-SIGNIN-REMEMBER-DEVICE-CHECKED** —
  `SignInForm.tsx:241-258 + 88` `rememberMe` payload never asserted
- **UC-SIGNIN-REMEMBER-DEVICE-UNCHECKED** — same surface, default branch

Output: a single spec at
`apps/web/tests/e2e/100-acceptance/remember-device.spec.ts`. Slim-only.
Dedicated fixture user `alice+55d@test.local`.
</objective>

## Context

`SignInForm.tsx:74-91` passes `rememberMe: values.rememberDevice` to
`authClient.signIn.email`. Better Auth maps this to a cookie Max-Age
swap server-side (Better Auth's default behavior — verified by reading
their docs; in their config the `expiresIn` differs per flag).

`SignInForm.tsx:241-259` renders the checkbox with
`aria-label={t("end-user.signin.action.rememberDevice.label")}`.
RHF default is `rememberDevice: false` (line 70).

Test mechanics:
- Use `page.waitForRequest('/api/auth/sign-in/email')` to capture the
  request right after submit. Read `.postDataJSON()` to assert the
  body shape.
- For cookie-lifetime assertion, use `await page.context().cookies()`
  after sign-in. Better Auth's cookie is named `openwhispr.session_token`
  (verified pattern from `u5-account.spec.ts:36` and from
  `revoke-sessions.spec.ts` constants). Compare `cookie.expires`:
    - rememberMe=false → `expires === -1` (Session cookie)
    - rememberMe=true → `expires` is a finite future timestamp

This spec must NOT reuse `alice+55*` from sibling plans because (a)
each plan provisions its own user and (b) the spec signs in twice
in sequence, requires a clean unverified→verified state machine.
Use `alice+55d@test.local`.

## Files to create

- `apps/web/tests/e2e/100-acceptance/remember-device.spec.ts`

## Files to modify

(none — surface already shipped)

## Tasks

### Task 1 — RED: ship a failing acceptance spec

1. Create the spec. Header comment: Phase 55-02-d, slim-only, dedicated
   user, "two sign-in cycles with rememberMe split" justification.
2. Imports: `test, expect`, `attachBrowserDiagnostics`,
   `expectNoBrowserErrors`, `fetchVerificationLink`.
3. Constants:
   - `WEB_BASE = "http://localhost:3000"`
   - `API_BASE = "http://localhost:4000"`
   - `FIXTURE_EMAIL = "alice+55d@test.local"`
   - `FIXTURE_PASSWORD = "Remember55d!#StrongTest"`
   - `SIGNIN_URL_FRAGMENT = "/api/auth/sign-in/email"`
   - `SESSION_COOKIE_NAME = "openwhispr.session_token"`
4. `test.use({ storageState: empty })`. `beforeEach` — slim-only +
   diagnostics.
5. Single test:
   `"rememberDevice unchecked → rememberMe:false + Session cookie; checked → rememberMe:true + Max-Age cookie — zero browser errors"`.
6. Steps:
   - **step 1 — provision alice+55d idempotently** (sign-up + verify
     via Mailpit + visit verification link). Mirror full-flow.spec.ts:61-114.
     Sign-out at the end (`/api/auth/sign-out`).
   - **step 2 — sign-in #1 with rememberDevice UNCHECKED**:
     `await page.goto("/sign-in")`. Fill email + password.
     DO NOT click the rememberDevice checkbox (default false).
     Pre-arm `const signInReq = page.waitForRequest(req => req.url().includes(SIGNIN_URL_FRAGMENT) && req.method() === "POST");`
     Click submit.
     `const req = await signInReq;`
     `expect(req.postDataJSON()).toMatchObject({ rememberMe: false });`
     Wait for navigation to `/app`. Assert the session cookie:
     ```ts
     const cookies = await page.context().cookies();
     const session = cookies.find(c => c.name === SESSION_COOKIE_NAME);
     expect(session).toBeDefined();
     expect(session.expires).toBe(-1); // Session cookie
     ```
     `expectNoBrowserErrors(page)`.
   - **step 3 — sign-out**:
     Mirror `full-flow.spec.ts:217-228` — click sign-out button (NOT
     direct API call). Assert redirect to `/sign-in`.
     `expectNoBrowserErrors(page)`.
   - **step 4 — sign-in #2 with rememberDevice CHECKED**:
     `await page.goto("/sign-in")` (or already there from sign-out).
     Fill email + password.
     `await page.getByLabel(/remember this device|запомнить это устройство/i).check();`
     OR via getByRole: `getByRole("checkbox", { name: /remember/i }).check()`.
     Verify check state: `await expect(checkbox).toBeChecked();`.
     Pre-arm `signInReq` again with a fresh waiter.
     Submit. `req = await signInReq;`
     `expect(req.postDataJSON()).toMatchObject({ rememberMe: true });`
     Wait for `/app`. Assert cookie:
     ```ts
     const session = (await page.context().cookies()).find(c => c.name === SESSION_COOKIE_NAME);
     expect(session.expires).toBeGreaterThan(Date.now() / 1000); // Max-Age in seconds-since-epoch
     // Expect at least 24h ahead (Better Auth default rememberMe is 30d)
     expect(session.expires).toBeGreaterThan(Date.now() / 1000 + 86400);
     ```
     `expectNoBrowserErrors(page)`.
7. Run on slim → MUST fail (file didn't exist).
8. Commit:
   `test(55-02-d): RED — remember-device long-form spec`

### Task 2 — GREEN: spec passes first try (no production change)

1. Verify slim stack up. Bring up if not (operator's standard).
2. Re-run spec. MUST pass first try.
3. **If `rememberMe` payload assertion FAILS** — surface as
   BUG-55-02-d-PAYLOAD-DRIFT to `.planning/deferred-items.md`,
   investigate root cause (does `SignInForm.tsx` actually forward
   the field? does Better Auth client rename the prop in transit?).
   This is the bug-catching value of the spec — the existing surface
   has never been exercised end-to-end with payload assertion.
4. **If cookie-lifetime assertion FAILS** — same: file BUG-55-02-d-
   COOKIE-DRIFT, investigate Better Auth's `expiresIn` config vs
   `rememberExpiresIn` in `apps/api/src/auth.ts`.
5. Three consecutive runs of the new spec — no flake.
6. Full acceptance suite green.
7. `pnpm typecheck` + `make lint` green.
8. Commit:
   `test(55-02-d): GREEN — remember-device payload + cookie lifetime asserted`

## Done

```
$ ls apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
# exists

$ grep -c 'rememberMe' apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
# ≥ 2 (false and true assertions)

$ grep -c 'postDataJSON' apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
# ≥ 2

$ grep -c 'session.expires' apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
# ≥ 2

$ grep -c 'expectNoBrowserErrors' apps/web/tests/e2e/100-acceptance/remember-device.spec.ts
# ≥ 4

$ OPENWHISPR_TOPOLOGY=slim pnpm --filter @openwhispr/web exec playwright test 100-acceptance/remember-device --project=slim
# "1 passed"
```

## Risks

- **Better Auth payload-shape drift.** The Better Auth typed client
  might rename `rememberMe` → `remember` or coerce to a query param.
  If so, the request-intercept assertion catches it cleanly. This is
  THE bug-catching surface of this plan.
- **Cookie-name drift.** `openwhispr.session_token` is the project's
  branded cookie name (verified at multiple call sites). If Better
  Auth config changes the name, the cookie lookup returns undefined
  and the spec fails. Surface as BUG, do not paper over with a fuzzy
  `find(c => c.name.endsWith("session_token"))` — exact match enforces
  the contract.
- **rememberMe default expiry.** Better Auth's default
  `rememberExpiresIn` is 30 days (~2,592,000 s) when remember is on.
  The "≥ 1 day ahead" assertion is intentionally loose to survive a
  future config tweak (project could set this to 7 days). If a project
  config changes it to <1 day, the assertion fails — that's correct
  behavior; update the assertion when the config changes.
- **`waitForRequest` racing the form submit.** Pre-arm the waiter
  BEFORE the click — same pattern as Playwright docs. The `await`
  comes AFTER the click. This is verified in `full-flow.spec.ts` and
  `password-reset.spec.ts` patterns.
- **Cookie SameSite flag.** `page.context().cookies()` returns ALL
  cookies for the context, including the `__Host-` prefixed ones from
  some Better Auth configs. Filter by name only; don't assert flags.
- **Two cookie writes between steps.** Step 2 sign-in writes one
  cookie; step 3 sign-out clears it (verify with a cookie-empty
  assertion after sign-out if useful); step 4 sign-in writes a fresh
  cookie. Don't carry state across steps via the cookie array — read
  it fresh each time.
- **alice+55d shares Mailpit with sibling specs.** Mailpit catch-all
  serves the entire suite. fetchVerificationLink filters by `To:`
  address — alice+55d is unique to this plan, no collision.
