---
phase: 12-admin-onboarding-wizard-ui-spec-conformance-audit-v2
reviewed: 2026-05-15
depth: standard
backfill: true
scope_commits: 9763a91..5af4f6a
files_reviewed: 9
files_reviewed_list:
  - apps/api/src/routes/setup-state.ts
  - apps/api/src/routes/setup-admin.ts
  - apps/api/src/routes/auth-providers.ts
  - apps/api/src/routes/capabilities.ts
  - apps/api/src/auth.ts
  - apps/api/src/lib/oidc-providers.ts
  - apps/web/src/app/(public)/setup/page.tsx
  - apps/web/src/components/screens/auth/SetupForm.tsx
  - docs/operations.md
findings:
  critical: 0
  blocker: 0
  high: 0
  medium: 4
  low: 4
  info: 2
  total: 10
status: backfill_no_high
---

# Phase 12: Code Review Report (backfill)

**Reviewed:** 2026-05-15
**Depth:** standard
**Stance:** adversarial, fresh-context (D-19 — no participation in 12-0[1-5] execution)
**Scope:** `9763a91..5af4f6a` (24 commits — feat(12-01) singleton + role through docs(12-05b) axe baseline)
**Status:** backfill_no_high — constitutional rule #10 (audit trail) closure

## Summary

Phase 12 ships the admin onboarding wizard, public `/api/setup-state` +
`/api/auth/providers`, authed `/api/capabilities`, `users.role` enum via
Better Auth `additionalFields.role` with `input:false`, the `/setup` RSC
page + Client form, the `/admin` index, ADMIN-05 bcrypt break-glass
documentation, and the UICONF-04 / UICONF-05 axe conformance baselines.

No CRITICAL/BLOCKER/HIGH. The defensive posture is strong: atomic
`UPDATE ... RETURNING` claim, server-side role flip via owner pool, Zod
strip-unknown on the sign-up body, payload-shape lock on the public
endpoints. MEDIUM/LOW findings are quality-of-implementation items that
do not block the phase.

## High Issues

None.

## Medium Issues

### ME-01: `/setup` page swallows ALL fetch errors as `error` — masks 401/403/500 from misconfig

**File:** `apps/web/src/app/(public)/setup/page.tsx:60-68`
**Issue:** The RSC fetch wraps in `try { ... } catch { status = "error"; }` and additionally only assigns `body.status` on `res.ok`. A 5xx from the API (DB unreachable, migrations not yet completed, RLS misconfig) is indistinguishable from a TCP failure or DNS resolution failure — both render the localised "initializing" copy with no operator log signal. Under load-test or staging churn, the operator polls a green-looking "initializing" screen while the API is actually returning 503 with a useful body.
**Fix:** Log the non-OK status server-side (RSC has access to `console.error` / `pino` via `getServerLogger`) before falling through to the localised copy. Mirror the `migrations_completed` ME-01 pattern from `13-REVIEW.md`.

### ME-02: `pickLocale()` Accept-Language parser silently drops quality values + region tags

**File:** `apps/api/src/routes/setup-admin.ts:275-282`
**Issue:** `raw.split(",")[0].trim().toLowerCase()` then `.startsWith("ru")` accepts `ru-RU`, `ru;q=0.1`, and `ruby` (literal string) as Russian. A client sending `Accept-Language: en-US,ru;q=0.1` lands as `"en-us,ru;q=0.1".split(",")[0] === "en-us"` → `"en"` (correct in this case), but `Accept-Language: ru-fake-region` → `"ru"`. Low-impact (locale is non-security; defaults to `"en"` on miss), but the parser shape duplicates the i18next-http-middleware logic already in the request path. Use `req.headers["accept-language"]` only as a fallback — the upstream middleware has already negotiated `x-locale`.
**Fix:** Read `req.headers["x-locale"]` first (i18next middleware stamps it; see `/setup` page at `apps/web/src/app/(public)/setup/page.tsx:57`). Fall back to the existing local parser. Single source of truth.

### ME-03: `setup-state` route `readSetupStatus()` does NOT distinguish missing row from `pending`

**File:** `apps/api/src/routes/setup-state.ts:43-58`
**Issue:** Comment explicitly justifies "missing row → pending" as defensive default. Correct for boot races, but an operator who DROPs the `setup_state` row in production (intentional re-bootstrap, or accidental DELETE) gets the wizard back without any log. Combined with the rate-limit `30/min/IP`, an attacker who observes the response transitioning from `completed` → `pending` learns the operator just wiped state — useful signal for credential-replay timing. Recommend WARN log per-process when the row is missing (rate-limited via a module-scope boolean).
**Fix:** Emit a one-shot `req.log.warn({event: "setup_state.missing_row"}, "...")` from inside `readSetupStatus` when `rows.length === 0`. Keep the defensive default behaviour.

### ME-04: `auth-providers.ts` weak ETag derived from `JSON.stringify(body)` — object-key ordering risk

