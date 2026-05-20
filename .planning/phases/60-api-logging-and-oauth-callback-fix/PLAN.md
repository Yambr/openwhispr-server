---
phase: 60-api-logging-and-oauth-callback-fix
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/src/index.ts
  - apps/api/tests/unit/index.test.ts
  - apps/api/tests/unit/routes/auth-callback.test.ts
  - apps/api/tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts
  - apps/api/tests/unit/__tests__/api-logger-wiring.test.ts   (new — Track A RED test; exact name decided in A.1)
  - tools/lint-no-env-branches.allowlist.txt                  (only if index.ts NODE_ENV-read line numbers shift)
  - tools/lint-no-hardcode.allowlist.txt                      (only if index.ts allowlisted-literal line numbers shift)
  - .planning/deferred-items.md
autonomous: true
requirements: ["DEFECT-A-api-logging", "DEFECT-B-desktop-callback-500"]

must_haves:
  truths:
    - "The api process emits structured per-request JSON logs to stdout — every req.log.{warn,info,error} call site produces output, not a no-op."
    - "The error-handler's req.log.warn({err,status}, 'request error') is visible on every 500 — a live 500 produces at least one container log line."
    - "The request-log plugin's req.log.child({openwhisprSource}) still works against the real pino logger — the x-openwhispr-source tag is mirrored onto request logs."
    - "LOG_LEVEL still controls log level (makePino reads it); no NODE_ENV branch was added to index.ts."
    - "REDACT_PATHS redaction applies — a 500 whose error carries a token-shaped field does NOT leak that value to stdout."
    - "GET /api/auth/desktop-callback/:provider returns 302 with a verbatim <scheme>://?bearer_token=... Location for all four schemes (openwhispr, openwhispr-dev, openwhispr-staging, mycorp-whispr)."
    - "All 6 previously-red api tests pass; pnpm --filter @openwhispr/api test reports 0 failing."
  artifacts:
    - path: "apps/api/src/index.ts"
      provides: "Fastify built with a makePino()-derived logger instead of logger:false"
      contains: "makePino"
    - path: "apps/api/tests/unit/__tests__/api-logger-wiring.test.ts"
      provides: "RED test asserting the api request logger is a real pino instance and the error-handler path emits a structured record"
      contains: "makePino"
  key_links:
    - from: "apps/api/src/index.ts"
      to: "Fastify({ logger })"
      via: "makePino({ base: { service: 'api' } }) instance fed into the Fastify constructor"
      pattern: "makePino"
    - from: "apps/api/tests/unit/routes/auth-callback.test.ts"
      to: "packages/data encryption codec (encryptCodeVerifier)"
      via: "fake oauth_state rows carry real bytea sidecars so decryptCodeVerifierFromRow resolves instead of throwing"
      pattern: "code_verifier_value_ciphertext"
---

<objective>
Close two pre-publication defects surfaced during Phase 59 execution, neither in
Phase 59's R14–R18 scope:

1. **Defect A — the api process logs nothing per-request.** `apps/api/src/index.ts:309`
   builds the app with `Fastify({ logger: false, trustProxy: true })`. With
   `logger: false`, Fastify's `req.log` is a no-op stub; all 33 production
   `req.log.{warn,info,error}` call sites — including `error-handler.ts:233`,
   the ONLY server-side record of every 500 — silently discard their output.

2. **Defect B — `GET /api/auth/desktop-callback/:provider` 500s instead of 302.**
   Six api unit tests are red across `auth-callback.test.ts` (4),
   `oauth-channel-scheme-mint-bearer.test.ts` (1), and `index.test.ts` (1).

Purpose: restore production observability (Track A) and wire-contract
correctness on the desktop OAuth callback (Track B).

Output: per-track RED+GREEN atomic commit pairs (test + production/test-fixture
code in the same commit), an updated `.planning/deferred-items.md` marking the
Phase 59 pre-existing-failure entry resolved, and a live-stack verification of
structured logging with no secret leakage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/60-api-logging-and-oauth-callback-fix/CONTEXT.md
@.planning/phases/59-client-e2e-server-followups/PLAN.md
@CLAUDE.md

