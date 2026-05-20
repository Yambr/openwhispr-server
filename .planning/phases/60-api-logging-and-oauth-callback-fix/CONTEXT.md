# Phase 60 — API request logging + OAuth desktop-callback 500 fix

## Background

Two defects surfaced during Phase 59 execution, both pre-publication
blockers, neither in Phase 59's R14–R18 scope:

1. **The api process logs nothing per-request.** `apps/api/src/index.ts:309`
   builds the app with `Fastify({ logger: false, trustProxy: true })`.
   With `logger: false`, Fastify's `req.log` is a no-op stub. There are
   17+ `req.log.{warn,info,error}` call sites in production code —
   `error-handler.ts:233` (`req.log.warn({err,status}, "request error")`,
   the ONLY server-side record of every 500), `index.ts:383/449/536`,
   `routes/transcribe.ts:220`, `routes/reason.ts:121`,
   `routes/diarization.ts:313/358/367/373/377/502`, and the
   `plugins/request-log.ts` plugin which does `req.log = req.log.child({...})`.
   ALL of them silently discard their output. A live 500 produces zero
   container log lines — confirmed during the Phase 59 R14 debug, where
   a temporary `console.error` had to be injected into the error handler
   just to obtain a stack trace. This blinds every future production
   incident and every e2e debug cycle.

2. **`GET /api/auth/desktop-callback/:provider` 500s instead of 302.**
   Six api unit tests are red — `tests/unit/routes/auth-callback.test.ts`
   (4: the "4-scheme matrix" happy-path cases for `openwhispr`,
   `openwhispr-dev`, `openwhispr-staging`, `mycorp-whispr`),
   `tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts` (1),
   `tests/unit/index.test.ts` (1, "Test 1: mintBearer is plumbed → OAuth
   callback returns 302 NOT 503"). The shared symptom: the desktop OAuth
   callback returns **500** where the test expects **302** with a
   `<scheme>://?bearer_token=...` Location header. Verified pre-existing
   — the same 4 `auth-callback` failures reproduce at commit `d391961e`
   (Phase 59 Track-A baseline), so they pre-date the R15–R18 work and
   are NOT a Phase 59 regression. Logged in `.planning/deferred-items.md`.

## Triage notes (verified, 2026-05-20)

- #1: `makePino()` (the canonical pino factory with the D-T4 REDACT_PATHS
  policy) already exists in `packages/observability` and is already
  imported into `apps/api/src/index.ts:63` + used for `bootLog`
  (`index.ts:616`) and `ssrfLog` (`bootstrap.ts:23`). The fix is to feed
  a `makePino()`-built logger into `Fastify({ logger: <logger> })`
  instead of `false`. The `request-log` plugin's `req.log.child(...)`
  and all 17 call sites then emit automatically, with redaction applied.
  This is a wiring fix, not new infrastructure.
- #2: the failing tests boot their own app instance. The 500 cause is
  not yet diagnosed — could be a genuine route bug in the desktop
  OAuth callback handler, a test-harness/fixture drift, or a missing
  dependency in the test's `buildApp` opts (the `index.test.ts` case
  name "mintBearer is plumbed" hints the callback depends on a
  `mintBearer` wiring that may be absent). The planner / executor must
  obtain the actual 500 stack (note #1 — until logging is wired, use a
  temporary `console.error` at the error-handler catch site, rebuild,
  capture, revert) and fix the ROOT cause. CLAUDE.md hard rule 1: if the
  500 is a test-harness defect, fix the test; if it is a route bug, fix
  the route — never edit production code merely to green a test.

## Goal

After this phase:
1. The api process emits structured per-request logs to stdout: every
   `req.log.{warn,info,error}` call site produces output, the
   error-handler's "request error" warn is visible on every 500, and
   the `@openwhispr/observability` REDACT_PATHS policy is applied (no
   secret leakage in logs — verify against the existing
   `log-scrub-sentinel` integration test if one covers the api tier).
2. `GET /api/auth/desktop-callback/:provider` returns `302` with the
   correct `<scheme>://?bearer_token=...` Location for all four channel
   schemes; the 6 currently-red api tests pass.
3. Each fix lands via strict TDD (RED→GREEN→REFACTOR), atomic commits.
4. `pnpm test` green for `api` (1413 passing, 0 failing — the 6 reds
   closed); `pnpm lint:lockers` green (8 lockers); `pnpm typecheck` no
   new errors vs the documented 5-error baseline.
5. `.planning/deferred-items.md` updated — the OAuth-callback entry
   marked resolved.

