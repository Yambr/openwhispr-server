---
slug: r33-reason-cleanup-persona
date: 2026-05-22
status: complete
commit: [dca4f24d, b9f34fc7, b4f27348, 00795cba, fb90c19c]
---

# R33 — /api/reason cleanup-persona + thinking-off model routing — Summary

## Problem

`/api/reason` applied a conversational-assistant persona to dictation
cleanup requests — dictating "раз, два, три" with "Enhance with AI" on
got answered like a chatbot instead of returning cleaned text. Root
cause: `reason.ts` sent `messages:[{role:"user",content:text}]` with NO
system prompt; `promptMode` was a hardcoded `"default"`. The immutable
desktop client deliberately sends no cleanup `systemPrompt` on the
cloud path — it relies on the server recognising the cleanup request
SHAPE.

## Fix — server-side prompt + model routing keyed on request shape

Cleanup shape = `agentName` absent AND `systemPrompt` absent AND `model`
empty/absent. Pure function `isCleanupRequest` / `selectMessages` in
`apps/api/src/lib/reason-prompt-select.ts`. No content heuristics — shape
only.

**LAYER 1 — persona, three-tier precedence (`fb90c19c` completed it):**
1. `body.customPrompt` non-empty (`trim().length > 0`) → used VERBATIM
   (the user's Prompt-Studio cleanup override; `customPrompt` was
   modeled in `ReasonRequest` but previously never read — the override
   was silently dropped on the cloud path).
2. else → server localized default `prompts.cleanupPrompt` — a new
   i18next `prompts` namespace, `en` + `ru` locale resources
   (anti-injection text-cleanup-tool persona). Locale resolved from
   `body.language` → `body.locale` → `req.language` → `en`.

**LAYER 2 — model routing + thinking-off:** cleanup shape →
`REASONING_CLEANUP_MODEL` (env, default the Qwen3.6-35B-A3B cleanup
alias) with reasoning disabled via the request body —
`extras: { extra_body: { chat_template_kwargs: { enable_thinking:
false } } }`. Thinking-off travels in the chat-completions request
body, NOT in `litellm_config.yaml` (the yaml entry maps the alias →
endpoint only). Agent shape keeps the full model, no thinking-off.

## Tests

- `reason-prompt-select.test.ts` — `isCleanupRequest` shape matrix +
  the customPrompt tiers including `customPrompt:""` and
  `"   \n  "` (whitespace) → server default, and the agent-shape
  no-override guard.
- `reason.test.ts` — integration (litellm mocked at MockAgent
  boundary): cleanup-shape → upstream call carries the cleanup system
  message + cleanup model + `enable_thinking:false`; a customPrompt
  override case asserts the override is the system message verbatim;
  agent-shape → conversational, full model, no thinking-off.

## Verification

- `vitest run reason-prompt-select.test.ts reason.test.ts` → 2 files,
  87 tests passed (re-run independently, exit 0).
- Diff coverage (`reason-prompt-select.ts` + `reason.ts`): statements
  100%, branches 96.66%, functions 100%, lines 100% — all ≥ 90%.
- `tsc --noEmit` (api + litellm-client): exactly the 5 pre-existing
  baseline errors, zero new.
- Lockers: no-env-branches / no-suppressions / no-hardcode clean;
  prod-readiness allowlist line-drift corrected (`reason.ts:104`).
- `docs/wire-contract.md` documents the /api/reason prompt-selection +
  model-routing contract.

## Out of scope (not introduced here)

`tests/unit/routes/agent/plan-52-06-stream-zod-drift.test.ts` — 6
pre-existing failures, unrelated to R33 (confirmed failing on the prior
commit). Not touched.

## Follow-up

Live docker-stack verification + client-agent live run pending (see the
session response for the live curl result).

## Self-Check: PASSED

- All 5 SHAs confirmed on HEAD via git log.
- 87 tests re-run independently — exit 0 read directly.
- customPrompt empty-string + whitespace coverage confirmed by grep.
