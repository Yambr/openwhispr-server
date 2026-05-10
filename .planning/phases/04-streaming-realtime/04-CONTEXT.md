---
phase: 04
status: locked
date: 2026-05-10
mode: research-first
---

# Phase 04 — CONTEXT

**Gathered:** 2026-05-10
**Status:** Ready for planning
**Source:** discuss-phase with advisor research (4 parallel agents, minimal_decisive calibration)

<domain>
## Phase Boundary

Wire up the four streaming/realtime endpoints so the desktop client gets sub-500ms first NDJSON line through the full Traefik → Fastify → LiteLLM chain, holds a ≥1h WSS `/v1/realtime` session without ingress-timeout disconnects, and mints AssemblyAI / Deepgram / OpenAI-Realtime ephemeral tokens server-side (operator's master keys never cross the wire).

**In scope:**

- `POST /api/agent/stream` — NDJSON streaming chat (BACKEND_SPEC byte-for-byte: `text-delta`, `tool-call`, `tool-result`, `finish` chunk vocabulary).
- `POST /api/streaming-token` — AssemblyAI v3 token mint, gated on `ASSEMBLYAI_API_KEY`.
- `POST /api/deepgram-streaming-token` — Deepgram Grant-Token mint, gated on `DEEPGRAM_API_KEY`.
- `POST /api/openai-realtime-token` — OpenAI Realtime ephemeral client_secret mint, `streams=1|2` via parallel mints.
- Dedicated Traefik `websecure-realtime` entrypoint for `WSS /v1/realtime` (3600s read/write/idle timeouts) — only the realtime route gets the long timeouts; rest of `:443` stays at defaults.
- Buffering-injection negative-control test that proves the NDJSON first-line-latency test is not a false negative.
- Hermetic mock-realtime WS echo server (e2e profile) for every-PR ~5-min WSS soak validation.
- Live 65-min OpenAI Realtime soak gated to nightly + release-tag schedules.
- CONTRACT-01 extended for all four routes (request/response shapes, gating 503s, NDJSON line-flush, `streams=2` payload, scheme-echo unchanged).
- TDD throughout — tests precede production code, ≥90/90/90/90 coverage on every touched file.

**Out of scope (later phases):**

- `/api/agent/web-search` — Phase 5 (server-side tool implementation; Phase 4 only forwards `tool-call` chunks from the model, executes nothing inline).
- `/api/streaming-usage` — Phase 5.
- `/api/usage`, `/api/stt-config`, `/api/note-recording-config`, generic `cloud-api-request` passthrough — Phase 5.
- k6 1000-concurrent load — Phase 8 (SCALE-06).
- Per-tenant provider sub-accounts / BYOK token shaping — v2.
- Internal mTLS between Traefik↔Fastify↔LiteLLM (docker bridge is not externally reachable; matches existing trust boundary).

</domain>

<decisions>
## Implementation Decisions

### NDJSON producer + buffering chain (`POST /api/agent/stream`)

- **D-01:** **Hand-rolled async iterator.** `undici` `fetch` to `${LITELLM_BASE_URL}/v1/chat/completions` with `{stream: true, stream_options: {include_usage: true}, user: <userId>}`. Read `response.body` as a `ReadableStream`, decode with `TextDecoder`, split on `\n\n` SSE boundaries (carrying a partial-frame buffer across reads), `JSON.parse` each `data:` payload, transform to BACKEND_SPEC chunk shape, `reply.raw.write(JSON.stringify(chunk) + '\n')` per emission. Reject Vercel AI SDK server-side — its v5/v6 chunk vocabulary (`text-start`, `tool-input-start`, `tool-output-available`) does NOT match the spec's locked v3-era shape, and there are active LiteLLM↔AI-SDK streaming-translation bugs (litellm#26529, vercel/ai#7449).

- **D-02:** **Flush semantics on Node 24.** Node's `http.ServerResponse` has **no `flush()` method** by default — the method only exists when `compression` middleware patches it on. Canonical 2026 idiom: (i) `Transfer-Encoding: chunked` (Fastify sets automatically when Content-Length is absent), (ii) `reply.raw.flushHeaders()` ONCE before the first write, (iii) `request.raw.socket.setNoDelay(true)` to disable Nagle so each `write()` becomes its own TCP segment, (iv) `reply.raw.write(line)` per chunk — no per-write flush call needed; the kernel sends it. The defensive `typeof reply.raw.flush === 'function' ? reply.raw.flush() : noop` pattern is harmless but a no-op on stock Node 24 — keep it as belt-and-braces only if it costs zero readability.

- **D-03:** **`reply.hijack()` at handler top.** Bypass Fastify's reply lifecycle so we own the socket end-to-end. End the response explicitly on upstream `[DONE]` sentinel or on `request.raw.on('close')`.

- **D-04:** **Traefik buffering is a non-issue.** Traefik 3 does NOT buffer responses by default. The `buffering` middleware is opt-in. There is no `proxy_buffering on` to disable — there is no `proxy_buffering on` to begin with. The `X-Accel-Buffering: no` header is an nginx artifact; Traefik ignores it harmlessly. **Action:** verify (in the buffering-injection negative test) that no `buffering` middleware is attached to the streaming router. We MAY still emit `X-Accel-Buffering: no` for any operator who fronts us with nginx — it's a cheap forward-compat marker, not a Traefik config.

- **D-05:** **Buffering-injection negative-control test.** Three-test pyramid:
  - **Test A (positive):** test fixture route emits `{"i":N}\n` every 100ms for 10 ticks; assert first-line < 200ms via undici raw-socket read.
  - **Test B (negative-control):** same handler wrapped in `stream.Transform({highWaterMark: 4096})` that buffers until full; assert first-line > 800ms. If Test A still passes with the buffering transform inserted, Test A is broken.
  - **Test C (e2e chain):** through the actual `docker compose` Traefik in `tests/e2e/`, assert first-line < 500ms end-to-end against the real `/api/agent/stream` route (mock-LiteLLM profile for hermetic determinism; real provider in nightly).

- **D-06:** **SSE→NDJSON shape transform.** Lives inline as a pure async generator `async function* sseToNdjson(upstreamBody)`. CPU cost: one `JSON.parse` + one allocation + one `JSON.stringify` per delta token. At ~50 tokens/sec/stream × 1000 concurrent = 50k ops/sec cluster-wide — well under one Node 24 worker's capacity. No `worker_threads`.

### Agent stream tooling + LiteLLM routing

- **D-07:** **Request-side tool translation.** Accept the spec's legacy `tools: [{name, description, parameters}]` array at the wire. Server-side translate to OpenAI `tools: [{type: "function", function: {name, description, parameters}}]` before forwarding to LiteLLM. Desktop contract stays byte-for-byte.

- **D-08:** **Client-side tool execution.** Server emits `{type: "tool-call", toolName, args}` chunks for the desktop to execute (often via `/api/agent/web-search` in Phase 5). Desktop sends a follow-up `/api/agent/stream` request with `{role: "tool", content: result}` appended to `messages`. Server emits `{type: "tool-result", ...}` chunks ONLY when LiteLLM itself echoes a tool-result role in the conversation — the route is stateless and never executes tools inline. Matches the desktop's IPC pattern documented in BACKEND_SPEC.md.

- **D-09:** **Tool-call delta accumulation.** Accumulate OpenAI streaming `delta.tool_calls[].function.arguments` string fragments keyed by `index`. Emit ONE consolidated `{type: "tool-call", toolName, args: <parsed-JSON>}` per tool call when `finish_reason === "tool_calls"` arrives — NOT per delta. The spec's `args: {}` is a complete object, not a partial JSON string. Multi-tool-call responses emit multiple consolidated chunks in `index` order before the `finish` chunk.

- **D-10:** **Model default + override.** `model = req.body.model ?? process.env.DEFAULT_AGENT_MODEL ?? "qwen/qwen3.6-plus"`. Env-overridable without rebuild satisfies the "corporate operators override without code changes" project constraint; falls through to Phase 3 D-06.

- **D-11:** **systemPrompt is additive-prepend.** If `body.systemPrompt` is set, insert `{role: "system", content: body.systemPrompt}` at index 0 of the forwarded `messages` array. Never replace an existing system message — additive is safe and least-surprising. Spec says "Optional override" but is silent on collision; additive wins.

- **D-12:** **Usage + spend-log correlation.** Pass `stream_options: {include_usage: true}` to guarantee the final usage chunk. Map LiteLLM `usage.prompt_tokens → promptTokens`, `usage.completion_tokens → completionTokens` in the emitted `finish` chunk. Capture LiteLLM response header `x-litellm-call-id` (and OpenRouter response `id` when present) into the server-side OTel span + structured log line for Phase 3 D-08 spend-log reconciliation. **Never** leak `x-litellm-call-id` to the client — not in spec.

### Token-mint endpoints

- **D-13:** **Direct mint via undici from Fastify.** Server holds keys; Fastify calls each provider's token API directly. Reject LiteLLM `pass_through_endpoints` — ephemeral mints are auth-shaped not LLM-shaped (no model routing, no spend attribution), pass_through adds a Python hop for zero gain.

- **D-14:** **AssemblyAI v3.** `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60` with `Authorization: <ASSEMBLYAI_API_KEY>` → `{token}`. One-time-use per session, `expires_in_seconds ∈ [1, 600]`. Map provider `token` → our response envelope `{token: "..."}`. `max_session_duration_seconds` omitted (provider default 3h).

- **D-15:** **Deepgram Grant Token.** `POST https://api.deepgram.com/v1/auth/grant` with `Authorization: Token <DEEPGRAM_API_KEY>` → `{access_token, expires_in}` (30s TTL, unlimited issuance, no `project_id` required). Reject the `/v1/projects/{id}/keys` path — capped at 250/day, leaves dangling keys, requires `DEEPGRAM_PROJECT_ID`. Map `access_token` → `{token: "..."}`.

- **D-16:** **OpenAI Realtime client_secret.** `POST https://api.openai.com/v1/realtime/client_secrets` body `{"session": {"type": "realtime", "model": "gpt-realtime"}}` with `Authorization: Bearer <OPENAI_API_KEY>` → `{value: "ek_...", session: {...}}`. ~60s TTL. Prefer `/client_secrets` over the legacy `/v1/realtime/sessions`.

- **D-17:** **`streams=2` semantic.** OpenAI Realtime has NO native multi-stream session — mint TWO ephemeral secrets via two parallel `POST /client_secrets` calls (`Promise.all`), return `{clientSecret: secrets[0], clientSecrets: secrets}`. For `streams=1`, mint one secret and still populate `clientSecrets: [secret]` for shape consistency. Desktop asserts `clientSecrets.length >= 2` when `streams=2`.

- **D-18:** **Missing-key gating (uniform).** If the relevant env var is unset → `503 {"error": "<Provider> not configured (set <ENV_VAR_NAME> in .env)"}`. `503` is correct (Service Unavailable due to operator config). NOT `501` (would imply route unimplemented), NOT `502` (no upstream contacted). **No `Retry-After`** — config gap is not transient; the header would mislead clients into polling.

- **D-19:** **Per-user rate limit.** `@fastify/rate-limit` per route at **30 req/min/user** keyed on the Better Auth session userId, backed by the existing Valkey store (Phase 1 infra). Bounds leaked-bearer abuse without throttling legitimate desktop reconnect storms.

- **D-20:** **Provider call timeouts.** `undici` with 3s connect, 5s total per provider call. On timeout → `503 {"error": "<Provider> token mint timed out"}` (transient — operator may investigate, but client behavior is identical to missing-key 503).

### Realtime ingress + 65-min soak

- **D-21:** **Dedicated Traefik entrypoint for WSS realtime.** Add `websecure-realtime` entrypoint in `compose/traefik/traefik.yml`, bound to a distinct port (e.g., `:8443`), with `respondingTimeouts: { readTimeout: 0, writeTimeout: 0, idleTimeout: 3600s }`. Router `realtime` matches `Host(...) && PathPrefix(/v1/realtime)` only and is bound to `websecure-realtime` exclusively. Keep `:443` (`websecure`) at default short timeouts for all other routes. This is the ONLY Traefik 3-correct mechanism for per-route timeouts — there is no per-router timeout middleware. Document the dedicated entrypoint in `docker-compose.yml` (port mapping) and in the Helm chart values.

- **D-22:** **Hermetic mock-realtime WS server.** ~50-LoC Fastify WSS handler in `tests/e2e/mock-realtime/` speaking minimum OpenAI Realtime protocol (`session.created` on connect, `response.done` on demand, transparent ping/pong forwarding). Runs in the `e2e` compose profile under `E2E=1`. ~5-min soak test on every PR — proves the timeout config + keepalive plumbing without provider cost or flake.

- **D-23:** **Live 65-min soak (nightly + release-tag).** Real OpenAI Realtime session against `gpt-realtime`, gated by `if: github.event_name == 'schedule' || startsWith(github.ref, 'refs/tags/')` in the GitHub Actions workflow + `OPENAI_API_KEY` secret. Cost ~$15-25 per execution (mainly $0.06/min audio in for the synthetic stream). NOT run on PR — too slow, too costly, too flaky against real OpenAI 1006 random closes.

- **D-24:** **Keepalive driven by test client.** OpenAI Realtime does not send keepalives during silence. `@fastify/http-proxy` v11 forwards client-initiated ping/pong transparently but does NOT inject its own. The soak test client (hermetic and live) MUST drive ping every 20s; assertion includes "p95 ping RTT < 1s throughout 65 min."

- **D-25:** **Soak pass/fail assertion.** "No close frame originating from our ingress chain before T+3900s." Distinguish ingress-driven closes from upstream 1006 by inspecting close code + elapsed time. OpenAI's own random 1006 disconnects (documented community knowledge) are NOT our bug — the test records them but does not fail on them; only an ingress-attributable close fails the test.

- **D-26:** **Backend hop TLS.** `ws://` inside docker bridge (Traefik → Fastify → LiteLLM) matches the existing trust boundary — PROJECT.md's plaintext-prohibition applies to externally reachable ports, the docker bridge is not externally reachable. Client → Traefik remains `wss://` terminated by Traefik ACME. Internal mTLS deferred to a future hardening phase; not over-engineered here.

- **D-27:** **`@fastify/http-proxy` config.** `wsClientOptions: { handshakeTimeout: 10000 }`. `wsReconnect: false` (don't auto-reconnect — let the client handle reconnect; reconnect in proxy hides ingress timeout bugs). Existing `realtime.ts` is the integration point; this phase tightens its config and adds the timeout entrypoint upstream of it.

### Contract tests (CONTRACT-01 extension)

- **D-28:** **One contract test file per new endpoint** in `packages/contract-tests/src/` — matches Phase 2 D-17 pattern. Tests assert: status code, response JSON shape (zod schemas mirroring BACKEND_SPEC.md byte-for-byte), required headers, missing-key 503 envelope shape, `streams=2` payload length ≥ 2, NDJSON `Content-Type` and per-line-flush behavior.

- **D-29:** **Per-line-flush contract test.** Spin up the `e2e` compose profile, hit `/api/agent/stream` with a mock-LiteLLM `mock_response` configured to emit N chunks at 100ms cadence; read raw socket; assert first-chunk-received timestamp < 500ms from response-headers timestamp AND each subsequent chunk arrives within ~150ms of being emitted upstream (no end-of-response bunching). Reuses Phase 3 D-05 mock-LiteLLM contract profile.

- **D-30:** **Gating-503 shape test.** For each of the three token-mint endpoints, run a contract-test profile with the relevant env var unset; assert `503` + `{"error": "..."}` envelope containing the exact env-var name as a substring.

### Coverage + TDD discipline (constitutional)

- **D-31:** Every new/modified file ≥ 90% on lines/branches/functions/statements. Tests precede production code. Fixes land with their tests in the SAME atomic commit. No mocks of internal logic — only at process/network boundaries (provider HTTP calls, OS time). Real Valkey + real Traefik + real Fastify in integration/e2e tests.

### Claude's Discretion

- Exact Traefik entrypoint port number for `websecure-realtime` (recommended `:8443`, but operator may have port conflicts — final pick during planning).
- Whether to land the buffering-injection negative-control test as a `tests/unit/buffering-injection.test.ts` (pure Node stream test, no Traefik) or a `tests/e2e/buffering-injection.test.ts` (through the real stack) — recommend both, but planner picks weight per wave.
- Whether AssemblyAI / Deepgram TTL params are surfaced as configurable env vars (`ASSEMBLYAI_TOKEN_TTL`, `DEEPGRAM_TOKEN_TTL`) or hardcoded (60s / 30s default). Recommend env-with-default for ops flexibility.
- File organization: `apps/api/src/routes/agent/stream.ts` + `apps/api/src/routes/tokens/{assemblyai,deepgram,openai}.ts` vs flatter — planner picks for grep clarity.
- Whether the hermetic mock-realtime server lives in `tests/e2e/mock-realtime/` (separate package) or inlined into the e2e compose as a small Node script — recommend separate package for reuse.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (always)
- `.planning/PROJECT.md` — constitutional rules, TDD floor, no-bundled-models rule, enterprise constraints
- `.planning/REQUIREMENTS.md` — WIRE-07, WIRE-13, WIRE-14, WIRE-15, SCALE-05 (Phase 4 owns these IDs)
- `.planning/ROADMAP.md` § Phase 4 — goal + 4 success criteria
- `.planning/STATE.md` — Phase 3 closure status, coverage baselines, debt closure

### Upstream wire spec (byte-for-byte source of truth)
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` §`/api/agent/stream` (lines ~300-348) — NDJSON chunk vocabulary, request body, error deviations
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` §`/api/streaming-token` (lines ~482-508) — AssemblyAI mint shape
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` §`/api/deepgram-streaming-token` (lines ~510-532) — Deepgram mint shape
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` §`/api/openai-realtime-token` (lines ~534-572) — OpenAI Realtime mint, streams=1|2 semantics
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` §header conventions — `Content-Type`, global error envelope, dual-auth

### Prior phase context (carries forward)
- `.planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md` § D-04 (dual auth onRequest hook), D-13 (global error envelope), D-17 (CONTRACT-01 zod harness), D-28 (rate-limit pattern)
- `.planning/phases/03-litellm-integration-bundled-oss-models/03-CONTEXT.md` § D-03 (single LITELLM_MASTER_KEY + per-request user param), D-04 (wsUpstream realtime topology), D-06 (qwen3.6-plus default), D-08 (request_id propagation for spend logs), D-12 (OpenAI Realtime upstream)

### Existing code to extend (Phase 4 modifies, never replaces)
- `apps/api/src/routes/realtime.ts` (160 LoC) — existing `@fastify/http-proxy` wsUpstream; Phase 4 tightens config (D-27) and adds the timeout entrypoint upstream (D-21)
- `apps/api/src/routes/index.ts` — route registrar; Phase 4 adds 4 new routes
- `apps/api/src/auth.ts` — Better Auth dual-auth hook; reused unchanged

### Third-party API documentation (mint endpoints)
- AssemblyAI Streaming v3 token API — https://www.assemblyai.com/docs/api-reference/streaming-api/generate-streaming-token
- Deepgram Grant Token API — https://developers.deepgram.com/reference/token-based-auth-api/grant-token
- OpenAI Realtime `/v1/realtime/client_secrets` — https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret

### Ingress + streaming infrastructure
- Traefik 3 EntryPoints / respondingTimeouts — https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/
- Traefik buffering middleware (opt-in only) — https://doc.traefik.io/traefik/middlewares/http/buffering/
- `@fastify/http-proxy` README (wsUpstream, wsClientOptions) — https://github.com/fastify/fastify-http-proxy
- Fastify Reply reference (raw, hijack) — https://fastify.dev/docs/latest/Reference/Reply/
- LiteLLM streaming (`stream_options.include_usage`) — https://docs.litellm.ai/docs/completion/stream

### Known issues to design around (do NOT pretend they don't exist)
- LiteLLM ↔ Vercel AI SDK v6 multi-step tool-call breakage — https://github.com/BerriAI/litellm/issues/26529
- LiteLLM streaming tool_calls dropped on text+tool combined — https://github.com/BerriAI/litellm/issues/17246
- Vercel AI SDK submit-tool-result follow-up bug — https://github.com/vercel/ai/issues/7449
- OpenAI Realtime WS random 1006 disconnects — https://community.openai.com/t/realtime-api-websocket-disconnects-randomly-in-nodejs/1044456 (test must distinguish these from ingress-timeout closes)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `apps/api/src/routes/realtime.ts` — existing `@fastify/http-proxy` `wsUpstream` registration with auth pre-handler and master-key injection. Phase 4 tightens config (D-27) and adds the dedicated timeout entrypoint upstream in Traefik (D-21); no rewrite.
- `apps/api/src/auth.ts` — Better Auth dual-auth hook (Bearer + cookie). All four new endpoints inherit it unchanged.
- `apps/api/src/error-handler.ts` — global `{error}` envelope emitter. Missing-key 503s (D-18) route through this.
- `apps/api/src/plugins/rate-limit.ts` (Phase 2 D-28) — `@fastify/rate-limit` against Valkey. Per-user 30/min override (D-19) follows existing pattern.
- `compose/litellm/litellm_config.contract.yaml` (Phase 3 D-05) — mock-mode LiteLLM with `mock_response` per model. NDJSON streaming contract tests (D-29) configure mock chunks here.
- `packages/contract-tests/src/` — Vitest zod-schema harness. New endpoints add files following Phase 2 D-17 pattern.

### Established Patterns

- **One file per route** for grep clarity (Phase 2 Claude's Discretion). Phase 4 adds `routes/agent/stream.ts`, `routes/tokens/assemblyai.ts`, `routes/tokens/deepgram.ts`, `routes/tokens/openai-realtime.ts`.
- **Env-overridable defaults** for everything operators may want to tune (model, TTLs, timeouts) — falls through to spec/PROJECT.md defaults.
- **Mock-mode for CI, real-keys for nightly** — Phase 3 D-05 dual-mode strategy carries forward.
- **TDD per atomic commit** — fix + test land together; no "tests later" commits.

### Integration Points

- **`apps/api/src/index.ts`** — registers route plugins. Add 4 new registrations.
- **`compose/traefik/traefik.yml` + `compose/traefik/dynamic.yml`** — add `websecure-realtime` entrypoint and `realtime` router binding.
- **`docker-compose.yml`** — add port mapping for the new entrypoint (e.g., `8443:8443`).
- **`.env.example`** — add `ASSEMBLYAI_API_KEY=`, `DEEPGRAM_API_KEY=`, optionally `ASSEMBLYAI_TOKEN_TTL=`, `DEEPGRAM_TOKEN_TTL=`, `DEFAULT_AGENT_MODEL=`. `OPENAI_API_KEY` already present (Phase 3 D-12).
- **Helm chart** (deferred to Phase 9 — operator-facing only) — note the second entrypoint requirement in a TODO marker so it's not forgotten.

</code_context>

<specifics>
## Specific Ideas

- User directive: **"no workarounds, no over-engineering, enterprise-grade."** Every decision above was vetted against that rule. Reject-paths (Vercel AI SDK server-side, LiteLLM pass-through for token mints, globalizing the 3600s timeout) are explicitly documented as rejected so future contributors don't re-litigate them.
- The "X-Accel-Buffering: no" requirement from the ROADMAP success criteria is preserved as a forward-compat marker for nginx-fronting operators, but the *load-bearing* mechanism in our stack is Traefik's no-buffering-by-default + the negative-control test proving the chain is clear.
- The buffering-injection negative-control test (D-05) is non-optional — without it, the first-line-latency assertion is a false negative waiting to happen. Plan must include it as a `[BLOCKING]` task.

</specifics>

<deferred>
## Deferred Ideas

- **Internal mTLS** between Traefik ↔ Fastify ↔ LiteLLM — future hardening phase, not Phase 4.
- **Per-tenant provider sub-accounts** (per-tenant AssemblyAI / Deepgram keys) — v2 multi-tenancy enhancement.
- **`workflow_dispatch` UI for ad-hoc live-soak runs** — nice-to-have CI ergonomics, planner may include or punt.
- **OpenTelemetry span around each token mint** — Phase 6 (OBS-*) territory; Phase 4 emits structured log lines but defers full tracing.
- **Webhook-driven realtime session lifecycle events** — Phase 5+ if OpenAI ships them.

</deferred>

---

*Phase: 04-streaming-realtime*
*Context gathered: 2026-05-10 via advisor-mode discuss-phase (4 parallel agents, minimal_decisive)*