## Track summary

### Track A — wire `makePino` into Fastify
Defect #1.

`apps/api/src/index.ts:309` — replace `logger: false` with a
`makePino()`-built logger instance (the api tier should pass an
appropriate `base` such as `{ service: "api" }`, mirroring how
`worker` / `bootLog` tag theirs). Confirm:
- the `request-log` plugin's `req.log.child({openwhisprSource})` still
  works (it relies on `req.log` being a real pino child-capable logger);
- the error-handler's `req.log.warn({err,status}, "request error")`
  now emits on a 500;
- `LOG_LEVEL` env still controls level (makePino already reads it);
- redaction: a 500 whose error carries a token-shaped field does NOT
  leak it to stdout (REDACT_PATHS covers `err`-nested paths — verify).
RED: a test asserting the error-handler path emits a structured log
record (capture via the `makePino({destination})` test seam, or assert
the route-level logger is a real pino instance, not the Fastify no-op).
Watch the LOCKER set — `index.ts` is in the LOCKER-01 allowlist for
NODE_ENV reads; do not add new NODE_ENV branches (logger level comes
from `LOG_LEVEL`, not `NODE_ENV`).

### Track B — fix the desktop-callback 500
Defect #2.

First action: obtain the real 500 stack (see triage note #2). Then fix
the ROOT cause — route bug vs test-harness drift — per CLAUDE.md hard
rule 1. The 6 affected tests:
`tests/unit/routes/auth-callback.test.ts` (4),
`tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts` (1),
`tests/unit/index.test.ts` (1). All must go green. The fix must echo
the channel scheme verbatim in the redirect (`openwhispr`,
`openwhispr-dev`, `openwhispr-staging`, `mycorp-whispr`) and return
302, not 500/503.

Track A lands first — once logging works, Track B's 500 is debuggable
from `docker compose logs api` directly instead of via injected
`console.error`.

## Constraints

- **Strict TDD** — RED→GREEN→REFACTOR; test + production code atomic.
- **No mocks of internal logic** — boundary mocks only.
- **No bypassing gitleaks hooks** — CLAUDE.md hard rule 4.
- **Constitutional lockers green** — `pnpm lint:lockers` (8) after every
  track. When edits shift line numbers, update the LOCKER allowlist
  `file:line` entries (`tools/lint-no-env-branches.allowlist.txt`,
  `tools/lint-no-hardcode.allowlist.txt`).
- **No production code edited "to make tests pass"** — CLAUDE.md hard
  rule 1. HALT + `.planning/deferred-items.md` if a test exposes a
  deeper constraint.
- **commitlint** — conventional-commit subjects, lowercase start,
  ≤ ~72 chars (e.g. `fix(60-B): return 302 from desktop-callback`).
- **EN-only** source artifacts.
- **Redaction is not optional** — the api logger MUST go through
  `makePino` so the REDACT_PATHS policy applies; never construct a bare
  pino for the request logger.

## Verification gate

Phase passes when:
1. Both defects have a RED test + GREEN fix on main.
2. Live-stack check: `docker compose build api && docker compose up -d api`,
   trigger a deliberate 500 (or any logged request), confirm
   `docker compose logs api` now shows structured JSON request/error
   records — AND confirm no secret-shaped value leaks into them.
3. `pnpm --filter @openwhispr/api test` — 0 failing (the 6 reds closed).
4. `pnpm lint:lockers` green (8 lockers).
5. `pnpm typecheck` — no new errors vs the 5-error baseline.
6. `git log --oneline` shows the expected RED/GREEN commits.
7. `.planning/deferred-items.md` — OAuth-callback entry marked resolved.

## Reference

- `apps/api/src/index.ts:309` — `Fastify({ logger: false })` (defect #1 site)
- `apps/api/src/error-handler.ts:233` — `req.log.warn` (the dead 500 log)
- `apps/api/src/plugins/request-log.ts` — `req.log.child` plugin
- `packages/observability/src/redact.ts` — `makePino` + REDACT_PATHS
- `apps/api/src/routes/` — the desktop-callback route (defect #2)
- `tests/unit/routes/auth-callback.test.ts`,
  `tests/unit/__tests__/oauth-channel-scheme-mint-bearer.test.ts`,
  `tests/unit/index.test.ts` — the 6 red tests
- `.planning/deferred-items.md` — pre-existing-failure log entry
- CLAUDE.md hard rules: 1, 3, 4
- Phase 59 (just closed): `.planning/phases/59-client-e2e-server-followups/`
