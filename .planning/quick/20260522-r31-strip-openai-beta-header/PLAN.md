---
quick_id: 260522-r31beta
slug: r31-strip-openai-beta-header
date: 2026-05-22
status: planned
---

# R31 — strip the `OpenAI-Beta` request header on the realtime upstream leg

## Problem

The WSS `/v1/realtime` reverse-proxy (`apps/api/src/routes/realtime.ts`)
rewrites the upstream-bound upgrade headers via
`buildRewriteRequestHeaders`. That closure spreads ALL client headers
(`{ ...headers }`) and then deletes only `authorization` /
`Authorization`. Every other header — including the desktop client's
`OpenAI-Beta: realtime=v1` — passes straight through Fastify → LiteLLM →
OpenAI. OpenAI's Realtime API is now GA; the `OpenAI-Beta` header forces
the retired Beta-API code path, which OpenAI rejects
(`beta_api_shape_disabled`, "The Realtime Beta API is no longer
supported. Please use /v1/realtime for the GA API."). The realtime
error event arrives inside the open WS and the client-facing socket
closes with code `1011` BEFORE `transcription_session.created`.

This is the server-side half of R31 (the client-filed blocker). The
client agent is independently removing the header on its side, but the
proxy MUST also strip it — defence-in-depth: the proxy is the GA
contract boundary and must not relay a Beta-API opt-in regardless of
what any client (current or future) sends.

## Fix — File 1: `apps/api/src/routes/realtime.ts`

In `buildRewriteRequestHeaders`, in the same closure that deletes
`authorization` / `Authorization`, also delete the `OpenAI-Beta` header
in BOTH common casings (`openai-beta` lowercase — the canonical Node
`http` header form — and `OpenAI-Beta` — the literal the client sends).
Node lowercases incoming header keys, but the closure receives a plain
spread object so a test/caller could supply either casing; delete both
to be exhaustive, mirroring the existing `authorization` /
`Authorization` dual-delete.

Update the file-header threat-model comment: add a T-03-07-06 facet —
the proxy normalizes the upstream contract to OpenAI Realtime GA by
stripping the client-origin `OpenAI-Beta` opt-in; the realtime model
(D1) + this header strip together make the upstream leg GA-only.

## Fix — File 2: `apps/api/tests/unit/routes/realtime.test.ts`

RED test(s) added to the existing `buildRewriteRequestHeaders` describe
block (next to the "strips both 'authorization' and 'Authorization'
casings" test):

1. `buildRewriteRequestHeaders` strips `OpenAI-Beta` (the literal
   client casing) — assert the output has no `OpenAI-Beta` key.
2. strips `openai-beta` (lowercase canonical Node casing) — assert the
   output has no `openai-beta` key.
3. a header NOT in the strip set (e.g. `content-type`) is preserved —
   regression guard that the strip is targeted, not a blanket wipe.

RED: tests 1+2 fail pre-fix (header leaks through the spread). GREEN
after the two deletes.

## TDD order (RED → GREEN — same atomic commit)

1. RED — add the 3 assertions to `realtime.test.ts`; run, confirm 1+2
   fail.
2. GREEN — add the two `delete` statements + the threat-model comment.
   Re-run `pnpm --filter @openwhispr/api test realtime.test.ts` — all
   green.
3. Lockers — `lint-no-suppressions`, `lint-no-hardcode`,
   `lint-no-env-branches`, `lint-prod-readiness` clean. `tsc --noEmit`
   zero NEW errors (baseline: 5 pre-existing in
   `routes/index.ts` + `tokens/{assemblyai,deepgram}.ts`).

## Antipatterns to avoid

- ❌ Blanket header allowlist/denylist rewrite — the fix is a targeted
  delete of one known-bad header, mirroring the existing
  `authorization` delete. Do not invent a header-filtering framework.
- ❌ Parsing the WS `session.update` frame — out of scope; the proxy
  stays payload-opaque (T-03-07 doctrine).
- ❌ `as any` / suppressions.
- ❌ Touching the litellm config or the D1 `?model=` injection — that is
  already correct (`realtime-default` → `openai/gpt-realtime`, the GA
  model). This task ONLY strips the header.

## Verification

- Lockers green; `tsc` zero new errors; `realtime.test.ts` all green.
- `docker compose up -d --build api`.
- Live: WS handshake to `ws://localhost:4000/v1/realtime` with a real
  bearer AND a client-supplied `OpenAI-Beta: realtime=v1` header;
  confirm the upstream-bound upgrade (litellm access log / debug) does
  NOT carry `OpenAI-Beta`, and the WS reaches
  `transcription_session.created` instead of closing 1011.
- After landing: notify the client agent (peer `tcpsycot`) — server leg
  fixed, SHA; they verify the full realtime journey live.
