---
quick_id: 260603-j3a
slug: web-sso-scopes
date: 2026-06-03
status: planned
validate: true
---

# Quick Task: web-SSO genericOAuth requests scopes (upstream #6)

Web SSO button (`authClient.signIn.social({provider:"oidc"})` → Better Auth
`genericOAuth`) sends an **empty `scope=`** to the IdP because the provider
registration carries no `scopes`. Better Auth does `scopes: c.scopes || []` and
only sets the `scope` query param when non-empty → IdP (Dex) never returns an
`id_token` → web sign-in cannot complete. The desktop server flow
(`routes/desktop-signin.ts:198-201`) already sets `openid email profile`
(+group when JIT on); the web genericOAuth path is out of sync. Present in app
v1.0.20.

## Fix — add `scopes` to the genericOAuth registration

`apps/api/src/lib/oidc-providers.ts` (one env-reading source of truth, D-08):

1. Add `readonly scopes: string[]` to the `OidcProviderRegistration`
   interface (property `readonly`-bound, but the array VALUE must be mutable
   `string[]` — Better Auth's `genericOAuth` config types `scopes?: string[]`
   (mutable; `generic-oauth/types.d.mts:60`), and the `{...provider}` spread at
   `auth.ts:400` preserves the property type → `readonly string[]` would fail
   TS2345 and LOCKER-02 forbids the `as` escape). Emit it from
   `readOidcProvidersForRegistration`.
2. New pure helper `resolveOidcScopes(env): string[]` (returns mutable `string[]`):
   - `readJitConfig(env)` inherits the boot loud-fail (`validateJitBoot` →
     `process.exit(78)` on malformed mapping JSON). Tests that flip JIT on MUST
     NOT pass malformed `OIDC_TENANT_MAPPING`/`OIDC_ROLE_MAPPING` through this
     helper without a throwing `onFail` stub — note this in a comment.
   - **Base**: `OIDC_SCOPES` (CSV) when set non-empty → split on `,`, trim, drop
     empties → REPLACES the default. Else default `["openid","email","profile"]`.
   - **openid mandatory**: force `openid` to the front if missing (OIDC is
     nonfunctional without it) — applies even on `OIDC_SCOPES` override.
   - **JIT group parity**: call `readJitConfig(env)` (reuse — do NOT re-read
     `OIDC_TENANT_CLAIM`/`OIDC_GROUP_CLAIM`). When non-null, append
     `jit.groupClaim` (already defaults to `groups`, honors `OIDC_GROUP_CLAIM`).
   - **Dedupe** preserving first occurrence; `openid` always index 0.
   - Mirrors `desktop-signin.ts` `openid email profile${groupScope}` — add a
     comment cross-referencing the shared convention.

Scopes flow automatically into Better Auth via `auth.ts:394` (`{...provider}`);
no auth.ts edit needed beyond what the spread already does.

## NON-GOALS
- Do NOT touch `desktop-signin.ts` (already correct — bring web into parity).
- Do NOT change `listConfiguredOidcProviders` / `GET /api/auth/providers` public
  shape (`{id,name,enabled}`) — scopes are not public.
- Do NOT change the frozen `id:"oidc"` round-trip contract.

## Tests (TDD RED→GREEN) — `apps/api/tests/unit/lib/__tests__/oidc-providers.test.ts`
Pure-function `envOf()` stub pattern (existing file). New `describe` block:
1. default (no OIDC_SCOPES, no OIDC_TENANT_CLAIM) → `["openid","email","profile"]`.
2. JIT on (OIDC_TENANT_CLAIM set, no OIDC_GROUP_CLAIM) → `[...,"groups"]`.
3. JIT on + OIDC_GROUP_CLAIM="role_groups" → appends `role_groups` not `groups`.
4. OIDC_SCOPES="openid,email" → exactly `["openid","email"]`.
5. OIDC_SCOPES="email,profile" (no openid) → openid prepended → `["openid","email","profile"]`.
6. OIDC_SCOPES override + JIT on → group appended + deduped.
7. OIDC_SCOPES="openid,email,groups" + JIT (group=groups) → "groups" once.
8. registration entry `scopes` non-empty + contains "openid".
9. OIDC_SCOPES="" (empty) AND OIDC_SCOPES="   " (whitespace) → both fall back to
   default `["openid","email","profile"]` (empty-after-trim/drop ⇒ use default).
10. OIDC_SCOPES="openid,openid,email" (intra-override dupes) → `["openid","email"]`
    (dedupe within the override, not just against the appended group).
Keep `auth-providers.test.ts` (public listing) + all existing tests GREEN.

## Constraints
Strict TDD; tests+code SAME commit; ≥90% diff cov; NO as-any/ts-ignore; NO
NODE_ENV; English-only. Document `OIDC_SCOPES` (+ openid-mandatory + JIT-group
append) in `.env.full.example` near the OIDC_* vars. typecheck api exit 0;
biome + LOCKER lints clean; read test footer with own eyes. Local commit on
main only — Nick decides release (v1.0.21 / chart 1.0.24, possibly with #4).