Already-read source (facts captured below — do NOT re-read to "check one more
thing"; use Grep for anything more specific):

- `apps/api/src/index.ts:309` — `const app = Fastify({ logger: false, trustProxy: true });`
  is the Defect A site. `makePino` is ALREADY imported at line 63
  (`import { makePino } from "@openwhispr/observability";`) and already used to
  build `bootLog` at line 616 (`const bootLog = makePino({ base: { name: "api-boot" } });`).
  The fix is a wiring change, not new infrastructure.
- `apps/api/src/plugins/request-log.ts` — `requestLogInner` does
  `req.log = req.log.child({ openwhisprSource: source })` in an `onRequest`
  hook. This relies on `req.log` being a real pino child-capable logger; with
  `logger:false` the child call is a no-op stub.
- `packages/observability/src/redact.ts` — `makePino(opts)` builds pino with
  `redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }`, reads `LOG_LEVEL`
  from env (default `info`), accepts `opts.base` (static fields merged onto
  every record), `opts.destination` (test seam), and `opts.level`. REDACT_PATHS
  covers `err.response.config.headers.Authorization` and the other nested
  `err.*` token paths, plus top-level `token`/`secret`/`password`/`bearer_token`.
- `apps/api/src/error-handler.ts:233` — `req.log.warn({ err, status }, "request error");`
  is the dead 500 log line that starts emitting once the logger is wired.
- `apps/api/src/routes/auth-callback.ts` — the desktop-callback route. Line ~249
  calls `const codeVerifier = await decryptCodeVerifierFromRow([keyProvider], stateRow);`
  where `stateRow` came from the `UPDATE oauth_state ... RETURNING ...` query.
  The route reads the 6 `code_verifier_*` bytea sidecar columns from the row.
- `packages/data/src/encryption/oauth-state-codec.ts:90` —
  `decryptCodeVerifierFromRow(providers, row)` calls `hasAllSidecars(row)` and
  THROWS `new Error("oauth_state row missing bytea sidecars for code_verifier")`
  when ANY of the 6 `code_verifier_*` Buffers is absent. There is NO plaintext
  fallback — migration 0020/0033 (Phase 33) dropped the plaintext
  `oauth_state.code_verifier` column. The inverse helper `encryptCodeVerifier`
  is exported from `packages/data/src/encryption/index.ts`.

<root_cause_defect_b>
ROOT CAUSE of the 6 red tests (determined from reading the test files —
REQUIRES live confirmation per Track B.1):

All three test files (`auth-callback.test.ts`, `oauth-channel-scheme-mint-bearer.test.ts`,
`index.test.ts`) define a `FakeStateRow` with a PLAINTEXT `code_verifier: string`
field and NO `code_verifier_*` bytea sidecar columns. Their `makeFakeDb`
`UPDATE oauth_state ... RETURNING` handler returns that plaintext-shaped row.

Post-Phase-33, the route calls `decryptCodeVerifierFromRow([keyProvider], stateRow)`.
`hasAllSidecars()` returns false → the codec THROWS → the error escapes to
`registerErrorHandler` → 500 envelope instead of 302.

This is **test-fixture drift**: the Phase 33 encryption migration changed the
`oauth_state` row shape, but these unit-test fakes were never updated to emit
encrypted sidecars. Per CLAUDE.md hard rule 1, the fix is to the TEST FIXTURES
(make the fakes produce real encrypted sidecars via `encryptCodeVerifier`), NOT
to the production route — the route is correct.

THIS DIAGNOSIS IS A STRONG PRIOR, NOT A CERTAINTY. Track B.1 obtains the real
500 stack from the live stack / a temp console.error and CONFIRMS it before
B.2 writes the fix. If the live stack reveals a DIFFERENT root cause (e.g. a
genuine route bug), B.2 fixes the route per hard rule 1 instead.
</root_cause_defect_b>

The api unit suite uses vitest; the desktop-callback tests boot their own
`Fastify({ logger: false })` instance via a local `buildApp` helper (NOT the
production `buildApp` from `index.ts`, except `index.test.ts` which DOES use the
production `buildApp`). No HTTP/internal mocks beyond the documented fake DB
(boundary-only — CLAUDE.md: no mocks of internal logic).
</context>

## Phase Goal

Wire `makePino` into the api Fastify instance so per-request logging actually
emits (Track A), and fix the desktop-callback 500→302 regression (Track B) —
each via strict RED→GREEN TDD with the test asserting the regression-shape so a
future revert is caught.

---

## Track order & dependency graph

```
Track A (Defect A — wire makePino into Fastify)   — wiring fix; lands FIRST
Track B (Defect B — desktop-callback 500)         — depends on A for live debuggability
```

**Order: A → B** (per CONTEXT.md). Track A lands first: once `req.log` actually
emits, Track B's 500 is debuggable directly from `docker compose logs api`
instead of via an injected `console.error`. The tracks touch disjoint
production files (`index.ts` vs test fixtures / possibly `auth-callback.ts`) —
the order is debuggability sequencing. Single plan, single executor, sequential
commits.

---

## Track A — Defect A: wire `makePino` into Fastify

**Defect:** `apps/api/src/index.ts:309` builds `Fastify({ logger: false })`. The
`makePino()` factory and its REDACT_PATHS policy already exist and are already
imported; the fix is to feed a `makePino()`-built logger into the Fastify
constructor instead of `false`.

### Task A.1 — RED: assert the api request logger is real, redacting, and emits on 500

- File: `apps/api/tests/unit/__tests__/api-logger-wiring.test.ts` (new). Test
  name MUST reference Defect A / "api logger wiring".
- Boot the PRODUCTION `buildApp` from `apps/api/src/index.ts` in minimal mode
  (no `db`, mirroring `index.test.ts` "Test 2"). Register a tiny throwaway
  route, or reuse an existing route, that triggers the error-handler path.
- The test must FAIL pre-fix and PASS post-fix. Two assertion strategies — use
  whichever the executor confirms is wireable without touching production
  beyond the A.2 change:
  - **(a) Logger-identity assertion** — after `buildApp()`, assert
    `app.log` is a real pino logger (`typeof app.log.child === "function"` AND
    it is NOT the Fastify abstract no-op — e.g. assert `app.log.level` reflects
    the `LOG_LEVEL`/`info` default, or that a `app.log.child({})` returns a
    distinct child). With `logger:false` Fastify exposes an `Abstract` logger
    whose methods are no-ops; with a real pino instance `level` is a settable
    string. RED: pre-fix `app.log` is the no-op stub.
  - **(b) Destination-capture assertion** — the cleaner seam. A.2 should make
    `buildApp` accept an OPTIONAL `logger?: Logger` (or `loggerDestination?:
    DestinationStream`) `BuildAppOptions` field so the test can inject
    `makePino({ destination: <capture-stream> })`, drive a request that hits
    `error-handler.ts:233`, and assert the captured output contains a
    structured `"request error"` record with `status` and a redacted `err`.
    Production default stays a plain `makePino({ base: { service: "api" } })`.
- **Redaction assertion (REQUIRED in this test):** drive a request whose error
  carries a token-shaped field (e.g. throw an error with a `token` or
  `authorization` property, or a nested `err.response.config.headers.Authorization`).
  Assert the captured/serialized log line contains `[REDACTED]` and does NOT
  contain the raw secret value. This proves the REDACT_PATHS policy is applied
  through the api request logger — CONTEXT.md §Constraints "Redaction is not
  optional".
- Commit: `test(60-A): red — api process emits no structured request logs`.

### Task A.2 — GREEN: build Fastify with a `makePino()` logger

- File: `apps/api/src/index.ts`.
- Replace `Fastify({ logger: false, trustProxy: true })` at line 309 with
  `Fastify({ logger: <makePino-instance>, trustProxy: true })`. Build the
  instance via `makePino({ base: { service: "api" } })` — mirror how `bootLog`
  (line 616) and the worker tier tag their loggers. `makePino` is ALREADY
  imported at line 63 — no new import.
- If A.1 chose strategy (b): add an OPTIONAL `logger?: Logger` field to
  `BuildAppOptions`, and use `opts.logger ?? makePino({ base: { service: "api" } })`
  as the Fastify `logger` value. The production default is unchanged behavior;
  the field exists only as a test seam (mirrors the existing `destination` seam
  in `request-log.ts:buildLogger`).
- **DO NOT add a NODE_ENV branch.** Log level comes from `LOG_LEVEL` (read
  inside `makePino`), never `NODE_ENV`. `index.ts` IS in the LOCKER-01
  allowlist for pre-existing `NODE_ENV` reads, but a NEW `NODE_ENV` comparison
  added here would still be a regression — `pnpm lint:lockers` must stay green.
- **Line-number drift:** inserting/removing lines around 309 may shift the
  `file:line` entries for `index.ts` in `tools/lint-no-env-branches.allowlist.txt`
  and `tools/lint-no-hardcode.allowlist.txt`. After the edit, run
  `pnpm lint:lockers`; if LOCKER-01 or LOCKER-03 reports a stale allowlist
  line, update the affected `file:line` entry to the new line number — this is
  a mechanical allowlist sync, not a policy change.
- Verify the four CONTEXT.md wiring points still hold:
  1. `request-log` plugin's `req.log.child({openwhisprSource})` works (real
     pino child) — confirmed by the existing request-log tests staying green;
  2. `error-handler.ts:233` `req.log.warn` now emits — A.1's test;
  3. `LOG_LEVEL` still controls level — `makePino` reads it;
  4. REDACT_PATHS applies — A.1's redaction assertion.
