---
phase: 02-auth-wire-api-skeleton-conformance-harness
reviewed: 2026-05-09T00:00:00Z
depth: standard
files_reviewed: 56
files_reviewed_list:
  - apps/api/Dockerfile
  - apps/api/entrypoint.sh
  - apps/api/src/__tests__/email-mailpit.test.ts
  - apps/api/src/__tests__/openwhispr-source-log.test.ts
  - apps/api/src/__tests__/rate-limit-check-user.test.ts
  - apps/api/src/__tests__/rate-limit-health-exempt.test.ts
  - apps/api/src/__tests__/rate-limit-verification-status.test.ts
  - apps/api/src/auth.test.ts
  - apps/api/src/auth.ts
  - apps/api/src/email.test.ts
  - apps/api/src/email.ts
  - apps/api/src/error-handler.test.ts
  - apps/api/src/error-handler.ts
  - apps/api/src/errors.ts
  - apps/api/src/lib/cookie-domain.test.ts
  - apps/api/src/lib/cookie-domain.ts
  - apps/api/src/lib/default-tenant.ts
  - apps/api/src/lib/pkce.test.ts
  - apps/api/src/lib/pkce.ts
  - apps/api/src/lib/scheme-allowlist.test.ts
  - apps/api/src/lib/scheme-allowlist.ts
  - apps/api/src/lib/token-rotation.test.ts
  - apps/api/src/lib/token-rotation.ts
  - apps/api/src/middleware/dual-auth.test.ts
  - apps/api/src/middleware/dual-auth.ts
  - apps/api/src/middleware/require-cookie-only.test.ts
  - apps/api/src/middleware/require-cookie-only.ts
  - apps/api/src/plugins/rate-limit.ts
  - apps/api/src/plugins/request-log.ts
  - apps/api/src/plugins/zod-type-provider.ts
  - apps/api/src/routes/auth-callback.test.ts
  - apps/api/src/routes/auth-callback.ts
  - apps/api/src/routes/check-user.test.ts
  - apps/api/src/routes/check-user.ts
  - apps/api/src/routes/delete-account.test.ts
  - apps/api/src/routes/delete-account.ts
  - apps/api/src/routes/desktop-signin.test.ts
  - apps/api/src/routes/desktop-signin.ts
  - apps/api/src/routes/health.test.ts
  - apps/api/src/routes/health.ts
  - apps/api/src/routes/index.ts
  - apps/api/src/routes/verification-status.test.ts
  - apps/api/src/routes/verification-status.ts
  - apps/api/tsup.config.ts
  - packages/contract-tests/src/check-user.test.ts
  - packages/contract-tests/src/conventions.test.ts
  - packages/contract-tests/src/cookie-host.test.ts
  - packages/contract-tests/src/delete-account.test.ts
  - packages/contract-tests/src/env.ts
  - packages/contract-tests/src/health.test.ts
  - packages/contract-tests/src/helpers/cookie-jar.ts
  - packages/contract-tests/src/helpers/http.ts
  - packages/contract-tests/src/helpers/sign-in-fixture.ts
  - packages/contract-tests/src/helpers/streaming.ts
  - packages/contract-tests/src/oauth-redirect.test.ts
  - packages/contract-tests/src/schemas.ts
  - packages/contract-tests/src/token-rotation.test.ts
  - packages/contract-tests/src/verification-status.test.ts
  - packages/data/migrations/0001_better_auth.sql
  - packages/data/migrations/0002_oauth_state.sql
  - packages/data/src/__tests__/0001_better_auth.test.ts
  - packages/data/src/__tests__/0002_oauth_state.test.ts
  - packages/data/src/__tests__/token-rotation-overlap.test.ts
  - packages/data/src/schema/accounts.ts
  - packages/data/src/schema/oauth_state.ts
  - packages/data/src/schema/verifications.ts
  - packages/data/src/seed/conformance.ts
  - packages/data/tsup.config.ts
  - tests/fixtures/idp/Dockerfile
  - tests/fixtures/idp/server.mjs
  - tests/self-tests/_helpers.ts
  - tests/self-tests/api-container-healthy.test.ts
  - tests/self-tests/api-entrypoint-default-secrets.test.ts
  - tests/self-tests/migrate-gates-api.test.ts
  - tests/self-tests/traefik-https-only.test.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-05-09
