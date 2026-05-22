---
slug: r32-agent-stream-chunk-vocab
date: 2026-05-22
status: complete
commit: [11b0f858]
---

# R32 — /api/agent/stream NDJSON chunk-vocab mismatch — Summary

## Problem

Client-filed HIGH blocker: cloud chat returned a response but the chat
window stayed empty on every message in a corporate build. The
immutable desktop client's cloud stream consumer
(`ReasoningService.processTextStreamingCloud`) strictly filters NDJSON
chunks on `type === "content"` / `"tool_call"` and treats
`type === "done"` as the terminal marker. The server emitted the
v3-era Vercel-AI-SDK vocabulary `text-delta` / `tool-call` / `finish` —
matching none of those filters — so every chunk was silently dropped.

The NDJSON framing itself was correct (verified live). The bug was the
chunk `type` *values*. The client is immutable and defines the
contract; `docs/wire-contract.md`'s "v3-era chunk vocab" line was the
stale doc.

## Fix (`11b0f858`)

- `apps/api/src/lib/sse-parser.ts` — `StreamChunk`: `text-delta` →
  `content`, `finish` → `done`; the `tool-result` union member removed
  (tools execute client-side; the server never emits tool-result on the
  wire). `translateChunk` emits the new types.
- `apps/api/src/lib/tool-call-accumulator.ts` — `ToolCallChunk`:
  `tool-call` → `tool_call`; fields `toolCallId`/`toolName`/`args` →
  `id`/`name`/`arguments`. `arguments` is now the raw accumulated JSON
  **string** forwarded verbatim (default `"{}"`), not a parsed object —
  the client does its own `JSON.parse`. `parseArgsOrFallback` dropped.
- `apps/api/src/routes/agent/stream.ts` — route-synthesized terminal
  chunks (`endWithFinish`, mid-stream `stream_error`) emit `type:"done"`.
- `docs/wire-contract.md` — `/api/agent/stream` row corrected.

## Tests (RED → GREEN, same commit)

`sse-parser.test.ts`, `tool-call-accumulator.test.ts`,
`stream.test.ts` — vocab assertions updated to the client contract.
`tool-call-accumulator.test.ts` Test 3 reframed from
parsed-object-fallback to raw-string-passthrough. The exact
`tool_call.arguments` strings were captured by draining the live
fixtures (`/tmp/r32probe.mjs`), not guessed. RED: 24 failed pre-fix.
GREEN: all three files pass.

## Verification

- `sse-parser.test.ts` + `tool-call-accumulator.test.ts`: exit 0.
- `stream.test.ts`: all stream tests green (5 unrelated pre-existing
  baseline failures — `auth-locale`, `boot-order`, `test-only`,
  `i18n-completeness`, `plan-52-06-zod-drift` — confirmed failing on
  `e3913d3f` before any of today's work, via a baseline worktree).
- Lockers clean (no-suppressions, no-hardcode, no-env-branches).
- `tsc --noEmit` (api): 5 pre-existing baseline errors, zero new.
- `docker compose up -d --build api` → healthy.
- Live: `POST /api/agent/stream {"messages":[...],"model":null}` →
  `{"type":"content","text":"Hi"}` … `{"type":"done","finishReason":
  "stop",...}` — exactly the vocab the client consumer filters on.

## Follow-up

Client agent (peer `tcpsycot`) notified: R32 server-side closed, SHA
`11b0f858`; cloud chat no longer empty. Client is immutable — zero
client changes (the consumer was always correct; the server vocab was
wrong).

## Self-Check: PASSED

- `11b0f858` on HEAD — confirmed via git log.
- All three test files re-run, results read directly.
- api rebuilt; live curl output observed directly.
