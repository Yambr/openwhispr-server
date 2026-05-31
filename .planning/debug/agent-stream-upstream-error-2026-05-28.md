---
slug: agent-stream-upstream-error-2026-05-28
status: complete
mode: diagnose-only
severity: HIGH
trigger: "peer 9zn786o0 — agent chat broken for every signed-in user"
created: 2026-05-28
updated: 2026-05-28
---

# Agent stream upstream error swallowed — silent terminal `done` chunk

## 1. Symptom (verbatim)

`POST /api/agent/stream` returns HTTP 200 with NDJSON body consisting of EXACTLY one line:

```
{"type":"done","finishReason":"upstream_error","usage":{"promptTokens":0,"completionTokens":0}}
```

No preceding `{"type":"error", ...}` chunk. No `content` chunks. No `tool_call` chunks.

The desktop / web client wire contract (per peer 9zn786o0) is: the renderer treats `type:"error"` as the trigger for an error toast/bubble; `done.upstream_error` is unrecognised and silently terminal → empty assistant bubble.

Repro context:
- User: freshly signed-up free-tier on `openwhispr.yambr.com`
- `chatAgentMode = "openwhispr"` (server-side LiteLLM proxy path; no BYOK)
- `chatAgentProvider = "groq"`
- `chatAgentModel = "openai/gpt-oss-120b"` (Groq-hosted GPT-OSS-120B alias as the client knows it)
- Auth Bearer present; HTTP 200; `promptTokens=0` → upstream rejected BEFORE tokenization.

## 2. Code path

### 2.1 Route handler

`apps/api/src/routes/agent/stream.ts`

- L122–L143 — route declaration. `POST /api/agent/stream`. Auth required. Rate limit 20/min/user.
- L144–L156 — handler entry. Auth re-check (L148) throws `AuthError("UNAUTHORIZED", "unauthorized")` BEFORE hijack (not relevant here — request reached handler with `req.user.id` populated).
- L159–L180 — header set + `reply.hijack()` + `flushHeaders()` + `setNoDelay(true)`. **After L167 (`reply.hijack()`) the centralized `setErrorHandler` is bypassed.** All errors below the hijack land in the local catch blocks and must be hand-mapped to wire chunks.
- L193–L205 — `AbortController` wired to `req.raw.on("close")`, with `upstreamBodyRef` for explicit `destroy()` on disconnect (Plan 51-12tx4).
- L218–L222 — `prependSystemPrompt` + `translateLegacyTools`. Pure functions; not implicated.
- L252–L271 — `deps.litellm.chatCompletionsStream({ model: resolveModel(body.model), messages, userId, requestId, extras })`. Per L84–L86, `resolveModel(body.model)` returns `body.model ?? process.env.DEFAULT_AGENT_MODEL ?? DEFAULT_AGENT_MODEL` — so the client-sent `openai/gpt-oss-120b` is forwarded VERBATIM.

### 2.2 The catch block emitting the symptom

`apps/api/src/routes/agent/stream.ts:272–284` (verbatim):

```typescript
} catch (err) {
  // Upstream connect failure (network/abort thrown by the HTTP
  // client) OR LitellmUpstreamError (non-2xx) — both map to a
  // single upstream_error finish chunk under HTTP 200 because the
  // reply has already been hijacked.
  if (err instanceof LitellmUpstreamError) {
    req.log.warn({ status: err.status }, "agent.stream upstream non-2xx");
  } else {
    req.log.warn({ err: (err as Error).message }, "agent.stream upstream connect failed");
  }
  endWithFinish(raw, "upstream_error");
  return reply;
}
```

**Two distinct error classes collapse into one wire signal.** `LitellmUpstreamError` (non-2xx — 401/404/429/5xx all mapped here) and arbitrary connect/abort errors (`Error` subclass, `TypeError`, undici dispatch failure, etc.) BOTH terminate via `endWithFinish(raw, "upstream_error")`.

