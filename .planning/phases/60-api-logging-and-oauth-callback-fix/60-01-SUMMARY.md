---
phase: 60-api-logging-and-oauth-callback-fix
plan: 01
subsystem: api
tags: [observability, logging, oauth, auth-callback, test-fixtures, lockers]
requires: []
provides:
  - "api process emits structured per-request JSON logs (makePino-backed)"
  - "desktop-callback unit fixtures emit encrypted oauth_state code_verifier sidecars"
affects:
  - apps/api/src/index.ts
tech-stack:
  added: []
  patterns:
    - "Fastify 5 `loggerInstance` key for a pre-built pino logger"
    - "test fakes encrypt code_verifier via encryptCodeVerifier to match the real schema"
key-files:
  created:
    - apps/api/tests/unit/__tests__/api-logger-wiring.test.ts
  modified:
    - apps/api/src/index.ts
    - apps/api/tests/unit/routes/auth-callback.test.ts
    - apps/api/tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts
    - apps/api/tests/unit/index.test.ts
    - tools/lint-no-env-branches.allowlist.txt
    - tools/lint-no-hardcode.allowlist.txt
    - tools/lint-no-suppressions.allowlist.txt
    - .planning/deferred-items.md
decisions:
  - "Track A used the destination-capture seam (strategy b): BuildAppOptions gained an optional `logger?: FastifyBaseLogger` field"
  - "Track B confirmed root cause = test-fixture drift; production route untouched (CLAUDE.md hard rule 1)"
metrics:
  duration: "~50m"
  completed: 2026-05-20
---

# Phase 60 Plan 01: API request logging + OAuth desktop-callback 500 fix Summary

Wired `makePino` into the api Fastify instance so per-request logging
actually emits (Track A), and fixed the 6 red desktop-callback unit
tests by correcting their `oauth_state` fixtures to emit the encrypted
`code_verifier_*` bytea sidecars the post-Phase-33 route requires
(Track B). Both via strict RED→GREEN TDD.

## Track A — wire makePino into Fastify (Defect A)

**A.1 assertion strategy chosen:** destination-capture seam (strategy b).
`BuildAppOptions` gained an optional `logger?: FastifyBaseLogger` field —
a test-only injection seam. The RED test (`api-logger-wiring.test.ts`)
injects `makePino({ destination })`, drives a 500 through `/readyz` (a
throwing `depCheck` escapes to the centralized error handler), and
asserts the captured output contains a structured `"request error"`
record with the err's token-shaped field censored to `[REDACTED]`. A
second test asserts `app.log` is a real pino logger (string `level`,
distinct `child`), not the Fastify no-op stub.

**A.2 GREEN:** `Fastify({ logger: false })` → `Fastify({ loggerInstance:
opts.logger ?? makePino({ base: { service: "api" } }) })`. Fastify 5
distinguishes a logger *options object* (`logger` key) from a pre-built
*instance* (`loggerInstance` key) — `makePino` returns an instance, so it
goes under `loggerInstance`. Log level comes from `LOG_LEVEL` via
`makePino`; no NODE_ENV branch added.

**`BuildAppOptions` gained a `logger?` field:** yes — typed as
`FastifyBaseLogger` (not `pino.Logger`) so the Fastify constructor keeps
its default logger generic. A narrower `pino.Logger` made Fastify infer
`FastifyInstance<..., Logger>`, which broke route-plugin assignability
under `exactOptionalPropertyTypes` (cascading TS2322 errors). Typing the
seam as `FastifyBaseLogger` — which `makePino`'s return structurally
satisfies — keeps typecheck at the 5-error baseline.

**Live-stack confirmation:** rebuilt the api container, hit
`/api/health` and several authed routes. `docker compose logs api` now
shows structured JSON: `{"level":30,...,"service":"api","reqId":...,
"msg":"incoming request"}` / `"request completed"`. The error-handler's
`req.log.warn(...,"request error")` line emits (`level:40`) with the
full err type + stack. A request carrying
`authorization: Bearer sk-fake-leak-probe-token` produced **no** secret
leakage — `grep -iE "sk-…|bearer ey|password"` over the logs returned
empty. No secret-shaped value appears in any captured line.

## Track B — desktop-callback 500 → 302 (Defect B)

