---
quick_id: 260528-0cm
slug: agent-stream-error-contract
mode: research
date: 2026-05-28
upstream:
  context: .planning/quick/260528-0cm-agent-stream-error-contract/CONTEXT.md
  audit: .planning/debug/agent-stream-upstream-error-2026-05-28.md
---

# Research — `/api/agent/stream` upstream-error wire contract

## User Constraints (verbatim from CONTEXT.md)

### Locked Decisions

- **D1 — single terminal `type:"error"` frame for both preflight AND mid-stream failure.** No `done` chunk follows it. The error chunk IS the terminator.
- **D2 — `provider: "litellm"` always for `LitellmUpstreamError`; `"unknown"` for connect/timeout errors.** No groq/openai/openrouter inference. `AgentUpstreamProvider = "litellm" | "unknown"`.
- **D3 — canonical English `userFacingMessage` per code class.** Raw `bodyText` NEVER reaches the wire; it goes only to `req.log.error`'s `upstream_body_truncated` binding.
- **D4 — remove `finishReason:"upstream_error"` (preflight) AND `finishReason:"stream_error"` (drain) entirely.** Replaced by `type:"error"`. No deprecation cycle — repo grep shows zero production consumers; the two existing tests (Test 9, Test 17, Test 18) are rewritten in the same phase.

### Claude's Discretion (not present in CONTEXT.md; planner has discretion on)

- Exact canonical message wording (English only) within the constraints of D3
- Whether to add a `retryAfterMs` field to the wire envelope for `upstream_rate_limit` (CONTEXT.md does not lock it in; my R11 recommends NOT widening the wire — surface only via log binding)
- Naming of the new helper file (CONTEXT.md proposes `apps/api/src/lib/agent-upstream-error-classify.ts`)

### Deferred Ideas (OUT OF SCOPE)

- Adding `openai/gpt-oss-120b` (or any new Groq chat alias) to `compose/litellm/litellm_config.yaml` — separate provisioning ticket
- Client renderer changes — wire contract is client-source-of-truth
- Reason-cleanup / realtime stream parity
- `/api/transcribe` non-stream envelope

---

## R1 — `LitellmUpstreamError` complete shape

**Source:** `packages/litellm-client/src/errors.ts:136-235`. Already verified.

```typescript
export class LitellmUpstreamError extends Error {
  public readonly status: number;              // 400, 401, 403, 404, 429, 5xx
  public readonly kind: LitellmErrorKind;      // "rate_limit" | "auth" | "server" | "client"
  public readonly retryAfterMs?: number;        // optional, capped at 60_000ms
  private declare readonly bodyText: string;    // NON-ENUMERABLE; truncated to 200 chars; redactSecretShapes-pass at construction

  // .name = "LitellmUpstreamError"
  // .message = "LiteLLM upstream returned <status>: <truncated body>"   (also redacted + truncated to 200 chars)
  // .toJSON() returns only { name, message, status, kind, retryAfterMs? } — bodyText omitted

  // NO .cause. NO .litellmCallId. NO .upstreamCallId.
}

export type LitellmErrorKind = "rate_limit" | "auth" | "server" | "client";

// Pure classifier — used by the constructor if `kind` is omitted from the options object.
export function classifyUpstreamStatus(status: number): LitellmErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "client";
}
```

**Critical gotchas:**

1. **`bodyText` is `private declare` AND non-enumerable.** The classifier helper CANNOT read `err.bodyText` from outside the class. It must read `err.message` (which already has the `LiteLLM upstream returned <status>: <redacted+truncated>` prefix). The audit's L316 `redactSecretShapes(err.message).slice(0, 500)` is the correct pattern — re-redact for belt-and-braces, slice to a wider 500-char cap (the `err.message` payload is already 200-char-truncated by the constructor, so the second slice is a guard against a future relaxation).
2. **`litellm_call_id` is NOT on the error.** It's captured server-side from the `x-litellm-call-id` response header AFTER the upstream resolves (`stream.ts:289-300`). On the preflight throw path (`stream.ts:272-284`) there is no response → no call-id available. The audit acknowledges this at §5.1 (`litellm_call_id: undefined`).
3. **`.retryAfterMs` is present only for 429** in practice. It's parsed from the upstream `Retry-After` header at the client throw site (`packages/litellm-client/src/index.ts:598-607`), capped at 60_000ms. Other statuses MAY carry it but typically don't.

---

## R2 — Current catch blocks (verbatim)

### R2.1 — Preflight catch (lines 272-284)

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

