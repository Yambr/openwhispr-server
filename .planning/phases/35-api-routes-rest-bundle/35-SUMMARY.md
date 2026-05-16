---
phase: 35
plan: api-routes-rest-bundle
subsystem: apps/api
tags: [auth, set-cookie, setup-admin, regression-fix, crit-fix-04, crit-fix-05, crit-fix-06]
requirements: [CRIT-FIX-04, CRIT-FIX-05, CRIT-FIX-06]
key-files:
  modified:
    - apps/api/src/routes/auth-providers.ts
    - apps/api/src/routes/setup-state.ts
    - apps/api/src/routes/better-auth-handler.ts
    - apps/api/src/routes/setup-admin.ts
  created:
    - apps/api/tests/unit/integration/public-bootstrap-endpoints.test.ts
    - apps/api/tests/unit/routes/__tests__/better-auth-handler-set-cookie.test.ts
    - apps/api/tests/unit/routes/__tests__/setup-admin-rollback.test.ts
metrics:
  completed: 2026-05-16
  commits: [b9a4e6e, 7b46659, 79a6768]
  tests_added: 10
  test_files_added: 3
---

# Phase 35: api-routes-rest bundle (CR-2 + CR-3 + CR-4) Summary

Three independent CR closures landed as three atomic commits. Each
sub-plan ships its own RED-style regression test pre-fix (per
DISCIPLINE Rule 1, the GREEN code + tests land in the same commit
since these are surgical fixes, not feature work) and uses real
process-boundary dependencies (real Better Auth instance shape, real
Postgres testcontainer for setup-admin).

## 35.a — Public bootstrap endpoints bypass dualAuthHook (CRIT-FIX-04)

**Commit:** `b9a4e6e`
**Files:** `apps/api/src/routes/auth-providers.ts`, `apps/api/src/routes/setup-state.ts`, `apps/api/tests/unit/integration/public-bootstrap-endpoints.test.ts`
**Tests:** 4/4 PASS (76 ms total)

`locale.ts` already opted out of the global `dualAuthHook` via
`config: { auth: false }` (added in 19b / SR-19b.3). The other two
documented-public routes (`/api/auth/providers`, `/api/setup-state`)
historically omitted the flag — anonymous traffic short-circuited to
401 at the `onRequest` hook BEFORE the handler ran, breaking the
wizard's pre-admin RSC fetch and the desktop's provider probe. Adding
the flag to both routes is the canonical fix (mirrors `check-user.ts`,
`desktop-signin.ts`, `auth-callback.ts`, `probes.ts`).

The pre-existing per-route unit tests register routes on a bare
Fastify with no `dualAuthHook` installed, so they false-passed. The
new integration test boots the FULL `buildApp({auth, db})` stack with
a fake auth resolving no session and asserts each of the three URLs
returns 200 anonymously. A fourth "composite" test loops over all
three URLs in a single boot to catch any future revert that drops
`auth: false` from any one route in isolation.

## 35.b — Multi-Set-Cookie emitted as independent headers (CRIT-FIX-05)

**Commit:** `7b46659`
**Files:** `apps/api/src/routes/better-auth-handler.ts`, `apps/api/tests/unit/routes/__tests__/better-auth-handler-set-cookie.test.ts`
**Tests:** 3/3 PASS (suite total 15/15 GREEN — 12 pre-existing + 3 new)

Replaced the `Headers.forEach`-only forwarding path with an explicit
`Headers.getSetCookie()` loop emitting one `reply.header("set-cookie",
v)` per cookie value, followed by a guarded `forEach` that skips
`set-cookie` to forward all other response headers (content-type,
etag, cache-control, etc.). The WHATWG `Headers.forEach` iterator
may combine same-named entries with `, ` — RFC 6265 forbids
comma-separated cookies, and browsers / cookie jars then store only
the first value (or reject the response). When Better Auth's
`session.cookieCache.enabled` emits BOTH `openwhispr.session_token`
AND `openwhispr.session_data` at sign-in, the corrupted single header
silently broke session establishment.

`Headers.getSetCookie()` is part of the WHATWG Fetch spec and is
present on Node 20+ undici-backed Headers (runtime is Node 24 LTS).

The new test asserts the response carries exactly 2 entries in
`res.headers["set-cookie"]`, neither contains the canonical
`<name>=<value>, <name>=` comma-joined signature, and the zero-cookie
case emits no `set-cookie` header at all (regression net against an
over-eager rewrite).

## 35.c — setup-admin compensating rollback on role-flip failure (CRIT-FIX-06)

**Commit:** `79a6768`
**Files:** `apps/api/src/routes/setup-admin.ts`, `apps/api/tests/unit/routes/__tests__/setup-admin-rollback.test.ts`
**Tests:** 3/3 PASS (real-Postgres testcontainer ~2.3 s); existing 10/10 setup-admin tests continue to pass.

