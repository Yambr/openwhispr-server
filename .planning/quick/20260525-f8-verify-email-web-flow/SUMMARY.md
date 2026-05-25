# F8 — verify-email web-flow callback fix

**Status:** GREEN
**Closed:** 2026-05-25
**Filed by:** operator-peer `ykoolfs5` (yambr-k8s gitops, stage+prod openwhispr.yambr.com)
**Ship target:** chart 1.0.8 + image v1.0.5

## Problem

R22 (commit `2fe3be94` 2026-05-21, image v1.0.4) introduced
`GET /api/auth/verify-email-complete` to deliver the session bearer to
the Electron client through its loopback auth-bridge listener at
`127.0.0.1:5199/oauth/callback?bearer_token=...` (see
`apps/api/src/config/desktop-bridge.ts:39`).

Correct for the desktop client; broken for web users — the loopback IP
is not bound on a browser host, so the verify-email click 302'd to a
dead URL. Discovered live on `openwhispr.yambr.com` 2026-05-25 by the
operator after Resend delivered a verification email.

Root cause: `apps/api/src/lib/verification-callback-url.ts:43`
`rewriteVerificationCallbackUrl` totally replaced the Better Auth
`callbackURL` query param with the server-fixed
`/api/auth/verify-email-complete`, discarding the original — so the
route had no way to distinguish web vs desktop intent.

## Fix — preserve original callbackURL as `?origin=` state-param

Three-pronged change with backward-compat for legacy emails:

### 1. Web client signals intent (`apps/web/.../SignUpForm.tsx`)

Adds `callbackURL: "/sign-in?verified=1"` to `authClient.signUp.email`.
Desktop client sends no `callbackURL` — defaults to `/` — and stays on
the R22 desktop-bridge path.

### 2. Server preserves the original callbackURL
(`apps/api/src/lib/verification-callback-url.ts`)

`rewriteVerificationCallbackUrl` now reads the incoming `callbackURL`
BEFORE overwriting it and, when it's a non-default same-origin relative
path, appends it as `&origin=<encoded>` on the rewritten URL.

Echo policy: only single-leading-`/` non-`/` paths. Absolute URLs,
protocol-relative `//host` paths, and backslash-prefixed `/\foo` paths
are dropped — never echoed.

### 3. Server route branches on `?origin=`
(`apps/api/src/routes/verify-email-complete.ts`)

Decision tree (auth check runs first — unverified user with crafted
`?origin=` gets no free redirect):

| Case | Branch | Target |
|---|---|---|
| Explicit `origin=<relative-path>` (not `/`) | **web** | 302 to `${origin}` — cookie already in browser jar |
| Explicit `origin=/` | **desktop** | bridge with `?bearer_token=` (R22 default) |
| `origin` absent + `Sec-Fetch-Site: none` | **web (legacy fallback)** | 302 to `/sign-in?verified=1` |
| `origin` absent + Sec-Fetch-Site missing/other | **desktop** | bridge with `?bearer_token=` (R22 default) |
| Explicit `origin=<absolute-URL>` | **reject** | 400 `VERIFY_EMAIL_COMPLETE_INVALID_ORIGIN` |
| Explicit `origin=//<host>` | **reject** | 400 (protocol-relative bypass guard) |

### 4. Web success banner (`apps/web/.../SignInForm.tsx`)

Detects `?verified=1` query and renders an "Email verified" success
banner. The Better Auth session cookie is already in the browser jar
(Better Auth set it on the verify-email handler one hop ago) — the
banner is informational, prompting the user to sign in normally. We
deliberately keep them on `/sign-in` rather than auto-redirecting to
`/app` so password-entry confirms intent (defense against shared-device
credential phishing).

## Verification

- **api**: 1787/1787 tests GREEN (197 files, 0 new failures)
  - `verification-callback-url.test.ts`: 12/12 (5 new F8 cases)
  - `verify-email-complete.test.ts`: 23/23 (12 new F8 cases — origin
    branches + Sec-Fetch-Site fallback)
  - i18n completeness: 6/6 (new error code `VERIFY_EMAIL_COMPLETE_INVALID_ORIGIN`
    has en + ru translations)
- **web**: 1043/1043 tests GREEN (74 files)
  - `SignUpForm.test.tsx`: +1 F8 case asserting `callbackURL` payload
  - `SignInForm.test.tsx`: +4 F8 cases for `?verified=1` banner +
    cleanup behavior
- **lockers**: 8/8 PASS (LOCKER-03 originally flagged a `127.0.0.1`
  literal in a code comment — reworded to reference the canonical
  source file instead)
- **typecheck**: api + web both clean

## Files changed

```
apps/api/src/i18n/locales/en.json         + VERIFY_EMAIL_COMPLETE_INVALID_ORIGIN
apps/api/src/i18n/locales/ru.json         + VERIFY_EMAIL_COMPLETE_INVALID_ORIGIN
apps/api/src/lib/verification-callback-url.ts
apps/api/src/routes/verify-email-complete.ts
apps/api/tests/unit/lib/verification-callback-url.test.ts  + 5 F8 cases
apps/api/tests/unit/routes/verify-email-complete.test.ts   + 12 F8 cases
apps/web/src/components/screens/auth/SignInForm.tsx        + verified banner
apps/web/src/components/screens/auth/SignUpForm.tsx        + callbackURL
apps/web/src/components/screens/auth/__tests__/SignInForm.test.tsx  + 4 F8 cases
apps/web/src/components/screens/auth/__tests__/SignUpForm.test.tsx  + 1 F8 case
apps/web/src/locales/en/end-user.json     + signin.verified copy
apps/web/src/locales/ru/end-user.json     + signin.verified copy
charts/openwhispr-server/Chart.yaml       1.0.7 → 1.0.8; appVersion 1.0.4 → 1.0.5
charts/openwhispr-server/values.yaml      image.tag 1.0.4 → 1.0.5 + lineage note
```

## Operator notes (peer ykoolfs5)

- **Zero values changes** needed. No new env vars, no new secrets, no
  new allow-lists. Pure code fix.
- **Migration window for legacy emails**: Better Auth default
  `expiresIn` for verification tokens is 24h. Emails sent before this
  deploy will continue to land at the desktop bridge on browser clicks
  — BUT the Sec-Fetch-Site option-3 fallback catches them and routes
  to `/sign-in?verified=1` instead of the dead loopback. So legacy
  emails are handled gracefully too; the user lands signed-in.
- **Deployment**: bump `targetRevision: 1.0.7 → 1.0.8` in
  `applications/workloads/{stage,prod}-openwhispr.yaml`, force-refresh
  root app-of-apps, delete `argocd-repo-server` pod to invalidate OCI
  render cache. Test on stage: real sign-up via `/sign-up`, click verify
  email link from external browser, confirm landing on
  `https://openwhispr.stage.k.yambr.com/sign-in?verified=1` with the
  "Email verified" banner.

## Out of scope

- Better Auth `expiresIn` tuning (currently 24h default; peer raised
  the question but option-3 fallback covers the legacy window so no
  change needed)
- Server-rendered fallback HTML page (option 2 from peer's initial
  brief — superseded by the simpler relative-path 302 once we noted
  the cookie is already in jar)
- F7 / F9 / F10 (peer-filed but out of F8 mandate per user)

## Related

- R22 (commit `2fe3be94`) — sign-up→verify session bridge for desktop
- R20+R19 (commit `29528220`) — Better Auth bearer session.token sync route