### R2.2 — Mid-stream drain catch (lines 319-337)

```typescript
} catch (err) {
  // (7) Mid-stream error — synthesize a stream_error finish chunk
  //     so the desktop NDJSON consumer never hangs on a half-open
  //     stream. Then fall through to the finally to end the response.
  req.log.warn({ err: (err as Error).message }, "agent.stream drain error");
  if (!raw.writableEnded) {
    const finish: StreamChunk = {
      // R32 — terminal marker the desktop client recognises.
      type: "done",
      finishReason: "stream_error",
      usage: { promptTokens: 0, completionTokens: 0 },
    };
    try {
      raw.write(`${JSON.stringify(finish)}\n`);
      /* v8 ignore next 3 -- defensive: socket closed mid-write */
    } catch {
      // socket already closed — nothing more to do.
    }
  }
} finally {
  if (!raw.writableEnded) {
    try {
      raw.end();
      /* v8 ignore next 3 -- defensive: socket closed mid-end */
    } catch {
      // socket already closed.
    }
  }
}
```

### R2.3 — Things to delete in this phase

| Site | Action |
|---|---|
| `stream.ts:282` `endWithFinish(raw, "upstream_error");` | Delete; replace with the new error-chunk emitter inline |
| `stream.ts:323-336` synthetic `finish: StreamChunk = { type:"done", finishReason:"stream_error", ... }` | Delete the `done.stream_error` chunk; replace with the same `type:"error"` chunk shape used by the preflight catch |
| `stream.ts:278` `req.log.warn({status}, ...)` | Flip to `req.log.error({event,upstream_status,code,provider,model,upstream_body_truncated,request_id}, ...)` |
| `stream.ts:280` `req.log.warn({err.message}, ...)` | Same — collapsed into the single structured error log at the call site |
| `stream.ts:323` `req.log.warn(...)` (drain) | Same flip to `error` + structured event `agent.stream.upstream_failure` (drain variant — same event name, `code` field discriminates) |

### R2.4 — Things to preserve

