# F8 — verify-email web-flow callback

**Filed by**: operator-peer `ykoolfs5` (yambr-k8s gitops, stage+prod openwhispr.yambr.com)
**Discovered**: 2026-05-25 on chart 1.0.7 in prod — Resend delivered verification email,
user clicked link from web browser, server 302'd to `http://127.0.0.1:5199/oauth/callback?bearer_token=...`
which is the Electron loopback bridge (mute for browser users).

## Root cause

R22 (commit `2fe3be94` 2026-05-21) introduced `GET /api/auth/verify-email-complete` to
deliver session bearer to the Electron client through its loopback bridge listener. The
route 302s to `apps/api/src/config/desktop-bridge.ts:39` literal
`http://127.0.0.1:5199/oauth/callback?bearer_token=...`. This is correct for desktop
sign-up but wrong for web sign-up — there's no detection mechanism.

`apps/api/src/lib/verification-callback-url.ts:43` `rewriteVerificationCallbackUrl`
totally replaces the Better Auth `callbackURL` query param with the relative
`/api/auth/verify-email-complete`, discarding the original.

Symptom: web user can sign up but can never verify email — verify click goes to
loopback :5199 which isn't bound on the browser host.

## Design — preserve original callbackURL as state-param

### Web client change

`apps/web/src/components/screens/auth/SignUpForm.tsx:88` `authClient.signUp.email(...)`
gains explicit `callbackURL: "/sign-in?verified=1"` — relative path the web app
already serves. Desktop client (which doesn't set `callbackURL`) keeps default `"/"`.

### Server rewrite — preserve original callbackURL

`rewriteVerificationCallbackUrl(url)` reads the incoming `callbackURL` param BEFORE
overwriting it. When the original is non-empty AND non-default (not `"/"` and not
absent), encode it and append as `&origin=<encoded>` to the rewritten URL.

Default desktop case (`callbackURL` absent OR `/`): no `origin` param appended,
preserving the existing behavior end-to-end (backward-compat).

### Server complete route — branch on `origin`

`GET /api/auth/verify-email-complete?origin=<encoded>` decision tree:

| `origin` value | Branch | Target |
|---|---|---|
| absent | **desktop** | `http://127.0.0.1:5199/oauth/callback?bearer_token=<token>` (current R22 behavior) |
| `"/"` | **desktop** | same as absent (Better Auth default) |
| relative path (starts with `/`, not `"/"`) | **web** | `${origin}${origin.includes("?") ? "&" : "?"}bearer_token=<token>` |
| absolute URL (`http://`, `https://`, any scheme://) | **reject** | 400 with canonical error envelope |

Relative-only acceptance is the open-redirect guard. Absolute URLs cannot reach this
branch — the only way `origin` lands here is the rewrite hook, which only emits values
read from Better Auth's `callbackURL`, which Better Auth's `originCheck` middleware
admits only as relative paths (`allowRelativePaths: true`) when no allow-list match.

### Web-side token intake

When 302 hits `/sign-in?verified=1&bearer_token=<token>`, the existing SignInForm or
a new client-side hook reads `?bearer_token=` from URL, calls `authClient.signIn` to
seat the cookie, then strips the param from URL via `router.replace`.

**Option A** (simpler): a new `/api/locale`-style relative route `/auth/verified` that
takes `?bearer_token=`, calls `authClient.session.set()` server-side, redirects to
`/sign-in?verified=1` with the cookie set. Adds a route, but isolates the bearer-to-
cookie conversion. **Chosen** — clean separation of concerns + no SignInForm changes.

Server emits `302 → /sign-in?verified=1&bearer_token=<token>` (web path); the web
`/sign-in` page detects `?bearer_token=` via a useEffect and calls a thin client
helper to swap to cookie + clean URL.

Actually rethinking: easier to add the param-detect to existing
`apps/web/src/components/screens/auth/SignInForm.tsx` — it already runs on
`/sign-in`. Add a useEffect at mount that reads `?bearer_token`, if present:
1. POST it to `/api/auth/bearer-to-cookie` (new tiny route that takes the bearer,
   validates, calls `setSessionCookie`, returns 204 + cookie header)
2. On success: `router.replace('/app')`

OR even simpler: the bearer IS the Better Auth session token. The web client can
include `Authorization: Bearer <token>` on its next fetch — Better Auth's
dualAuthHook accepts it. So the page can just immediately fetch `/api/me` (or
similar) with the bearer, and the cookie gets seated as a side effect through the
dualAuthHook session resolution... no, that's not right, dualAuthHook doesn't write
cookies.

Cleanest: ship `POST /api/auth/bearer-to-cookie` server route — takes `{bearer}` in
body, validates via Better Auth `auth.api.getSession({headers: {authorization: ...}})`,
on success calls `auth.api.setSession(...)` to set cookie, returns 204. The web
sign-in page polls for `?bearer_token=` and exchanges it.

### Verification

Add F8 cases to two existing test files:

1. `apps/api/tests/unit/lib/verification-callback-url.test.ts`:
   - it("preserves original callbackURL as &origin= when set explicitly")
   - it("does not add origin when callbackURL is the default '/'")
   - it("does not add origin when callbackURL is absent")
   - it("URL-encodes origin to survive nested query strings")

2. `apps/api/tests/unit/routes/verify-email-complete.test.ts`:
   - it("origin=relative-path → 302 to web path with ?bearer_token=")
   - it("origin=/ → desktop bridge (backward-compat)")
   - it("origin absent → desktop bridge (backward-compat)")
   - it("origin=absolute-url → 400 reject (open-redirect guard)")
   - it("origin=relative-with-existing-query → appends &bearer_token=")
   - it("origin=protocol-relative //attacker → 400 reject")

3. Web tests at `apps/web/.../__tests__/SignUpForm.test.tsx`:
   - assert `callbackURL: "/sign-in?verified=1"` is in signUp.email call args

4. New web test for SignInForm bearer-token-detection hook (if added) OR the
   new bearer-to-cookie route.

## Out of scope

- `POST /api/auth/bearer-to-cookie` route — punt to F9 if not strictly required.
  For F8 minimum: the 302 to web path delivers the bearer in URL; SignInForm can
  log the user in via `signIn.email` with the bearer as a magic-link-style token,
  OR simply display "Email verified — please sign in" and let the user enter
  password again. The latter is safer (avoid putting raw session token in URL
  history; redirect through a one-shot exchange).

Decision: **F8 scope** — server-side fix only (rewrite + route branch).
Web-side token intake = SignInForm detects `?verified=1` (no token in URL),
shows success banner, asks user to sign in. The token is NOT exposed in
the URL — instead, we omit `bearer_token` for the web branch and let the
user log in normally (their email is now verified, sign-in succeeds without
EMAIL_NOT_VERIFIED).

**Simpler final design (F8 minimum)**:

| `origin` value | Branch | Target |
|---|---|---|
| absent OR `/` | **desktop** | bridge with `?bearer_token=` (R22) |
| relative path != `/` | **web** | `${origin}` ALONE — no bearer_token in URL |
| absolute URL or `//...` | **reject** | 400 |

The user clicks email link → server verifies → 302 to `/sign-in?verified=1` →
SignInForm shows success banner → user signs in (password is in their head;
email no longer blocks). Better Auth session is created via the auto-sign-in
that already happened (cookie was set on the verify-email handler hop) — but
this only landed in the BROWSER jar. So actually the user IS already signed in.

Re-checking: R22 comment says `Better Auth's setSessionCookie lands the cookie
in the BROWSER's jar (the user opened the link), never in the Electron client.`
That means for web sign-up, the cookie IS in the browser jar after the 302.
So the web user, after landing on `/sign-in?verified=1`, ALREADY has the session
cookie. The SignInForm just needs to detect this and redirect to `/app`.

**Simplest F8 fix**:

| `origin` value | Branch | Target |
|---|---|---|
| absent OR `/` | **desktop** | bridge with `?bearer_token=` (R22) |
| relative path != `/` | **web** | 302 to `${origin}` — cookie is already in jar |
| absolute URL or `//...` | **reject** | 400 |

SignInForm has a "verified=1" detector that shows success toast + auto-redirects to
`/app` after 1s (session cookie is already seated).

## Implementation order

1. **RED** — add F8 test cases to both test files (web-flow expectation)
2. **GREEN** — extend `rewriteVerificationCallbackUrl` with origin-preservation
3. **GREEN** — extend `verify-email-complete` route with origin-branching
4. **GREEN** — web SignUpForm: add `callbackURL: "/sign-in?verified=1"` to signUp call
5. **GREEN** — web SignInForm: detect `?verified=1` query, show success state, auto-redirect
6. **Lockers verify** — `pnpm lint:lockers` green (8 lockers)
7. **Typecheck** — no new TS errors vs 5-baseline
8. **Commit + chart bump + image release** — bump server-chart to 1.0.8, image to v1.0.5

## Safety checklist

- [ ] No env override needed (corporate operator unchanged)
- [ ] `origin` is server-fixed-relative (open-redirect safe)
- [ ] Backward-compat: legacy emails without `origin` query still 302 to desktop bridge
- [ ] No new secrets needed
- [ ] LOCKER-03 (no-hardcode) — desktop-bridge literal allowlist unchanged
- [ ] LOCKER-04 — `verify-email-complete` schema + rateLimit preserved
- [ ] CLAUDE.md hard rule 1 — server code changes are the genuine fix path (R22 already shipped wrong)
