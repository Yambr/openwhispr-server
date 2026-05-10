---
phase: 04
plan: 03
subsystem: streaming-realtime
tags: [tdd, tokens, assemblyai, deepgram, rate-limit, undici]
requires:
  - .planning/phases/04-streaming-realtime/04-01-SUMMARY.md (provider fixtures)
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-14, D-15, D-18, D-19, D-20)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.5 lines 441–524)
  - apps/api/src/plugins/rate-limit.ts (Phase 2 D-28)
  - apps/api/src/middleware/dual-auth.ts (Phase 2 D-04)
  - apps/api/src/error-handler.ts (Phase 2 D-13)
provides:
  - apps/api/src/routes/tokens/_call-provider.ts (shared undici helper, callProvider)
  - apps/api/src/routes/tokens/assemblyai.ts (POST /api/streaming-token, buildAssemblyAITokenRoutes)
  - apps/api/src/routes/tokens/deepgram.ts (POST /api/deepgram-streaming-token, buildDeepgramTokenRoutes)
affects:
  - .env.example (ASSEMBLYAI_API_KEY, ASSEMBLYAI_TOKEN_TTL, DEEPGRAM_API_KEY, DEEPGRAM_TOKEN_TTL)
tech-stack:
  added: []
  patterns:
    - "Discriminated-union helper result ({ok:true,json}|{ok:false,status,message}) so callers switch without try/catch"
    - "Lazy idempotent installation of process-wide undici Agent({connect:{timeout:3000}}) — leaves test-injected MockAgent intact"
    - "preHandler missing-key 503 gate — short-circuits before any AbortController/fetch is armed"
    - "@fastify/rate-limit per-route override with keyGenerator: req => req.user?.id ?? req.ip (T-04-04 mitigation)"
    - "ServiceUnavailable throw → centralized setErrorHandler emission (D-13 single emission point)"
key-files:
  created:
    - apps/api/src/routes/tokens/_call-provider.ts
    - apps/api/src/routes/tokens/_call-provider.test.ts
    - apps/api/src/routes/tokens/assemblyai.ts
    - apps/api/src/routes/tokens/assemblyai.test.ts
    - apps/api/src/routes/tokens/deepgram.ts
    - apps/api/src/routes/tokens/deepgram.test.ts
  modified:
    - .env.example
decisions:
  - "Helper does NOT pass an explicit `dispatcher` to fetch — relies on the global dispatcher so vitest's setGlobalDispatcher(MockAgent) intercepts work without per-call wiring. The 3s connect ceiling is installed lazily as the global Agent on first call (skipped if a non-default dispatcher — i.e. MockAgent — is already installed); the 5s total ceiling is enforced via AbortController inside the helper itself"
  - "Missing-key gate runs in preHandler (NOT inside handler) so the AbortController + fetch are never armed when ASSEMBLYAI_API_KEY/DEEPGRAM_API_KEY is absent — operator-config gap costs zero upstream traffic"
  - "Routes throw ServiceUnavailable rather than calling reply.code(503).send inline — the centralized setErrorHandler stays the single emission point per D-13 (PITFALLS #1)"
  - "Synthetic onRequest auth hook in tests stands in for the real dualAuthHook — production wiring (per Plan 02 D-04) is owned by buildApp; this plan ships the route plugin only. Wave 3 plan registers the factory in buildAllRoutes"
  - "Both routes log the same `req.user.id ?? req.ip` keyGenerator fallback — the `req.ip` arm is defense-in-depth in case auth ordering ever regresses; in production dual-auth is configured to fire before rate-limit (Phase 2 D-04 ordering verified by the unauthenticated-bucket-not-consumed test in each suite)"
metrics:
  duration: ~12m
  tasks_completed: 3
  files_created: 6
  files_modified: 1
  commits: 3
  completed_date: 2026-05-11
---

# Phase 04 Plan 03: AssemblyAI + Deepgram Token Mint Routes Summary