- The `endWithFinish` helper itself (`stream.ts:89-110`) — still used for the *successful* drain `finally` path (`stream.ts:339-346`'s `raw.end()` call after a clean drain). NOT touched by this phase.
- The `try/catch` around `raw.write(...)` for socket-already-closed defense (LOCKER patterns).
- The `finally { raw.end() }` block after the drain catch (`stream.ts:338-347`) — keep it intact.

### R2.5 — `endWithFinish` body verbatim (lines 89-110)

```typescript
function endWithFinish(raw: import("node:http").ServerResponse, finishReason: string): void {
  /* v8 ignore next */
  if (raw.writableEnded) return;
  const chunk: StreamChunk = {
    type: "done",
    finishReason,
    usage: { promptTokens: 0, completionTokens: 0 },
  };
  try {
    raw.write(`${JSON.stringify(chunk)}\n`);
  } catch {
    // Socket closed mid-write — give up; the client already disconnected.
  }
  try {
    raw.end();
  } catch {
    // ditto.
  }
}
```

**Behavior:** Writes ONE newline-terminated NDJSON line then ends the response. Idempotent if `raw.writableEnded`. Always uses `usage: {0,0}` because the upstream never returned tokens on this path.

**Planner recommendation:** Do NOT extend `endWithFinish` to emit error chunks. Inline the error-chunk emission in the two catch blocks (DRY-helper goes in `agent-upstream-error-classify.ts` for the *classification*, not the *wire-write*). The error chunk's shape (4 fields) differs structurally from the done chunk (3 fields) — they're different terminal frames, keep emitters local.

---

## R3 — `model_not_found` body shape + detection strategy

**Audit §5.2 proposes** the regex `/invalid model name|model_not_found|not.found/i` against the redacted bodyText. Verified against LiteLLM router.py behavior:

| Upstream | Status | Body shape (verified or asserted) | Confidence |
|---|---|---|---|
| LiteLLM router, missing model_list deployment | 400 | `{"error":{"message":"Invalid model name passed in model=<x>","type":"invalid_request_error","param":null,"code":null}}` | HIGH (audit §2.5; matches `compose/litellm/litellm_config.yaml:54-63` comment block referencing the identical message during Phase 19.2) |
| LiteLLM router via direct OpenAI passthrough, model retired | 404 | `{"error":{"message":"The model `gpt-4o-2024-xyz` does not exist","type":"invalid_request_error","code":"model_not_found"}}` | MEDIUM (OpenAI API doc; surfaces verbatim through LiteLLM passthrough) |
| LiteLLM router via Anthropic, model retired | 404 | `{"type":"error","error":{"type":"not_found_error","message":"model: claude-3-xyz"}}` | LOW (vendor-specific JSON shape — likely surfaces through LiteLLM with similar text) |

**Detection strategy — substring match on the redacted `err.message`, NOT JSON.parse:**

- The `err.message` from `LitellmUpstreamError` is already `LiteLLM upstream returned <status>: <redacted bodyText slice(0,200)>`. The vendor JSON shape is partially destroyed by truncation.
- The audit's regex `/invalid model name|model_not_found|not.found/i` is correctly case-insensitive and handles 3 known surface forms.
- **Sharpening recommendation:** tighten the regex so it doesn't false-positive on a 5xx body containing the word "found" — e.g., `/invalid model name|"code":\s*"model_not_found"|not.found.*model/i`. Or, since we narrow by status first (`status === 404 || status === 400 && /…/.test(...)`), the false-positive blast radius is small. Planner pick: keep the audit's regex literally; assertion-test all three corpora.
- **Never `JSON.parse(bodyText)`** — the body is 200-char-truncated mid-key in the worst case. The redaction also rewrites secret-shaped substrings, breaking JSON validity.

**Status mapping:**

| Status | Code |
|---|---|
| 400 + regex match | `upstream_invalid_model` |
| 404 (any body) | `upstream_invalid_model` |
| 400 + regex miss | `upstream_unknown` |

---

## R4 — Timeout / connect-error detection patterns

**Codebase patterns surveyed:**

| Site | Pattern | Notes |
|---|---|---|
| `packages/litellm-client/src/retry.ts:26-32` | `const RETRYABLE_CONNECTION_CODES = new Set(["ECONNRESET","ECONNREFUSED","ETIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET"])` + `(err as Error & { code?: unknown }).code` | Canonical set used by the A4 retry layer |
| `apps/api/src/routes/diarization.ts:372` | `if ((err as Error).name === "AbortError") return;` | AbortError-via-name detection |
| `apps/api/src/routes/tokens/_call-provider.ts:198-206` | Bare `catch {}` that maps EVERYTHING to 503 with a `"timed-out"` message — no discrimination | Coarse pattern, not what we want here |

**Recommended detection logic for the classifier helper (refines audit §5.2):**

```typescript
const e = err as { name?: string; code?: unknown; message?: string };

// AbortError → emitted by AbortController.abort() AND by undici when a signal aborts.
if (e?.name === "AbortError") {
  return { code: "upstream_timeout", provider: "unknown", userFacingMessage: MSG.upstream_timeout };
}

// Undici timeout codes. UND_ERR_ABORTED is technically distinct from AbortError
// but surfaces the same user signal (cancellation). The other two are explicit timeouts.
if (typeof e?.code === "string") {
  const code = e.code;
  if (code === "UND_ERR_ABORTED"
      || code === "UND_ERR_CONNECT_TIMEOUT"
      || code === "UND_ERR_HEADERS_TIMEOUT"
      || code === "UND_ERR_BODY_TIMEOUT") {
    return { code: "upstream_timeout", provider: "unknown", ... };
  }
  // Connect-refused / DNS / TLS handshake / socket reset — all map to
  // "unknown" (the user-facing message is the same: upstream unreachable).
  if (code === "ECONNREFUSED"
      || code === "ECONNRESET"
      || code === "ETIMEDOUT"
      || code === "ENOTFOUND"
      || code === "UND_ERR_SOCKET") {
    return { code: "upstream_unknown", provider: "unknown", ... };
  }
}

// Catch-all: redact whatever message exists and bury it in the log binding.
return {
  code: "upstream_unknown",
  provider: "unknown",
  upstreamBodyTruncated: redactSecretShapes(e?.message ?? "").slice(0, 500),
  userFacingMessage: MSG.upstream_unknown,
};
```

**The `(err as Error & { code?: unknown }).code` cast pattern is the established norm** (`retry.ts:45`). LOCKER-02 (`as unknown as` forbidden) — but plain `as` cast is permitted. The cast above is `as { name?, code?, message? }` not `as unknown as` — clean.

---

## R5 — `StreamChunk` discriminated union (current + required)

**Current source (`apps/api/src/lib/sse-parser.ts:28-35`):**

```typescript
export type StreamChunk =
  | { type: "content"; text: string }
  | ToolCallChunk
  | {
      type: "done";
      finishReason: string;
      usage: { promptTokens: number; completionTokens: number };
    };
```

`ToolCallChunk` lives in `apps/api/src/lib/tool-call-accumulator.ts` (imported as a type).

**Required widening (this phase):**

```typescript
export type StreamChunk =
  | { type: "content"; text: string }
  | ToolCallChunk
  | {
      type: "done";
      finishReason: string;
      usage: { promptTokens: number; completionTokens: number };
    }
  | {
      type: "error";
      error: string;                              // canonical English; <=500 chars; secret-redacted
      code: AgentUpstreamErrorCode;               // discriminant for renderer + dashboards
      provider: AgentUpstreamProvider;            // "litellm" | "unknown" (D2)
    };
```

**Consumers of `StreamChunk`:**

| Site | Usage |
|---|---|
| `apps/api/src/routes/agent/stream.ts:59` | `import { type StreamChunk, sseToNdjson }` — used in `endWithFinish` + drain-catch synthetic chunk |
| `apps/api/src/lib/sse-parser.ts:57-97` | `translateChunk` generator yields `StreamChunk` |
| `apps/api/src/lib/sse-parser.ts:99` | `sseToNdjson` generator return type |
| Tests | Parse-and-assert in `stream.test.ts:425, 871, 940, 1187-1196, 1240` |

**Type-narrowing impact:** Widening the union doesn't break existing consumers — they all discriminate on `type` and the `"error"` case is new. The `for await (const chunk of sseToNdjson(...))` loop in `stream.ts:314-318` never YIELDS `type:"error"` (sseToNdjson doesn't produce it); only the catch blocks do. So no exhaustive-switch needs updating outside the test file.

