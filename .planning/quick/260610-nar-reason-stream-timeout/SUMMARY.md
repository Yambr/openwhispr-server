---
quick_id: 260610-nar
title: Fix POST /api/reason HEADERS_TIMEOUT via internal-stream-then-buffer
status: complete
date: 2026-06-10
branch: quick/260610-nar-reason-stream-timeout
commits:
  - 3f3ee9d0  # feat: pure SSE accumulator
  - 380027bd  # feat: rewire reason.ts to stream-then-buffer
  - c03d8f63  # test: streaming contract-mock + e2e wire-shape
---

# C1 — POST /api/reason 30s headersTimeout fix

## Problem
`POST /api/reason` returned HTTP 500 at ~30485ms with `UND_ERR_HEADERS_TIMEOUT`.
qwen3.6-plus leaves thinking ON for the reason shape and thinks >30s before the
first output token; in non-streaming mode the gateway holds response headers
until that first token, so undici's `headersTimeout` (default 30_000ms) aborts.
From the client meeting PLAN №1, item C1.

## Solution (Option A — internal-stream-then-buffer, advisor-confirmed)
Switched the route's internal upstream call from `chatCompletions()` to the
existing `chatCompletionsStream()`. With `stream:true` the gateway flushes
headers + first SSE token fast → headersTimeout satisfied structurally; the long
tail is bounded by stream-path `bodyTimeout: 0` (per-chunk-idle). A new pure
accumulator buffers the SSE deltas into full text, then the route returns the
SAME JSON shape `{ text, model, provider, promptMode, matchType }`. Wire surface
byte-identical; client v1.7.23 untouched. The rejected band-aid (raising
per-call headersTimeout) was NOT used.

## Files
- `apps/api/src/lib/reason-stream-accumulate.ts` (new) — pure SSE accumulator;
  reconstructs total_tokens, raises `ReasonStreamIncompleteError`
  (code `REASONING_UPSTREAM_FAILED`, LOCKER-05-compliant) on error-frame /
  premature-close / missing terminal usage.
- `apps/api/tests/unit/lib/reason-stream-accumulate.test.ts` (new) — 9 tests.
- `apps/api/src/routes/reason.ts` — calls `chatCompletionsStream`, bridges
  `Readable.toWeb`, accumulate-and-inspect BEFORE 200; post-200 stream failure
  → 502 envelope, never a partial 200.
- `apps/api/tests/unit/routes/reason.test.ts` — 37 tests (existing preserved
  through the streamed path + new headline RED tests A/B/C/D).
- `compose/litellm/litellm_config.contract.yaml` — qwen3.6-plus/-cleanup mock.
- `tests/e2e/reason.e2e.test.ts` — five-key wire-shape assertion.

## Verification (orchestrator-verified independently, not from executor claim)
- Commits 3f3ee9d0 / 380027bd / c03d8f63 confirmed on HEAD.
- Tests re-run by orchestrator: **46/46 green** (37 route + 9 accumulator).
- Coverage (orchestrator-run): accumulate 100/100/100/100; reason.ts
  100/95.65/100/100 — the one uncovered branch is the pre-existing
  `req.user.email ?? req.user.id` fallback (reason.ts:188), not new code.
  Both ≥ 90/90/90/90 floor.
- tsc --noEmit exit 0. LOCKER-01/02/03 clean.
- Wire shape read directly from reason.ts: exactly the 5 canonical keys.

## Deviations
1. **Allowlist sync** `tools/lint-no-hardcode.allowlist.txt` line 169→168 —
   LOCKER-03 was already RED on `main` (allowlist drift from diarization-removal
   commit 9cce4edb). Fixed via the sanctioned allowlist path, no production code
   touched.
2. **Contract mock_response: SSE-shaped → plain string** — verified live that
   LiteLLM treats `mock_response` as literal content under `stream:true` and
   chunks it; the plan's SSE-form mock would have shipped a broken e2e. Set
   `mock_response: "mocked reasoning"`; LiteLLM then emits real delta + finish +
   usage frames (live-confirmed in-cluster).
3. **Legacy "missing usage → 200 units=0" test → "no terminal usage → 502"** —
   a buffered 200 cannot be issued without reconstructable usage.

## Pending
- Full `tests/e2e/reason.e2e.test.ts` through Traefik: blocked by pre-existing
  `fixture-idp` healthcheck starvation (known infra issue, not this code). Path
  proven working live in-cluster (200 + "mocked reasoning" + exactly 5 keys;
  401 without cookie). Re-run with fixture-idp excluded to formally close.
- NOT released — on branch quick/260610-nar, awaiting owner "релизь".

## Operator workaround (immediate, no release)
`LITELLM_HEADERS_TIMEOUT_MS=120000` (R32 env knob, .env.slim.example:327).
Global to all non-stream calls; safe ceiling until this streaming fix releases.