- **CLAUDE.md hard rule 1:** if feeding a `makePino` logger into Fastify
  surfaces a deeper incompatibility (e.g. Fastify 5 rejects the pino instance
  shape, or a serializer collision with the existing request-log plugin), HALT,
  log in `.planning/deferred-items.md` with `WHY:` evidence — do not construct
  a bare pino bypassing `makePino` (that would drop the REDACT_PATHS policy).
- Commit: `fix(60-A): green — build api Fastify with a makePino structured logger`.

### Verification (Track A)

```
pnpm --filter @openwhispr/api test -- api-logger-wiring
pnpm --filter @openwhispr/api test -- request-log        # existing plugin tests still green
grep -n "logger: false" apps/api/src/index.ts            # must return NOTHING
grep -n "makePino" apps/api/src/index.ts                  # line 63 import + the new Fastify wiring
pnpm lint:lockers                                         # 8 lockers green — esp. LOCKER-01/03
# live stack (slim, api on localhost:4000):
docker compose build api && docker compose up -d api
curl -sS http://localhost:4000/api/health -w ' (%{http_code})'
docker compose logs api --since=1m | tail -20             # structured JSON request lines now present
```

---

## Track B — Defect B: desktop-callback 500 → 302

**Defect:** `GET /api/auth/desktop-callback/:provider` returns 500 where 302 is
expected. 6 red tests: `auth-callback.test.ts` (4 happy-path scheme matrix),
`oauth-channel-scheme-mint-bearer.test.ts` (1), `index.test.ts` (1
"mintBearer is plumbed").

