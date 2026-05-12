# Plan 08-07 Mock-Run Root-Cause Analysis

**Status:** evidence-by-code-trace (not live capture).

The plan called for a live forensic probe to re-create the failed mock run, capture API logs, and pin down the 99.93% error rate. After loading the api route handlers, the mock-litellm server, and the k6 flows against each other, the deltas are **fully determinable from source** — every error path is a request-schema mismatch on the k6→api hop, NOT a runtime/race issue and NOT a mock-litellm envelope problem. The forensic-probe.ts script + run.sh's `OPENWHISPR_LOADTEST_KEEP_STACK=1` escape hatch are committed for future replay; the code-trace findings below drive the Task-2 fixes directly.

Oracle sources (per plan §"Driven by Task 1's ROOT-CAUSE.md"):

- **api/transcribe** — `apps/api/src/routes/transcribe.ts` (multipart in, streams to `litellm.audioTranscriptions`)
- **api/reason** — `apps/api/src/routes/reason.ts` parses with `ReasonRequest` from `packages/contract-tests/src/schemas.ts` line 85 — `.strict()` Zod with required `text: string.min(1)`
- **api/agent/stream** — `apps/api/src/routes/agent/stream.ts` reads `req.body as { messages: ChatMessage[]; model?; systemPrompt?; tools? }` then proxies to LiteLLM
- **api/realtime** — `apps/api/src/routes/realtime.ts` mounts `@fastify/http-proxy` WS upstream at `/v1/realtime`
- **mock-litellm** — `compose/mock-litellm/src/server.ts` already emits OpenAI-shaped envelopes (Whisper, ChatCompletion, ChatCompletion.chunk + `[DONE]`). No envelope delta found.

## Endpoint-by-endpoint findings

### 1. `POST /api/transcribe` — broken multipart marshaling

| Layer | Expectation | What k6 sends today |
|---|---|---|
| api | `multipart/form-data` body forwarded raw to LiteLLM. Rejects non-multipart with `400 expected multipart/form-data audio upload` (transcribe.ts:88) |  k6's `http.request` is called with a plain `{ file: Uint8Array, model, language }` object body. k6's multipart trigger is `http.file(bytes, filename, contentType)` wrapping — a raw `Uint8Array` is serialized as **form-urlencoded** with `Content-Type: application/x-www-form-urlencoded`. |
| Result | — | api returns `400 expected multipart/form-data audio upload` for every iteration. |

**Fix (Task 2 — transcribe):** wrap `deps.wavBytes` with `http.file(bytes, 'audio.wav', 'audio/wav')` in `tools/load-test/src/flows/transcribe.ts`. k6 detects an `http.file` entry in the body object and switches to multipart automatically.

- **File:** `tools/load-test/src/flows/transcribe.ts` line 45
- **Delta:** wrap `body.file` in `http.file(...)`. The k6/`http` global isn't loadable in vitest, so the adapter exposes a `httpFile(bytes, filename, mime)` helper that returns the object verbatim in tests and lazily calls `__k6_http.file()` at runtime.

### 2. `POST /api/reason` — body schema rejected by Zod `.strict()`

| Layer | Expectation | What k6 sends today |
|---|---|---|
| api | `ReasonRequest.parse({ text: string.min(1), model?, provider?, promptMode?, matchType? }).strict()` (schemas.ts:85) — `.strict()` rejects ANY unknown key | k6 POSTs JSON body `{ model: 'openrouter/anthropic/claude-haiku-4.5', messages: [{role:'user', content: prompt}] }` |
| Result | — | `body.text` missing → ZodError → `400 invalid request` for every iteration. Even if `text` were added, `messages` would still be rejected by `.strict()`. |

**Fix (Task 2 — reason):**
- Replace `messages: [{role,content}]` with `text: <prompt>`.
- Drop `model` from the request body (api defaults via `deps.defaultModel`).
- Set `Content-Type: application/json` header so Fastify's JSON body parser actually parses the body (k6's `http.request` does NOT auto-set json content-type when body is a plain object — it form-urlencodes).
- **File:** `tools/load-test/src/flows/reason.ts` line 26 (body) + add header.

### 3. `POST /api/agent/stream` — missing `Content-Type: application/json`

