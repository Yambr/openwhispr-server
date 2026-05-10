# Phase 4: Streaming + Realtime — Research

**Researched:** 2026-05-10
**Domain:** Server-Sent Events → NDJSON translation, Fastify reply hijacking, Traefik 3 per-route timeouts, ephemeral provider token mints, hermetic WSS soak harness
**Confidence:** HIGH (every load-bearing decision is locked in CONTEXT.md; this document fills implementation details only)
**Mode:** Implementation research (NOT design re-evaluation). 31 decisions are locked in `04-CONTEXT.md`. Reject-paths (Vercel AI SDK server-side, LiteLLM `pass_through_endpoints` for token mints, globalizing the 3600s timeout) are explicitly out of scope.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### NDJSON producer + buffering chain (`POST /api/agent/stream`)

- **D-01:** Hand-rolled async iterator. `undici` `fetch` to `${LITELLM_BASE_URL}/v1/chat/completions` with `{stream:true, stream_options:{include_usage:true}, user:<userId>}`. Read `response.body` as a `ReadableStream`, decode with `TextDecoder`, split on `\n\n` SSE boundaries (carry partial-frame buffer across reads), `JSON.parse` each `data:` payload, transform to BACKEND_SPEC chunk shape, `reply.raw.write(JSON.stringify(chunk) + '\n')` per emission. Reject Vercel AI SDK server-side.
- **D-02:** Flush semantics on Node 24. No `flush()` method on `http.ServerResponse` by default. Use `Transfer-Encoding: chunked` (auto), `reply.raw.flushHeaders()` once, `request.raw.socket.setNoDelay(true)`, then `reply.raw.write(line)` per chunk.
- **D-03:** `reply.hijack()` at handler top. End response on `[DONE]` or `request.raw.on('close')`.
- **D-04:** Traefik buffering is non-issue. Verify negative-control test that no `buffering` middleware is attached. Emit `X-Accel-Buffering: no` for nginx-fronting operators (forward-compat).
- **D-05:** Buffering-injection negative-control test (three-test pyramid: unit positive, unit negative, e2e through Traefik).
- **D-06:** SSE→NDJSON shape transform as inline pure async generator. No worker_threads.

#### Agent stream tooling

- **D-07:** Request-side tool translation: legacy `[{name,description,parameters}]` → OpenAI `[{type:"function", function:{...}}]`.
- **D-08:** Client-side tool execution; server emits `tool-call` chunks, never executes inline.
- **D-09:** Tool-call delta accumulation by `index`; emit consolidated chunk on `finish_reason === "tool_calls"`.
- **D-10:** `model = body.model ?? env.DEFAULT_AGENT_MODEL ?? "qwen/qwen3.6-plus"`.
- **D-11:** `systemPrompt` is additive-prepend (never replace).
- **D-12:** `stream_options.include_usage:true`, capture `x-litellm-call-id` server-side only.

#### Token-mint endpoints

- **D-13:** Direct mint via undici from Fastify; no LiteLLM pass-through.
- **D-14:** AssemblyAI v3: `GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=60`, `Authorization: <ASSEMBLYAI_API_KEY>` (no `Bearer` prefix).
- **D-15:** Deepgram Grant Token: `POST https://api.deepgram.com/v1/auth/grant`, `Authorization: Token <DEEPGRAM_API_KEY>`.
- **D-16:** OpenAI Realtime: `POST https://api.openai.com/v1/realtime/client_secrets`, body `{"session":{"type":"realtime","model":"gpt-realtime"}}`, `Authorization: Bearer <OPENAI_API_KEY>`.
- **D-17:** `streams=2` ⇒ two parallel `Promise.all` mints. `streams=1` ⇒ one mint, still populate `clientSecrets:[secret]`.
- **D-18:** Missing-key gating: `503 {"error":"<Provider> not configured (set <ENV_VAR_NAME> in .env)"}`. No `Retry-After`.
- **D-19:** Per-user rate limit `30/min/user` keyed on Better Auth userId, Valkey-backed.
- **D-20:** Provider call timeouts: 3s connect, 5s total. Timeout → `503`.

#### Realtime ingress + 65-min soak

- **D-21:** Dedicated Traefik entrypoint `websecure-realtime` (e.g., `:8443`), `respondingTimeouts {readTimeout:0, writeTimeout:0, idleTimeout:3600s}`. Router `realtime` matches `Host(...) && PathPrefix(/v1/realtime)` only, bound to `websecure-realtime` exclusively. `:443` returns to default short timeouts for all other routes.
- **D-22:** Hermetic mock-realtime WS server (~50 LoC, `tests/e2e/mock-realtime/`); `e2e` profile runs ~5-min soak on every PR.
- **D-23:** Live 65-min soak gated to nightly + release-tag in GHA.
- **D-24:** Test client drives ping every 20s; assertion includes p95 ping RTT < 1s through 65 min.
- **D-25:** Pass/fail: "no close frame from our ingress chain before T+3900s." Distinguish ingress-driven from upstream 1006.
- **D-26:** Backend hop TLS: `ws://` inside docker bridge (matches existing trust boundary).
- **D-27:** `@fastify/http-proxy`: `wsClientOptions.handshakeTimeout: 10000`, `wsReconnect: false`.

#### Contract tests + coverage

- **D-28:** One contract-test file per new endpoint in `packages/contract-tests/src/`.
- **D-29:** Per-line-flush contract test using `mock_response` chunked LiteLLM profile.
- **D-30:** Gating-503 shape test for each token-mint endpoint with env var unset.
- **D-31:** ≥90/90/90/90 on every new/modified file. TDD per atomic commit. Real Valkey + real Traefik in integration/e2e.

### Claude's Discretion

- Exact port number for `websecure-realtime` (recommend `:8443`).
- Whether buffering-injection negative test lives unit-only or e2e-only or both.
- Whether AssemblyAI/Deepgram TTLs are env-overridable (recommend env-with-default).
- Route file organization (recommend `routes/agent/stream.ts` + `routes/tokens/{assemblyai,deepgram,openai-realtime}.ts`).
- Mock-realtime WS server: separate package vs inlined (recommend separate package).

### Deferred Ideas (OUT OF SCOPE)

- Internal mTLS Traefik↔Fastify↔LiteLLM (future hardening phase).
- Per-tenant provider sub-accounts (v2 multi-tenancy).
- `workflow_dispatch` UI for ad-hoc live-soak.
- OpenTelemetry spans around token mints (Phase 6 OBS-* territory).
- Webhook-driven realtime session lifecycle events.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIRE-07 | `POST /api/agent/stream` — NDJSON, flush per line, no buffering | §2.1 (hand-rolled SSE→NDJSON), §2.2 (Fastify lifecycle), §2.7 (buffering-injection negative test), §2.4 (tool-call accumulator) |
| WIRE-13 | `POST /api/streaming-token` — AssemblyAI mint, gated 503 | §2.5 (provider call patterns), §2.6 (rate-limit), §3 wave decomposition |
| WIRE-14 | `POST /api/deepgram-streaming-token` — Deepgram Grant-Token mint, gated 503 | §2.5 |
| WIRE-15 | `POST /api/openai-realtime-token` — OpenAI client_secrets, `streams=1\|2` parallel mints | §2.5 (Promise.all), §2.6 |
| SCALE-05 | Streaming endpoints (NDJSON, WSS) survive ingress timeouts up to 1h; per-line flush | §2.2 (flush), §2.3 (Traefik dedicated entrypoint), §3 wave decomposition |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Strict TDD per atomic commit (RED→GREEN→REFACTOR). No "tests later."
- ≥90/90/90/90 coverage floor (lines/branches/functions/statements) on every new/modified file.
- E2E mandatory for any user-visible route; lives in `tests/e2e/`, runs via `make e2e-test` gated on `E2E=1`.
- No mocks of internal logic — only at process/network boundaries (provider HTTP, OS time, filesystem).
- Real services in tests via testcontainers / docker-compose (real Valkey, real Traefik, real Fastify).
- GitHub Actions only sanctioned CI; workflows run unit + integration + contract + e2e on every PR.
- English-only source artifacts.

## 1. Executive Summary