### Task B.1 — obtain & confirm the real 500 stack (MANDATORY FIRST)

The CONTEXT.md prior diagnosis (test-fixture drift — fake `oauth_state` rows
lack the encrypted bytea sidecars `decryptCodeVerifierFromRow` requires) is a
STRONG PRIOR but MUST be confirmed against a real stack before B.2 writes a fix.

1. **From the live api stack (Track A landed, so logs now emit):** trigger the
   desktop-callback path against `localhost:4000` with a real `oauth_state` row
   and capture `docker compose logs api` — the `error-handler.ts:233`
   `"request error"` warn now carries the thrown error + stack.
   - IF a live row cannot be cheaply produced: run the failing unit test under
     vitest, OR inject a TEMPORARY `console.error(err)` at the `error-handler.ts`
     catch site, rebuild, capture the stack, then REVERT the temp console.error
     before any commit. (Track A makes the temp-console.error route unnecessary
     for the live stack — prefer `docker compose logs api`.)
2. Confirm the thrown error: the expected message is
   `"oauth_state row missing bytea sidecars for code_verifier"` thrown from
   `packages/data/src/encryption/oauth-state-codec.ts:95`.
3. **Branch on the confirmed cause:**
   - **Cause = test-fixture drift (expected)** → B.2 path (a): fix the test
     fakes to emit real encrypted sidecars. The production route is correct —
     DO NOT edit `auth-callback.ts`.
   - **Cause = a genuine route bug** (the stack points at production logic, not
     a missing-sidecar throw) → B.2 path (b): fix the ROOT cause in
     `apps/api/src/routes/auth-callback.ts` per CLAUDE.md hard rule 1, with the
     test asserting the regression-shape.
   - **Cause is blocked by a deeper constraint** (e.g. `encryptCodeVerifier`
     cannot run in a unit test without a `MASTER_KEK` / KeyProvider the fakes
     cannot supply) → HALT, log in `.planning/deferred-items.md` with `WHY:`
     evidence — do not hack a brittle workaround.
