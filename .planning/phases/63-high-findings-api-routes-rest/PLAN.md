---
phase: 63-high-findings-api-routes-rest
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/routes/auth-callback.ts
  - apps/api/src/routes/desktop-signin.ts
  - apps/api/src/routes/verification-status.ts
  - apps/api/tests/unit/routes/auth-callback.test.ts
  - apps/api/tests/unit/routes/desktop-signin.test.ts
  - apps/api/tests/unit/routes/verification-status.test.ts
  - apps/api/tests/unit/__tests__/rate-limit-verification-status.test.ts
  - .planning/phases/63-high-findings-api-routes-rest/verify-first.log
  - .planning/review/api-routes-rest.md
  - .planning/review/REVIEW-INDEX.md
autonomous: true
requirements: ["HR-01", "HR-02", "HR-03"]

must_haves:
  truths:
    - "HR-01: GET /api/auth/desktop-callback/:provider carries an explicit config.rateLimit budget; a burst past that budget from one IP returns 429 with the {error:\"Too many requests\"} envelope."
    - "HR-02: GET /api/desktop-signin/:provider carries an explicit config.rateLimit budget; a burst past that budget from one IP returns 429 before any oauth_state INSERT for the over-budget request."
    - "HR-03: /api/auth/verification-status declares a (ip,email) keyGenerator on its config.rateLimit; two distinct emails from one IP occupy separate buckets — one email exhausting 30/min does NOT 429 the other."
    - "HR-03: the email component of the rate-limit key is lower-cased/normalized and hashed so the key is not a plaintext-email enumeration oracle; absent ?email= degrades to an ip-only key."
    - "LOCKER-04: auth-callback.ts and desktop-signin.ts route configs now satisfy the rateLimit obligation with real budgets (not rateLimit:false); pnpm lint:lockers green (8 lockers)."
  artifacts:
    - path: ".planning/phases/63-high-findings-api-routes-rest/verify-first.log"
      provides: "per-finding verify-first determination — still-live/already-closed with file:line evidence for HR-01..HR-03"
      contains: "HR-01"
    - path: ".planning/review/api-routes-rest.md"
      provides: "per-finding closure markers appended to HR-01..HR-03"
      contains: "CLOSED"
  key_links:
    - from: "apps/api/src/routes/auth-callback.ts"
      to: "GET /api/auth/desktop-callback/:provider config"
      via: "config.rateLimit budget added alongside auth:false"
      pattern: "rateLimit"
    - from: "apps/api/src/routes/desktop-signin.ts"
      to: "GET /api/desktop-signin/:provider config"
      via: "config.rateLimit budget added alongside auth:false"
      pattern: "rateLimit"
    - from: "apps/api/src/routes/verification-status.ts"
      to: "config.rateLimit.keyGenerator"
      via: "(ip, normalized-hashed-email) composite key"
      pattern: "keyGenerator"
---

<objective>
Clear the three HIGH security findings in the `apps/api` routes (rest)
surface (`.planning/review/api-routes-rest.md`, HR-01..HR-03). All three are
rate-limit defects on public, unauthenticated routes. Each finding is
re-verified against current `main` BEFORE any fix; an already-closed finding
is marked with evidence and skipped (CLAUDE.md hard rule 3 — never invent a
fix for a non-bug). Each live finding is closed via strict RED→GREEN TDD.

Purpose: remove three pre-publication abuse vectors —
- HR-01: an unmetered OAuth-state-consuming endpoint that lets an attacker
  who knows a victim is mid-flight DoS / race the legitimate callback;
- HR-02: an unmetered endpoint that INSERTs an encrypted `oauth_state` row +
  302s to the IdP on every call → write-amplification + redirect-launcher;
- HR-03: a documented `(ip, email)` rate-limit contract that the production
  route never implemented → multiple desktops behind one corporate NAT DoS
  each other during onboarding.

Output: per-finding RED+GREEN atomic commit pairs (test + production code in
the same commit acceptable), a `verify-first.log` evidence record, and
`.planning/review/api-routes-rest.md` + `REVIEW-INDEX.md` annotated with
per-finding closure markers.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/63-high-findings-api-routes-rest/CONTEXT.md
@.planning/review/api-routes-rest.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read to "check one
more thing"; use Grep for anything more specific):