- **Producer pattern is locked: hand-rolled async generator.** No Vercel AI SDK server-side (chunk-vocabulary mismatch + active LiteLLM↔AI-SDK bugs). The implementation is a ~120-LoC pure async generator over a `ReadableStream<Uint8Array>` with a partial-frame buffer split on `\n\n` SSE boundaries, plus a tool-call accumulator keyed on `delta.tool_calls[].index`. Both pieces are framework-free pure functions and fully unit-testable from recorded fixtures — the path to ≥90/90/90/90 coverage runs through a fixture corpus, not a live LiteLLM container.
- **Flush mechanics on Node 24 are kernel-driven, not API-driven.** `http.ServerResponse.flush()` does not exist by default (only added by `compression`). The canonical idiom is `Transfer-Encoding: chunked` (Fastify auto) + `reply.raw.flushHeaders()` once + `request.raw.socket.setNoDelay(true)` to disable Nagle + `reply.raw.write(line)` per chunk. The defensive `typeof reply.raw.flush === 'function'` guard is harmless but a no-op in our stack.
- **Traefik 3 per-route timeout is achieved via a dedicated entrypoint, not middleware.** Traefik 3 has no per-router timeout middleware — `respondingTimeouts` is set per `entryPoint`. The current dynamic.yml already has an `api-realtime` router on `:443` with a 3700s `serversTransport.idleConnTimeout`, but the global `:443` entrypoint also runs at 3700s read/write — every short-JSON route on `:443` shares those long timeouts today. Phase 4 splits this: a new `websecure-realtime` entrypoint on `:8443` carries the long timeouts; `:443` reverts to defaults; the realtime router moves to `websecure-realtime`.
- **The buffering-injection negative-control test is non-optional and is the single most important test in the phase.** Without it, the 500ms first-line assertion is a false negative waiting to happen — any change in Traefik defaults or any plugin that wraps `reply.raw` could silently insert buffering and the latency test would still pass against a degenerate "all chunks already buffered when timer starts" race. The negative test pins the methodology by inserting `stream.Transform({highWaterMark:4096})` and asserting the assertion *fails*.
- **Token mints are three trivially-shaped undici calls.** All three providers (AssemblyAI v3, Deepgram Grant-Token, OpenAI client_secrets) take a single auth header and a tiny body, return a single token field, and have well-known TTLs. The complexity lives in error mapping (uniform 503 envelope per D-18), per-user rate limit (D-19, reuses Phase 2 keyGenerator override), and the `Promise.all` failure mode for `streams=2` (fail-fast, no partial success leakage to the wire).
- **Wave decomposition is largely parallel.** The four route implementations are independent; the SSE parser + tool-call accumulator are pure utilities; the Traefik entrypoint move is independent. The only true serial dependency is: `agent/stream` route depends on the SSE parser landing first; `tests/e2e/mock-realtime` depends on the new entrypoint landing first; nightly soak depends on everything. Five waves cover it.
- **Primary recommendation:** Plan five waves (Wave 0 spike → Wave 1 utilities + tokens + ingress in parallel → Wave 2 agent/stream + mock-realtime → Wave 3 contract + e2e + buffering-injection → Wave 4 nightly soak workflow). Coverage strategy hinges on a fixture corpus of recorded LiteLLM SSE chunks committed under `apps/api/src/routes/agent/__fixtures__/`.

## 2. Implementation Patterns

### 2.1 Hand-Rolled SSE→NDJSON Producer (D-01, D-02, D-03, D-06)

**File: `apps/api/src/routes/agent/sse-to-ndjson.ts` (pure utility, framework-free)**

The producer is a pure async generator that consumes `response.body` from `undici.fetch` and yields BACKEND_SPEC-shaped chunks. It is intentionally NOT a Fastify-aware function — that boundary is what makes it ≥90/90/90/90-testable from fixtures.

```ts
// Pseudocode — planner expands to full implementation in TDD
import type { ToolCallAccumulator } from "./tool-call-accumulator.js";

export interface SseToNdjsonInput {
  body: ReadableStream<Uint8Array>;
  acc: ToolCallAccumulator; // injected, see §2.4
}

export type StreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; result: unknown }
  | { type: "finish"; finishReason: string; usage: { promptTokens: number; completionTokens: number } };

export async function* sseToNdjson(input: SseToNdjsonInput): AsyncGenerator<StreamChunk> {
  const reader = input.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";  // partial-frame buffer carried across read() calls

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE frames are delimited by `\n\n`. Within a frame, lines starting
      // with `data: ` carry the JSON payload. `data: [DONE]` is the sentinel.
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLine = frame
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const payload = dataLine.slice(6); // strip "data: "
        if (payload === "[DONE]") return; // end-of-stream sentinel
        const json = JSON.parse(payload); // OpenAI streaming chunk
        yield* translateChunk(json, input.acc); // returns 0..N StreamChunks
      }
    }
    // Drain any final frame (no trailing \n\n) — defensive; OpenAI always
    // terminates with [DONE], but we tolerate the malformed case.
    if (buf.trim().length > 0) {
      const tail = buf.split("\n").find((l) => l.startsWith("data: "));
      if (tail && tail.slice(6) !== "[DONE]") {
        try {
          const json = JSON.parse(tail.slice(6));
          yield* translateChunk(json, input.acc);
        } catch {
          // Premature close mid-frame — surface to caller via error chunk
          yield { type: "finish", finishReason: "incomplete", usage: { promptTokens: 0, completionTokens: 0 } };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

**Key invariants enforced by this shape:**

- `TextDecoder({stream:true})` correctly handles UTF-8 multi-byte characters split across `read()` boundaries.
- The partial-frame buffer (`buf`) is the only mutable state across reads; everything else is per-frame.
- `yield* translateChunk(...)` may emit 0, 1, or N chunks per upstream delta (a `delta` with both text and a tool-call increment fans out to one `text-delta` plus tool-call accumulation; `finish_reason==="tool_calls"` flushes accumulator state into one `tool-call` chunk per `index`).
- Premature close (no `[DONE]`) is handled by the `finally` + tail-drain path → emits a `finish` chunk with `finishReason:"incomplete"` so the desktop client never hangs.

**Fixture corpus for ≥90/90/90/90 coverage** — committed under `apps/api/src/routes/agent/__fixtures__/`:

- `text-only.sse` — text-only stream, multi-token, terminates with `[DONE]` and a final usage chunk.
- `single-tool-call.sse` — one tool call, `arguments` JSON split across 5 deltas.
- `multi-tool-call.sse` — two tool calls (`index:0` and `index:1`) interleaved deltas.
- `text-then-tool.sse` — text deltas followed by a tool call (the LiteLLM#17246 shape).
- `premature-close.sse` — stream ends mid-frame, no `[DONE]`.
- `malformed-payload.sse` — one frame contains invalid JSON (must not crash the generator).
- `utf8-split.sse` — multi-byte character (e.g., emoji) split across the read boundary.

The unit suite reads each fixture, feeds it as a `ReadableStream` (via `Readable.toWeb(Readable.from([buffer]))`), and asserts the emitted chunk array matches the expected shape. **No mocks of internal logic** — the only boundaries crossed are `TextDecoder` and `JSON.parse`, both Node built-ins.

[VERIFIED: Node 24 docs — `TextDecoder({stream:true})` is the canonical pattern for incremental decoding across chunk boundaries.]
[VERIFIED: `undici.fetch` `response.body` returns a `ReadableStream<Uint8Array>` per WHATWG Fetch — Node 24 `globalThis.fetch` is undici-backed.]

### 2.2 Fastify Lifecycle: `reply.hijack()` and Header Sequencing (D-02, D-03)

The route handler is a thin wrapper that owns the socket lifecycle. **The canonical sequence is non-obvious and load-bearing** — getting it wrong silently buffers responses or 500s after first chunk.

```ts
// apps/api/src/routes/agent/stream.ts — route handler pseudocode
async function agentStreamHandler(req: FastifyRequest, reply: FastifyReply) {
  // 1. Auth + rate-limit ALREADY ran (global onRequest hook + per-route
  //    config.rateLimit). req.user is populated.
  if (!req.user?.id) throw new AuthError("unauthorized");

  // 2. Set headers BEFORE hijack, while reply lifecycle still owns them.
  //    Fastify writes them on the first reply.send() OR on raw.flushHeaders().
  reply.header("Content-Type", "application/x-ndjson");
  reply.header("X-Accel-Buffering", "no"); // forward-compat for nginx-fronting ops
  reply.header("Cache-Control", "no-cache, no-transform");
  // No Content-Length → Transfer-Encoding: chunked is auto-added by Fastify.

  // 3. Hijack: Fastify will NOT call reply.send() / serializer / error handler
  //    after this point. We own request.raw + reply.raw end-to-end.
  reply.hijack();

  // 4. Now flush headers to wire. From this moment, the client's TCP read
  //    can resolve with 200 + headers immediately; first byte of body
  //    arrives whenever we write it.
  reply.raw.flushHeaders();

  // 5. Disable Nagle — each write() should hit the wire as its own TCP
  //    segment. Without this, small writes coalesce into ~40ms-delayed
  //    segments and the 500ms first-line assertion gets noisy.
  req.raw.socket?.setNoDelay(true);

  // 6. Wire upstream-close → downstream-close so client disconnects abort
  //    the LiteLLM stream (no orphaned upstream calls).
  const abort = new AbortController();
  req.raw.once("close", () => abort.abort());

  // 7. Open upstream undici stream.
  const upstream = await fetch(`${LITELLM_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${LITELLM_MASTER_KEY}`,
      "x-litellm-spend-logs-metadata": JSON.stringify({
        openwhispr_request_id: req.id,
        openwhispr_user_id: req.user.id,
      }),
    },
    body: JSON.stringify({
      model: req.body.model ?? process.env.DEFAULT_AGENT_MODEL ?? "qwen/qwen3.6-plus",
      messages: prependSystemPrompt(req.body.messages, req.body.systemPrompt),
      tools: translateLegacyTools(req.body.tools),
      stream: true,
      stream_options: { include_usage: true },
      user: req.user.id,
    }),
    signal: abort.signal,
  });

  if (!upstream.ok || !upstream.body) {
    // Upstream HTTP error — emit one error-finish chunk and end.
    reply.raw.write(JSON.stringify({ type: "finish", finishReason: "upstream_error", usage: { promptTokens: 0, completionTokens: 0 } }) + "\n");
    reply.raw.end();
    return;
  }

  // 8. Capture x-litellm-call-id for spend-log correlation (server-side log only).
  req.log.info({ litellmCallId: upstream.headers.get("x-litellm-call-id") }, "agent stream open");

  // 9. Drain the generator → write per chunk.
  try {
    const acc = createToolCallAccumulator();
    for await (const chunk of sseToNdjson({ body: upstream.body, acc })) {
      reply.raw.write(JSON.stringify(chunk) + "\n");
    }
  } catch (err) {
    req.log.error({ err }, "agent stream error mid-stream");
    // Emit one final error chunk if the socket is still writable.
    if (!reply.raw.writableEnded) {
      reply.raw.write(JSON.stringify({ type: "finish", finishReason: "stream_error", usage: { promptTokens: 0, completionTokens: 0 } }) + "\n");
    }
  } finally {
    if (!reply.raw.writableEnded) reply.raw.end();
  }
}
```

**Critical lifecycle facts:**

- After `reply.hijack()`, **Fastify's global error handler does NOT fire**. Errors thrown after hijack hit the `try/catch` in this handler, not `setErrorHandler`. This is documented Fastify behavior; the contract test for malformed-upstream cases must assert this directly (the response is NOT the canonical envelope; it's a synthetic `finish` chunk).
- `reply.header(...)` BEFORE `reply.hijack()` sets headers via Fastify's reply object; they're written to `reply.raw` headers automatically when `flushHeaders()` is called. Setting them post-hijack via `reply.raw.setHeader(...)` also works but is harder to read.
- `reply.raw.flushHeaders()` is idempotent in Node 24 — subsequent calls are no-ops.
- `setNoDelay(true)` is a one-call, persistent setting on the socket. No need to re-apply per write.

[VERIFIED: Fastify 5 docs — `reply.hijack()` "Sometimes you might need to halt the execution of the normal request lifecycle and handle sending the response manually." Error handler does not fire post-hijack.]
[VERIFIED: Node 24 `net.Socket.setNoDelay(true)` disables Nagle for the lifetime of the socket.]

### 2.3 Traefik 3 Dedicated Realtime Entrypoint (D-21)

**Current state:** `compose/traefik/traefik.yml` has `:443` running with `respondingTimeouts: { readTimeout: 3700s, writeTimeout: 3700s, idleTimeout: 180s }`. **Every short-JSON route on `:443` inherits the long read/write timeout.** This was acceptable for Phase 3 (only one realtime route was on `:443` and the catch-all routes were short by design), but D-21 explicitly says "Keep `:443` (`websecure`) at default short timeouts for all other routes."

**Phase 4 changes** (concrete YAML the planner emits as exact diffs):

`compose/traefik/traefik.yml`:

```yaml
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint: { to: websecure, scheme: https, permanent: true }
  websecure:
    address: ":443"
    http: { tls: {} }
    forwardedHeaders:
      trustedIPs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]
    # Phase 4 D-21: revert to Traefik defaults. Short-JSON routes do not
    # need 3700s read/write timeouts.
    transport:
      respondingTimeouts:
        readTimeout: 60s        # Traefik 3 default
        writeTimeout: 0          # Traefik 3 default (0 = no timeout, gives handlers time)
        idleTimeout: 180s        # Traefik 3 default
  websecure-realtime:
    # Phase 4 D-21 — dedicated entrypoint for WSS /v1/realtime ONLY.
    # The 3600s ceiling (BACKEND_SPEC L788-L791) lives here so :443
    # stays clean.
    address: ":8443"
    http: { tls: {} }
    forwardedHeaders:
      trustedIPs: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]
    transport:
      respondingTimeouts:
        readTimeout: 0           # No read timeout — realtime sessions can be silent
        writeTimeout: 0
        idleTimeout: 3600s       # Hard 1h ceiling
  ping: { address: ":8081" }
  traefik: { address: ":8080" }
