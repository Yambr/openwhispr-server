# Phase 62 — HIGH findings: api-core (5)

## Background

The pre-publication code review (`.planning/review/REVIEW-INDEX.md` +
the per-package re-review synced in commit `e5026187`) found ~51 HIGH
findings across 10 packages. All 13 CRITICAL are closed (Phases 57–60);
R14–R19 closed (Phases 59–61). The HIGH backlog is now being cleared
**phase-by-phase, one package per phase** (user decision, 2026-05-20).

This phase clears the **`apps/api` core** HIGH cluster — 5 findings,
the highest-risk security group (`.planning/review/api-core.md`,
HI-01..HI-05).

## The 5 HIGH findings (from `.planning/review/api-core.md`)

**IMPORTANT — re-verify each against current code before fixing.**
Phases 57 (Track E `validateIngressBoot`, Track C test-routes veto,
Track F safety-knobs) and 59–61 touched overlapping code. Some of these
findings may be ALREADY CLOSED or partially mitigated. The executor's
first action per finding is to confirm it still reproduces; if a
finding is already resolved, mark it so with evidence and skip — do
not invent a fix for a non-bug (CLAUDE.md hard rule 3).

### HI-01 — `AUTH_URL` default `http://localhost:3000` permits unsecured cookies
`apps/api/src/auth.ts` — `baseURL: process.env.AUTH_URL ?? "http://localhost:3000"`.
`validateAuthBoot()` / `validateIngressBoot()` only refuse non-HTTPS in
production; staging / `NODE_ENV=development` / unset accepts `http://`
→ `useSecureCookies` derives false → session cookies without `Secure`.
The hardcoded `localhost:3000` default also masks operator
misconfiguration. Fix: drop the literal default; consume the validated
`authUrl`/`ingressBaseUrl` the boot validator already returns. NOTE:
Phase 57 Track E added `validateIngressBoot` — check whether `auth.ts`
still carries the raw `?? "http://localhost:3000"` fallback or already
consumes the validated value.

### HI-02 — `/__test/fetch` debug route opens on `OPENWHISPR_TEST_ROUTES=true` regardless of NODE_ENV
`apps/api/src/index.ts` — `buildDebugFetchRoutes()` registered when
`NODE_ENV==='test' || OPENWHISPR_TEST_ROUTES==='true'`. A misset
`OPENWHISPR_TEST_ROUTES=true` in production mounts an unauthenticated
arbitrary-URL fetcher (mitigated only by the SSRF allowlist). Fix:
refuse registration when `NODE_ENV==='production'` — the SAME
plugin-registration veto Phase 57 Track C applied to `/api/_test/*`
in `test-only.ts`. NOTE: confirm whether the debug-fetch route is
still gated the old way or already carries the production veto.

### HI-03 — `error-handler.ts` echoes `err.message` for ZodError / RateLimitError / ServiceUnavailable / fastify-validation
`apps/api/src/error-handler.ts` — the header comment claims the default
path "NEVER leaks the underlying message", but ZodError (first issue
message), Fastify-validation, `RateLimitError`, and `ServiceUnavailable`
all echo `err.message` to the wire envelope. A route throwing
`new ServiceUnavailable("postgres pool exhausted: <conn-suffix>")` leaks
it. Fix: emit the class-default literal for the typed-error classes
(echo caller text only where intentional, e.g. `ValidationError`); audit
every `throw new ServiceUnavailable(...)` / `throw new RateLimitError(...)`
route site for incidental upstream-message leakage. Coordinate with the
LOCKER-05 secret-shape-in-error invariant.

### HI-04 — `mint-bearer.ts` OIDC discovery cache unbounded, no TTL, no schema validation
`apps/api/src/lib/mint-bearer.ts:~118` — `discoveryCache = new Map()` is
a process-lifetime cache of the OIDC discovery doc with no upper bound,
no TTL, and no schema validation of the fetched document. A hijacked /
poisoned discovery response (token-endpoint swap) is cached for the
process lifetime → `client_secret` can be sent to an attacker endpoint.
Fix: bound the cache (size + TTL) and validate the discovery doc shape
(zod) before caching; re-fetch on TTL expiry. Treat the discovery
fetch as crossing a trust boundary.

