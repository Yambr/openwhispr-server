---
slug: r31-strip-openai-beta-header
date: 2026-05-22
status: complete
commit: [f41d29e2, bb485b4c]
---

# R31 — strip OpenAI-Beta header on the realtime upstream leg — Summary

## Problem

Client-filed blocker: realtime live run got a client-facing WS OPEN then
immediate close `code 1011 "unexpected response"` before
`transcription_session.created`. Root cause (dual):

1. **Beta-API header leak (this fix).** `buildRewriteRequestHeaders` in
   `apps/api/src/routes/realtime.ts` spread ALL client headers
   (`{ ...headers }`) and deleted only `authorization`. The desktop
   client's `OpenAI-Beta: realtime=v1` passed straight through Fastify →
   LiteLLM → OpenAI. OpenAI Realtime is GA; the Beta header forces the
   retired code path → `beta_api_shape_disabled` → WS 1011.
2. **Stale api image.** The D1 `?model=` injection merged at 02:41 but
   `openwhispr-api-1` was built at 01:41 — the running image predated
   the merge. Resolved by the rebuild below.

## Fix

**`f41d29e2`** — `apps/api/src/routes/realtime.ts`: in
`buildRewriteRequestHeaders`, `delete next["openai-beta"]` +
`delete next["OpenAI-Beta"]` alongside the existing `authorization`
dual-delete. Threat-model comment: new T-03-07-06 facet — the proxy is
the GA contract boundary and strips the client-origin Beta opt-in
regardless of what any client sends.

**`bb485b4c`** — `docker-compose.yml`: pass `LITELLM_REALTIME_MODEL`
through to the api service (default `realtime-default`) so the D1
operator-config story is complete.

## Tests (RED → GREEN, same commit as fix)

`apps/api/tests/unit/routes/realtime.test.ts` — 3 assertions added to
the `buildRewriteRequestHeaders` describe block:
- strips `OpenAI-Beta` (literal client casing)
- strips `openai-beta` (lowercase canonical Node casing)
- preserves a benign header (`content-type`) — targeted-not-blanket
  regression guard

RED: 2 failed pre-fix (header leaked through the spread). GREEN: all
35 tests in `realtime.test.ts` pass.

## Verification

- `realtime.test.ts`: `Test Files 2 passed (2)` / `Tests 35 passed (35)`.
- Lockers: `lint-no-suppressions` / `lint-no-hardcode` /
  `lint-no-env-branches` / `lint-prod-readiness` clean.
- `tsc --noEmit` (api): baseline 5 pre-existing errors
  (`routes/index.ts` + `tokens/{assemblyai,deepgram}.ts`) — zero new.
- `docker compose up -d --build api` → api `healthy`, `/api/ready` 200.
- Live WS handshake to `ws://localhost:4000/v1/realtime` with a real
  bearer AND `OpenAI-Beta: realtime=v1` → client-facing
  `101 Switching Protocols` (proxy still upgrades correctly post-fix).
  Full realtime session to `transcription_session.created` requires a
  live OPENAI_API_KEY with GA Realtime access — client agent verifies.

## Deviations from Plan

None.

## Follow-up

- Client agent (peer `tcpsycot`) notified: R31 server leg closed, SHAs
  `f41d29e2` / `bb485b4c`; client is immutable (0 changes — the
  `OpenAI-Beta` header + model literal are upstream code `5ec0d480`).
- Client agent filed R32 (cloud chat `/api/agent/stream` chunk-`type`
  vocab mismatch) — separate quick task.

## Self-Check: PASSED

- `f41d29e2` + `bb485b4c` on HEAD — confirmed via git log.
- `realtime.test.ts` re-run, 35/35 read directly.
- api rebuilt; live WS `101` observed directly.