- `apps/api/src/routes/auth-callback.ts:124` — route registered with
  `{ config: { auth: false } }` only. NO `rateLimit` key. Falls to the
  plugin global default (60/min user-tier, which auto-degrades to
  `ip:<req.ip>` for this unauthenticated route) + the 600/min GLOBAL_IP_CEILING.
  Phases 59/60 touched this file (commit `85a67858` is verification-status;
  the auth-callback edits were Phase 60 fixture-drift + Phase 51 decode) —
  NONE added a `rateLimit` budget. **HR-01 STILL LIVE.**
- `apps/api/src/routes/desktop-signin.ts:97` — route registered with
  `{ config: { auth: false } }` only. NO `rateLimit` key. Same global-default
  fallback. The handler INSERTs an `oauth_state` row (with 6 encryption
  sidecars) + 302s to the IdP on every call. **HR-02 STILL LIVE.**
- `apps/api/src/routes/verification-status.ts:44-52` — route declares
  `config.rateLimit: { max: 30, timeWindow: "1 minute" }` with NO
  `keyGenerator`. The header docstring (`:24`) claims
  `30/min keyed on (ip, email)`. With no `keyGenerator`, the plugin's
  global default keyGenerator runs — and since this is a cookie-only
  unauthenticated-at-the-limiter route (`req.user` is set by a preHandler
  that runs AFTER the limiter's `preHandler` for this route's purposes;
  in any case the limiter degrades to `ip:<req.ip>`), the bucket is
  IP-only. **HR-03 STILL LIVE — code/doc drift confirmed.**
- `apps/api/tests/unit/__tests__/rate-limit-verification-status.test.ts` —
  this test builds a **SYNTHETIC** route inline (`buildTestApp()` at `:15-36`)
  that DOES attach the `(ip,email)` keyGenerator, and asserts the keyGenerator
  partitions correctly. It does NOT register the real
  `buildVerificationStatusRoutes` plugin. So the test is GREEN today while the
  production route has drifted — the test asserts an aspiration, not the
  shipped route. Task 4's RED must exercise the REAL route.
- `apps/api/src/plugins/rate-limit.ts` — `@fastify/rate-limit` registered
  `global: true`. Per-route `config.rateLimit` overrides the global; a route
  MAY supply its own `keyGenerator` inside `config.rateLimit` (confirmed:
  `v1/keys/create.ts:70`, `agent/stream.ts:137`, `agent/web-search.ts:84`,
  `tokens/deepgram.ts:39`, `tokens/assemblyai.ts:65`,
  `tokens/openai-realtime.ts:71` all do `keyGenerator: (req) => req.user?.id ?? req.ip`).
  The plugin also enforces a separate always-on 600/min `GLOBAL_IP_CEILING`
  preHandler — independent of per-route config — so adding a per-route budget
  does not remove the global DoS shield, it adds a tighter route-specific one.
- `apps/api/src/config/rate-limits.ts` — the D-RL2 matrix. `verificationStatus`
  entry already exists: `{ rpm: 30, keying: "composite-ip-email" }`. The
  matrix comment (`:14-17`, `:67-73`) explicitly says the composite (IP,email)
  `keyGenerator` "lives on the route to keep the (IP,email) shape
  byte-for-byte" — i.e. the config layer always EXPECTED the route to attach
  the keyGenerator; HR-03 is exactly that missing attachment.
  `routeRateLimitConfig('verificationStatus')` returns
  `{ max: 30, timeWindow: "1 minute" }` (no keyGenerator — by design, route adds it).
- Sibling public-route budgets (for HR-01/HR-02 consistency):
  `auth-providers.ts:86` `{ auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } }`,
  `locale.ts:82` `{ auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } }`,
  `setup-state.ts:75` `{ auth: false, rateLimit: { max: 30, timeWindow: "1 minute" } }`,
  `setup-admin.ts:159` `{ auth: false, rateLimit: { max: 5, timeWindow: "1 minute" } }`,
  `check-user.ts:40` `{ rateLimit: { max: 10, timeWindow: "1 minute" } }`.
  Public auth-flow routes cluster at 60/min; sensitive state-mutating ones
  at 5–30/min.
- `packages/wire-schemas/src/verification-status.ts` — `VerificationStatusQuery`
  is `z.object({ email: z.string().email().max(254).optional() }).strict()`.
  The `email` query param IS part of the request shape, IS validated
  (RFC-5321 ≤254 bytes), and IS optional. The keyGenerator can safely read
  `req.query.email`.

