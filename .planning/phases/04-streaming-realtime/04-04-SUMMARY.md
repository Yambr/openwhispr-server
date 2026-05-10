---
phase: 04
plan: 04
subsystem: streaming-realtime
tags: [tdd, tokens, openai-realtime, parallel-mint, rate-limit, undici]
requires:
  - .planning/phases/04-streaming-realtime/04-01-SUMMARY.md (openai-client-secret-response.json fixture)
  - .planning/phases/04-streaming-realtime/04-03-SUMMARY.md (shared callProvider helper, dual-auth/rate-limit pattern)
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-16, D-17, D-18, D-19, D-20)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.5 OpenAI Realtime block)
  - apps/api/src/routes/tokens/_call-provider.ts (Plan 03)
  - apps/api/src/plugins/rate-limit.ts (Phase 2 D-28)
  - apps/api/src/error-handler.ts (Phase 2 D-13)
provides:
  - apps/api/src/routes/tokens/openai-realtime.ts (POST /api/openai-realtime-token, buildOpenAIRealtimeTokenRoutes)
affects: []
tech-stack:
  added: []
  patterns:
    - "Promise.all parallel-mint with fail-fast 503 (NOT Promise.allSettled — partial-success leakage worse than clean transient failure)"
    - "Wire-shape consistency: top-level singular clientSecret + clientSecrets array always populated (length === streams), even when streams=1"
    - "T-04-01 leakage prevention site: failure scan happens BEFORE results.map → first successful secret is never serialized when any sibling failed"
    - "T-04-INPUT allowlist: explicit !==1 && !==2 check rejects integer-overflow/negative/array attacks expanding the parallel fan-out"
    - "Reply-callback timestamping for parallelism assertion (MockAgent re-invokes path/body matchers per candidate during matching — only the reply factory fires once-per-served-request)"
key-files:
  created:
    - apps/api/src/routes/tokens/openai-realtime.ts
    - apps/api/src/routes/tokens/openai-realtime.test.ts
  modified: []
decisions:
  - "Reused Plan 03 callProvider helper verbatim — no fork. The OpenAI Realtime route is the third caller (after AssemblyAI, Deepgram) and validates the helper's third-party-agnostic interface (POST + JSON body + Bearer prefix vs GET / POST + Token prefix)."
  - "Promise.all over Promise.allSettled — reject paths from RESEARCH §2.5 lines 545–547. Fail-fast yields a clean 503 the desktop reconnects from cleanly; allSettled would leak the first secret in a partial-success body that confuses the client AND burns one ephemeral mint."
  - "secrets[0] selection by Promise.all input order, NOT MockAgent registration order — Promise.all preserves input ordering of resolved values regardless of which intercept matches first. Test 2 asserts set membership (not positional) for the two values to keep the test agnostic to MockAgent matching order; clientSecret === clientSecrets[0] is asserted positionally."
  - "Type-narrowing the post-find array to Extract<…, {ok:true}> instead of an inline `if (!r.ok) throw` inside .map — eliminates a dead branch that v8 coverage flagged as uncovered, lifting branches from 87.5 → 90.9."
  - ".env.example NOT modified — OPENAI_API_KEY is already documented by Phase 3 D-12 (existing realtime WSS proxy uses the same key); duplicating the entry would violate single-source-of-truth."
metrics:
  duration: ~7m
  tasks_completed: 1
  files_created: 2
  files_modified: 0
  commits: 1
  completed_date: 2026-05-11
---

# Phase 04 Plan 04: OpenAI Realtime Token Mint Route Summary

Implemented `POST /api/openai-realtime-token` with parallel-mint
semantics for `streams=2`: two `Promise.all` calls to OpenAI's
`/v1/realtime/client_secrets` endpoint, fail-fast on either's
failure, returning the BACKEND_SPEC byte-for-byte response shape
`{clientSecret, clientSecrets}` where `clientSecret = clientSecrets[0]`
and `clientSecrets` is always populated (length 1 or 2).

Closes **WIRE-15**. Reuses the shared `callProvider` helper from
Plan 03 verbatim (third caller validates the helper's
provider-agnostic interface). Inherits dual-auth + the centralized
error envelope; per-user 30/min rate limit (D-19) keyed on
`req.user.id` so leaked-bearer abuse is bounded per-user
(T-04-04 mitigation), and missing-key gating returns 503 with
operator-actionable wording (D-18 / T-04-01).

