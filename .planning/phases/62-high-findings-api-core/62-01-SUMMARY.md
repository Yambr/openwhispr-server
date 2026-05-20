---
phase: 62-high-findings-api-core
plan: 01
subsystem: apps/api core (security findings)
tags: [security, error-handling, oidc, rls, tdd]
requires: []
provides:
  - "HI-02 production veto on /__test/fetch debug route"
  - "HI-03 error envelope emits class-default literals (no upstream-message leak)"
  - "HI-04 bounded + zod-validated OIDC discovery cache"
  - "HI-05 tenant-scoped tryPreviousToken email SELECT"
affects:
  - apps/api/src/index.ts
  - apps/api/src/routes/__test/fetch.ts
  - apps/api/src/error-handler.ts
  - apps/api/src/lib/mint-bearer.ts
  - apps/api/src/lib/token-rotation.ts
tech-stack:
  added: []
  patterns:
    - "zod schema validation at the OIDC discovery / token network boundary"
    - "code+literal pair throw sites; upstream detail logged server-side only"
key-files:
  created:
    - .planning/phases/62-high-findings-api-core/verify-first.log
  modified:
    - apps/api/src/index.ts
    - apps/api/src/routes/__test/fetch.ts
    - apps/api/src/error-handler.ts
    - apps/api/src/routes/transcribe.ts
    - apps/api/src/routes/reason.ts
    - apps/api/src/routes/diarization.ts
    - apps/api/src/routes/agent/web-search.ts
    - apps/api/src/routes/tokens/assemblyai.ts
    - apps/api/src/routes/tokens/deepgram.ts
    - apps/api/src/routes/tokens/openai-realtime.ts
    - apps/api/src/lib/mint-bearer.ts
    - apps/api/src/lib/token-rotation.ts
decisions:
  - "HI-05 fixed via Option B (AND tenant_id predicate), not Option A (withTenant wrap) — Option A ripples to 5 unit-test fakes"
  - "HI-03 emits class-default literal for ALL ServiceUnavailable — missing-key operator hints move server-side to req.log.warn"
metrics:
  duration: ~50min
  completed: 2026-05-20
---

# Phase 62 Plan 01: HIGH findings — api-core (5) Summary

Closed all five HIGH security findings in the `apps/api` core surface
(`.planning/review/api-core.md`, HI-01..HI-05): one confirmed
already-resolved, four fixed via strict RED→GREEN TDD.

## Per-finding disposition

### HI-01 — `AUTH_URL` default `http://localhost:3000` — ALREADY CLOSED

Confirmed already-resolved by Phase 57 Track E. `grep -n 'localhost:3000'
apps/api/src/auth.ts` returns no `baseURL` match; `auth.ts:430` reads
`baseURL: validateIngressBoot().ingressBaseUrl`. `validateIngressBoot()`
refuses boot (exit 78) when no origin is configured and refuses non-HTTPS
under `NODE_ENV=production`. No production change, no RED test — recorded
in `verify-first.log`.

### HI-02 — `/__test/fetch` production veto — FIXED (commit `ca5132a9`)

Both gate sites updated with the `NODE_ENV !== "production"` veto:
- `apps/api/src/index.ts` registration `if`
- `apps/api/src/routes/__test/fetch.ts` plugin self-gate (`gated` expression)

RED test (`fetch.test.ts`, name contains `HI-02`): with
`NODE_ENV=production` + `OPENWHISPR_TEST_ROUTES=true`, `POST /__test/fetch`
returns 404 (route not registered).

**LOCKER-01 outcome:** the new `NODE_ENV` reads/compares in `index.ts`
shifted line numbers; `fetch.ts` already read `NODE_ENV` (same expression,
no new file). Updated `tools/lint-no-env-branches.allowlist.txt` (entries
`index.ts:621,626,627`), `tools/lint-no-suppressions.allowlist.txt` and
`tools/lint-no-hardcode.allowlist.txt` for the +6-line drift. All 8 lockers
green.

### HI-03 — error-handler echoes `err.message` — FIXED (commit `128626ee`)

**Task 3 (error-handler):** four branches now emit the per-class default
literal instead of echoing `err.message` / `issues[0].message`:
- ZodError → `"Invalid request"` (`code` left undefined, preserving legacy
  literal-emission semantics)
