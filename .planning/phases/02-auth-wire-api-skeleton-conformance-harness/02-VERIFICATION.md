---
phase: 02-auth-wire-api-skeleton-conformance-harness
verified: 2026-05-09T12:00:00Z
status: gaps_found
score: 4/7 must-haves verified
overrides_applied: 0
gaps:
  - truth: "OAuth final redirect emits <scheme>://?bearer_token= echoing the exact scheme; verified against multi-channel matrix (4 schemes + reject)"
    status: failed
    reason: "mintBearer adapter NOT wired in production buildApp. buildAllRoutes passes AuthCallbackDeps with only {db: deps.db} — no mintBearer. When a real OAuth callback arrives the route returns 503 {error:'oauth callback not configured'}. The function exists and is well-tested in isolation, but the end-to-end OAuth→bearer→channel-scheme redirect path is broken in the deployed binary. The _test/force-rotate and _test/health-authed test-only routes also do not exist, so the CONTRACT-01 token-rotation contract test would fail against a live backend."
    artifacts:
      - path: apps/api/src/routes/index.ts
        issue: "buildAuthCallbackRoutes receives only {db: deps.db} — mintBearer omitted"
      - path: apps/api/src/index.ts
        issue: "buildDualAuthHook called with only {auth: opts.auth} — tryPreviousToken never passed, so overlap lookup is disabled in the live binary"
    missing:
      - "Wire mintBearer adapter into buildAllRoutes/AuthCallbackDeps so OAuth callback can mint a real bearer and emit the channel-scheme redirect"
      - "Pass tryPreviousToken (from lib/token-rotation.ts) into buildDualAuthHook in buildApp so the 5-min overlap window is active"
      - "Implement and register the /api/_test/force-rotate and /api/_test/health-authed test-only routes (NODE_ENV=test gated) that the CONTRACT-01 token-rotation.test.ts requires"

  - truth: "Token rotation overlap ≥5 min active in the deployed binary; concurrent requests using old token during rotation receive 0 401s"
    status: failed
    reason: "Two wiring gaps break AUTH-04 end-to-end: (1) tryPreviousToken is not passed to buildDualAuthHook in index.ts (the code path exists but opts.tryPreviousToken is never set — the guard 'if (bearer && tryPreviousToken)' never fires); (2) recordPreviousToken is never called on a Better Auth session rotation event (no hook wired in auth.ts). Helpers exist and are unit-tested; the SECURITY DEFINER DB function exists; but the production wiring path is absent. The 100-concurrent CONTRACT-01 test is also skip-gated (no live stack executed) and the required test-only routes are missing."
    artifacts:
      - path: apps/api/src/index.ts
        issue: "buildDualAuthHook called without tryPreviousToken — overlap lookup disabled"
      - path: apps/api/src/auth.ts
        issue: "No recordPreviousToken hook wired into Better Auth session rotation lifecycle"
    missing:
      - "Pass tryPreviousToken from lib/token-rotation.ts into buildDualAuthHook inside buildApp"
      - "Hook recordPreviousToken into Better Auth's session rotation path in auth.ts"
      - "Implement /api/_test/force-rotate and /api/_test/health-authed (NODE_ENV=test gated)"

  - truth: "CR-01 (from code review): OAuth state diagnostic mis-classifies reuse vs expiry — consumed_at checked before expires_at"
    status: failed
    reason: "Code review CR-01 identified that the diagnostic probe in auth-callback.ts checks row.consumed_at before checking expires_at. A row that is both expired AND consumed (e.g., legitimately consumed 11 minutes ago) is reported as 'already consumed' rather than 'expired'. The fix was NOT applied — the code at line 169 still checks consumed_at first. This is a correctness issue for the OAuth lifecycle error messages."
    artifacts:
      - path: apps/api/src/routes/auth-callback.ts
        issue: "Lines ~169-172: consumed_at checked before expires_at in the CAS diagnostic probe"
    missing:
      - "Reorder diagnostic: check expires_at first, then consumed_at, per code review CR-01 recommendation"
