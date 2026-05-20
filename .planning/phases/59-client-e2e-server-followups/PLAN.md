---
phase: 59-client-e2e-server-followups
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/test-only.ts
  - apps/api/src/routes/__tests__/test-only.ts
  - apps/api/src/auth.ts
  - apps/api/tests/**  (R18 re-probe + Track-C regression test — exact file decided post-investigation)
  - apps/api/src/routes/transcribe.ts
  - apps/api/src/routes/__tests__/transcribe.ts
  - apps/api/src/config/ssrf.ts                       (only if the advisor picks the probe-bypass-seam option)
  - apps/api/src/lib/dep-check.ts                     (R16 facet 1, depending on advisor outcome)
  - apps/api/src/lib/dep-check.test.ts
  - apps/api/src/routes/probes.ts                     (only if litellm is reported `skipped`)
  - apps/api/src/middleware/require-cookie-only.ts
  - apps/api/src/middleware/__tests__/require-cookie-only.ts
  - apps/api/src/routes/verification-status.ts
  - apps/api/src/routes/__tests__/verification-status.ts
  - apps/api/src/routes/delete-account.ts
  - apps/api/src/routes/__tests__/delete-account.ts
  - apps/api/src/routes/v1/keys/create.ts
  - apps/api/src/routes/v1/keys/__tests__/create.ts
  - packages/data/src/schema/api_keys.ts
  - packages/data/migrations/0028_api_keys_name_scope.sql
  - packages/data/migrations/0028_api_keys_name_scope.down.sql
  - .planning/phases/59-client-e2e-server-followups/r18-reprobe.log
  - .planning/deferred-items.md
autonomous: false
requirements: ["R14", "R15", "R16", "R17", "R18", "R5"]

must_haves:
  truths:
    - "A second POST /api/_test/seed-tenant with an already-seeded email returns 200 {token,user} for the existing user — never 500."
    - "GET /api/auth/verification-status WITHOUT ?email= returns 200 (session-derived), not 400."
    - "GET /api/auth/verification-status?email=x AND DELETE /api/auth/delete-account return 200 for a valid Better Auth session — the resolver no longer 401s a just-minted session."
    - "GET /readyz returns 200 with litellm.ok true (or litellm honestly reported `skipped` and excluded from the aggregate) — the server no longer SSRF-self-blocks its own internal compose service."
    - "POST /api/transcribe with a zero-byte file returns 400 BEFORE any upstream call."
    - "Two distinct API-key owners can each create a key with the identical name (both 200); the SAME owner reusing an active name still gets 409 API_KEY_NAME_TAKEN."
    - "R18 is either fixed (Node-fetch sign-in/email with valid seeded creds → 200) OR formally closed not-reproducible with a committed re-probe log as evidence."
  artifacts:
    - path: "packages/data/migrations/0028_api_keys_name_scope.sql"
      provides: "forward migration: drop the current api_keys name unique index, add the correct-scope composite one"
      contains: "DROP INDEX"
    - path: ".planning/phases/59-client-e2e-server-followups/r18-reprobe.log"
      provides: "evidence record of the R18 verify-first Node-fetch probe outcome"
  key_links:
    - from: "apps/api/src/routes/test-only.ts"
      to: "Better Auth signUpEmail thrown APIError"
      via: "try/catch around signUpEmail(...) routing a duplicate into the idempotent lookup branch"
      pattern: "catch"
    - from: "apps/api/src/routes/v1/keys/create.ts"
      to: "packages/data/migrations/0028_api_keys_name_scope.sql"
      via: "23505 on the new composite index → 409 only for the same owner"
      pattern: "23505"
---

<objective>
Close the five server follow-up findings R14–R18 surfaced by the OpenWhispr
Electron client's Phase 9 e2e triage (and R5, folded into R15). Each is a real
server contract / correctness defect; none currently blocks the client's green
e2e run (all are `@blocked-rN`-excluded), but all must be fixed before public
release.

Purpose: restore wire-contract correctness on the test-route family (R14),
the Better-Auth-mounted auth routes (R15/R5), the readiness + transcription
paths (R16), API-key tenant isolation (R17), and the non-browser sign-in path
(R18 — verify-first).

Output: per-track RED+GREEN atomic commit pairs (test + production code in the
same commit), one forward migration `0028`, an R18 re-probe evidence log, an
updated `deferred-items.md`, and the client repo's `SERVER-REQUIREMENTS.md`
R14–R18 + R5 annotated with closure markers and server commit SHAs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/59-client-e2e-server-followups/CONTEXT.md
@.planning/phases/58-remaining-critical-fixes/PLAN.md
@CLAUDE.md

Read-only client work-order (different repo — DO NOT edit until the final task):
/Users/dev/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md
  §R14 ~674-753 · §R15 ~756-873 · §R16 ~876-961 · §R17 ~964-1015 ·
  §R18 ~1018-1093 · verification protocol ~1096-1115.

Already-read source (facts captured below — do NOT re-read to "check one more thing";
use Grep for anything more specific):

- `apps/api/src/routes/test-only.ts` — seed-tenant handler. Line 413
  `const signUp = await signUpEmail(...)` has NO try/catch. The idempotent
  recovery `else` branch (lines 424-450) only handles `signUp.data === null`
  i.e. the *returned-error* shape. Better Auth's real `auth.api.signUpEmail`
  THROWS an `APIError` on a duplicate email — so on the production path the
  `else` branch is dead code and the thrown error escapes to the global
  handler → generic 500. The handler comment at lines 408-412 is wrong about
  the shape.
- `apps/api/src/middleware/require-cookie-only.ts` — `buildRequireCookieOnly`
  calls `auth.api.getSession({ headers })` where `headers` is built by
  `cookieOnlyHeaders` which STRIPS `authorization`. This is the R15 facet-2
  root cause: it is a deliberately Bearer-rejecting, cookie-ONLY resolver
  (BACKEND_SPEC mandates cookie-only for these two routes). On a 401 it throws
  `AuthError("unauthorized")`.
- `apps/api/src/routes/verification-status.ts` — `schema.querystring:
  VerificationStatusQuery`; the handler also calls `VerificationStatusQuery.parse(req.query)`.
  The R15 facet-1 bug (mandatory `?email=`) lives in the `VerificationStatusQuery`
  schema in `@openwhispr/wire-schemas` — `email` is a required string. Header
  comment at lines 11-18 says the value is discarded but the param must be
  OPTIONAL per R5; the schema currently makes it required.
- `apps/api/src/routes/delete-account.ts` — same `requireCookieOnly` preHandler.
- `apps/api/src/routes/v1/keys/create.ts` — INSERT into `api_keys`; a `23505`
  unique-violation on its catch (lines 129-141) maps to `409 API_KEY_NAME_TAKEN`.
- `packages/data/src/schema/api_keys.ts` — `api_keys` columns: `tenant_id`,
  `user_id`, `name`, `key_prefix` (globally unique), `key_hash`, `scopes`,
  `revoked_at`.
- `packages/data/migrations/0010_api_keys.sql` lines 39-42 — the active-name
  index is `CREATE UNIQUE INDEX api_keys_active_name_idx ON api_keys
  (tenant_id, name) WHERE revoked_at IS NULL`. It is ALREADY `(tenant_id, name)`-
  scoped — NOT global on `name`. The R17 live repro 409'd because in v1 both
  seed-tenants resolve to the SAME default tenant (RLS posture ledger). See the
  Track E scope-determination step.
- `apps/api/src/routes/transcribe.ts` — streams `req.raw` straight to
  `deps.litellm.audioTranscriptions(...)`. NO empty-body / zero-byte guard
  before the upstream call. A `LitellmUpstreamError` → `UpstreamError` → 502.
- `apps/api/src/config/ssrf.ts` — `OUTBOUND_ALLOWED_HOSTS` (default-deny) +
  `OUTBOUND_PRIVATE_HOST_ALLOWLIST`. `.env.full.example` line 302 already lists
  `litellm` in `OUTBOUND_ALLOWED_HOSTS`; `compose/docker-compose.load-test.yml`
  does too. The slim-test stack the live api is running on is missing it — so
  R16 facet 1 is at minimum an env defect, and the advisor must decide whether
  the durable fix is config-only or a server probe-bypass seam.
- `apps/api/src/lib/dep-check.ts` — `litellm` check does `undici GET
  ${litellmUrl}/health`, fails on >=500; on any throw returns `{ok:false,error}`.
- `apps/api/src/routes/probes.ts` — `/readyz` is `200` iff `postgres.ok &&
  valkey.ok && litellm.ok`, else `503`.
- `apps/api/src/auth.ts` lines 437-441 — `trustedOrigins` is built from
  `OPENWHISPR_API_URL`, `AUTH_URL`, `AUTH_TRUSTED_ORIGINS_EXTRA` (csv). No
  `'*'`, no `null`/missing-Origin acceptance.

<interfaces>
seed-tenant handler (test-only.ts):
  signUpEmail: TestOnlySignUpEmail — `(call) => Promise<TestOnlySignUpResult>`
  TestOnlySignUpResult = { data: {...} | null, error: {code?,message?} | null }
  PRODUCTION reality: `auth.api.signUpEmail` THROWS `APIError` on duplicate —
  it does NOT return `{data:null,error}`. The TestOnlySignUpEmail TYPE models
  only the returned-error shape; the duplicate-email path needs a catch.

requireCookieOnly(req): strips `authorization`, getSession({headers}),
  throws AuthError("unauthorized") on miss. Cookie-only by BACKEND_SPEC.

api_keys_active_name_idx — UNIQUE (tenant_id, name) WHERE revoked_at IS NULL.

ConflictError("API_KEY_NAME_TAKEN", msg) — thrown from create.ts on 23505.
</interfaces>

apps/api integration tests use `@testcontainers/postgresql` (real Postgres +
PgBouncer + Valkey) — no HTTP/internal mocks (CLAUDE.md: no mocks of internal
logic; mocks only at process/network boundaries). Follow the established
`describe.skipIf(SKIP)` docker-availability pattern used by the existing
api integration suites.
</context>

## Phase Goal

Close R14, R15 (re-opening R5), R16, R17, and R18 — each via strict RED→GREEN
TDD with the test asserting the regression-shape so a future revert is caught.
R18 is verify-first: its first task re-probes and may close the finding with no
production change. After this phase the client's five `@blocked-rN` server
follow-ups are resolved.

---

## Dependency Graph

```
Track A (R14, seed-tenant 500)        — cheap, isolated, adjacent to R13
Track C (R18, sign-in Origin)         — VERIFY FIRST; may be a no-op
Track B (R16, SSRF self-block)        — grey-area; advisor gate
Track D (R15/R5, better-auth routes)  — HIGH
Track E (R17, api-key name scope)     — owns the only migration (0028)
```

**Order: A → C → B → D → E** (per CONTEXT.md §Constraints). The tracks touch
disjoint production files; the order is risk/cost sequencing, not a hard
dependency chain. Single plan, single executor, sequential commits.

E owns the **only** migration. Migration `0027_usage_ledger_event_at.*` is
already taken by Phase 58 — **Track E's migration number is `0028`.** No
migration-number clash with any other track.

---

## Track A — R14: seed-tenant 500 on a duplicate-email POST

**Finding:** R14 (MEDIUM). `apps/api/src/routes/test-only.ts:413` —
`await signUpEmail(...)` has no try/catch. Better Auth's real `signUpEmail`
THROWS an `APIError` on a duplicate email; the `else` recovery branch
(424-450) only handles the returned-`{data:null,error}` shape, so the thrown
error escapes → generic `500 {"error":"Internal server error"}`.

**Chosen fix:** option (a) — idempotent. R1's seed-tenant contract already
promises idempotency-on-email; make the promise true. NOT a 409.

### RED step

- File: `apps/api/src/routes/__tests__/test-only.ts` (extend the existing
  seed-tenant suite). Test name MUST contain `R14`.
- The current fake `signUpEmail` *returns* an error — it never exercised the
  throwing path. Add a NEW fake variant whose `signUpEmail` THROWS an
  `APIError`-shaped object on a duplicate email (matching production). First
  determine the EXACT shape/code Better Auth emits — grep the Better Auth
  package for the duplicate-email error: `grep -rn "USER_ALREADY_EXISTS\|already exists" node_modules/better-auth/dist 2>/dev/null` and inspect
  `APIError` — assert against the real code, not a guess.
- Scenario: seed email X once → 200; seed X again through the THROWING fake →
  with the dead-code bug present this throws and the route 500s. The RED test
  asserts the *intended* behavior (second call → 200 with the existing user's
  `id`) and therefore FAILS pre-fix.
- Commit: `test(59-A): red — R14 seed-tenant 500 on duplicate-email re-seed`.

### GREEN step

- File: `apps/api/src/routes/test-only.ts`.
- Wrap the `signUpEmail({...})` call (line 413) in a `try/catch`. In the
  `catch`: if the thrown error's code indicates a duplicate
  (`USER_ALREADY_EXISTS` or the exact code confirmed in the RED step), fall
  into the SAME idempotent lookup the `else` branch already performs — look up
  the existing user by `lower(email)`, re-mint a fresh bearer + sessions row,
  return `200 {token,user}` with the existing user's `id`. If the thrown error
  is NOT a duplicate code, re-throw (genuine failure → existing 500 path).
- Keep the existing returned-error `else` branch as defence-in-depth (it costs
  nothing and covers the test-fake's returned-error shape).
- Fix the now-incorrect handler comment at lines 408-412 to describe the
  throwing reality.
- Key invariant: a re-seed of a known email is a 200 idempotent re-mint;
  a 500 on a foreseeable re-seed is eliminated.
- **CLAUDE.md hard rule 1:** if the duplicate-email path exposes a deeper
  constraint (e.g. Better Auth's `APIError` carries no stable discriminable
  code), HALT, log in `.planning/deferred-items.md` with `WHY:` evidence — do
  not hack a brittle string-match into production.
- Commit: `fix(59-A): green — R14 seed-tenant idempotent on duplicate email`.

### Verification

```
pnpm --filter @openwhispr/api test -- test-only
grep -n "catch" apps/api/src/routes/test-only.ts            # try/catch around signUpEmail
# live stack: re-POST a seeded email → 200, never 500
DUPE="r14-$(date +%s)@test.local"
curl -sS -X POST http://localhost:4000/api/_test/seed-tenant -H 'content-type: application/json' \
  -d '{"email":"'$DUPE'","password":"P-test-1!","name":"t","verified":true}' -w ' (%{http_code})'
curl -sS -X POST http://localhost:4000/api/_test/seed-tenant -H 'content-type: application/json' \
  -d '{"email":"'$DUPE'","password":"P-test-1!","name":"t","verified":true}' -w ' (%{http_code})'
# second call MUST be (200)
```

---

## Track C — R18: sign-in/email Origin gate (VERIFY FIRST)

**Finding:** R18 (MEDIUM — status UNCONFIRMED). The relayed claim diverges
from a live `curl` probe (see CONTEXT.md §R18). This track is verify-first: the
production fix is NOT a certainty.

### Task C.1 — re-probe (MANDATORY FIRST, branches the track)

Write and run a genuine **Node `fetch` (undici)** probe against the live slim
stack on `localhost:4000`, exactly as the client harness runs:

1. Seed a verified tenant: `POST /api/_test/seed-tenant` → capture `email` +
   the password used.
2. `POST /api/auth/sign-in/email` via Node `fetch` (undici sends
   `Origin: null` on a non-browser request) with the **valid seeded
   credentials** — NOT wrong creds.
3. Record the full response (status + body) to
   `.planning/phases/59-client-e2e-server-followups/r18-reprobe.log` — this
   file is the committed evidence either way.

**Branch on the result:**

- **403 `MISSING_OR_NULL_ORIGIN` DOES reproduce** → proceed to C.2 (RED/GREEN
  fix below).
- **403 does NOT reproduce** (sign-in returns 200, OR a non-Origin error like
  401 wrong-creds — meaning the Origin gate passed) → **R18 is closed
  not-reproducible.** No production change. Commit the probe log + a
  `deferred-items.md`/SUMMARY note:
  `docs(59-C): close R18 not-reproducible — Node-fetch sign-in re-probe log`.
  State in the SUMMARY that the slim stack runs `NODE_ENV=development`
  (post-R13) which relaxes the Origin posture, and the relayed claim was
  against a config the slim stack no longer uses. Skip C.2 entirely.

### Task C.2 — RED+GREEN (ONLY if C.1 reproduced the 403)

- RED: `apps/api/tests/**` integration test (exact file decided in C.1 —
  e.g. `apps/api/tests/integration/r18-sign-in-origin.test.ts`). Test name
  MUST contain `R18`. Boot `buildApp` with `OPENWHISPR_TEST_ROUTES=true` +
  `NODE_ENV !== production`; drive `POST /api/auth/sign-in/email` with a
  missing/`null` Origin and valid seeded creds; assert 200 (RED: currently 403).
- GREEN: `apps/api/src/auth.ts` — extend `trustedOrigins` (lines 437-441) to
  accept a missing/`null` Origin **ONLY** when
  `process.env.OPENWHISPR_TEST_ROUTES === "true"` AND
  `process.env.NODE_ENV !== "production"` — the SAME double-gate R1/R13 use for
  seed-tenant. Better Auth accepts a `trustedOrigins` predicate
  function — confirm the supported signature in
  `node_modules/better-auth` before wiring; do NOT use `trustedOrigins: ['*']`.
  - **NODE_ENV note (LOCKER-01):** `auth.ts` is NOT in the LOCKER-01 allowlist
    (`bootstrap.ts`, `config/*.ts`, `otel-bootstrap.ts`, `*.config.ts`). If the
    gate logic must read `NODE_ENV`, compute the boolean in
    `apps/api/src/config/*` (or `bootstrap.ts`) and pass it into the auth
    builder as a parameter — do NOT add a `NODE_ENV` comparison inside
    `auth.ts`. Verify `pnpm lint:lockers` (LOCKER-01) stays green.
- **CLAUDE.md hard rule 1:** if Better Auth's `trustedOrigins` cannot express
  a conditional null-Origin acceptance without a broader relaxation, HALT +
  `deferred-items.md` — do not weaken the CSRF posture globally.
- Commit: `test(59-C): red — R18 sign-in/email rejects null Origin` then
  `fix(59-C): green — R18 gate null-Origin sign-in behind OPENWHISPR_TEST_ROUTES`
  (or one atomic combined commit).

### Verification

```
cat .planning/phases/59-client-e2e-server-followups/r18-reprobe.log   # evidence present
# if fixed: Node-fetch POST /api/auth/sign-in/email + valid seeded creds → 200
pnpm lint:lockers     # LOCKER-01 green — no NODE_ENV branch leaked into auth.ts
```

---

## Track B — R16: SSRF allowlist self-blocks internal services + empty-file transcribe

**Finding:** R16 (MEDIUM, two facets). Facet 1: the SSRF outbound allowlist
rejects the internal compose host `litellm` → `/readyz` 503. Facet 2:
`POST /api/transcribe` with a zero-byte file → 502 (no empty-input guard).

### Task B.0 — advisor gate (MANDATORY, before any B.1 code)

Facet 1 is security-sensitive (the SSRF guard). Spawn a
`gsd-advisor-researcher` to choose between:

- **(a) Config-only** — add the internal service host(s) to
  `OUTBOUND_ALLOWED_HOSTS` in the slim-test stack env (and confirm the
  canonical compose files / `.env.full.example` already carry it — they do).
  No server-code change; the durable fix is documenting the required env.
- **(b) Server probe-bypass seam** — the `/readyz` litellm probe (and other
  server-controlled internal probes) bypass the user-facing SSRF policy
  entirely, since an internal health ping is not a user-directed fetch.

The advisor must surface the recommended option FIRST with rationale (a
blanket allowlist entry vs a policy-bypass seam have different security
postures). Record the chosen option + rationale in the SUMMARY. If (b), the
seam touches `apps/api/src/config/ssrf.ts` / `apps/api/src/lib/dep-check.ts`;
if (a), the change is env/config + possibly `probes.ts` to report `litellm`
as `skipped` when the host is intentionally absent.

This is a `checkpoint:decision` — the executor pauses for the advisor's
options to be presented and a choice made before B.1.

### Task B.1 — RED+GREEN facet 1 (shape depends on B.0 outcome)

- RED: `apps/api/src/lib/dep-check.test.ts` and/or a `/readyz` integration
  test. Test name MUST contain `R16`. Assert the chosen behavior: with the
  internal litellm host reachable-and-allowed, the litellm dep-check returns
  `{ok:true}` (or, if intentionally absent, `skipped` and NOT counted against
  the `/readyz` aggregate so `/readyz` is 200, not 503).
- GREEN: implement the advisor-chosen option. If `litellm` can legitimately be
  absent on a given deploy, `probes.ts` reports it `skipped` and the aggregate
  ignores it (do not let an intentionally-absent subsystem 503 the probe).
- Commit: `test(59-B): red — R16 readyz litellm SSRF self-block` then
  `fix(59-B): green — R16 <advisor-chosen option>`.

### Task B.2 — RED+GREEN facet 2 (empty-file transcribe → 400)

Facet 2 is independent of the SSRF fix — a missing input guard.

- RED: `apps/api/src/routes/__tests__/transcribe.ts`. Test name MUST contain
  `R16`. POST a zero-byte multipart file part; assert `400` (RED: currently
  the request reaches the upstream and 502s).
- GREEN: `apps/api/src/routes/transcribe.ts` — add a zero-byte / empty-input
  guard that rejects with `400` (use the existing `ValidationError` envelope,
  e.g. `ValidationError("EMPTY_AUDIO", "audio file is empty")`) BEFORE the
  `deps.litellm.audioTranscriptions(...)` call at line 98. The route streams
  `req.raw`; determine the smallest correct empty-detection point — likely
  inspecting the first multipart file part for zero length before forwarding.
  Confirm the guard does not buffer the whole body (SCALE-01 O(1) memory).
- **CLAUDE.md hard rule 1:** if rejecting a zero-byte upload before streaming
  requires buffering the full body (violating the no-buffer contract), HALT +
  `deferred-items.md` — do not silently break the streaming invariant.
- Commit: `test(59-B): red — R16 empty-file transcribe 502 not 400` then
  `fix(59-B): green — R16 reject zero-byte transcribe upload with 400`.

### Verification

```
pnpm --filter @openwhispr/api test -- dep-check
pnpm --filter @openwhispr/api test -- transcribe
grep -rn "R16" apps/api --include="*.test.ts" --include="__tests__/*.ts"
# live stack:
curl -sS http://localhost:4000/readyz -w ' (%{http_code})'   # 200, litellm ok or skipped
printf "" > /tmp/empty.wav
curl -sS -X POST http://localhost:4000/api/transcribe -H "Authorization: Bearer <seed>" \
  -F "file=@/tmp/empty.wav;type=audio/wav" -w ' (%{http_code})'   # (400)
```

---

## Track D — R15: Better-Auth-mounted routes 401 every auth form (re-opens R5)

**Finding:** R15 (HIGH). Three facets (CONTEXT.md §Track D):
(1) `verification-status` made `?email=` REQUIRED — the inverse of R5;
(2)+(3) `verification-status` and `delete-account` 401 a valid session/Bearer.

### Task D.1 — investigation (branches the resolver fix)

`buildRequireCookieOnly` (`require-cookie-only.ts`) deliberately STRIPS
`authorization` and resolves cookie-only — BACKEND_SPEC mandates cookie-only
for these two routes. The R15 live probe shows a **genuine fresh Better Auth
session COOKIE** is ALSO 401'd, so this is a real resolver bug, not a
Bearer-rejection-by-design.

First action — characterize the divergence with a failing test:

- Boot `buildApp` with a real DB. Perform a genuine `POST /api/auth/sign-in/email`
  (or seed-tenant + cookie path), capture the session cookie, then call
  `GET /api/auth/verification-status?email=x` and `DELETE /api/auth/delete-account`
  with that cookie. Assert 200.
- Locate WHY `auth.api.getSession({headers})` returns null for a cookie that
  `sign-in` just minted. Likely causes to check: `cookieOnlyHeaders` drops or
  mangles the `cookie` header; the `__Secure-` cookie prefix vs the request
  scheme mismatch; or `getSession` needs additional request context. Grep
  `sign-in`/`sign-out`'s resolver path and compare.
- **If the divergence is that seed-tenant Bearer tokens are Bearer-middleware-
  only by design** (cookie-only routes correctly reject them) — that alone is
  NOT the bug, because a genuine session COOKIE is also rejected. State the
  Bearer-vs-cookie posture in the SUMMARY but fix the cookie-resolution bug
  regardless.

### Task D.2 — RED+GREEN facet 1 (optional `?email=`)

- RED: a `verification-status` test (`apps/api/src/routes/__tests__/verification-status.ts`)
  named with `R15`/`R5`: `GET /api/auth/verification-status` WITHOUT `?email=`
  + valid session → assert 200 (RED: currently 400 from the required-param
  schema).
- GREEN: make `email` OPTIONAL. The required-ness lives in
  `VerificationStatusQuery` in `@openwhispr/wire-schemas` — grep for it
  (`grep -rn "VerificationStatusQuery" packages/wire-schemas/src`). Change the
  field to `z.string()....optional()`. The handler already discards the value
  (lines 11-18, 59-60) so identity stays session-derived — keep that. Update
  the now-incorrect "REQUIRED" wording in the route header comment (lines
  12-18) to "OPTIONAL per R5".
- **CLAUDE.md hard rule 1:** `VerificationStatusQuery` is a wire-schema
  shared artifact — making `email` optional is a genuine R5-contract fix, not a
  test hack. If another consumer relies on the required-ness, HALT + log it.
- Commit: `test(59-D): red — R15/R5 verification-status requires ?email=` then
  `fix(59-D): green — R15/R5 verification-status ?email= optional`.

### Task D.3 — RED+GREEN facet 2+3 (resolver 401)

- RED: the characterization test from D.1, committed failing — a valid fresh
  session cookie 401s on `verification-status?email=x` and `delete-account`.
  Test name MUST contain `R15`.
- GREEN: fix the resolver divergence located in D.1 — unify
  `verification-status` + `delete-account` onto the SAME working cookie
  resolution `sign-in`/`sign-out` use. Production file:
  `apps/api/src/middleware/require-cookie-only.ts` (and/or the route handlers).
  Keep the cookie-ONLY contract (BACKEND_SPEC) — the fix makes a valid cookie
  RESOLVE, it does NOT add Bearer acceptance.
- **CLAUDE.md hard rule 1:** if the divergence is structural (e.g. Better Auth
  cannot resolve a cookie session inside this Fastify adapter without a wider
  change), HALT + `deferred-items.md` with `WHY:` evidence — do not paper over
  it by relaxing the auth check.
- Commit: `test(59-D): red — R15 better-auth routes 401 a valid session` then
  `fix(59-D): green — R15 unify verification-status/delete-account onto the working resolver`.

### Verification

```
pnpm --filter @openwhispr/api test -- verification-status
pnpm --filter @openwhispr/api test -- delete-account
pnpm --filter @openwhispr/api test -- require-cookie-only
# live stack, with a fresh session cookie from a real sign-in:
curl -sS '.../api/auth/verification-status' -H "Cookie: <fresh-session>" -w ' (%{http_code})'        # 200, no ?email=
curl -sS '.../api/auth/verification-status?email=x' -H "Cookie: <fresh-session>" -w ' (%{http_code})' # 200
curl -sS -X DELETE '.../api/auth/delete-account' -H "Cookie: <fresh-session>" -w ' (%{http_code})'    # 200
```

---

## Track E — R17: API-key name uniqueness scope (owns migration 0028)

**Finding:** R17 (HIGH — tenant-isolation defect). Two distinct seeded
tenants/users cannot both create an API key with the same `name`; the second
gets `409 API_KEY_NAME_TAKEN`.

**Key fact from the schema:** `api_keys_active_name_idx` is ALREADY
`UNIQUE (tenant_id, name) WHERE revoked_at IS NULL` (migration 0010 lines
39-42) — it is NOT global on `name`. The R17 live repro 409'd because in v1
both seed-tenants resolve to the **same default tenant** (CLAUDE.md §Constraints
item 16 — single-installation-single-tenant RLS posture). So `(tenant_id, name)`
does NOT distinguish two seeded owners; the real per-owner namespace is the
**user**.

### Task E.1 — scope determination (MANDATORY FIRST)

Before writing the migration, the executor MUST establish the correct scope
from the schema + the BYOK ownership model:

- Inspect `apps/api/src/routes/v1/keys/create.ts`, `list.ts`, and any
  `revoke`/`delete` keys route — is an API key conceptually owned by a
  `tenant` or by a `user`? (`api_keys` has both `tenant_id` and `user_id`
  NOT NULL.)
- The R17 client requirement explicitly accepts either `(tenant_id, name)` OR
  `(user_id, name)`. Given v1's single-default-tenant posture, `(tenant_id,
  name)` is functionally global within an installation — so the correct,
  R17-satisfying scope is almost certainly **`(user_id, name)`**: two distinct
  users (the two seeded tenants) must each be able to hold a key named `X`.
- Confirm this against the BYOK model and the create/list handlers. Record the
  determination + evidence in the SUMMARY. If the handlers reveal a genuine
  tenant-owned (not user-owned) model that contradicts this, HALT + raise it as
  an open question rather than guessing.

### Task E.2 — RED+GREEN

- RED: `apps/api/src/routes/v1/keys/__tests__/create.ts`. Test name MUST
  contain `R17`. Real Postgres. Two scenarios:
  1. Two distinct owners (two `user_id`s — seed two tenants) each
     `POST /api/v1/keys/create` with the identical `name` → assert BOTH 200
     (RED: the second 409s under the current `(tenant_id, name)` index because
     both share the default tenant).
  2. The SAME owner creating two active keys with the same `name` → assert the
     second 409s `API_KEY_NAME_TAKEN` (regression guard — the fix must NOT
     remove same-owner protection).
- GREEN — migration `0028` + schema + (if needed) the create-route comment:
  1. `packages/data/migrations/0028_api_keys_name_scope.sql` —
     `DROP INDEX IF EXISTS api_keys_active_name_idx;` then
     `CREATE UNIQUE INDEX api_keys_active_name_idx ON api_keys
     (<determined-scope>, name) WHERE revoked_at IS NULL;` where
     `<determined-scope>` is `user_id` (per E.1, unless E.1 establishes
     otherwise). Keep the partial `WHERE revoked_at IS NULL` predicate so a
     revoked name can be re-used.
  2. Companion `0028_api_keys_name_scope.down.sql` — reverse: drop the new
     index, recreate the `(tenant_id, name)` one.
  3. Register `0028` in `packages/data/migrations/meta` / the drizzle journal
     per the existing convention (match how `0027` is registered).
  4. `packages/data/src/schema/api_keys.ts` — if the index is declared in the
     drizzle schema (it currently is NOT — it lives only in raw SQL), leave the
     schema file as-is; if a drizzle index entry exists elsewhere update it to
     match. Update the header comment (lines 11-13) which says "per tenant".
  5. The `23505` → `409 API_KEY_NAME_TAKEN` mapping in `create.ts` stays — it
     now fires correctly only for a same-owner reuse. Update the D-30 comment
     (lines 22-24, 130-131) to the new scope.
- Key invariant: two distinct owners can hold the same active key name; the
  same owner cannot.
- **CLAUDE.md hard rule 1:** the migration is a genuine R17-driven correctness
  fix, not a test hack — compliant. But if the test exposes that the
  create-route resolves `user_id` in a way that breaks the new index, HALT
  rather than mutate production solely to green the test.
- Commit: `test(59-E): red — R17 api-key name uniqueness leaks across owners` then
  `fix(59-E): green — R17 scope api-key name uniqueness to the owner (migration 0028)`.

### Verification

```
pnpm --filter @openwhispr/data test
pnpm --filter @openwhispr/api test -- keys/create
ls packages/data/migrations/0028_api_keys_name_scope.sql \
   packages/data/migrations/0028_api_keys_name_scope.down.sql
grep -rn "R17" apps/api/src/routes/v1/keys/__tests__/
# live stack: two distinct seeded tenants create a key with the same name → both 200;
#             same tenant reusing the name → 409.
```

---

## Track F — Annotate the client work-order (FINAL TASK)

After A–E are all green and verified, annotate the client repo's
`SERVER-REQUIREMENTS.md` (editable — it lives in `/Users/dev/openwhispr/`, a
different repo, NOT part of this repo's git):

- File: `/Users/dev/openwhispr/.planning/phases/08-client-server-audit/SERVER-REQUIREMENTS.md`
- For each of R14, R15, R16, R17, R18 — and R5 (folded into R15) — append a
  closure marker with the server commit SHA(s): e.g.
  `**Status:** CLOSED 2026-05-20 — server commit <sha> (Phase 59).` R18 gets
  either the fix SHA or `CLOSED not-reproducible — re-probe log <path>`.
- Do NOT commit this file in the openwhispr-server repo (it is not tracked
  here). Commit it in the `/Users/dev/openwhispr/` repo if that repo's
  workflow expects it, otherwise leave the edit for the client team — state
  which in the SUMMARY.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| non-browser client → /api/auth/sign-in/email | An undici `Origin: null` request crosses the Better Auth CSRF gate (R18). |
| desktop client → /api/auth/verification-status, /delete-account | A session credential crosses the cookie-only auth boundary (R15). |
| api process → internal compose services (litellm) | The server's own outbound SSRF guard mediates first-party internal calls (R16). |
| tenant/user A → api_keys namespace | One owner's key-name choices must not constrain or reveal another owner's namespace (R17). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-59-01 | Spoofing / Tampering (CSRF) | sign-in/email Origin gate | mitigate | If R18 reproduces, the null-Origin acceptance is double-gated on `OPENWHISPR_TEST_ROUTES==="true"` AND `NODE_ENV!=="production"` — production never relaxes the CSRF gate. No `trustedOrigins:['*']`. (Track C) |
| T-59-02 | Elevation of privilege | better-auth route resolver | mitigate | Track D fixes a valid cookie to RESOLVE; it does NOT add Bearer acceptance — the cookie-only BACKEND_SPEC contract is preserved, so the account-deletion replay-after-rotation property still holds. |
| T-59-03 | Server-side request forgery | SSRF outbound guard | mitigate | Track B advisor-gates the fix: an allowlist entry is limited to first-party internal compose hostnames (not user-supplied URLs); a probe-bypass seam, if chosen, is restricted to server-controlled internal health pings. The user-facing SSRF policy on user-directed fetches is unchanged. |
| T-59-04 | Information disclosure | api_keys name uniqueness | mitigate | Track E scopes the unique index to the owner so a 409 no longer reveals another owner's key-name existence (cross-tenant info leak closed). |
| T-59-05 | Denial of service | /api/transcribe input | mitigate | Track B facet 2 rejects a zero-byte upload with 400 before any upstream call — a malformed input can no longer consume an upstream round-trip. |
| T-59-06 | Repudiation / availability | /api/_test/seed-tenant 500 | accept | The opaque 500 leaks no data; R14 fixes it to an honest idempotent 200. Test-only route, production-404'd by the NODE_ENV gate — low residual risk. |
</threat_model>

<verification>
Phase-level gate (run after all tracks):

```
pnpm --filter @openwhispr/api test
pnpm --filter @openwhispr/data test
pnpm lint:lockers          # 8 lockers green — esp. LOCKER-01 (no NODE_ENV branch
                           # leaked into auth.ts), LOCKER-04 (route schema+rateLimit)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
                           # (assemblyai.ts / deepgram.ts + 3 others)
git log --oneline -16      # RED/GREEN pairs for A, (C), B×2, D×2, E + the Track F doc commit
```

Live-stack re-verification (slim-test stack, api on localhost:4000,
`NODE_ENV=development`, `OPENWHISPR_TEST_ROUTES=true`) — run the per-track
verification curls above; all must satisfy the CONTEXT.md §Verification gate
items R14/R15/R16/R17/R18.

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "R14\|R15\|R16\|R17\|R18\|R5" apps/api packages/data --include="*.test.ts"` —
  every fixed track has a test referencing its finding ID.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `.planning/phases/59-client-e2e-server-followups/r18-reprobe.log` exists and is committed.
</verification>

<success_criteria>
- R14: RED+GREEN pair — re-seeding a known email returns 200, never 500.
- R15/R5: RED+GREEN pairs — `verification-status` accepts a missing `?email=`
  (200, not 400); `verification-status` + `delete-account` resolve a valid
  session (200, not 401).
- R16: RED+GREEN pairs — `/readyz` 200 (litellm ok or honestly `skipped`);
  empty-file `transcribe` → 400; advisor-chosen option recorded in SUMMARY.
- R17: RED+GREEN pair — migration `0028` (+ `.down.sql`) drops the current
  `api_keys` name index and adds the owner-scoped one; two distinct owners can
  hold the same key name, same owner still 409s; scope determination recorded.
- R18: EITHER a RED+GREEN pair (gated null-Origin acceptance) OR a committed
  `r18-reprobe.log` + a not-reproducible closure note — whichever C.1 establishes.
- `pnpm test` green for api + data; `pnpm lint:lockers` green (8);
  `pnpm typecheck` no new errors vs the 5-error baseline.
- Client repo `SERVER-REQUIREMENTS.md` R14–R18 + R5 annotated with closure
  markers + server commit SHA(s).
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- Any HALT logged in `.planning/deferred-items.md` with `WHY:` evidence.
</success_criteria>

<risk_register>
| Risk | Track | Mitigation |
|------|-------|------------|
| R14 fix string-matches a Better Auth error code that is not stable across versions. | A | RED step greps the actual Better Auth package for the duplicate-email error code; assert the real code. HALT if no stable discriminator exists. |
| R18 production fix written for a 403 that does not actually reproduce. | C | C.1 is a mandatory verify-first Node-fetch re-probe; the track branches to no-op closure if the 403 does not reproduce. |
| R16 SSRF fix over-broadens the outbound policy. | B | B.0 advisor gate — the fix is limited to first-party internal compose hostnames or a server-controlled-probe seam; user-directed fetch policy unchanged. |
| R16 empty-file guard forces buffering the whole upload (breaks O(1)-memory streaming). | B | GREEN inspects only the first multipart part length before forwarding; HALT + deferred-items if a zero-byte check cannot be done without buffering. |
| R15 resolver bug is structural in the Better Auth Fastify adapter. | D | D.1 characterization-test investigation first; HALT + deferred-items with WHY if the divergence cannot be fixed without weakening the cookie-only contract. |
| R17 wrong scope chosen — `(tenant_id,name)` is global in v1's single-tenant posture. | E | E.1 mandatory scope-determination step inspects the BYOK ownership model; `(user_id, name)` is the expected answer; HALT if the handlers contradict it. |
| Migration number clash. | E | 0027 is taken by Phase 58; Track E uses **0028**. Verified against `packages/data/migrations/`. |
| LOCKER-01 false-positive on a NODE_ENV gate in auth.ts (R18). | C | The gate boolean is computed in `config/*`/`bootstrap.ts` and passed in; no NODE_ENV comparison in `auth.ts`. Confirm `pnpm lint:lockers` green. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: HALT, log in `.planning/deferred-items.md` with WHY evidence, report — never edit production solely to green a test. |
</risk_register>

<output>
After completion, create
`.planning/phases/59-client-e2e-server-followups/59-01-SUMMARY.md`.

In the SUMMARY, explicitly record:
- Track C branch taken (R18 fixed vs closed not-reproducible) + the re-probe
  log outcome.
- Track B advisor-chosen option (config-only vs probe-bypass seam) + rationale.
- Track E scope determination (`user_id` vs `tenant_id`) + the BYOK-model
  evidence, and the assigned migration number (0028).
- Track A: the exact Better Auth duplicate-email error code matched.
- Track D: the resolver divergence located + whether it was fixed in
  `require-cookie-only.ts` or the route handlers.
- Any HALT + `.planning/deferred-items.md` entries.
- Whether the client-repo `SERVER-REQUIREMENTS.md` annotation was committed in
  the openwhispr repo or left for the client team.
</output>