- fastify-validation → `"Invalid request"`
- RateLimitError (+ `fv.statusCode===429` shim) → `"Too many requests"`
- ServiceUnavailable (+ `fv.statusCode===503` shim) → `"Service temporarily
  unavailable"`

The unused `errMessage` local was removed. `ValidationError` keeps its
intentional caller text. `code` is still set on RateLimitError /
ServiceUnavailable so i18n localization via `errors.<code>` is unaffected.

**Task 4 (route throw sites):** folded into the Task 3 commit (Task 3's
wire test already covers the regression-shape; documenting the fold here
per the PLAN). All 9 `new ServiceUnavailable(...)` route throw sites
converted to code+literal pairs (`"SERVICE_UNAVAILABLE", "Service
temporarily unavailable"`): transcribe, reason, diarization (the
MissingPyannoteKeyError fast-path), web-search (both `TypedServiceUnavailable`
sites), assemblyai (×2), deepgram (×2), openai-realtime (×2). `diarization.ts:360`
was already a code+literal pair — left as-is. Each converted throw site
now logs the upstream/missing-key detail via `req.log.warn` BEFORE the
re-throw so operator triage is not lost. The code `SERVICE_UNAVAILABLE`
(not a new `UPSTREAM_UNAVAILABLE`) was chosen so no new locale keys are
needed — `SERVICE_UNAVAILABLE` already maps to "Service temporarily
unavailable" / "Сервис временно недоступен".

**RED tests:** `error-handler.test.ts` HI-03 tests assert interpolated
upstream text ("postgres pool exhausted: secret-suffix") and client-IP
text never reach the envelope. 13 route tests that asserted the leaked
message were updated to assert the class-default literal (they were
asserting a leak — CLAUDE.md hard rule 1: that test was wrong).

**LOCKER-05:** this change strengthens secret-shape-in-error — the envelope
can no longer carry an interpolated upstream string. No allowlist change.

**Note on out-of-scope sites:** `diarization.ts` has `reply.code(503).send(...)`
sites (PyannoteAuthError path, lines ~281/368/504/512) that bypass the
error handler entirely — these are NOT `new ServiceUnavailable` throws and
were out of HI-03's audit scope; left unchanged.

### HI-04 — OIDC discovery cache unbounded/unvalidated — FIXED (commit `dfec2c59`)

`apps/api/src/lib/mint-bearer.ts`:
- `OidcDiscoveryDocSchema` (zod) — `token_endpoint` + `userinfo_endpoint`
  required, each `z.string().url()`. The doc is `.safeParse()`d before
  caching; a parse failure throws (no body leak) and the bad doc is NOT
  cached.
- `assertEndpointAffiliated()` — each endpoint must be `https://` and its
  origin must match the issuer origin OR an explicit
  `OIDC_DISCOVERY_ALLOWED_ORIGINS` (csv) allowlist entry. Default-deny.
- The bare `Map` is replaced with a bounded TTL cache: `MAX_CACHE_ENTRIES=16`
  (oldest-first eviction on overflow), `DISCOVERY_TTL_MS=60min`. Each entry
  carries `expiresAt`; an expired entry is treated as a miss and re-fetched.
- `OidcTokenResponseSchema` (zod) — the token response is validated too
  (`access_token` required non-empty).

**Discovery-doc schema + same-origin decision:** chose issuer-origin
affiliation + an env allowlist escape hatch (`OIDC_DISCOVERY_ALLOWED_ORIGINS`)
for legitimate split-domain IdPs. **Cache:** 16 issuers, 60-min positive
TTL. The existing `mint-bearer-discovery.test.ts` fixtures were updated
from `http://idp.test` to `https://idp.test` (the HTTPS requirement is the
security intent; the test fixtures were a pre-hardening choice).

**RED tests:** 6 new HI-04 tests — missing/non-URL `token_endpoint` fails
schema validation (and is not cached), cross-origin attacker URL rejected,
`http://` endpoint rejected, `OIDC_DISCOVERY_ALLOWED_ORIGINS` accepts an
affiliated origin, TTL expiry triggers a re-fetch.

### HI-05 — `tryPreviousToken` email SELECT bypasses RLS — FIXED (commit `aa28c391`)

**Fix-shape determination (Task 6.1): Option B chosen.**

