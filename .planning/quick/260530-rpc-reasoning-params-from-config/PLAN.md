---
quick_id: 260530-rpc
slug: reasoning-params-from-config
date: 2026-05-30
status: complete
---

# Quick Task: reasoning-params-from-config (per-model extras bag from env)

Tracker #18. Nick GO; priority after #12, before #15/#17.

## Problem (root cause, not the cleanup symptom)

`/api/reason` chat-params are hardcoded under ONE backend syntax.
`QWEN_THINKING_OFF_EXTRAS` (reason-prompt-select.ts:162) =
`{extra_body:{chat_template_kwargs:{enable_thinking:false}}}` — vLLM/SGLang
syntax that OpenRouter SWALLOWS (operator measured: this = 12.0s STILL
thinking; `reasoning:{enabled:false}` = 1.6s not thinking). temperature /
max_tokens / top_p are never sent → provider default (~0.7) drifts cleanup.

"Today one model, tomorrow another; today litellm, tomorrow OpenRouter
direct — chat-params must be CONFIGURABLE per-model, not hardcoded to one
backend" (Nick). litellm-analogy: a per-model `litellm_params` bag the
proxy forwards verbatim — operator puts provider syntax in the config BY
HAND; code does NOT translate intent→syntax (adapter layer rejected as
overkill).

## Design (minimal — swap the SOURCE, transport already exists)

The extras transport is already there:
`ChatCompletionRequest.extras: Record<string,unknown>` spread via
`...req.extras` (packages/litellm-client/src/index.ts:477). Only the source
is broken (hardcoded const). So:

1. **Config (`packages/litellm-client/src/config.ts`)** — add
   `modelParams: Record<string, Record<string, unknown>>` to
   `LitellmClientConfig`. Parse `REASONING_MODEL_PARAMS` (JSON map
   alias→bag) in `loadLitellmConfigFromEnv`. **Validation:** unset/empty →
   `{}`. Malformed JSON / top-level not an object / any value not a plain
   object → `throw new Error(...)` (boot surfaces it as EX_CONFIG exit 78,
   same loud-fail posture as `LITELLM_MASTER_KEY is required` and
   `validate*Boot`). No silent ignore of bad config.

2. **Resolver (`apps/api/src/lib/reason-prompt-select.ts`)** —
   `ModelSelectionDeps` gains `modelParams?: Record<string, Record<string,
   unknown>>`. `selectModelAndExtras` resolves the alias (unchanged), then
   `extras = modelParams[resolvedAlias]` when present — for ALL shapes, not
   just cleanup. **Backward-compat:** cleanup shape with NO matching
   `modelParams` entry → keep `QWEN_THINKING_OFF_EXTRAS` (so an upgrade with
   unset env behaves exactly as today). Agent shape with no entry → no
   extras (today's behavior).

3. **Wiring (`apps/api/src/index.ts:942`)** — thread
   `modelParams: litellmConfig.modelParams` into the reason route deps
   alongside `cleanupModel`.

4. **Anti-injection (the one security-sensitive invariant)** — the bag is
   safe ONLY because its source is operator env, NEVER the request. The
   resolver reads `body.model` for alias selection and NOTHING else from
   `body` into `extras`. Test: a /api/reason request that smuggles
   `extras` / `reasoning` / `temperature` / `extra_body` in its BODY must
   NOT have those reach the upstream — only the operator config bag does.

## Surface

- `packages/litellm-client/src/config.ts` (+ `config.test.ts`,
  `env-parse` if needed) — parse + validate + new field.
- `apps/api/src/lib/reason-prompt-select.ts` (+ its test) — resolver +
  backward-compat + all-shapes.
- `apps/api/src/index.ts` — thread modelParams into reason deps.
- `apps/api/tests/unit/routes/reason.test.ts` — anti-injection test +
  config-driven-extras test (golden bag → upstream body).
- `.env.full.example` + operator doc — `REASONING_MODEL_PARAMS` with the
  backend syntax table; chart projection note.

## Operator inputs (gr0flvsr, measured live, prod OpenRouter key)

- Default bag (current backing = non-reasoning instruct):
  `REASONING_MODEL_PARAMS={"qwen3.6-cleanup":{"temperature":0}}` → 0.71s,
  clean, no drift.
- FUTURE-NOTE (schema+docs, NOT the default): if cleanup alias reverts to a
  reasoning model → `{"reasoning":{"enabled":false},"temperature":0}`.
- Backend reasoning-off syntax table (operator doc):
  - OpenRouter: `{"reasoning":{"enabled":false}}`
  - vLLM/SGLang self-host:
    `{"extra_body":{"chat_template_kwargs":{"enable_thinking":false}}}`
  - Anthropic: default-off (don't enable thinking)
  - OpenAI o-series: `{"reasoning_effort":"minimal"}`

## Verification

- RED → GREEN, TDD, no internal mocks (network boundary only).
- Boot-validation test: bad JSON / non-object → throws (EX_CONFIG path).
- Anti-injection test GREEN.
- Backward-compat test: unset env → cleanup still gets thinking-off default.
- `pnpm --filter ... tsc --noEmit` exit 0; LOCKERs clean.
- `pnpm test:all` green for the pre-push evidence gate (never --no-verify).
- Ping gr0flvsr on PR for scope review + live-litellm bag confirmation.