### 2.3 Terminal-chunk emitter

`apps/api/src/routes/agent/stream.ts:89–110`:

```typescript
function endWithFinish(raw, finishReason): void {
  if (raw.writableEnded) return;
  const chunk: StreamChunk = {
    type: "done",            // R32 — terminal marker the desktop client recognises is `type:"done"`.
    finishReason,             // ← "upstream_error" in this case.
    usage: { promptTokens: 0, completionTokens: 0 },
  };
  raw.write(`${JSON.stringify(chunk)}\n`);
  raw.end();
}
```

The function emits ONLY a single `done` chunk — never an `error` chunk first. This is the wire-contract break: the desktop / web renderer's `type === "error"` discriminant is never triggered.

### 2.4 Upstream call — where the non-2xx is born

`packages/litellm-client/src/index.ts:542–609`, `chatCompletionsStream`:

- L547 — `const model = req.model ?? config.defaultChatModel;` → `openai/gpt-oss-120b`.
- L548 — `checkProviderKey(model);` → see L419–L427:
  ```typescript
  function checkProviderKey(model: string): void {
    if (isOverride) return;
    const provider = BUNDLED_MODEL_PROVIDER[model];
    if (!provider) return; // unknown model: defer to upstream for canonical 4xx
    if (!config.providerKeys[provider]) {
      throw new MissingProviderKeyError(PROVIDER_ENV_VAR[provider], model);
    }
  }
  ```
  `BUNDLED_MODEL_PROVIDER["openai/gpt-oss-120b"]` is `undefined` → `return;` → **no pre-flight key check happens**, request proceeds to LiteLLM.
- L583–L585 — `doRequest(${config.baseUrl}/v1/chat/completions, requestOpts)` to bundled LiteLLM proxy.
- L598–L607 — non-2xx path:
  ```typescript
  if (res.statusCode >= 400) {
    const bodyText = await drainWithTimeout(res.body, config.errorDrainTimeoutMs);
    throw new LitellmUpstreamError(
      res.statusCode, bodyText,
      upstreamErrorOptions(res.statusCode, res.headers["retry-after"]),
    );
  }
  ```
  Upstream body is drained (bounded) and a typed `LitellmUpstreamError` is thrown carrying `.status`, `.kind` (`auth` | `rate_limit` | `server` | `client`), `.retryAfterMs`, and `bodyText` (non-enumerable, truncated to 200 chars).

So by the time `stream.ts:272` catches, **the error already carries the upstream HTTP status code AND a classified `kind`** — and the route THROWS THIS INFORMATION AWAY before emitting the wire chunk.

### 2.5 LiteLLM proxy config (bundled-default)

`compose/litellm/litellm_config.yaml` — `model_list` aliases:

```
qwen3.6-plus, gemini-3-flash, gpt-4o-mini, qwen3.6-cleanup,
whisper-large-v3, realtime-default, gpt-realtime, gpt-realtime-mini,
gpt-4o-realtime-preview, openwhispr-default, openwhispr-reason,
openwhispr-realtime
```

Generated mirror at `packages/litellm-client/src/litellm-aliases.generated.json` confirms — **`openai/gpt-oss-120b` is NOT in `model_list`**. Repo-wide grep `gpt-oss\|gpt_oss\|openai/gpt-oss` returns **zero hits**. There is no chat alias for any Groq-hosted LLM at all — Groq is wired only for STT (`whisper-large-v3` / `openwhispr-default` → `groq/whisper-large-v3`).

When LiteLLM router receives a request for `model: "openai/gpt-oss-120b"`, an unknown alias surfaces as **HTTP 400** with body shaped like:

```json
{"error":{"message":"Invalid model name passed in model=openai/gpt-oss-120b ...","type":"invalid_request_error"}}
```

(LiteLLM router.py emits `BadRequestError` on missing deployment; classified by `classifyUpstreamStatus(400)` → `"client"`.)

