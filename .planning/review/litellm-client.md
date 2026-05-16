# Review: litellm-client

Branch: main @ 1832f28
Scope: packages/litellm-client/src/** (config.ts, errors.ts, index.ts)
Reviewer: gsd-code-reviewer (FORCE stance)
Reviewed: 2026-05-16

## Summary
- Files: 3 (config.ts 57 LoC, errors.ts 42 LoC, index.ts 258 LoC)
- Findings: CRITICAL=1 HIGH=4 MEDIUM=4 LOW=2
- Top 3 risks:
  1. **CR-01** — `LitellmUpstreamError.bodyText` stores the **full untruncated** upstream response body as a public field. Only the default `message` is truncated to 200 chars. Any caller that does `logger.error({ err })`, `JSON.stringify(err)`, or returns the error through an error-serializer (Fastify default `err.toJSON`, Pino's `serializers.err`) will exfiltrate the entire upstream payload — which can contain provider-side error envelopes, prompt echoes, raw tool-call arguments, and (on misconfigured proxies) the upstream provider's response including any data the proxy chose to forward. Defeats the explicit T-03-03-01 mitigation called out in the file header.
  2. **HI-01** — Three of four request methods (`chatCompletions`, `audioTranscriptions`, `passthrough`) pass NO `headersTimeout`, NO `bodyTimeout`, and accept NO `AbortSignal`. A stalled LiteLLM proxy or upstream provider will hang the calling Fastify worker forever (undici default `headersTimeout` is 300s but `bodyTimeout` is 300s only too — long enough that 1000 concurrent stalls exhaust the event loop). Only `chatCompletionsStream` accepts a signal, and even there `bodyTimeout` defaults to 0 (infinite).
  3. **HI-02** — Client relies entirely on `setGlobalDispatcher` (installed by `apps/api/src/bootstrap.ts`) for SSRF protection. The package has NO defensive check that a non-default dispatcher is registered, and no per-call dispatcher injection point. Any new consumer (worker, future CLI, test harness) that imports `buildLitellmClient` without first running api's bootstrap silently bypasses the SSRF allow-list and the `LITELLM_BASE_URL` override becomes a server-side fetch primitive (any internal URL the operator points it at).

## Findings

### CRITICAL

#### CR-01 — Full upstream body retained as public field on `LitellmUpstreamError`
**File:** `packages/litellm-client/src/errors.ts:31,37,40`
**Issue:** The file header docstring promises "bodyText is truncated to 200 chars" (line 14–16). The constructor only truncates inside the default `message` (`bodyText.slice(0, 200)`); the public `readonly bodyText: string` field captures the **full** body. Pino's stock `err` serializer and Fastify's reply-on-error serializer enumerate all `Error` own-properties — any logger touching this error leaks the whole upstream response. LiteLLM upstream bodies routinely include the request echo, model name, provider-side stack traces, and on some proxies the raw provider response body. This is the exact threat T-03-03-01 was meant to mitigate.
**Fix:**
```ts
export class LitellmUpstreamError extends Error {
  public readonly status: number;
  public readonly bodyText: string; // already truncated
  constructor(status: number, bodyText: string, message?: string) {
    const truncated = bodyText.slice(0, 200);
    super(message ?? `LiteLLM upstream returned ${status}: ${truncated}`);
    this.name = "LitellmUpstreamError";
    this.status = status;
    this.bodyText = truncated; // <-- store the truncated form
  }
}
```
Additionally, add a `toJSON()` that omits any field other than `name/status/message` to harden against future log-serializer changes.

### HIGH

#### HI-01 — Missing timeouts and AbortSignal on `chatCompletions`, `audioTranscriptions`, `passthrough`
**File:** `packages/litellm-client/src/index.ts:160-168, 219-227, 230-243`
**Issue:** None of these three methods set `headersTimeout` or `bodyTimeout`, and none accept an `AbortSignal`. A misbehaving upstream pins a Fastify worker indefinitely; at 1000 concurrent users (project SLO) this is a fleet-wide stall vector. Cross-reference: `apps/api/src/lib/dep-check.ts:85-86` already uses `bodyTimeout: PROBE_TIMEOUT_MS, headersTimeout: PROBE_TIMEOUT_MS` for probes — the production path is less defensive than the health probe.
**Fix:** Add `headersTimeout` (e.g., 30_000ms) and `bodyTimeout` (route-tunable; 60_000ms for chat, 300_000ms for transcribe with large audio) plus a `signal?: AbortSignal` parameter on all three request interfaces, forwarded into the undici options.

#### HI-02 — No defense against missing SSRF dispatcher; no per-call dispatcher injection
**File:** `packages/litellm-client/src/index.ts:117-118, 188-190`
**Issue:** Comment on lines 188–190 explicitly says "NO per-call dispatcher option — rely on the process-wide SSRF agent set via setGlobalDispatcher." This is fine for `apps/api` (which calls `setGlobalDispatcher` in `bootstrap.ts:57`), but the client is published as a workspace package that `apps/worker` and any future consumer will import. There is no runtime assertion that the global dispatcher is non-default, and no documented contract. If `LITELLM_BASE_URL` is set to a corporate URL, a consumer without SSRF bootstrap can be steered (via misconfig or env injection) at internal hosts — server-side fetch primitive.
**Fix:** At `buildLitellmClient` entry, optionally accept a `dispatcher` option and pass it through. If neither a dispatcher is passed nor `process.env.OPENWHISPR_SSRF_INSTALLED === "1"` (set by bootstrap), throw a loud-fail error. Mirrors the byok-guard loud-fail posture.

#### HI-03 — Stale/fictional default model alias `qwen3.6-plus` and `gemini-3-flash`
**File:** `packages/litellm-client/src/config.ts:30`, `packages/litellm-client/src/index.ts:38-41`
**Issue:** `DEFAULT_CHAT_MODEL = "qwen3.6-plus"` is hardcoded as the runtime fallback when the operator omits `LITELLM_DEFAULT_CHAT_MODEL`. The OpenRouter alias `qwen3.6-plus` is not a current OpenRouter slug (canonical Qwen3 family slugs are `qwen/qwen3-...`); likewise `gemini-3-flash` listed in `BUNDLED_MODEL_PROVIDER` does not match any current OpenRouter Gemini slug (`google/gemini-2.5-flash`, etc.). A `git clone && docker compose up` user hits `404 model not found` on every reason/agent-stream call before LiteLLM ever sees their request. Drift between this map and `compose/litellm/litellm_config.yaml` is the failure mode RESEARCH Pitfall #8 was supposed to prevent.
**Fix:** Either (a) load the alias list at boot from `compose/litellm/litellm_config.yaml` via a small loader, or (b) drop the bundled-model precheck entirely and let LiteLLM return its canonical 404. Whichever path is chosen, the hardcoded "qwen3.6-plus" / "gemini-3-flash" strings must go before public release — a fresh-clone user will hit them immediately. Cross-verify aliases against actual current LiteLLM `model_list`.

#### HI-04 — `streamOptions` spread sequence: caller cannot opt OUT of `include_usage`
**File:** `packages/litellm-client/src/index.ts:177-187`
**Issue:** `stream_options: { include_usage: true, ...callerStreamOptions }` puts the default *before* the caller spread, so a caller explicitly passing `stream_options: { include_usage: false }` correctly overrides. **However**, the broader `...req.extras` happens first, then the explicit `stream_options` literal wins regardless. That means a caller who omitted `stream_options` from `extras` gets `include_usage: true` (good), but a caller who put `{ stream_options: { reasoning: ... }, ... }` in extras keeps their `reasoning` (good via callerStreamOptions read on line 178). Net behaviour is correct, but the double-source (`req.extras.stream_options` AND inferred default) is fragile — a future refactor moving the literal will silently change wire output. Also: `include_usage: true` adds non-zero billing-line overhead per stream; making this opt-out is fine but the default should be documented.
**Fix:** Extract a single `buildStreamOptions(req)` helper that returns the final merged object, then drop `stream_options` from `req.extras` before the outer spread. Add a unit test asserting that `extras.stream_options.include_usage = false` actually round-trips to the wire body.

### MEDIUM

#### ME-01 — `BUNDLED_MODEL_PROVIDER` duplicates `compose/litellm/litellm_config.yaml` (drift risk)
**File:** `packages/litellm-client/src/index.ts:37-42`
**Issue:** Hand-maintained mirror of the YAML config. Any operator who edits the YAML to add a model (e.g., `mistral-large-latest`) gets no pre-check, falls back to upstream 401, and triggers RESEARCH Pitfall #8 (silent 401 → desktop logout). The whole point of the static map was to prevent that — but only for the four hardcoded entries.
**Fix:** Generate the map from the YAML at build time, or accept it via the env (one variable: `LITELLM_BUNDLED_MODEL_PROVIDERS=qwen3.6-plus:openrouter,whisper-large-v3:groq,...`). At minimum, add a CI check that diffs the two sources.

#### ME-02 — `passthrough` accepts arbitrary `method` string via `as Dispatcher.HttpMethod` cast
**File:** `packages/litellm-client/src/index.ts:238`
**Issue:** `method: args.method as Dispatcher.HttpMethod` — no runtime validation. A caller bug passing `"get "` (trailing space) or `"FOO"` propagates to undici which may reject with an opaque error or, worse, accept and forward. Combined with `passthrough`'s arbitrary `path` argument, this is a small-surface SSRF-adjacent risk if a route ever derives `path` from user input.
**Fix:** Whitelist `["GET","POST","PUT","DELETE","PATCH","HEAD","OPTIONS"]`, throw on miss. Also validate that `path` starts with `/v1/` or another allow-list prefix.

#### ME-03 — Default base URL `http://litellm:4000` is plaintext
**File:** `packages/litellm-client/src/config.ts:29`
**Issue:** The project's hard rule is "HTTPS only — never plaintext HTTP on any externally reachable port." Internal docker network is not externally reachable so this is technically compliant, but the default is footgun-prone: a misconfigured compose that exposes the litellm port (`ports:` rather than `expose:`) instantly serves master-key-bearing traffic on plaintext. Cross-reference operator docs that may suggest port-publishing for debugging.
**Fix:** Document the constraint in a header comment; consider a runtime warning when `baseUrl.startsWith("http://")` AND `baseUrl` hostname is NOT in `{litellm, localhost, 127.0.0.1}`.

#### ME-04 — `LITELLM_MASTER_KEY` env name in code, but spec/CLAUDE.md says `LITELLM_VIRTUAL_KEY` in places
**File:** `packages/litellm-client/src/config.ts:35`
**Issue:** The CLAUDE.md project header says "corporate operators override `LITELLM_BASE_URL` / `LITELLM_VIRTUAL_KEY`" but the loader reads `LITELLM_MASTER_KEY`. The two-name split between "master key" (admin-tier) and "virtual key" (scoped) is a real LiteLLM distinction, so this may be intentional — but the public docs need to disambiguate or operators will set the wrong env. If unintentional, this is a deploy-time footgun.
**Fix:** Add a header comment clarifying that `LITELLM_MASTER_KEY` is correct for v1 (single admin key); document the future virtual-key migration. Or accept both names with a deprecation path.

### LOW

#### LO-01 — `as Parameters<typeof doRequest>[1]` cast in stream path
**File:** `packages/litellm-client/src/index.ts:203`
**Issue:** `requestOpts as Parameters<typeof doRequest>[1]` papers over the fact that `requestOpts` is typed as `Record<string, unknown>`. Lose type-safety on the option object — a typo like `signaal` won't be caught.
**Fix:** Type `requestOpts` explicitly as `Parameters<typeof undiciRequest>[1]` from the start; drop the cast.

#### LO-02 — `JSON.stringify` of metadata header without size cap
**File:** `packages/litellm-client/src/index.ts:134-136`
**Issue:** `x-litellm-spend-logs-metadata: JSON.stringify({ openwhispr_request_id: requestId })` — fine today, but `requestId` is caller-supplied. A 64KB header attack (oversized request_id) propagates straight into the header value. Should be defensively bounded.
**Fix:** Truncate `requestId` to e.g. 128 chars before stringifying; reject non-printable.

## Dead code
None observed. All three exports (`config.ts`, `errors.ts`, `index.ts`) are imported by `apps/api/src/{routes/transcribe.ts, routes/reason.ts, routes/realtime.ts, routes/agent/stream.ts, routes/index.ts, index.ts}` and corresponding tests. `BUNDLED_MODEL_PROVIDER` and `PROVIDER_ENV_VAR` are exported but used only internally — could be made non-exported, but tests import them (`apps/api/tests/unit/routes/transcribe.test.ts:28`), so keeping them public is justified. No orphaned exports.

## Suppressed warnings
- `index.ts:203` — `as Parameters<typeof doRequest>[1]` (see LO-01).
- `index.ts:238` — `as Dispatcher.HttpMethod` (see ME-02).
- `index.ts:178` — `as { stream_options?: Record<string, unknown> } | undefined` — narrowing cast on `req.extras`. Defensible.
No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, or `as any` found. No `as unknown as` chains.

## Notes
- **Retry behaviour:** The package does **not** retry any request. Per the review brief's rule ("must NOT retry POST without idempotency key"), this is *compliant* — explicitly flagging as positive. Adding retry in the future requires an idempotency-key strategy and per-method retryable-status classification.
- **Master key handling:** The bearer token is constructed inside `authHeaders()` and never logged or returned. The only place it could reach a log is via `LitellmUpstreamError` propagation — and the error never receives the auth header, only the response body. Once CR-01 is fixed (truncate `bodyText` field), the key is fully contained.
- **byok-guard `redactUrl` reuse:** The package does not currently log URLs, so the brief's rule ("must reuse `packages/byok-guard` redact for any URL-logging path") is moot here. If HI-02 is fixed by adding a loud-fail message that mentions `baseUrl`, the message MUST call `redactUrl(config.baseUrl)` to scrub embedded credentials.
- **Coverage:** Out of v1 scope per brief, but worth a callout — `chatCompletionsStream`'s `bodyTimeout`/`signal` branches need explicit tests once HI-01/HI-02 land.
- **TODO/FIXME/HACK/XXX/TEMP/WORKAROUND scan:** None present in scope files.
- **No fictional canned-response stubs.** No `if (NODE_ENV === 'test')` short-circuits. Production code path is real.