<interfaces>
@fastify/rate-limit per-route config (config.rateLimit):
  {
    max: number;
    timeWindow: string;            // e.g. "1 minute"
    keyGenerator?: (req: FastifyRequest) => string;   // optional, route-owned
  }
  Returning a string from keyGenerator selects the counter bucket. The
  plugin namespaces all keys under "owrl:" — the keyGenerator output is
  the suffix, NOT the full Valkey key.

Existing route keyGenerator convention (token routes):
  keyGenerator: (req) => req.user?.id ?? req.ip

config/rate-limits.ts:
  routeRateLimitConfig('verificationStatus') -> { max: 30, timeWindow: "1 minute" }
  rateLimits.verificationStatus -> { rpm: 30, keying: "composite-ip-email" }

node:crypto — createHash('sha256').update(s).digest('hex') is available;
v1/keys/* and tokens/* routes already pull from node:crypto. Use a short
hex slice (e.g. first 16 chars) for the email-component of the rate key.
</interfaces>

apps/api unit route tests use a hand-rolled fake `TransactionalDb`
(Drizzle SQL-chunk introspection) + an in-process `EnvKeyProvider` — NO
HTTP/internal mocks (CLAUDE.md: mocks only at process/network boundaries).
The fake DB is the process boundary. Rate-limit assertions use the
in-process `@fastify/rate-limit` substrate (no Valkey) via `app.inject`.
Follow the established `Fastify({ logger: false, trustProxy: true })` +
`registerErrorHandler(app)` + `app.register(rateLimitPlugin, { redis: undefined })`
pattern from `rate-limit-verification-status.test.ts`.
</context>

## Phase Goal

Close HR-01..HR-03 — each fixed via strict RED→GREEN TDD with the test
asserting the regression-shape (a route reachable past its intended budget,
or a keyGenerator that does not partition as documented), OR confirmed
already-resolved with committed evidence. The planner's pre-determination
(executor MUST re-confirm): **all three are STILL LIVE.**

---

## Verify-first protocol (MANDATORY, all findings)

Before any fix the executor writes
`.planning/phases/63-high-findings-api-routes-rest/verify-first.log` and, per
finding, records: **still-live / partially-mitigated / already-closed**, with
the `file:line` evidence checked. This is the planner's pre-determination —
the executor MUST re-confirm and report any divergence:

- **HR-01 — STILL LIVE.** `grep -n "rateLimit" apps/api/src/routes/auth-callback.ts`
  → expect NO match. Route config at `:124` is `{ config: { auth: false } }` only.
- **HR-02 — STILL LIVE.** `grep -n "rateLimit" apps/api/src/routes/desktop-signin.ts`
  → expect NO match. Route config at `:97` is `{ config: { auth: false } }` only.
- **HR-03 — STILL LIVE.** `grep -n "keyGenerator" apps/api/src/routes/verification-status.ts`
  → expect NO match. `config.rateLimit` at `:48-51` has `max`+`timeWindow` only;
  the `:24` docstring claims `(ip, email)` keying.

If any grep contradicts this (a budget / keyGenerator is already present),
STOP, treat that finding as already-closed, record the evidence in
`verify-first.log`, skip its RED/GREEN task, and report the divergence in the
SUMMARY.

Commit the log: `docs(63-01): verify-first — HR-01..HR-03 disposition log`.

---

## Task 1 — HR-01: rate-limit budget for /api/auth/desktop-callback/:provider

**Finding:** HR-01 (HIGH) — `auth-callback.ts:124` route config carries
`{ auth: false }` only, no `rateLimit`. The handler does a UUID lookup + CAS
UPDATE that BURNS the legitimate `oauth_state` row per successful request →
an attacker who knows a victim is mid-flight has an exploitable race, and the
endpoint is cheaply DoS-able. LOCKER-04 obligation: every Fastify route MUST
carry `config: { rateLimit }`.

**Chosen budget:** `{ max: 60, timeWindow: "1 minute" }` — matches the
sibling public auth-flow routes (`auth-providers.ts`, `locale.ts`). 60/min is
generous for a legitimate single-use OAuth callback (a real user hits this
exactly once per sign-in) while throttling a brute/DoS burst. The route is
unauthenticated, so the plugin's default user-tier keyGenerator auto-degrades
to `ip:<req.ip>` — no custom keyGenerator needed (a real callback is keyed by
the attacker's IP, which is the correct abuse axis). The always-on 600/min
`GLOBAL_IP_CEILING` still applies on top.

### RED step
- File: `apps/api/tests/unit/routes/auth-callback.test.ts` (extend the
  existing suite). Test name MUST contain `HR-01`.
- Scenario: register `buildAuthCallbackRoutes` against the existing fake DB +
  `rateLimitPlugin` on a `trustProxy: true` Fastify instance (mirror the
  `rate-limit-verification-status.test.ts` app-build pattern). Drive 60 GETs
  to `/api/auth/desktop-callback/oidc?state=<unknown-uuid>&code=x` from one
  `x-forwarded-for` IP (an unknown state → deterministic 400, no DB mutation
  needed for the limiter to count), then assert the 61st returns **429** with
  body `{ error: "Too many requests" }`.
- Pre-fix: with no per-route budget the route falls to the 60/min global
  user-tier — which, depending on whether other tests in the suite share the
  in-process counter, may or may not 429 at exactly 61. To make the RED
  assert the REGRESSION SHAPE unambiguously, the test MUST prove the route
  has NO OWN budget: register the route AND assert via the Fastify route
  introspection (`app.inject` is not enough) that `routeOptions.config` for
  `GET /api/auth/desktop-callback/:provider` has no `rateLimit` key — i.e.
  add an `onRoute`-hook capture or read the route config and assert
  `config.rateLimit === undefined`. RED = that assertion fails AFTER the fix
  (config.rateLimit is now an object) — invert it for the post-fix state.
  Concretely: the RED test asserts `config.rateLimit` is a `{max,timeWindow}`
  object; pre-fix it is `undefined` → RED fails. Plus the behavioural 429
  burst test above as the second assertion.
- Commit: `test(63-01): red — HR-01 desktop-callback route has no rateLimit budget`.

### GREEN step
- `apps/api/src/routes/auth-callback.ts:124` — change the route config from
  `{ config: { auth: false } }` to
  `{ config: { auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } } }`.
- Update the header docstring (the route-behavior comment block, `:1-34`) to
  note the rate-limit budget and its abuse rationale (state-row-burning
  race + DoS).
- Do NOT touch the handler logic — this is a pure config addition.
- Commit: `fix(63-01): green — HR-01 add 60/min rateLimit to desktop-callback`.

### Verify
```
grep -n "rateLimit" apps/api/src/routes/auth-callback.ts   # expect the budget present
pnpm --filter @openwhispr/api test -- auth-callback
pnpm lint:lockers
```

### Done
HR-01 RED+GREEN pair on `main`; `auth-callback.ts` route carries an explicit
`rateLimit` budget; LOCKER-04 satisfied for the route; suite green.

---

## Task 2 — HR-02: rate-limit budget for /api/desktop-signin/:provider

**Finding:** HR-02 (HIGH) — `desktop-signin.ts:97` route config carries
`{ auth: false }` only, no `rateLimit`. Each request INSERTs an `oauth_state`
row + 6 encryption sidecars + 302s to the IdP → unauthenticated table-bloat
write-amplification + redirect-launcher. LOCKER-04 obligation.

**Chosen budget:** `{ max: 60, timeWindow: "1 minute" }` — same rationale and
value as HR-01: a legitimate desktop hits sign-in once per flow; 60/min/IP
(auto-degraded keyGenerator, this route is unauthenticated) throttles a
write-amplification burst while leaving generous headroom. Consistent with
the sibling public auth-flow cluster.

### RED step
- File: `apps/api/tests/unit/routes/desktop-signin.test.ts` (extend the
  existing suite). Test name MUST contain `HR-02`.
- Scenario: register `buildDesktopSigninRoutes` against the existing fake DB
  + `rateLimitPlugin`. RED assertion (same shape as Task 1): capture the
  registered route's `config` and assert it carries a
  `rateLimit: { max, timeWindow }` object — pre-fix `config.rateLimit` is
  `undefined`, RED fails. Second assertion (behavioural): with OIDC env set
  so the handler reaches the INSERT path, drive 60 GETs from one
  `x-forwarded-for` IP and assert the 61st returns **429** — AND assert the
  fake DB recorded at most 60 `oauth_state` INSERTs (the over-budget request
  was rejected by the limiter BEFORE the handler ran, so no 61st INSERT).
  The "INSERT count ≤ 60" assertion is the regression-shape proof: it
  demonstrates the write-amplification is actually capped.
- Commit: `test(63-01): red — HR-02 desktop-signin route has no rateLimit budget`.

### GREEN step
- `apps/api/src/routes/desktop-signin.ts:97` — change the route config from
  `{ config: { auth: false } }` to
  `{ config: { auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } } }`.
- Update the header docstring (`:1-27`) to note the budget + the
  write-amplification / redirect-launcher rationale.
- Do NOT touch the handler logic — pure config addition.
- Commit: `fix(63-01): green — HR-02 add 60/min rateLimit to desktop-signin`.

### Verify
```
grep -n "rateLimit" apps/api/src/routes/desktop-signin.ts   # expect the budget present
pnpm --filter @openwhispr/api test -- desktop-signin
pnpm lint:lockers
```

### Done
HR-02 RED+GREEN pair on `main`; `desktop-signin.ts` route carries an explicit
`rateLimit` budget; the over-budget request is rejected before the
`oauth_state` INSERT; LOCKER-04 satisfied; suite green.

---

## Task 3 — HR-03 fix-shape decision (MANDATORY FIRST, no code)

**Finding:** HR-03 (HIGH) — `verification-status.ts` docstring (`:24`) claims
`30/min keyed on (ip, email)`; the actual `config.rateLimit` (`:48-51`) has
NO `keyGenerator` → IP-only bucket → desktops behind one corporate NAT
collide and DoS each other during onboarding.

**Decision — implement the `(ip, email)` keyGenerator (NOT a doc downgrade).**

Rationale:
1. The docstring's stated intent — "busy fixtures must not DoS each other",
   "the desktop polls during onboarding" — is a real deployment requirement,
   not aspirational prose. The exact scenario it calls out (multiple desktops
   behind one corporate NAT) is a first-class self-host topology.
2. `config/rate-limits.ts` ALREADY encodes the contract: the
   `verificationStatus` matrix entry is `keying: "composite-ip-email"` and
   the matrix comment (`:14-17`, `:67-73`) explicitly says the composite
   keyGenerator "lives on the route". The data layer expects the route to
   attach it. HR-03 is the missing route-side half of an already-decided
   D-RL2 contract — downgrading the doc would also require downgrading the
   matrix entry, contradicting a locked D-RL2 decision.
3. `email` IS already a validated, bounded (RFC-5321 ≤254 bytes), optional
   query param on this route — the keyGenerator has a safe, schema-validated
   input to read.

Downgrading the doc to IP-only is REJECTED: it would re-ratify the corporate-
NAT DoS the docstring was written to prevent, and contradict D-RL2.

**Enumeration-oracle guard (mandatory for the keyGenerator implementation):**
- The `email` component MUST be lower-cased + trimmed before use (normalize:
  `email.trim().toLowerCase()`) so `Alice@x.com` and `alice@x.com` share a
  bucket — consistent with the codebase's `lower(email)` lookups.
- The normalized email MUST be **SHA-256 hashed** (hex, first 16 chars is
  sufficient entropy for bucket separation) before being placed in the key.
  Rationale: rate-limit keys can surface in Valkey key dumps, error traces,
  and the `owrl:` namespace; a plaintext email in the key is a low-grade PII
  disclosure and a weak enumeration surface. Hashing keeps the partition
  behaviour identical (same email → same hash → same bucket) while removing
  the plaintext. This is a one-way transform local to keying — it does NOT
  affect the handler's identity logic (which is session-derived, unchanged).
- The rate-limit key MUST NOT branch on whether the email "exists" — the
  keyGenerator only sees the request param, never a DB result, so it
  inherently cannot become an existence oracle. Confirm the keyGenerator
  does NO DB access.
- Absent `?email=` (the param is optional per R5): the keyGenerator MUST
  degrade to an ip-only key (`ip:<req.ip>` with a fixed `:_` email-slot
  sentinel, OR just `ip:<req.ip>`) — never throw, never 400. A desktop that
  omits the param still gets a working bucket.

**Read-source for `email`:** `req.query.email` — present on the request
shape per `VerificationStatusQuery` (`z.object({ email: ... .optional() })`).
The handler intentionally discards the param's VALUE for identity (R5); the
keyGenerator's use of it for *bucketing only* does not conflict with R5
(R5 forbids deriving identity from the param, not bucketing).

### Action
- No code in this task. Record the decision (keyGenerator, with the
  normalize + SHA-256-hash + ip-only-fallback shape) and its rationale in
  `verify-first.log` under the HR-03 entry.
- This task produces no separate commit; the decision rides in the
  verify-first log commit (Task: verify-first) or is appended in Task 4's
  RED commit message body.

### Done
HR-03 fix-shape is recorded as: implement `(ip, normalized-SHA256-email)`
keyGenerator; doc-downgrade explicitly rejected with rationale.

---

## Task 4 — HR-03: implement the (ip, email) keyGenerator on verification-status

**Finding:** HR-03 (HIGH) — see Task 3. Fix per the Task 3 decision.

### RED step
- File: `apps/api/tests/unit/routes/verification-status.test.ts` (extend the
  existing REAL-route suite — this exercises `buildVerificationStatusRoutes`,
  unlike the synthetic `rate-limit-verification-status.test.ts`). Test name
  MUST contain `HR-03`.
- Register the real `buildVerificationStatusRoutes` plugin + `rateLimitPlugin`
  + `registerErrorHandler` on a `trustProxy: true` instance. The route's
  `preHandler` is `requireCookieOnly`; stub the injected `auth` (process
  boundary) so a session resolves with a fixed email so the handler returns
  `{ verified: ... }` 200s — the limiter counts 200s.
- Scenario A (partition proof — the core regression-shape): from ONE IP
  (`x-forwarded-for: 10.0.0.30`), drive 30 GETs to
  `/api/auth/verification-status?email=a@corp.local` (all 200), confirm the
  31st with `email=a@corp.local` is **429**, then confirm a GET with
  `email=b@corp.local` from the SAME IP is **200** (fresh bucket).
  Pre-fix the real route has no keyGenerator → both emails share the IP
  bucket → the `b@corp.local` request is also 429 → RED fails.
- Scenario B (config-shape proof): capture the registered route's
  `config.rateLimit` and assert it has a `keyGenerator` function. Pre-fix
  `keyGenerator` is `undefined` → RED fails.
- Scenario C (normalization): two requests with `email=Alice@corp.local` and
  `email=alice@corp.local` from one IP MUST share a bucket — exhaust 30 with
  the mixed-case form, assert the lower-case form from the same IP is 429.
  Pre-fix (no keyGenerator) this passes trivially (IP-only) — so Scenario C
  is a post-fix REGRESSION GUARD, not a RED driver; mark it clearly.
- Scenario D (no-oracle / optional-param): a GET with NO `?email=` from one
  IP still 200s and is rate-limited on an ip-only key (drive 30, assert 31st
  429). Confirms the keyGenerator degrades, never throws.
- Commit: `test(63-01): red — HR-03 verification-status rate-limit not (ip,email) keyed`.

### GREEN step
- `apps/api/src/routes/verification-status.ts` — add a `keyGenerator` to the
  `config.rateLimit` object (`:48-51`):
  - Read `req.query.email` (typed via the route's existing `Querystring` /
    the `VerificationStatusQuery` schema). When present and a non-empty
    string: `const norm = email.trim().toLowerCase();`
    `const emailKey = createHash("sha256").update(norm).digest("hex").slice(0, 16);`
    return `` `${req.ip}:${emailKey}` ``.
  - When absent / empty: return `` `${req.ip}:_` `` (ip-only fallback,
    fixed sentinel slot — never throw).
  - Import `createHash` from `node:crypto` at the top of the file.
- Update the header docstring (`:24`) so it accurately describes the
  implemented key: `30/min keyed on (ip, sha256(lower(email))); absent
  ?email= degrades to ip-only`. The docstring becomes TRUE, not aspirational.
- Keep `max: 30, timeWindow: "1 minute"` unchanged (the D-RL2 budget).
- Do NOT change the handler identity logic — R5's session-derived identity
  is untouched; the keyGenerator uses `email` for bucketing only.
- **LOCKER-03 / no-hardcode:** no new `localhost`/UUID/secret literals — the
  keyGenerator composes runtime values only. **LOCKER-04:** the route already
  had `config.rateLimit`; this strengthens it. Run `pnpm lint:lockers`.
- Optionally update the synthetic `rate-limit-verification-status.test.ts`
  header comment to cross-reference that the REAL route now also carries the
  keyGenerator (the synthetic test stays valid — it independently exercises
  the keyGenerator shape). Do NOT delete it.
- **CLAUDE.md hard rule 1:** if an existing test asserted IP-only bucketing
  on the real route, that test was asserting the BUG — fix it to assert the
  composite key; this is a genuine HR-03 fix, not a test hack.
- Commit: `fix(63-01): green — HR-03 add (ip,email) keyGenerator to verification-status`.

### Verify
```
grep -n "keyGenerator\|createHash" apps/api/src/routes/verification-status.ts
pnpm --filter @openwhispr/api test -- verification-status
pnpm --filter @openwhispr/api test -- rate-limit-verification-status
pnpm lint:lockers
```

### Done
HR-03 RED+GREEN pair on `main`; the real `verification-status` route carries
an `(ip, sha256(lower(email)))` keyGenerator; two emails from one IP occupy
separate buckets; absent `?email=` degrades to ip-only; the docstring matches
the implemented key; LOCKER-04 + LOCKER-03 green.

---

## Task 5 — annotate the review artifacts (FINAL TASK)

After Tasks 1–4 are green/verified:

- `.planning/review/api-routes-rest.md` — append a closure marker line under
  each of HR-01..HR-03:
  - HR-01: `**Status:** CLOSED 2026-05-20 — Phase 63, commit <green-sha>.`
  - HR-02: `**Status:** CLOSED 2026-05-20 — Phase 63, commit <green-sha>.`
  - HR-03: `**Status:** CLOSED 2026-05-20 — Phase 63, commit <green-sha> — (ip,email) keyGenerator implemented per D-RL2; doc-downgrade rejected.`
- `.planning/review/REVIEW-INDEX.md` — update the `apps/api routes — rest`
  table row (`:34`, currently `**3** | 3 | 5 | 8`) and the
  `api-routes-rest (3)` summary line (`:87`) to reflect HIGH = 3 cleared.
  Annotate per-finding closure refs consistent with how
  `api-routes-rest:CR-01/02/03` are marked `✅ CLOSED by Phase 57` (`:61-65`).
- Commit: `docs(63-01): annotate api-routes-rest review with HR-01..HR-03 closure`.

### Done
Both review artifacts carry per-finding closure markers; `git log` shows the
annotation commit.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| unauthenticated network → desktop-callback route | An attacker drives unmetered OAuth-state-consuming CAS UPDATEs (HR-01). |
| unauthenticated network → desktop-signin route | An attacker drives unmetered `oauth_state` INSERTs + IdP 302s (HR-02). |
| corporate-NAT shared IP → verification-status limiter | Many legitimate desktops share one source IP; an IP-only bucket conflates them (HR-03). |
| request query param → rate-limit key | The `email` query value crosses into the limiter's bucket key (HR-03 keyGenerator). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-63-01 | Denial of Service | /api/auth/desktop-callback/:provider | mitigate | Task 1 adds a 60/min/IP `config.rateLimit` budget — caps the OAuth-state-burning CAS race + DoS burst; the always-on 600/min GLOBAL_IP_CEILING remains on top. |
| T-63-02 | Denial of Service / Tampering | /api/desktop-signin/:provider | mitigate | Task 2 adds a 60/min/IP `config.rateLimit` budget — caps `oauth_state` write-amplification (over-budget request rejected before the INSERT) and the redirect-launcher abuse. |
| T-63-03 | Denial of Service (self-inflicted, corporate NAT) | /api/auth/verification-status | mitigate | Task 4 attaches an `(ip, email)` keyGenerator so desktops behind one NAT occupy separate 30/min buckets — the documented onboarding-polling contract is now enforced. |
| T-63-04 | Information disclosure | rate-limit key contents | mitigate | Task 4 SHA-256-hashes the normalized email before placing it in the `owrl:`-namespaced key — no plaintext email in Valkey key dumps / traces; the keyGenerator does no DB access so it cannot become an existence oracle. |
</threat_model>

<verification>
Phase-level gate (run after all tasks):

```
pnpm --filter @openwhispr/api test
pnpm lint:lockers          # 8 lockers green — esp. LOCKER-04 (HR-01/HR-02
                           # routes now carry config.rateLimit), LOCKER-03
                           # (no new hardcoded literals in the keyGenerator)
pnpm typecheck             # no NEW errors vs the documented 5-error baseline
git log --oneline -10      # verify-first log + RED/GREEN pairs for HR-01..HR-03
                           # + the doc annotation commit
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -rn "HR-01\|HR-02\|HR-03" apps/api --include="*.test.ts"` — every
  fixed finding has a test referencing its ID.
- `grep -n "rateLimit" apps/api/src/routes/auth-callback.ts apps/api/src/routes/desktop-signin.ts`
  — both carry a `{max,timeWindow}` budget.
- `grep -n "keyGenerator" apps/api/src/routes/verification-status.ts` —
  present.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `.planning/phases/63-high-findings-api-routes-rest/verify-first.log` exists,
  is committed, records a disposition for all of HR-01..HR-03.
- `.planning/review/api-routes-rest.md` + `REVIEW-INDEX.md` carry the closure
  markers.
</verification>

<success_criteria>
- HR-01: RED+GREEN pair — `/api/auth/desktop-callback/:provider` carries an
  explicit `config.rateLimit: { max: 60, timeWindow: "1 minute" }`; a burst
  past 60 from one IP returns 429.
- HR-02: RED+GREEN pair — `/api/desktop-signin/:provider` carries an explicit
  `config.rateLimit: { max: 60, timeWindow: "1 minute" }`; the over-budget
  request is rejected before the `oauth_state` INSERT.
- HR-03: fix-shape decision recorded (keyGenerator, not doc-downgrade);
  RED+GREEN pair — the real `verification-status` route carries an
  `(ip, sha256(lower(email)))` keyGenerator; two emails from one IP occupy
  separate buckets; absent `?email=` degrades to ip-only; the docstring
  matches the implemented key.
- `pnpm --filter @openwhispr/api test` green; `pnpm lint:lockers` green (8);
  `pnpm typecheck` no new errors vs the 5-error baseline.
- `.planning/review/api-routes-rest.md` + `REVIEW-INDEX.md` annotated with
  per-finding closure markers.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- No `as any` / `as unknown as` / `@ts-ignore` introduced.
- No gitleaks hook bypass (CLAUDE.md hard rule 4).
</success_criteria>

<risk_register>
| Risk | Task | Mitigation |
|------|------|------------|
| A grep contradicts the planner's still-live determination (a budget/keyGenerator already present). | verify-first | Treat that finding as already-closed, record evidence in verify-first.log, skip its RED/GREEN, report the divergence in the SUMMARY. |
| HR-01/HR-02 burst test is flaky because the in-process limiter counter is shared across tests in the file. | 1,2 | Build a fresh Fastify instance per test (`beforeEach`) — the in-process counter is per-instance; the existing `rate-limit-verification-status.test.ts` already proves this pattern is stable. The config-shape assertion (route carries a `rateLimit` object) is the deterministic RED driver; the burst is corroborating. |
| HR-03 keyGenerator runs before `req.user` is populated and the test cannot stub a session. | 4 | The keyGenerator reads `req.query.email`, NOT `req.user` — it does not depend on auth timing. The handler's session stub (process-boundary `auth`) only affects the 200 vs 401 response, which the test controls. |
| Adding the keyGenerator changes verification-status behaviour and breaks an existing test that assumed IP-only bucketing. | 4 | That test asserted the BUG — fix it to assert the composite key (CLAUDE.md hard rule 1, genuine fix not a hack). The synthetic `rate-limit-verification-status.test.ts` already expects composite keying — it stays green. |
| Hashing the email in the key breaks the synthetic test that asserts `${req.ip}:${email}` plaintext shape. | 4 | The synthetic test builds its OWN route with its OWN keyGenerator — it is independent of the production route and asserts its own inline keyGenerator's output; it is unaffected. Only update its header comment to cross-reference the production route, do not change its assertions. |
| A failing test tempts a production hack. | all | CLAUDE.md hard rule 1: never edit production solely to green a test — the production change here IS the genuine HR-fix; the tests assert the fix. No HALT expected; if one arises, log in `.planning/deferred-items.md` with WHY. |
| typecheck regression from the `node:crypto` import or keyGenerator typing. | 4 | `createHash` is already imported across `v1/keys/*` + `tokens/*`; type the keyGenerator param via the route's existing `Querystring` generic. Run `pnpm typecheck` after Task 4 — must stay at the 5-error baseline. |
</risk_register>

<output>
After completion, create
`.planning/phases/63-high-findings-api-routes-rest/63-01-SUMMARY.md`.

In the SUMMARY, explicitly record:
- HR-01: the verify-first determination + the budget added (value + rationale);
  the RED/GREEN commit SHAs.
- HR-02: the verify-first determination + the budget added; whether the
  "INSERT count ≤ 60" regression assertion held; the RED/GREEN commit SHAs.
- HR-03: the verify-first determination; the fix-shape decision
  (keyGenerator implemented, doc-downgrade rejected) + rationale; the exact
  key shape implemented (`${req.ip}:${sha256(lower(email)).slice(0,16)}`,
  ip-only fallback for absent param); the RED/GREEN commit SHAs.
- LOCKER-04 outcome — both previously-budgetless routes now compliant.
- `pnpm lint:lockers` + `pnpm typecheck` results vs the 5-error baseline.
- The final per-finding closure markers written to `api-routes-rest.md` +
  `REVIEW-INDEX.md`.
- Any divergence from the planner's still-live pre-determination.
</output>