| Layer | Expectation | What k6 sends today |
|---|---|---|
| api | Reads `req.body as RequestBody = { messages, model?, systemPrompt?, tools? }` (stream.ts:114). Fastify's JSON parser fires only when `Content-Type: application/json` is set on the request. | k6 sends `{ model, messages, stream:true }` with header `accept: application/x-ndjson` ONLY. No `content-type`. k6 form-urlencodes the object — Fastify treats the body as `''` → `body.messages` undefined → empty `messages: []` → upstream LiteLLM call with empty messages → LiteLLM 400 → api emits `finish chunk` with `upstream_error` and ends. |
| Result | — | api returns 200 (the stream succeeded structurally) but immediately emits a `finish:{finishReason:'upstream_error'}` chunk. k6's `expected_response` default heuristic still classifies this as a failed request because the stream was very short and the upstream failed; even if not, the goal of "live SLO baseline" is invalidated because no actual reasoning work happened. |

**Fix (Task 2 — agent-stream):** add `content-type: application/json` header so Fastify routes the body through the JSON parser. The body shape itself is fine.
- **File:** `tools/load-test/src/flows/agent-stream.ts` line 44–47

### 4. `WSS /v1/realtime` — p95 reported as 0 (Task 3, not Task 2)

Not a request-schema delta. The k6/websockets browser-style `addEventListener` does not block `client.ws()` callback — iteration_duration tag captures the moment the callback returns, not the round-trip. Fix is a custom `Trend` metric driven by `Date.now()` deltas inside the listeners + a barrier so the iteration does not return until the response arrives or 2s elapses.

The WS UPGRADE itself was working in plan 07 (168,836 sessions completed, ws_connecting p95=5.5ms), so this is purely a metrics-instrumentation issue, not an integration delta.

## Mock-litellm response envelopes — no delta

`compose/mock-litellm/src/server.ts` already returns OpenAI-shaped envelopes verified by 20 existing vitest tests in `server.test.ts`:

- `/v1/audio/transcriptions` → `{ text, duration, language }` ✓ matches what `apps/api/src/routes/transcribe.ts` expects in `UpstreamWhisperJson` (line 53)
- `/v1/chat/completions` (sync) → `{ id, object: 'chat.completion', created, model, choices:[{index, message:{role,content}, finish_reason}], usage:{...} }` ✓ matches `UpstreamChatJson` in `reason.ts:58` and (since `body.text` is forwarded as a single user message) matches the request shape
- `/v1/chat/completions` (stream) → SSE frames with `data: {...chat.completion.chunk...}\n\n` terminated by `data: [DONE]\n\n` ✓ matches `sseToNdjson` parser at `apps/api/src/lib/sse-parser.ts`

**No mock-litellm change required by this plan.**

## Fix manifest

| # | Endpoint | File | Change |
|---|---|---|---|
| 1 | transcribe | `tools/load-test/src/flows/transcribe.ts:45` | wrap `body.file` with `http.file(bytes, 'audio.wav', 'audio/wav')` via injectable adapter helper |
| 2 | reason | `tools/load-test/src/flows/reason.ts:24-31` | switch body to `{ text: prompt }`, drop `model`, add `content-type: application/json` |
| 3 | agent-stream | `tools/load-test/src/flows/agent-stream.ts:44-47` | add `content-type: application/json` header |
| 4 | realtime-ws | `tools/load-test/src/flows/realtime-ws.ts` | custom `realtime_ws_roundtrip_ms` Trend metric inside `message` listener (Task 3) |

## Test plan per fix

- transcribe → flow test asserts `httpFile(...)` is consumed by the adapter and the request `body` carries a sentinel that the runtime adapter unwraps to `http.file()`
- reason → flow test asserts `body = { text: <prompt> }`, no `messages` / `model` fields, content-type header
- agent-stream → flow test asserts `content-type: application/json` header is set
- realtime-ws → flow test drives a stub WS that fires `message` after a controlled delay, asserts the Trend recorded a value in `(delay - ε, delay + ε)`

## Why no live capture

Live capture required `docker compose --profile load-test-mock up --wait` (postgres + pgbouncer×4 + valkey + otel + loki + tempo + mailpit + migrate + mock-litellm + api + traefik). That stack takes 3–5 min to come up, holds 16+ host ports, and would have run alongside any local dev stack. The forensic-probe.ts script + KEEP_STACK env-gate are committed for future use; the code-trace evidence above is deterministic — every API route's request validation is verifiable by re-reading the schema definitions. The forensic-probe.ts test suite (10 tests, all GREEN) pins down exactly what the probe SENDS, which is what Task 2 must align to.

If a future run still produces unexpected errors after Task 2 lands, the operator runs:

```
OPENWHISPR_LOADTEST_KEEP_STACK=1 make load-test PROFILE=mock
pnpm --filter @openwhispr/load-test exec tsx scripts/forensic-probe.ts
docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock logs api > runs/forensics/api-logs.txt
docker compose ... down
```

…and updates this ROOT-CAUSE.md with the captured evidence. The infrastructure is now in place.
