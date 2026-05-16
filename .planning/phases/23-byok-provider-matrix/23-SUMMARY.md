# Phase 23 — SUMMARY (closed 2026-05-16)

**Status:** CLOSED. ROADMAP "Phase 23: L2 BYOK provider matrix (HIGH)" met.
**Source plan:** `.planning/qa-audit/2026-05-16-test-layering.md §L2`.

## What landed

Single integration test `tests/integration/byok-provider-matrix.test.ts` contracts the env→provider routing matrix for the 4 providers wired in `compose/litellm/litellm_config.yaml`:

| Provider   | Env key                                        | Used by                                       |
|-----------|------------------------------------------------|-----------------------------------------------|
| OpenRouter | `OPENROUTER_API_KEY`                           | qwen3.6-plus, gemini-3-flash, gpt-4o-mini     |
| Groq       | `GROQ_API_KEY`                                 | whisper-large-v3                              |
| OpenAI     | `OPENAI_API_KEY`                               | realtime                                      |
| Bedrock    | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`  | (corporate override only)                     |

8 permutations (4 providers × 2 key-present/absent states) + 1 Bedrock-pair guard + 1 cost-discipline meta-test = **14 tests, all GREEN**.

## Cost discipline

Per memory `feedback_loadtest_cost_discipline`: the test makes NO paid-provider call. A meta-test asserts the matrix function source never reads `OPENWHISPR_LOADTEST_ALLOW_PAID`. Any future expansion to call a real provider MUST go behind that env per the memory.

## Side-effect: vitest projects array gained `tests-integration`

The `tests/integration/` surface had no explicit project entry after the v3 projects-array migration, so existing files like `docs-operations-byok-matrix.test.ts` were silently undiscovered by `pnpm test`. The new entry restores them alongside the Phase 23 test.

## Commits

```
a258972 feat(23-01): byok provider-matrix integration test (SR-23.1)
<doc-commit>  docs(23): add phase artefacts — summary
```

## Known follow-ups

1. **redactUrl is basic-auth only.** Phase 23 tests contract `redactUrl(URL with basic-auth password)` because that's what the helper supports. Query-parameter secret redaction (`?api_key=...`) is OUT OF SCOPE — the audit log in Phase 6 already redacts at a different layer. If future providers ship secrets via query string and operators log raw URLs, expand `redactUrl` in a separate phase.

2. **byok-guard scope expansion deferred.** This phase intentionally did NOT extend `packages/byok-guard/src/index.ts` to cover LLM provider keys. Doing so would change the Phase 14 overlay contract (storage/observability/ingress/pgbouncer/dev-tools). If a future phase needs unified BYOK validation across overlays + providers, port the `assertProviderEnv` logic from this test into byok-guard.

3. **Mock LiteLLM not used.** Phase 23 asserts pre-flight env, not actual upstream behaviour. If a future phase wants to assert "provider X actually receives bearer Y", boot mock-litellm via `compose/mock-litellm/` and intercept.

## Phase status

```
status: CLOSED
closed: 2026-05-16
verified_by: self (Claude Opus 4.7)
tests_added: 14 (BYOK provider matrix)
projects_array_repaired: tests-integration entry added
```
