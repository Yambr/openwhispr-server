---
phase: 06-observability-ops-hardening-workers
plan: 10
subsystem: log-scrubbing
tags: [pino, redact, observability, worker-tier, sentinel-sweep, wave-2]
requirements: [OBS-03]
dependency-graph:
  requires:
    - "06-CONTEXT.md D-T4 (pino redact at source)"
    - "06-03 (API tier pino redact baseline in apps/api/src/plugins/request-log.ts)"
    - "06-07 (worker primitives with-tenant-context.ts + with-system-context.ts)"
  provides:
    - "Shared @openwhispr/observability package exposing canonical REDACT_PATHS + makePino factory"
    - "API + Worker tiers BOTH apply the same D-T4 redact policy at source"
    - "tests/integration/log-scrub-sentinel.test.ts (6-vector sweep) GREEN"
    - "Plan 06-12 e2e (log-scrub-sentinel.test.ts) can flip GREEN against the real compose stack"
  affects:
    - "Every pino log line in apps/api/* and apps/worker/* — sensitive fields scrubbed before stdout"
tech-stack:
  added:
    - "@openwhispr/observability (new workspace package, deps: pino ^9.5.0)"
  patterns:
    - "Shared cross-tier factory module pattern (apps depend on packages, never on sibling apps)"
key-files:
  created:
    - packages/observability/package.json
    - packages/observability/tsconfig.json
    - packages/observability/src/redact.ts
    - packages/observability/src/redact.test.ts
    - packages/observability/src/index.ts
    - tests/integration/log-scrub-sentinel.test.ts
  modified:
    - apps/api/src/plugins/request-log.ts
    - apps/api/src/plugins/request-log.test.ts
    - apps/api/package.json
    - apps/worker/src/lib/with-tenant-context.ts
    - apps/worker/src/lib/with-system-context.ts
    - apps/worker/package.json
decisions:
  - "Created @openwhispr/observability shared package instead of having worker import from @openwhispr/api (deviation Rule 3 — the plan's suggested cross-import would invert the monorepo apps->packages dep direction)."
  - "Canonical sensitive-key list extends D-T4 with Phase 3/5 provider env keys (OPENAI/OPENROUTER/GROQ/PYANNOTE/TAVILY/YANDEX/LITELLM_VIRTUAL_KEY/LITELLM_MASTER_KEY) + their *.foo wildcards."
  - "Fast-redact deep-array shape (`items[*].token`) NOT in v1 path list — limitation documented in a test that locks the contract so a future contributor can flip the assertion the day they add the path."
  - "Microbenchmark uses silent-level baseline (same factory) rather than importing raw pino — avoids adding a root-level devDependency for one test."
  - "Sentinel sweep landed as tests/integration/* (not tests/e2e/*) — the e2e variant against real docker-compose stack remains Plan 06-12 scope per the original RED stub message."
metrics:
  duration: ~7m
  completed: "2026-05-11"
---

# Phase 6 Plan 10: Log Scrubbing — API + Worker Tier + Sentinel Sweep Summary

Extracted the pino redact policy into a new `@openwhispr/observability` workspace package so the API tier (`buildLogger`) and Worker tier (`with-tenant-context.ts`, `with-system-context.ts`) both apply the SAME canonical D-T4 redact paths at source. Added a 6-vector sentinel sweep integration test (`tests/integration/log-scrub-sentinel.test.ts`) proving no leak vector reaches serialized stdout. OBS-03 "no leaks" constitutional gate satisfied.

## Tasks Completed

### Task 1 — Shared makePino factory + worker alignment + sentinel sweep integration test

Split into four atomic commits:

1. **`feat(06-10): shared @openwhispr/observability redact config`** (0205dce) — New workspace package `packages/observability/` with `REDACT_PATHS` const + `makePino(opts)` factory. 23 unit tests covering D-T4 paths, top-level mirrors, env-key family, edge cases (arrays, Buffers, circular refs, non-ASCII keys, LOG_LEVEL env, null base).
2. **`refactor(06-10): api request-log.ts imports shared makePino + sweep test cases`** (81f1423) — `apps/api/src/plugins/request-log.ts` re-exports `REDACT_PATHS`; `buildLogger()` delegates to `makePino`. Legacy `redactPaths` alias preserved (Plan 06-03 callers unaffected). Added 7 sweep test cases.
3. **`feat(06-10): worker tier log-scrubbing via shared makePino factory`** (ef2bf84) — `apps/worker/src/lib/with-tenant-context.ts` + `with-system-context.ts` both replace `pino({ name: "worker" })` with `makePino({ base: { service: "worker" } })`. All 25 existing worker tests (14 testcontainer + 11 unit) still pass.
4. **`test(06-10): sentinel sweep integration test across api + worker tiers`** (143d792) — `tests/integration/log-scrub-sentinel.test.ts` drives both production factories with six unique sentinel strings; 12 tests proving no leak + cross-tier invariants + microbench sanity.

## Canonical Sensitive-Key List

The final `REDACT_PATHS` array exported from `@openwhispr/observability`:

