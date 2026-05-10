---
phase: 04-streaming-realtime
reviewed: 2026-05-11T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - .github/workflows/nightly-realtime-soak.yml
  - apps/api/src/lib/sse-parser.ts
  - apps/api/src/lib/tool-call-accumulator.ts
  - apps/api/src/routes/agent/stream.ts
  - apps/api/src/routes/agent/translate-tools.ts
  - apps/api/src/routes/index.ts
  - apps/api/src/routes/realtime.ts
  - apps/api/src/routes/tokens/_call-provider.ts
  - apps/api/src/routes/tokens/assemblyai.ts
  - apps/api/src/routes/tokens/deepgram.ts
  - apps/api/src/routes/tokens/openai-realtime.ts
  - compose/e2e/docker-compose.e2e.yml
  - compose/litellm/litellm_config.contract.yaml
  - compose/litellm/litellm_config.e2e-realtime.yaml
  - compose/live-soak/docker-compose.live.yml
  - compose/live-soak/litellm_config.live-realtime.yaml
  - compose/traefik/dynamic.yml
  - compose/traefik/traefik.yml
  - docker-compose.yml
  - packages/contract-tests/src/schemas.ts
  - tests/e2e/mock-realtime/Dockerfile
  - tests/e2e/mock-realtime/cli.ts
  - tests/e2e/mock-realtime/server.ts
  - tools/spike/capture-sse-fixtures.sh
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-05-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Phase 04 lands a clean, well-commented streaming + realtime surface. Token leakage paths are robustly closed (master key never reaches the wire; partial-success fail-fast on parallel mints is correct; `x-litellm-call-id` is server-log-only). Auth-before-rate-limit ordering is correctly enforced via `keyGenerator: (req) => req.user?.id ?? req.ip` and a pre-`hijack` defensive `req.user.id` re-check. NDJSON line-flush correctness is sound: malformed SSE frames are dropped, `[DONE]` returns cleanly, stream-error finish chunks are synthesized, and the accumulator deliberately drops pending state on `finish_reason="stop"` per LiteLLM#17246. Traefik :443 is reverted to defaults and :8443 carries the long-timeouts; the WSS handshake timeout is capped at 10s. The GHA workflow is correctly gated (no `pull_request`, belt-and-suspenders job-level `if`, SHA-pinned actions, `permissions: contents: read`, secret only on the live-soak step).

The findings below are predominantly hardening / quality items, not correctness bugs.

## Warnings

### WR-01: SSE parser cannot handle CRLF (`\r\n\r\n`) frame separators; no upper bound on `buf`

**File:** `apps/api/src/lib/sse-parser.ts:104`
**Issue:** Frame-boundary scan is hard-coded to `buf.indexOf("\n\n")`. Per the SSE spec, event boundaries are `\r\n\r\n`, `\n\n`, OR `\r\r`. LiteLLM today emits LF-only, but real OpenAI / Cloudflare-fronted upstreams emit CRLF, and some intermediaries normalize one direction. The first time this hits a CRLF upstream the parser will buffer the entire stream into `buf` and only flush on EOF — producing a worst-case multi-MB allocation and zero progressive token streaming (defeating the load-bearing first-line latency budget). Additionally, no upper bound is enforced on `buf` length — a malformed upstream that never emits `\n\n` grows `buf` unboundedly until the upstream closes (DoS-on-self via memory).
**Fix:**
```ts
// Pre-normalize line endings on each chunk append:
buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
// Plus a sanity cap:
if (buf.length > MAX_FRAME_BYTES) throw new Error("sse: frame buffer overflow");
```

### WR-02: SSE parser strips `data: ` prefix by hard-coded length 6, mishandling `data:` (no space)

**File:** `apps/api/src/lib/sse-parser.ts:107-111`
**Issue:** `frame.split("\n").find((l) => l.startsWith("data: "))` only matches when there's a space after the colon, and `dataLine.slice(6)` assumes that 6-char prefix exactly. The SSE spec allows `data:foo` (no space — the leading single space is optional). Frames without the optional space are silently dropped. Multi-line `data:` continuations are also dropped.
**Fix:**
```ts
const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
if (!dataLine) continue;
let payload = dataLine.slice(5);
if (payload.startsWith(" ")) payload = payload.slice(1);
```

### WR-03: AbortController close-listener never removed → per-request closure retention

