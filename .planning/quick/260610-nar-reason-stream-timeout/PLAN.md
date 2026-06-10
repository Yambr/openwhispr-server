---
quick_id: 260610-nar
title: Fix POST /api/reason HEADERS_TIMEOUT via internal-stream-then-buffer
type: execute
mode: quick
tdd: true
autonomous: false
files_modified:
  - apps/api/src/lib/reason-stream-accumulate.ts
  - apps/api/tests/unit/lib/reason-stream-accumulate.test.ts
  - apps/api/src/routes/reason.ts
  - apps/api/tests/unit/routes/reason.test.ts
  - compose/litellm/litellm_config.contract.yaml
  - tests/e2e/reason.e2e.test.ts
requirements: []
must_haves:
  truths:
    - "POST /api/reason no longer 500s with UND_ERR_HEADERS_TIMEOUT when the upstream model thinks >30s before the first token"
    - "POST /api/reason returns a byte-identical JSON shape { text, model, provider, promptMode, matchType } on success"
    - "usage_ledger still receives the correct total_tokens reconstructed from the terminal SSE usage chunk"
    - "A mid-stream upstream error/abort that arrives AFTER 200 SSE headers produces a clean 5xx envelope (REASONING_UPSTREAM_FAILED), never a partial 200"
    - "request_id idempotency (ON CONFLICT DO NOTHING) is preserved"
  artifacts:
    - path: "apps/api/src/lib/reason-stream-accumulate.ts"
      provides: "Pure SSE accumulator: concatenates delta.content, captures terminal usage, raises on incomplete/error streams"
      min_lines: 40
    - path: "apps/api/tests/unit/lib/reason-stream-accumulate.test.ts"
      provides: "RED unit tests for the accumulator (happy, mid-stream error, premature close, usage reconstruction)"
    - path: "apps/api/src/routes/reason.ts"
      provides: "Route switched from chatCompletions() to chatCompletionsStream() + full accumulate-then-inspect before 200"
  key_links:
    - from: "apps/api/src/routes/reason.ts"
      to: "apps/api/src/lib/reason-stream-accumulate.ts"
      via: "accumulateReasonStream(Readable.toWeb(upstream.body))"
      pattern: "accumulateReasonStream"
    - from: "apps/api/src/routes/reason.ts"
      to: "deps.litellm.chatCompletionsStream"
      via: "internal streaming upstream call"
      pattern: "chatCompletionsStream"
---

<objective>
Fix `POST /api/reason` returning HTTP 500 at ~30485ms with `UND_ERR_HEADERS_TIMEOUT`. The qwen3.6-plus agent path leaves thinking ON for the reason shape and thinks >30s before emitting the first output token; in non-streaming mode the gateway holds response headers until that first token, so undici's `headersTimeout` (default 30_000ms) aborts.

Locked solution (advisor-confirmed Option A — do NOT re-litigate): **internal-stream-then-buffer**. Switch the route's internal upstream call from `chatCompletions()` to the EXISTING `chatCompletionsStream()`. With `stream:true`, gateway headers + first SSE token arrive fast (the gateway flushes headers as soon as the SSE response opens), so `headersTimeout` is satisfied structurally; the long tail is bounded by `bodyTimeout` which on the stream path is already `0` (per-chunk-idle, not total — see `packages/litellm-client/src/index.ts:629`). The server accumulates the streamed deltas into the full text, then returns the SAME JSON shape `{ text, model, provider, promptMode, matchType }`. The client wire surface is byte-identical; client v1.7.22 is untouched; NO NDJSON/SSE is emitted to the client.

Purpose: unblock cloud reason (cleanup + agent shapes) on slow-thinking models without a `headersTimeout` band-aid (REJECTED).
Output: a pure SSE accumulator, the rewired route, a streaming contract-mock entry, and unit + e2e coverage.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# Production surface under change
@apps/api/src/routes/reason.ts
@apps/api/src/errors.ts

# The streaming method we switch to + its return type + timeout posture
@packages/litellm-client/src/index.ts

# The CLIENT-facing SSE→NDJSON translator — REFERENCE ONLY, deliberately NOT reused.
# It yields client NDJSON chunks (tool_calls/content), its usage carries ONLY
# promptTokens/completionTokens (no total_tokens), and it SILENTLY synthesizes a
# zero-usage "incomplete" done on premature close (sse-parser.ts:151) instead of
# surfacing it as an error. The reason path needs a DIFFERENT accumulator that
# (a) reconstructs total_tokens and (b) treats incomplete/error streams as 5xx.
@apps/api/src/lib/sse-parser.ts