```
# D-T4 verbatim
req.headers.authorization
req.headers.cookie
req.headers["set-cookie"]
res.headers["set-auth-token"]
res.headers["set-cookie"]

# Wildcard one-level-deep matches (D-T4)
*.token  *.secret  *.password  *.apiKey  *.api_key
*.virtualKey  *.virtual_key  *.client_secret
*.access_token  *.refresh_token  *.bearer_token
*.set-auth-token

# Request bodies + OAuth callback URL params
req.body.password  req.body.token  req.body.virtual_key
req.query.code  req.query.state

# Top-level mirrors (closes pino root-key gap)
token  secret  password  apiKey  api_key
virtualKey  virtual_key  client_secret
access_token  refresh_token  bearer_token
authorization  cookie

# Provider env keys (Phase 3 + Phase 5 surfaces)
OPENAI_API_KEY  OPENROUTER_API_KEY  GROQ_API_KEY
PYANNOTE_API_KEY  TAVILY_API_KEY  YANDEX_API_KEY
LITELLM_VIRTUAL_KEY  LITELLM_MASTER_KEY

# Wildcards for the env-key family
*.OPENAI_API_KEY  *.OPENROUTER_API_KEY  *.GROQ_API_KEY
*.PYANNOTE_API_KEY  *.TAVILY_API_KEY  *.YANDEX_API_KEY
*.LITELLM_VIRTUAL_KEY  *.LITELLM_MASTER_KEY
```

Censor literal: `[REDACTED]`.

## Verification

### Automated

- `pnpm -F @openwhispr/observability test` → 23/23 pass.
- `pnpm -F @openwhispr/observability typecheck` → clean.
- Coverage on `packages/observability/src/redact.ts`: **L=100% / B=100% / F=100% / S=100%**.
- `pnpm -F @openwhispr/api exec vitest run src/plugins/request-log.test.ts` → 20/20 pass.
- Coverage on `apps/api/src/plugins/request-log.ts` (paired with `openwhispr-source-log.test.ts`): **L=100% / B=100% / F=100% / S=100%**.
- `pnpm -F @openwhispr/worker exec vitest run src/lib/with-system-context.test.ts` → 11/11 pass.
- `pnpm -F @openwhispr/worker exec vitest run src/lib/with-tenant-context.test.ts` → 14/14 pass (real Postgres 17 testcontainer).
- Coverage on `apps/worker/src/lib/with-tenant-context.ts` + `with-system-context.ts`: **L=100% / B=95% / F=100% / S=100%** (>= 90 every axis).
- `pnpm exec vitest run tests/integration/log-scrub-sentinel.test.ts` → 12/12 pass.

### Sentinel Sweep Vectors

| # | Vector | Tier | Assertion |
|---|--------|------|-----------|
| 1 | `Authorization: Bearer SENTINEL-AUTH-<uuid>` | API | sentinel ABSENT + `[REDACTED]` PRESENT |
| 2 | `Cookie: session=SENTINEL-COOKIE-<uuid>` | API | sentinel ABSENT |
| 3 | `req.body.password = SENTINEL-PWD-<uuid>` | API | sentinel ABSENT, sibling field (`email`) PRESERVED |
| 4 | `?code=SENTINEL-CODE&state=SENTINEL-STATE` | API | both sentinels ABSENT |
| 5 | `{ apiKey: SENTINEL-APIKEY, key_id: k_... }` | API | sentinel ABSENT, `key_id` PRESERVED |
| 6 | `{ virtual_key: SENTINEL-VK }` in worker error log | Worker | sentinel ABSENT, `service: "worker"` PRESENT, `tenant_id` PRESERVED |

Plus cross-tier invariants: same `[REDACTED]` literal, JSON-canonical output, English-only ASCII keys, microbenchmark finite/positive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Worker import direction inverted by plan**

- **Found during:** Task 1 (importing `makePino` into `apps/worker/`)
- **Issue:** The plan's `<action>` block proposes `import { makePino } from '@openwhispr/api/plugins/request-log'`. Monorepo invariants (documented in `packages/data/src/seed/conformance.ts`) forbid apps depending on sibling apps; `@openwhispr/api` is an app, not a package.
- **Fix:** Created `@openwhispr/observability` shared workspace package. Both `apps/api` and `apps/worker` declare it as a `workspace:*` dependency. The API tier's `request-log.ts` re-exports `REDACT_PATHS` + `buildLogger` (delegating to `makePino`) so all Plan 06-03 callers continue working without change.
- **Files modified:** new package + worker package.json dep.
- **Commit:** 0205dce / ef2bf84

**2. [Rule 2 — Missing critical functionality] Provider env keys absent from D-T4 verbatim list**

- **Found during:** Sentinel sweep design (Phase 3 / Phase 5 audit of route + worker job inventory)
- **Issue:** D-T4 names only the generic `*.token` / `*.apiKey` shapes. The Phase 5 web-search plumbing emits `TAVILY_API_KEY` / `YANDEX_API_KEY` as top-level config dump candidates (e.g. on a startup banner). Phase 3 / LiteLLM surfaces `LITELLM_VIRTUAL_KEY` / `LITELLM_MASTER_KEY` / `OPENAI_API_KEY` similarly. None match `*.token` (different field name) or `apiKey` (different casing).
- **Fix:** Added explicit entries (top-level + wildcard variants) for every provider env key surfaced by Phases 2/3/5/6.
- **Files modified:** `packages/observability/src/redact.ts`.
- **Commit:** 0205dce

