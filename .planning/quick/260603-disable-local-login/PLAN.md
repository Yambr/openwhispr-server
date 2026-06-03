---
quick_id: 260603-dll
slug: disable-local-login
date: 2026-06-03
status: planned
validate: true
revision: 2
---

# Plan: server-configurable disable-local-login + pre-auth capability (upstream #9)

> **Revision 2** — plan-checker NO-GO on v1 (verified own-eyes against installed
> better-auth@1.6.11): `enabled:false` returns **400** not 404; `/forget-password`
> is actually `/request-password-reset`; reset routes are NOT gated by `enabled`;
> a preHandler `reply.send()` 403 is NEVER localized (localize runs only after the
> main handler at better-auth-handler.ts:269). This revision fixes all four.

## Decision (advisor + user-confirmed)
- **Mechanism: explicit env `OPENWHISPR_DISABLE_LOCAL_LOGIN=1`** (Option A),
  default-safe ON, matching the 4 sibling `OPENWHISPR_DISABLE_*` toggles. NO
  auto-disable on OIDC presence.
- **Enforcement: the preHandler is the REAL gate** (the native BA layer only
  400s sign-in/sign-up and does NOT touch reset). `emailAndPassword.enabled` is
  kept as a secondary native-400 layer, but it is NOT load-bearing and NOT relied
  on for 404s or for reset coverage.
- **Wire:** add `localLogin: { enabled: boolean }` to `GET /api/auth/providers`.