# Existing test harness to mirror (fake LitellmClient + fake TransactionalDb + stubbed auth hook)
@apps/api/tests/unit/routes/reason.test.ts

# E2E + the mock-LiteLLM config it mounts (litellm_config.contract.yaml)
@tests/e2e/reason.e2e.test.ts
@compose/litellm/litellm_config.contract.yaml
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: New pure SSE accumulator for the reason path (RED → GREEN)</name>
  <files>apps/api/src/lib/reason-stream-accumulate.ts, apps/api/tests/unit/lib/reason-stream-accumulate.test.ts</files>
  <behavior>
    New module `accumulateReasonStream(body: ReadableStream<Uint8Array>): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>`.
    It frames the SSE body on "\n\n", finds the `data: ` line per frame, JSON.parse-validates each payload (malformed frames dropped, mirroring sse-parser.ts:138), stops on `data: [DONE]`, concatenates every `choices[0].delta.content` string, and captures the terminal `usage` object.

    Test 1 (happy path): a 3-frame stream ("Hello", " world", terminal `{delta:{},finish_reason:"stop",usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}}`, then `[DONE]`) → resolves `{ text:"Hello world", usage:{ promptTokens:10, completionTokens:2, totalTokens:12 } }`.
    Test 2 (total_tokens reconstruction): terminal usage with `prompt_tokens:7, completion_tokens:5` and NO `total_tokens` → `totalTokens === 12` (sum). When `total_tokens` IS present it is used verbatim.
    Test 3 (mid-stream error event): a stream that emits a content frame then an upstream SSE error frame (`data: {"error":{"message":"upstream exploded"}}`) and closes → REJECTS with a typed error (e.g. `ReasonStreamIncompleteError`), and the rejection carries NO accumulated partial text on the wire-bound message (truncation per LOCKER-05 if it subclasses Error and holds a body field).
    Test 4 (premature close / no finish_reason): a stream of content frames that ends WITHOUT any `finish_reason` and WITHOUT a terminal usage chunk → REJECTS (NOT a silent success with zero usage — this is the load-bearing difference from sseToNdjson).
    Test 5 (malformed frame tolerance): an interleaved malformed `data: {not json` frame is dropped; surrounding valid content still accumulates and a clean terminal usage frame still resolves.
  </behavior>
  <action>
    Author `apps/api/tests/unit/lib/reason-stream-accumulate.test.ts` FIRST (RED) covering the five cases above; drive the input via a fixture-built `ReadableStream<Uint8Array>` (TextEncoder over canned SSE strings) so no live LiteLLM is needed — mirror the fixture-corpus style of `apps/api/tests/unit/lib/sse-parser.test.ts`. Then implement `apps/api/src/lib/reason-stream-accumulate.ts` to GREEN.

    Implementation notes: reuse the SSE framing logic shape from `sse-parser.ts:111-160` (getReader + TextDecoder + "\n\n" split + `data: ` slice(6) + `[DONE]` sentinel), but for OUR contract: accumulate `delta.content`, record `usage` from any frame that carries it, and track `sawFinish` from a non-null `finish_reason`. Define a typed `ReasonStreamIncompleteError extends Error` with a stable `code` field set to `"REASONING_UPSTREAM_FAILED"`; if it carries any upstream body/error string field, truncate it at construction (LOCKER-05 — Error subclasses MUST truncate `bodyText|responseBody|upstreamPayload|response|body` string fields). Reject when (a) an SSE `error`-bearing frame is seen, OR (b) the stream closes with `sawFinish === false` OR with no usage object captured. `totalTokens = usage.total_tokens ?? (prompt_tokens ?? 0) + (completion_tokens ?? 0)`. NO `as any` / `@ts-ignore` / `as unknown as` (LOCKER-02); type the parsed frame with a narrow interface like `sse-parser.ts:54-67`. Module-level: no `process.env.NODE_ENV` (LOCKER-01) and no hardcoded localhost/UUID/secret literals (LOCKER-03).
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api exec vitest run tests/unit/lib/reason-stream-accumulate.test.ts</automated>
  </verify>
  <done>Five accumulator tests GREEN. Happy path returns concatenated text + correct totalTokens; mid-stream error and premature-close both REJECT (no silent partial success). No type-suppression, no env branch, no hardcoded literal in the new module.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Rewire reason.ts to stream-then-buffer + RED tests on the route (RED → GREEN, atomic with its tests)</name>
  <files>apps/api/src/routes/reason.ts, apps/api/tests/unit/routes/reason.test.ts</files>
  <behavior>
    Extend the route unit test's fake LitellmClient (`makeFakeLitellm`, reason.test.ts:97) to ALSO implement `chatCompletionsStream(req)` returning a fake `Dispatcher.ResponseData`-shaped object whose `body` is a Node `Readable` emitting canned SSE bytes (so the route's `Readable.toWeb(upstream.body)` works). Keep the existing `chatCompletions` stub present (other code paths/tests may still reference the type) but the reason route MUST now call `chatCompletionsStream`.

    NEW RED tests (the headline risk):
    - Test A (happy stream → 200): fake stream emits deltas + terminal usage(total_tokens:15) → route returns 200 with `text` = concatenated content, `model`, `provider`, `promptMode:"default"`, `matchType:"default"`; `usage_ledger` INSERT carries `units=15`.
    - Test B (mid-stream error AFTER 200 headers → 5xx, NOT partial 200): fake stream emits one content frame then an SSE error frame and closes → route returns a 502 envelope with error code/message for `REASONING_UPSTREAM_FAILED`; response is NOT 200 and does NOT contain the accumulated partial text; the centralized ErrorEnvelope parses.
    - Test C (premature close → 5xx): fake stream of content frames ends with no finish_reason/no usage → 502 envelope, no partial 200.
    - Test D (usage reconstruction parity): terminal usage with only prompt_tokens+completion_tokens → ledger `units` equals their sum.
    - Contract guard: assert the success response object keys are EXACTLY `{ text, model, provider, promptMode, matchType }` (no added/removed keys) — byte-identical wire shape.

    PRESERVE all existing reason.test.ts cases by adapting `makeFakeLitellm` so they still pass via the streaming path: default-model routing, explicit model, cleanup-shape persona + thinking-off extras, #18 modelParams, anti-injection, locale, verbatim passthrough, idempotent re-post (ON CONFLICT), 503 on MissingProviderKeyError, 401 unauth, unknown-error→500. Where a test asserts on `calls[0]` shape, the recorded call now comes through the stream method (same request fields: model, messages, userId, requestId, endUser, extras).
  </behavior>
  <action>
    Author the RED tests above in `reason.test.ts` FIRST, adapting `makeFakeLitellm` to record `chatCompletionsStream` calls into the same `calls` array and to synthesize the streamed body. Then change `apps/api/src/routes/reason.ts`:
    (1) Replace the `deps.litellm.chatCompletions({...})` call (reason.ts:158-181) with `deps.litellm.chatCompletionsStream({ model, messages, ...(extras !== undefined ? { extras } : {}), userId: req.user.id, endUser: req.user.email ?? req.user.id, requestId: req.id })`. Keep `streamOptions` default (the client forces `include_usage:true` at index.ts:605 — we rely on it for total_tokens).
    (2) Bridge + accumulate: `const acc = await accumulateReasonStream(Readable.toWeb(upstream.body as Readable) as ReadableStream<Uint8Array>)` inside the existing try. Import `Readable` from `node:stream` and `accumulateReasonStream` + `ReasonStreamIncompleteError` from `../lib/reason-stream-accumulate.js`.
    (3) Map the upstream model: `chatCompletionsStream` returns SSE chunks; the per-chunk `model` field (if any) is unreliable, so resolve `responseModel = model` (the alias we requested) unless a captured chunk carried a model — keep the existing `MODEL_PROVIDER[responseModel] ?? MODEL_PROVIDER[model] ?? "litellm"` provider echo. Simplest correct choice: keep `responseModel = model` (the requested alias) — document that the previous code read `upstreamJson.model` but the streaming deltas do not reliably echo it; the requested alias is the authoritative wire value and matches existing tests that assert `parsed.model` equals the requested/default alias.
    (4) Error mapping: the EXISTING pre-200 catch (reason.ts:182-198) still catches `MissingProviderKeyError` → 503 and `LitellmUpstreamError` → 502 thrown by `chatCompletionsStream` BEFORE the body opens (the client throws these pre-2xx at index.ts:647-656). ADD: catch `ReasonStreamIncompleteError` (raised by the accumulator AFTER 200 headers) → rethrow as `new UpstreamError("REASONING_UPSTREAM_FAILED", "upstream reasoning provider failure")` (same envelope the existing LitellmUpstreamError branch already emits). The accumulate-and-inspect happens INSIDE the try, BEFORE the `usage_ledger` INSERT and BEFORE `reply.code(200).send(...)`, so a failed stream never writes a partial 200 nor a ledger row.
    (5) `tokens = acc.usage.totalTokens`; feed it into the unchanged ledger INSERT (reason.ts:207-213) and `text: acc.text` into the response (reason.ts:216-225). Idempotency (ON CONFLICT request_id) unchanged.

    Constraints: route keeps `config: { rateLimit: { max:120, timeWindow:"1 minute" } }` (LOCKER-04); no `schema.body` change (manual zod parse stays). No `as any`/`@ts-ignore`; the two `as` narrowings for `Readable`/`ReadableStream` follow the existing single-`as` LOCKER-02-clean pattern (index.ts:84) — prefer typing without `as unknown as`. No NODE_ENV branch; no hardcoded literal.
  </action>
  <verify>
    <automated>pnpm --filter @openwhispr/api exec vitest run tests/unit/routes/reason.test.ts tests/unit/lib/reason-stream-accumulate.test.ts</automated>
  </verify>
  <done>All existing reason.test.ts cases GREEN through the streaming path PLUS the 4 new RED tests (A happy-200, B mid-stream-error→502, C premature-close→502, D usage-reconstruction) GREEN. Success response keys are exactly the canonical five. No partial-200 on stream failure. Idempotency clause present in both re-post inserts.</done>