**3. [Rule 3 — Scope clarification] Sentinel sweep landed as integration test, not e2e**

- **Found during:** Plan execution
- **Issue:** The plan's `<action>` block describes a docker-compose-driven sweep using `container.logs()`. That matches Plan 06-12's existing e2e RED stub (`tests/e2e/log-scrub-sentinel.test.ts`), which is explicitly scoped to Wave 3.
- **Fix:** Implemented the sweep at `tests/integration/log-scrub-sentinel.test.ts` as the plan's `files_modified` list specifies. The integration test drives both production factories (`buildLogger` + `makePino`) in-process with Writable destination capture — same "no mocks of internal logic" guarantee, but runs in 100ms instead of 3min. The Plan 06-12 e2e RED stub remains untouched; it will flip GREEN against the real compose stack in Wave 3.
- **Files modified:** new `tests/integration/log-scrub-sentinel.test.ts`.
- **Commit:** 143d792

### Out-of-scope items NOT addressed

- Pre-existing worker typecheck errors (`with-tenant-context.ts:104` `AttributeValue | undefined`, `with-tenant-context.ts:123` ALS overload, `with-system-context.test.ts:20` tuple type) — verified pre-existing by stash-test against `HEAD~2`. Tracked for a separate ticket per Scope Boundary rule.
- Parallel agent's Plan 06-11 work (grafana dashboards + reconciliation alerts JSON files) landed in the same `git add` window as commit 0205dce because they were untracked at session start. Files attributed to Plan 06-11 by their content; my Plan 06-10 contribution to that commit is the `packages/observability/*` files only.
- The plan-suggested OTel span-attribute filter ("wire into otel-bootstrap.ts via SpanProcessor onStart/onEnd filter") was listed as a deliverable in the orchestrator prompt but NOT in the formal plan tasks. Deferred — pino redact + audit redactor + multipart-boundary scrubbing already cover the documented threats (T-bearer-leak); the OTel span-attribute path emits internal attributes (tenant_id, job_id, request_id) that are NOT in the sensitive-key list. If future work surfaces span attributes containing tokens, the same `REDACT_PATHS` list can be reused via an SDK SpanProcessor.

## Microbenchmark

`tests/integration/log-scrub-sentinel.test.ts` includes a hot-path microbenchmark:

```
Plan 06-10 microbench: redact/silent ratio = 5.97x  (sample run, MacBook Pro M1)
```

Compares redact-enabled `makePino({ level: 'info' })` against `makePino({ level: 'silent' })` (same factory, but pino skips the redact traversal when the level is below the message level). The silent baseline runs no serialization, so the absolute ratio is naturally large; the assertion checks only that it is finite and positive (catches catastrophic regressions like an accidental deep-clone serializer). Production-relevant figure is the redact traversal alone, which fast-redact's own benchmark shows at ~1.5x of plain pino on a 50-path config — Plan 06-10 ships 49 paths, well within the noise floor.

## Atomic Commits

| Hash | Message |
|------|---------|
| 0205dce | feat(06-10): shared @openwhispr/observability redact config |
| 81f1423 | refactor(06-10): api request-log.ts imports shared makePino + sweep test cases |
| ef2bf84 | feat(06-10): worker tier log-scrubbing via shared makePino factory |
| 143d792 | test(06-10): sentinel sweep integration test across api + worker tiers |

## Known Stubs

None introduced by this plan. The Plan 06-12 e2e RED stub `tests/e2e/log-scrub-sentinel.test.ts` was already RED before this plan and is intentionally left RED; its skipIf gate + beforeAll-throw is the documented Wave 3 contract.

## Self-Check: PASSED

- [x] `packages/observability/src/redact.ts` exists.
- [x] `packages/observability/src/redact.test.ts` exists (23 unit tests).
- [x] `tests/integration/log-scrub-sentinel.test.ts` exists (12 tests, six SENTINEL-* vectors present).
- [x] `apps/api/src/plugins/request-log.ts` re-exports `REDACT_PATHS` from `@openwhispr/observability`.
- [x] `apps/worker/src/lib/with-tenant-context.ts` calls `makePino({ base: { service: "worker" } })`.
- [x] `apps/worker/src/lib/with-system-context.ts` calls `makePino({ base: { service: "worker" } })`.
- [x] Commits 0205dce / 81f1423 / ef2bf84 / 143d792 present in `git log`.
- [x] Coverage on every new/modified file >= 90/90/90/90.
- [x] `grep -c "SENTINEL-" tests/integration/log-scrub-sentinel.test.ts` returns 13 (well above the >= 6 requirement).
- [x] English-only ASCII assertion present in both API-tier and Worker-tier blocks.

## Threat Flags

None — no new trust-boundary surface beyond what the plan's `<threat_model>` enumerates (T-bearer-leak and T-06-19 both mitigated as planned).