Implemented the two streaming-token mint routes (`/api/streaming-token`
for AssemblyAI v3, `/api/deepgram-streaming-token` for Deepgram Grant
Token) plus their shared undici helper, all at ≥90/90/90/90 coverage.
Routes inherit Phase 2 dual-auth + global error envelope; per-user
30/min rate limit (D-19) is keyed on `req.user.id` so leaked-bearer
abuse is bounded per-user (T-04-04 mitigation), and missing-key
gating returns 503 with operator-actionable wording (D-18 / T-04-01).

## Coverage Report (per-file, all four axes)

| File | Statements | Branches | Functions | Lines |
|------|-----------:|---------:|----------:|------:|
| `apps/api/src/routes/tokens/_call-provider.ts` | **93.93%** | **90%** | **100%** | **93.54%** |
| `apps/api/src/routes/tokens/assemblyai.ts`     | **100%**   | **90%** | **100%** | **100%**   |
| `apps/api/src/routes/tokens/deepgram.ts`       | **100%**   | **90%** | **100%** | **100%**   |

Verification (run from repo root):

```bash
pnpm --filter @openwhispr/api test src/routes/tokens/ --run --coverage \
  --coverage.include='src/routes/tokens/_call-provider.ts' \
  --coverage.include='src/routes/tokens/assemblyai.ts' \
  --coverage.include='src/routes/tokens/deepgram.ts'
# → Test Files  3 passed (3)
# → Tests       22 passed (22)
```

## Missing-Key 503 Envelope Strings (exact)

Pinned by tests in each suite — the four-string envelope wording cannot
drift unnoticed:

| Provider | Missing-key envelope (exact bytes) |
|----------|------------------------------------|
| AssemblyAI | `{"error":"AssemblyAI not configured (set ASSEMBLYAI_API_KEY in .env)"}` |
| Deepgram   | `{"error":"Deepgram not configured (set DEEPGRAM_API_KEY in .env)"}` |

Other shared 503 envelopes (centralized in `_call-provider.ts::buildMessage`):

| Failure category | Envelope template |
|------------------|-------------------|
| upstream 429/5xx  | `{"error":"<Label> token mint upstream error"}` |
| timeout / abort / network failure | `{"error":"<Label> token mint timed out"}` |
| malformed JSON / missing field    | `{"error":"<Label> token mint malformed response"}` |

## Test Outcomes

### `_call-provider.test.ts` — 8 tests, all GREEN

| # | Behavior pinned |
|---|-----------------|
| 1 | 200 → ok:true with parsed JSON |
| 2 | 401 → 503 not-configured envelope (incl. ENV var name) |
| 3 | 403 → same not-configured envelope |
| 4 | 429 → 503 upstream-error envelope |
| 5 | 500 → 503 upstream-error envelope |
| 6 | upstream delay > 5s → AbortController fires → 503 timed-out |
| 7 | 200-with-non-JSON body → 503 malformed-response |
| 8 | no responder + disableNetConnect → caught failure → 503 timed-out |

### `assemblyai.test.ts` — 7 tests, all GREEN

| # | Behavior pinned |
|---|-----------------|
| 1 | success: fixture token returns 200 `{token}` |
| 2 | missing ASSEMBLYAI_API_KEY → 503 with EXACT envelope |
| 3 | unauthenticated 35× → all 401, bucket NOT consumed (T-04-04) |
| 4 | upstream 401 → 503 not-configured envelope |
| 5 | ASSEMBLYAI_TOKEN_TTL=120 → URL `?expires_in_seconds=120` |
| 6 | u1 burns 30/min → 31st = 429; u2 fresh bucket = 200 (isolation) |
| 7 | upstream `{not_token}` → 503 malformed-response |

### `deepgram.test.ts` — 7 tests, all GREEN