- Record the confirmed cause + the captured stack snippet in the SUMMARY.

### Task B.2 — RED+GREEN: fix the 6 red tests to green

The RED step here is *characterizing* — the 6 tests are ALREADY red. Per strict
TDD, first make the failure explicit and intentional (a small assertion or
fixture-shape change that pins the regression), then land the fix in the same
or an adjacent atomic commit.

**Path (a) — test-fixture drift (the expected branch):**

- Files: `apps/api/tests/unit/routes/auth-callback.test.ts`,
  `apps/api/tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts`,
  `apps/api/tests/unit/index.test.ts`.
- The `FakeStateRow` interface + `freshRow`/`freshStateRow` helpers + the
  `makeFakeDb` `UPDATE oauth_state ... RETURNING` branch in each file must be
  updated so the returned row carries the 6 real `code_verifier_*` bytea
  sidecar columns instead of (or in addition to) a plaintext `code_verifier`.
- Generate the sidecars with the real codec: import `encryptCodeVerifier` from
  `@openwhispr/data` (exported via `packages/data/src/encryption/index.ts`),
  call it with a deterministic test `KeyProvider` + the verifier plaintext, and
  spread the resulting `EncryptedRow` fields onto the fake row. The route's
  `decryptCodeVerifierFromRow` then resolves to the original plaintext — the
  `auth-callback.test.ts` assertion `arg.codeVerifier === "verifier-for-<scheme>"`
  still holds because encrypt→decrypt round-trips.
- The fake must supply a KeyProvider compatible with the route's
  `selectProvider()` default (or the route's `deps.keyProvider` must be set in
  the fake `buildApp` deps so the same provider used to encrypt is used to
  decrypt). Confirm `selectProvider()` / the `env` provider works in a unit
  test — if it needs `MASTER_KEK`, set it via `vi.stubEnv` in `beforeEach`
  (mirror the env-stub pattern already in `oauth-channel-scheme-mint-bearer.test.ts`).
- This is a **boundary-only** change — the fake DB is the test's process
  boundary; making it return the REAL encrypted shape the production schema
  emits is correcting the fake to match reality, NOT mocking internal logic.
- **No production edit.** `auth-callback.ts` and the codec are correct.
- Commit: `test(60-B): red+green — desktop-callback fakes emit encrypted oauth_state sidecars`
  (atomic: the fixture change makes all 6 go green in one commit; or split
  RED `test(60-B): red — ...` / GREEN `test(60-B): green — ...` if the executor
  prefers an explicit failing intermediate).

**Path (b) — genuine route bug (only if B.1 confirmed it):**

- File: `apps/api/src/routes/auth-callback.ts` (+ a RED test pinning the bug).
- Fix the ROOT cause so the callback returns 302 with the verbatim
  `<scheme>://?bearer_token=...` Location for all four schemes. The RED test
  asserts the regression-shape; the GREEN fix is the minimal correct change.
- CLAUDE.md hard rule 1: this branch only applies if B.1's stack proves a real
  route defect — never edit `auth-callback.ts` merely to green a stale test.
- Commit: `test(60-B): red — desktop-callback <bug>` then
  `fix(60-B): green — desktop-callback returns 302 for all four schemes`.

**Invariant (both paths):** all 6 named tests pass; the callback returns 302
with a Location matching `^<scheme>://\?bearer_token=...` for `openwhispr`,
`openwhispr-dev`, `openwhispr-staging`, `mycorp-whispr`; the state-lifecycle
error cases (consumed/expired/missing/503) stay green.