</task>

<task type="auto">
  <name>Task 3: Streaming contract-mock entry + e2e exercising the streamed reason path</name>
  <files>compose/litellm/litellm_config.contract.yaml, tests/e2e/reason.e2e.test.ts</files>
  <action>
    The reason e2e mounts `litellm_config.contract.yaml` (tests/e2e/compose-helper.ts:31). The `qwen3.6-plus` entry there (contract.yaml:19-23) carries a NON-streaming JSON `mock_response`. LiteLLM serves the same `mock_response` for a `stream:true` request by chunking it, BUT to make the streamed reason path deterministic and to prove the new accumulator works end-to-end through the real Traefik→api→LiteLLM chain, switch the `qwen3.6-plus` (and `qwen3.6-cleanup`, contract.yaml:35-39, since the bare-`{text}` body is the cleanup shape) entries to a multi-line SSE `mock_response` mirroring the existing `qwen3.6-plus-streaming` entry pattern (contract.yaml:108-118): three `data:` frames ("mocked", " reasoning", terminal `{delta:{},finish_reason:"stop"}` carrying `usage` with `total_tokens:15`) then `data: [DONE]`. Preserve the canary substring `mocked reasoning` (concatenated across deltas) so the existing e2e assertion `parsed.text.toContain("mocked reasoning")` still holds. Keep `api_key: "fake-key-for-mock"` and `model:` lines unchanged. Do NOT touch realtime/transcription entries.

    Update `tests/e2e/reason.e2e.test.ts`: keep the existing two cases (canonical 200 shape via Traefik+TLS; 401 without cookie) — they now traverse the streamed-then-buffered path and the byte-identical wire shape assertion still validates. Add ONE assertion to the success case that the JSON has EXACTLY the five canonical keys (no `usage`/no extra leakage on the wire). Do NOT add a mid-stream-error e2e (LiteLLM mock cannot inject a post-headers error deterministically — that risk is fully covered by route unit Test B/C); document this scope boundary in a comment.
  </action>
  <verify>
    <automated>E2E=1 pnpm --filter @openwhispr/e2e exec vitest run reason.e2e.test.ts</automated>
  </verify>
  <done>The contract.yaml qwen3.6-plus + qwen3.6-cleanup entries emit SSE frames; the reason e2e passes through the real docker compose stack: 200 returns the canonical five-key shape with text containing "mocked reasoning" and model "qwen3.6-plus"; 401 envelope without a cookie. No realtime/transcription entry altered.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>POST /api/reason switched to internal-stream-then-buffer: a new pure SSE accumulator (reason-stream-accumulate.ts), the rewired route calling chatCompletionsStream + accumulate-and-inspect-before-200, streaming contract-mock entries, and unit + e2e coverage including the mid-stream-error→5xx headline tests. Wire shape byte-identical; client untouched.</what-built>
  <how-to-verify>
    1. Confirm the full diff touches only the six files in `files_modified` (no other production surface): `git status --short` and `git diff --stat`.
    2. Per-diff coverage floor ≥90/90/90/90 on the new/modified TS: run `pnpm --filter @openwhispr/api exec vitest run --coverage tests/unit/lib/reason-stream-accumulate.test.ts tests/unit/routes/reason.test.ts` and read the lines/branches/functions/statements numbers for `reason-stream-accumulate.ts` and `reason.ts`.
    3. Verify LOCKER cleanliness on the changed files: `pnpm exec tsx tools/lint-no-suppressions.ts` and `pnpm exec tsx tools/lint-no-env-branches.ts` and `pnpm exec tsx tools/lint-prod-readiness.ts` (route still carries schema-or-manual-parse + rateLimit) report no NEW violations.
    4. (Optional, slow) Boot the stack and hit the real route against a genuinely slow upstream is out of scope for the hermetic mock; the timeout-class fix is validated structurally (stream path bodyTimeout:0) + by unit Test B/C. Confirm you accept this scope boundary.
    5. Confirm the success JSON over the wire still has exactly `{ text, model, provider, promptMode, matchType }`.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues (e.g. coverage gap on a branch, a LOCKER violation, or a wire-shape drift)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| api → LiteLLM gateway | Untrusted upstream SSE bytes cross here; frames are JSON.parse-validated and malformed frames dropped (no downstream poisoning). |