**Importing `AgentUpstreamErrorCode` and `AgentUpstreamProvider` into `sse-parser.ts`** creates a new edge: `sse-parser.ts` (lib) → `agent-upstream-error-classify.ts` (lib). Both are pure lib modules at the same layer, no circular risk. Acceptable.

---

## R6 — `endWithFinish` helper

Already pasted at R2.5. **Keep as-is** for the successful-drain `finally` path. Not used by the new error path.

---

## R7 — Mid-stream content tracking

**No `contentEmitted` flag exists in `stream.ts`.** The drain loop (`stream.ts:314-318`):

```typescript
for await (const chunk of sseToNdjson({ body: webBody, acc })) {
  if (raw.writableEnded) break;
  raw.write(`${JSON.stringify(chunk)}\n`);
}
```

…never inspects the chunk type or counts emissions. The drain catch (`stream.ts:319-337`) thus has NO knowledge of whether content has already streamed.

**Implication for D1 (locked: single `type:"error"` regardless of preceding content):** Perfect alignment — we don't need a flag. The drain catch always emits the same terminal `type:"error"` chunk; if content/tool_call chunks already streamed, they stay on the wire and the error chunk is the new terminator. The client renderer (per peer 9zn786o0) flips the bubble to error state on `type:"error"`; partial content remains visible per renderer policy (NOT the server's concern).

**Test implication:** The mid-stream test in `agent-stream-mid-stream-error.test.ts` (audit §7.4) must drive a stream that emits N>0 content chunks, then errors mid-flight, then assert that:
1. The N content chunks are on the wire (preserved).
2. The terminal frame is `type:"error"` (not `type:"done"`).
3. NO `type:"done"` chunk appears AT ALL in the response body.

---

## R8 — Unit-test fixture style

**Canonical patterns from `apps/api/tests/unit/routes/agent/stream.test.ts`:**

### R8.1 — Hermetic Fastify app (lines 100-128)

```typescript
async function buildTestApp(opts: TestAppOpts = {}): Promise<FastifyInstance> {
  // ... DEFAULT_AGENT_MODEL env shim ...
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value) throw new AuthError("unauthorized");
    const userId = opts.bearerMap?.[value];
    if (!userId) throw new AuthError("unauthorized");
    (req as unknown as { user: { id: string; email: string } }).user = {
      id: userId,
      email: `${userId}@test.local`,
    };
  });
  await app.register(
    buildAgentStreamRoutes({
      db: fakeDb() as never,
      litellm: fakeLitellm(),
    }),
  );
  await app.ready();
  return app;
}
```

### R8.2 — Two upstream-mocking strategies

**Strategy A — MockAgent (network-boundary mock; lines 201-217):**

```typescript
agent = new MockAgent({ connections: 10 });
agent.disableNetConnect();
Object.defineProperty(agent, Symbol.for("openwhispr.ssrf-wrapped"), {
  value: true, enumerable: false, writable: false, configurable: false,
});
setGlobalDispatcher(agent);
// ... in the test:
agent.get(LITELLM_BASE).intercept({ path: LITELLM_PATH, method: "POST" })
     .reply(503, "boom");
```

