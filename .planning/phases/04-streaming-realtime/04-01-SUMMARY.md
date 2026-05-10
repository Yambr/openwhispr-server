---
phase: 04
plan: 01
subsystem: streaming-realtime
tags: [tdd, fixtures, sse, ndjson, tool-calls, mock-realtime, traefik]
requires:
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-01, D-09, D-14, D-15, D-16, D-21, D-22)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.1, §2.4, §2.5, §2.9)
  - compose/litellm/litellm_config.contract.yaml
  - compose/traefik/dynamic.yml
provides:
  - apps/api/src/routes/agent/__fixtures__/*.sse (7 SSE shapes for Wave 1 SSE→NDJSON parser)
  - apps/api/src/routes/tokens/__fixtures__/*.json (3 provider mint shapes for Wave 1 token routes)
  - apps/api/src/lib/sse-parser.test.ts (RED — Wave 1 GREEN)
  - apps/api/src/lib/tool-call-accumulator.test.ts (RED — Wave 1 GREEN)
  - tests/e2e/mock-realtime/* (skeleton — Wave 2 fills in)
  - tests/spikes/04-provider-shapes.md (provider field-name confirmations)
affects:
  - pnpm-workspace.yaml (added tests/e2e/mock-realtime; pinned msgpackr-extract allowBuilds)
  - pnpm-lock.yaml (regenerated for new workspace package)
  - compose/traefik/dynamic.yml (Phase 04 placeholder marker)
tech-stack:
  added:
    - "@openwhispr/mock-realtime workspace package (skeleton only)"
  patterns:
    - "TDD RED via missing-import — vitest reports 'Cannot find module' as canonical RED state"
    - "Hand-authored SSE fixtures with `# source:` header attribution"
    - "Provider response fixtures sanitized to `<REDACTED-...>` placeholders"
key-files:
  created:
    - apps/api/src/routes/agent/__fixtures__/text-only.sse
    - apps/api/src/routes/agent/__fixtures__/single-tool-call.sse
    - apps/api/src/routes/agent/__fixtures__/multi-tool-call.sse
    - apps/api/src/routes/agent/__fixtures__/text-then-tool.sse
    - apps/api/src/routes/agent/__fixtures__/premature-close.sse
    - apps/api/src/routes/agent/__fixtures__/malformed-payload.sse
    - apps/api/src/routes/agent/__fixtures__/utf8-split.sse
    - apps/api/src/routes/tokens/__fixtures__/assemblyai-v3-token-response.json
    - apps/api/src/routes/tokens/__fixtures__/deepgram-grant-token-response.json
    - apps/api/src/routes/tokens/__fixtures__/openai-client-secret-response.json
    - apps/api/src/lib/sse-parser.test.ts
    - apps/api/src/lib/tool-call-accumulator.test.ts
    - tests/e2e/mock-realtime/package.json
    - tests/e2e/mock-realtime/tsconfig.json
    - tests/e2e/mock-realtime/server.ts
    - tests/spikes/04-provider-shapes.md
    - tools/spike/capture-sse-fixtures.sh
  modified:
    - compose/traefik/dynamic.yml
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
decisions:
  - "Hand-author 6 of 7 SSE fixtures because LiteLLM mock_response cannot emit OpenAI streaming tool_calls deltas, premature closes, or malformed payloads — plan explicitly permits this fallback with `# source: hand-authored` attribution"
  - "All 3 provider fixtures fall back to documented shape (Verified: no) — no API keys available in worktree; future contributor with keys re-runs spike per re-verify commands and overwrites with sanitized real captures"
  - "Set msgpackr-extract allowBuilds:false to make pnpm install deterministic; was the only blocker preventing RED-state confirmation via vitest"
metrics:
  duration: ~10m
  tasks_completed: 3
  files_created: 17
  files_modified: 3
  commits: 3
  completed_date: 2026-05-10
---

# Phase 04 Plan 01: Wave-0 Fixtures + Test Scaffolding Summary

Captured the seven LiteLLM SSE fixture shapes, three provider token-mint
response fixtures, the mock-realtime workspace package skeleton, the two
RED test stubs that turn GREEN in Wave 1, and the Traefik dynamic.yml
placeholder marker — eliminating "I don't know what the upstream actually
emits" risk before TDD red→green starts on Wave 1.

## Fixture Inventory

### SSE corpus — `apps/api/src/routes/agent/__fixtures__/` (7 files)

| Fixture | Source | Notes |
|---------|--------|-------|
| `text-only.sse` | hand-authored | Mirrors mock-LiteLLM qwen3.6-plus mock_response shape; multi-token + usage chunk + `[DONE]` |
| `single-tool-call.sse` | hand-authored | `{"location":"Paris,FR"}` arguments split across 5 deltas; finish_reason=tool_calls |
| `multi-tool-call.sse` | hand-authored | Two functions (get_weather index:0, get_time index:1) with interleaved arguments deltas |
| `text-then-tool.sse` | hand-authored | LiteLLM#17246 shape — text preamble then tool_calls delta |
| `premature-close.sse` | hand-authored | Ends mid-frame (`"partial`); no `[DONE]`, no terminating `\n\n` |
| `malformed-payload.sse` | hand-authored | `data: {invalid json here}` between two valid frames |
| `utf8-split.sse` | hand-authored | Header line `# split-at-byte: 685` records byte offset where the 4-byte 🎉 (`F0 9F 8E 89`) lives so tests can slice the buffer mid-codepoint |

A capture script (`tools/spike/capture-sse-fixtures.sh`) is committed for
the one fixture (`text-only.sse`) that mock-LiteLLM CAN regenerate live;
the other six are static because mock_response cannot emit them.

### Provider corpus — `apps/api/src/routes/tokens/__fixtures__/` (3 files)

| Fixture | Field | Verified | Notes |
|---------|-------|----------|-------|
| `assemblyai-v3-token-response.json` | `token` | no — fallback | `ASSEMBLYAI_API_KEY` unset; documented per D-14 |
| `deepgram-grant-token-response.json` | `access_token` | no — fallback | `DEEPGRAM_API_KEY` unset; `expires_in: 30` per D-15 |
| `openai-client-secret-response.json` | `value` | no — fallback | `OPENAI_API_KEY` unset; `value: ek_...` per D-16 |

All token strings sanitized to `<REDACTED-...>` placeholders. Key-leak
scan (`grep -rE 'sk-[A-Za-z0-9]{20,}|asm_[A-Za-z0-9]{20,}'`) returns no
matches.

### Spike doc — `tests/spikes/04-provider-shapes.md`

Documents per-provider request method, URL, headers, body, response shape,
confirmed token field name, observed TTL, date verified, and re-verify
shell command. Future contributor with API keys reruns the curl snippets
and overwrites the JSON fixtures.

## RED Test Confirmation

```text
$ pnpm --filter @openwhispr/api test src/lib/sse-parser.test.ts --run
...
 FAIL  src/lib/sse-parser.test.ts [ src/lib/sse-parser.test.ts ]
Error: Cannot find module './sse-parser.js' imported from
       apps/api/src/lib/sse-parser.test.ts
 Test Files  1 failed (1)
Exit status 1
```

Exactly the canonical TDD RED state — module-not-found at import. Wave 1
plan 04-02 lands `apps/api/src/lib/sse-parser.ts` and
`apps/api/src/lib/tool-call-accumulator.ts` and turns these tests GREEN.

`tool-call-accumulator.test.ts` ships 5 `it()` blocks per acceptance:
single tool, multi tool, malformed-args, missing-name silent skip, and
finish_reason==='stop' with pending state.

## Mock-Realtime Skeleton

`tests/e2e/mock-realtime/` is a new workspace package
(`@openwhispr/mock-realtime`) with `package.json` (declaring `fastify` +
`@fastify/websocket`), a workspace-base-extending `tsconfig.json`, and a
`server.ts` whose default export throws `not implemented — Wave 2 (plan
04-06) lands the hermetic mock-realtime WS server`. Purpose in Wave 0: make
the package resolvable from Wave 1 / Wave 3 imports without
`Cannot find module` noise. Wave 2 turns the stub into the real
~50-LoC OpenAI-Realtime-protocol-speaking WS server per CONTEXT D-22.

`pnpm-workspace.yaml` was extended to register the new package; pnpm
install also exposed an `msgpackr-extract` allowBuilds prompt that was
pinned to `false` (deterministic install — no native build, only a
JS-fallback path is consumed by our deps).

## Traefik dynamic.yml Marker

Appended a `# Phase 04 placeholder` one-line comment to
`compose/traefik/dynamic.yml`. Wave 1 plan 04-04 will replace
`api-realtime.entryPoints: [websecure]` with `[websecure-realtime]` and add
the dedicated `:8443` entrypoint per CONTEXT D-21 — but that mechanical
edit is out of Wave 0 scope.

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `e12be4c` | test(04-01): capture LiteLLM SSE fixture corpus (7 shapes) |
| 2 | `8e7d3ed` | test(04-01): record provider token-mint response fixtures + spike doc |
| 3 | `1565290` | test(04-01): mock-realtime skeleton + RED test stubs + traefik marker |

## Deviations from Plan

None of substance — every action mapped 1:1 to a `<task>` block.

Two minor in-scope adjustments:

1. **pnpm install required `msgpackr-extract` allowBuilds disposition.**
   Verifying RED-state via `pnpm --filter @openwhispr/api test ...`
   triggered `dependencies-not-built-yet`; pnpm 11 surfaces a
   `set this to true or false` placeholder in `pnpm-workspace.yaml`. Pinned
   to `false` (the package only needs its JS fallback path; no native
   build required). Tracked under Task 3's commit. **Rule 3 — auto-fixed
   blocking issue.** Not architectural.

2. **All three provider fixtures `Verified: no`.** Plan explicitly accepts
   this fallback with `# unverified` markers when keys are unavailable;
   no deviation. Future contributor with keys regenerates per the
   re-verify commands in `tests/spikes/04-provider-shapes.md`.

## Authentication Gates

None. No external services contacted. Provider key absence handled per
plan's documented fallback path.

## Known Stubs

- `tests/e2e/mock-realtime/server.ts` — intentional stub per Task 3
  (Wave 2 plan 04-06 implements). Calling the default export throws
  loudly so accidental early use surfaces immediately. Documented in
  the SKILL header comment block of the file itself.

## Threat Flags

None. Wave 0 introduces no new network endpoints, auth paths, file access
patterns, or trust-boundary schema changes. The threat register's only
`mitigate` disposition for this wave (T-04-W0-01 — provider key leak in
fixtures) is closed by the `<REDACTED-...>` sanitization in Task 2 and
verified by the post-commit grep for `sk-/asm_` patterns (no matches).

## Verification

- `ls apps/api/src/routes/agent/__fixtures__/*.sse | wc -l` → 7 ✅
- `ls apps/api/src/routes/tokens/__fixtures__/*.json | wc -l` → 3 ✅
- `test -f tests/spikes/04-provider-shapes.md` → ok ✅
- `pnpm --filter @openwhispr/api test src/lib/sse-parser.test.ts --run`
  → exit 1, `Cannot find module './sse-parser.js'` ✅ (RED)
- `grep -rE 'sk-[A-Za-z0-9]{20,}|asm_[A-Za-z0-9]{20,}' apps/api/src/routes/tokens/__fixtures__/`
  → no matches ✅
- `grep -q 'Phase 04 placeholder' compose/traefik/dynamic.yml` → ok ✅

## Self-Check: PASSED

All claimed files present:
- FOUND: apps/api/src/routes/agent/__fixtures__/text-only.sse
- FOUND: apps/api/src/routes/agent/__fixtures__/single-tool-call.sse
- FOUND: apps/api/src/routes/agent/__fixtures__/multi-tool-call.sse
- FOUND: apps/api/src/routes/agent/__fixtures__/text-then-tool.sse
- FOUND: apps/api/src/routes/agent/__fixtures__/premature-close.sse
- FOUND: apps/api/src/routes/agent/__fixtures__/malformed-payload.sse
- FOUND: apps/api/src/routes/agent/__fixtures__/utf8-split.sse
- FOUND: apps/api/src/routes/tokens/__fixtures__/assemblyai-v3-token-response.json
- FOUND: apps/api/src/routes/tokens/__fixtures__/deepgram-grant-token-response.json
- FOUND: apps/api/src/routes/tokens/__fixtures__/openai-client-secret-response.json
- FOUND: apps/api/src/lib/sse-parser.test.ts
- FOUND: apps/api/src/lib/tool-call-accumulator.test.ts
- FOUND: tests/e2e/mock-realtime/package.json
- FOUND: tests/e2e/mock-realtime/tsconfig.json
- FOUND: tests/e2e/mock-realtime/server.ts
- FOUND: tests/spikes/04-provider-shapes.md
- FOUND: tools/spike/capture-sse-fixtures.sh

All claimed commits present:
- FOUND: e12be4c (Task 1)
- FOUND: 8e7d3ed (Task 2)
- FOUND: 1565290 (Task 3)