## Coverage Report (per-file, all four axes)

| File | Statements | Branches | Functions | Lines |
|------|-----------:|---------:|----------:|------:|
| `apps/api/src/routes/tokens/openai-realtime.ts` | **100%** | **90.9%** | **100%** | **100%** |

Verification (run from repo root):

```bash
pnpm --filter @openwhispr/api test src/routes/tokens/openai-realtime.test.ts \
  --run --coverage --coverage.include='src/routes/tokens/openai-realtime.ts'
# → Test Files  1 passed (1)
# → Tests       9 passed (9)
# → Statements  100%   Branches  90.9%   Functions  100%   Lines  100%
```

Full token-route suite (4 files, 31 tests):

```bash
pnpm --filter @openwhispr/api test src/routes/tokens/ --run
# → Test Files  4 passed (4)
# → Tests       31 passed (31)
```

## Wire Shape (BACKEND_SPEC byte-for-byte)

| Scenario | Status | Body |
|----------|-------:|------|
| streams=1 (default) success | 200 | `{"clientSecret":"ek_xxx","clientSecrets":["ek_xxx"]}` |
| streams=2 success           | 200 | `{"clientSecret":"<first>","clientSecrets":["<first>","<second>"]}` |
| streams=3 (or any other)    | 400 | `{"error":"streams must be 1 or 2"}` |
| Missing OPENAI_API_KEY      | 503 | `{"error":"OpenAI Realtime not configured (set OPENAI_API_KEY in .env)"}` |
| Upstream 401/403            | 503 | (same not-configured envelope — operator-key-may-be-wrong) |
| Upstream 429/5xx            | 503 | `{"error":"OpenAI Realtime token mint upstream error"}` |
| Upstream timeout (>5s)      | 503 | `{"error":"OpenAI Realtime token mint timed out"}` |
| Upstream malformed JSON / no `value` field | 503 | `{"error":"OpenAI Realtime token mint malformed response"}` |
| streams=2, one mint fails   | 503 | upstream-error envelope; **first secret NEVER in body (T-04-01)** |
| Per-user 30/min exceeded    | 429 | (canonical rate-limit envelope) |
| Unauthenticated             | 401 | (auth fires BEFORE rate-limit; bucket NOT consumed) |

## Test Outcomes

### `openai-realtime.test.ts` — 9 tests, all GREEN

| # | Behavior pinned |
|---|-----------------|
| 1 | streams=1 (default) → 200, BOTH `clientSecret` and `clientSecrets[1]` populated with same value |
| 2 | streams=2 → 200, length 2; `clientSecret === clientSecrets[0]`; **two upstream calls fire within 50ms (parallel)** |
| 3 | streams=3 → 400 envelope `streams must be 1 or 2` (T-04-INPUT) |
| 4 | streams=2 fail-fast: 1st mint 200 + 2nd mint 500 → 503 upstream-error envelope; **`ek_first_should_not_leak` literal NOT in response body** (T-04-01 partial-success leakage prevention) |
| 5 | Missing OPENAI_API_KEY → 503 with EXACT envelope string |
| 6 | Per-user 30/min rate-limit; u1 burns 30 → 31st = 429; u2 fresh bucket = 200 (T-04-04 isolation) |
| 7 | `body.model='gpt-realtime-2025'` forwarded into upstream POST `session.model`; default `'gpt-realtime'` when omitted |
| 8 | Upstream `{not_value:...}` → 503 malformed-response envelope |
| 9 | 35× unauth = 401, then auth = 200 (auth fires before rate-limit; bucket NOT consumed — T-04-04 ordering) |

### Parallelism assertion (Test 2) — implementation note

MockAgent re-invokes `path` and `body` matcher callbacks **once per
candidate intercept during matching**, so timestamping in those
callbacks yields N×M counts (N requests × M candidates), not the true
per-request count. The reply factory (`(opts) => responseBody`) is
invoked **exactly once per served request**, so the test stamps
timestamps in the reply callback. The assertion that
`Math.abs(t1 - t0) < 50` confirms `Promise.all` dispatched both
underlying `fetch` calls without awaiting the first — the gap of 5ms
or less between dispatches is much smaller than the connect+body
budget for any sequential pattern (`await mintOne(); await mintOne();`
would put the second timestamp ≥1ms after the first reply resolved,
typically >5ms in practice and bounded only by the AbortController's
5s ceiling in the worst case).