**Strategy B — Inject a stubbed `chatCompletionsStream` (lines 1153-1209):**

```typescript
const litellm = fakeLitellm({
  chatCompletionsStream: () =>
    Promise.reject(new LitellmUpstreamError(502, "upstream timed out")),
});
// ...register routes with this litellm...
```

**Pick for the new envelope tests:** Strategy B for the 11 taxonomy cases — direct, deterministic, no need to fake undici 4xx/5xx body shapes. Strategy A for the wire-shape regression (audit §7.2 `agent-stream-error-then-end.test.ts`) — exercises the real undici dispatch path end-to-end.

### R8.3 — NDJSON line parsing pattern

```typescript
const lines = r.body.split("\n").filter((l) => l.length > 0);
expect(lines).toHaveLength(1);
const chunk = JSON.parse(lines[0]) as { type: string; error: string; code: string; provider: string };
expect(chunk.type).toBe("error");
expect(chunk.code).toBe("upstream_auth");
expect(chunk.provider).toBe("litellm");
expect(chunk.error).toMatch(/authentication/i);
expect(chunk.error.length).toBeLessThanOrEqual(500);
// Secret-shape negative assertion:
expect(chunk.error).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
expect(chunk.error).not.toMatch(/Bearer\s+eyJ/);
```

---

## R9 — Integration test harness

`apps/api/tests/integration/` is dominated by full-stack characterization tests using `buildApp()` + `testcontainers` (Postgres, Redis). Examples: `r20-bearer-session-resolution.test.ts`, `r22-verify-email-session.test.ts`, `r31-realtime-ga-shape.test.ts`.

**For this phase, the audit §7.5 e2e through `docker compose` is the right harness** — the unit tests in §7.1-§7.4 already cover wire semantics at the route boundary with MockAgent. An additional integration-tier test is NOT required (the unit tests with Strategy A above ARE integration-grade for this route — they exercise the full `buildApp()` graph minus database). Planner can SKIP a separate `tests/integration/agent-stream-error*.test.ts` file unless the discuss-phase calls one out — CONTEXT.md does not.

**E2E (audit §7.5):** `tests/e2e/agent/stream-error-rendering.spec.ts`. Boot `docker compose` with `LITELLM_BASE_URL` pointing at a config with an empty `model_list` (existing fixture: `compose/litellm/litellm_config.contract.yaml` — confirm via planner phase that fixture is reusable; if not, generate a minimal yaml inline). POST `/api/agent/stream` with an unknown model. Assert the desktop/web renderer's error UI element renders.

---

## R10 — Provider inference confirmation (D2 lock)

**Confirmed locked: `provider: "litellm"` for any `LitellmUpstreamError`; `provider: "unknown"` for connect/timeout/network errors.**

**Wire-type narrowing required:**

```typescript
export type AgentUpstreamProvider = "litellm" | "unknown";
```

**Type-narrowing implication for the `StreamChunk["error"]` variant:** the `provider` field uses this union literally — no `"groq" | "openai" | …"` expansion (audit §5.2 proposed a broader union that CONTEXT.md D2 explicitly shrinks).

**Per-D3:** the canonical message strings don't reference the underlying provider. "Upstream provider rejected the request" is provider-agnostic English — operators correlate to the real provider via `req.log.error` binding's `upstream_body_truncated` field + the LiteLLM proxy's own `litellm_call_id`. End users never see provider names.

---

## R11 — Canonical English error messages (D3)

Six canonical messages, one per `AgentUpstreamErrorCode`. All ≤200 chars (well under the 500-char wire budget). All English-only (no Cyrillic — runtime i18n via `i18next` is a follow-up phase, deliberately not gated here).

| `code` | `error` field (canonical English) | Trigger |
|---|---|---|
| `upstream_auth` | `"Upstream model provider rejected the request (authentication failure). Contact your operator."` | `LitellmUpstreamError.status` in {401, 403} |
| `upstream_rate_limit` | `"Rate limit reached. Please retry in a few seconds."` | `LitellmUpstreamError.status === 429` |
| `upstream_quota_exceeded` | `"Upstream provider quota exceeded. Contact your operator."` | `LitellmUpstreamError.status === 402` |
| `upstream_invalid_model` | `"Requested model is not available on this server. Choose a different model or contact your operator."` | `LitellmUpstreamError.status === 404` OR (`status === 400` AND body regex match) |
| `upstream_timeout` | `"Upstream provider did not respond in time. Please retry."` | `err.name === "AbortError"` OR `err.code` in {`UND_ERR_ABORTED`, `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`} |
| `upstream_unknown` | `"Upstream model provider is temporarily unavailable. Please try again."` | Any other `LitellmUpstreamError` (incl. 400 without regex match, all 5xx) OR any non-typed error (ECONNREFUSED, generic Error, etc.) |

