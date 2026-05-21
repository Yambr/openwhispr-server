---
slug: r28-r29-schema-null-readiness-flap
date: 2026-05-22
status: complete
commit: [2af65a83, bcf5c072, a5583ccc]
---

# R28 (CRIT) + R29 + R29b — Summary

Three server-side fixes landed as atomic RED->GREEN commits on local `main`.

## R28 (CRITICAL) — /api/reason + /api/agent/stream 400 on `null` optionals

**Commit:** `2af65a83`

The immutable desktop client builds the request body from `opts.model` /
`opts.agentName`; on the FIRST dictation of a session those are `null`, so the
body literally contains `"model":null`. Zod's `.optional()` accepts "key
absent" OR the typed value but REJECTS `null` — 400-ing the first dictation,
working only after an app restart once the store held non-null values.

**Fix:** every optional field `.optional()` -> `.nullish()` in
`packages/wire-schemas/src/reason.ts` (20 fields) and
`packages/wire-schemas/src/agent.ts` (AgentStreamRequestSchema optionals +
AgentLegacyToolSchema.description). `.max()`/`.min()` bounds and
`.passthrough()` unchanged.

**Consumer fixes** for the `T|null|undefined` widening (LOCKER-02 — `?? fallback`
only, no suppressions): `apps/api/src/routes/agent/stream.ts`
(`body.systemPrompt ?? undefined`, `body.model ?? undefined`,
`body.tools !== null` guard) and `apps/api/src/routes/agent/translate-tools.ts`
(LegacyTool.description accepts `null`, collapsed to `undefined` at boundary).

## R29 — /api/ready 503 flap from LiteLLM /health provider fan-out

**Commit:** `bcf5c072`

`/api/ready` flapped 503 because the litellm dep-check probed `/health` — a
deep diagnostic that fans out to every model; any provider hiccup flipped the
probe to 503. **Fix:** `apps/api/src/lib/dep-check.ts` — probe URL `/health` ->
`/health/readiness` (proxy-state only). `statusCode >= 500` rule, 2s timeout,
`body.dump()` drain unchanged.

## R29b — /api/ready ssrf_dispatcher check gated on the wrong thing

**Commit:** `a5583ccc` (client-flagged follow-up to R29)

After R24 the LiteLLM client holds its OWN bound SSRF-wrapped dispatcher
and never consults the process-global. So a legitimately clobbered
global (the first Better Auth OIDC redirect fetch clears the marker)
does NOT break the Cloud plane — yet `/api/ready`'s `ssrf_dispatcher`
check still fed the global-marker result into the gating conjunction,
producing a false `not_ready` that would cycle the container
`unhealthy` via the compose healthcheck.

**Fix (advisor Option B of A/B/C/D):** drop `ssrf_dispatcher` from the
gating conjunction — `allOk = litellm_client.ok && litellm_upstream.ok`.
Keep `ssrf_dispatcher` REPORTED in the `checks` body (it is still a real
signal for Better Auth OIDC + Tavily/Yandex web-search egress, which DO
use the global dispatcher) but it no longer flips `status`. Matches
k8s/compose readiness doctrine: a probe answers "can I serve my
contract", not "is my security posture pristine". `readiness.ts` +
`readiness.test.ts` (the 503-on-unwrapped-global case flipped to
200-ready-with-falsey-reported-field) + `cloud-plane.e2e.test.ts`
(`ssrf_dispatcher.ok` relaxed `literal(true)` -> `boolean`).

**Fast-follow (not done):** emit the global-SSRF marker as an OTel gauge
so the posture signal drives an alert, not just a probe-body field.

## Tests (RED->GREEN, same commit as fix)

- NEW `packages/wire-schemas/tests/unit/__tests__/r28-nullish-optionals.test.ts`
  — 16 cases. RED: 8 failed pre-fix. GREEN: 16/16.
- `apps/api/tests/unit/routes/reason.test.ts` — +1 R28 integration test.
- `apps/api/tests/unit/routes/agent/stream.test.ts` — +2 R28 tests.
- `apps/api/tests/unit/lib/dep-check.test.ts` — path-spy `/health` ->
  `/health/readiness`. RED: 6 failed pre-fix.

## Verification

Test commands + results:
- wire-schemas: `Test Files 6 passed (6)` / `Tests 145 passed (145)`
- apps/api (reason+stream+dep-check): exit 0, `Tests 55 passed (55)`
- apps/api (probes+translate-tools): exit 0, `Tests 32 passed (32)`

tsc baseline: `tsc --noEmit` across api/worker/wire-schemas — baseline
(stashed) 5 pre-existing errors (routes/index.ts 388/389/395 +
tokens/assemblyai.ts + tokens/deepgram.ts); after changes identical 5.
Zero NEW errors from the `.nullish()` widening.

Lockers: lint-no-suppressions clean; lint-no-hardcode clean.

Live verification (`docker compose up -d --build api`, real bearer from a
verified sign-up at http://localhost:4000):
- POST /api/reason {"text":"hi","model":null,"agentName":null} -> HTTP 200
- POST /api/agent/stream {"messages":[{"role":"user","content":"hi"}],"model":null}
  -> HTTP 200, valid NDJSON
- /api/ready polled 80x -> 200 every time, zero 503 flap (R29)
- api container `healthy` after rebuild (was `unhealthy` before)

## Deviations from Plan

None for the fix itself.

## Out-of-scope (deferred)

`apps/api/src/routes/agent/stream.ts` lines 53-54 — pre-existing unused type
imports `AgentChatMessage` / `AgentLegacyTool` (present in 2bbaf04c before this
work). Biome flagged as non-blocking WARN. Not introduced by this task; not
fixed per SCOPE BOUNDARY.

## Follow-up (client repo, not executed here)

Update desktop client SERVER-REQUIREMENTS.md §R28/R29 to CLOSED with SHAs
2af65a83 / bcf5c072; notify client agent to re-run the first-dictation flow.

## Self-Check: PASSED

- 2af65a83 on HEAD~1, bcf5c072 on HEAD — confirmed via git log.
- r28-nullish-optionals.test.ts committed in 2af65a83.
- Live curls re-run, HTTP codes read directly (200 / 200 / 200x80).