**B.1 confirmed root cause: test-fixture drift** (NOT a route bug). Phase
33 migration 0020 dropped the plaintext `oauth_state.code_verifier`
column; the desktop-callback route reads 6 encrypted `code_verifier_*`
bytea sidecars and calls `decryptCodeVerifierFromRow`. The three test
files' fake `oauth_state` rows carried only a plaintext `code_verifier`
string and no sidecars.

Captured stack (confirmed via a standalone codec repro — a plaintext-only
fake row fed to `decryptCodeVerifierFromRow`):

```
Error: oauth_state row missing bytea sidecars for code_verifier
  at decryptCodeVerifierFromRow (packages/data/src/encryption/oauth-state-codec.ts:95)
```

That throw escapes `auth-callback.ts:249` → centralized error handler →
500 envelope instead of 302. The CONTEXT.md prior diagnosis was correct.

**Path taken: (a)** — fix the TEST fakes. Per CLAUDE.md hard rule 1 the
production route + codec are correct; `auth-callback.ts` was NOT touched.

**Files changed (Track B):**
- `apps/api/tests/unit/routes/auth-callback.test.ts` — `FakeStateRow`
  gained the 6 `code_verifier_*` Buffer fields; `freshRow` is now async
  and encrypts the verifier via `encryptCodeVerifier`; `buildApp` binds
  the suite `keyProvider` into route deps; `beforeEach` stubs a 32-byte
  `MASTER_KEK`.
- `apps/api/tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts`
  — same fixture shape; the row is encrypted inline; `keyProvider` fed
  into `buildAuthCallbackRoutes` deps.
- `apps/api/tests/unit/index.test.ts` — uses the production `buildApp`
  (which does not expose `keyProvider`), so the fixture is encrypted with
  an `EnvKeyProvider` bound to the same stubbed `MASTER_KEK` the route's
  default `selectProvider()` reads.

The fake DB is the test's process boundary; making it return the real
encrypted schema shape corrects the fixture to match reality — not a
mock of internal logic (CLAUDE.md "no mocks of internal logic").

## LOCKER allowlist sync

Yes — the `index.ts` logger-wiring change shifted pre-existing
allowlisted `file:line` entries by +32 lines (the `BuildAppOptions.logger`
docblock + the Fastify constructor comment block). LOCKER-01 (NODE_ENV
reads), LOCKER-02 (`as unknown as` casts ×9) and LOCKER-03 (litellm port
literal) allowlist entries were re-synced — mechanical drift, no policy
change. Committed in `ac14d9ee` (the initial GREEN commit `267398b3`
shipped a partially-stale sync because a later same-staging-area edit
shifted lines another +6; `ac14d9ee` corrects it). `pnpm lint:lockers`
is green (8 lockers).

## Verification

- `pnpm --filter @openwhispr/api test` — **1415 passing, 0 failing**,
  2 skipped (1407 pre-phase + 6 Track B reds closed + 2 Track A new).
- `pnpm lint:lockers` — 8 lockers green.
- `pnpm typecheck` — 5 errors, **identical to the documented baseline**
  (`assemblyai.ts:106`, `deepgram.ts:72`, `routes/index.ts:377/378/384`)
  — `diff` against the pre-phase baseline is empty.
- Live stack: `docker compose logs api` shows structured JSON request +
  `"request error"` records; no secret-shaped value leaks.

## Deviations from Plan

None — plan executed as written. Track A used strategy (b) as the plan
permitted; Track B took path (a) as the confirmed root cause indicated.

## HALT

None.

## Deferred-items closure

`.planning/deferred-items.md` — the "Phase 59 — pre-existing api-suite
failures" entry annotated **RESOLVED 2026-05-20 (Phase 60 Track B,
commit `c3ec3be0`)**, recording test-fixture drift as the confirmed
cause. Entry retained for the historical record (not deleted) per the
Task C instruction.

## Commits

- `ea2ee2eb` test(60-A): red — api process emits no structured request logs
- `267398b3` fix(60-A): green — build api Fastify with a makePino structured logger
- `ac14d9ee` fix(60-A): sync index.ts LOCKER allowlist line numbers post-logger-wiring
- `c3ec3be0` test(60-B): red+green — desktop-callback fakes emit encrypted oauth_state sidecars
- (this file) docs(60): mark Phase 59 desktop-callback pre-existing failures resolved

## Self-Check: PASSED