### Verification (Track B)

```
pnpm --filter @openwhispr/api test -- auth-callback
pnpm --filter @openwhispr/api test -- oauth-channel-scheme-mint-bearer
pnpm --filter @openwhispr/api test -- index.test
pnpm --filter @openwhispr/api test                # 0 failing — the 6 reds closed
grep -rn "code_verifier_value_ciphertext\|encryptCodeVerifier" apps/api/tests/unit
```

---

## Task C — update `.planning/deferred-items.md` (FINAL TASK)

After Tracks A + B are green and verified:

- File: `.planning/deferred-items.md`.
- The "Phase 59 — pre-existing api-suite failures" entry (lines ~14–32) covers
  exactly the 6 desktop-callback tests fixed by Track B. Mark it RESOLVED:
  append a closure marker — e.g.
  `**Status:** RESOLVED 2026-05-20 (Phase 60 Track B) — desktop-callback test
  fixtures updated to emit encrypted oauth_state sidecars; commit <sha>.` Record
  the actual cause (test-fixture drift vs route bug per B.1) and the commit SHA.
- Do NOT delete the entry — keep the historical record; only annotate it
  resolved.
- Commit: `docs(60): mark Phase 59 desktop-callback pre-existing failures resolved`.

---

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| api process → stdout / container log sink | Structured request/error records cross into a log aggregator (Loki); a secret-shaped value in an error object could leak verbatim (Defect A). |
| IdP → /api/auth/desktop-callback/:provider | An OAuth `code` + `state` cross into the token-mint path; the encrypted PKCE `code_verifier` is decrypted server-side (Defect B). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-01 | Information disclosure | api request logger | mitigate | Track A wires the logger EXCLUSIVELY through `makePino`, which applies the REDACT_PATHS policy (`[REDACTED]` censor) — A.1's test proves a token-shaped error field does NOT leak to stdout. A bare pino bypassing `makePino` is forbidden (CONTEXT.md). |
| T-60-02 | Repudiation / availability | every api 500 | mitigate | Track A makes `error-handler.ts:233` `req.log.warn` emit — every 500 now produces a durable structured server-side record; production incidents are no longer invisible. |
| T-60-03 | Tampering | desktop-callback PKCE verifier decrypt | accept | Track B does NOT change the production decrypt path — `decryptCodeVerifierFromRow` correctly rejects rows missing the encrypted sidecars (data:CR-05 fail-closed). The fix is to the TEST fakes, restoring fixture fidelity to the real encrypted schema. No production posture change. |
| T-60-04 | Spoofing | desktop-callback channel-scheme echo | mitigate | Track B keeps the existing `buildProtocolRedirect` scheme-allowlist validation — the 302 Location echoes only an allowlisted, validated scheme; the four-scheme matrix test pins this. |
</threat_model>

<verification>
Phase-level gate (run after both tracks + Task C):

```
pnpm --filter @openwhispr/api test          # 0 failing — the 6 desktop-callback reds + A.1 green
pnpm lint:lockers                           # 8 lockers green — esp. LOCKER-01 (no NEW NODE_ENV
                                            # branch in index.ts), LOCKER-03 (no new hardcoded literal)
pnpm typecheck                              # no NEW errors vs the documented 5-error baseline
git log --oneline -6                        # RED/GREEN pair for A, the Track B commit(s), the Task C doc commit
```

Live-stack re-verification (slim-test stack, api on localhost:4000,
`NODE_ENV=development`, `OPENWHISPR_TEST_ROUTES=true`):

```
docker compose build api && docker compose up -d api
curl -sS http://localhost:4000/api/health -w ' (%{http_code})'      # request emits a log line
# trigger a deliberate 500 (e.g. a malformed request to a route that 500s) and:
docker compose logs api --since=2m | grep -i "request error"        # the error-handler warn is visible
docker compose logs api --since=2m | grep -iE "sk-|bearer ey|password" # MUST be empty / only [REDACTED]
```

