---
phase: 63-high-findings-api-routes-rest
plan: 01
subsystem: apps/api routes (rest)
tags: [security, rate-limit, HIGH-findings, LOCKER-04, TDD]
requires: []
provides: ["HR-01 closed", "HR-02 closed", "HR-03 closed"]
affects:
  - apps/api/src/routes/auth-callback.ts
  - apps/api/src/routes/desktop-signin.ts
  - apps/api/src/routes/verification-status.ts
tech-stack:
  added: []
  patterns: ["per-route config.rateLimit budget", "(ip,sha256(email)) composite rate-limit keyGenerator"]
key-files:
  created:
    - .planning/phases/63-high-findings-api-routes-rest/verify-first.log
  modified:
    - apps/api/src/routes/auth-callback.ts
    - apps/api/src/routes/desktop-signin.ts
    - apps/api/src/routes/verification-status.ts
    - apps/api/tests/unit/routes/auth-callback.test.ts
    - apps/api/tests/unit/routes/desktop-signin.test.ts
    - apps/api/tests/unit/routes/verification-status.test.ts
    - apps/api/tests/unit/__tests__/rate-limit-verification-status.test.ts
    - .planning/review/api-routes-rest.md
    - .planning/review/REVIEW-INDEX.md
decisions:
  - "HR-03: implement the (ip,email) keyGenerator per D-RL2; doc-downgrade rejected."
metrics:
  completed: 2026-05-20
---

# Phase 63 Plan 01: HIGH findings — api-routes-rest Summary

Cleared the three HIGH rate-limit findings (HR-01..HR-03) on the public
`apps/api` rest routes via strict RED→GREEN TDD: added explicit
`config.rateLimit` budgets to `desktop-callback` and `desktop-signin`, and
implemented the documented `(ip, sha256(lower(email)))` keyGenerator on
`verification-status`.

## Verify-first determination

All three findings re-confirmed **STILL LIVE** against `main` HEAD before
any fix — exactly matching the planner's pre-determination. No divergence.
Evidence recorded in `verify-first.log` (committed `2a0a00e4`).

## HR-01 — desktop-callback rate-limit budget

- **Verify-first:** STILL LIVE — `grep "rateLimit" auth-callback.ts` → no match;
  route at `:124` carried `{ config: { auth: false } }` only.
- **Budget added:** `config.rateLimit: { max: 60, timeWindow: "1 minute" }`
  — matches the sibling public auth-flow cluster (auth-providers.ts,
  locale.ts). Unauthenticated route → @fastify/rate-limit default
  keyGenerator degrades to `ip:<req.ip>`, the correct abuse axis. Caps the
  OAuth-state-burning CAS race + DoS burst; 600/min GLOBAL_IP_CEILING
  still applies on top.
- **RED+GREEN:** combined atomic commit `83a6bc63`. RED = config-shape
  assertion (`config.rateLimit` is a `{max:60,timeWindow}` object via
  `onRoute` capture) + behavioural 60-then-429 burst test.

## HR-02 — desktop-signin rate-limit budget

- **Verify-first:** STILL LIVE — `grep "rateLimit" desktop-signin.ts` → no match;
  route at `:97` carried `{ config: { auth: false } }` only.
- **Budget added:** `config.rateLimit: { max: 60, timeWindow: "1 minute" }`
  — same rationale/value as HR-01. Caps the `oauth_state` INSERT write-
  amplification + redirect-launcher abuse.
- **INSERT-count regression assertion:** HELD — the burst test asserts
  exactly 60 `INSERT INTO oauth_state` queries recorded after 60 allowed
  + 1 blocked request, proving the over-budget request is rejected by the
  limiter BEFORE the handler runs.
- **RED+GREEN:** combined atomic commit `d9e454fb`. RED = config-shape
  assertion + 60-then-429 burst + INSERT-count ≤ 60.

## HR-03 — verification-status (ip,email) keyGenerator

- **Verify-first:** STILL LIVE — `grep "keyGenerator" verification-status.ts`
  → no match; `config.rateLimit` at `:48-51` had `max:30`+`timeWindow`
  only, while the docstring claimed `(ip, email)` keying. The existing
  `rate-limit-verification-status.test.ts` exercised a SYNTHETIC inline
  route and never registered the real plugin, so the production drift was
  invisible to it.