```

`compose/traefik/dynamic.yml` — change router binding for `api-realtime`:

```yaml
http:
  routers:
    api-realtime:
      rule: "Host(`api.localhost`) && PathPrefix(`/v1/realtime`)"
      service: api-realtime-svc
      entryPoints: [websecure-realtime]   # CHANGED from [websecure]
      priority: 100
      tls: {}
```

`docker-compose.yml` — port mapping addition:

```yaml
services:
  traefik:
    ports:
      - "80:80"
      - "443:443"
      - "8443:8443"   # NEW Phase 4 D-21 — websecure-realtime entrypoint
      - "8081:8081"
      - "8080:8080"
```

**ACME on a non-443 entrypoint — verified blocker:**

Let's Encrypt HTTP-01 challenge **must hit port 80**; TLS-ALPN-01 challenge **must hit port 443**. Neither can be redirected to `:8443`. Three viable paths:

1. **(Recommended) Cert reuse via shared `tls.certificates`.** Both entrypoints reference the same cert files in `tls.certificates` (already done — `dynamic.yml` lines 106-109 set `/certs/local.crt` + `/certs/local.key`). For dev/local, this is mkcert-issued and Just Works. For production with cert-manager (Helm), the same Secret is mounted to the Traefik container and both entrypoints share it. **No ACME on `:8443` directly required.**
2. **DNS-01 challenge.** If the operator wants ACME-issued certs without exposing port 80, switch the cert resolver to a DNS-01 provider (Cloudflare, Route53, etc.). Operator-facing config; out of Phase 4 scope but document in `docs/operations.md` as a TODO.
3. **HTTP-01 via the existing `:80` entrypoint, cert stored centrally, both `:443` and `:8443` reference it.** This is the production K8s topology with cert-manager + traefik-cert-resolver. Same deal: one cert, two entrypoints.

**Recommendation:** Phase 4 ships path 1 (cert reuse — already in place for dev). Operator-facing prod docs noting paths 2/3 land in Phase 9 (DEPLOY-*).

[CITED: https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/ — `respondingTimeouts` is a per-entryPoint, per-transport setting; no per-router middleware exists.]
[CITED: https://letsencrypt.org/docs/challenge-types/ — HTTP-01 must hit port 80; TLS-ALPN-01 must hit port 443; no arbitrary-port option.]

### 2.4 Tool-Call Delta Accumulator (D-09)

**File: `apps/api/src/routes/agent/tool-call-accumulator.ts` (pure state machine)**

```ts
interface PartialToolCall {
  id?: string;
  name?: string;
  args: string;       // accumulated JSON-string fragments — parsed only on flush
}