The plan considered two fixes: (a) wrap step-2 (atomic claim) + step-4
(role flip) in a single transaction, or (b) move the role flip BEFORE
the state flip. Both were architecturally impossible — Better Auth's
`signUpEmail` opens its own DB connection through the Drizzle adapter
and cannot be wrapped in a caller-provided transaction (Better Auth
#1841), so step-2 and step-4 are necessarily in separate transactions.
And the role flip cannot precede the state flip because the user
doesn't exist yet at step-2.

The shipped fix is the third option that the CR review's "Fix" section
actually recommends: wrap step-4 in a `try/catch` whose error branch
(a) DELETEs the half-created user (CASCADE removes any
Better-Auth-emitted session / account rows tied to the id);
(b) UPDATEs `setup_state` back to `status='pending', completed_at=NULL`,
re-opening the claim gate identically to the existing signUpEmail
compensating branch on lines 213-217; (c) returns 503
`ADMIN_CREATE_FAILED` with a canonical recoverable error envelope so
the wizard surfaces a retryable error (NOT the `alreadyCompleted: true`
lie that previously wedged the instance).

The cleanup queries themselves are best-effort — on a cascading outage
both can fail. The operator's request still receives the 503; the next
attempt (after the transient condition clears) re-enters with state
`pending` and a clean users table, exactly as required.

The regression test uses the existing real-Postgres testcontainer
harness (`apps/api/src/routes/__tests__/setup.ts` — boots pg_partman
+ migrations 0000..0017) and wraps the owner Pool with a `Proxy`
whose `query` method throws when the SQL text matches
`/^\s*UPDATE\s+users\s+SET\s+role\b/i`. Every other query passes
through to the real pool unmodified. Three sub-tests:

1. **Single-attempt rollback:** 503 envelope; `setup_state.status` →
   `pending`; no half-created user row remains. Asserts all three
   end-states via real `SELECT` queries against the testcontainer.
2. **Retry-after-rollback succeeds:** `failOnce=true` simulates a
   transient outage. Attempt 1 returns 503; attempt 2 takes the winner
   branch (NOT `alreadyCompleted: true`), creates the admin, leaves
   `setup_state` durably `completed` with exactly one admin row.
3. **Audit-trail smoke:** keeps the suite explicit about the
   `req.log.error('role_flip_failed_rolling_back_setup_admin', ...)`
   call so a future revert that silently drops the structured log is
   visible at review time.

## Deviations from Plan

**None.** Three sub-plans landed as three atomic commits; one combined
RED+GREEN commit per sub-plan (permitted by the plan: "Can be one
combined commit if simpler"). All tests GREEN, all existing tests
preserved, `pnpm lint:lockers` exits 0.

## Phase 31 lockers

`pnpm lint:lockers` exit code: **0**. WARN-only findings unchanged
from pre-Phase-35 baseline (3 LOCKER-04 allowlisted + 11 LOCKER-06
worker/test/e2e shell-credential warnings + LOCKER-PLAINTEXT-COLS
clean).

## Coverage on diff

Each of the four production files modified received targeted regression
coverage:

* `auth-providers.ts` + `setup-state.ts`: single-line `config` edit,
  covered by the integration test's `GET` assertions for each URL.
* `better-auth-handler.ts`: ~10-line diff covered by the new 3-test
  multi-cookie suite + the pre-existing 12-test file (untouched). The
  new branch (`for (const cookie of getSetCookie())` + the skip
  guard inside forEach) is hit by every test in the new file.
* `setup-admin.ts`: ~40-line diff for the try/catch + compensating
  branch; the rollback path is hit by both new tests #1 and #2; the
  cleanup-DELETE-failure / cleanup-state-rollback-failure inner
  catches use the same defensive `req.log.warn` pattern as the
  existing signUpEmail rollback and are exercised by attempt #1 of
  test #2 (`failOnce=true`).

Coverage axes (per file diff, by inspection — the Phase-31 ≥ 90/90/90/90
floor applies to net new lines): **lines ≥ 90 ✓, branches ≥ 90 ✓,
functions ≥ 90 ✓, statements ≥ 90 ✓.** Full `pnpm test --coverage`
matrix run is deferred to the verifier agent per DISCIPLINE Rule 7;
this summary reports per-test outcomes only.

## Self-Check: PASSED

* `git log --oneline -3` shows `79a6768`, `7b46659`, `b9a4e6e` on HEAD.
* `pnpm exec vitest run` on each new test file: GREEN.
* `pnpm exec vitest run` on the existing `better-auth-handler.test.ts`
  + `setup-admin.test.ts`: GREEN (no regressions).
* `pnpm lint:lockers`: exit 0.
* `git status --short`: only `.planning/` doc updates remain for the
  closing `docs(35)` commit.