| # | Behavior pinned |
|---|-----------------|
| 1 | success: header `Token <key>`, body `{ttl_seconds:30}`, response field rename `access_token`→`token` |
| 2 | missing DEEPGRAM_API_KEY → 503 with EXACT envelope |
| 3 | DEEPGRAM_TOKEN_TTL=60 → body `{ttl_seconds:60}` |
| 4 | u1 burns 30/min → 31st = 429; u2 fresh bucket = 200 (isolation) |
| 5 | upstream `{not_access_token}` → 503 malformed-response |
| 6 | upstream 500 → 503 upstream-error envelope |
| 7 | unauthenticated 35× → all 401, bucket NOT consumed |

## Atomic-Commit-per-Task Confirmation

| Task | Commit | Production + Test in same commit? |
|------|--------|-----------------------------------|
| 1 (`_call-provider`) | `98f86b2` | YES — `_call-provider.ts` + `_call-provider.test.ts` |
| 2 (`assemblyai`)     | `ac43fef` | YES — `assemblyai.ts` + `assemblyai.test.ts` + `.env.example` |
| 3 (`deepgram`)       | `c956932` | YES — `deepgram.ts` + `deepgram.test.ts` + `.env.example` |

## Threat Mitigations Verified

| Threat | Mitigation site | Test that pins it |
|--------|-----------------|-------------------|
| T-04-01 (key leakage) | preHandler missing-key 503 + 30/min/user rate-limit + 5s upstream timeout in `_call-provider`. Master keys never appear in any response body — only ephemeral mints | assemblyai/deepgram Test 2 + Test 6 + `_call-provider` Test 6 |
| T-04-04 (cross-user rate-limit bypass) | dual-auth `onRequest` hook fires BEFORE rate-limit's `onRequest`, so unauthenticated requests 401 before the bucket is consumed. `keyGenerator: req => req.user?.id ?? req.ip` keys the bucket on the authenticated session, not the source IP | assemblyai/deepgram Test 3 (35× unauth = 401, then auth = 200) + Test 6 (u1/u2 isolation) |
| T-04-01-MALFORMED | `_call-provider` JSON-parse failure + the route's `typeof token !== "string"` check both surface as 503 (never 200-with-empty-token) | `_call-provider` Test 7 + assemblyai/deepgram malformed-response tests |

## Deviations from Plan

### Auto-fixed during execution

**1. [Rule 3 — blocking] Helper cannot pass `dispatcher: providerAgent` to fetch — vitest MockAgent injection breaks.**
- **Found during:** Task 1 first test run (6/8 tests failed with "timed out" instead of the expected status-mapped envelope).
- **Issue:** RESEARCH §2.5 skeleton sets `dispatcher: providerAgent` on the per-call fetch. Vitest tests install MockAgent via `setGlobalDispatcher(mockAgent)`, but explicit per-call dispatcher overrides the global — so MockAgent's intercepts never fire and every call surfaces as a network failure (caught → "timed out").
- **Fix:** Drop the explicit per-call dispatcher; install the 3s-connect-timeout Agent as the global dispatcher lazily, and skip installation when a non-default dispatcher is already wired (heuristic: `getGlobalDispatcher().constructor.name !== "Agent"`). MockAgent's name is "MockAgent", so test wiring is preserved.
- **Files modified:** `apps/api/src/routes/tokens/_call-provider.ts`.
- **Commit:** `98f86b2`.
- **Behavior preserved:** the 3s connect ceiling and 5s total ceiling per D-20 are still enforced — the 3s via the global Agent (production), the 5s via the per-call AbortController (always).

**2. [Rule 2 — coverage gap] Added Deepgram upstream-500 test for branch coverage.**
- **Found during:** Task 3 coverage check (branches 80% before, 90% after).
- **Issue:** The Deepgram suite had no test exercising the `if (!r.ok)` branch from `callProvider` returning a non-malformed failure (the malformed test takes a different code path). Branches sat at 80% — below the 90% gate.
- **Fix:** Added a 7th test (`maps upstream 500 to 503 token-mint upstream-error envelope`) that intercepts a 500 response and asserts the upstream-error envelope.
- **Files modified:** `apps/api/src/routes/tokens/deepgram.test.ts` (test-only).
- **Commit:** `c956932`.