**Depth:** standard
**Files Reviewed:** 56 (source) + 14 test files
**Status:** issues_found

## Summary

Phase 2 ships the auth wire surface: Better Auth factory, dual-auth + cookie-only preHandlers, OAuth shim with PKCE, rate-limit plugin, centralized error envelope, channel-scheme allow-list, AUTH-04 token-rotation overlap, plus the contract-test harness and docker fixture IdP. Code quality is generally high: layered defenses are well-commented, security boundaries (RLS, FORCE RLS, SECURITY DEFINER + REVOKE pattern, cookie-only contract, schemes deny-list, PKCE) are clearly intentional, and the test surface is thorough.

Findings are concentrated in two areas: **(1)** the OAuth state CAS in `auth-callback.ts` has a real correctness bug — the diagnostic probe can mis-classify a reused state — and **(2)** several spots have subtle robustness gaps (regex-based `protocol=` extraction, `audit_log.payload` JSON binding, mailpit test mutating `process.env` without restore, OIDC discovery URL construction) that could bite in edge cases. None of the warnings are exploitable in v1's default single-tenant configuration, but the OAuth diagnostic bug should be fixed before Plan 06 wires the real backend round-trip.

## Critical Issues

### CR-01: OAuth state CAS diagnostic mis-classifies reuse vs expiry

**File:** `apps/api/src/routes/auth-callback.ts:146-172`
**Issue:** The CAS UPDATE marks `consumed_at = now()` only when not-yet-consumed AND not-expired. When the CAS misses, the diagnostic probe reads the row to decide whether to emit `"state already consumed"` or `"state expired"`. The order checks `consumed_at` first — but a single state row can be both expired AND consumed (e.g., a row consumed legitimately 11 minutes ago: `expires_at < now()` AND `consumed_at IS NOT NULL`). It will be reported as `"already consumed"` when in fact the more useful diagnostic is `"expired"`. This matters because:

1. The desktop client (and operators reading logs) cannot distinguish replay-attack attempts (consumed-then-reused) from harmless tab-switch latency (expired). For a security-sensitive single-use OAuth state row, the FIRST consumption is the load-bearing event; reuse after that is a replay signal that should produce a distinct envelope.
2. More importantly, if CAS races (two callbacks land within microseconds), the LOSING request reads the row AFTER it was just consumed and returns `"already consumed"` rather than mapping to the cleaner generic-failure 400. Currently this is benign, but if a future plan tries to distinguish replay attempts from races based on this envelope, it will be incorrect.

**Fix:** Check `expires_at` first, since it is the more authoritative time-based signal, and add a comment that distinguishes replay-attack from race-loser. Alternatively, fold consumed-or-expired into a single neutral envelope to reduce signal leakage:

```ts
if (probe.rows.length === 0) return { kind: "missing" as const };
const row = probe.rows[0];
if (!row) return { kind: "missing" as const };
// Time-based check first: if the row is past its TTL, that's the
// authoritative reason regardless of whether someone also tried to
// consume it. Avoids ambiguity for rows that are both expired AND
// (legitimately or attacker-)consumed.
if (new Date(row.expires_at).getTime() <= Date.now()) {
  return { kind: "expired" as const };
}
if (row.consumed_at) {
  return { kind: "consumed" as const };
}
return { kind: "expired" as const }; // shouldn't reach here, but fail-closed
```

Or merge the two error kinds into a single `"invalid state"` envelope to reduce information disclosure (recommended for the replay-attack threat model).

## Warnings

### WR-01: `audit_log.payload` JSON binding is implicit and fragile

**File:** `apps/api/src/routes/delete-account.ts:67-70`
**Issue:** The `INSERT INTO audit_log (... payload) VALUES (..., ${{ email: req.user?.email ?? null }})` passes a raw JS object to Drizzle's `sql` template. Drizzle forwards it to `pg` as a parameter; `pg`'s `prepareValue` JSON-stringifies plain objects, which works IF `payload` is a `jsonb` column. There is no explicit cast (`::jsonb`) and no schema reference here, so a future column-type change (e.g., `text` for an audit-table refactor) will silently produce `[object Object]` literals.

**Fix:** Add an explicit cast or use a parameter helper:

