---
quick_id: 260522-envmodels
slug: env-driven-model-hardcode
date: 2026-05-22
status: planned
---

# D2/D3/D4 — env-drive every hardcoded model/provider literal

## Problem

Provider/model identifiers are baked into TypeScript as literals, even
though the LiteLLM alias layer exists precisely so the operator owns
that mapping. A corporate operator overriding `LITELLM_BASE_URL` to
their internal catalog cannot retarget these without a code change —
violating the CLAUDE.md doctrine "LiteLLM is the abstraction layer; corp
operators env-override without ANY code change."

Inventory (grep-confirmed, non-test, non-comment):

| Ref | File:line | Literal | Fix |
|-----|-----------|---------|-----|
| D2 | `apps/api/src/routes/transcribe.ts:64` | `STT_MODEL = "whisper-large-v3"` | env `LITELLM_STT_MODEL`, default `"whisper-large-v3"` |
| D3a | `apps/api/src/routes/reason.ts:65` | `DEFAULT_MODEL = "qwen3.6-plus"` | env `LITELLM_DEFAULT_CHAT_MODEL` (ALREADY loaded by litellm-client config — reuse, do not add a second var) |
| D3b | `apps/api/src/routes/reason.ts:75-77` | `MODEL_PROVIDER` map (3 entries) | see "MODEL_PROVIDER decision" below |
| D4 | `apps/api/src/routes/tokens/openai-realtime.ts:41` | `DEFAULT_MODEL = "gpt-realtime"` | env `LITELLM_REALTIME_MODEL` (SAME var as D1 — coordinate) |
| D5 | `packages/litellm-client/src/config.ts:49` | `DEFAULT_CHAT_MODEL = "qwen3.6-plus"` | already the default for `LITELLM_DEFAULT_CHAT_MODEL` — keep as the literal DEFAULT only |
| D6 | `packages/litellm-client/src/index.ts:223` | `DEFAULT_STT_MODEL = "whisper-large-v3"` | make it the default for a new `LITELLM_STT_MODEL` read in `loadLitellmConfigFromEnv` |
| D7 | `packages/litellm-client/src/index.ts:100-103` | provider map (4 entries) | see "MODEL_PROVIDER decision" |
| D8 | `apps/worker/src/lib/infer-kind.ts:17` | `model === "whisper-large-v3"` substring check | the `model.includes("whisper")` fallback already covers it — verify, likely leave as a heuristic (NOT a config value; it's classification logic). Document why it stays. |

## Pattern to follow (already established — do NOT invent a parallel system)

`packages/litellm-client/src/config.ts` `loadLitellmConfigFromEnv()`
ALREADY reads `LITELLM_DEFAULT_CHAT_MODEL` (falls back to
`DEFAULT_CHAT_MODEL`). Extend that loader with `LITELLM_STT_MODEL` and
`LITELLM_REALTIME_MODEL`, surface them on `LitellmClientConfig`
(`defaultSttModel`, `defaultRealtimeModel` alongside `defaultChatModel`).
Routes receive these via the injected client config / deps — NOT via
`process.env` reads in route files (LOCKER-01: `process.env` only in
`config/*`, `bootstrap.ts`, `index.ts`, `*.config.ts`).

- `transcribe.ts` — `STT_MODEL` const removed; the route reads
  `deps.<sttModel>` threaded from the litellm client config.
- `reason.ts` — `DEFAULT_MODEL` const removed; route uses
  `config.defaultChatModel` (the litellm-client config already carries
  it; `reason.ts:101` already does `body.model ?? deps.defaultModel ??
  DEFAULT_MODEL` — collapse the third fallback into the deps value).
- `tokens/openai-realtime.ts` — `DEFAULT_MODEL` reads the
  `LITELLM_REALTIME_MODEL` value (coordinate the var name with the D1
  quick-task — SAME env var, one source of truth).

## MODEL_PROVIDER decision (D3b / D7)

The `MODEL_PROVIDER` map exists ONLY to populate the `provider` field in
the `/api/reason` response (billing-echo / display). It already has a
`'litellm'` / `'openrouter'` fallback for unknown models. Two clean
options — pick the lower-risk one and note the rationale:
- **Preferred:** keep the map as a BEST-EFFORT display hint with the
  existing fallback, but add a one-line comment that it is display-only
  and intentionally NOT exhaustive — a corporate catalog resolves to the
  fallback. Do NOT env-drive a whole map (that is config sprawl).
- Alternative: drop the map, always echo a constant `provider`. Only if
  the response-shape contract (`BACKEND_SPEC` / `ReasonResponse`)
  permits — CHECK `packages/wire-schemas` + `docs/wire-contract*.md`
  first. If the desktop asserts a specific `provider` value, do NOT
  change the shape.

The map is a display hint, not a routing decision — it is NOT the same
class of hardcode as D2/D3a/D4 (which DO gate behavior). Be explicit
about this distinction in the commit message; do not over-engineer it.

## TDD order (RED → GREEN — same atomic commit per logical change)

1. RED unit (`packages/litellm-client` config test):
   `loadLitellmConfigFromEnv` reads `LITELLM_STT_MODEL` +
   `LITELLM_REALTIME_MODEL`; falls back to the literal defaults when
   unset; surfaces them on `LitellmClientConfig`.
2. RED unit (`apps/api` transcribe test): the route forwards the
   config-supplied STT model (inject a non-default value, assert it
   reaches the litellm call) — no `whisper-large-v3` literal in the
   route.
3. RED unit (`apps/api` reason test): the route uses the
   config-supplied default chat model when `body.model` is absent/null
   (R28 — `body.model` may be null); no `qwen3.6-plus` literal.
4. RED unit (`apps/api` openai-realtime token test): `DEFAULT_MODEL`
   resolves from the realtime-model config value.
5. GREEN — implement. ≥90/90/90/90 on the diff. Confirm `tsc --noEmit`
   has zero NEW errors (baseline: 5 pre-existing in `routes/index.ts` +
   `tokens/{assemblyai,deepgram}.ts`).

## Antipatterns to avoid

- ❌ `process.env` reads inside route files (LOCKER-01) — env reads live
  in `config/*` / `loadLitellmConfigFromEnv`; routes get values via
  injected deps.
- ❌ A second/parallel config system — extend
  `loadLitellmConfigFromEnv`, the established seam.
- ❌ Env-driving the `MODEL_PROVIDER` display map — config sprawl; it is
  a best-effort hint with a fallback, not behavior-gating.
- ❌ Changing the `/api/reason` response `provider` shape without
  checking the wire contract first.
- ❌ Touching `apps/api/src/routes/realtime.ts` / the realtime
  litellm-config entries — that is the D1 quick-task's exclusive scope.
  This task only touches `tokens/openai-realtime.ts` for the var NAME.
- ❌ `as any` / suppressions for any new config-field type widening.

## Scope boundary (parallel-safety with the D1 quick-task)

The D1 quick-task (`20260522-d1-realtime-model-injection`) runs in
parallel and owns `apps/api/src/routes/realtime.ts`,
`apps/api/src/routes/index.ts` (realtime wiring), and the realtime
entries in `litellm_config*.yaml`. THIS task must NOT edit those.
Coordination point: both tasks introduce `LITELLM_REALTIME_MODEL` — it
is ONE env var. This task adds it to `loadLitellmConfigFromEnv`; the D1
task consumes it for the proxy `?model=` injection. If a merge conflict
appears in `.env.example`, the var is identical — trivially resolved.

## Verification

- Lockers green (01/02/03/04, tdd, english). `tsc` zero new errors.
- `docker compose up -d --build api`.
- Live: set `LITELLM_STT_MODEL` to a non-default alias in `.env`,
  restart api, confirm `/api/transcribe` forwards that alias to LiteLLM
  (litellm access log). Unset → falls back to `whisper-large-v3`.
- `/api/reason` with `{text:"hi"}` (no model) routes via the
  config-default chat model.
- After landing: SUMMARY.md with the full before/after literal
  inventory so the audit trail shows every hardcode is now env-driven.