**File:** `apps/api/src/routes/agent/stream.ts:141-143`
**Issue:** `req.raw.once("close", () => abort.abort())` is registered on the raw request and never explicitly removed on normal completion. While `once` fires at most once, the listener (capturing the resolved `abort` controller) remains attached to the socket until the `'close'` event fires — under HTTP keep-alive this can be many requests later. At 1000 concurrent users this accumulates closures pointing at long-resolved controllers.
**Fix:**
```ts
const onClose = () => abort.abort();
req.raw.once("close", onClose);
try { /* drain */ } finally {
  req.raw.off("close", onClose);
  if (!raw.writableEnded) { try { raw.end(); } catch {} }
}
```

### WR-04: `mock-realtime` server has no per-connection inactivity / max-session ceiling

**File:** `tests/e2e/mock-realtime/server.ts:60-103`
**Issue:** The handler tracks `openSockets` for graceful shutdown but imposes no per-connection ping-timeout, max-message-rate, or max-session-duration. The 65-min live-soak test pattern reuses the same upstream contract, and a pathological client that opens connections and never sends frames is held until OS-level TCP RST. For a test-only mock the blast radius is bounded (e2e profile only), but a session ceiling mirrors real OpenAI behavior and prevents test-runner-leaked sockets from accumulating across reruns inside the same container.
**Fix:**
```ts
const sessionTimer = setTimeout(() => socket.close(1001, "max session"), 60 * 60 * 1000);
socket.on("close", () => { clearTimeout(sessionTimer); openSockets.delete(socket); });
```

### WR-05: Provider mint routes do not trim env-key whitespace; whitespace-only keys bypass the missing-key gate and produce a misleading 503

**Files:**
- `apps/api/src/routes/tokens/assemblyai.ts:59,74`
- `apps/api/src/routes/tokens/deepgram.ts:36,51`
- `apps/api/src/routes/tokens/openai-realtime.ts:66,88`

**Issue:** `process.env.ASSEMBLYAI_API_KEY` (etc.) is passed straight into the `authorization` header without `.trim()`. A trailing newline or accidental whitespace (common with `echo "..." >> .env` patterns) causes undici to either throw `HeadersTimeoutError` or emit a malformed header. A whitespace-only value (e.g. `ASSEMBLYAI_API_KEY=" "`) passes the `if (!process.env.ASSEMBLYAI_API_KEY)` gate (truthy non-empty string), reaches the upstream as `authorization: " "`, gets a 401 → mapped to "not configured" 503. This misleads operators who HAVE set the key (with whitespace).
**Fix:** Centralize an env-key reader in `_call-provider.ts`:
```ts
export function readEnvKey(envName: string): string | undefined {
  const v = process.env[envName]?.trim();
  return v && v.length > 0 ? v : undefined;
}
```
Use it in both the preHandler gate and the header construction site of all three mint routes.

## Info

### IN-01: Default agent model fallback may not match registered LiteLLM model_name

**File:** `apps/api/src/routes/agent/stream.ts:68`
**Issue:** `DEFAULT_AGENT_MODEL = "qwen/qwen3.6-plus"` carries the `qwen/` provider prefix, but every LiteLLM model entry in `compose/litellm/litellm_config.contract.yaml` and `litellm_config.e2e-realtime.yaml` is registered as bare `qwen3.6-plus` (no slash). If `body.model` is absent and `DEFAULT_AGENT_MODEL` env is unset, the route resolves to a non-existent LiteLLM `model_name` and 404s from upstream → `upstream_error` finish chunk.
**Fix:** `const DEFAULT_AGENT_MODEL = "qwen3.6-plus";` (or document why the prefixed form is intentional).

### IN-02: `dispatcherInstalled` global has no test-reset seam

**File:** `apps/api/src/routes/tokens/_call-provider.ts:43-55`
**Issue:** `dispatcherInstalled` is module-scoped and set once per Node process. Tests that swap MockAgents between cases work only because `setGlobalDispatcher` is called by the test (not by us). The contract is documented in the comment but lacks an explicit reset seam.
**Fix:** Add `export const __test = { reset: () => { dispatcherInstalled = false; } }` for branch-coverage tests.

### IN-03: Synthetic finish chunks emit `usage:{0,0}` indistinguishable from a real zero-token completion

**File:** `apps/api/src/routes/agent/stream.ts:76-99`
**Issue:** Upstream-failure finish chunks (`upstream_error`, `stream_error`, `incomplete`) emit `usage:{promptTokens:0, completionTokens:0}` — schema-valid but indistinguishable from a real zero-token response when downstream analytics aggregate. The worker spend-log ingestion writes from LiteLLM's spend log directly so this is not a billing risk, but desktop-side analytics may double-count.
**Fix:** Optional passthrough sentinel (`synthetic: true`); the `FinishChunk` schema already permits extras via `passthrough()`.

### IN-04: `httpToWsScheme` correctness depends on order of two replaces — add a casing-regression test