```ts
import { sql } from "drizzle-orm";

await tx.execute(
  sql`INSERT INTO audit_log (tenant_id, actor_user_id, action, payload)
      VALUES (${tenantId}, ${userId}, 'account_deleted',
              ${JSON.stringify({ email: req.user?.email ?? null })}::jsonb)`,
);
```

The explicit `::jsonb` cast also ensures the test fixture and prod database agree on type even if `payload` is migrated.

### WR-02: `extractEmbeddedProtocol` regex matches inside path segment as well as query

**File:** `apps/api/src/routes/desktop-signin.ts:67-75`
**Issue:** The regex `/[?&]protocol=([^&]+)/` extracts the first occurrence of `protocol=` after a `?` or `&` anywhere in the string. If the desktop sends `callbackURL=https://attacker.com/?protocol=evil&legit=...`, the function returns `evil`. However, `validateScheme` then runs and rejects anything not on the allowlist, so this is currently safe. The bug is that the function ALSO will pull a `protocol=` from a fragment or path segment that happens to start with `?protocol=`. More importantly, if the desktop legitimately encodes `callbackURL=https://example.com/cb?protocol=openwhispr&user=foo`, the function returns `openwhispr` — but if the URL has multiple query strings (rare, malformed), the first match wins, which may not be the intended `protocol`.

**Fix:** Parse the callback as a URL and read the query parameter explicitly:

```ts
function extractEmbeddedProtocol(rawCb: string): string | undefined {
  try {
    const u = new URL(rawCb);
    return u.searchParams.get("protocol") ?? undefined;
  } catch {
    // Not a parseable URL — fall back to the regex for malformed inputs
    // the desktop's older versions emit.
    const m = /[?&]protocol=([^&#]+)/.exec(rawCb);
    if (!m || !m[1]) return undefined;
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
}
```

Note also the original regex's character class `[^&]+` does not stop at `#` (URL fragment), so `?protocol=foo#bar` returns `foo#bar`. `[^&#]+` is more correct.

### WR-03: `dual-auth.ts` falls back to default tenant on any session without `tenantId`

**File:** `apps/api/src/middleware/dual-auth.ts:111-113`
**Issue:** `req.tenant = session.user.tenantId ?? (await resolveDefaultTenantId());` silently routes any user with a `null`/`undefined` `tenantId` to the seeded default tenant. In v1 single-tenant mode this is intentional (D-08), but the moment Phase 5/6 introduces multi-tenant signup, ANY user row that fails to populate `tenantId` (due to a Better Auth default mismatch, a half-applied migration, or a buggy account-link path) will be silently bound to the default tenant — every query in `withTenant(req.tenant, ...)` then targets the default tenant's rows. This is a cross-tenant data exposure waiting to be uncovered when multi-tenancy lands.

**Fix:** Even in v1, fail closed when `tenantId` is missing rather than silently fallback. The default-tenant fallback belongs in the sign-up/account-link path (where the row is being created), not in a runtime auth hook:

```ts
if (session) {
  req.user = session.user;
  if (!session.user.tenantId) {
    req.log.error({ userId: session.user.id }, "session has no tenantId");
    throw new AuthError("invalid session");
  }
  req.tenant = session.user.tenantId;
  return;
}
```

If pre-Phase-5 users don't yet have `tenantId` populated, fix the seeding in `signUp`/account-link rather than papering over it here. Same comment applies to `require-cookie-only.ts:39`.

### WR-04: mailpit integration test mutates `process.env` without restoration