| LiteLLM gateway → api (post-200) | NEW boundary class: errors that arrive AFTER 200 SSE headers. Cannot be caught by the pre-200 catch; the accumulator MUST detect incomplete/error streams and the route MUST emit 5xx, never a partial 200. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nar-01 | Tampering | Upstream SSE frames (untrusted) | mitigate | JSON.parse-validate each `data:` payload; drop malformed frames (mirror sse-parser.ts:138); narrow typed frame interface, no `as any`. |
| T-nar-02 | Denial of Service | Mid-stream upstream failure after 200 headers | mitigate | accumulate-and-inspect BEFORE 200; raise `ReasonStreamIncompleteError` on error-frame / premature-close / missing usage → route emits 502 `REASONING_UPSTREAM_FAILED`. Never a silent partial 200 (route unit Test B/C). |
| T-nar-03 | Information disclosure | Upstream error body / master-key-shaped fragments echoed to client | mitigate | Error subclass truncates body string fields at construction (LOCKER-05); route emits the class-default generic message, never the upstream blob — reuse the existing 502 envelope (reason.ts:190-196). Test asserts no `sk-litellm-master` leakage (existing test pattern). |
| T-nar-04 | Repudiation | usage_ledger drift / double-charge | accept→mitigate | total_tokens reconstructed from terminal SSE usage; ledger INSERT idempotent ON CONFLICT(request_id) (unchanged). Failed streams write NO ledger row (inspect-before-insert). |
| T-nar-SC | Tampering | npm/pip/cargo installs | accept | No new packages installed — uses node:stream + existing litellm-client method only. No package-legitimacy gate needed. |
</threat_model>

