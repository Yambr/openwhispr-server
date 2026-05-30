---
quick_id: 260530-rpc
slug: reasoning-params-from-config
date: 2026-05-30
status: complete
---

# Summary: reasoning-params-from-config

Tracker #18. Replaces the hardcoded single-backend chat-param extras with a
per-model, litellm-style config bag from `REASONING_MODEL_PARAMS`.

## Root cause closed

`/api/reason` chat-params were hardcoded under ONE backend's syntax:
`QWEN_THINKING_OFF_EXTRAS` = `{extra_body:{chat_template_kwargs:{enable_thinking:false}}}`
(vLLM/SGLang) — which OpenRouter SWALLOWS (operator measured: 12s still
thinking vs 1.6s with `reasoning:{enabled:false}`). temperature/top_p were
never sent. Swapping model/provider required a code change.

## Design (minimal — swap the SOURCE, transport already existed)

litellm-analogy, NO intent→syntax adapter (that over-scope was retracted).
The extras transport already exists (`ChatCompletionRequest.extras`,
spread via `...req.extras`); only the source was a hardcoded const.

1. **Config** — `LitellmClientConfig.modelParams: Record<string,
   Record<string,unknown>>` parsed from `REASONING_MODEL_PARAMS` (JSON map
   alias→bag) in `loadLitellmConfigFromEnv`. Unset/empty → `{}`. Malformed
   JSON / non-object top level / non-object value → **throws** → boot
   EX_CONFIG exit 78 (same posture as `LITELLM_MASTER_KEY is required`).
2. **Resolver** — `selectModelAndExtras` resolves the alias, then
   `extras = modelParams[alias]` (shallow copy) for ALL shapes.
   Backward-compat: cleanup with no entry → `QWEN_THINKING_OFF_EXTRAS`;
   agent with no entry → no extras.
3. **Wiring** — `litellmConfig.modelParams` threaded through
   `index.ts` → `routes/index.ts` reasonDeps → `selectModelAndExtras`.
4. **Anti-injection** — the bag comes ONLY from operator config; the
   resolver reads `body.model` and nothing else from the body into extras.
   `resolveConfiguredExtras` is built solely from `modelParams[model]`.

## Tests (TDD, RED→GREEN, network-boundary fakes only)

- `config.test.ts` — 11 new (parse, unset/empty→{}, malformed→throw,
  non-object top level→throw, non-object value→throw, empty-bag ok). 46/46.
- `reason-prompt-select.test.ts` — 7 new (override all shapes,
  backward-compat both shapes, explicit model, empty map, anti-injection).
  71/71.
- `reason.test.ts` — 3 new ROUTE-level (config bag → upstream extras for
  cleanup + agent; **anti-injection: client body keys never leak**). 27/27.

## Production code

- `packages/litellm-client/src/config.ts` — `modelParams` field +
  `parseModelParams` + `isPlainObject` validator.
- `apps/api/src/lib/reason-prompt-select.ts` — `modelParams` dep +
  `resolveConfiguredExtras` + all-shapes/back-compat logic.
- `apps/api/src/routes/reason.ts` — `modelParams` dep + threaded into
  `selectModelAndExtras`.
- `apps/api/src/index.ts` + `apps/api/src/routes/index.ts` — `modelParams`
  on `litellmModels` + wired from `litellmConfig.modelParams`.

## Docs

- `.env.full.example` — `REASONING_MODEL_PARAMS` with the per-backend
  reasoning-off syntax table (OpenRouter / vLLM / Anthropic / OpenAI) +
  the operator default `{"qwen3.6-cleanup":{"temperature":0}}`.

## LOCKER allowlist drift (line-number shifts from the 4 inserted lines)

The inserts in `index.ts` / `routes/index.ts` shifted pre-existing
allowlisted lines. Updated line numbers + appended `(#18 +N …)` drift
notes in the SAME commit (per allowlist convention):
- `lint-no-suppressions.allowlist.txt` — 8 index.ts entries (+2/+4).
- `lint-no-hardcode.allowlist.txt` — config.ts:117→135, routes:355→357,
  index.ts:1094→1098.
- `lint-no-env-branches.allowlist.txt` — index.ts 792/798/803/804 (+2),
  routes:675→681 (+6).

## Verification

- config 46/46, reason-prompt-select 71/71, reason 27/27.
- `tsc --noEmit` exit 0 (litellm-client + api).
- lint-no-hardcode / no-suppressions / no-env-branches / english: clean.
- biome: clean.
- `pnpm test:all` GREEN for the pre-push evidence gate (never --no-verify).

## Division (operator gr0flvsr)

- server resolver + boot-validation + anti-injection = THIS task.
- per-model default bags (measured live) = operator; default
  `{"qwen3.6-cleanup":{"temperature":0}}` baked into the env doc. Ping on
  PR for live-litellm confirmation.