**Planner recommendation: encode these as a frozen const literal map in the helper:**

```typescript
const USER_FACING_MESSAGES = Object.freeze({
  upstream_auth: "Upstream model provider rejected the request (authentication failure). Contact your operator.",
  upstream_rate_limit: "Rate limit reached. Please retry in a few seconds.",
  upstream_quota_exceeded: "Upstream provider quota exceeded. Contact your operator.",
  upstream_invalid_model: "Requested model is not available on this server. Choose a different model or contact your operator.",
  upstream_timeout: "Upstream provider did not respond in time. Please retry.",
  upstream_unknown: "Upstream model provider is temporarily unavailable. Please try again.",
} as const) satisfies Record<AgentUpstreamErrorCode, string>;
```

The `satisfies` ensures exhaustive coverage at the type level — adding a new code to the union without a new message string is a compile error.

**`retryAfterMs` on the wire?** CONTEXT.md does not lock either way. **Recommendation: DO NOT add it to the wire envelope.** Reasons:
1. D3 prefers narrow canonical strings — `"Please retry in a few seconds"` is the user-visible signal; the exact ms count is operator info.
2. Widening the wire is a future-deferred ratchet (peer can extend later).
3. The log binding already carries it (audit §5.1 — though `retryAfterMs` is not yet in the log binding list; planner should add it: `retry_after_ms: err.retryAfterMs ?? undefined`).

---

## R-extra — `litellm_config.yaml` aliases (provisioning context, OUT OF SCOPE for this fix)

Confirmed via direct read of `compose/litellm/litellm_config.yaml:21-135`. Bundled aliases:

| Alias | Backing |
|---|---|
| `qwen3.6-plus` | openrouter/qwen/qwen3.6-plus |
| `gemini-3-flash` | openrouter/google/gemini-3.1-flash-lite |
| `gpt-4o-mini` | openrouter/openai/gpt-4o-mini |
| `qwen3.6-cleanup` | openrouter/qwen/qwen3.6-35b-a3b |
| `whisper-large-v3` | groq/whisper-large-v3 (STT) |
| `realtime-default`, `gpt-realtime`, `gpt-realtime-mini`, `gpt-4o-realtime-preview` | openai/gpt-realtime* (realtime WSS) |
| `openwhispr-default` | groq/whisper-large-v3 (STT — alias of above) |
| `openwhispr-reason` | openrouter/openai/gpt-4o-mini |
| `openwhispr-realtime` | openai/gpt-realtime |

**`openai/gpt-oss-120b` (the model the failing desktop client requested) is NOT present.** No Groq-hosted CHAT model exists in the bundled config (Groq is STT-only). This is the provisioning gap the audit §5.3 describes — out of scope here.

---

# Gotchas

1. **LOCKER-05 belt-and-braces — `redactSecretShapes(...).slice(0, 500)` is the ONLY safe way to extract a string from `LitellmUpstreamError` for the log binding.** Do NOT access `err.bodyText` (private declare, non-enumerable). Read `err.message` instead; it's already redacted+truncated to 200 chars, but re-run redaction and re-slice to 500 chars (the second cap is permissive — the input is already 200-truncated; the re-redaction is the defense-in-depth for "future config that relaxes the truncation cap").

2. **`upstream_body_truncated` MUST stay in the LOG binding only, NEVER on the wire.** D3 locked this; the test `agent-stream-upstream-error-envelope.test.ts` must assert (a) `chunk.error` has no secret shape, (b) `chunk` JSON has no `upstream_body_truncated` field at all (assert key absence, not just value).

3. **`req.log.error` flip from `req.log.warn`** is a structured-log-level change. If any Loki alert / Grafana panel watches for `level=warn AND msg~agent.stream` (the audit says no), it would silently stop firing. Audit §6 confirmed zero such alerts — planner can skip a search-and-replace audit, but a low-cost belt-and-braces: ripgrep for `agent.stream upstream` across `compose/grafana/`, `charts/openwhispr/templates/grafana/`, and `docs/` once during plan execution.

