---
phase: 04
plan: 02
subsystem: streaming-realtime
tags: [tdd, sse, ndjson, tool-calls, parser, accumulator]
requires:
  - .planning/phases/04-streaming-realtime/04-01-SUMMARY.md (Wave 0 fixtures + RED stubs)
  - .planning/phases/04-streaming-realtime/04-CONTEXT.md (D-01, D-02, D-06, D-09)
  - .planning/phases/04-streaming-realtime/04-RESEARCH.md (§2.1, §2.4)
  - apps/api/src/routes/agent/__fixtures__/*.sse (7 SSE shapes from 04-01)
provides:
  - apps/api/src/lib/sse-parser.ts (pure SSE→NDJSON async generator)
  - apps/api/src/lib/tool-call-accumulator.ts (pure tool-call delta state machine)
affects:
  - apps/api/src/lib/sse-parser.test.ts (Wave 0 stub → 12 GREEN behavior tests)
  - apps/api/src/lib/tool-call-accumulator.test.ts (Wave 0 stub → 8 GREEN behavior tests)
tech-stack:
  added: []
  patterns:
    - "Hand-rolled async generator over ReadableStream<Uint8Array> with `\\n\\n` SSE framing"
    - "TextDecoder({stream:true}) for incremental UTF-8 decoding across read boundaries"
    - "Pure state machine accumulating delta.tool_calls[].function.arguments fragments by index"
    - "JSON.parse-validate-then-forward pattern for upstream-trust-boundary tampering mitigation"
key-files:
  created:
    - apps/api/src/lib/sse-parser.ts
    - apps/api/src/lib/tool-call-accumulator.ts
  modified:
    - apps/api/src/lib/sse-parser.test.ts
    - apps/api/src/lib/tool-call-accumulator.test.ts
decisions:
  - "Inject ToolCallAccumulator into SseToNdjsonInput rather than constructing internally — keeps the parser composable + lets the route handler reuse the accumulator instance to inspect hasPending() after the stream closes (T-04-03 / LiteLLM#17246 mitigation)"
  - "On finish_reason='stop' with pending accumulator state, the parser emits ONLY the finish chunk — partial tool-calls are intentionally dropped, not flushed; caller observes acc.hasPending() to decide whether to log the provider anomaly"
  - "Parser synthesizes a finish(incomplete, zero-usage) chunk when the upstream closes without [DONE] (premature-close.sse) so the desktop NDJSON consumer never hangs on a half-open stream"
  - "Malformed `data:` payloads are silently dropped (T-04-03 mitigation: untrusted upstream cannot poison downstream NDJSON); the surrounding valid frames continue to drain"
  - "id fallback `tc_<index>` in the accumulator covers the rare provider-bug case where a tool_call delta arrives without an id field"
metrics:
  duration: ~7m
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  commits: 2
  completed_date: 2026-05-10
---

# Phase 04 Plan 02: SSE → NDJSON Parser + Tool-Call Accumulator Summary

Turned Wave 0 RED stubs GREEN by landing the two pure utilities Wave 2
plan 04-05 will compose into the `/api/agent/stream` route: a
framework-free SSE→NDJSON async generator and a tool-call delta state
machine, both at ≥90/90/90/90 coverage on all four axes.

## Coverage Report (per-file, all four axes)

| File | Statements | Branches | Functions | Lines |
|------|-----------:|---------:|----------:|------:|
| `apps/api/src/lib/sse-parser.ts` | **100%** | **96.87%** | **100%** | **100%** |
| `apps/api/src/lib/tool-call-accumulator.ts` | **100%** | **93.75%** | **100%** | **100%** |

Verification command (run from repo root):

```bash
pnpm --filter @openwhispr/api test \
  src/lib/sse-parser.test.ts \
  src/lib/tool-call-accumulator.test.ts \
  --run --coverage
# → Test Files  2 passed (2)
# → Tests       20 passed (20)
```

## Test Outcomes

### `tool-call-accumulator.test.ts` — 8 tests, all GREEN

| # | Behavior |
|---|----------|
| 1 | Single tool call across 5 deltas → one consolidated chunk with parsed args |
| 2 | Two tool calls (interleaved indexes) → two chunks in ascending index order |
| 3 | Malformed args JSON → chunk with `args: { __unparsed: <raw> }` (no throw) |
| 4 | Missing function.name → silently skipped (other valid index still emitted) |
| 5 | `hasPending()` true while non-empty, false after `flush()` |
| 6 | finish_reason='stop' safety — caller may flush partial; subsequent state cleared |
| 7 | id fallback uses `tc_<index>` when no id was ever provided |
| 8 | (branch coverage) tolerates deltas with no tool_calls / empty function block |

### `sse-parser.test.ts` — 12 tests, all GREEN (7 fixtures + 5 synthetic)

| Source | Test |
|--------|------|
| `text-only.sse` | 7 text-deltas + finish(stop) with usage; halts at [DONE] |
| `single-tool-call.sse` | 0 text-deltas, 1 consolidated tool-call, finish(tool_calls) |
| `multi-tool-call.sse` | 2 tool-calls in ascending index order before finish |
| `text-then-tool.sse` | text-deltas precede tool-call; LiteLLM#17246 shape preserved |
| `premature-close.sse` | partial deltas + synthetic finish(incomplete); does NOT throw |
| `malformed-payload.sse` | malformed frame skipped; surrounding valid frames drain |
| `utf8-split.sse` | 🎉 intact when buffer split mid-codepoint at byte 685 (between 9F and 8E) |
| (synthetic) | finish_reason=stop without usage → zero-usage finish |
| (synthetic) | comment-only frame (no `data: ` line) ignored |
| (synthetic) | chunk lacking choices[0] entry tolerated |
| (synthetic) | finish_reason=tool_calls without usage → zero-usage tool-call finish |
| (synthetic) | choice with no delta field tolerated |

## Atomic-Commit-per-Task Confirmation

| Task | Commit | Production + Test in same commit? |
|------|--------|-----------------------------------|
| 1 (accumulator) | `e44fde5` | YES — `tool-call-accumulator.ts` + `tool-call-accumulator.test.ts` |
| 2 (sse-parser) | `c0032e6` | YES — `sse-parser.ts` + `sse-parser.test.ts` |

Verification: `git log e269e0f..HEAD --name-only` shows each commit
contains exactly its production source AND its test source — TDD
constitutional rule (fix + test land together).

## Deviations from Plan

### Auto-fixed during execution

**1. [Rule 3 — blocking] Test-file fixture path resolved via `import.meta.url`, not relative-to-cwd.**
- **Found during:** Task 2 first test run.
- **Issue:** Plan's read_first action used `readFileSync("apps/api/src/routes/agent/__fixtures__/...")` which fails because `pnpm --filter @openwhispr/api test` runs vitest with cwd = `apps/api`, so the leading `apps/api/` doubles up.
- **Fix:** Resolve fixture paths via `dirname(fileURLToPath(import.meta.url))` + `resolve(..., "..", "routes", "agent", "__fixtures__", ...)`. Idiomatic NodeNext/ESM, identical behavior on CI and locally.
- **Files modified:** `apps/api/src/lib/sse-parser.test.ts` (test-only).
- **Commit:** `c0032e6`.

**2. [Rule 2 — missing critical functionality] Added 5 synthetic in-line stream tests for branch coverage, beyond the 7 fixture tests.**
- **Found during:** Task 2 coverage check (95.65% branches before, 96.87% after).
- **Issue:** Several reachable branches in the parser are unreachable from the existing fixture corpus — finish_reason without usage field, comment-only frames, choices with no delta, choices array empty, tool_calls finish without usage. Plan's coverage gate is ≥90/90/90/90 on all four axes; without these tests branches sat at 75%.
- **Fix:** Added 5 synthetic stream tests using inline SSE strings (no new fixtures). Each targets a specific reachable branch.
- **Files modified:** `apps/api/src/lib/sse-parser.test.ts` (test-only).
- **Commit:** `c0032e6`.
- **Same approach for accumulator:** added 1 branch-coverage test (`tolerates deltas with no tool_calls`) lifting branches 87.5% → 93.75%. Commit `e44fde5`.

### Architectural / decision

None — both tasks executed as written. The interfaces in `04-02-PLAN.md`
(`StreamChunk`, `SseToNdjsonInput`, `ToolCallAccumulator`) are emitted
verbatim and re-exported from the production source files; Wave 2 plan
04-05 can `import { sseToNdjson, createToolCallAccumulator }` directly.

## Authentication Gates

None. Pure unit work — no network, no auth, no external services.

## Known Stubs

None. Both modules are complete production implementations.

## Threat Flags

None. The two new files exist entirely behind the existing trust
boundary established in 04-01's threat register; no new network surface,
no new auth path, no new schema. The `T-04-03` (Tampering on
LiteLLM-upstream → sseToNdjson) `mitigate` disposition is now closed:

- Every `data:` payload is `JSON.parse`-validated; failures drop the
  frame silently (verified by `malformed-payload.sse` test).
- finish_reason='stop' with pending accumulator state never flushes
  partials (verified by accumulator Test 6 + sse-parser branch test).

## Verification

```bash
# 20 tests pass
pnpm --filter @openwhispr/api test \
  src/lib/sse-parser.test.ts \
  src/lib/tool-call-accumulator.test.ts \
  --run
# → Test Files  2 passed (2)
# → Tests       20 passed (20)

# Coverage on the two new files at ≥90/90/90/90 across all axes
pnpm --filter @openwhispr/api test \
  src/lib/sse-parser.test.ts \
  src/lib/tool-call-accumulator.test.ts \
  --run --coverage 2>&1 | grep -E '(sse-parser|tool-call-accumulator)\.ts'
# → sse-parser.ts             | 100  | 96.87 | 100 | 100
# → tool-call-accumulator.ts  | 100  | 93.75 | 100 | 100

# Atomic commits — production + test in the SAME commit per TDD rule
git log e269e0f..HEAD --name-only
# → e44fde5 tool-call-accumulator.{ts,test.ts}
# → c0032e6 sse-parser.{ts,test.ts}
```

## Self-Check: PASSED

All claimed files present:
- FOUND: apps/api/src/lib/sse-parser.ts
- FOUND: apps/api/src/lib/sse-parser.test.ts
- FOUND: apps/api/src/lib/tool-call-accumulator.ts
- FOUND: apps/api/src/lib/tool-call-accumulator.test.ts

All claimed commits present:
- FOUND: e44fde5 (Task 1)
- FOUND: c0032e6 (Task 2)
