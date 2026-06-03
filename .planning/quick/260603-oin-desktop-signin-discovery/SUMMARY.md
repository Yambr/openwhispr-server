---
quick_id: 260603-oin
slug: desktop-signin-discovery
date: 2026-06-03
status: complete
validate: true
---

# Summary: desktop-signin resolves authorization_endpoint from OIDC discovery (upstream #10)

`routes/desktop-signin.ts` hardcoded `${OIDC_ISSUER_URL}/authorize` → IdPs whose
authorize path ≠ `/authorize` (Dex serves `/auth`) got a 302 to a 404 →
desktop OIDC sign-in timed out. The web genericOAuth path already used
discovery; desktop is now in parity.

## Fix (ran --validate; plan-checker caught 2 blockers + 2 warnings pre-code)

1. NEW `apps/api/src/lib/oidc-discovery.ts` — extracted the HI-04-hardened
   discovery fetcher out of mint-bearer (zod schema, https + issuer-origin
   affiliation guard, LRU+TTL cache, no-body-leak errors). Added
   `authorization_endpoint` as **OPTIONAL** (plan-checker BLOCKER 1: mint-bearer's
   code-exchange reads only token/userinfo and must not regress on a doc lacking
   authorize; no fixture churn). Affiliation-checked only when present.
2. `mint-bearer.ts` — imports `discoverOidc` from the shared module; re-exports
   `__resetOidcDiscoveryCacheForTests` for back-compat with its existing test
   (plan-checker WARNING 2). Dropped the now-unused `LRUCache` import. Behavior
   unchanged.
3. `desktop-signin.ts` — resolves `authorizeBase` BEFORE the PKCE/oauth_state
   INSERT (plan-checker BLOCKER 2: a failing discovery costs zero DB writes and
   the catch can't swallow the INSERT throw). `OIDC_AUTHORIZE_URL` override wins
   (no fetch); else `discoverOidc(issuer).authorization_endpoint`. Any
   discovery failure (network / non-2xx / schema / non-affiliated origin /
   missing authorization_endpoint) → 503 + envelope, NEVER a 302 to a guessed URL.

SSRF: the affiliation guard covers `authorization_endpoint` — a poisoned doc
can't 302 the user (carrying real client_id + state + PKCE) to an attacker
authorize page.

## Verification (own eyes)

- TDD RED: desktop-signin tests failed (missing `oidc-discovery.js` module).
- GREEN: `desktop-signin.test.ts` **21 passed** (16 existing + 5 new: discovery
  /auth used, OIDC_AUTHORIZE_URL override makes NO fetch, non-2xx→503+no-INSERT,
  missing-authorization_endpoint→503, non-affiliated-origin→503 SSRF guard).
- `mint-bearer-discovery.test.ts` **11 passed** (fixtures UNCHANGED — optional
  field). Full mint-bearer importer sweep **73 passed** (mint-bearer + jit +
  oauth-channel-scheme + auth-callback + entrypoint-db-shape) — extraction clean.
- typecheck api exit **0**; coverage on changed files **96/94.5/100/95.8**
  (≥90 floor on all axes); biome clean; LOCKER lockers exit 0 (no FAIL on
  changed files; oidc-discovery has 2 non-test importers → no LOCKER-04).

## Acceptance

Desktop OIDC sign-in works against an IdP whose authorize path is not
`/authorize` (Dex `/auth`) with NO manual `OIDC_AUTHORIZE_URL`. ✓ Closes #10.

## Out of scope / next

Local commit on main only. Client peer 3bc6n4wj told #10 needs no client work
(server builds the correct authorize URL). Batches with #5/#7/#9 for release.
