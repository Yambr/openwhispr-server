---
slug: r22-verify-email-session
date: 2026-05-21
status: complete
commit: 55c04499
branch: fix/r22-verify-email-session
---

# R22 — sign-up→verify session delivery — SUMMARY

## Outcome

After a real sign-up→verify the desktop client now receives a working
session. Better Auth's `verify-email` creates a session
(`autoSignInAfterVerification: true`); a new server route
`/api/auth/verify-email-complete` reads it and 302-redirects the raw
session token to the client's existing auth-bridge
(`127.0.0.1:5199/oauth/callback?bearer_token=`).

## Decision — Option C (advisor + client-agent confirmed)

Rejected Option A (Set-Cookie on `verification-status`): that route is
`auth: false` + `?email=`-reachable — minting a session there is an
account-takeover oracle. Option C binds the mint to possession of the
one-time verification token (proven inside Better Auth's verify-email
handler) and delivers via the client's existing OAuth-style bridge.

## Commit

`55c04499` on `fix/r22-verify-email-session`, atomic.

## Changes

- `auth.ts` — `autoSignInAfterVerification: true` + `sendVerificationEmail`
  hook rewrites the link `callbackURL`.
- NEW `lib/verification-callback-url.ts`, `config/desktop-bridge.ts`,
  `routes/verify-email-complete.ts`.
- `middleware/dual-auth.ts` — `SessionResult.session` widened with the
  optional raw `token`.
- `verification-status.ts`, `require-cookie-only.ts`, `delete-account.ts`
  — untouched. No DB migration.

## Redirect chain

1. `GET /api/auth/verify-email?token=<jwt>&callbackURL=%2Fapi%2Fauth%2Fverify-email-complete`
   → 302 `Location: /api/auth/verify-email-complete` (Better Auth sets a
   session cookie on this response).
2. `GET /api/auth/verify-email-complete` (with that cookie)
   → 302 `Location: http://127.0.0.1:5199/oauth/callback?bearer_token=<token>`.
3. The client's auth-bridge consumes the bearer.

## Verification

- 23 new tests green (route/callback-url/desktop-bridge units +
  integration on real `buildApp`). R21 + dual-auth/auth-callback/
  verification-status (50 tests) still green.
- LOCKER-02/03/04 + colocated-tests + no-env-branches clean for the diff.
- Final R22 closure: client agent's live Electron UI run (the
  bridge-reload-vs-polling race is only observable in the real client).