**File:** `apps/api/src/routes/realtime.ts:86-88`
**Issue:** The double-replace pattern is correct because `wss:` doesn't start with `http:`, but the comment-only safeguard against the prior `replace(/^http(s?):/i, "ws$1:")` casing bug invites a future maintainer to "simplify" it back. Already exported for unit testing — locking this with `expect(httpToWsScheme("HTTPS://X")).toBe("wss://X")` would prevent regression.

### IN-05: Compose volume-merge semantics ("LAST wins") relies on a recent docker-compose version without explicit pin

**Files:** `compose/e2e/docker-compose.e2e.yml:36-39`, `compose/live-soak/docker-compose.live.yml:42-48`
**Issue:** Comment "Compose merges `volumes:` lists by appending — the LAST bind targeting the same container path WINS" is correct in current docker-compose v2 (≥2.20). CI uses ubuntu-24.04 which ships a recent compose; worth pinning a minimum version in operator docs for self-host operators on older Compose v1.
**Fix:** Add a one-line comment: `# Requires docker-compose >= 2.20 for last-bind-wins semantics on volume merges.`

### IN-06: Provider timeout magic numbers have no operator override

**File:** `apps/api/src/routes/tokens/_call-provider.ts:40-41`
**Issue:** `TOTAL_TIMEOUT_MS = 5000` / `CONNECT_TIMEOUT_MS = 3000` per D-20 — but operators behind corporate proxies adding 1-2s latency may need longer ceilings. Low priority since D-20 explicitly mandates these values.
**Fix:** `const TOTAL_TIMEOUT_MS = Math.min(Number(process.env.PROVIDER_TIMEOUT_MS ?? 5000), 30000);` (capped to prevent operator from removing the budget entirely).

## Cross-cutting Observations (positive — not findings)

- **Token-leakage paths (T-04-01)**: every error-envelope construction uses centralized `buildMessage()` strings; no upstream body is ever echoed; `x-litellm-call-id` is `req.log.info` only; partial-success on `Promise.all` parallel-mint is correctly fail-fast BEFORE any body construction (`results.find((r) => !r.ok)` precedes any `.map(...)`).
- **NDJSON line-flush correctness (T-04-03)**: `endWithFinish` and the drain `try/catch/finally` correctly synthesize `stream_error` / `incomplete` / `upstream_error` finish chunks and never write a partial JSON line. The `JSON.stringify(chunk)+'\n'` pattern guarantees full-line atomicity at the Node socket layer.
- **Auth-before-rate-limit ordering**: `keyGenerator: (req) => req.user?.id ?? req.ip` correctly relies on `dualAuthHook` populating `req.user` in the `onRequest` phase before the rate-limit hook in the `preHandler` phase. Fallback to `req.ip` is appropriate defense-in-depth.
- **Realtime auth bypass mitigation (T-03-07-02)**: `preHandler` re-checks `req.user.id` and throws `AuthError` BEFORE the WS upgrade completes; the `?user=` mutation overwrites any caller-supplied value with the authenticated user id (T-03-07-04).
- **Master-key isolation**: `rewriteRequestHeaders` deletes BOTH `authorization` and `Authorization` (case-defense) before injecting the master key. The desktop's bearer never reaches LiteLLM; the master key never reaches the wire.
- **WSS handler cleanup (mock-realtime)**: `openSockets` set + `socket.on('close', delete)` + idempotent `stop()` correctly drains clients on shutdown.
- **Traefik :443 revert**: `transport.respondingTimeouts: {readTimeout:60s, writeTimeout:0, idleTimeout:180s}` matches Traefik 3 documented defaults; no leaked 3700s timeouts on :443. The dedicated `:8443` `websecure-realtime` entrypoint isolates long-lived sessions correctly.
- **GHA workflow gating**: no `pull_request` trigger; belt-and-suspenders job-level `if: github.event_name == 'schedule' || startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'`; SHA-pinned actions (harden-runner, checkout, setup-node, pnpm/action-setup, upload-artifact); `permissions: contents: read`; `OPENAI_API_KEY` secret only injected on the docker-compose-up and live-soak steps (not bootstrap). Cost discipline is well-engineered.
- **Live-soak overlay isolation**: `compose/live-soak/docker-compose.live.yml` does not reference `mock-realtime`; `compose/live-soak/litellm_config.live-realtime.yaml` carries no hermetic upstream — verified by inspection.
- **Tool-call accumulator (T-04-03 / LiteLLM#17246)**: `flush()` is the sole state-clearing path; no public `clear()`; `finish_reason="stop"` deliberately drops pending state silently per the linked LiteLLM bug.

---

_Reviewed: 2026-05-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