### 2.6 Logging surface (what operators actually see)

`stream.ts:278`:

```typescript
req.log.warn({ status: err.status }, "agent.stream upstream non-2xx");
```

- Level: `warn` (NOT `error`).
- Fields: **only `status`**. No upstream body, no model, no provider, no `kind`, no `requestId` correlation field, no `litellmCallId` (it isn't captured yet at this throw site — only L289 captures it on success).
- Pino's default `err` serializer is NOT invoked here because the call shape is `req.log.warn({ status }, msg)` — `err` is not in the log bindings. The `bodyText` (truncated to 200 chars + redacted) is on the Error instance and is silently discarded.

The connect-failure branch (L280) IS slightly better — captures `err.message` — but still `warn` level, still no status/model/provider context, still no `kind`.

## 3. Hypothesis matrix

### H1 — GROQ_API_KEY missing/expired in LiteLLM config

**Status: DISPROVED (as the proximate cause for this symptom).**

Evidence:
- `compose/litellm/litellm_config.yaml` wires `GROQ_API_KEY` to `groq/whisper-large-v3` ONLY (line 68) — Groq is **the STT provider**, not a chat provider, in the bundled config.
- No chat alias backs onto Groq. So even if `GROQ_API_KEY` is fine, requesting `openai/gpt-oss-120b` would still fail.
- If `GROQ_API_KEY` were missing/expired, the symptom on `/api/agent/transcribe` paths would mirror — but the user reports `/api/agent/stream` (chat) is broken. That route never asks for a Groq key.
- The `promptTokens=0` symptom is consistent with H1 (Groq 401 returns no usage) BUT ALSO with H2 (LiteLLM never reaches a provider — model not found).

H1 cannot be the root cause for the chat stream because no chat path consults `GROQ_API_KEY` in the bundled config. (Corporate operators with `LITELLM_BASE_URL` override could expose Groq chat — see §6 blast radius.)

### H2 — Model alias `openai/gpt-oss-120b` not registered in LiteLLM `model_list`

**Status: PROVED (root cause).**

Evidence:
- `compose/litellm/litellm_config.yaml` lines 21–135 enumerate every alias; `openai/gpt-oss-120b` is **absent**.
- `packages/litellm-client/src/litellm-aliases.generated.json` (build-time mirror) confirms — alias is absent from `aliases[]` AND `bundledProviders{}`.
- Repo-wide grep `gpt-oss\|gpt_oss\|openai/gpt-oss` → 0 hits in `*.ts|*.yaml|*.yml|*.json`.
- LiteLLM router behavior on unknown alias: HTTP 400 `Invalid model name passed in model=...` (the same code path that broke audio transcriptions in Phase 19.2 / SERVER-ERRORS Entry 11 — see `compose/litellm/litellm_config.yaml` lines 54–63 comment block).
- `checkProviderKey(model)` (`packages/litellm-client/src/index.ts:419`) returns silently for unknown models (`if (!provider) return; // unknown model: defer to upstream for canonical 4xx`) — so no pre-flight 503 is raised; the request goes to LiteLLM, gets 400, is wrapped in `LitellmUpstreamError(status=400, kind="client")`, and lands in the route catch at L277.
- `promptTokens=0` is consistent — LiteLLM rejected at the router layer before any provider tokenization.

The client is sending an OpenAI-namespaced model string (`openai/gpt-oss-120b`) under `chatAgentProvider="groq"` — a client/server contract mismatch. The bundled server expects one of the aliases enumerated above (most likely `qwen3.6-plus` for chat, or `openwhispr-reason`).

### H3 — LiteLLM not booted / connection refused

**Status: DISPROVED.**

Evidence:
- A connect failure would land in the `else` branch at `stream.ts:280`, logging `agent.stream upstream connect failed` — but the symptom shape `done.upstream_error` is the SAME from both branches (collapsed by the catch), so we cannot fully discriminate from the symptom alone.
- However, both branches still produce the `done.upstream_error` symptom; the only diagnostic difference is the log line. If the proxy were down system-wide, multiple endpoints (STT, realtime token mint, reason cleanup) would fail concurrently — peer report scoped this to the chat stream only.
- Further verification requires the live Loki/grafana logs filtering for `agent.stream upstream connect failed`. Until then: **INCONCLUSIVE per symptom alone** but **not the working hypothesis** because the model-alias miss (H2) is sufficient.

### H4 — Tool translation error (`translate-tools.ts` malforms `tools` array)

**Status: INCONCLUSIVE without request payload inspection, but UNLIKELY to be the root.**

Evidence:
- A malformed tools array reaches LiteLLM as JSON body; upstream returns 400 with a tool-shape error message. This is **the same observable shape as H2** at the route boundary (because the catch collapses all 4xx into `upstream_error`).
- The peer report does NOT mention tools being involved or any change to the tools wire surface. The user is freshly signed up — no custom tools configured.
- `translateLegacyTools` accepts undefined / null cleanly (`stream.ts:220 — if (body.tools !== undefined && body.tools !== null)`).
- Likelihood very low; the model-alias miss is a sufficient and more direct cause.

### H5 — Request body fails Zod schema (would 400 BEFORE hijack)

**Status: DISPROVED.**

Evidence:
- The route is `app.withTypeProvider<ZodTypeProvider>().route({ schema: { body: AgentStreamRequestSchema }, ... })` (`stream.ts:122–127`). Zod validation runs in the `validatorCompiler` BEFORE the handler. A schema failure flows through `registerErrorHandler` as a canonical **400 JSON envelope**, not an NDJSON `done.upstream_error`.
- `AgentStreamRequestSchema` (`packages/wire-schemas/src/agent.ts:76–82`) accepts `model: z.string().min(1).max(128).nullish()` — `openai/gpt-oss-120b` (22 chars, non-null) passes.
- The observed wire shape is `Content-Type: application/x-ndjson` with a single `done.upstream_error` line — that can ONLY happen post-hijack, i.e. after schema validation succeeded.

## 4. Root cause

**One sentence:**

The client requests `model: "openai/gpt-oss-120b"`, which is not declared in `compose/litellm/litellm_config.yaml` `model_list`; LiteLLM returns HTTP 400 ("Invalid model name"); the route's catch block at `apps/api/src/routes/agent/stream.ts:272–284` collapses every `LitellmUpstreamError` (4xx/5xx) AND every connect-failure into a single bare terminal `{type:"done", finishReason:"upstream_error", usage:0/0}` chunk — never emitting the `type:"error"` chunk the client wire contract requires to render an error state — so the user sees an empty assistant bubble.

The bug is **two layers compounded**:
1. **Provisioning gap** — the bundled `litellm_config.yaml` has no Groq-hosted chat alias for `openai/gpt-oss-120b` (or any other Groq LLM). The client is sending a model the server has not been told about.
2. **Observability + wire-contract bug in the route** — even when the upstream error IS classified (`LitellmUpstreamError.kind === "client"`, status 400, redacted body available), the route discards every byte of context and emits a single opaque `done.upstream_error` that the client cannot render. This is the layer the fix MUST address — without it, even a clean provisioning fix would still produce empty bubbles for ANY upstream rejection (rate limit, network blip, model retire, etc.).

The route-level bug existed since Phase 08.2 (Plan 02 — `stream.ts` line 1 SPDX comment) when the upstream call moved to the shared LiteLLM client and the catch was shaped to "collapse to one chunk". The model-alias miss is fresh — a v1.7.8 (or later) desktop client adopted a Groq-hosted GPT-OSS model that the server config never enumerated.

## 5. Recommended fix (Option B from peer — exact code shape)

Two coupled changes — wire fix is necessary; provisioning fix is sufficient to unblock the immediate user, but the wire fix prevents the next instance.

### 5.1 Wire fix — `apps/api/src/routes/agent/stream.ts` catch block (L272–L284)

Replace with:

```typescript
} catch (err) {
  // Map upstream failure to a richer wire envelope. The client wire
  // contract treats `type:"error"` as the renderable error chunk; a
  // bare `done.upstream_error` is silently terminal and the user sees
  // an empty assistant bubble. We emit BOTH the error chunk AND end the
  // response without an additional `done` (the error chunk IS terminal
  // for the client renderer).
  const errorEnvelope = classifyAgentUpstreamError(err);

  req.log.error(
    {
      event: "agent.stream.upstream_failure",
      upstream_status: errorEnvelope.upstreamStatus,
      upstream_body_truncated: errorEnvelope.upstreamBodyTruncated,
      code: errorEnvelope.code,
      provider: errorEnvelope.provider,
      model: resolvedModel,           // hoist `resolveModel(body.model ?? undefined)` into a const above the try
      litellm_call_id: undefined,     // not yet captured at this throw site
      request_id: req.id,
    },
    "agent stream upstream call failed",
  );

  if (!raw.writableEnded) {
    const chunk = {
      type: "error" as const,
      error: errorEnvelope.userFacingMessage,  // truncated <= 500 chars, secret-shape-redacted
      code: errorEnvelope.code,
      provider: errorEnvelope.provider,
    };
    try {
      raw.write(`${JSON.stringify(chunk)}\n`);
    } catch {
      // socket already closed — nothing more to do.
    }
    try {
      raw.end();
    } catch {
      // ditto.
    }
  }
  return reply;
}
```

**Key invariants for the implementation:**

1. **Error chunk REPLACES the final `done` chunk** (does not precede it). Emitting `error` then `done` is ambiguous on the renderer side; the error envelope is itself terminal. The `StreamChunk` discriminated union in `apps/api/src/lib/sse-parser.ts:28–35` must be widened with the new variant:
   ```typescript
   export type StreamChunk =
     | { type: "content"; text: string }
     | ToolCallChunk
     | { type: "done"; finishReason: string; usage: { ... } }
     | { type: "error"; error: string; code: AgentUpstreamErrorCode; provider?: AgentUpstreamProvider };
   ```
2. **`endWithFinish` (L89–L110) stays unchanged** — it remains the path for client-disconnect / hijack-without-error scenarios. The new catch path doesn't call it.
3. **Mid-stream drain error (L319–L337) gets the SAME treatment** — replace the synthetic `done.stream_error` finish chunk with `type:"error"` + appropriate code (`upstream_mid_stream`). Same wire-contract reasoning applies.

### 5.2 New helper — `apps/api/src/lib/agent-upstream-error-classify.ts`

```typescript
import { LitellmUpstreamError, redactSecretShapes } from "@openwhispr/litellm-client";

export type AgentUpstreamErrorCode =
  | "upstream_auth"             // 401 (incl. MissingProviderKeyError → mapped here)
  | "upstream_rate_limit"       // 429
  | "upstream_quota_exceeded"   // 402
  | "upstream_invalid_model"    // 404 or "Invalid model name" 400
  | "upstream_timeout"          // AbortError / undici body/headers timeout
  | "upstream_unknown";         // any other 4xx / 5xx / unknown

export type AgentUpstreamProvider = "groq" | "openai" | "openrouter" | "anthropic" | "litellm" | "unknown";

export interface AgentUpstreamErrorEnvelope {
  code: AgentUpstreamErrorCode;
  provider: AgentUpstreamProvider;
  upstreamStatus?: number;
  upstreamBodyTruncated?: string;        // <= 500 chars, secret-shape-redacted
  userFacingMessage: string;              // safe to ship to the client wire
}

export function classifyAgentUpstreamError(err: unknown): AgentUpstreamErrorEnvelope {
  if (err instanceof LitellmUpstreamError) {
    const status = err.status;
    // err.kind already classifies auth / rate_limit / server / client
    // We re-classify into the wire taxonomy below.
    const bodyTruncated = redactSecretShapes(err.message).slice(0, 500);

    if (status === 401 || status === 403) {
      return { code: "upstream_auth", provider: "litellm",
               upstreamStatus: status, upstreamBodyTruncated: bodyTruncated,
               userFacingMessage: "Upstream model provider rejected the request (authentication failure)." };
    }
    if (status === 402) {
      return { code: "upstream_quota_exceeded", provider: "litellm",
               upstreamStatus: status, upstreamBodyTruncated: bodyTruncated,
               userFacingMessage: "Upstream quota exceeded." };
    }
    if (status === 429) {
      return { code: "upstream_rate_limit", provider: "litellm",
               upstreamStatus: status, upstreamBodyTruncated: bodyTruncated,
               userFacingMessage: "Rate limit exceeded — please retry shortly." };
    }
    // "Invalid model name" / model_not_found surface as 400 from LiteLLM router.
    // 404 less common (some routers); both map to invalid_model.
    if (status === 404 || (status === 400 && /invalid model name|model_not_found|not.found/i.test(bodyTruncated))) {
      return { code: "upstream_invalid_model", provider: "litellm",
               upstreamStatus: status, upstreamBodyTruncated: bodyTruncated,
               userFacingMessage: "Requested model is not available on this server." };
    }
    return { code: "upstream_unknown", provider: "litellm",
             upstreamStatus: status, upstreamBodyTruncated: bodyTruncated,
             userFacingMessage: "Upstream model provider returned an error." };
  }

  // Network / abort / dispatch errors — undici surface.
  const e = err as { name?: string; code?: string; message?: string };
  if (e?.name === "AbortError" || e?.code === "UND_ERR_ABORTED") {
    return { code: "upstream_timeout", provider: "unknown",
             userFacingMessage: "Upstream request timed out or was cancelled." };
  }
  if (e?.code === "UND_ERR_HEADERS_TIMEOUT" || e?.code === "UND_ERR_BODY_TIMEOUT") {
    return { code: "upstream_timeout", provider: "unknown",
             userFacingMessage: "Upstream took too long to respond." };
  }
  return { code: "upstream_unknown", provider: "unknown",
           upstreamBodyTruncated: redactSecretShapes(e?.message ?? "").slice(0, 500),
           userFacingMessage: "Upstream model provider unreachable." };
}
```

LOCKER-05 / Phase 37 contract preserved — every body-text source is passed through `redactSecretShapes(...).slice(0, 500)` AT CONSTRUCTION before reaching either the wire envelope or the log binding.

### 5.3 Provisioning fix — `compose/litellm/litellm_config.yaml`

Add the Groq-hosted GPT-OSS alias **if** the product decision is to offer it (peer 9zn786o0 / product owner should confirm — this is operator policy, not a server defect):

```yaml
  - model_name: openai/gpt-oss-120b
    litellm_params:
      model: groq/openai/gpt-oss-120b   # confirm exact Groq deployment id
      api_base: https://api.groq.com/openai/v1
      api_key: os.environ/GROQ_API_KEY
```

Then re-run `pnpm --filter @openwhispr/litellm-client generate:aliases` to refresh `litellm-aliases.generated.json`.

**Decision boundary the user must call:** is `openai/gpt-oss-120b` a model the server SHOULD offer, or is the desktop client sending a model the server has not approved? If the latter (likely — Groq's `openai/gpt-oss-120b` is community-deployed and not part of any approved openwhispr alias namespace), the proper fix is **server-side**: reject unknown models with a 422 BEFORE entering the streaming path, surfaced via `MissingProviderKeyError`-style class. The route's catch will then map cleanly to `upstream_invalid_model` and the client will render the error correctly.

## 6. Severity + blast radius

**Severity: HIGH.**

- **Impact: 100% of `/api/agent/stream` traffic** for any user whose `chatAgentModel` is unset, set to an unknown alias, or set to any alias whose upstream provider returns non-2xx (auth failure / rate limit / model retirement / etc.). Free-tier signup defaults to whatever the desktop client chose — currently `openai/gpt-oss-120b` per peer report — making this **the dominant failure mode for new signups on `openwhispr.yambr.com`**.
- **User-visible signature:** empty assistant bubble after send. No error toast, no retry hint. The user assumes the product is broken and bounces.
- **Logging signature:** `req.log.warn(..., "agent.stream upstream non-2xx")` — buried at WARN level in Loki without the model/provider/body context an operator needs to debug. The Phase 37 LOCKER-05 secret-redaction contract is intact, but redacted body is discarded entirely.
- **Wire-contract layer is global to /api/agent/stream** — any future provider rejection (Groq 429, OpenAI 5xx, OpenRouter quota) will produce the same empty-bubble symptom even after the model alias is fixed.
- **Corporate-operator path** (`LITELLM_BASE_URL` set) — the same bug applies. Operators see "empty chat" reports from end users with no actionable log line.

**Blast radius if shipped to v1.7.8 customers**: every free-tier signup on the public install. Internal LiteLLM operators see the same wire-contract bug whenever their upstream provider returns non-2xx.

## 7. Test cases the fix MUST add

All under `apps/api/tests/unit/routes/agent/__tests__/` with the `*.test.ts` convention. Coverage floor ≥ 90% on the new helper file (per project DISCIPLINE rule 2: per-phase coverage floor).

### 7.1 Contract tests — `agent-stream-upstream-error-envelope.test.ts`

Each case asserts (a) exactly one wire line is emitted, (b) it parses as JSON with `type:"error"`, (c) `code` matches the taxonomy, (d) `error` field is non-empty and ≤ 500 chars, (e) no secret-shape substring (`sk-…`, `Bearer ey…`, `AKIA…`) appears in the wire bytes:

- **`upstream_auth` from 401** — mock LitellmUpstreamError(401, "Invalid api key sk-or-v1-…"); expect `code:"upstream_auth"`, the secret shape redacted from the user-facing message.
- **`upstream_auth` from 403** — same shape, status 403.
- **`upstream_quota_exceeded` from 402** — mock LitellmUpstreamError(402, "...").
- **`upstream_rate_limit` from 429** — mock LitellmUpstreamError(429, "rate limit", { kind:"rate_limit", retryAfterMs:30000 }); expect `code:"upstream_rate_limit"`.
- **`upstream_invalid_model` from 400** — mock LitellmUpstreamError(400, "Invalid model name passed in model=openai/gpt-oss-120b"); expect `code:"upstream_invalid_model"`.
- **`upstream_invalid_model` from 404** — mock 404 model_not_found body.
- **`upstream_unknown` from 500** — mock LitellmUpstreamError(500, "Internal proxy error"); expect `code:"upstream_unknown"`.
- **`upstream_timeout` from AbortError** — throw new DOMException("aborted", "AbortError"); expect `code:"upstream_timeout"`.
- **`upstream_timeout` from UND_ERR_HEADERS_TIMEOUT** — throw object with code:"UND_ERR_HEADERS_TIMEOUT".
- **`upstream_unknown` from generic network error** — throw new TypeError("fetch failed"); expect `code:"upstream_unknown"`.
- **Malformed upstream body** — non-JSON / binary blob in LitellmUpstreamError.bodyText; expect the redacted prefix still ≤ 500 chars, no JSON.parse leak.

### 7.2 Wire-shape regression — `agent-stream-error-then-end.test.ts`

End-to-end via `buildApp().inject({ method:"POST", url:"/api/agent/stream", payload: { messages:[…], model:"unknown-alias" } })` with a `MockAgent`-backed undici returning 400. Assert:

- HTTP status 200 (post-hijack, per existing wire contract).
- `Content-Type: application/x-ndjson`.
- Response body is EXACTLY one line, ending in `\n`.
- Parsed line has `type:"error"` (NOT `"done"`).
- No `"finishReason":"upstream_error"` substring anywhere in the response.
- The socket is closed (`raw.writableEnded === true`).

### 7.3 Structured-log assertion — `agent-stream-upstream-failure-log.test.ts`

Mock `req.log` and assert:

- `req.log.error` called exactly once (NOT `warn`).
- Log binding contains the keys `event: "agent.stream.upstream_failure"`, `upstream_status`, `code`, `provider`, `model`, `request_id`, `upstream_body_truncated`.
- `upstream_body_truncated` does NOT contain any secret-shape substring (re-run the LOCKER-05 redaction regex against the captured log binding).

### 7.4 Mid-stream drain error parity — `agent-stream-mid-stream-error.test.ts`

Drive a 200 response whose SSE stream errors mid-flight. Assert the existing drain-error path also emits `type:"error"` (code: `upstream_unknown` or new `upstream_mid_stream`) instead of `done.stream_error`.

### 7.5 e2e — `tests/e2e/agent/stream-error-rendering.spec.ts` (Playwright)

End-to-end through the real `docker compose` stack (per project DISCIPLINE rule: E2E mandatory for any phase touching a user-visible wire surface):

- Boot the stack (with `LITELLM_BASE_URL` pointing at the bundled proxy on a fake-empty `model_list` — easiest via the existing `litellm_config.contract.yaml` fixture).
- Issue `POST /api/agent/stream` with an unknown model.
- Assert the desktop / web client renders an error toast (or whichever UI element the wire `type:"error"` is bound to).
- Negative: confirm a successful chat (valid alias) still renders content.

### 7.6 Coverage gate

The new helper `agent-upstream-error-classify.ts` MUST hit ≥ 90% on lines/branches/functions/statements; the modified `stream.ts` catch block MUST hit 100% on the new code paths. CI must reject the PR otherwise (per DISCIPLINE rule 2).

---

## Appendix — Files cited

| File | Lines | Why |
|---|---|---|
| `apps/api/src/routes/agent/stream.ts` | 89–110, 122–127, 144–156, 159–180, 193–205, 218–222, 252–271, 272–284, 286–300, 302–347 | Route handler, hijack, upstream call, catch block (the bug site), terminal-chunk emitter |
| `apps/api/src/lib/sse-parser.ts` | 28–35, 99–149 | `StreamChunk` discriminated union (must widen for `type:"error"`); the drain loop |
| `packages/litellm-client/src/index.ts` | 419–427, 542–609 | `checkProviderKey` (deferral path for unknown models), `chatCompletionsStream` non-2xx path |
| `packages/litellm-client/src/errors.ts` | 67–79, 96–116, 136–235 | `classifyUpstreamStatus`, `parseRetryAfterMs`, `LitellmUpstreamError` (status / kind / retryAfterMs / non-enumerable bodyText) |
| `packages/litellm-client/src/model-aliases.ts` | 46–51, 58–73 | `loadBundledModelProviders`, `getDefaultAgentModel` (yaml→JSON build-time mirror) |
| `packages/litellm-client/src/litellm-aliases.generated.json` | 1–27 | Build-time alias mirror — confirms `openai/gpt-oss-120b` is NOT bundled |
| `compose/litellm/litellm_config.yaml` | 21–135 | LiteLLM proxy `model_list` — no `openai/gpt-oss-120b` alias; Groq is STT-only |
| `packages/wire-schemas/src/agent.ts` | 76–87 | `AgentStreamRequestSchema` — accepts `model: z.string().min(1).max(128).nullish()` (H5 disproof) |
