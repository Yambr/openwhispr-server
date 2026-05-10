---
phase: 03
plan: 06
slug: api-diarization-route-sync-wrapper
subsystem: api
tags: [diarization, pyannote, idempotency, sync-wrapper, valkey, D-07-REVISED]
status: complete
completed: 2026-05-10
requirements: [LITELLM-03, PROVIDER-01]
dependency-graph:
  requires:
    - 03-01
    - 03-02
    - 03-03
  provides:
    - apps/api/src/lib/pyannote-client.ts
    - apps/api/src/lib/idempotency-cache.ts
    - apps/api/src/routes/diarization.ts
    - packages/contract-tests/src/diarization.test.ts
  affects:
    - apps/api/src/routes/index.ts (buildAllRoutes — diarization wired when deps.redis present)
tech-stack:
  added:
    - "@redis/client (idempotency cache backing — same client family as rate-limit plugin)"
  patterns:
    - "Stripe-style idempotency: SET NX EX + KEEPTTL semantics, 24h TTL, body-hash conflict -> 409"
    - "Sync-wrapper over async upstream: orchestrate 4-step pyannote flow server-side, return sync 200 to desktop"
    - "Abort-on-disconnect via AbortController + req.raw.on('close')"
    - "Pitfall #8: upstream 401/403 -> 503 (NEVER 401 to desktop) via mapPyannoteError"
key-files:
  created:
    - apps/api/src/lib/pyannote-client.ts
    - apps/api/src/lib/__tests__/pyannote-client.test.ts
    - apps/api/src/lib/idempotency-cache.ts
    - apps/api/src/lib/__tests__/idempotency-cache.test.ts
    - apps/api/src/routes/diarization.ts
    - apps/api/src/routes/__tests__/diarization.test.ts
    - packages/contract-tests/src/diarization.test.ts
  modified:
    - apps/api/src/routes/index.ts (DiarizationDeps wired; route registered when deps.redis is supplied)
decisions:
  - "Mount path: /v1/audio/diarization (Speaches sync wire-shape canonical, locked in docs/wire-contracts-phase-3.md / Plan 01 D-09 spike)"
  - "Polling cadence: 1500ms interval, 300_000ms (5min) ceiling — beyond ceiling -> 504 with jobId hint for caller resume"
  - "Idempotency-Key fallback: SHA-256(file) when header absent — keeps retries cheap even when desktop forgets the header"
  - "PYANNOTE_API_KEY consumed by Fastify route via apps/api/src/lib/pyannote-client.ts; NEVER referenced from compose/litellm/litellm_config.yaml (D-07 REVISED removed pass_through_endpoints entry)"
  - "Diarization unmetered (LITELLM-07 acknowledged) — no usage_ledger row written; v2 may add nginx-log-based metering"
metrics:
  duration: ~110m (split across two agent invocations due to a transient API rate limit between Tasks 2 and 3)
  tasks-completed: 3
  files-created: 7
  files-modified: 1
---

# Phase 03 Plan 06: API Diarization Route (Sync-Wrapper) Summary

POST /v1/audio/diarization implemented as a Fastify sync-wrapper over
pyannote.ai's 4-step async API per **D-07 REVISED (2026-05-10)**: server-side
orchestration of `media/input → presigned PUT → diarize → poll jobs/{jobId}`
with Stripe-style idempotency in Valkey makes client retries cheap and
preserves the Speaches-compatible sync `{duration, segments[]}` wire shape
the desktop expects.

## What was built

| Surface | Path | Purpose |
|---|---|---|
| Route | `POST /v1/audio/diarization` | Sync-wrapper handler (350 LOC) |
| Library | `apps/api/src/lib/pyannote-client.ts` | undici wrapper for the 4 pyannote.ai endpoints |
| Library | `apps/api/src/lib/idempotency-cache.ts` | Stripe-semantics Valkey cache (24h TTL) |
| Wiring | `apps/api/src/routes/index.ts` | `if (deps.redis) plugins.push(buildDiarizationRoutes(...))` |
| Contract test | `packages/contract-tests/src/diarization.test.ts` | Wire-shape conformance against deployed stack (MOCK_DIARIZATION=true profile + RUN_E2E gated real pyannote.ai variant) |

## Locked mount path

`/v1/audio/diarization` — Speaches sync wire-shape canonical per
`docs/wire-contracts-phase-3.md` (Plan 01 D-09 spike). The desktop client
sees the same shape regardless of whether a deployment runs bundled mode
(this Fastify route) or corporate-LiteLLM-override mode (single-hop
pass-through to an internal pyannote-compatible endpoint).

## Status code matrix — all witnessed by failing-test-first