human_verification:
  - test: "Run make contract-test against a live docker compose stack"
    expected: "All 8 conformance test files pass (conventions, check-user, verification-status, delete-account, health, oauth-redirect, token-rotation, cookie-host)"
    why_human: "The contract-test suite is skip-gated (describe.skipIf probe) and was not executed end-to-end on the executor host in any plan. OAuth-redirect and token-rotation tests will likely fail due to the mintBearer and tryPreviousToken wiring gaps, but the baseline 5 endpoint tests + conventions may pass."
  - test: "Trigger a GitHub PR and verify the contract-test GHA job runs and passes"
    expected: "Job passes; branch protection blocks merge if it fails; all SHA-pinned action refs are honored"
    why_human: "Cannot verify GHA job execution or GitHub branch protection application from local codebase inspection"
  - test: "Apply branch protection via: gh api repos/{owner}/{repo}/branches/main/protection -X PUT --input scripts/branch-protection.json"
    expected: "GitHub reflects contract-test as a required check"
    why_human: "Requires repo-admin token; documented as a manual operator step in Plan 06 SUMMARY"
  - test: "Verify email verification end-to-end with SMTP configured (not the no-op stub)"
    expected: "Signing up a new user causes a verification email to be delivered to the configured SMTP relay"
    why_human: "The mailpit integration test is skip-gated; cannot verify from code inspection alone"
---

# Phase 2: Auth + Wire-API Skeleton + Conformance Harness Verification Report

**Phase Goal:** A desktop client can complete the full auth lifecycle (sign-up / sign-in / verification-poll / delete-account) against the server over any channel scheme it presents, receive opaque bearer tokens that rotate cleanly without logging the user out, and the wire-contract conformance suite (CONTRACT-01) is the canonical regression net for everything subsequent phases add.

**Verified:** 2026-05-09
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Email+password sign-in + pluggable OIDC (env-gated); ≥30-day bearer; same code path | ✓ VERIFIED | `apps/api/src/auth.ts` has `betterAuth` with `emailAndPassword.enabled`, `genericOAuth` guarded by `oidcProviders.length > 0`. `docs/oidc-operator-config.md` documents 6 IdP families. |
| 2 | OAuth final redirect emits `<scheme>://?bearer_token=` echoing exact scheme; never hardcoded; 4-scheme matrix + reject verified | ✗ FAILED | `mintBearer` adapter is NOT wired in production `buildAllRoutes` — `AuthCallbackDeps` only receives `{db}`. Real OAuth callback returns HTTP 503. The routes `/api/_test/force-rotate` and `/api/_test/health-authed` (required by contract tests) do not exist. |
| 3 | Bearer + cookie dual auth; global `{error:…}` envelope on every non-2xx; 401 not 200; HTTPS-only | ✓ VERIFIED | `middleware/dual-auth.ts` + `middleware/require-cookie-only.ts` throw `AuthError` → `setErrorHandler` → 401 envelope. `compose/traefik/traefik.yml` has `permanent: true` on web→websecure redirect. All 4 route artifacts verified and wired. |
| 4 | Token rotation overlap ≥5 min active in deployed binary; concurrent rotation requests never see 401 | ✗ FAILED | `tryPreviousToken` not passed to `buildDualAuthHook` in `index.ts`. `recordPreviousToken` not called in `auth.ts` rotation path. Helpers exist and are unit-tested; SECURITY DEFINER function exists. Production wiring absent. Test-only routes missing. |
| 5 | CONTRACT-01 runnable via `make contract-test`; required GHA check | ✓ VERIFIED (automated portion) | `Makefile` has `contract-test` target. `ci.yml` has `contract-test` job with SHA-pinned actions. `scripts/branch-protection.json` includes `contract-test`. 8 conformance test files exist and skip cleanly without a live backend. Live execution not verified (see Human Verification). |
| 6 | `/api/check-user`, `/api/auth/verification-status`, `/api/auth/delete-account`, `/api/health` all conform; `x-openwhispr-source` preserved | ✓ VERIFIED | All 4 route files exist, are substantive, and are wired via `buildAllRoutes`. Schemas imported from `@openwhispr/contract-tests/schemas`. `request-log.ts` tags `req.log` with `openwhisprSource`. Unit tests: 154 passing. |
| 7 | SMTP wired for verification; tests written first; CI green | ✓ VERIFIED | `apps/api/src/email.ts` has `makeEmailService` with nodemailer + dev-fallback. `auth.ts` wires `sendVerificationEmail` through the email service. 7 email unit tests pass. Mailpit integration test skip-gated (human verification needed for live execution). |

