---
phase: 62-high-findings-api-core
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/index.ts
  - apps/api/src/routes/__test/fetch.ts
  - apps/api/src/routes/__test/__tests__/fetch.test.ts
  - apps/api/src/error-handler.ts
  - apps/api/src/error-handler.test.ts
  - apps/api/src/routes/transcribe.ts
  - apps/api/src/routes/reason.ts
  - apps/api/src/routes/diarization.ts
  - apps/api/src/routes/tokens/assemblyai.ts
  - apps/api/src/routes/tokens/deepgram.ts
  - apps/api/src/routes/tokens/openai-realtime.ts
  - apps/api/src/lib/mint-bearer.ts
  - apps/api/src/lib/__tests__/mint-bearer.test.ts
  - apps/api/src/lib/token-rotation.ts
  - apps/api/src/lib/__tests__/token-rotation.test.ts
  - apps/api/tests/**  (integration tests — exact files decided per-finding)
  - .planning/deferred-items.md
  - .planning/review/api-core.md
  - .planning/review/REVIEW-INDEX.md
autonomous: true
requirements: ["HI-01", "HI-02", "HI-03", "HI-04", "HI-05"]

must_haves:
  truths:
    - "HI-01 is confirmed already-closed: auth.ts consumes validateIngressBoot().ingressBaseUrl with NO http://localhost literal fallback — evidence recorded, no production change."
    - "Setting OPENWHISPR_TEST_ROUTES=true with NODE_ENV=production does NOT register the /__test/fetch debug route — registration is vetoed in production."
    - "A route throwing `new ServiceUnavailable(<interpolated-upstream-text>)` no longer echoes that text to the wire envelope — the client sees the class-default literal."
    - "The OIDC discovery cache is bounded (size + TTL) and the fetched discovery doc is zod-validated before caching; an expired entry is re-fetched."
    - "HI-05 is EITHER fixed (the follow-up email SELECT is tenant-scoped via withTenant() or AND tenant_id predicate) OR HALTed to deferred-items with documented WHY if a cleanly-fixable api-core-side change is not possible."
  artifacts:
    - path: ".planning/phases/62-high-findings-api-core/verify-first.log"
      provides: "per-finding verify-first determination — live/partial/closed with file:line evidence for HI-01..HI-05"
      contains: "HI-01"
    - path: ".planning/review/api-core.md"
      provides: "per-finding closure markers appended to HI-01..HI-05"
      contains: "CLOSED"
  key_links:
    - from: "apps/api/src/index.ts"
      to: "buildDebugFetchRoutes registration"
      via: "NODE_ENV==='production' veto guarding app.register"
      pattern: "production"
    - from: "apps/api/src/error-handler.ts"
      to: "ServiceUnavailable / RateLimitError wire envelope"
      via: "class-default literal replaces errMessage echo"
      pattern: "Service temporarily unavailable"
    - from: "apps/api/src/lib/mint-bearer.ts"
      to: "OIDC discovery doc"
      via: "zod-validated, TTL-bounded cache entry"
      pattern: "expires"
---

<objective>
Clear the five HIGH security findings in the `apps/api` core surface
(`.planning/review/api-core.md`, HI-01..HI-05). Each finding is re-verified
against current `main` BEFORE any fix; an already-closed finding is marked
with evidence and skipped (CLAUDE.md hard rule 3 — never invent a fix for a
non-bug). Each live finding is closed via strict RED→GREEN TDD.

Purpose: remove the highest-risk pre-publication security gaps in api-core —
an unsecured-cookie default, a production-mountable arbitrary-URL fetcher,
upstream-message leakage through the error envelope, an unbounded/unvalidated
OIDC discovery cache, and a cross-tenant unscoped SELECT.

Output: per-finding RED+GREEN atomic commit pairs (test + production code in
the same commit), a `verify-first.log` evidence record, any HALT logged in
`.planning/deferred-items.md`, and `.planning/review/api-core.md` +
`REVIEW-INDEX.md` annotated with per-finding closure markers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/62-high-findings-api-core/CONTEXT.md
@.planning/review/api-core.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read to "check one
more thing"; use Grep for anything more specific):

- `apps/api/src/auth.ts:430` — `baseURL: validateIngressBoot().ingressBaseUrl`.
  The `?? "http://localhost:3000"` literal HI-01 reports is **already gone**
  (Phase 57 Track E). HI-01 is a confirmed already-closed finding — see Task 1.
- `apps/api/src/config/auth.ts` — `validateAuthBoot()`, `validateIngressBoot()`,
  `validateOriginBoot()`. `validateIngressBoot()` returns `ingressBaseUrl`,
  refuses boot (exit 78) when neither `INGRESS_BASE_URL` nor `AUTH_URL` is set,
  and refuses non-HTTPS under `NODE_ENV=production`. This module is the
  LOCKER-01-allowlisted home for `NODE_ENV` reads in the auth pathway.
- `apps/api/src/index.ts:614-622` — `buildDebugFetchRoutes()` registration is
  gated `NODE_ENV==='test' || OPENWHISPR_TEST_ROUTES==='true'` — the OLD style.
  It does NOT carry the `NODE_ENV!=='production'` veto Phase 57 Track C added
  to the `/api/_test/*` plugin gate (`test-only.ts:205-215`:
  `process.env.NODE_ENV !== "production" && (NODE_ENV==='test' || OPENWHISPR_TEST_ROUTES==='true')`).
  HI-02 is STILL LIVE.
- `apps/api/src/routes/__test/fetch.ts:52-68` — the plugin's own belt-and-
  suspenders gate (`TEST_NODE_ENVS.has(NODE_ENV) || OPENWHISPR_TEST_ROUTES==='true'`)
  is ALSO old-style — no production veto. Both gates must get the veto.
- `apps/api/src/error-handler.ts:132-227` — typed-error mapping. HI-03 LIVE:
  `:135` ZodError emits `err.issues[0].message`; `:152` fastify-validation
  emits `errMessage`; `:180` `RateLimitError` emits `errMessage`; `:187`
  `ServiceUnavailable` emits `errMessage`. The header comment (`:24-26`) claims
  the default path "NEVER leaks the underlying message" — true for the
  default + APIError branches, false for these four. `ValidationError` (`:155`)
  intentionally echoes caller text (per-site i18n code contract) — leave it.
- `apps/api/src/errors.ts:45-54` — `pickCodeAndMessage(defaultCode, arg1, arg2)`:
  single-arg constructor → `code=defaultCode, message=arg1`. So
  `new ServiceUnavailable(err.message)` yields `code='SERVICE_UNAVAILABLE'`,
  `message=<upstream text>` — the upstream text reaches the wire today.
- `throw new ServiceUnavailable(...)` route sites (HI-03 audit scope):
  `transcribe.ts:217` `new ServiceUnavailable(err.message)`,
  `reason.ts:118` `new ServiceUnavailable(err.message)`,
  `diarization.ts:191` `new ServiceUnavailable(err.message)`,
  `diarization.ts:360` `new ServiceUnavailable("PYANNOTE_UNAVAILABLE", "pyannote.ai upstream unavailable")` — code+literal pair, SAFE,
  `tokens/assemblyai.ts:106` `new ServiceUnavailable(r.message)`,
  `tokens/assemblyai.ts:111` `new ServiceUnavailable("AssemblyAI token mint malformed response")` — single-arg static literal, low-risk but still leaks the literal,
  `tokens/deepgram.ts:72` `new ServiceUnavailable(r.message)`,
  `tokens/deepgram.ts:81` static literal,
  `tokens/openai-realtime.ts:185` `new ServiceUnavailable(failed.message)`,
  `tokens/openai-realtime.ts:193` static literal.
  NO `new RateLimitError(...)` throw sites in routes — the 429 path is the
  Better Auth / `@fastify/rate-limit` plugin's `fv.statusCode===429` branch.
- `apps/api/src/lib/mint-bearer.ts:118` — `discoveryCache = new Map<string, OidcDiscoveryDoc>()`,
  process-lifetime, no TTL, no size bound. `:142` `(await res.json()) as OidcDiscoveryDoc`
  is an unchecked cast; `:217` `(await tokenRes.json()) as OidcTokenResponse`
  same. `__resetOidcDiscoveryCacheForTests()` (`:148`) exists as a test seam.
  `OidcDiscoveryDoc` (`:95-98`): `{ token_endpoint?, userinfo_endpoint? }`.
- `apps/api/src/lib/token-rotation.ts:121-171` — `tryPreviousToken`. The first
  SELECT (`:140`) is on `sessions` (RLS-policed). The follow-up
  `SELECT email FROM users WHERE id = ${first.user_id}::uuid` (`:162`) runs
  with NO `withTenant()` binding and NO `tenant_id` predicate. The comment
  (`:155-158`) admits it "bypasses RLS deliberately". `withTenant` is already
  imported from `@openwhispr/data` (`:39`). HI-05 STILL LIVE.

<interfaces>
ServiceUnavailable / RateLimitError (errors.ts):
  constructor(arg1?, arg2?) — single-arg → code=default, message=arg1;
  two-arg → code=arg1, message=arg2. `.code` is readonly.

error-handler typed-error branches emit `message` then `localize(req, code, message)`.
The class-default English literals already in error-handler.ts:
  RateLimitError    -> "Too many requests"
  ServiceUnavailable-> "Service temporarily unavailable"
  fastify-validation-> "Invalid request"
  ZodError          -> "Invalid request"

token-rotation.tryPreviousToken(db, bearerToken) -> PreviousTokenMatch | null
  PreviousTokenMatch = { userId, tenantId, email: string | null }
  withTenant(db, tenantId, async (tx) => ...) — imported from @openwhispr/data.

discoverOidc(issuerUrl) -> Promise<OidcDiscoveryDoc>
  OidcDiscoveryDoc = { token_endpoint?: string; userinfo_endpoint?: string }
</interfaces>

apps/api integration tests use `@testcontainers/postgresql` (real Postgres +
PgBouncer + Valkey) — no HTTP/internal mocks (CLAUDE.md: mocks only at
process/network boundaries). Follow the established `describe.skipIf(SKIP)`
docker-availability pattern. Unit tests for pure logic (error-handler,
mint-bearer cache) need no docker.
</context>

## Phase Goal

Close HI-01..HI-05 — each either fixed via strict RED→GREEN TDD with the test
asserting the regression-shape, OR confirmed already-resolved with committed
evidence, OR HALTed to `.planning/deferred-items.md` (HI-05's grey-area
branch). HI-01 is expected to be a verify-only no-op.

---

## Verify-first protocol (MANDATORY, all findings)

Before any fix the executor writes
`.planning/phases/62-high-findings-api-core/verify-first.log` and, per finding,
records: **still-live / partially-mitigated / already-closed**, with the
`file:line` evidence checked. A finding marked already-closed gets NO
production change and NO RED test — only the log entry + the closure marker in
Task 7. This is the planner's pre-determination (executor MUST re-confirm):

- **HI-01 — ALREADY CLOSED.** `auth.ts:430` reads
  `baseURL: validateIngressBoot().ingressBaseUrl`; the `?? "http://localhost:3000"`
  literal is gone (Phase 57 Track E). `validateIngressBoot()` refuses boot when
  no origin is set and refuses non-HTTPS in production. Executor confirms with
  `grep -n 'localhost:3000\|ingressBaseUrl' apps/api/src/auth.ts` — if the
  literal is genuinely absent, HI-01 is closed-by-Phase-57. No fix.
- **HI-02 — STILL LIVE.** `index.ts:620` + `fetch.ts:63-65` both old-style.
- **HI-03 — STILL LIVE.** `error-handler.ts:152,180,187` echo `errMessage`;
  ten `new ServiceUnavailable(...)` route sites, several single-arg.
- **HI-04 — STILL LIVE.** `mint-bearer.ts:118` unbounded Map, `:142` unchecked cast.
- **HI-05 — STILL LIVE.** `token-rotation.ts:162` unscoped follow-up SELECT.

Commit the log: `docs(62-01): verify-first — HI-01..HI-05 disposition log`.

---

## Task 1 — HI-01: confirm already-closed, no fix

**Finding:** HI-01 (HIGH) — `AUTH_URL` default `http://localhost:3000`.

**Determination:** Phase 57 Track E replaced the literal with
`validateIngressBoot().ingressBaseUrl`. The boot validator refuses to start
when no origin is configured and refuses non-HTTPS under `NODE_ENV=production`.

### Action

- Re-confirm: `grep -n 'localhost:3000' apps/api/src/auth.ts` returns nothing
  in the `baseURL` position; `grep -n 'validateIngressBoot' apps/api/src/auth.ts`
  shows it consumed at the `baseURL` line.
- Record in `verify-first.log`: HI-01 already-closed, evidence
  `auth.ts:430 baseURL: validateIngressBoot().ingressBaseUrl`, Phase 57 Track E
  closure ref `validateIngressBoot` in `config/auth.ts:143`.
- **No RED test, no production change.** If the executor's grep contradicts
  this (literal still present) — STOP, treat HI-01 as live, and add a RED+GREEN
  pair consuming `validateIngressBoot().ingressBaseUrl`; report the divergence.

### Verify
```
grep -n "localhost:3000" apps/api/src/auth.ts   # expect: no baseURL match
grep -n "ingressBaseUrl" apps/api/src/auth.ts   # expect: baseURL line present
```

### Done
HI-01 recorded already-closed in `verify-first.log` with evidence; no commit
beyond the log.

---

## Task 2 — HI-02: production veto on the /__test/fetch debug route

**Finding:** HI-02 (HIGH) — `buildDebugFetchRoutes()` registers on
`OPENWHISPR_TEST_ROUTES==='true'` regardless of `NODE_ENV`. A misset env in
production mounts an unauthenticated arbitrary-URL fetcher.

**Chosen fix:** apply the SAME `NODE_ENV!=='production'` veto Phase 57 Track C
applied to `test-only.ts:212` — at BOTH gate sites (index.ts registration +
fetch.ts plugin self-gate, defense in depth).

### RED step
- File: `apps/api/src/routes/__test/__tests__/fetch.test.ts` (extend the
  existing debug-fetch suite; create if absent). Test name MUST contain `HI-02`.
- Scenario: with `NODE_ENV='production'` AND `OPENWHISPR_TEST_ROUTES='true'`,
  register `buildDebugFetchRoutes()` on a Fastify instance and assert
  `POST /__test/fetch` returns 404 (route NOT registered). Pre-fix this 200s /
  reaches the handler — RED fails.
- Use the existing `app.inject` pattern; set env via the test's env-snapshot
  helper, restore in `afterEach`.
- Commit: `test(62-02): red — HI-02 debug-fetch mounts under prod OPENWHISPR_TEST_ROUTES`.

### GREEN step
- `apps/api/src/routes/__test/fetch.ts:63-65` — change the `gated` expression to
  `process.env.NODE_ENV !== "production" && (TEST_NODE_ENVS.has(...) || OPENWHISPR_TEST_ROUTES==='true')`.
  Update the header comment (`:7,18-23,56-62`) to state the production veto.
- `apps/api/src/index.ts:620` — change the registration `if` to
  `if (process.env.NODE_ENV !== "production" && (process.env.NODE_ENV === "test" || process.env.OPENWHISPR_TEST_ROUTES === "true"))`.
  Update the comment block (`:614-619`).
- **LOCKER-01:** `index.ts` (entrypoint) and `routes/__test/fetch.ts` —
  confirm both are in the LOCKER-01 allowlist for `NODE_ENV` reads. `index.ts`
  is the entrypoint (allowlisted). `fetch.ts` already reads `NODE_ENV` at
  `:64` today (pre-existing), so adding the `!== "production"` term in the
  same expression does not introduce a NEW file to the allowlist — but run
  `pnpm lint:lockers` and, if LOCKER-01 flags `fetch.ts`, the gate boolean
  must be computed in a `config/*` module and passed into
  `buildDebugFetchRoutes()` as a dep. HALT + raise as an open question if the
  allowlist edit is non-trivial — do not silently widen the allowlist.
- Commit: `fix(62-02): green — HI-02 veto debug-fetch registration in production`.

### Verify
```
pnpm --filter @openwhispr/api test -- fetch
grep -n "production" apps/api/src/routes/__test/fetch.ts apps/api/src/index.ts
pnpm lint:lockers
```

---

## Task 3 — HI-03a: stop the error-handler echoing upstream messages

**Finding:** HI-03 (HIGH), error-handler facet. `error-handler.ts` echoes
`err.message` for ZodError, fastify-validation, `RateLimitError`,
`ServiceUnavailable` — violating the header's "NEVER leaks the underlying
message" contract.

**Chosen fix:** emit the class-default literal for the four typed-error
branches that currently echo. `ValidationError` keeps caller text (its
per-site i18n-code contract is intentional — `errors.ts:20-21`). The `code`
field is still set so i18n localization is unaffected.

### RED step
- File: `apps/api/src/error-handler.test.ts` (extend). Test name MUST contain
  `HI-03`. Scenarios — each asserts the wire envelope `error` field does NOT
  contain the interpolated text:
  1. `throw new ServiceUnavailable("postgres pool exhausted: secret-suffix")`
     → 503, envelope `error === "Service temporarily unavailable"` (NOT the
     pool string).
  2. `throw new RateLimitError("burst from 10.1.2.3 over quota")` → 429,
     envelope `error === "Too many requests"`.
  3. A ZodError with an issue message echoing an input path → 400, envelope
     `error === "Invalid request"` (NOT the issue message).
  4. A Fastify-validation error → 400, envelope `error === "Invalid request"`.
  Pre-fix all four FAIL (the envelope carries the interpolated text).
- Commit: `test(62-03): red — HI-03 error-handler echoes typed-error messages`.

### GREEN step
- `apps/api/src/error-handler.ts`:
  - `:135` ZodError — `message = "Invalid request"` (drop `err.issues[0].message`).
  - `:152` fastify-validation — `message = "Invalid request"` (drop `errMessage`).
  - `:180` `RateLimitError` — `message = "Too many requests"` (drop `errMessage`).
  - `:187` `ServiceUnavailable` — `message = "Service temporarily unavailable"`
    (drop `errMessage`).
  - Leave `:155` `ValidationError` (intentional caller text), `:159` `AuthError`,
    `:163` `NotFoundError`, `:169` `ConflictError`, `:176` `UpstreamError`,
    `:194` `ServerError` — these either already use class defaults or carry an
    intentional per-site code contract; do NOT change them unless a RED test
    proves a leak. Keep each branch's `code = err.code` assignment so i18n
    still localizes via `errors.<code>`.
  - Update the header comment (`:24-26`) so it is TRUE for every branch.
- Coordinate with LOCKER-05 (secret-shape-in-error): this change is a
  strengthening — the envelope can no longer carry an interpolated upstream
  string. No allowlist change needed; note it in the SUMMARY.
- Commit: `fix(62-03): green — HI-03 emit class-default literal for typed errors`.

### Verify
```
pnpm --filter @openwhispr/api test -- error-handler
grep -n "errMessage" apps/api/src/error-handler.ts   # remaining echoes only on intentional branches
```

---

## Task 4 — HI-03b: audit ServiceUnavailable route throw sites

**Finding:** HI-03 audit facet. Routes throw `new ServiceUnavailable(err.message)`
with single-arg interpolated upstream text.

**Note:** Task 3 already neutralizes the wire leak (the handler now emits the
class default for `ServiceUnavailable`). Task 4 is defense-in-depth at the
SOURCE — the throw sites should pass a code+literal pair so the intent is
explicit, the upstream detail is logged server-side via `req.log.warn({err})`
(already happens at `error-handler.ts:233`), and a future handler change
cannot re-leak. This is a discrete audit task per CONTEXT.md.

### RED step
- File: an integration / route test asserting the envelope from a route whose
  upstream fails. Reuse the existing `transcribe` / `reason` / `diarization`
  test suites where an upstream-failure path already exists; add a test named
  with `HI-03` asserting `POST /api/transcribe` on an upstream `ServiceUnavailable`
  returns 503 with envelope `error === "Service temporarily unavailable"` and
  NOT the upstream `err.message`. With Task 3 merged this already passes at the
  wire — so the RED here is at the THROW level: assert (unit) that the thrown
  `ServiceUnavailable.message` is a fixed literal, not the interpolated upstream
  string. If Task 3's wire test fully covers the regression-shape, the executor
  MAY fold this into Task 3's commit and skip a separate RED — record the
  decision in the SUMMARY.
- Commit (if separate): `test(62-04): red — HI-03 SU route sites carry upstream text`.

### GREEN step
- Convert each single-arg interpolated throw to a code+literal pair so no
  upstream string is carried on `.message`:
  - `transcribe.ts:217` `new ServiceUnavailable(err.message)` →
    `new ServiceUnavailable("UPSTREAM_UNAVAILABLE", "Service temporarily unavailable")`.
  - `reason.ts:118` — same.
  - `diarization.ts:191` — same.
  - `tokens/assemblyai.ts:106` `new ServiceUnavailable(r.message)` → code+literal pair.
  - `tokens/deepgram.ts:72` — same.
  - `tokens/openai-realtime.ts:185` `new ServiceUnavailable(failed.message)` — same.
  - `diarization.ts:360` is ALREADY a code+literal pair — leave it.
  - The static-literal single-arg sites (`assemblyai.ts:111`, `deepgram.ts:81`,
    `openai-realtime.ts:193`) carry no upstream interpolation — convert to a
    code+literal pair for consistency, low-risk, no behavior change.
- The upstream `err.message` is STILL logged server-side: confirm each route's
  catch path logs the original error (via `req.log` or the handler's
  `req.log.warn({err})`) so operator triage is not lost — if a route swallows
  the original detail, add a `req.log.warn` BEFORE the re-throw. Do NOT delete
  diagnostic logging.
- **CLAUDE.md hard rule 1:** if converting a throw site changes route behavior
  (e.g. a test depended on the interpolated message), that test was asserting a
  leak — fix the test to assert the literal; this is a genuine HI-03 fix, not a
  test hack. If a route's upstream-failure path has NO existing test, add a
  minimal one rather than editing production blind.
- Commit: `fix(62-04): green — HI-03 audit ServiceUnavailable route throw sites`.

### Verify
```
grep -rn "new ServiceUnavailable(" apps/api/src/routes --include="*.ts" | grep -v "__tests__"
# every match is now a two-arg (code, literal) pair
pnpm --filter @openwhispr/api test -- transcribe reason diarization tokens
```

---

## Task 5 — HI-04: bound + validate the OIDC discovery cache

**Finding:** HI-04 (HIGH) — `mint-bearer.ts` `discoveryCache` is unbounded, has
no TTL, and `await res.json() as OidcDiscoveryDoc` is an unchecked cast. A
poisoned discovery response (token-endpoint swap) is cached for process life →
`client_secret` can be sent to an attacker endpoint.

### RED step
- File: `apps/api/src/lib/__tests__/mint-bearer.test.ts` (extend; create if
  absent). Test name MUST contain `HI-04`. Use `__resetOidcDiscoveryCacheForTests()`
  between cases. Inject a fetch stub (process/network boundary — mock allowed).
  Scenarios:
  1. **Schema validation:** `discoverOidc` against a stub returning
     `{ token_endpoint: "not-a-url" }` or a missing `token_endpoint` → assert
     it THROWS (rejects), and the bad doc is NOT cached.
  2. **HTTPS / same-origin:** a discovery doc whose `token_endpoint` is
     `http://...` or a different origin than the issuer → assert it throws.
  3. **TTL expiry:** stub returns a valid doc; call `discoverOidc` twice within
     TTL → fetch invoked once (cached). Advance time past TTL (inject a clock
     or expose a test seam) → next call re-fetches.
  - Pre-fix: (1)+(2) do NOT throw (unchecked cast accepts anything); (3) never
    re-fetches (no TTL). RED fails.
- Commit: `test(62-05): red — HI-04 OIDC discovery cache unbounded + unvalidated`.

### GREEN step
- `apps/api/src/lib/mint-bearer.ts`:
  - Add a zod schema for `OidcDiscoveryDoc` — `token_endpoint` and
    `userinfo_endpoint` required, each `z.string().url()` and MUST be `https://`.
    Validate the doc with `.parse()` BEFORE caching; a parse failure throws
    (caught by the existing `mintBearer` fail-fast path → clean error, no
    network call to a poisoned endpoint).
  - Enforce same-origin (or issuer-origin) on `token_endpoint` /
    `userinfo_endpoint`: parse both URLs and assert `.origin` matches the
    issuer's origin. If a non-affiliated origin is needed, gate it behind an
    explicit env allowlist (`OIDC_DISCOVERY_ALLOWED_ORIGINS`, csv) — document
    in the SUMMARY; default-deny.
  - Replace the bare `Map` with a bounded TTL cache: store
    `{ doc, expiresAt }`; on read, treat an entry past `expiresAt` as a miss
    and re-fetch. Cap size (e.g. 16 issuers) — evict oldest on overflow. TTL
    ~60 min positive. Keep `__resetOidcDiscoveryCacheForTests()` working.
  - Apply the same `z.object` validation to the token response at `:217`
    (`OidcTokenResponse` — `access_token` required non-empty string) so a
    malformed token response fails loud, not via an unchecked cast.
- **LOCKER-03 / no-hardcode:** no new `localhost`/URL literals — the schema
  uses `z.string().url()`, origins come from the issuer or env. Confirm
  `pnpm lint:lockers` stays green.
- **CLAUDE.md hard rule 1:** if the same-origin constraint breaks a legitimate
  IdP topology (token endpoint on a sibling domain) and the env-allowlist
  escape hatch is insufficient, HALT + `.planning/deferred-items.md` with WHY —
  do not weaken the validation to green a test.
- Commit: `fix(62-05): green — HI-04 bound + zod-validate OIDC discovery cache`.

### Verify
```
pnpm --filter @openwhispr/api test -- mint-bearer
grep -n "expiresAt\|\.url()\|origin" apps/api/src/lib/mint-bearer.ts
pnpm lint:lockers
```

---

## Task 6 — HI-05: tenant-scope the tryPreviousToken follow-up email SELECT (GREY-AREA)

**Finding:** HI-05 (HIGH) — `token-rotation.ts:162` runs
`SELECT email FROM users WHERE id = ${first.user_id}::uuid` with NO
`withTenant()` binding and NO `tenant_id` predicate. This is the api-core
slice of the tracked `data:CR-04` residual.

**Determination:** STILL LIVE. The clean api-core-side fix has two candidate
shapes; the executor evaluates in Task 6.1 and branches.

### Task 6.1 — fix-shape determination (MANDATORY FIRST)

Evaluate, in order of preference, which fix is cleanly achievable api-core-side
WITHOUT a migration or a BYPASSRLS-pool rethink:

- **Option A — `withTenant()` wrap.** Wrap the email SELECT in
  `withTenant(db, first.tenantId, async (tx) => tx.execute(...))`. `withTenant`
  is already imported (`token-rotation.ts:39`). This pins the SELECT under the
  `users` RLS policy bound to the already-resolved `first.tenant_id`. Verify
  the `db` value passed to `tryPreviousToken` is a `TransactionalDb` that
  `withTenant` accepts — the function's current `db` param is typed as the
  minimal `{ execute(query): Promise<unknown> }` shape (`:122`). If the real
  caller passes a `withTenant`-compatible db, Option A is clean: widen the
  param type to `TransactionalDb<ExecutableTx>` (matching `recordPreviousToken`
  at `:57`) and wrap.
- **Option B — `AND tenant_id` predicate.** Add
  `AND tenant_id = ${first.tenantId}::uuid` to the SELECT WHERE clause. This is
  belt-and-braces at the SQL level, requires no `db`-type change, and works
  even if the caller's `db` is the minimal shape. The SELECT still runs on the
  `openwhispr_app` role but is now explicitly tenant-gated by predicate.

**Preference: Option A** if the caller's `db` is `withTenant`-compatible —
it gets the RLS policy enforcement, not just a predicate. **Option B** is the
fallback when the `db` param shape cannot be widened without touching callers
in a way that ripples. Either A or B is a clean api-core-side fix and does NOT
require a migration.

**HALT branch (CLAUDE.md hard rule 1):** if BOTH are blocked — e.g. `withTenant`
cannot bind because `tryPreviousToken` runs pre-tenant-resolution on a
BYPASSRLS pool, OR the `users` RLS policy + the resolved `tenant_id` cannot be
reconciled without folding the email into a `SECURITY DEFINER` function (which
needs a migration) — then STOP. Do NOT write a migration in this phase. Log in
`.planning/deferred-items.md` under the `data:CR-04` residual cluster
(`deferred-items.md:53`): a new sub-entry `data:CR-04 (api-core slice / HI-05)`
with `WHY:` evidence (the exact `db`-shape / pool / policy constraint that
blocks A and B), and note it joins the existing `data:CR-04` tracking. Mark
HI-05 HALTed in the SUMMARY and `verify-first.log`. Then skip Task 6.2.

Record the chosen option (A / B / HALT) + evidence in the SUMMARY.

### Task 6.2 — RED+GREEN (only if 6.1 chose A or B)

- RED: `apps/api/src/lib/__tests__/token-rotation.test.ts` (or an integration
  test under `apps/api/tests/` — real Postgres via testcontainers, NO mock of
  the DB; CLAUDE.md no-internal-mocks). Test name MUST contain `HI-05`.
  Scenario: seed two tenants, each with a user; insert a session row for
  tenant-A's user with a `previous_token_fp` inside the overlap window. Call
  `tryPreviousToken` and assert the returned `email` is tenant-A's user's email
  AND that the follow-up SELECT is tenant-scoped — the cleanest regression
  assertion is a property test: a `tryPreviousToken` for tenant-A's session
  must NOT be able to resolve an email from a tenant-B-only row. Construct the
  scenario so the pre-fix unscoped SELECT would read across the tenant boundary
  and the fixed scoped SELECT would not. If the v1 single-default-tenant RLS
  posture (CLAUDE.md Constraint 16) makes a true cross-tenant repro impossible
  on the slim stack, assert instead that the SELECT executes inside a
  `withTenant`/predicate-scoped context (Option A: spy/assert the GUC is bound;
  Option B: assert the emitted SQL contains the `tenant_id` predicate) — and
  document in the SUMMARY why a live cross-tenant repro is not constructible
  under the single-tenant posture.
- GREEN: `apps/api/src/lib/token-rotation.ts` — apply the chosen option:
  - Option A: widen the `db` param type, wrap the email SELECT in
    `withTenant(db, first.tenantId, async (tx) => ...)`. Update the comment
    block (`:149-158`) — remove the "bypasses RLS deliberately" admission, state
    the new tenant-pinned posture.
  - Option B: add `AND tenant_id = ${first.tenantId}::uuid` to the SELECT;
    update the same comment block.
  - Keep the `try/catch` → `email = null` fail-loud-over-empty-string behavior.
- Commit: `test(62-06): red — HI-05 tryPreviousToken email SELECT bypasses RLS`
  then `fix(62-06): green — HI-05 tenant-scope the tryPreviousToken email SELECT`
  (atomic combined commit acceptable).

### Verify
```
pnpm --filter @openwhispr/api test -- token-rotation
grep -n "withTenant\|tenant_id" apps/api/src/lib/token-rotation.ts
# HALT branch: grep deferred-items.md for the new data:CR-04 / HI-05 sub-entry
```

---

## Task 7 — annotate the review artifacts (FINAL TASK)

After Tasks 1–6 are green/verified:

- `.planning/review/api-core.md` — append a closure marker line under each of
  HI-01..HI-05:
  - HI-01: `**Status:** CLOSED (already-resolved) — Phase 57 Track E; confirmed Phase 62 (verify-first.log).`
  - HI-02..HI-04: `**Status:** CLOSED 2026-05-20 — Phase 62, commit <green-sha>.`
  - HI-05: `**Status:** CLOSED 2026-05-20 — Phase 62, commit <sha>.` OR
    `**Status:** HALTED — Phase 62; deferred to data:CR-04 (api-core slice), see deferred-items.md.`
- `.planning/review/REVIEW-INDEX.md` — update the `apps/api` core row and the
  `api-core (5)` summary line (`:31`, `:85`) to reflect HIGH=5 cleared / or
  4-cleared-1-halted; add per-finding closure refs consistent with how
  `api-core:CR-01` (`:81`) is annotated as `✅ CLOSED by Phase 57 Track F`.
- Commit: `docs(62-01): annotate api-core review with HI-01..HI-05 closure`.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| operator env → debug-fetch route | A misset `OPENWHISPR_TEST_ROUTES` env crosses into route registration (HI-02). |
| route/upstream → wire envelope | Interpolated upstream / internal text crosses to the client via the error envelope (HI-03). |
| api process → OIDC issuer discovery endpoint | An untrusted network response drives the `client_secret` token exchange (HI-04). |
| rotated-session lookup → users table | A follow-up SELECT crosses the tenant-isolation boundary unscoped (HI-05). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-62-01 | Elevation of privilege | /__test/fetch debug route | mitigate | Task 2 adds `NODE_ENV!=='production'` veto at both gate sites — a prod env with `OPENWHISPR_TEST_ROUTES=true` no longer mounts the unauthenticated arbitrary-URL fetcher. |
| T-62-02 | Information disclosure | error envelope | mitigate | Task 3 emits the class-default literal for ZodError/fastify-validation/RateLimitError/ServiceUnavailable; Task 4 converts route throw sites to code+literal pairs so no upstream string is carried on `.message`. Coordinates with LOCKER-05. |
| T-62-03 | Spoofing / Tampering | OIDC discovery doc | mitigate | Task 5 zod-validates the discovery doc, enforces HTTPS + issuer-origin on `token_endpoint`/`userinfo_endpoint`, and bounds the cache with a TTL so a poisoned doc cannot persist for process life or redirect the `client_secret` exchange. |
| T-62-04 | Information disclosure (cross-tenant) | tryPreviousToken email SELECT | mitigate | Task 6 binds the follow-up SELECT to the resolved tenant via `withTenant()` or an `AND tenant_id` predicate; HALT to `data:CR-04` if a clean api-core-side fix is blocked. |
| T-62-05 | (n/a — HI-01 already closed) | auth.ts baseURL | accept | HI-01's literal-localhost default was removed by Phase 57 Track E; `validateIngressBoot()` refuses a misconfigured/non-HTTPS-prod origin at boot. Verified, no residual. |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/api test
pnpm lint:lockers          # 8 lockers green — esp. LOCKER-01 (no new NODE_ENV
                           # branch outside boundary files), LOCKER-05 (secret-
                           # shape-in-error — HI-03 strengthens this)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -14      # verify-first log + RED/GREEN pairs for HI-02..HI-05
                           # + the doc annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "HI-02\|HI-03\|HI-04\|HI-05" apps/api --include="*.test.ts"` —
  every fixed finding has a test referencing its ID.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `.planning/phases/62-high-findings-api-core/verify-first.log` exists, is
  committed, and records a disposition for all of HI-01..HI-05.
- `.planning/review/api-core.md` + `REVIEW-INDEX.md` carry the closure markers.
</verification>

<success_criteria>
- HI-01: confirmed already-closed in `verify-first.log` with `file:line`
  evidence; no production change.
- HI-02: RED+GREEN pair — `OPENWHISPR_TEST_ROUTES=true` under
  `NODE_ENV=production` does NOT register `/__test/fetch`.
- HI-03: RED+GREEN pair (Task 3) — the error envelope emits class-default
  literals, not interpolated text; Task 4 — every `new ServiceUnavailable(...)`
  route site is a code+literal pair.
- HI-04: RED+GREEN pair — OIDC discovery doc is zod-validated (HTTPS +
  issuer-origin) and the cache is TTL+size bounded.
- HI-05: RED+GREEN pair (tenant-scoped SELECT) OR a HALT entry in
  `.planning/deferred-items.md` under `data:CR-04` with `WHY:` evidence.
- `pnpm --filter @openwhispr/api test` green; `pnpm lint:lockers` green (8);
  `pnpm typecheck` no new errors vs the 5-error baseline.
- `.planning/review/api-core.md` + `REVIEW-INDEX.md` annotated with per-finding
  closure markers.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No gitleaks hook bypass (CLAUDE.md hard rule 4). Any HALT logged with `WHY:`.
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| HI-01 grep contradicts the planner's already-closed determination. | 1 | Task 1 instructs: if the literal is still present, treat HI-01 as live, add a RED+GREEN consuming `validateIngressBoot().ingressBaseUrl`, report the divergence. |
| LOCKER-01 flags `routes/__test/fetch.ts` for the `NODE_ENV` read. | 2 | `fetch.ts` already reads `NODE_ENV` today (pre-existing allowlist entry); the new `!=='production'` term is in the same expression. If LOCKER-01 still flags, compute the boolean in `config/*` and inject it; HALT + open question if the allowlist edit is non-trivial. |
| HI-03 fix breaks a test that asserted the leaked message. | 3 | That test was asserting a leak — fix it to assert the literal; this is a genuine HI-03 fix, not a test hack (CLAUDE.md rule 1). |
| HI-04 same-origin constraint breaks a legitimate split-domain IdP. | 5 | Env allowlist escape hatch (`OIDC_DISCOVERY_ALLOWED_ORIGINS`, default-deny); HALT + deferred-items if still insufficient — do not weaken validation. |
| HI-05 clean api-core fix is blocked (needs a migration / pool rethink). | 6 | Task 6.1 evaluates A and B first; HALT branch is explicit — log under `data:CR-04` in deferred-items, no migration written in this phase. |
| HI-05 cross-tenant repro impossible under v1 single-default-tenant posture. | 6 | RED falls back to a context-assertion (GUC bound / SQL predicate present); SUMMARY documents why a live cross-tenant repro is not constructible. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: HALT, log in `.planning/deferred-items.md` with WHY, report — never edit production solely to green a test. |
</risk_register>

<output>
After completion, create
`.planning/phases/62-high-findings-api-core/62-01-SUMMARY.md`.

In the SUMMARY, explicitly record:
- HI-01: the confirmed already-closed determination + the grep evidence.
- HI-02: both gate sites updated; LOCKER-01 outcome.
- HI-03: the four error-handler branches changed; Task 4 — whether the audit
  RED was folded into Task 3 or kept separate; the route throw sites converted.
- HI-04: the discovery-doc schema + the same-origin / env-allowlist decision;
  the cache TTL + size cap chosen.
- HI-05: the chosen fix option (A withTenant / B predicate / HALT) + the
  `db`-shape / pool / policy evidence behind the choice; if HALTed, the
  `deferred-items.md` `data:CR-04` sub-entry reference.
- Any HALT + `.planning/deferred-items.md` entries.
- The final per-finding closure markers written to `api-core.md` + `REVIEW-INDEX.md`.
</output>