4. **`endWithFinish(raw, "upstream_error")` deletion** — there are NO other callers of `endWithFinish` with the literal `"upstream_error"`. (Verified via codebase grep — the only two are the preflight catch L282 and L325-L330 drain catch which uses `"stream_error"`.) The helper itself stays.

5. **The mid-stream drain catch sits INSIDE a `try { … } finally { raw.end() }` block (stream.ts:313-347).** The error chunk write happens in the `catch` arm; the `finally` arm calls `raw.end()` afterwards. Do NOT call `raw.end()` from inside the catch — the `finally` already does it. (The preflight catch DOES need its own `raw.end()` because it returns directly without entering a `finally`.)

6. **`reply.hijack()` was already called** by the time both catch blocks run, so `req.log.error` flows through Fastify's logger as normal but the centralized `setErrorHandler` is bypassed — that's why the route hand-writes the wire response. The `event` log binding is the operator-visible signal; no other route emits `event: "agent.stream.upstream_failure"` (grep verified zero hits across the repo).

7. **Test 9, Test 17, Test 18 are explicit renames-and-rewrites in `stream.test.ts`** — not deletions. The audit §7.2 calls out a NEW file `agent-stream-error-then-end.test.ts` but CONTEXT.md doesn't require both. **Planner pick:**
   - Rewrite Test 9 / Test 17 / Test 18 IN-PLACE (assert `type:"error"` + `code` + `provider`, drop `finishReason:"upstream_error"` assertions).
   - Rewrite Test 10 IN-PLACE (drain catch — assert `type:"error"`, drop `finishReason:"stream_error"`).
   - ADD `agent-stream-upstream-error-envelope.test.ts` under `apps/api/tests/unit/routes/agent/__tests__/` with the 11 taxonomy cases from audit §7.1.
   - ADD `agent-stream-upstream-failure-log.test.ts` (audit §7.3 structured log assertion).
   - ADD `agent-upstream-error-classify.test.ts` (pure helper unit tests — 11 cases mirror envelope tests, plus malformed-message edge cases for ≥90% branch coverage).

8. **`AgentUpstreamErrorCode` and `AgentUpstreamProvider` should be exported from the helper module, and the `StreamChunk` widening in `sse-parser.ts` should import the types from there.** This makes the helper the canonical owner of the taxonomy; `sse-parser.ts` is a consumer. LOCKER-04 dead-export check: the types are imported by both the route handler AND the test file → safe.

9. **The route's `req.log.error` call must hoist `resolveModel(body.model ?? undefined)` into a const above the `try` block** so the `model` binding is available in the catch (currently, `model` is only computed *inside* the try at L266). The const declaration goes between L257 (start of try) and L265 (`upstream = await ...`). Audit §5.1 calls this out.

10. **`AgentUpstreamErrorEnvelope.upstreamStatus` is optional** (undefined for non-LitellmUpstreamError errors). Log binding must use `upstream_status: errorEnvelope.upstreamStatus ?? null` (pino tolerates undefined but the JSON line is cleaner with explicit null).

11. **NO new NODE_ENV branches** — the helper is pure (LOCKER-01 clean). NO new hardcoded localhost/UUID/secret shapes (LOCKER-03 clean — the regex character classes for the message detection are constants, not literal credentials). NO type suppressions (LOCKER-02 clean — `as { name?, code?, message? }` is plain `as`, not `as any` / `as unknown as`).

12. **E2E test (audit §7.5) requires a `litellm_config.yaml` with an empty model_list.** Check if `compose/litellm/litellm_config.contract.yaml` exists; if not, the planner adds `tests/e2e/fixtures/litellm_config.empty.yaml` and a docker-compose override that mounts it.

---

# Planner sequencing hints

**Recommended order (RED → GREEN → REFACTOR per project DISCIPLINE rule):**

1. **Task 1 — Helper unit tests (RED).** Create `apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts` asserting all 11 audit-§7.1 cases against a not-yet-existing `classifyAgentUpstreamError` import. Tests fail because the module doesn't exist.

2. **Task 2 — Helper implementation (GREEN).** Create `apps/api/src/lib/agent-upstream-error-classify.ts` with the `AgentUpstreamErrorCode` / `AgentUpstreamProvider` / `AgentUpstreamErrorEnvelope` exports + the canonical message map (R11) + `classifyAgentUpstreamError` function (R3 + R4). Run task 1 tests → green. Coverage report → ≥90% lines/branches/functions/statements per project DISCIPLINE.