**Score:** 4/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/auth.ts` | Better Auth instance + buildAuth factory | ✓ VERIFIED | Contains `betterAuth`, `drizzleAdapter`, bearer plugin, OIDC env-gated |
| `packages/data/migrations/0001_better_auth.sql` | Better Auth tables + sessions/users extensions + SECURITY DEFINER | ✓ VERIFIED | Contains `FORCE ROW LEVEL SECURITY`, `lookup_session_by_previous_token` (via `FORCE  ROW LEVEL SECURITY` formatting) |
| `packages/data/migrations/0002_oauth_state.sql` | oauth_state table with RLS | ✓ VERIFIED | Contains `CREATE TABLE` equivalent + `FORCE  ROW LEVEL SECURITY` + `oauth_state_tenant_isolation` policy |
| `apps/api/src/lib/scheme-allowlist.ts` | validateScheme + buildProtocolRedirect | ✓ VERIFIED | Contains `validateScheme` |
| `apps/api/src/lib/cookie-domain.ts` | cookieDomainConfig + findSharedParentDomain | ✓ VERIFIED | Contains `cookieDomainConfig` |
| `apps/api/src/lib/token-rotation.ts` | hashToken + recordPreviousToken + tryPreviousToken | ✓ VERIFIED (file) | File contains `previous_token_hash`. Helpers exist but not wired into production path. |
| `packages/contract-tests/src/schemas.ts` | Single zod source of truth | ✓ VERIFIED | Contains `ErrorEnvelope` + all Phase 2 wire schemas |
| `apps/api/src/error-handler.ts` | Centralized setErrorHandler | ✓ VERIFIED | Contains `setErrorHandler` |
| `apps/api/src/middleware/dual-auth.ts` | Bearer-then-cookie hook | ✓ VERIFIED | Contains `dualAuthHook`/`buildDualAuthHook` |
| `apps/api/src/routes/check-user.ts` | POST /api/check-user handler | ✓ VERIFIED | Contains `/api/check-user` |
| `apps/api/src/routes/index.ts` | allRoutes/buildAllRoutes barrel | ✓ VERIFIED | Contains `buildAllRoutes` |
| `apps/api/src/routes/desktop-signin.ts` | GET /api/desktop-signin/{provider} shim | ✓ VERIFIED | Contains `validateScheme` |
| `apps/api/src/routes/auth-callback.ts` | Post-Better-Auth callback → channel-scheme redirect | ⚠️ HOLLOW | Contains `buildProtocolRedirect` but `mintBearer` never injected in production; route returns 503 |
| `apps/api/src/email.ts` | EmailService + makeEmailService factory | ✓ VERIFIED | Contains `makeEmailService` |
| `apps/api/src/plugins/rate-limit.ts` | Rate-limit plugin with envelope-conformant 429 | ✓ VERIFIED | Contains `errorResponseBuilder` |
| `apps/api/Dockerfile` | Multi-stage node:24-alpine + non-root | ✓ VERIFIED | Contains `FROM node:24-alpine` |
| `apps/api/entrypoint.sh` | Secrets check + signal forwarding exec | ✓ VERIFIED | Contains `exec "$@"` |
| `docker-compose.yml` | api + migrate + mailpit services | ✓ VERIFIED | Contains `service_completed_successfully` |
| `packages/contract-tests/src/conventions.test.ts` | Cross-cutting envelope + 401-not-200 + HTTPS-only | ✓ VERIFIED | Contains `ErrorEnvelope` |
| `packages/contract-tests/src/oauth-redirect.test.ts` | Multi-channel scheme matrix | ✓ VERIFIED | Contains `openwhispr-staging` |
| `packages/contract-tests/src/token-rotation.test.ts` | 100-concurrent rotation overlap test | ⚠️ HOLLOW | Contains `Promise.all` but depends on `/api/_test/force-rotate` route which does not exist |
| `Makefile` | make contract-test target | ✓ VERIFIED | Contains `contract-test:` |
| `.github/workflows/ci.yml` | contract-test GHA job | ✓ VERIFIED | Contains `contract-test` job |
| `docs/auth.md` | Operator auth documentation | ✓ VERIFIED | Contains `BETTER_AUTH_SECRET`, `OIDC` |
| `docs/oidc-operator-config.md` | Per-IdP config walkthroughs | ✓ VERIFIED | Contains `OIDC_ISSUER_URL` |
| `docs/channel-scheme-override.md` | Channel scheme allow-list rules | ✓ VERIFIED | Contains `OPENWHISPR_PROTOCOL` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `apps/api/src/routes/index.ts` → allRoutes | 4 route plugins + 2 OAuth routes | `buildAllRoutes(deps)` | ✓ WIRED | All 6 routes registered |
| `apps/api/src/routes/*.ts` | `packages/contract-tests/src/schemas.ts` | `import { CheckUserRequest, ... }` | ✓ WIRED | Confirmed via grep in check-user.ts |
| `apps/api/src/middleware/dual-auth.ts` | `apps/api/src/auth.ts` | `auth.api.getSession` | ✓ WIRED | Confirmed |
| `apps/api/src/index.ts` buildApp | `apps/api/src/lib/token-rotation.ts tryPreviousToken` | `buildDualAuthHook({auth, tryPreviousToken})` | ✗ NOT_WIRED | `buildDualAuthHook({auth: opts.auth})` — tryPreviousToken never passed |
| `apps/api/src/auth.ts` | `apps/api/src/lib/token-rotation.ts recordPreviousToken` | Better Auth rotation hook | ✗ NOT_WIRED | No rotation hook wired in auth.ts |
| `apps/api/src/routes/auth-callback.ts` | `mintBearer` adapter | `buildAuthCallbackRoutes(deps)` | ✗ NOT_WIRED | `AuthCallbackDeps = {db: deps.db}` — no mintBearer |
| `apps/api/src/auth.ts` | `apps/api/src/email.ts` | `sendVerificationEmail = email.send(...)` | ✓ WIRED | Confirmed |
| `apps/api/src/index.ts` | `apps/api/src/plugins/rate-limit.ts` | `app.register(rateLimitPlugin)` | ✓ WIRED | Confirmed |
| `.github/workflows/ci.yml contract-test job` | `docker-compose.yml` | `docker compose --profile default up -d --wait` | ✓ WIRED | Confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `routes/check-user.ts` | `exists` boolean | `users` table SELECT via `withTenant(db, tenantId, ...)` | Yes — real DB query | ✓ FLOWING |
| `routes/verification-status.ts` | `verified` boolean | `users.email_verified_at` SELECT via `withTenant` | Yes — real DB query | ✓ FLOWING |
| `routes/auth-callback.ts` | `bearer` (channel-scheme echo) | `mintBearer` adapter (injected) | No — mintBearer never injected in production | ✗ HOLLOW_PROP |
| `middleware/dual-auth.ts` | `req.tenant` (overlap path) | `tryPreviousToken(bearer)` → DB | No — tryPreviousToken never injected in production | ✗ HOLLOW_PROP |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `exec "$@"` in entrypoint.sh | `grep 'exec "\$@"' apps/api/entrypoint.sh` | Match found | ✓ PASS |
| `service_completed_successfully` in compose | `grep "service_completed_successfully" docker-compose.yml` | Match found | ✓ PASS |
| HTTPS redirect in Traefik config | `grep "permanent\|redirect" compose/traefik/traefik.yml` | Match found | ✓ PASS |
| ErrorEnvelope in schemas | `grep "ErrorEnvelope" packages/contract-tests/src/schemas.ts` | Match found | ✓ PASS |
| contract-test in GHA | `grep "contract-test" .github/workflows/ci.yml` | Match found | ✓ PASS |
| mintBearer wired in buildAllRoutes | `grep "mintBearer" apps/api/src/routes/index.ts` | No match | ✗ FAIL |
| tryPreviousToken passed in buildApp | `grep "tryPreviousToken" apps/api/src/index.ts` | No match | ✗ FAIL |
| Test-only routes /api/_test/* | `grep -r "force-rotate\|health-authed" apps/api/src/routes/` | No match | ✗ FAIL |
| CR-01 fix applied (expires_at first) | `sed -n '160,175p' apps/api/src/routes/auth-callback.ts` | consumed_at checked before expires_at | ✗ FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| WIRE-01 | 02-03 | POST /api/check-user | ✓ SATISFIED | Route exists, wired, tested |
| WIRE-02 | 02-03 | GET /api/auth/verification-status | ✓ SATISFIED | Route exists, wired, tested |
| WIRE-03 | 02-03 | DELETE /api/auth/delete-account | ✓ SATISFIED | Route exists, wired, tested |
| WIRE-04 | 02-03 | GET /api/health | ✓ SATISFIED | Route exists, wired, tested |
| WIRE-17 | 02-03 | Global `{error:…}` envelope | ✓ SATISFIED | Centralized setErrorHandler; ErrorEnvelope.strict() |
| WIRE-18 | 02-03 | 401 not 200 on auth failures | ✓ SATISFIED | throw-based error path; structurally impossible to 200-with-error |
| WIRE-19 | 02-03/04 | x-openwhispr-source preserved in logs | ✓ SATISFIED | request-log.ts tags req.log.child with openwhisprSource |
| WIRE-20 | 02-04 | HTTPS-only; HTTP → 308 redirect | ✓ SATISFIED | traefik.yml has permanent:true redirect; self-test passes |
| AUTH-01 | 02-01/03 | Email+password sign-in with ≥30-day bearer | ✓ SATISFIED | Better Auth wired; emailAndPassword.enabled; 30-day session config |
| AUTH-02 | 02-05 | OAuth final redirect with channel-scheme echo | ✗ BLOCKED | mintBearer not wired in production; auth-callback returns 503 |
| AUTH-03 | 02-01/03 | Opaque bearer ≥30 days + dual auth | ✓ SATISFIED | dual-auth middleware; Better Auth bearer plugin; cookie+bearer both work |
| AUTH-04 | 02-05 | Token rotation overlap ≥5 min | ✗ BLOCKED | tryPreviousToken not wired in buildApp; recordPreviousToken not hooked |
| AUTH-05 | 02-01 | OIDC pluggable (env-gated) | ✓ SATISFIED | genericOAuth conditionally registered when OIDC_ISSUER_URL set |
| AUTH-06 | 02-03/04 | x-openwhispr-source in structured logs | ✓ SATISFIED | request-log plugin + openwhispr-source-log.test.ts passes |
| AUTH-07 | 02-05 | Cookie host scoping (eTLD+1 for split-host) | ✓ SATISFIED | cookieDomainConfig wired in auth.ts; cookie-host contract test exists |
| PROVIDER-03 | 02-07 | Identity provider documentation | ✓ SATISFIED | docs/oidc-operator-config.md with 6 IdP walkthroughs |
| PROVIDER-04 | 02-04 | SMTP for verification + admin notifications | ✓ SATISFIED | nodemailer transport + dev fallback; sendVerificationEmail wired |
| CONTRACT-01 | 02-06 | Conformance suite as required GHA check | ✓ SATISFIED (conditionally) | 8 test files; Makefile target; GHA job; skip-gated; not live-executed |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/api/src/routes/auth-callback.ts` | ~169 | `consumed_at` checked before `expires_at` in CAS diagnostic (CR-01 from code review) | ⚠️ Warning | OAuth state error messages are incorrect for rows that are both expired AND consumed |
| `apps/api/src/middleware/dual-auth.ts` | ~112 | `session.user.tenantId ?? (await resolveDefaultTenantId())` — silent fallback to default tenant (WR-03 from code review) | ⚠️ Warning | Cross-tenant exposure risk when multi-tenancy lands; for v1 single-tenant this is intentional but creates a future landmine |
| `apps/api/scripts/check-default-secrets.test.ts` | 17 | `join(process.cwd(), "apps", "api", ...)` — breaks when vitest runs from package directory | ⚠️ Warning | 4 pre-existing test failures tracked across Plans 01-07 but never fixed |
| `apps/api/src/__tests__/email-mailpit.test.ts` | ~69-76 | `process.env` mutation in beforeAll without restoration in afterAll (WR-04 from code review) | ℹ️ Info | Potential test isolation issue; not fixed after code review |

### Human Verification Required

#### 1. Full contract-test live execution

**Test:** Run `make contract-test` against a live compose stack (or the commands from the Makefile target directly)
**Expected:** All 8 conformance test files pass. NOTE: with current wiring gaps (mintBearer + tryPreviousToken), `oauth-redirect.test.ts` and `token-rotation.test.ts` will likely fail. The baseline 5 endpoint tests + conventions test may pass.
**Why human:** Suite is skip-gated via top-level-await probe; executor host had no live docker stack; multi-minute image build + suite execution required.

#### 2. GitHub Actions contract-test job

**Test:** Open a PR and observe the `contract-test` GHA job execution
**Expected:** Job runs after lint/typecheck/test jobs pass; contract-test job is a required check blocking merge
**Why human:** Cannot verify GHA job execution from local codebase inspection.

#### 3. Branch protection application

**Test:** Run `gh api repos/{owner}/{repo}/branches/main/protection -X PUT --input scripts/branch-protection.json`
**Expected:** GitHub branch protection reflects `contract-test` as a required check; Phase 0 self-test passes
**Why human:** Requires repo-admin credentials; documented as an explicit manual operator step.

#### 4. Email verification end-to-end

**Test:** Configure SMTP_HOST (real or mailpit dev profile) and sign up a new user
**Expected:** Verification email received; user can verify account; verification-status returns `{verified:true}` after clicking the link
**Why human:** mailpit integration test skip-gated; SMTP configuration required.

### Gaps Summary

Two functional gaps block the phase goal:

**Gap 1 — OAuth channel-scheme echo broken in production (AUTH-02, SC#2)**

The `auth-callback.ts` route accepts an injectable `mintBearer` adapter for the final OAuth→bearer→channel-scheme redirect step. The adapter is NOT wired: `buildAllRoutes` passes `AuthCallbackDeps = {db: deps.db}` with no `mintBearer`. In production, any real OAuth callback returns HTTP 503 `{error:"oauth callback not configured"}`. The channel-scheme redirect (the desktop's only return path from OAuth) never fires. All 4 scheme variants and the reject path are tested in isolation but cannot function end-to-end.

Additionally, the `/api/_test/force-rotate` and `/api/_test/health-authed` test-only routes do not exist. The `contract-tests/src/token-rotation.test.ts` file references these routes and will fail against a live backend.

**Gap 2 — Token rotation overlap not active in production binary (AUTH-04, SC#4)**

The overlap machinery (SECURITY DEFINER function, schema columns, helper functions) is correctly implemented at the DB and library layer. But the production wiring is absent: (a) `buildDualAuthHook({auth: opts.auth})` does not receive `tryPreviousToken`, so the CAS-lookup path is never invoked at request time; (b) `recordPreviousToken` is never called when Better Auth rotates a session token (no rotation hook in `auth.ts`). Concurrent requests using an old bearer during rotation will receive 401s, violating SC#4.

**Gap 3 — Code review CR-01 not applied**

The `auth-callback.ts` CAS diagnostic probe checks `consumed_at` before `expires_at`. A row that is both expired and consumed (common after 10-minute TTL) is mis-reported as "already consumed" rather than "expired". The code review identified this; the fix was not applied.

These gaps share a root cause: Plan 05 explicitly deferred the end-to-end wiring (mintBearer, rotation hook, test-only routes) to Plan 06. Plan 06's SUMMARY notes the live execution was also deferred to CI. The code-review findings were not tracked for closure.

---

_Verified: 2026-05-09T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