Spot-check (CLAUDE.md hard rule 3 — verify, do not relay):
- `grep -c "logger: false" apps/api/src/index.ts` → `0`.
- Each cited commit SHA is on HEAD; `git status --short` clean.
- `.planning/deferred-items.md` shows the Phase 59 desktop-callback entry
  annotated RESOLVED with a real commit SHA.
- `docker compose logs api` after a request shows structured JSON, AND no
  secret-shaped value appears in any captured line.
</verification>

<success_criteria>
- Defect A: RED+GREEN pair — `index.ts` builds Fastify with a `makePino()`
  logger; `req.log` call sites emit; `error-handler.ts:233` is visible on a
  500; REDACT_PATHS redaction proven by the A.1 test; no NODE_ENV branch added.
- Defect B: the 6 named tests (`auth-callback.test.ts` ×4,
  `oauth-channel-scheme-mint-bearer.test.ts` ×1, `index.test.ts` ×1) pass; the
  callback returns 302 with a verbatim `<scheme>://?bearer_token=...` Location
  for all four schemes; B.1's confirmed root cause recorded in the SUMMARY.
- `pnpm --filter @openwhispr/api test` — 0 failing.
- `pnpm lint:lockers` green (8 lockers); `pnpm typecheck` no new errors vs the
  5-error baseline.
- Live stack: `docker compose logs api` shows structured JSON request/error
  records AND no secret leakage.
- `.planning/deferred-items.md` — the Phase 59 desktop-callback pre-existing
  -failure entry annotated RESOLVED with the commit SHA.
- No skipped tests, no `.only`, no `@ts-expect-error` without `issue-NNNN:`.
- Any HALT logged in `.planning/deferred-items.md` with `WHY:` evidence.
</success_criteria>

<risk_register>
| Risk | Track | Mitigation |
|------|-------|------------|
| Feeding a `makePino` instance into Fastify 5 collides with the existing `request-log` plugin's `req.log.child` ordering or serializers. | A | A.2 verifies the existing `request-log` tests stay green; HALT + deferred-items if a serializer collision surfaces — do not bypass `makePino`. |
| A bare pino is constructed for the request logger, dropping the REDACT_PATHS policy. | A | Constitutional in CONTEXT.md — the logger MUST go through `makePino`. A.1's redaction assertion fails if a bare pino is used. |
| New NODE_ENV branch leaked into `index.ts` while wiring the logger. | A | Log level comes from `LOG_LEVEL` via `makePino` only; `pnpm lint:lockers` (LOCKER-01) must stay green; no new `NODE_ENV` comparison. |
| index.ts line-number drift invalidates the LOCKER-01/03 allowlist `file:line` entries. | A | After the edit, run `pnpm lint:lockers`; mechanically sync the stale `file:line` entries in the two allowlist files. |
| Track B fix written for a root cause that is not the live 500. | B | B.1 is a mandatory verify-first step — obtain & confirm the real stack before B.2 writes the fix; branch to path (b) if it is a route bug. |
| `encryptCodeVerifier` cannot run in a unit test (needs MASTER_KEK / a KeyProvider). | B | B.2 path (a) sets `MASTER_KEK` via `vi.stubEnv` and supplies the `env` KeyProvider; HALT + deferred-items if the codec cannot be exercised hermetically. |
| A failing test tempts a production hack on `auth-callback.ts`. | B | CLAUDE.md hard rule 1: B.1 confirms test-fixture drift; the fix is to the fakes. `auth-callback.ts` is edited ONLY if B.1 proves a real route bug. |
</risk_register>

<output>
After completion, create
`.planning/phases/60-api-logging-and-oauth-callback-fix/60-01-SUMMARY.md`.

In the SUMMARY, explicitly record:
- Track A: the A.1 assertion strategy chosen (logger-identity vs
  destination-capture seam) and whether `BuildAppOptions` gained a `logger?`
  field; confirmation that the live stack now emits structured JSON with no
  secret leakage.
- Track B: the B.1-confirmed root cause (test-fixture drift vs genuine route
  bug) with the captured 500 stack snippet; which path (a/b) was taken; the
  files changed.
- Whether the index.ts LOCKER allowlist `file:line` entries needed a sync.
- Any HALT + `.planning/deferred-items.md` entries.
- The commit SHA recorded in the resolved Phase 59 deferred-items entry.
</output>