**File:** `apps/api/src/routes/auth-providers.ts:66-69`
**Issue:** `JSON.stringify(body)` is stable in V8 for object-literal keys (insertion order), so the current implementation is correct on Node 24 LTS today. However, if `listConfiguredOidcProviders()` is refactored to return objects built via `Object.fromEntries()` or spread merges, key ordering can shift and ETags rotate without a semantic change — causing 200 instead of 304 fast paths under steady-state. Defensive fix: canonicalise key order before hashing.
**Fix:** Build a tuple-array `[["providers", providers.map(p => [p.id, p.name, p.enabled])], ["emailVerification", [required, configured]]]` and hash THAT. Or use `safe-stable-stringify`.

## Low Issues

### LO-01: `setup-admin.ts:190-194` SELECT `email FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1` — no LIMIT-1 partial index

**File:** `apps/api/src/routes/setup-admin.ts:190-194`
**Issue:** The race-loser lookup runs on every duplicate POST. At 5/min/IP rate-limit this is harmless; under a misconfigured operator with rate-limit disabled (`OPENWHISPR_DISABLE_RATE_LIMIT=1` per Plan 08-01), a noisy retry loop hits `users` with a non-indexed `role` predicate. Recommend a partial index `CREATE INDEX users_admin_lookup ON users(created_at) WHERE role = 'admin'` in a future Phase 12.x or rolled into Phase 14's migration sweep.

### LO-02: `capabilities.ts` `envHash` includes secret values verbatim in SHA-256 input

**File:** `apps/api/src/routes/capabilities.ts:100-116`
**Issue:** `composite.join("\n")` includes `LITELLM_MASTER_KEY=<actual-key>` and `OIDC_CLIENT_SECRET=<actual-secret>` in the SHA-256 pre-image. SHA-256 is not reversible, so the ETag is safe to ship. However, if the hash function is ever swapped for a non-cryptographic one (xxhash for speed), the pre-image becomes attacker-recoverable. Recommend hashing `key=${k}:set=${env[k] ? "1" : "0"}` instead — same ETag-rotation behaviour, no secret in the hash input.

### LO-03: `setup-admin.ts:113` Zod `z.string().email()` accepts `+` / `'` / `"` local-part chars

**File:** `apps/api/src/routes/setup-admin.ts:112-118`
**Issue:** RFC-5321 permits these characters, and Zod accepts them. Better Auth's `signUpEmail` downstream rejects on its own validators, but an attacker hitting the wizard with `evil+<script>x</script>@e.com` lands a 400 with the parser error message echoing the email back. Not exploitable (response is JSON, not HTML), but mirrors `13-REVIEW.md` ME-03 concerns about email-as-name interpolation downstream.

### LO-04: `auth-providers.ts:67` SHA-256 hex truncated to 16 chars → 64-bit ETag collision space

**File:** `apps/api/src/routes/auth-providers.ts:67`
**Issue:** A 64-bit truncated SHA-256 is fine for ETags (birthday-collision at ~4B distinct bodies). Document the truncation as INTENTIONAL in a comment; future contributors may otherwise widen this to 32+ chars unnecessarily.

## Info

### IN-01: `setup-state.ts` and `capabilities.ts` duplicate `readSetupStatus()` — extract helper

**Issue:** Identical 16-line function in both files (`apps/api/src/routes/setup-state.ts:43-58`, `apps/api/src/routes/capabilities.ts:130-144`). Drift risk over time. Extract to `apps/api/src/lib/setup-state.ts` in a future cleanup.

### IN-02: `/admin` break-glass htpasswd path is operator-managed — no observability on credential rotation

**Issue:** `docs/operations.md:354-446` documents the bcrypt break-glass procedure but the API has no probe that surfaces "ops user last rotated > 90d ago." Future Phase 17 observability stack should pull Traefik basicauth state via the dynamic-config endpoint. Out of scope for Phase 12.

## Findings Above HIGH Severity

**Zero HIGH/CRITICAL/BLOCKER findings.** Phase 12 is well-defended against the D-23 surfaces:
- Singleton lifecycle: `setup_state.id=1` row + atomic `UPDATE ... WHERE status='pending' RETURNING` (`setup-admin.ts:175-184`) — race-safe under PgBouncer txn-mode.
- Bootstrap secrets: Zod strip-unknown on payload (`setup-admin.ts:112-118`); `users.role` is `input:false` in Better Auth (`auth.ts:273-278`); raw SQL UPDATE via owner pool (`setup-admin.ts:234-236`), never from request body.
- Public `/api/setup-state` rate-limit `30/min/IP` (`setup-state.ts:70`); `/api/setup/admin` 5/min/IP (`setup-admin.ts:152`).
- `/api/auth/providers` payload-shape lock: handler returns ONLY `{providers, emailVerification}`; `listConfiguredOidcProviders` never returns secrets.
- `/api/capabilities` ETag includes `tenantId` (`capabilities.ts:118-124`) — cross-tenant cache poisoning impossible.

## Fixes Applied

None — backfill audit, no HIGH triggers. All MEDIUM/LOW items deferred. Tracked in `.planning/deferred-items.md` if user accepts.

## HALT-protocol status

NOT TRIGGERED — zero new HIGH findings.

---

_Reviewed: 2026-05-15_
_Reviewer: gsd-code-reviewer (fresh-context backfill per D-19)_
_Depth: standard_