### Fail-fast secret-leakage prevention (Test 4) — load-bearing assertion

```typescript
expect(raw).not.toContain("ek_first_should_not_leak");
```

The MockAgent serves `{value: "ek_first_should_not_leak"}` on the
first intercept (200) and a 500 on the second. `Promise.all` resolves
to `[{ok:true, json:{value:"ek_first…"}}, {ok:false, status:503, message:"…upstream error"}]`.
The route's `failed = results.find(r => !r.ok)` test catches the
second entry; `throw new ServiceUnavailable(failed.message)` fires
**before** `results.map(r => r.json.value)` is reached. The error
handler emits `{error: "OpenAI Realtime token mint upstream error"}` —
the first secret never crosses any `JSON.stringify` boundary.

## Atomic-Commit-per-Task Confirmation

| Task | Commit | Production + Test in same commit? |
|------|--------|-----------------------------------|
| 1 (`openai-realtime`) | `c5e01ce` | YES — `openai-realtime.ts` + `openai-realtime.test.ts` |

```bash
git log -1 --name-only
# c5e01ce feat(04-04): POST /api/openai-realtime-token parallel-mint (≥90/90/90/90)
#   apps/api/src/routes/tokens/openai-realtime.test.ts
#   apps/api/src/routes/tokens/openai-realtime.ts
```

## Threat Mitigations Verified

| Threat | Mitigation site | Test that pins it |
|--------|-----------------|-------------------|
| **T-04-01 (key leakage / partial-success leakage)** | preHandler missing-key 503 (Test 5) + per-user 30/min rate-limit (Test 6) + 5s upstream timeout via `_call-provider` + **fail-fast scan BEFORE results.map ensures first secret is never serialized on partial failure** | Test 4 asserts the literal value `ek_first_should_not_leak` is absent from the 503 response body |
| **T-04-04 (cross-user rate-limit bypass)** | `keyGenerator: req => req.user?.id ?? req.ip` reads the authenticated session id; dual-auth `onRequest` hook fires BEFORE rate-limit's `onRequest`, so unauthenticated requests 401 before the bucket is consumed | Test 9 (35× unauth = 401, then auth = 200) + Test 6 (u1/u2 isolation) |
| **T-04-INPUT (streams parameter tampering)** | Explicit allowlist `streams !== 1 && streams !== 2 → 400`. No `Number(...)` coercion, no upper-bound check on a number type — the literal-equality check rejects `3`, `100`, `-1`, `[1,2]`, `"1"`, `null` (passes `??` default), and any object-shaped attack expanding the parallel fan-out beyond 2 | Test 3 (streams=3 → 400 with structured envelope) |

## Deviations from Plan

### Auto-fixed during execution

**1. [Rule 3 — blocking] MockAgent path/body matchers fire once per candidate, not once per dispatched request.**
- **Found during:** Task 1 first test run (Tests 2 and 7 failed: `expected timestamps to have length 2 but got 5`).
- **Issue:** The plan's behavior spec for Test 2 says "verified by intercept timing being within 50ms of each other". Initial implementation stamped timestamps in `path: (p) => { stamp(); return ...; }`. MockAgent's matching loop iterates over all registered intercepts per dispatched request, calling the path matcher each time — so 2 requests × ~2.5 candidates yielded 5 timestamps, not 2. The same defect affected Test 7's `body: (raw) => { capture(...); return true; }` body-matcher pattern.
- **Fix:** Move the stamp/capture into the **reply factory** (`reply(200, () => responseBody)` and `reply(200, (opts) => { capture(opts.body); return responseBody; })`). The reply factory is invoked exactly once when MockAgent serves a matched request. Behavior preserved: parallelism is still measured at the upstream-call boundary (the reply factory fires when undici writes the mock response, which is the closest test-observable proxy for "request dispatched").
- **Files modified:** `apps/api/src/routes/tokens/openai-realtime.test.ts` only (production code unchanged).
- **Commit:** `c5e01ce` (single atomic commit — no separate fix commit; test design corrected before commit).