### Architectural / decision

None — both shape and wire surface match the plan exactly. The route
plugins are not yet registered in `buildAllRoutes` (apps/api/src/routes/index.ts);
that wiring belongs to a Wave 3 plan per the plan's scope boundary
("Plan ships the route plugin only").

## Authentication Gates

None. Tests use a synthetic `onRequest` auth hook that mimics
dualAuthHook's contract (sets `req.user`, throws `AuthError` on
failure) — the production hook itself is unchanged and continues to
be exercised by Phase 2's existing test suite.

## Known Stubs

None. Both routes are complete production implementations. The
factory builders take no deps today (`buildAssemblyAITokenRoutes()` /
`buildDeepgramTokenRoutes()`); if a future plan needs to inject
provider-base-URL overrides for corporate operators, the signature
extends naturally.

## Threat Flags

None — every new surface introduced by this plan was pre-registered
in the plan's `<threat_model>` block (T-04-01, T-04-04,
T-04-01-MALFORMED) with `mitigate` dispositions, and every mitigation
is now test-pinned. No new auth paths, no new schema, no new file or
network surface beyond the documented mints.

## Verification

```bash
# 22 tests pass
pnpm --filter @openwhispr/api test src/routes/tokens/ --run
# → Test Files  3 passed (3)
# → Tests       22 passed (22)

# All 3 files ≥90/90/90/90
pnpm --filter @openwhispr/api test src/routes/tokens/ --run --coverage \
  --coverage.include='src/routes/tokens/_call-provider.ts' \
  --coverage.include='src/routes/tokens/assemblyai.ts' \
  --coverage.include='src/routes/tokens/deepgram.ts'
# → _call-provider.ts | 93.93 | 90 | 100 | 93.54
# → assemblyai.ts     | 100   | 90 | 100 | 100
# → deepgram.ts       | 100   | 90 | 100 | 100

# .env.example documents both providers + TTL knobs
grep -E '^(ASSEMBLYAI|DEEPGRAM)_(API_KEY|TOKEN_TTL)=' .env.example
# → ASSEMBLYAI_API_KEY=
# → ASSEMBLYAI_TOKEN_TTL=60
# → DEEPGRAM_API_KEY=
# → DEEPGRAM_TOKEN_TTL=30

# Auth header conventions pinned
grep -n 'authorization' apps/api/src/routes/tokens/assemblyai.ts
# → 74:  headers: { authorization: process.env.ASSEMBLYAI_API_KEY as string },
#       (NO "Bearer " prefix per D-14)
grep -n 'Token ' apps/api/src/routes/tokens/deepgram.ts
# → 51:  authorization: `Token ${process.env.DEEPGRAM_API_KEY as string}`,
#       ("Token " prefix per D-15)

# Atomic per-task commits — production + test in the SAME commit (TDD)
git log 0c9483c..HEAD --name-only
# → 98f86b2 _call-provider.{ts,test.ts}
# → ac43fef assemblyai.{ts,test.ts} + .env.example
# → c956932 deepgram.{ts,test.ts}    + .env.example
```

## Self-Check: PASSED

All claimed files present:
- FOUND: apps/api/src/routes/tokens/_call-provider.ts
- FOUND: apps/api/src/routes/tokens/_call-provider.test.ts
- FOUND: apps/api/src/routes/tokens/assemblyai.ts
- FOUND: apps/api/src/routes/tokens/assemblyai.test.ts
- FOUND: apps/api/src/routes/tokens/deepgram.ts
- FOUND: apps/api/src/routes/tokens/deepgram.test.ts

All claimed commits present:
- FOUND: 98f86b2 (Task 1)
- FOUND: ac43fef (Task 2)
- FOUND: c956932 (Task 3)
