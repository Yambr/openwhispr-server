---
quick_id: 260603-dll
slug: disable-local-login
date: 2026-06-03
status: complete
validate: true
revision: 2
---

# Summary: server-configurable disable-local-login + pre-auth capability (upstream #9)

Corporate OIDC-only deployments (gr0flvsr / Dex) need email/password login
disabled so users sign in ONLY via their IdP, with a pre-login capability flag
the clients read to hide the local form.

## Decision (advisor + user-confirmed)
- **`OPENWHISPR_DISABLE_LOCAL_LOGIN=1`** — explicit, default-safe ON, matching the
  4 sibling `OPENWHISPR_DISABLE_*` toggles. NOT auto-disabled by OIDC presence
  (lockout-safe: admin = first /setup user, no break-glass login).
- **Server BLOCKS the routes** (not UI-hide-only).
- Wire: `localLogin: { enabled: boolean }` on `GET /api/auth/providers`.

## Plan-checker caught a NO-GO on revision 1 (verified own-eyes vs better-auth@1.6.11)
- `enabled:false` → **400** `EMAIL_PASSWORD_DISABLED`, NOT 404; routes stay registered.
- reset path is `/request-password-reset` (not `/forget-password`); reset is NOT
  gated by `enabled` → keeping `sendResetPassword` left the reset flow live.
- a preHandler `reply.send(403)` is NEVER localized (localize runs only AFTER the
  main handler at better-auth-handler.ts:269; a preHandler short-circuits it).
Revision 2 fixed all four; re-validated GO with B-1 (the i18n completeness
`CLASS_TO_CODE` allowlist would silently no-op the new codes) folded in.

## Implementation
1. `errors.ts` — new `ForbiddenError` (403, default code `FORBIDDEN`).
2. `error-handler.ts` — `instanceof ForbiddenError → 403`, `code` drives i18n
   (mirrors the JitRejectionError 403 path).
3. `lib/oidc-providers.ts` — exported `localLoginEnabled(env)` = single source of
   truth (`!== "1"`); read by auth.ts + auth-providers.ts + better-auth-handler.ts.
4. `auth.ts` — `emailAndPassword.enabled = localLoginEnabled(...)` (secondary
   native-400 layer; NOT load-bearing, does NOT cover reset).
5. `better-auth-handler.ts` — the REAL gate: a composed preHandler that
   **throws `ForbiddenError("LOCAL_LOGIN_DISABLED", …)`** on POST to any of the
   four anonymous credential routes (`sign-in/email`, `sign-up/email`,
   `request-password-reset`, `reset-password`) — routes through `setErrorHandler`
   → localized 403, zero DB work. Composes BEFORE the existing enumeration
   dup-probe (db-guarded). Throw-routing proven by precedent
   `require-cookie-only.ts:37`.
6. i18n — `FORBIDDEN` + `LOCAL_LOGIN_DISABLED` in en + ru; `CLASS_TO_CODE`
   updated + explicit presence assertion (B-1).
7. `auth-providers.ts` — `localLogin: { enabled }` added; ETag auto-rotates.
8. Docs — `.env.full.example` + `.env.slim.example` + `docs/oidc-operator-config.md`
   §OIDC-only login (with the no-break-glass lockout warning).

## Verification (own eyes)
- TDD RED-first on the localized-403 wire test (W-1): 2 enforcement tests failed
  (200 not 403, BA reached) before the gate existed; 3 negative-controls passed.
- GREEN: 112 passed across 7 files (local-login gate 5 incl. ru-localized-403
  wire proof; error-handler 26 incl. 403; auth-providers 12 incl. localLogin +
  widened exact-keys; oidc-providers 35 incl. localLoginEnabled drift; i18n
  completeness 7 incl. the B-1 presence assertion; better-auth-handler 16 +
  i18n 11 — no regression from the preHandler refactor).
- Broader sweep: 230 passed across all 27 api route test files (buildApp wiring
  clean).
- typecheck api exit 0; biome clean (3 warns = pre-existing noNonNullAssertion in
  oidc-providers, NOT my diff); english-only lint clean (Cyrillic regex escaped).
- Merge-gating lockers all PASS (no-suppressions allowlist line for the
  better-auth-instance-cast bumped 860→867 by my comment drift, same posture as
  the pre-existing entry).

## Client contract (owed to peer 3bc6n4wj — send after own-eyes commit verify)
GET /api/auth/providers adds `"localLogin": { "enabled": boolean }`. When false,
the server returns **403 `LOCAL_LOGIN_DISABLED`** on POST to sign-in/email,
sign-up/email, request-password-reset, reset-password (plus native BA 400
EMAIL_PASSWORD_DISABLED / EMAIL_PASSWORD_SIGN_UP_DISABLED). Clients treat the flag
as authoritative and hide the email/password form when false.

## Out of scope / next
Local commit on main; batches with #5/#7/#10 for one release. Client #9 half is
the peer's surface (hide form on `localLogin.enabled:false`). Closes #9.