**2. [Rule 1 — bug / dead branch] Inline `if (!r.ok) throw` inside results.map left an uncoverable branch (87.5% branches < 90% gate).**
- **Found during:** Task 1 coverage check (branches 87.5%, gate 90%).
- **Issue:** The pattern `const failed = results.find(r => !r.ok); if (failed) throw …; results.map(r => { if (!r.ok) throw …; … })` left an `if (!r.ok)` branch inside `.map` that v8 coverage rightly flagged as uncovered — the preceding `find` proves no entry has `ok===false` by the time `.map` runs, so the inline guard is dead code.
- **Fix:** Replace the inline guard with a TypeScript narrowing cast: `const okResults = results as Array<Extract<…, {ok:true}>>;` then `okResults.map(r => …)` accesses `r.json` directly without a runtime guard. The narrowing is sound because the preceding `find` proved every entry is `{ok:true}`. Branches lifted from 87.5 → 90.9.
- **Files modified:** `apps/api/src/routes/tokens/openai-realtime.ts` (production refactor in same commit as tests, per TDD discipline — RED→GREEN→REFACTOR cadence).
- **Commit:** `c5e01ce`.

### Architectural / decision

None — wire shape, threat surface, and rate-limit ordering all match
the plan exactly. The route plugin is not yet registered in
`buildAllRoutes` (apps/api/src/routes/index.ts); that wiring belongs
to a Wave 3 plan per the plan's scope boundary (consistent with Plan
03's deferral).

## Authentication Gates

None. Tests use the same synthetic `onRequest` auth hook pattern as
Plan 03's assemblyai/deepgram suites — mimics dualAuthHook's contract
(sets `req.user`, throws `AuthError` on failure). The production hook
itself is unchanged and continues to be exercised by Phase 2's
existing test suite.

## Known Stubs

None. The route is a complete production implementation. The factory
builder takes no deps today (`buildOpenAIRealtimeTokenRoutes()`); if
a future plan needs to inject provider-base-URL overrides for
corporate operators (e.g., a self-hosted OpenAI-API-compatible
realtime endpoint), the signature extends naturally without a wire-shape
change.

## Threat Flags

None — every new surface introduced by this plan was pre-registered
in the plan's `<threat_model>` block (T-04-01, T-04-04, T-04-INPUT)
with `mitigate` dispositions, and every mitigation is now test-pinned.
No new auth paths, no new schema, no new file or network surface
beyond the documented mint to `https://api.openai.com/v1/realtime/client_secrets`
(already documented as the OpenAI Realtime upstream by Phase 3 D-12).

## Verification

```bash
# 9 tests pass
pnpm --filter @openwhispr/api test src/routes/tokens/openai-realtime.test.ts --run
# → Test Files  1 passed (1)
# → Tests       9 passed (9)

# Full token suite (4 files) still green
pnpm --filter @openwhispr/api test src/routes/tokens/ --run
# → Test Files  4 passed (4)
# → Tests       31 passed (31)

# Coverage on new file ≥90/90/90/90
pnpm --filter @openwhispr/api test src/routes/tokens/openai-realtime.test.ts --run \
  --coverage --coverage.include='src/routes/tokens/openai-realtime.ts'
# → openai-realtime.ts | 100 | 90.9 | 100 | 100

# Bearer prefix per D-16
grep -n 'Bearer' apps/api/src/routes/tokens/openai-realtime.ts
# → authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,

# Wire-shape: BOTH clientSecret (singular) AND clientSecrets (array)
grep -n 'clientSecret' apps/api/src/routes/tokens/openai-realtime.ts
# → return reply.send({ clientSecret: secrets[0], clientSecrets: secrets });

# Atomic commit (production + test together)
git log -1 --name-only c5e01ce
# → openai-realtime.test.ts + openai-realtime.ts
```

## Self-Check: PASSED

All claimed files present:
- FOUND: apps/api/src/routes/tokens/openai-realtime.ts
- FOUND: apps/api/src/routes/tokens/openai-realtime.test.ts

All claimed commits present:
- FOUND: c5e01ce (Task 1)
