# Phase 63 — HIGH findings: api-routes-rest (3)

## Background

Pre-publication HIGH-backlog clearance, phase-by-phase by package
(user decision 2026-05-20). Phase 62 cleared api-core (5 HIGH). This
phase clears the **`apps/api` routes — rest** HIGH cluster — 3 findings
(`.planning/review/api-routes-rest.md`, HR-01..HR-03). All 3 are
rate-limit defects on public, unauthenticated routes.

## The 3 HIGH findings (from `.planning/review/api-routes-rest.md`)

**Re-verify each against current code before fixing** (CLAUDE.md hard
rule 3) — Phases 57/59/60 touched `auth-callback.ts` and the test-only
surface; confirm the rate-limit gap still reproduces.

### HR-01 — `/api/auth/desktop-callback/:provider` has no rate-limit
`apps/api/src/routes/auth-callback.ts:~124` — route config is
`{ auth: false }` only, no `rateLimit` budget → falls to the global
default. The handler does a UUID lookup + CAS UPDATE per request; each
successful CAS burns the legitimate `oauth_state` row → an attacker
who knows a victim is mid-flight has an exploitable race, and the
endpoint is cheaply DoS-able. Fix: add an explicit `rateLimit` budget
(the review suggests `{ max: 60, timeWindow: '1 minute' }` — confirm
against the budgets used by sibling public routes for consistency).

### HR-02 — `/api/desktop-signin/:provider` has no rate-limit, writes to DB on every call
`apps/api/src/routes/desktop-signin.ts:~97` — route config is
`{ auth: false }` only. Each request INSERTs an `oauth_state` row +
encryption sidecars + 302s to the IdP. Unauthenticated → table-bloat
write-amplification (TTL 10 min, but burst writes amplify) and
weaponising the server as a redirect-launcher. Fix: add a `rateLimit`
budget.

### HR-03 — `verification-status` rate-limit drifted from its documented contract
`apps/api/src/routes/verification-status.ts:~21,44-49` — the docstring
says "30/min keyed on (ip, email) — the desktop polls during
onboarding; busy fixtures must not DoS each other", but the actual
config is `rateLimit: { max: 30, timeWindow: "1 minute" }` with NO
`keyGenerator`. It falls back to the default IP bucket → multiple
desktops onboarding behind one corporate NAT (the exact deployment the
docstring calls out) collide and DoS each other. Fix: EITHER implement
the `(ip, email)` `keyGenerator` per the doc, OR correct the doc to
match an IP-only budget. The review leaves the choice open — decide
during planning which is the right contract (the docstring's intent —
corporate-NAT-safe onboarding — argues for implementing the
keyGenerator; but `email` in the rate-limit key has its own
considerations: it is request-body/query data, must be normalized, and
must not enable enumeration. Weigh both).

## Goal

After this phase:
1. HR-01, HR-02, HR-03 each fixed-and-verified OR confirmed
   already-resolved (with evidence).
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. Tests cover the regression-shape (a route without its budget, or a
   keyGenerator that does not partition as documented, fails the test).
4. `pnpm --filter @openwhispr/api test` green; `pnpm lint:lockers`
   green (8 lockers); `pnpm typecheck` no new errors vs the 5-error
   baseline.
5. `.planning/review/api-routes-rest.md` + `REVIEW-INDEX.md` annotated
   with per-finding closure markers.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **Verify-first** — every finding re-confirmed against current code
  before any fix.
- **LOCKER-04** — every Fastify route MUST carry `config: { rateLimit }`;
  these fixes bring HR-01/HR-02 INTO compliance. `rateLimit: false` is
  only permitted for the health/test URLs — these are real public
  routes, so they need a real budget, not `false`.
- **No mocks of internal logic** — rate-limit tests can use the
  in-process Fastify `inject` harness; DB-touching paths use real
  Postgres via testcontainers where needed.
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after every
  finding.
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1.
- **HR-03 `email` in rate-limit key** — if the keyGenerator route is
  chosen, the `email` component MUST be lower-cased/normalized and the
  key must not leak whether an email exists; do not let the rate-limit
  key become an enumeration oracle.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. HR-01..HR-03 each have a RED test + GREEN fix on main, OR a
   documented already-closed disposition.
2. `pnpm --filter @openwhispr/api test` green.
3. `pnpm lint:lockers` green (8 lockers) — LOCKER-04 now satisfied for
   the two previously-budgetless routes.
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. Spot-check: each fixed finding's regression test references its ID
   (HR-01..03).
6. `git log --oneline` shows the expected RED/GREEN commits.
7. `.planning/review/api-routes-rest.md` + `REVIEW-INDEX.md` annotated.

## Reference

- `.planning/review/api-routes-rest.md` — HR-01..HR-03 + MEDIUM/LOW
- `apps/api/src/routes/auth-callback.ts` — HR-01
- `apps/api/src/routes/desktop-signin.ts` — HR-02
- `apps/api/src/routes/verification-status.ts` — HR-03
- `apps/api/src/plugins/rate-limit.ts` — the rate-limit plugin (budget + keyGenerator API)
- Sibling public routes' `rateLimit` budgets — for consistency
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-04 (route schema + rateLimit)
- Phase 62 (api-core HIGH, just closed): `.planning/phases/62-high-findings-api-core/`