**File:** `apps/api/src/__tests__/email-mailpit.test.ts:69-76`
**Issue:** `beforeAll` sets `process.env.SMTP_HOST/SMTP_PORT/SMTP_FROM` and `delete`s `SMTP_USER`/`SMTP_PASSWORD`, but `afterAll` only clears mailpit. If another test in the suite (or vitest's parallel runner) reads these vars after this suite runs, they observe the leaked values. Vitest's `--isolate` default usually mitigates this, but the test should restore env state explicitly — best practice and defense against reorder-induced flake.

**Fix:** Snapshot the relevant keys in `beforeAll`, restore in `afterAll`:

```ts
const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"];
const savedEnv: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  await clearMailpit();
  process.env.SMTP_HOST = SMTP_HOST;
  // ...
});
afterAll(async () => {
  await clearMailpit();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
```

### WR-05: `signInFixture` reads response body twice on failure

**File:** `packages/contract-tests/src/helpers/sign-in-fixture.ts:34-42`
**Issue:** The function calls `res = await jf.fetch(...)`, then on `!res.ok` calls `await res.text()`. But `JarFetch.fetch` (`cookie-jar.ts:29`) returns the original `Response` and only inspects headers (not body). However, `fetchAndParse` in `helpers/http.ts:24` ALWAYS calls `await res.text()` first. There's no double-read here actually — `jf.fetch` doesn't consume the body. **However**, this still warrants a warning: for callers consuming the response body on success, `signInFixture` doesn't return it; the cookie jar captures the cookie, but if the fixture password were to change or Better Auth's response shape were to evolve, the test would still report success based purely on `res.ok`. Consider asserting at minimum that `Set-Cookie` was received (cookie jar is non-empty) so a 200-with-no-cookie regression doesn't slip through.

**Fix:** Add a post-condition check on the cookie jar:

```ts
if (!res.ok) { /* existing throw */ }
const cookies = await jf.jar.getCookies(AUTH_URL);
if (cookies.length === 0) {
  throw new Error(`signInFixture(${email}) returned 2xx but no Set-Cookie`);
}
return jf;
```

## Info

### IN-01: `OIDC_AUTHORIZE_URL` override skips discovery doc

**File:** `apps/api/src/routes/desktop-signin.ts:147-148`
**Issue:** `${trimmedIssuer}/authorize` hard-codes the path. RFC 8414 / OIDC discovery REQUIRES looking up `authorization_endpoint` in `/.well-known/openid-configuration` rather than synthesizing it. The `OIDC_AUTHORIZE_URL` override exists, but the default path will fail against IdPs whose authorize endpoint is e.g. `/oauth2/v1/authorize` (Okta), `/oauth/authorize` (GitHub), `/connect/authorize` (IdentityServer). Comment says this is Better Auth's job at code-exchange — but the FIRST hop (this redirect) doesn't go through Better Auth.
**Fix:** Either document `OIDC_AUTHORIZE_URL` as REQUIRED in OSS docs, or fetch + cache the discovery doc at boot and use `authorization_endpoint`. For Phase 6's contract test against the fixture IdP this happens to work, but real OIDC IdPs will fail without the env override.

### IN-02: `default-tenant.ts` cache reset is process-local

**File:** `apps/api/src/lib/default-tenant.ts:20-39`
**Issue:** `cached` is module-scoped; in a multi-process Fastify deployment the cache is per-process which is fine. The `_resetDefaultTenantCacheForTesting()` export is named with the "for testing" suffix but is publicly exported — anyone can call it. Also the TODO embedded in the doc-comment ("if a future plan replaces the stable-UUID seeding...") is reasonable but the function will then be async-returning-Promise of a sync constant, which is a small wart. Acceptable.
**Fix:** No action; flagged for awareness.

### IN-03: `__test` export pattern in `dual-auth.ts`

**File:** `apps/api/src/middleware/dual-auth.ts:164`
**Issue:** `export const __test = { fastifyHeadersToWebHeaders, extractBearer };` exposes private helpers for unit testing via a `__test` namespace. This pattern is fine but the convention is not consistent across the codebase (e.g. `cookie-domain.ts` exports `findSharedParentDomain` directly). Pick one convention.
**Fix:** No action required.

### IN-04: `email.ts` dev-fallback returns `delivered: true`

**File:** `apps/api/src/email.ts:62-65`
**Issue:** When `SMTP_HOST` is unset, the stub returns `{ delivered: true, reason: "smtp-not-configured" }`. The `delivered: true` is documented (Better Auth requires success for the verification flow to advance), but the wording is misleading — the email was NOT delivered. The combination of `delivered: true` + `reason: "smtp-not-configured"` requires consumers to inspect both fields. Either rename `delivered` -> `accepted` (closer to SMTP terminology), or document at the type level that `reason` MAY indicate a no-op.
**Fix:** Add JSDoc on `SendResult.delivered` clarifying it means "Better Auth contract satisfied," not "actually delivered to MTA." Alternatively, make the dev-fallback return `delivered: false, reason: "smtp-not-configured"` and update Better Auth's `sendVerificationEmail` hook to swallow this specific reason (less brittle).

---

_Reviewed: 2026-05-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