- **Fix-shape decision:** implement the `(ip, email)` keyGenerator —
  **doc-downgrade REJECTED**. Rationale: the docstring's corporate-NAT-
  safe onboarding intent is a real first-class self-host topology;
  `config/rate-limits.ts` already encodes `verificationStatus` as
  `keying:"composite-ip-email"` (D-RL2) and expects the route to attach
  the keyGenerator — a doc-downgrade would also have to downgrade the
  locked D-RL2 matrix entry.
- **Key shape implemented:**
  `${req.ip}:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0,16)}`.
  Absent / empty `?email=` degrades to an ip-only key `${req.ip}:_`
  (fixed sentinel slot, never throws). The email is normalized
  (trim + lowercase) then SHA-256-hashed before entering the key — no
  plaintext PII in `owrl:`-namespaced Valkey key dumps or traces. The
  keyGenerator does NO DB access, so it cannot become an email-existence
  enumeration oracle. The docstring was updated to match.
- **RED+GREEN:** combined atomic commit `c903c62f`. RED targets the REAL
  `buildVerificationStatusRoutes` plugin (not the synthetic route):
  config-shape assertion (`keyGenerator` is a function), two-emails-from-
  one-IP-separate-buckets, case-normalization regression guard, and
  absent-`?email=` ip-only-degradation.

## LOCKER-04 outcome

Both previously-budgetless routes (`auth-callback.ts`, `desktop-signin.ts`)
now carry a `config.rateLimit` with a REAL budget (not `rateLimit:false`),
satisfying the LOCKER-04 obligation. `verification-status.ts` already had
`config.rateLimit`; HR-03 strengthened it with the keyGenerator.

## Verification results

- `pnpm --filter @openwhispr/api test` — **1433 passed | 2 skipped**, 0
  failing (1425 baseline + 2 HR-01 + 2 HR-02 + 4 HR-03 new tests).
- `pnpm lint:lockers` — green (exit 0; only pre-existing allowlisted WARNs:
  lint-no-hardcode 49, lint-prod-readiness 338, lint-shell-credential 11;
  lint-no-plaintext-secret-columns PASSED).
- `pnpm typecheck` — 5 errors, identical to the documented 5-error
  baseline (3 in `routes/index.ts`, 1 in `tokens/assemblyai.ts`, 1 in
  `tokens/deepgram.ts`) — **0 new errors**; none in any file modified by
  this plan.

## Deviations from Plan

None — plan executed exactly as written. One operational note: the
`verify-first.log` file is matched by the repo `.gitignore` `*.log` rule;
it was force-added (`git add -f`), consistent with the Phase 62
`verify-first.log` precedent.

## Review artifact closure markers

- `.planning/review/api-routes-rest.md` — per-finding `**Status:** CLOSED
  2026-05-20 — Phase 63, commit <sha>` markers appended under HR-01
  (`83a6bc63`), HR-02 (`d9e454fb`), HR-03 (`c903c62f`).
- `.planning/review/REVIEW-INDEX.md` — `api-routes-rest` table row HIGH
  column updated to `3 → 0 (✅ Phase 63)`; the `api-routes-rest (3)` HIGH
  summary line annotated with the three closure SHAs + the HR-03
  doc-downgrade-rejected note.

## Commits

- `2a0a00e4` docs(63-01): verify-first — HR-01..HR-03 disposition log
- `83a6bc63` fix(63-01): add 60/min rateLimit to desktop-callback (HR-01)
- `d9e454fb` fix(63-01): add 60/min rateLimit to desktop-signin (HR-02)
- `c903c62f` fix(63-01): add (ip,email) keyGenerator to verification-status (HR-03)
- `e5ece072` docs(63-01): annotate api-routes-rest review with HR-01..HR-03 closure

## Self-Check: PASSED

- verify-first.log exists and is tracked (committed `2a0a00e4`).
- All 5 commit SHAs are on HEAD (`git log --oneline`).
- `grep "rateLimit"` → 2 matches each in auth-callback.ts / desktop-signin.ts.
- `grep "keyGenerator"` → 3 matches in verification-status.ts.
- Review artifacts carry the closure markers.
- `git status --short` clean for all plan-owned files.
