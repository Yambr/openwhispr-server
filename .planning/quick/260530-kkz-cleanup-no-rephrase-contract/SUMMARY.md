---
quick_id: 260530-kkz
slug: cleanup-no-rephrase-contract
date: 2026-05-30
status: complete
commit: 1d64002e
---

# Summary: Cleanup-no-rephrase contract test

## What was added

One regression-guard test in `apps/api/tests/unit/routes/reason.test.ts`
(R33 block): **"cleanup-shape returns the model output VERBATIM (no
server-side rephrase/added content)"**.

Locks OUR layer's half of the cleanup contract after the reasoning-rephrase
incident (peer gr0flvsr's litellm fix swapped the backing model under alias
`qwen3.6-cleanup` from a reasoning model to a strict instruct checkpoint +
temperature:0).

## What it pins (honest scope)

Hermetic — `makeFakeLitellm` network-boundary fake, no internal mocks. Uses
a golden dirty-transcript → cleaned-output pair (the exact A/B sample the
operator validated end-to-end through litellm):

- `POST /api/reason` cleanup-shape returns `choices[0].message.content`
  **byte-for-byte** as `ReasonResponse.text` (`reason.ts:197`) — the server
  adds no preamble/commentary, does not re-clean or rewrite, does not echo
  the dirty input.
- Request side still correct: routes to `cleanupModel`, sends the cleanup
  system prompt ("text cleanup tool"), passes the raw transcript as the user
  message verbatim, carries thinking-off
  (`extra_body.chat_template_kwargs.enable_thinking:false`).

**Out of scope (by design):** whether a REAL model rephrases — a unit test
can't assert LLM behavior. That is guarded by (a) the operator's
instruct-model + temp:0 litellm config, and (b) the nightly e2e against the
real stage alias (task #17).

## Production code

NONE — the verbatim-passthrough behavior already exists at `reason.ts:197`.
This is a regression-locking test only, not a behavior change.

## Verification

- New test GREEN; full `reason.test.ts` → **24 passed** (was 23, +1).
- `pnpm --filter api tsc --noEmit` → exit 0.
- `pnpm test:all` green for the pre-push evidence gate (never --no-verify).

## Division of verification (cleanup-rephrase fix)

- litellm layer (instruct model really doesn't think + temp:0): operator
  gr0flvsr, end-to-end ✅
- live `/api/reason` on prod with a real long transcript: Nick via desktop
  client (his real case) ⬜
- our layer's contract regression: THIS test 🔨✅
- model-behavior regression on future backing-model bumps: nightly e2e #17 ⬜