<verification>
- Truth "no more HEADERS_TIMEOUT" → structural: route uses `chatCompletionsStream` (stream path `bodyTimeout:0`, headers flush on SSE open). Verified by Task 2 grep `chatCompletionsStream` in reason.ts + the absence of any per-call `headersTimeout` band-aid.
- Truth "byte-identical JSON shape" → Task 2 contract-key assertion + Task 3 e2e five-key assertion.
- Truth "correct total_tokens to ledger" → Task 1 Test 1/2 + Task 2 Test A/D (ledger units == terminal total_tokens / reconstructed sum).
- Truth "mid-stream error → clean 5xx, never partial 200" → Task 1 Test 3/4 (accumulator rejects) + Task 2 Test B/C (route 502 envelope, no partial text).
- Truth "request_id idempotency preserved" → existing idempotent-re-post test still GREEN through the streamed path (Task 2 PRESERVE list).
- Per-diff coverage ≥90/90/90/90 → checkpoint step 2.
- LOCKER-01/02/03/04/05 clean → checkpoint step 3.
</verification>

<success_criteria>
- `POST /api/reason` is served via internal `chatCompletionsStream` + accumulate-then-buffer; no per-call `headersTimeout` override anywhere.
- Success response is byte-identical `{ text, model, provider, promptMode, matchType }`; client v1.7.22 untouched.
- A post-200 mid-stream upstream error or premature close yields a 502 `REASONING_UPSTREAM_FAILED` envelope, never a partial 200, never the accumulated partial text.
- usage_ledger receives correct `total_tokens`; idempotency on request_id intact.
- Strict TDD honored: accumulator + route tests written RED before GREEN; tests + fix land in the SAME atomic commit per the constitutional rule.
- Per-diff coverage ≥90% lines/branches/functions/statements on `reason-stream-accumulate.ts` + `reason.ts`.
- E2E (the mandatory wire-surface gate) passes through the real docker compose stack.
- No type-suppression, no NODE_ENV branch outside config/bootstrap, no hardcoded localhost/UUID/secret literals, route keeps schema-parse + rateLimit.
</success_criteria>

<output>
Create `.planning/quick/260610-nar-reason-stream-timeout/SUMMARY.md` when done.
</output>