- **Option A (`withTenant()` wrap)** — rejected. It requires widening the
  `tryPreviousToken` `db` param from the minimal `{ execute(query) }` shape
  to `TransactionalDb<ExecutableTx>`. The 5 unit tests in
  `token-rotation.test.ts` pass a minimal `{ execute: vi.fn() }` fake with
  no `.transaction()` method — Option A would break all 5.
- **Option B (`AND tenant_id` predicate)** — chosen. The follow-up SELECT
  now reads `SELECT email FROM users WHERE id = ${first.user_id}::uuid AND
  tenant_id = ${first.tenant_id}::uuid LIMIT 1`. No `db`-type change, no
  caller ripple, no migration. The SELECT stays on the `openwhispr_app`
  role but is explicitly tenant-gated.

**This is NOT a HALT** — Option B is a clean api-core-side fix. No
migration written; no new `data:CR-04` deferred-items sub-entry needed.
(The separate `data:CR-04` AUTH-04-overlap *wiring* residual —
`tryPreviousToken` invoked on the RLS-subject app pool before tenant
resolution — remains tracked in `deferred-items.md` and is independent of
HI-05's follow-up-SELECT scoping.)

**RED test:** `token-rotation.test.ts` HI-05 test — a true cross-tenant
repro is not constructible under v1's single-default-tenant RLS posture
(CLAUDE.md Constraint 16: exactly one tenant exists), so the
regression-shape assertion is on the emitted SQL: the email follow-up
query must carry the `tenant_id` predicate bound to the SAME tenant_id the
sessions probe returned. The AUTH-04 integration test (real Postgres, 4
tests) still passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] New typed-error code needed i18n locale entries**
- **Found during:** Task 4
- **Issue:** introducing a new error code `UPSTREAM_UNAVAILABLE` for the
  route throw sites tripped the `i18n-completeness` test (every per-instance
  typed-error code must have en+ru translations).
- **Fix:** used the existing `SERVICE_UNAVAILABLE` code instead (semantically
  correct — these ARE ServiceUnavailable errors; it already maps to the exact
  class-default literal in both locales). No new locale keys.
- **Files modified:** the 9 route throw sites (final form).
- **Commit:** `128626ee`

### Task 4 RED — folded into Task 3

Per the PLAN's Task 4 option, the audit RED was folded into Task 3's commit:
Task 3's wire-level tests (envelope emits the literal, never the interpolated
text) fully cover the HI-03 regression-shape for both the handler and the
route throw sites. No separate Task 4 RED commit.

## TDD Gate Compliance

HI-01 is verify-only (no RED/GREEN — already-closed). HI-02, HI-04, HI-05
each have a RED test (failing assertion proven before the fix) committed
atomically with the GREEN production change. HI-03's RED tests and GREEN
fix are in the same atomic commit (`128626ee`). The verify-first log
(`docs(62-01)`) precedes all fix commits.

## Verification

Run by the executor:
- `pnpm --filter @openwhispr/api test` — **1425 passed, 2 skipped, 0
  failing** (baseline was 1415 passing; +10 = 4 HI-02 not-this + 6 HI-04 +
  HI-03/HI-05 net; no regressions).
- `pnpm lint:lockers` — **8 lockers green**.
- `pnpm typecheck` — **5 errors, 0 new** vs the documented 5-error baseline
  (`routes/index.ts` ×3 RoutePlugin arity + `tokens/assemblyai.ts` +
  `tokens/deepgram.ts` discriminated-union narrowing; the assemblyai/deepgram
  errors drifted 106→107 / 72→74 by the HI-03 `req.log.warn` add — line
  numbers updated in `deferred-items.md`).
- AUTH-04 integration test (`auth-04-token-rotation-overlap.test.ts`, real
  Postgres) — 4 passed.

## Self-Check: PASSED

- `verify-first.log` exists and is committed (`99d402a9`, updated `80fe4092`).
- All 5 commits on HEAD: `99d402a9` `ca5132a9` `128626ee` `dfec2c59`
  `aa28c391` `80fe4092`.
- `api-core.md` + `REVIEW-INDEX.md` carry per-finding closure markers.
- `git status --short` clean (only untracked planning dirs / this phase's
  CONTEXT+PLAN).
