---
quick_id: 260521-n7q
slug: r21-verification-status-email-path
date: 2026-05-21
status: complete
commit: 562d4713,92937f63,83d91acc
---

# R21 — verification-status email-derived auth path — SUMMARY

## Outcome

`GET /api/auth/verification-status` now satisfies the full real
sign-up→verify journey. A just-signed-up user with no session polls
`?email=<x>` → `200 {verified:false}`; after clicking the verify-email
link → `200 {verified:true}`. The client's `EmailVerificationStep` poll
loop is unblocked. Cookie path (R5/R15) preserved as a strict superset.

R21 had THREE layers, each surfaced only by live verification (green
tests missed all three because each test modeled a slice of the path):

1. **`562d4713`** — 4A additive: route accepts email-derived identity.
2. **`92937f63`** — route must `config: { auth: false }` to opt out of
   the GLOBAL `dualAuthHook` (`onRequest`, `index.ts:531`), which 401'd
   sessionless requests before the handler ran. The route-level
   preHandler removal alone was insufficient.
3. **`83d91acc`** — column mismatch: the route read `email_verified_at`
   (timestamp, written ONLY by the seed path); Better Auth's
   verify-email flips `email_verified` (boolean). Route now reads
   `email_verified`. Integration + e2e tests rewritten to drive the
   REAL Better Auth verify-email flow (no manual `UPDATE`).

## Commits (all on `fix/r20-bearer-session-resolution`)

- `562d4713` — `fix(R21): verification-status accepts email-derived auth path (4A additive)`
- `92937f63` — `fix(R21): opt verification-status out of global dualAuthHook`
- `83d91acc` — `fix(R21): verification-status reads email_verified, not email_verified_at`

## Live verification (full circle, rebuilt stack on :4000)

sign-up → 200; poll ×3 pre-verify → `{verified:false}` (never 401);
real `GET /api/auth/verify-email` → 302; poll ×3 post-verify →
`{verified:true}`.

## Changes

- NEW `apps/api/src/lib/resolve-verification-identity.ts` — helper
  factory `buildResolveVerificationIdentity({ auth })`.
- MODIFIED `apps/api/src/routes/verification-status.ts` — removed the
  unconditional cookie-only `preHandler`; calls the helper inline.
- NEW tests: colocated helper unit test, route 4A unit cases,
  integration test (testcontainers + real `buildAuth`), e2e test
  (`tests/e2e/`, `E2E=1`).
- `require-cookie-only.ts` + `delete-account.ts` — byte-identical,
  untouched. No DB migration.

## Verification

- 4 test files, 36 tests passed (re-run, exit 0).
- Diff coverage 100/100/100/100.
- `require-cookie-only.ts` / `delete-account.ts` confirmed unchanged via
  `git diff --stat`.
- LOCKER-01/02/03/04 + colocated-tests + tdd + english + biome clean
  for the diff.

## Notes / pre-existing (not caused by R21)

- 5 pre-existing `tsc --noEmit` errors on the branch (`routes/index.ts`,
  `tokens/{assemblyai,deepgram}.ts`) — confirmed via `git stash`
  baseline; zero new tsc errors from R21.
- `lint:lockers-allowlist-diff` exit 1 — pre-existing drift in
  `test-only.ts` (not touched by R21).
- Live verification requires `docker compose up -d --build api worker` —
  the running `:4000` image predates this commit.