## Verified BA 1.6.11 facts (own eyes — node_modules)
- `enabled:false` → sign-in 400 `EMAIL_PASSWORD_DISABLED` (sign-in.mjs:198),
  sign-up 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` (sign-up.mjs:144). Routes stay
  registered.
- Reset request path is **`/request-password-reset`** (password.mjs:20), gated
  only by `sendResetPassword` presence (password.mjs:42), NOT by `enabled`.
  `/reset-password` (POST) never checks `enabled`.
- `maybeLocalizeBetterAuthError` runs at better-auth-handler.ts:269, AFTER
  `handler(webReq)` (line 238). A preHandler `reply.send()` short-circuits before
  that → not localized. The error-handler's `setErrorHandler` (error-handler.ts:130)
  DOES localize by `code` for typed errors (JitRejectionError precedent at :167).

## Single source of truth (D-08 zero-drift)
New exported `localLoginEnabled(env): boolean` in `apps/api/src/lib/oidc-providers.ts`:
`return env.OPENWHISPR_DISABLE_LOCAL_LOGIN !== "1"`. Read by all consumers.

## Changes

### 1. `apps/api/src/errors.ts` — new 403 class
Add `ForbiddenError` (mirrors the existing class shape, default code `FORBIDDEN`).
Add the `else if (err instanceof ForbiddenError) { status = 403; message =
err.message || "Forbidden"; code = err.code; }` branch to error-handler.ts (after
AuthError/before NotFoundError — any order works, it's an instanceof chain). This
gives a localized 403 envelope via the existing `localize(req, code, fallback)`
path (error-handler.ts:70-78), the SAME mechanism JitRejectionError uses.

### 2. `apps/api/src/lib/oidc-providers.ts` — `localLoginEnabled`
Export the helper; add it to the D-08 zero-drift contract test.

### 3. `apps/api/src/auth.ts` (~line 564) — secondary native layer
`emailAndPassword: { enabled: localLoginEnabled(process.env), … }`. Keep
`requireEmailVerification` + `sendResetPassword` as-is. Effect when disabled:
sign-in/sign-up 400 natively (defence-in-depth only; the preHandler is the real
gate and covers reset, which this does NOT). Import `localLoginEnabled`.

### 4. `apps/api/src/routes/better-auth-handler.ts` — the REAL enforcement (throw, not send)
At registration compute `localLoginDisabled = !localLoginEnabled(process.env)`.
New `isLocalCredentialRoute(req)` helper (POST-only, mirrors `isSignUpEmailRequest`)
matching the path-set:
  `/api/auth/sign-in/email`, `/api/auth/sign-up/email`,
  `/api/auth/request-password-reset`, `/api/auth/reset-password`.
(NOT `change-password`/`set-password` — those are session-authed, different
threat; out of scope, noted.)
Compose into a SINGLE preHandler attached when `localLoginDisabled ||
(enumerationOptOut && db)`:
  1. if `localLoginDisabled && isLocalCredentialRoute(req)` →
     **`throw new ForbiddenError("LOCAL_LOGIN_DISABLED", "Local (email/password)
     login is disabled on this server")`**. A thrown error in a Fastify preHandler
     routes through `setErrorHandler`, which localizes via `errors.LOCAL_LOGIN_DISABLED`
     and emits the canonical 403 envelope — fixing the v1 localization gap. (req.i18n
     is populated: the i18next middleware preHandler fires before this one,
     better-auth-handler.ts:146.)
  2. else, the existing enumeration-dup-probe (guarded `if (enumerationOptOut &&
     db)` INSIDE the handler so no `db!` deref when only the local-login gate is on).
Local-login check runs FIRST (before the DB probe) so a blocked request costs zero
DB work.

### 5. i18n — `errors.LOCAL_LOGIN_DISABLED` + `errors.FORBIDDEN`
Add both keys to en + ru locale bundles (only en.json + ru.json exist).
`FORBIDDEN` is the ForbiddenError class default; `LOCAL_LOGIN_DISABLED` is the
per-instance code for this gate.

**B-1 (plan-checker, verified own-eyes):** the completeness test's `CLASS_TO_CODE`
(i18n-completeness.test.ts:36-46) is a MANUAL allowlist and the scanner
short-circuits at line 86 (`if (!(exprText in CLASS_TO_CODE)) continue;`). Without
adding `ForbiddenError: "FORBIDDEN"` to it, BOTH the class-default `FORBIDDEN` AND
the per-instance `LOCAL_LOGIN_DISABLED` are silently UNSCANNED → ship unvalidated
(silent-green, not RED). So:
  (a) add `ForbiddenError: "FORBIDDEN"` to `CLASS_TO_CODE`;
  (b) the per-key-parity test only checks en≡ru SYMMETRY, not presence — add an
      EXPLICIT assertion that `errors.FORBIDDEN` and `errors.LOCAL_LOGIN_DISABLED`
      are both present in en AND ru (symmetry alone passes even if both are absent
      from both files).

### 6. `apps/api/src/routes/auth-providers.ts` — capability announce
Extend `AuthProvidersResponse` with `readonly localLogin: { readonly enabled:
boolean }`; `buildResponseBody` adds `localLogin: { enabled: localLoginEnabled(env) }`.
ETag auto-changes (computeWeakEtag hashes the full body; env read per-request).

### 7. Docs + .env example
`.env.*.example`: `OPENWHISPR_DISABLE_LOCAL_LOGIN=1` (commented, default-off) with
a lockout warning (admin = first /setup user, no break-glass; keep ≥1 working auth
method). One paragraph in the auth/OIDC doc documenting the `localLogin.enabled`
wire field + that disabling blocks sign-in/sign-up/reset server-side (403).

## TDD (RED → GREEN, same commit)

- `errors.test.ts`: `ForbiddenError` carries code/message (both calling styles).
- `error-handler.test.ts`: a thrown `ForbiddenError` → 403 + localized `code`.
- `oidc-providers` zero-drift test: `localLoginEnabled` true by default, false only
  on `"1"` (`"0"`/`""`/`undefined`/`"true"` → enabled).
- `auth-providers.test.ts`: widen the exact-keys assertion (currently
  `["emailVerification","providers"]` at :98) to include `localLogin`; default →
  `localLogin.enabled===true`; `=1` → `false`; the no-secret/issuer regexes
  (:106-108) stay GREEN.
- `better-auth-handler.test.ts`: with the flag set, POST each of the FOUR paths
  (`sign-in/email`, `sign-up/email`, `request-password-reset`, `reset-password`)
  → **403 `LOCAL_LOGIN_DISABLED`** (preHandler throws before BA). With the flag
  unset → existing pass-through + enumeration tests stay GREEN. Compose case: flag
  SET + enumeration opt-out SET → sign-up/email 403s on local-login FIRST (never
  reaches the dup-probe).
- **Localized-403 wire test — RED-FIRST, BLOCKING (W-1):** no in-repo precedent
  combines a route-level-preHandler throw WITH localization, so this test is
  written FIRST and must fail for the RIGHT reason (missing ForbiddenError branch
  / missing ru key) before any implementation. Boot the real app (i18nPlugin +
  error-handler + the BA route), POST with `Accept-Language: ru`, assert the 403
  BODY at the wire is the ru string for `LOCAL_LOGIN_DISABLED`. This also covers
  W-2 (confirms the index.ts:575 onError hook doesn't swallow the ForbiddenError).
- i18n completeness: `CLASS_TO_CODE` updated (B-1); explicit presence assertion for
  `LOCAL_LOGIN_DISABLED` + `FORBIDDEN` in en AND ru.

## Client contract (send to peer 3bc6n4wj AFTER commit + own-eyes verify)
```
GET /api/auth/providers  (public, no auth)
{
  "providers": [{ "id": "google|github|oidc", "name": string, "enabled": true }],
  "emailVerification": { "required": boolean, "configured": boolean },
  "localLogin": { "enabled": boolean }      // NEW — render email/password form iff true
}
```
When `localLogin.enabled === false` the server BLOCKS the credential routes:
- `POST /api/auth/sign-in/email` & `/sign-up/email` → **403 `{code:"LOCAL_LOGIN_DISABLED"}`**
  (and a native BA **400 `EMAIL_PASSWORD_DISABLED`** / `EMAIL_PASSWORD_SIGN_UP_DISABLED`
  if the preHandler is ever bypassed).
- `POST /api/auth/request-password-reset` & `/reset-password` → **403 `LOCAL_LOGIN_DISABLED`**.
Clients MUST treat `localLogin.enabled` as authoritative and not attempt these calls.

## Security / risk
Default-safe ON; explicit opt-in; OIDC-orthogonal (lockout-safe). Server-side
enforcement on ALL FOUR credential routes (incl. reset, which `enabled:false`
does NOT cover) closes the hidden-but-live-route gap. Localized via typed-throw
(not the broken send-path). No secret added to the public endpoint.