export function createToolCallAccumulator() {
  const state = new Map<number, PartialToolCall>(); // keyed by delta.tool_calls[i].index

  return {
    /** Absorb one delta. Mutates state; emits nothing. */
    absorb(delta: { tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }): void {
      if (!delta.tool_calls) return;
      for (const tc of delta.tool_calls) {
        const cur = state.get(tc.index) ?? { args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        state.set(tc.index, cur);
      }
    },
    /** Flush on finish_reason==="tool_calls". Emits one chunk per index in order. */
    flush(): Array<{ type: "tool-call"; toolCallId: string; toolName: string; args: unknown }> {
      const out: Array<{ type: "tool-call"; toolCallId: string; toolName: string; args: unknown }> = [];
      const keys = [...state.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        const p = state.get(k)!;
        if (!p.name) continue; // malformed — skip silently (logged at caller)
        let parsed: unknown;
        try { parsed = JSON.parse(p.args || "{}"); } catch { parsed = { __unparsed: p.args }; }
        out.push({
          type: "tool-call",
          toolCallId: p.id ?? `tc_${k}`,
          toolName: p.name,
          args: parsed,
        });
      }
      state.clear();
      return out;
    },
    /** Safety: if finish_reason==="stop" but state has partial accumulators,
     *  caller should NOT flush them (they were aborted) — but caller MAY log
     *  a malformed-upstream warning. Returns true if state is non-empty. */
    hasPending(): boolean { return state.size > 0; },
  };
}
```

**Safety behavior on `finish_reason==="stop"` with pending state:**

This is the LiteLLM#17246 shape (text + dropped tool-call). Per CONTEXT D-08/D-09: do NOT emit a partial tool-call. Log a structured warning (`req.log.warn({pendingToolCalls: acc.hasPending()}, "...")`), discard accumulator state, emit only the `finish` chunk. The desktop client treats `finish` with no preceding `tool-call` as "model gave up on tools, deliver text" — correct UX.

**Coverage strategy:** the accumulator is a pure object — every branch is hit by the fixture corpus (single, multi, malformed-args, missing-name, finish-with-pending). 100% achievable.

### 2.5 Provider API Call Patterns for Token Mints (D-13 — D-20)

Each token-mint route is a single undici `fetch` with an `AbortController` for the 5s total timeout, 3s connect timeout via `connect: { timeout: 3000 }` on a dedicated `Agent`. **All three follow the same skeleton; differences are in URL/method/auth/body/response-mapping.**

```ts
// apps/api/src/routes/tokens/_call-provider.ts — shared helper
import { Agent, fetch } from "undici";

const providerAgent = new Agent({ connect: { timeout: 3000 } });

export async function callProvider(opts: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  envVarName: string;       // for the 503 message on missing-key gating
  providerLabel: string;    // human label for the 503 message
}): Promise<{ ok: true; json: unknown } | { ok: false; status: 503; message: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: ctrl.signal,
      dispatcher: providerAgent,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 503, message: `${opts.providerLabel} not configured (set ${opts.envVarName} in .env)` };
    }
    if (res.status === 429 || res.status >= 500) {
      return { ok: false, status: 503, message: `${opts.providerLabel} token mint upstream error` };
    }
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, status: 503, message: `${opts.providerLabel} token mint malformed response` };
    return { ok: true, json };
  } catch (err) {
    return { ok: false, status: 503, message: `${opts.providerLabel} token mint timed out` };
  } finally {
    clearTimeout(t);
  }
}
```

**Per-provider call shapes:**

**AssemblyAI v3 (D-14)** — `apps/api/src/routes/tokens/assemblyai.ts`:

```ts
const ttl = Number(process.env.ASSEMBLYAI_TOKEN_TTL ?? 60);
const r = await callProvider({
  url: `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${ttl}`,
  method: "GET",
  headers: { authorization: process.env.ASSEMBLYAI_API_KEY! }, // NOTE: no "Bearer" prefix per AssemblyAI v3 docs
  envVarName: "ASSEMBLYAI_API_KEY",
  providerLabel: "AssemblyAI",
});
if (!r.ok) return reply.code(r.status).send({ error: r.message });
const token = (r.json as { token?: string }).token;
if (typeof token !== "string") return reply.code(503).send({ error: "AssemblyAI token mint malformed response" });
return reply.send({ token });
```

**Deepgram Grant Token (D-15)** — `apps/api/src/routes/tokens/deepgram.ts`:

```ts
const ttl = Number(process.env.DEEPGRAM_TOKEN_TTL ?? 30);
const r = await callProvider({
  url: "https://api.deepgram.com/v1/auth/grant",
  method: "POST",
  headers: {
    authorization: `Token ${process.env.DEEPGRAM_API_KEY!}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ ttl_seconds: ttl }),
  envVarName: "DEEPGRAM_API_KEY",
  providerLabel: "Deepgram",
});
if (!r.ok) return reply.code(r.status).send({ error: r.message });
const accessToken = (r.json as { access_token?: string }).access_token;
if (typeof accessToken !== "string") return reply.code(503).send({ error: "Deepgram token mint malformed response" });
return reply.send({ token: accessToken });
```

**OpenAI Realtime client_secrets (D-16, D-17)** — `apps/api/src/routes/tokens/openai-realtime.ts`:

```ts
const streams = Number(req.body.streams ?? 1);
if (streams !== 1 && streams !== 2) return reply.code(400).send({ error: "streams must be 1 or 2" });

const mintOne = () => callProvider({
  url: "https://api.openai.com/v1/realtime/client_secrets",
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ session: { type: "realtime", model: req.body.model ?? "gpt-realtime" } }),
  envVarName: "OPENAI_API_KEY",
  providerLabel: "OpenAI Realtime",
});

// Promise.all is fail-fast: if one mint fails, the whole request fails.
// Do NOT use Promise.allSettled — partial success leakage to wire is worse
// than fail-fast (desktop retries cleanly on 503).
const results = await Promise.all(streams === 2 ? [mintOne(), mintOne()] : [mintOne()]);
const failed = results.find((r) => !r.ok);
if (failed && !failed.ok) return reply.code(failed.status).send({ error: failed.message });

const secrets = results.map((r) => (r.ok ? (r.json as { value: string }).value : ""));
if (secrets.some((s) => !s)) return reply.code(503).send({ error: "OpenAI Realtime token mint malformed response" });
return reply.send({ clientSecret: secrets[0], clientSecrets: secrets });
```

**Missing-key gating** is checked at the route's preHandler (cheap), NOT inside the call helper:

```ts
fastify.post("/api/streaming-token", { preHandler: [requireAssemblyAIConfigured] }, handler);

function requireAssemblyAIConfigured(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    reply.code(503).send({ error: "AssemblyAI not configured (set ASSEMBLYAI_API_KEY in .env)" });
    return; // do not call done() — reply was sent
  }
  done();
}
```

This shape ensures the 503 envelope is byte-identical to the contract test's expectation regardless of which path triggers it (preHandler or in-handler error mapping).

[VERIFIED: AssemblyAI v3 docs (https://www.assemblyai.com/docs/api-reference/streaming-api/generate-streaming-token) — `Authorization: <KEY>` (no Bearer prefix), `expires_in_seconds` query param, returns `{token}`.]
[VERIFIED: Deepgram Grant-Token docs (https://developers.deepgram.com/reference/token-based-auth-api/grant-token) — `POST /v1/auth/grant`, `Authorization: Token <KEY>`, returns `{access_token, expires_in}`.]
[VERIFIED: OpenAI Realtime client_secrets docs (https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret) — body shape `{session:{type:"realtime", model:"..."}}`, returns `{value:"ek_...", session:{...}}`.]

### 2.6 Per-User Rate Limit on Token Mints (D-19)

The Phase 2 plugin (`apps/api/src/plugins/rate-limit.ts`) registers `@fastify/rate-limit` globally with a `keyGenerator: (req) => req.ip` default. **`@fastify/rate-limit` v10 supports per-route `config.rateLimit` overrides INCLUDING `keyGenerator` overrides** — verified directly in the existing plugin code (lines 85-90 set the global keyGenerator; per-route overrides shadow it).

The four Phase 4 routes apply per-route configs:

```ts
fastify.post("/api/streaming-token", {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: "1 minute",
      keyGenerator: (req: FastifyRequest) => req.user?.id ?? req.ip,
    },
  },
  preHandler: [requireAssemblyAIConfigured],
}, handler);
```

**Phase 2 plugin requires NO modification.** The keyGenerator override is a vanilla `@fastify/rate-limit` v10 feature. The unit test confirms by stubbing the global plugin with the per-route override and asserting the bucket key changes from `<ip>` to `<userId>`.

**`/api/agent/stream` rate limit:** CONTEXT.md does not specify an explicit per-route rate-limit for `/api/agent/stream`. Recommendation: the global 60/min/IP applies (Phase 2 default). Per-user override is **not** required for this phase; document in plan that future hardening may add a stream-concurrency limit (Phase 6 SCALE-04).

[VERIFIED: `@fastify/rate-limit` v10 docs — per-route `config.rateLimit.keyGenerator` shadows the global. Confirmed in `apps/api/src/plugins/rate-limit.ts` lines 85-89.]

### 2.7 Buffering-Injection Negative-Control Test (D-05)

This is the most important test in the phase. The test design pins methodology, not just outcome.

**Test A — positive (unit, no Traefik):** `tests/unit/agent-stream-flush-positive.test.ts`

```ts
// Boot a tiny Fastify instance with a fixture route that emits 10 NDJSON
// lines at 100ms cadence using the same hijack+raw.write pattern as the
// real /api/agent/stream. Open a undici raw socket; mark t0 at request-
// send; mark t1 at first byte received. Assert (t1 - t0) < 200ms.
import Fastify from "fastify";
import { fetch } from "undici";

const app = Fastify();
app.post("/test-stream", async (req, reply) => {
  reply.header("Content-Type", "application/x-ndjson");
  reply.hijack();
  reply.raw.flushHeaders();
  for (let i = 0; i < 10; i++) {
    reply.raw.write(JSON.stringify({ i }) + "\n");
    await sleep(100);
  }
  reply.raw.end();
});
const url = await app.listen({ port: 0 });

const t0 = performance.now();
const res = await fetch(`${url}/test-stream`, { method: "POST" });
const reader = res.body!.getReader();
const { value } = await reader.read();
const t1 = performance.now();
expect(value).toBeDefined();
expect(t1 - t0).toBeLessThan(200);
```

**Test B — negative-control (unit):** `tests/unit/agent-stream-flush-negative.test.ts`

```ts
// SAME assertion, but the route is wrapped in a stream.Transform with
// highWaterMark:4096 that buffers until full. The first line is 12 bytes;
// 10 lines = 120 bytes; the transform never flushes mid-stream because
// the buffer never fills. Assert first-byte arrival > 800ms (proving
// our positive test would have caught buffering).
import { Transform } from "node:stream";

app.post("/test-stream-buffered", async (req, reply) => {
  reply.header("Content-Type", "application/x-ndjson");
  reply.hijack();
  reply.raw.flushHeaders();
  const buffering = new Transform({
    highWaterMark: 4096,
    transform(chunk, _enc, cb) { this.push(chunk); cb(); },
  });
  buffering.pipe(reply.raw);
  for (let i = 0; i < 10; i++) {
    buffering.write(JSON.stringify({ i }) + "\n");
    await sleep(100);
  }
  buffering.end();
});

// First-line latency MUST be > 800ms — proves the test methodology
// catches buffering. If this assertion fires < 800ms, our positive
// test (Test A) is a false negative.
expect(t1 - t0).toBeGreaterThan(800);
```

**Test C — e2e through real Traefik:** `tests/e2e/agent-stream-first-line-latency.test.ts`

```ts
// Through the actual `make e2e-up` stack (Traefik :443 + api + mock
// LiteLLM). Mock LiteLLM emits 10 SSE chunks at 100ms cadence (configured
// in litellm_config.contract.yaml mock_response — see §2.8). Assert the
// first NDJSON line arrives < 500ms after request headers received.
const t0 = performance.now();
const res = await fetch(`${BACKEND_URL}/api/agent/stream`, {
  method: "POST",
  headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
});
expect(res.status).toBe(200);
expect(res.headers.get("content-type")).toBe("application/x-ndjson");
const reader = res.body!.getReader();
const { value } = await reader.read();
const t1 = performance.now();
expect(value).toBeDefined();
expect(t1 - t0).toBeLessThan(500);
```

**Test D — buffering-middleware-absent assertion (e2e or integration):** `tests/integration/traefik-no-buffering.test.ts`

```ts
// Read compose/traefik/dynamic.yml; assert no `buffering` middleware is
// attached to any router on the websecure or websecure-realtime entrypoints.
// This is a static structural assertion — it can't false-negative the way
// timing tests can, and it proves Traefik's no-buffering-by-default is
// preserved when the planner edits the YAML.
import yaml from "yaml";
const config = yaml.parse(readFileSync("compose/traefik/dynamic.yml", "utf-8"));
for (const router of Object.values(config.http?.routers ?? {})) {
  expect((router as any).middlewares ?? []).not.toContain(expect.stringMatching(/buffering/i));
}
```

**Recommendation:** Land Tests A + B + D in Wave 3 unit + integration. Land Test C in Wave 3 e2e (it gates Wave 4). Test D is the cheapest insurance — it costs zero CPU and catches the most likely regression.

### 2.8 Mock LiteLLM Streaming Configuration for Contract Tests (D-29)

LiteLLM's `mock_response` for chat-completions supports streaming since v1.40+. To emit chunks at a controlled cadence, the config injects a multi-token mock string:

```yaml
# compose/litellm/litellm_config.contract.yaml — Phase 4 addition
- model_name: qwen3.6-plus-streaming
  litellm_params:
    model: openai/qwen3.6-plus
    api_key: "fake-key-for-mock"
    # When stream=true is set on the request, LiteLLM tokenizes this
    # response and emits one SSE chunk per token at ~50ms cadence.
    mock_response: "This is a deliberately long mock response with many tokens spaced over time so the contract test can measure first-line latency and per-line cadence."
```

The contract test asserts:

- `Content-Type: application/x-ndjson` on response headers.
- First NDJSON line arrives < 500ms.
- Each subsequent line arrives within ~150ms of the prior (no end-of-response bunching).
- Final `finish` chunk has `usage.promptTokens >= 0`, `usage.completionTokens >= 0`.

[VERIFIED: LiteLLM docs (https://docs.litellm.ai/docs/proxy/configs#mock-responses) — `mock_response` supports streaming when `stream:true` is requested.]

### 2.9 Hermetic Mock-Realtime WS Server (D-22)

`tests/e2e/mock-realtime/server.ts` — ~50 LoC standalone Node service:

```ts
import Fastify from "fastify";
import websocket from "@fastify/websocket";

const app = Fastify();
await app.register(websocket);

app.get("/v1/realtime", { websocket: true }, (conn) => {
  // OpenAI Realtime protocol: send session.created on connect.
  conn.socket.send(JSON.stringify({
    type: "session.created",
    session: { id: `sess_${Date.now()}`, object: "realtime.session" },
  }));

  conn.socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    // Echo response.create → response.done for the soak loop.
    if (msg.type === "response.create") {
      conn.socket.send(JSON.stringify({ type: "response.done", response: { id: `resp_${Date.now()}` } }));
    }
  });
  // ws lib auto-handles ping/pong frames at the protocol layer.
});

await app.listen({ port: 8765, host: "0.0.0.0" });
```

Compose service (in a new `compose/e2e/docker-compose.e2e.yml` profile):

```yaml
services:
  mock-realtime:
    profiles: [e2e]
    build: ./tests/e2e/mock-realtime
    networks: [openwhispr_internal]
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(0)"]
```

E2E harness override: when the e2e profile is active, the litellm container's realtime model is configured to point at `ws://mock-realtime:8765/v1/realtime` instead of OpenAI. The api → litellm → mock-realtime chain is fully hermetic.

[VERIFIED: `@fastify/websocket` v11 is the canonical Fastify 5 WS plugin. ws library handles ping/pong frames at protocol layer per RFC 6455.]

### 2.10 Live 65-Min Soak Workflow (D-23, D-24, D-25)

`.github/workflows/nightly-realtime-soak.yml`:

```yaml
name: nightly-realtime-soak
on:
  schedule:
    - cron: "0 6 * * *"     # 06:00 UTC daily
  push:
    tags: ["v*"]
jobs:
  soak:
    if: github.event_name == 'schedule' || startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - run: docker compose --profile e2e up -d --wait
      - name: 65-min realtime soak against OpenAI
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENWHISPR_E2E: "1"
        run: pnpm -F @openwhispr/e2e test:realtime-soak
      - name: archive close-frame log
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: soak-log
          path: tests/e2e/realtime-soak.log
```

`tests/e2e/realtime-soak.test.ts` design:

```ts
// Uses `ws` library directly (not @fastify/websocket — that's server-side).
// Connects to wss://api.localhost:8443/v1/realtime via Traefik on the
// dedicated entrypoint. Drives ping every 20s. Records every message
// + close frame with timestamp. Runs for 3900s (65 min + 5 min margin).
import WebSocket from "ws";

const ws = new WebSocket("wss://api.localhost:8443/v1/realtime", {
  headers: { authorization: `Bearer ${bearer}` },
  rejectUnauthorized: false,
});
const closeLog: Array<{ t: number; code: number; reason: string; isOurs: boolean }> = [];
const pingRtts: number[] = [];

ws.on("open", () => { /* start ping interval */ });
ws.on("close", (code, reason) => {
  const elapsed = (Date.now() - start) / 1000;
  // OpenAI random 1006 disconnects: distinguishable by upstream proximity.
  // Our ingress never emits 1006 — Traefik's idle/read timeouts surface
  // as a clean close at exactly the timeout boundary (1011 or 1001).
  const isOurs = elapsed < 3600 && [1001, 1011].includes(code);
  closeLog.push({ t: elapsed, code, reason: reason.toString(), isOurs });
});

await sleep(3900_000);

// Assertion: no close attributable to OUR ingress chain before T+3900s.
const ingressCloses = closeLog.filter(c => c.isOurs);
expect(ingressCloses).toEqual([]);
expect(percentile(pingRtts, 0.95)).toBeLessThan(1000);
```

**Distinguishing close codes** (recorded in plan as a reference table for the test author):

| Close code | Origin | Phase 4 verdict |
|------------|--------|-----------------|
| 1000 (normal) | Either side | Pass — clean close after the 65-min window |
| 1001 (going away) | Server-emitted Traefik shutdown | **FAIL if before T+3600s** — ingress disconnect |
| 1006 (abnormal, no close frame) | Network or upstream | Pass — OpenAI-side flake (community-documented) |
| 1011 (server error) | Traefik or Fastify | **FAIL** — ingress error |
| 1013 (try again later) | Upstream rate-limit | Pass — record but don't fail |

[CITED: OpenAI Realtime random 1006 disconnects — community thread linked in CONTEXT canonical refs.]

## 3. Wave Decomposition Recommendation

The planner is welcome to override; this is a starting framework optimized for parallelism while respecting hard dependencies.

### Wave 0 — Pre-implementation Spikes (sequential, ~2-3 hrs total)

**Goal:** Eliminate "I don't know what the upstream wire shape actually looks like" risk before any TDD test is written.

- **W0-S1: Capture LiteLLM SSE chunk fixtures.** Spin up `compose/litellm/litellm_config.contract.yaml` locally, hit `/v1/chat/completions` with `stream:true` for each of the 7 fixture scenarios in §2.1. Save raw SSE output to `apps/api/src/routes/agent/__fixtures__/*.sse`. **Without this, the unit suite has nothing to assert against.**
- **W0-S2: Verify OpenAI `/v1/realtime/client_secrets` response shape.** Hit the live endpoint once with `curl`; capture the exact JSON keys (CONTEXT D-16 says `{value:"ek_...", session:{...}}` — confirm field name is `value` and not `client_secret` or similar). Save fixture under `apps/api/src/routes/tokens/__fixtures__/openai-client-secret-response.json`.
- **W0-S3: Verify Deepgram Grant-Token + AssemblyAI v3 token response shapes** with curl. Save fixtures.

These spikes are *recorded as committed fixtures*, not throwaway scripts — they become the evidence that ≥90/90/90/90 unit tests are testing reality, not assumed shapes.

### Wave 1 — Pure utilities + token routes + ingress (parallel)

All independent of each other. Five plans run in parallel:

- **W1-P1:** SSE→NDJSON parser (`apps/api/src/routes/agent/sse-to-ndjson.ts`) + tool-call accumulator (`apps/api/src/routes/agent/tool-call-accumulator.ts`). Pure utilities. TDD against W0-S1 fixtures.
- **W1-P2:** AssemblyAI token route (`apps/api/src/routes/tokens/assemblyai.ts`) + unit tests. Reuses Phase 2 dual-auth + rate-limit pattern.
- **W1-P3:** Deepgram token route (`apps/api/src/routes/tokens/deepgram.ts`) + unit tests.
- **W1-P4:** OpenAI Realtime token route (`apps/api/src/routes/tokens/openai-realtime.ts`) + unit tests. Includes the `Promise.all` parallel-mint logic for `streams=2`.
- **W1-P5:** Traefik dedicated entrypoint (`compose/traefik/traefik.yml` + `compose/traefik/dynamic.yml` + `docker-compose.yml` port mapping). Plus integration test that boots compose and asserts `:8443` is reachable with the expected timeouts.

### Wave 2 — Composite routes + mock-realtime

Depends on Wave 1.

- **W2-P1:** `/api/agent/stream` route handler (`apps/api/src/routes/agent/stream.ts`) — depends on W1-P1 utilities. Wires the hand-rolled producer + Fastify hijack + `request_id` propagation.
- **W2-P2:** Hermetic mock-realtime WS server (`tests/e2e/mock-realtime/server.ts` + Dockerfile + compose-profile) — depends on W1-P5 (the `:8443` entrypoint must exist for the soak target).
- **W2-P3:** `routes/index.ts` registrar updates — adds the four new route registrations. Depends on W1-P2..P4 + W2-P1.

### Wave 3 — Contract tests + e2e + buffering-injection

Depends on Wave 2.

- **W3-P1:** Contract tests (`packages/contract-tests/src/agent-stream.test.ts`, `streaming-token.test.ts`, `deepgram-streaming-token.test.ts`, `openai-realtime-token.test.ts`) — extends the Phase 2 zod-schema harness pattern.
- **W3-P2:** Buffering-injection negative-control unit suite (`tests/unit/agent-stream-flush-{positive,negative}.test.ts`) + structural integration test (`tests/integration/traefik-no-buffering.test.ts`).
- **W3-P3:** E2E first-line latency test (`tests/e2e/agent-stream-first-line-latency.test.ts`) — boots full compose, hits /api/agent/stream against contract-mode LiteLLM, asserts < 500ms.
- **W3-P4:** ~5-min hermetic realtime soak in e2e (`tests/e2e/realtime-soak-hermetic.test.ts`) — runs against `mock-realtime` from W2-P2 every PR.

### Wave 4 — Live nightly soak + docs

- **W4-P1:** `.github/workflows/nightly-realtime-soak.yml` + the 65-min test client (`tests/e2e/realtime-soak.test.ts`).
- **W4-P2:** `docs/operations.md` updates documenting the `:8443` entrypoint, ACME implications (DNS-01 / cert-reuse), the soak schedule, env vars (`ASSEMBLYAI_API_KEY`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_TOKEN_TTL`, `DEEPGRAM_TOKEN_TTL`, `DEFAULT_AGENT_MODEL`).
- **W4-P3:** STATE.md / ROADMAP.md phase-closure updates.

## 4. Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.x (existing in monorepo) |
| Config file | `apps/api/vitest.config.ts` (existing); `packages/contract-tests/vitest.config.ts` (existing); `tests/e2e/vitest.config.ts` (existing) |
| Quick run command | `pnpm -F @openwhispr/api test --run` |
| Full suite command | `pnpm -r test --coverage` |
| E2E command | `make e2e-test` (gated on `E2E=1`) |
| Contract command | `make contract-test BACKEND_URL=https://api.localhost` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE-07 | NDJSON content-type, per-line flush, no buffering | unit + integration + e2e + contract | unit: `pnpm -F @openwhispr/api test agent/stream`; e2e: `make e2e-test` | ❌ Wave 0/1/2/3 |
| WIRE-07 | Tool-call accumulator correctness | unit | `pnpm -F @openwhispr/api test tool-call-accumulator` | ❌ Wave 1 |
| WIRE-07 | SSE parser handles UTF-8 split, premature close, malformed | unit | `pnpm -F @openwhispr/api test sse-to-ndjson` | ❌ Wave 1 |
| WIRE-07 | First-line latency < 500ms through full chain | e2e | `make e2e-test` (gated) | ❌ Wave 3 |
| WIRE-07 | Buffering-injection negative-control | unit + integration | `pnpm test buffering-injection` | ❌ Wave 3 |
| WIRE-13 | AssemblyAI token mint shape | unit + contract | `pnpm -F @openwhispr/api test tokens/assemblyai`; `make contract-test` | ❌ Wave 1/3 |
| WIRE-13 | AssemblyAI 503 on missing key | contract | `MISSING_KEY_TEST_MODE=1 make contract-test-missing-keys` | ❌ Wave 3 |
| WIRE-14 | Deepgram token mint shape | unit + contract | `pnpm -F @openwhispr/api test tokens/deepgram`; `make contract-test` | ❌ Wave 1/3 |
| WIRE-14 | Deepgram 503 on missing key | contract | `MISSING_KEY_TEST_MODE=1 make contract-test-missing-keys` | ❌ Wave 3 |
| WIRE-15 | OpenAI Realtime mint, streams=1 | unit + contract | `pnpm -F @openwhispr/api test tokens/openai-realtime`; `make contract-test` | ❌ Wave 1/3 |
| WIRE-15 | OpenAI Realtime mint, streams=2 (Promise.all) | unit + contract | same | ❌ Wave 1/3 |
| WIRE-15 | OpenAI Realtime 503 on missing key | contract | `MISSING_KEY_TEST_MODE=1 make contract-test-missing-keys` | ❌ Wave 3 |
| WIRE-15 | Per-user rate limit (30/min/userId) | integration | `pnpm -F @openwhispr/api test:integration tokens-rate-limit` | ❌ Wave 1 |
| SCALE-05 | 65-min WSS soak through `:8443`, no ingress disconnect | e2e (hermetic + live) | hermetic: `make e2e-test`; live: nightly GHA workflow | ❌ Wave 2/3/4 |
| SCALE-05 | Traefik no-buffering-middleware structural assertion | integration | `pnpm test traefik-no-buffering` | ❌ Wave 3 |
| SCALE-05 | `:8443` entrypoint reachable with 3600s idleTimeout | integration | `pnpm test traefik-realtime-entrypoint` | ❌ Wave 1 |

### Sampling Rate

- **Per task commit:** `pnpm -F @openwhispr/api test --run` (unit suite for the touched package, ~30s).
- **Per wave merge:** `pnpm -r test --coverage` + `make contract-test` (~3 min full).
- **Phase gate:** Full suite green + `make e2e-test` (hermetic e2e with mock-realtime, ~10 min) before `/gsd-verify-work`.
- **Nightly:** Live 65-min OpenAI Realtime soak (GHA scheduled).

### Wave 0 Gaps (test infrastructure that must land before TDD red→green starts)

- [ ] `apps/api/src/routes/agent/__fixtures__/{text-only,single-tool-call,multi-tool-call,text-then-tool,premature-close,malformed-payload,utf8-split}.sse` — captured during Wave 0 spikes; required for SSE parser unit suite to be deterministic.
- [ ] `apps/api/src/routes/tokens/__fixtures__/{assemblyai-v3-token-response,deepgram-grant-token-response,openai-client-secret-response}.json` — provider-shape fixtures for token-route unit suites.
- [ ] `tests/e2e/mock-realtime/Dockerfile` + `tests/e2e/mock-realtime/server.ts` — Wave 2 P2; required for hermetic soak.
- [ ] `tests/integration/traefik-realtime-entrypoint.test.ts` — Wave 1 P5; smoke that the new `:8443` entrypoint accepts WSS upgrades.
- [ ] No new test framework install needed (Vitest + ws + undici all present).

### Coverage Strategy per File

The ≥90/90/90/90 floor is per-file-touched. Hot spots:

- **`sse-to-ndjson.ts` (pure async generator)** — 100% achievable from fixture corpus. Every branch (text delta, tool-call delta, finish, malformed JSON, premature close, UTF-8 split) hits a dedicated fixture.
- **`tool-call-accumulator.ts` (pure state machine)** — 100% achievable. Branches: new index, existing index, missing-name silent skip, malformed args fallback, hasPending getter.
- **`agent/stream.ts` (route handler)** — covers handler + auth gate + upstream fetch + abort wiring. Boundary mocks: `undici.fetch` (process boundary, allowed). Internal: real Fastify instance, real generator. Achievable ≥90 with branches for: upstream-ok, upstream-non-ok, upstream-no-body, mid-stream error, client disconnect (`request.raw.on('close')` fires AbortController). The `request.raw.on('close')` branch is covered by closing the test client mid-stream and asserting `abort.signal.aborted === true`.
- **`tokens/{assemblyai,deepgram,openai-realtime}.ts`** — `_call-provider.ts` helper handles 401, 429, 5xx, timeout, malformed-body branches; each route hits each branch via `undici.MockAgent`.
- **`tokens/openai-realtime.ts`** — additional branches: streams validation (1, 2, invalid), Promise.all fail-fast (one mint fails → whole request fails).

**Negative-control tests** (D-05):

- Buffering-injection unit positive/negative pair (Test A + Test B in §2.7).
- Structural assertion that no Traefik `buffering` middleware is attached to any router on the streaming/realtime paths (Test D).
- Missing-key 503 (`MISSING_KEY_TEST_MODE=1` profile per CONTEXT D-30, mirrors Phase 3 pattern).
- Malformed-upstream-chunk handling (premature-close, malformed-payload SSE fixtures).

## Security Domain

ASVS categories applicable to Phase 4 wire surface:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth dual-auth hook (Phase 2 D-04, reused unchanged on all 4 new routes) |
| V3 Session Management | yes | `set-auth-token` rotation preserved (Phase 2); `reply.hijack()` does not break session cookie writeback because rotation header is set during dual-auth hook BEFORE hijack |
| V4 Access Control | yes | Per-route `preHandler: requireXxxConfigured` gate; per-user rate limit (D-19) prevents leaked-bearer abuse on token mints |
| V5 Input Validation | yes | zod schemas on all 4 request bodies (`messages` array, `streams` ∈ {1,2}, etc.) |
| V6 Cryptography | yes | TLS terminates at Traefik (`:443` and `:8443`); never hand-roll. Ephemeral provider tokens are pass-through — server never persists them. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Provider master key leak via response body | Information Disclosure | Server-held keys NEVER appear in any response; only ephemeral mints (60s TTL or shorter) cross the wire to client |
| `streams=N` integer overflow / negative / array | Tampering | zod schema asserts `streams ∈ {1, 2}`; reject 400 |
| Bearer token leak in `request_id` / log line | Information Disclosure | Phase 2 plugin `request-log.ts` already scrubs `Authorization` / `Cookie` / `set-auth-token` keys; new routes inherit |
| Tool-call argument injection (model emits malicious args) | Tampering | Server is stateless re: tool execution (D-08) — emits `tool-call` chunk verbatim; desktop is responsible for safe execution. Document in plan that this is a *design choice*, not a gap. |
| Realtime WSS upgrade auth bypass | Spoofing | preHandler runs BEFORE upgrade (Phase 3 mitigation T-03-07-02 carries forward); existing test `realtime.test.ts` asserts |
| Provider-side rate limit (Deepgram, AssemblyAI) → DoS amplification | DoS | Per-user 30/min limit (D-19) bounds outbound volume; provider 429 → our 503 (D-20) — clients back off |
| Long-lived `:8443` connection slot exhaustion | DoS | 1h cap is the design ceiling; horizontal scale is Phase 6/8 territory; Phase 4 documents the per-replica concurrent-WSS slot count as an operator-facing knob |

## 5. Open Implementation Questions for the Planner

These are runtime-verifiable questions that should be resolved during Wave 0 spikes before Wave 1 plans become RED tests.

1. **(W0-S1) LiteLLM SSE chunk shape for tool_calls.** Does LiteLLM v1.83.7 emit OpenAI-compatible `delta.tool_calls[].function.arguments` string fragments verbatim, or does it pre-aggregate? The CONTEXT decision D-09 assumes verbatim. *Confirm by recording one fixture and parsing.* If pre-aggregated, the accumulator simplifies; if pass-through, the design above is correct.
2. **(W0-S2) OpenAI client_secrets response field name.** CONTEXT D-16 says `{value:"ek_...", session:{...}}`. Confirm field is `value` and not `client_secret`. Single curl call settles it.
3. **(W0-S3) Deepgram Grant-Token TTL request shape.** Some Deepgram docs show `ttl_seconds` body param, others omit it (server-default applies). Confirm body shape with one curl; if rejected, omit `ttl_seconds`.
4. **(W1-P5) Will mkcert dev cert serve `:8443` as well as `:443`?** The cert is issued for `*.localhost`; both ports use the same hostname. Smoke test with `curl --resolve api.localhost:8443:127.0.0.1 https://api.localhost:8443/health` after the entrypoint lands.
5. **(W2-P2) `@fastify/websocket` + `@fastify/http-proxy` v11 compatibility for the mock-realtime upstream.** The proxy uses `ws.WebSocketServer` internally; when the upstream is also `@fastify/websocket`, does the upgrade pass through cleanly? Recommend a quick smoke before fully writing the soak loop.
6. **(W3-P3) How does the e2e test client measure "first byte after request headers"?** Suggested approach: undici `fetch` returns a Response whose body is a `ReadableStream` that doesn't resolve until the first chunk arrives; t0 is set right before `fetch()`, t1 at the first `reader.read()` resolve. Confirm timing precision against the buffering-injection negative test.
7. **(D-29 contract) Does LiteLLM `mock_response` actually emit the configured response in N tokenized SSE chunks, or as one chunk?** The current `litellm_config.contract.yaml` mock-mode entries return single non-streamed `chatcmpl-mock` payloads. To exercise the per-line-flush assertion, we either (a) configure a streaming-friendly mock_response that LiteLLM tokenizes, or (b) replace the contract-mode upstream with a tiny test stub that emits canned SSE at controlled cadence. Recommend (b) — fully predictable, no LiteLLM-version coupling. Land as `tests/e2e/mock-litellm-streaming/` in Wave 2.

**Verdict on planning readiness:** All 7 questions are *implementation-detail* questions, not *design* questions. They resolve during Wave 0 spikes (1-2 hours total). Phase planning can proceed; W0 spike outcomes are committed as fixtures and refine the test inputs without changing the plan structure.

## 6. Files Likely Affected

The planner can use this list to scope `files_modified` in plan frontmatter. Categorized by wave.

### New files (W1)

- `apps/api/src/routes/agent/sse-to-ndjson.ts` (pure utility)
- `apps/api/src/routes/agent/tool-call-accumulator.ts` (pure utility)
- `apps/api/src/routes/agent/__fixtures__/*.sse` (7 files)
- `apps/api/src/routes/tokens/_call-provider.ts` (shared helper)
- `apps/api/src/routes/tokens/assemblyai.ts`
- `apps/api/src/routes/tokens/deepgram.ts`
- `apps/api/src/routes/tokens/openai-realtime.ts`
- `apps/api/src/routes/tokens/__fixtures__/*.json` (3 files)
- `apps/api/src/__tests__/agent/sse-to-ndjson.test.ts`
- `apps/api/src/__tests__/agent/tool-call-accumulator.test.ts`
- `apps/api/src/__tests__/tokens/{assemblyai,deepgram,openai-realtime}.test.ts`
- `apps/api/src/__tests__/tokens/_call-provider.test.ts`
- `tests/integration/traefik-realtime-entrypoint.test.ts`
- `tests/integration/tokens-rate-limit.test.ts`

### New files (W2)

- `apps/api/src/routes/agent/stream.ts` (route handler)
- `apps/api/src/__tests__/agent/stream.test.ts`
- `tests/e2e/mock-realtime/server.ts`
- `tests/e2e/mock-realtime/Dockerfile`
- `tests/e2e/mock-realtime/package.json`
- `tests/e2e/mock-litellm-streaming/server.ts` (streaming SSE stub for contract per-line-flush assertion — see Open Q #7)
- `compose/e2e/docker-compose.e2e.yml` (e2e-profile additions)

### New files (W3)

- `packages/contract-tests/src/agent-stream.test.ts`
- `packages/contract-tests/src/streaming-token.test.ts`
- `packages/contract-tests/src/deepgram-streaming-token.test.ts`
- `packages/contract-tests/src/openai-realtime-token.test.ts`
- `packages/contract-tests/src/schemas.ts` — extend with `AgentStreamRequest`, `AgentStreamChunk`, `StreamingTokenResponse`, `OpenAIRealtimeTokenResponse` zod schemas
- `tests/unit/agent-stream-flush-positive.test.ts`
- `tests/unit/agent-stream-flush-negative.test.ts`
- `tests/integration/traefik-no-buffering.test.ts`
- `tests/e2e/agent-stream-first-line-latency.test.ts`
- `tests/e2e/realtime-soak-hermetic.test.ts`

### New files (W4)

- `.github/workflows/nightly-realtime-soak.yml`
- `tests/e2e/realtime-soak.test.ts` (live 65-min)

### Modified files

- `apps/api/src/routes/index.ts` — add 4 new route registrations + relevant deps in `AllRoutesDeps`
- `apps/api/src/index.ts` — register new env vars / pass through to `buildAllRoutes`
- `compose/traefik/traefik.yml` — add `websecure-realtime` entrypoint, revert `:443` to defaults
- `compose/traefik/dynamic.yml` — change `api-realtime` router's `entryPoints` to `[websecure-realtime]`; `serversTransport` for `api-realtime-svc` can stay (still useful) but `:443` no longer forces 3700s on every other route
- `docker-compose.yml` — add `8443:8443` port mapping for traefik
- `compose/litellm/litellm_config.contract.yaml` — add `qwen3.6-plus-streaming` model with multi-token mock_response (or the W2 mock-litellm-streaming stub replaces it)
- `.env.example` — add `ASSEMBLYAI_API_KEY=`, `DEEPGRAM_API_KEY=`, `ASSEMBLYAI_TOKEN_TTL=`, `DEEPGRAM_TOKEN_TTL=`, `DEFAULT_AGENT_MODEL=` (`OPENAI_API_KEY` already present from Phase 3)
- `Makefile` — add `e2e-realtime-soak` target (hermetic, every PR), confirm `contract-test-missing-keys` exists or add per-Phase 3 plan
- `.planning/STATE.md` — phase closure entry post-verifier
- `.planning/ROADMAP.md` — Phase 4 status flip

### NOT touched (explicitly)

- `apps/api/src/routes/realtime.ts` — already correct shape per Phase 3 D-04. Phase 4 only changes the *Traefik routing* upstream of it (via D-21 entrypoint move). No code change required in this file. CONTEXT D-27 says "tightens its config" — the only knob to tighten is `wsClientOptions.handshakeTimeout: 10000` and `wsReconnect: false`; those are already valid additions but DO NOT require rewriting the file. Plan a small one-task patch.
- `apps/api/src/auth.ts` — reused unchanged (Phase 2 dual-auth hook applies to all 4 new routes via global onRequest).
- `apps/api/src/error-handler.ts` — reused unchanged (missing-key 503 envelope conforms automatically).
- `apps/api/src/plugins/rate-limit.ts` — reused unchanged (per-route `keyGenerator` override is a vanilla `@fastify/rate-limit` v10 feature; no plugin extension needed).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LiteLLM v1.83.7 emits `delta.tool_calls[].function.arguments` as string fragments (not pre-aggregated) | §2.4 tool-call accumulator | Accumulator design simplifies if wrong; W0-S1 spike resolves before TDD red |
| A2 | OpenAI client_secrets response field is `value` (not `client_secret`) | §2.5 OpenAI Realtime | Field rename only; W0-S2 spike resolves |
| A3 | Deepgram Grant-Token accepts `ttl_seconds` body param | §2.5 Deepgram | Drop param if rejected; W0-S3 spike resolves |
| A4 | mkcert local cert serves both `:443` and `:8443` since cert is `*.localhost` | §2.3 Traefik dedicated entrypoint | Falls back to two cert resolvers if wrong; integration test in W1-P5 catches |
| A5 | `@fastify/rate-limit` v10 per-route `config.rateLimit.keyGenerator` shadows the global | §2.6 rate-limit | If false, Phase 2 plugin needs a 5-line extension; verified inline with code read |
| A6 | LiteLLM `mock_response` does NOT tokenize for streaming (single chunk per request) | §2.8 / Open Q #7 | If wrong, the per-line-flush contract test passes against vanilla mock_response; if right (likely), Wave 2 ships a streaming SSE stub |
| A7 | Traefik 3 ACME on `:8443` is non-trivial; cert reuse via shared `tls.certificates` is the path of least resistance | §2.3 Traefik dedicated entrypoint | Confirmed via Let's Encrypt docs (HTTP-01 is port-80-only, TLS-ALPN-01 is port-443-only) — assumption is verified |
| A8 | After `reply.hijack()`, Fastify's `setErrorHandler` does not fire | §2.2 Fastify lifecycle | Verified in Fastify 5 docs; tested by Phase 4 contract test asserting error envelope DOES NOT appear after hijack |

All A1-A3 resolve in Wave 0 spikes (~2 hr total). A4-A6 resolve during Wave 1 implementation tests. A7-A8 are verified by docs.

## Sources

### Primary (HIGH confidence — verified)

- `apps/api/src/routes/realtime.ts` (read inline) — existing wsUpstream proxy, integration point for D-27.
- `apps/api/src/plugins/rate-limit.ts` (read inline) — confirms per-route keyGenerator override is a vanilla v10 feature.
- `compose/traefik/traefik.yml` + `compose/traefik/dynamic.yml` (read inline) — current state of `:443` and `api-realtime` router.
- `compose/litellm/litellm_config.contract.yaml` (read inline) — mock-mode shape for D-29 extension.
- `.planning/phases/04-streaming-realtime/04-CONTEXT.md` — 31 locked decisions (single source of truth for design).
- `.planning/REQUIREMENTS.md` (lines 23, 29-31, 84) — WIRE-07/13/14/15/SCALE-05 wire shape.
- Better Auth + Phase 2 dual-auth + Phase 3 LiteLLM patterns (carry-forward; no changes required in those files).

### Cited (MEDIUM-HIGH confidence)

- Fastify 5 Reply docs (https://fastify.dev/docs/latest/Reference/Reply/) — `reply.hijack()`, `reply.raw`, error-handler interaction.
- Traefik 3 EntryPoints reference (https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/) — `respondingTimeouts` is per-entryPoint.
- Let's Encrypt challenge types (https://letsencrypt.org/docs/challenge-types/) — HTTP-01 is port-80-only; TLS-ALPN-01 is port-443-only; no arbitrary-port option (verified via WebSearch 2026-05).
- AssemblyAI v3 token API (https://www.assemblyai.com/docs/api-reference/streaming-api/generate-streaming-token) — `Authorization: <KEY>`, `expires_in_seconds`, `{token}`.
- Deepgram Grant-Token API (https://developers.deepgram.com/reference/token-based-auth-api/grant-token) — `Authorization: Token <KEY>`, `{access_token, expires_in}`.
- OpenAI Realtime client_secrets (https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret) — `{session:{type:"realtime", model:"..."}}`, `{value:"ek_..."}`.
- LiteLLM streaming docs (https://docs.litellm.ai/docs/completion/stream) — `stream_options.include_usage`.
- `@fastify/http-proxy` README (https://github.com/fastify/fastify-http-proxy) — `wsClientOptions`, `wsReconnect`.
- Node 24 docs — `TextDecoder({stream:true})`, `net.Socket.setNoDelay`, `http.ServerResponse.flushHeaders`.
- LiteLLM#17246, LiteLLM#26529, vercel/ai#7449 — known-issues design considerations (already cited in CONTEXT canonical refs).

### Tertiary (lower confidence — needs Wave 0 spike confirmation)

- LiteLLM `mock_response` streaming behavior — assumed single-chunk based on current contract config; Wave 2 spike confirms or replaces with custom stub.
- Deepgram `ttl_seconds` body param — varies by docs version; W0-S3 spike confirms.

## Metadata

**Confidence breakdown:**

- Standard stack (Fastify 5 + undici + ws + Traefik 3): **HIGH** — no version surprises, all primitives well-documented.
- Architecture (hand-rolled producer + dedicated entrypoint): **HIGH** — locked in CONTEXT.md after 4-agent advisor research; reject-paths explicitly closed.
- Pitfalls (buffering false-negative, ACME on `:8443`, hijack-error-handler interaction, tool-call drop on `finish_reason=stop`): **HIGH** — all surfaced and mitigated in CONTEXT or this document.
- Wave decomposition: **HIGH** — dependencies are concrete (W2 needs W1, W3 needs W2); parallelism is preserved.
- Open questions (LiteLLM SSE shape, OpenAI field name, Deepgram TTL param): **LOW-but-bounded** — all resolve in <2hr Wave 0 spikes; none change the wave structure or design.

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (Phase 4 expected to close within 30 days; provider docs may update minor details — the curl-fixture spikes pin reality at execution time).

---

## RESEARCH COMPLETE

**Phase:** 04 - streaming-realtime
**Confidence:** HIGH

### Key Findings

- The producer pattern (hand-rolled async generator over LiteLLM SSE) is locked, well-defined, and fully unit-testable from a 7-fixture corpus captured in Wave 0. ≥90/90/90/90 coverage is achievable on pure utilities.
- The Fastify hijack lifecycle requires a specific 6-step sequence (header → hijack → flushHeaders → setNoDelay → AbortController wire → upstream fetch) that is non-obvious; getting any step out of order silently breaks first-line latency or error handling.
- Traefik 3 dedicated `:8443` entrypoint is the only correct mechanism for per-route long timeouts; ACME on `:8443` requires cert-reuse from `:443` (HTTP-01 / TLS-ALPN-01 are port-locked) — already in place in dev via mkcert, prod path documented for Phase 9.
- Token-mint endpoints reduce to one `_call-provider.ts` helper + 3 thin route files; per-user rate limit is a vanilla `@fastify/rate-limit` per-route override (Phase 2 plugin requires no extension).
- The buffering-injection negative-control test pins the methodology for the entire phase — without it, the 500ms first-line assertion is a latent false negative.

### File Created

`/Users/dev/openwhispr-server/.planning/phases/04-streaming-realtime/04-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Implementation patterns | HIGH | Locked decisions + verified existing code + cited official docs |
| Wave decomposition | HIGH | Dependencies concrete, parallelism preserved |
| Validation architecture | HIGH | Five test layers map cleanly to five requirements; coverage strategy file-by-file |
| Open questions | LOW-but-bounded | 7 spike-resolvable items, ~2hr total Wave 0 work; none change design |

### Open Questions (RESOLVED)

1. LiteLLM SSE chunk shape for tool_calls — capture fixture in Wave 0. **RESOLVED:** Wave 0 plan 04-01 Task 1/2 captures the fixture corpus under `apps/api/src/routes/agent/__fixtures__/*.sse` (≥7 fixtures including multi-tool-call.sse).
2. OpenAI client_secrets field name — single curl in Wave 0. **RESOLVED:** Wave 0 plan 04-01 Task 1/2 (provider shape spike, recorded in `tests/spikes/04-provider-shapes.md`).
3. Deepgram Grant-Token body param — single curl in Wave 0. **RESOLVED:** Wave 0 plan 04-01 Task 1/2 (same provider shape spike).
4. mkcert serves `:8443` (very likely yes, smoke-test in W1-P5). **RESOLVED:** Wave 1 plan 04-05 (Traefik `:8443` entrypoint integration test parses traefik.yml + smokes the entrypoint via the integration harness).
5. `@fastify/websocket` + `@fastify/http-proxy` v11 mock-realtime smoke (W2-P2). **RESOLVED:** Wave 2 plan 04-07 (mock-realtime package + WSS proxy smoke through Fastify wsUpstream).
6. E2E first-byte timing precision (W3-P3). **RESOLVED:** Wave 3 plan 04-09 Task 2 (fetch-send → first-byte timing, < 500ms round-trip assertion).
7. LiteLLM `mock_response` streaming behavior vs custom stub (W2-P2 alternative). **RESOLVED:** Wave 3 plan 04-08 Task 1 sub-task 1f (verbatim `qwen3.6-plus-streaming` mock_response YAML in `compose/litellm/litellm_config.contract.yaml` confirms mock_response chunked streaming is the chosen path; custom stub not needed).

### Ready for Planning

Research complete. Planner can now create plan files for Waves 0-4.