### HI-05 — `token-rotation.tryPreviousToken` follow-up email SELECT bypasses RLS
`apps/api/src/lib/token-rotation.ts:~149` — after the SECURITY DEFINER
function matches a rotated session, a follow-up `SELECT email` is run
to resolve the user's email for audit/ledger metadata. The comment
admits it "bypasses RLS deliberately". This is the api-core slice of
the `data:CR-04` residual cluster. Fix: bind the follow-up SELECT to
the resolved tenant via `withTenant()`, OR fold the email into the
SECURITY DEFINER function's return so no separate unscoped SELECT is
needed. CLAUDE.md hard rule 1 — if the fix needs a migration or a
BYPASSRLS-pool rethink (grey-area), HALT + `.planning/deferred-items.md`
and note it joins the `data:CR-04` residual already tracked there;
this phase fixes only what is cleanly fixable api-core-side.

## Goal

After this phase:
1. Each of HI-01..HI-05 is either fixed-and-verified OR confirmed
   already-resolved (with evidence) OR HALTed to deferred-items with a
   documented reason (HI-05's grey-area branch).
2. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
3. Tests cover the regression-shape.
4. `pnpm --filter @openwhispr/api test` green; `pnpm lint:lockers`
   green (8 lockers); `pnpm typecheck` no new errors vs the 5-error
   baseline.
5. `.planning/review/api-core.md` + `REVIEW-INDEX.md` annotated with
   per-finding closure markers.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **Verify-first** — every finding re-confirmed against current code
  before any fix; already-closed findings are marked, not re-fixed
  (CLAUDE.md hard rule 3).
- **No mocks of internal logic** — DB/route tests use real Postgres via
  testcontainers (already wired in `apps/api`).
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after every
  finding; update the LOCKER allowlist `file:line` entries if edits
  shift line numbers.
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1. HALT + `.planning/deferred-items.md` if a fix needs a deeper
  change (esp. HI-05).
- **LOCKER-01** — `auth.ts` is allowlisted for the cookie-secure env
  read; `index.ts` for NODE_ENV. Do NOT add new NODE_ENV branches
  outside the allowed boundary files; thread resolved booleans through.
- **commitlint** — conventional-commit, lowercase subject, ≤ ~72 chars.
- **EN-only** source artifacts.

## Verification gate

Phase passes when:
1. HI-01..HI-05 each have a RED test + GREEN fix on main, OR a
   documented already-closed / HALT disposition.
2. `pnpm --filter @openwhispr/api test` green.
3. `pnpm lint:lockers` green (8 lockers).
4. `pnpm typecheck` — no new errors vs the 5-error baseline.
5. Spot-check: each fixed finding's regression test references its ID
   (HI-01..05) in the test name or a comment.
6. `git log --oneline` shows the expected RED/GREEN commits.
7. `.planning/review/api-core.md` + `REVIEW-INDEX.md` annotated.

## Reference

- `.planning/review/api-core.md` — the 5 HIGH findings (HI-01..05) + 8 MEDIUM
- `.planning/review/REVIEW-INDEX.md` — aggregate index
- `apps/api/src/auth.ts`, `apps/api/src/config/auth.ts` — HI-01
- `apps/api/src/index.ts` — HI-02 (`buildDebugFetchRoutes`)
- `apps/api/src/error-handler.ts` — HI-03
- `apps/api/src/lib/mint-bearer.ts` — HI-04
- `apps/api/src/lib/token-rotation.ts` — HI-05
- Phase 57 (Track C/E/F — overlapping mitigations): `.planning/phases/57-pre-publication-critical-fixes/`
- `.planning/deferred-items.md` — `data:CR-04` residual (HI-05 relates)
- CLAUDE.md hard rules: 1, 3, 4; LOCKER-01, LOCKER-05
