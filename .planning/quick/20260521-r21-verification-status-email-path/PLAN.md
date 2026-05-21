---
quick_id: 260521-n7q
slug: r21-verification-status-email-path
date: 2026-05-21
status: planned
---

# R21 — verification-status email-derived auth path (4A additive)

## Problem

`POST /api/auth/sign-up/email` issues no session under Better Auth 1.6.9
`requireEmailVerification: true` (vendored-source proof: `sign-up.mjs`
L160-161 `shouldSkipAutoSignIn = ... || requireEmailVerification`, L249
returns `{token:null}` before `createSession`/`setSessionCookie`). The
client's `EmailVerificationStep.tsx` polls `GET /api/auth/verification-status?email=<x>`
every 5s. That route is cookie-only (`require-cookie-only.ts` →
unconditional `AuthError("unauthorized")` → 401). No session ⇒ every
poll 401 ⇒ client shows "Session expired" permanently. The
sign-up→verify window is structurally unsatisfiable. Client is
immutable; fix is server-side only.

## Decision — 4A (additive dual-path), confirmed by client agent + advisor

`verification-status` accepts BOTH auth paths. Cookie wins.

| Case | Behavior |
|---|---|
| valid session cookie present | identity session-derived (unchanged R5/R15); `?email=` ignored, mismatch silently tolerated |
| no session + format-valid `?email=` | identity email-derived: `SELECT email_verified_at WHERE email = ?email=` under `withTenant(defaultTenantId)` → `200 {verified:<bool>}` |
| no session + no `?email=` | `200 {verified:false}` |
| unknown email | `200 {verified:false}` — byte-identical to known-unverified (anti-enumeration) |
| malformed/oversized email | `400` from Zod schema parse (input error, not poll path) |

R5/R15 cookie-only contract preserved as a strict superset — NOT reversed.

## Implementation (advisor-recommended structure (b))

1. **New helper** `apps/api/src/lib/resolve-verification-identity.ts` —
   factory `buildResolveVerificationIdentity({ auth })` returning a fn
   `(req) => Promise<{ email: string | undefined; tenant: string }>`.
   - Cookie path: `auth.api.getSession({ headers: cookieOnlyHeaders(req.headers) })`
     (reuse exported `cookieOnlyHeaders` from `require-cookie-only.ts`),
     tenant from `session.user.tenantId ?? resolveDefaultTenantId()`.
   - Email path (no session): email from validated `req.query.email`,
     tenant from `resolveDefaultTenantId()`.
2. **Route** `apps/api/src/routes/verification-status.ts` — remove
   `preHandler: requireCookieOnly` (line 80) + the `buildRequireCookieOnly`
   import/construction (40, 50); call the helper at handler top; keep
   `withTenant` SELECT, `Boolean(row && row.email_verified_at !== null)`
   collapse, and the entire `config.rateLimit` + `schema` blocks unchanged.
3. **OUT of scope, byte-identical:** `require-cookie-only.ts`,
   `delete-account.ts`. No migration.

## Antipatterns to avoid (advisor)

- ❌ Mutating `buildRequireCookieOnly` (shared with delete-account)
- ❌ `SELECT users` outside `withTenant` (RLS FORCE)
- ❌ 404 / distinct error-shape on unknown email (enumeration oracle)
- ❌ Hardcoded `00000000-...` UUID (use `resolveDefaultTenantId()`)
- ❌ `as any` / `@ts-ignore` (LOCKER-02) / `NODE_ENV` branch (LOCKER-01)
- ❌ Dropping `schema` / `config.rateLimit` (LOCKER-04)
- ❌ Mocking the new helper itself in the route test

## TDD order (RED → GREEN, same atomic commit)

1. RED unit — `resolve-verification-identity.test.ts` (colocated): cookie
   wins; no-session+email → email; no-session+no-email → undefined email.
2. RED unit — route 4A cases in `verification-status.test.ts`:
   `?email=` no cookie known-unverified → 200 `{verified:false}`;
   unknown email → 200 `{verified:false}` (identical shape); cookie wins
   over `?email=`; malformed email → 400.
3. RED integration — `verification-status` test patterned on
   `r20-bearer-session-resolution.test.ts` (testcontainers + real
   `buildAuth`): real sign-up (no session) → `verification-status?email=`
   → 200 `{verified:false}`; click verify → poll again → `{verified:true}`.
4. RED e2e — `tests/e2e/`, `E2E=1`: full window sign-up → poll →
   verify-email → poll → verified.
5. GREEN — implement helper + route. ≥90/90/90/90 on diff.

## Verification

- All lockers green (01/02/03/04, rls, colocated-tests, tdd)
- Live: sign-up (no session) → `verification-status?email=` → 200
  `{verified:false}`; after verify → `{verified:true}`; cookie path
  (verified+signed-in) still 200 — R5/R15 not regressed
- R21-closure note in client `SERVER-REQUIREMENTS.md` with the 5-case
  contract block for the client team to port into BACKEND_SPEC.md