| Status | Trigger | Test name |
|---|---|---|
| 200 | succeeded job returns DiarizationResponse | "returns canonical DiarizationResponse on succeeded poll (200 happy path)" |
| 200 | mockMode=true (MOCK_DIARIZATION) | "short-circuits to mock fixture when mockMode=true (MOCK_DIARIZATION)" |
| 200 | idem hit (cached jobId, skip submit) | "idempotent re-post with same Idempotency-Key + body reuses cached jobId (200; submit called once)" |
| 400 | non-multipart content-type | "rejects non-multipart content-type with 400 envelope" |
| 400 | multipart without file part | "returns 400 envelope when multipart has no file part" |
| 401 | no auth (req.user absent) | "returns 401 envelope when no auth (req.user absent)" |
| 409 | Idempotency-Key conflict (Stripe) | "returns 409 envelope when Idempotency-Key reused with different body (Stripe semantics)" |
| 502 | pyannote job 'failed' | "returns 502 envelope when pyannote job status='failed'" |
| 502 | pyannote job 'cancelled' | "returns 502 envelope when pyannote job status='cancelled'" |
| 502 | PyannoteBadRequestError (4xx) | "returns 502 envelope on PyannoteBadRequestError (upstream rejected our payload)" |
| 503 | missing PYANNOTE_API_KEY (Pitfall #8) | "returns 503 envelope when PYANNOTE_API_KEY is missing (Pitfall #8 — NOT 401)" |
| 503 | PyannoteUnavailableError + retry-after:30 | "returns 503 envelope + retry-after header on PyannoteUnavailableError (5xx upstream)" |
| 503 | PyannoteAuthError (Pitfall #8) | "converts PyannoteAuthError (401/403 upstream) to 503 with operator-actionable message (Pitfall #8)" |
| 504 | 5min ceiling exceeded with jobId | "returns 504 envelope with jobId when polling exceeds the 5-minute ceiling" |

## Idempotency cache shape

| Property | Value |
|---|---|
| Key namespace | `diar:idem:<key>` |
| TTL | 86_400s (24h) |
| Reservation atom | `SET key value EX 86400 NX` (first-writer-wins) |
| Bind step | `SET key value KEEPTTL` (preserves original window) |
| Body-hash conflict (T-03-06-03) | Same key + different SHA-256(body) → state='conflict' → 409 |
| Idempotency-Key fallback | When header absent, key = SHA-256(file) so retries with the same body still hit the cache |

## Pyannote client error → HTTP status mapping

| Error class | Trigger | HTTP | Notes |
|---|---|---|---|
| `MissingPyannoteKeyError` | factory throws when env unset | 503 | Pitfall #8 — NEVER 401 to desktop |
| `PyannoteAuthError` | upstream 401/403 | 503 | Operator-actionable message; NEVER 401 |
| `PyannoteUnavailableError` | upstream 5xx | 503 | retry-after: 30 header |
| `PyannoteBadRequestError` | upstream 4xx other | 502 | Generic "pyannote rejected request" |
| `PyannoteUpstreamError` | presigned PUT non-2xx etc. | 502 | Generic "pyannote upstream error" |
| (job status) failed/cancelled | poll loop reads job status | 502 | jobId echoed in envelope for debugging |

## MOCK_DIARIZATION wiring + contract test green witness

`apps/api/src/routes/index.ts` reads either the explicit `deps.mockDiarization`
flag or `process.env.MOCK_DIARIZATION === "true"` and forwards it to
`buildDiarizationRoutes` as `mockMode`. The route's `mockMode` short-circuit
sends the parsed fixture body before any pyannote client is constructed —
no PYANNOTE_API_KEY needed for the contract-test profile.

Contract-test run (no backend reachable): **4 skipped, 0 failed.** The
`describe.skipIf(!REACHABLE)` pattern matches reason.test.ts and
transcribe.test.ts exactly. CI / `make contract-test` brings the compose
stack up with `MOCK_DIARIZATION=true` and the four assertions become four
green tests.

## E2E green witness

**Skipped** — RUN_E2E=true is not set in this run; live pyannote.ai
exercise is deferred to operators with `.env.e2e PYANNOTE_API_KEY`. Test
body is in place at `packages/contract-tests/src/diarization.test.ts`
under the second describe block.

## Grep evidence — pyannote NEVER routed via LiteLLM pass_through

```
$ grep -rn "pyannote.*pass_through\|pass_through.*pyannote" apps/api compose/litellm
apps/api/src/lib/pyannote-client.ts:11:// (D-07 REVISED, 2026-05-10: pyannote pass_through_endpoints removed
```

The single hit is a documentation comment in `pyannote-client.ts` explicitly
recording the D-07 REVISED removal. `compose/litellm/litellm_config.yaml`
contains zero `PYANNOTE` references — confirming PYANNOTE_API_KEY is
consumed exclusively by the Fastify route, not the LiteLLM container.

## Test counts and coverage

| Suite | Tests | Status |
|---|---|---|
| `apps/api/src/lib/__tests__/pyannote-client.test.ts` | 22 | green (Task 1) |
| `apps/api/src/lib/__tests__/idempotency-cache.test.ts` | 12 | green (Task 2) |
| `apps/api/src/routes/__tests__/diarization.test.ts` | 17 | green (Task 3) |
| `packages/contract-tests/src/diarization.test.ts` | 4 | skipped (no backend reachable; activates on `make contract-test`) |

Full apps/api suite: **350 passing / 5 failing / 2 skipped of 357.** The 5
failures are pre-existing (pre-Task-3 baseline also showed 5 failing; same
test names) and are out of scope per the deviation-rules scope boundary
(`scripts/check-default-secrets.test.ts` and `litellm-spike-request-id.test.ts`
"audio fixture exists" — both unrelated to this plan's diff).

## Commits

| Task | Commit | Files |
|---|---|---|
| Task 1 — pyannote-client | `3887ddf` | `apps/api/src/lib/pyannote-client.ts` + 22 unit tests |
| Task 2 — idempotency-cache | `63b164a` | `apps/api/src/lib/idempotency-cache.ts` + 12 unit tests |
| Task 3 — diarization route | `99ece5f` | `apps/api/src/routes/diarization.ts` + 17 route tests + index.ts wiring |
| Contract test | `9d2bb97` | `packages/contract-tests/src/diarization.test.ts` (4 tests, skip-on-no-backend) |

## Deviations from plan

### Auth gates / authentication issues

**None.** All work was orchestratable without operator-supplied credentials
(MOCK_DIARIZATION=true contract-test profile keeps CI hermetic; live
pyannote.ai is gated behind RUN_E2E for operator-driven runs).

### Auto-fixed issues

- **[Rule 3 — Blocking]** Wiring of `buildDiarizationRoutes` into
  `buildAllRoutes` was incomplete from the prior agent invocation —
  only the `DiarizationDeps`/`RedisLike` types were imported and the
  `redis?` / `mockDiarization?` fields added to `AllRoutesDeps`, but the
  conditional `if (deps.redis) plugins.push(...)` block was missing.
  Added the wiring + named export of `buildDiarizationRoutes`.
  Files modified: `apps/api/src/routes/index.ts`. Commit: `99ece5f`.

- **[Rule 1 — Test correctness]** Initial route tests used
  `ErrorEnvelope.parse` on 502 bodies, but the route's 502 envelope
  includes a `jobId` hint for caller resume; `ErrorEnvelope` is `.strict()`.
  Switched the two affected assertions to direct `error`/`jobId` field checks.
  Files modified: `apps/api/src/routes/__tests__/diarization.test.ts`.
  Commit: `99ece5f`.

- **[Rule 1 — Test correctness]** First implementation of the 504
  ceiling-exceeded test stubbed global `setTimeout` directly, which
  broke Fastify's plugin-boot timer (`AVV_ERR_READY_TIMEOUT`). Replaced
  with `vi.useFakeTimers({ shouldAdvanceTime: true })` activated AFTER
  `app.ready()` so plugin boot uses real timers and the poll loop's
  sleep + Date.now use the fake clock.
  Files modified: `apps/api/src/routes/__tests__/diarization.test.ts`.
  Commit: `99ece5f`.

- **[Rule 1 — Type correctness]** `exactOptionalPropertyTypes: true` in
  the api package's tsconfig rejects `mockMode: undefined` on
  `DiarizationDeps`. Switched the test's `buildApp` helper to omit
  optional fields rather than passing them as `undefined`.
  Files modified: `apps/api/src/routes/__tests__/diarization.test.ts`.
  Commit: `99ece5f`.

### Architectural deviations

**None.** No new infrastructure or schema changes; route fits cleanly into
the existing Plan 04 / Pattern 1 wiring template.

### Workflow note

Execution split across two agent invocations because of a transient
upstream API rate limit between Tasks 2 and 3. State on disk was
preserved (`diarization.ts` + the index.ts type plumbing were already
written and uncommitted when the continuation agent took over). Outcome
unaffected: all three tasks landed atomically and all four commits are
on the branch.

## Known stubs

**None.** The route consumes a real Valkey client surface and a real
PyannoteClient at runtime. The only fixture/stub paths are:
1. `MOCK_DIARIZATION=true` short-circuit, which is explicitly env-gated
   and refused by the bootstrap.sh deny-list in production .env files.
2. The contract-test `audioMultipartBody` helper, which reads a real WAV
   fixture from `tests/fixtures/audio/`.

Threat T-03-06-06 (MOCK_DIARIZATION exposure in production) is mitigated
by the deny-list and documented in operations docs.

## Threat flags

No new security-relevant surface was introduced beyond what the plan's
threat register already enumerates (T-03-06-01..08).

## Self-Check: PASSED

- [x] `apps/api/src/lib/pyannote-client.ts` — FOUND (Task 1, commit 3887ddf)
- [x] `apps/api/src/lib/idempotency-cache.ts` — FOUND (Task 2, commit 63b164a)
- [x] `apps/api/src/routes/diarization.ts` — FOUND (Task 3, commit 99ece5f)
- [x] `apps/api/src/routes/__tests__/diarization.test.ts` — FOUND (commit 99ece5f)
- [x] `packages/contract-tests/src/diarization.test.ts` — FOUND (commit 9d2bb97)
- [x] `apps/api/src/routes/index.ts` — modified (commit 99ece5f)
- [x] commit 3887ddf — FOUND in git log
- [x] commit 63b164a — FOUND in git log
- [x] commit 99ece5f — FOUND in git log
- [x] commit 9d2bb97 — FOUND in git log