3. **Task 3 — `StreamChunk` widening (refactor).** Edit `apps/api/src/lib/sse-parser.ts:28-35` to add the `type:"error"` variant; import `AgentUpstreamErrorCode` + `AgentUpstreamProvider` from the new helper. No runtime change — type-only ratchet.

4. **Task 4 — Rewrite `stream.test.ts` Tests 9, 10, 17, 18 (RED).** Update assertions to expect `type:"error"` + `code` + `provider` and explicitly assert NO `finishReason:"upstream_error"` / `"stream_error"` substring anywhere in the response body. Tests fail (route still emits old shape).

5. **Task 5 — New `agent-stream-upstream-error-envelope.test.ts` + `agent-stream-mid-stream-error.test.ts` + `agent-stream-upstream-failure-log.test.ts` (RED).** Under `apps/api/tests/unit/routes/agent/__tests__/`. Strategy B (stubbed `chatCompletionsStream`) for the envelope cases; strategy A (MockAgent) for the wire-shape regression; spy-on `req.log.error` for the log assertion. Tests fail.

6. **Task 6 — Edit `stream.ts` route handler (GREEN).**
   - Hoist `const resolvedModel = resolveModel(body.model ?? undefined);` above the try (line ~252).
   - Rewrite preflight catch L272-L284: call `classifyAgentUpstreamError(err)`, emit `type:"error"` chunk via `raw.write` + `raw.end`, call `req.log.error({event:"agent.stream.upstream_failure", upstream_status, code, provider, model: resolvedModel, upstream_body_truncated, retry_after_ms, request_id: req.id, litellm_call_id: undefined}, "agent stream upstream call failed")`. Delete the `endWithFinish(raw, "upstream_error")` call.
   - Rewrite drain catch L319-L337: same classify+emit+log path. The `finally` arm at L338-L346 already calls `raw.end()` — do NOT duplicate. The drain catch path may know `litellmCallId` (captured at L294) — pass it through to the log binding.
   - Run Tasks 4 + 5 tests → green.

7. **Task 7 — E2E test (audit §7.5).** Create `tests/e2e/agent/stream-error-rendering.spec.ts` + supporting fixture if needed. Skip if user-elects per CONTEXT.md (CONTEXT.md does NOT explicitly mandate it, but project DISCIPLINE rule 3 — "E2E mandatory for every phase touching a user-visible route" — does).

8. **Task 8 — Verification + commit.** Per project Hard Rule 3, the orchestrator independently verifies: `pnpm --filter @openwhispr/api test agent-stream`, full unit suite, coverage report ≥90/90/90/90 on diff. Commit with conventional message.

**Files touched:**

| File | Action | Reason |
|---|---|---|
| `apps/api/src/lib/agent-upstream-error-classify.ts` | NEW | Pure classifier + canonical messages + types |
| `apps/api/src/lib/sse-parser.ts` | MODIFY (`StreamChunk` widening) | Add `type:"error"` variant |
| `apps/api/src/routes/agent/stream.ts` | MODIFY (catch blocks + log levels + hoist resolved model) | Wire the new envelope |
| `apps/api/tests/unit/lib/agent-upstream-error-classify.test.ts` | NEW | Helper coverage (11 cases) |
| `apps/api/tests/unit/routes/agent/stream.test.ts` | MODIFY (rewrite Tests 9, 10, 17, 18) | Drop deprecated `finishReason` assertions |
| `apps/api/tests/unit/routes/agent/__tests__/agent-stream-upstream-error-envelope.test.ts` | NEW | Contract (audit §7.1) |
| `apps/api/tests/unit/routes/agent/__tests__/agent-stream-mid-stream-error.test.ts` | NEW | Drain parity (audit §7.4) |
| `apps/api/tests/unit/routes/agent/__tests__/agent-stream-upstream-failure-log.test.ts` | NEW | Structured log (audit §7.3) |
| `tests/e2e/agent/stream-error-rendering.spec.ts` | NEW | E2E render proof (audit §7.5; DISCIPLINE 3) |

**Estimated phase size:** 5 tasks (1 helper, 1 type widening, 1 route edit, 1 test rewrite + 3 new test files batched as one task, 1 e2e). 8 source/test files total. ~300 net lines added, ~50 deleted.

**Confidence:** HIGH on R1–R5, R6, R7, R10. HIGH on R3 detection regex (audit's pattern verified against Phase-19.2 SERVER-ERRORS Entry 11 precedent). HIGH on R4 (existing patterns in `retry.ts:26-32` + `diarization.ts:372` are the canonical norm in this repo). MEDIUM on R11 wording (English literals — planner has narrow discretion within D3's "canonical English" constraint).
