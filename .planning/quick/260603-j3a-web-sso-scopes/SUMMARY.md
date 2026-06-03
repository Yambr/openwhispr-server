---
quick_id: 260603-j3a
slug: web-sso-scopes
date: 2026-06-03
status: complete
validate: true
---

# Summary: web-SSO genericOAuth requests scopes (upstream #6)

Web SSO (`authClient.signIn.social({provider:"oidc"})` → Better Auth
`genericOAuth`) sent an **empty `scope=`** to the IdP: the provider registration
carried no `scopes`, Better Auth does `scopes: c.scopes || []`, and the authorize
URL only sets `scope` when non-empty → no `openid` → IdP (Dex) returns no
`id_token` → web sign-in could not complete. The desktop flow already set
`openid email profile` (+group when JIT on); the web path was out of sync.

## Fix — `scopes` on the genericOAuth registration

`apps/api/src/lib/oidc-providers.ts`:
- `OidcProviderRegistration` gains `readonly scopes: string[]` — value MUST be
  mutable `string[]` (the `{...provider}` spread in `auth.ts:400` feeds Better
  Auth's `scopes?: string[]`; `readonly string[]` fails TS2345 and LOCKER-02
  forbids the cast — caught by the plan-checker before any code).
- New module-private `resolveOidcScopes(env)`:
  - base = `OIDC_SCOPES` CSV (split/trim/drop-empties) when it yields ≥1 token,
    else default `["openid","email","profile"]` (override REPLACES the default).
  - `openid` force-prepended if missing (mandatory — even on override).
  - JIT-group parity: reuses `readJitConfig(env).groupClaim` (the SAME
    `OIDC_GROUP_CLAIM||"groups"` the desktop flow derives, gated on
    `OIDC_TENANT_CLAIM`) — single source of truth, no env re-read.
  - deduped, `openid` first.
- Not exported (only consumer is `readOidcProvidersForRegistration`; tests cover
  every branch through that public seam) → no LOCKER-04 dead-export.
- `auth.ts` UNCHANGED — scopes flow through the existing `{...provider}` spread.
- `.env.full.example`: `OIDC_SCOPES` documented (openid-mandatory + JIT-group
  auto-append) near the other OIDC_* vars.

## Verification (own eyes)

- TDD RED: 11 new tests failed (`scopes` empty/undefined), 20 existing passed.
- GREEN: `oidc-providers.test.ts` **31 passed** (20 + 11 new cases 1-10 + trim);
  contract `auth-providers.test.ts` **10 passed** (public listing unchanged).
- `typecheck api` exit **0** (the `string[]` value compiles through the auth.ts
  spread into Better Auth's `scopes?: string[]` — the plan-checker's TS2345
  BLOCKER resolved).
- Coverage on `oidc-providers.ts`: **100% stmts/branches/funcs/lines** (34/34
  branches).
- biome clean; LOCKER no-env-branches/no-suppressions clean; no-hardcode +
  prod-readiness fail-set IDENTICAL to main (428 FAIL — pre-existing Phase-38
  dead-export backlog). One allowlist line bumped `oidc-providers.ts:34→36`
  (`OidcProviderRegistration` shifted by added comment; pure line-drift, stays
  an allowlisted WARN — not a new violation).

## Acceptance

Web SSO authorize URL now carries `scope=openid email profile` (+group when JIT
on) → genericOAuth receives an id_token → session completes. ✓ Closes upstream #6.

## Out of scope / next

Local commit on main only. Nick decides the release — likely folds into the
fast-follow v1.0.21 / chart 1.0.24 alongside the already-local #4 fix.
