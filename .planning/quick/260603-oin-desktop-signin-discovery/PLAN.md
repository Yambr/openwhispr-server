---
quick_id: 260603-oin
slug: desktop-signin-discovery
date: 2026-06-03
status: planned
validate: true
---

# Quick Task: desktop-signin resolves authorization_endpoint from OIDC discovery (upstream #10)

`routes/desktop-signin.ts:184` builds the authorize URL as
`${OIDC_ISSUER_URL}/authorize` (hardcoded). IdPs whose authorize path ≠
`/authorize` (Dex serves `/auth`) → 302 to a 404 → desktop OIDC sign-in
times out. The web genericOAuth path already uses discovery; desktop is out
of sync. Present in 1.1.0.

## Existing infra to REUSE (do not reinvent)
`apps/api/src/lib/mint-bearer.ts` already has a security-hardened discovery
fetcher (`discoverOidc`, module-private): zod-validated, https + issuer-origin
affiliation check (`assertEndpointAffiliated`, HI-04 SSRF guard), LRU+TTL cache
(16 entries / 60 min, `OIDC_DISCOVERY_ALLOWED_ORIGINS` split-domain allowlist),
no-body-leak errors. Its schema (`OidcDiscoveryDocSchema`) validates ONLY
`token_endpoint` + `userinfo_endpoint`.

## Fix — extract shared discovery + add authorization_endpoint

1. NEW `apps/api/src/lib/oidc-discovery.ts`: move the discovery machinery out of
   mint-bearer (schema, cache, `assertEndpointAffiliated`, `discoverOidc`,
   `__resetOidcDiscoveryCacheForTests`). Add `authorization_endpoint: z.string().url().optional()`
   to the schema — **OPTIONAL** (plan-checker BLOCKER 1): mint-bearer's
   code-exchange path (`mint-bearer.ts:461-463`) reads ONLY token/userinfo and
   must NOT regress on a (rare) IdP doc lacking authorization_endpoint, and no
   existing mint-bearer fixture would break. Affiliation-check authorization_endpoint
   ONLY WHEN PRESENT (inside discoverOidc, guard `if (doc.authorization_endpoint)`).
   Export `discoverOidc` + the reset helper + the type. Error-message prefix
   neutral (`oidc-discovery:`) — the substrings tests assert (`origin not
   affiliated`, `must be https`, `schema validation`, `discovery <status>`)
   survive the prefix change.
2. `mint-bearer.ts`: import `discoverOidc` + the reset helper from the new module;
   delete the moved code. **RE-EXPORT `__resetOidcDiscoveryCacheForTests`** from
   mint-bearer (plan-checker WARNING 2) so `mint-bearer-discovery.test.ts:28-30`'s
   existing import keeps compiling. Behavior UNCHANGED — still reads token/userinfo.
   No fixture churn (field is optional).
3. `desktop-signin.ts`:
   - `readOidcEnv()` already requires issuerUrl/clientId/clientSecret/authUrl.
   - **Resolve discovery BEFORE PKCE/INSERT** (plan-checker BLOCKER 2): right after
     `readOidcEnv()` + scheme validation and BEFORE `generatePkceVerifier()` /
     the `oauth_state` INSERT, compute `authorizeBase`:
     `OIDC_AUTHORIZE_URL` override wins (no fetch); else
     `const doc = await discoverOidc(issuerUrl)` → require
     `doc.authorization_endpoint` (absent → treat as discovery failure → 503).
     Wrap ONLY the `discoverOidc` call in try/catch; on throw/absent → 503 +
     envelope `{ error: "oidc discovery failed" }`, log reason (no body leak),
     NEVER 302. This way a failing IdP discovery costs ZERO db writes (no
     oauth_state row / sidecars) and the catch can't swallow the INSERT throw.
   - The handler is already `async`. Keep scope/state/PKCE/redirect_uri building
     unchanged; just use the pre-resolved `authorizeBase`.

## NON-GOALS
- Do NOT change mint-bearer's token/userinfo resolution semantics.
- Do NOT touch the web genericOAuth path (Better Auth does its own discovery).
- Do NOT weaken the SSRF affiliation guard — authorization_endpoint gets the
  SAME check.

## Tests (TDD RED→GREEN)
- `desktop-signin.test.ts`: the handler now fetches discovery → the WHOLE
  describe block needs `globalThis.fetch` stubbed in `beforeEach` (today it stubs
  NONE — plan-checker WARNING) so EVERY 302-expecting test (scheme matrix, the
  Phase-69 scope tests, the rate-limit burst) returns a discovery doc with
  `authorization_endpoint: "https://idp.example.com/auth"` (Dex-style, NOT
  `/authorize`). Reset the discovery cache in `beforeEach`/`afterEach`
  (`__resetOidcDiscoveryCacheForTests`). Assert: 302 location starts with
  `https://idp.example.com/auth?` (proves discovery used) — update the single
  hardcoded `…/authorize?` assertion (test:126, runs 3× in the scheme loop).
  Add: `OIDC_AUTHORIZE_URL` override still wins (NO fetch made). Add: discovery
  throws (fetch rejects / non-2xx / non-affiliated origin / doc missing
  authorization_endpoint) → 503 + envelope, NEVER 302, and NO oauth_state INSERT
  recorded (assert `recorded` has no INSERT — proves discovery precedes the write).
- `mint-bearer-discovery.test.ts`: fixtures UNCHANGED (authorization_endpoint is
  optional → existing token/userinfo-only docs still validate). Verify the suite
  stays GREEN after the extraction (import path for the reset helper still works
  via mint-bearer re-export). Verify mint-bearer behavior unchanged.
- NEW `oidc-discovery.test.ts` (optional but preferred): unit the extracted
  helper — happy parse, missing authorization_endpoint → schema fail, non-https
  endpoint → reject, non-affiliated origin → reject (+ allowlist passes), cache
  hit avoids second fetch, TTL expiry re-fetches.

## Constraints
Strict TDD; tests+code SAME commit; ≥90% diff cov; NO as-any/ts-ignore; NO
NODE_ENV; English-only. SSRF affiliation guard MUST cover authorization_endpoint.
Document nothing new in .env (OIDC_AUTHORIZE_URL + OIDC_DISCOVERY_ALLOWED_ORIGINS
already documented). typecheck api exit 0; biome + LOCKER lints clean; read test
footer with own eyes. Local commit on main only.
