---
slug: r22-verify-email-session
date: 2026-05-21
status: planned
branch: fix/r22-verify-email-session
---

# R22 — sign-up→verify must leave the user with a working session

## Problem

After a real sign-up→verify the Electron client lands in the app with
NO session: no cookie, no bearer, `GET /api/auth/get-session` → `null`,
every cloud call → "Not authenticated". Under `requireEmailVerification`
Better Auth 1.6.9 `sign-up/email` issues no session, and
`GET /api/auth/verify-email` (plain token, no `updateTo`) creates a
session ONLY if `emailVerification.autoSignInAfterVerification` is set
(vendored proof: `email-verification.mjs:265-279`). Our `auth.ts` does
not set it. Even if it did, the `Set-Cookie` lands in the *browser's*
jar (the user opens the link), not the Electron client's.

## Decision — Option C (advisor + client-agent confirmed)

Deliver the session through the client's EXISTING auth-bridge. Client
`main.js`: listener on `127.0.0.1:5199/oauth/callback`, accepts
`?bearer_token=` / `?token=`, calls `applySessionTokenAndRefresh`. Same
channel OAuth sign-in already uses.

Rejected — Option A (Set-Cookie on `verification-status`): that route is
`auth: false`, reachable with bare `?email=`; minting a session there is
an **account-takeover oracle** — anyone knowing a verified user's email
gets their 30-day session. No caller-secret to bind to. Rejected.
Option B (token in body): client reads only `data.verified`. Non-functional.

In Option C the session mint is gated INSIDE Better Auth's `verify-email`
handler, which already proves possession of the one-time verification
token — the mint is bound to "this subject just verified their email".

## Implementation

Precedent: `apps/api/src/routes/auth-callback.ts` already proves Better
Auth 1.6.9 has NO per-request redirect-rewrite hook — the OAuth flow
ships a SEPARATE Fastify route that mints the bearer and 302-redirects
to the client channel. R22 follows the same pattern.

1. **`auth.ts`** — set `emailVerification.autoSignInAfterVerification: true`
   so `verify-email` creates a Better Auth session on success.
2. **verify-email `callbackURL`** — Better Auth's `sendVerificationEmail`
   hook builds `url = ${baseURL}/verify-email?token=...`. The link must
   carry a `callbackURL` pointing at a NEW server route (the bearer does
   not exist at email-send time, so it cannot be embedded statically).
   Set `callbackURL` to the new route below.
3. **NEW route** `GET /api/auth/verify-email-complete` (or reuse the
   pattern of `auth-callback.ts`): hit by the post-verify 302. At this
   point the user IS verified and Better Auth has set a session cookie
   on THIS request (the browser that opened the link). The route reads
   that session, extracts the raw `session.token`, and 302-redirects to
   `http://127.0.0.1:5199/oauth/callback?bearer_token=<urlencoded token>`.
   `config: { auth: false }` (Better Auth's cookie is the proof), the
   redirect target is a SERVER-FIXED literal (loopback, not an
   attacker-controlled `callbackURL` — no open-redirect).
4. The bearer is the raw Better Auth session token — resolves through
   the SAME dual-auth path as `sign-in/email` (R20 fingerprint lens).
   No second session kind.
5. OUT of scope, unchanged: `verification-status.ts` (stays a pure
   boolean read), `require-cookie-only.ts`, `delete-account.ts`.

## Antipatterns to avoid

- ❌ Minting a session in `verification-status` (account-takeover oracle)
- ❌ Redirect target derived from a client-supplied `callbackURL` param
- ❌ `as any` / `@ts-ignore` (LOCKER-02), hardcoded UUID (LOCKER-03)
- ❌ Route without `schema` + `config.rateLimit` (LOCKER-04)
- ❌ A second session mechanism — must be the Better Auth session

## TDD order (RED → GREEN, real surface — R21 lesson)

1. RED integration — boot `buildApp` (real surface, all global hooks) +
   real `buildAuth` + testcontainers Postgres: real sign-up → real
   `GET /api/auth/verify-email?token=...&callbackURL=<complete-route>`
   → assert the final 302 `Location` is `http://127.0.0.1:5199/oauth/
   callback?bearer_token=<token>` → extract the token → `getSession`
   with that bearer returns the verified user.
2. RED e2e — `tests/e2e/`, real stack: sign-up → token from real
   Mailpit email → follow verify-email → follow the 302 to the complete
   route → assert loopback redirect with a working bearer → use the
   bearer on `/api/usage` → 200.
3. GREEN — implement steps 1-4. ≥90% coverage on the diff.

## Verification

- Server e2e green: the full circle yields a working bearer.
- Live curl: sign-up → verify-email → the 302 chain ends at
  `127.0.0.1:5199/oauth/callback?bearer_token=...`; that bearer resolves
  on `/api/usage` → 200.
- Report the EXACT final `Location` URL to the client agent.
- Final R22 closure is the client agent's live UI run (the
  bridge-reload vs polling race is only observable in real Electron).
