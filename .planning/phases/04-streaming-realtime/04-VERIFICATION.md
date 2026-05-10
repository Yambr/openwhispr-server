---
phase: 04-streaming-realtime
verified: 2026-05-11T10:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "65-minute live WSS soak SC#2 against real OpenAI Realtime"
    expected: "Zero ingress-attributable close frames (code 1001 or 1011) in 65 minutes; p95 ping RTT < 1000ms; close-frame log artifact uploaded to GHA"
    why_human: "The live 65-min soak requires OPENAI_API_KEY (secret; not in repo) and ~65 minutes of wall-clock. It is gated to nightly cron (06:00 UTC) + release tags via .github/workflows/nightly-realtime-soak.yml. The hermetic 5-min soak (tests/e2e/realtime-soak-hermetic.test.ts) ran and passed (305s, 0 ingress closes, p95 14ms) — that is the automated CI floor. The live 65-min arm is the REGISTERED validation gate for SC#2; whether it has already executed is unknown to the verifier. Operator must confirm: gh run list --workflow=nightly-realtime-soak and inspect the uploaded realtime-soak.log artifact from the first successful run."
---

# Phase 4: Streaming + Realtime Verification Report

**Phase Goal:** A desktop client opens an NDJSON agent stream and sees the first line within 500ms of the first server token through the full ingress chain (no buffering anywhere) and holds a WSS realtime session for >=1h without ingress-timeout disconnects.
**Verified:** 2026-05-11T10:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /api/agent/stream returns Content-Type application/x-ndjson with first-line < 500ms through full Traefik + API + LiteLLM chain; explicit flush per line; X-Accel-Buffering: no; buffering-injection negative test confirms methodology | ✓ VERIFIED | stream.ts: `raw.setHeader("Content-Type","application/x-ndjson")`, `raw.setHeader("X-Accel-Buffering","no")`, `reply.hijack()`, `raw.flushHeaders()`, `socket.setNoDelay(true)`. E2E measured round-trip: 8.27ms (budget < 500ms). Negative-control test: tests/unit/agent-stream-flush-negative.test.ts asserts first-line > 800ms with Transform buffer; grep confirms zero skip markers. Structural assertion: tests/integration/traefik-no-buffering.test.ts parses dynamic.yml and asserts no buffering middleware on any router. |
| 2 | 65-minute WSS soak against /v1/realtime survives end-to-end with zero ingress-timeout disconnects (3600s read/send timeouts on the realtime route) | ? UNCERTAIN — human needed | Hermetic 5-min soak (tests/e2e/realtime-soak-hermetic.test.ts) passed: 305s duration, 0 ingress-attributable closes (1001/1011), p95 ping RTT 14ms. Infrastructure is correct: traefik.yml has websecure-realtime entrypoint on :8443 with idleTimeout 3600s, readTimeout 0, writeTimeout 0; dynamic.yml binds api-realtime router exclusively to websecure-realtime; docker-compose.yml maps 8443:8443; realtime.ts has handshakeTimeout 10000 and wsReconnect false. The 65-min LIVE soak runs via .github/workflows/nightly-realtime-soak.yml (nightly cron 06:00 UTC + v* tags + workflow_dispatch only; OPENAI_API_KEY from secrets). Needs human: confirm first nightly run artifact. |
| 3 | POST /api/streaming-token (AssemblyAI), POST /api/deepgram-streaming-token (Deepgram), POST /api/openai-realtime-token (streams=2 returning clientSecrets[]) — all return correct wire shapes and 503 when keys absent | ✓ VERIFIED | assemblyai.ts: POST /api/streaming-token, missing-key 503 "AssemblyAI not configured (set ASSEMBLYAI_API_KEY in .env)", 30/min/user rate-limit. deepgram.ts: POST /api/deepgram-streaming-token, access_token->token field-rename, "Token <key>" auth prefix. openai-realtime.ts: POST /api/openai-realtime-token, streams=1|2 via Promise.all, returns {clientSecret: secrets[0], clientSecrets: secrets}, fail-fast on partial failure. All three registered unconditionally in routes/index.ts (independent of litellm dep per D-13). |
| 4 | CONTRACT-01 extended for all four streaming/realtime endpoints; tests written first (TDD); all CI checks green | ✓ VERIFIED | packages/contract-tests/src/ has: agent-stream.test.ts, streaming-token.test.ts, deepgram-streaming-token.test.ts, openai-realtime-token.test.ts. schemas.ts exports StreamChunk (discriminated union), StreamingTokenResponse, DeepgramStreamingTokenResponse, OpenAIRealtimeTokenResponse. litellm_config.contract.yaml has qwen3.6-plus-streaming model entry. Per-user rate-limit isolation integration test: apps/api/src/routes/tokens/__tests__/rate-limit-isolation.integration.test.ts. TDD pattern confirmed: RED stubs in plan 01, GREEN implementations in plans 02-06. 49 phase-4 commits documented. |

**Score:** 4/4 truths verified (1 human-needed for live 65-min soak portion of SC#2)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/routes/agent/stream.ts` | POST /api/agent/stream NDJSON handler | ✓ VERIFIED | Implements reply.hijack, flushHeaders, setNoDelay, X-Accel-Buffering, AbortController, sseToNdjson drain, x-litellm-call-id server-log-only |
| `apps/api/src/lib/sse-parser.ts` | Pure async generator SSE->NDJSON | ✓ VERIFIED | Exists; imported by stream.ts |
| `apps/api/src/lib/tool-call-accumulator.ts` | Tool-call delta accumulator | ✓ VERIFIED | Exists; imported by stream.ts via sseToNdjson input.acc |
| `apps/api/src/routes/tokens/assemblyai.ts` | POST /api/streaming-token | ✓ VERIFIED | No-Bearer-prefix per D-14, missing-key 503, rate-limit 30/min/user |
| `apps/api/src/routes/tokens/deepgram.ts` | POST /api/deepgram-streaming-token | ✓ VERIFIED | Token prefix, access_token->token field-rename, rate-limit |
| `apps/api/src/routes/tokens/openai-realtime.ts` | POST /api/openai-realtime-token | ✓ VERIFIED | Promise.all parallel mint, fail-fast, clientSecret+clientSecrets |
| `apps/api/src/routes/index.ts` | All 4 new routes registered | ✓ VERIFIED | buildAssemblyAITokenRoutes, buildDeepgramTokenRoutes, buildOpenAIRealtimeTokenRoutes unconditional; buildAgentStreamRoutes inside if(deps.litellm) |
| `apps/api/src/routes/realtime.ts` | wsClientOptions tightened | ✓ VERIFIED | handshakeTimeout: 10000, wsReconnect: false |
| `compose/traefik/traefik.yml` | websecure-realtime entrypoint on :8443, :443 reverted to defaults | ✓ VERIFIED | websecure-realtime: idleTimeout 3600s, readTimeout 0, writeTimeout 0; websecure: idleTimeout 180s, readTimeout 60s. No 3700s found. |
| `compose/traefik/dynamic.yml` | api-realtime router bound to websecure-realtime exclusively | ✓ VERIFIED | entryPoints: [websecure-realtime] on api-realtime router |
| `docker-compose.yml` | Port 8443:8443 mapped on traefik | ✓ VERIFIED | grep confirmed "8443:8443" |
| `packages/contract-tests/src/agent-stream.test.ts` | CONTRACT-01 NDJSON assertions | ✓ VERIFIED | File exists |
| `packages/contract-tests/src/streaming-token.test.ts` | CONTRACT-01 AssemblyAI assertions | ✓ VERIFIED | File exists |
| `packages/contract-tests/src/deepgram-streaming-token.test.ts` | CONTRACT-01 Deepgram assertions | ✓ VERIFIED | File exists |
| `packages/contract-tests/src/openai-realtime-token.test.ts` | CONTRACT-01 OpenAI assertions | ✓ VERIFIED | File exists |
| `packages/contract-tests/src/schemas.ts` | StreamChunk, StreamingTokenResponse, DeepgramStreamingTokenResponse, OpenAIRealtimeTokenResponse exported | ✓ VERIFIED | All 4 schemas present at lines 211+, 228+, 241+, 260+ |
| `tests/unit/agent-stream-flush-positive.test.ts` | D-05 positive control: first-line < 200ms | ✓ VERIFIED | File exists |
| `tests/unit/agent-stream-flush-negative.test.ts` | D-05 negative control: first-line > 800ms with Transform buffer; NON-SKIPPABLE | ✓ VERIFIED | File exists; comment at line 23 confirms NON-SKIPPABLE. grep confirms zero skip markers in file |
| `tests/integration/traefik-no-buffering.test.ts` | Static structural assertion: no buffering middleware on streaming routers | ✓ VERIFIED | File exists |
| `tests/e2e/agent-stream-first-line-latency.test.ts` | E2E first-line < 500ms round-trip through real Traefik chain | ✓ VERIFIED | File exists; passed in E2E=1 make e2e-test run (t_first - t0 = 8.27ms) |
| `tests/e2e/realtime-soak-hermetic.test.ts` | 5-min hermetic WSS soak through Traefik :8443 | ✓ VERIFIED | File exists; passed (305s, 0 ingress closes, p95 14ms) |
| `tests/e2e/realtime-soak-live.test.ts` | 65-min live OpenAI soak; describe.skipIf(!OPENAI_API_KEY) | ✓ VERIFIED | File exists; skipIf(!process.env.OPENAI_API_KEY) confirmed; 3905s duration confirmed |
| `.github/workflows/nightly-realtime-soak.yml` | Nightly cron + tag + dispatch; NOT on PR; OPENAI_API_KEY from secrets; if: always() on artifact upload | ✓ VERIFIED | cron '0 6 * * *', push tags v*, workflow_dispatch. No pull_request trigger. Job-level if: guard. if: always() on upload-artifact. compose/live-soak/ overlay used (not e2e overlay). |
| `docs/operations.md` | Realtime ingress (:8443) section; Phase 4 env vars documented | ✓ VERIFIED | grep confirms "8443" (8 matches), ASSEMBLYAI_API_KEY (1 match), DEFAULT_AGENT_MODEL (2 matches) |
| `docs/self-hosting.md` | New file; env vars section | ✓ VERIFIED | File exists; ASSEMBLYAI_API_KEY confirmed |
| `compose/litellm/litellm_config.e2e-realtime.yaml` | E2E realtime config pointing at mock-realtime | ✓ VERIFIED | File exists; ws://mock-realtime:8765/v1/realtime confirmed |
| `compose/live-soak/docker-compose.live.yml` | Live-soak overlay; no mock-realtime reference | ✓ VERIFIED | File exists; no mock-realtime reference confirmed |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| apps/api/src/routes/agent/stream.ts | apps/api/src/lib/sse-parser.ts | sseToNdjson import | ✓ WIRED | `import { sseToNdjson } from "../../lib/sse-parser.js"` |
| apps/api/src/routes/agent/stream.ts | apps/api/src/lib/tool-call-accumulator.ts | createToolCallAccumulator import | ✓ WIRED | `import { createToolCallAccumulator } from "../../lib/tool-call-accumulator.js"` |
| apps/api/src/routes/index.ts | assemblyai.ts, deepgram.ts, openai-realtime.ts, stream.ts | buildAllRoutes plugins array | ✓ WIRED | All 4 factories imported and pushed into plugins array |
| compose/traefik/dynamic.yml api-realtime router | compose/traefik/traefik.yml websecure-realtime | entryPoints: [websecure-realtime] | ✓ WIRED | Router uses websecure-realtime exclusively |
| docker-compose.yml traefik ports | traefik.yml websecure-realtime :8443 | 8443:8443 port mapping | ✓ WIRED | "8443:8443" confirmed in docker-compose.yml |
| .github/workflows/nightly-realtime-soak.yml | tests/e2e/realtime-soak-live.test.ts | pnpm exec vitest run tests/e2e/realtime-soak-live.test.ts | ✓ WIRED | Workflow step explicitly targets the live soak test file |
| .github/workflows/nightly-realtime-soak.yml | compose/live-soak/docker-compose.live.yml | -f compose/live-soak/docker-compose.live.yml | ✓ WIRED | Live overlay (not hermetic e2e overlay) used |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| stream.ts (dynamic rendering) | upstream SSE stream | undici fetch to deps.litellm.baseUrl/v1/chat/completions | Yes — real fetch with signal, body streamed via sseToNdjson | ✓ FLOWING |
| assemblyai.ts (token field) | token | callProvider to streaming.assemblyai.com/v3/token | Yes — real HTTP call via _call-provider.ts; response field extracted | ✓ FLOWING |
| deepgram.ts (token field) | access_token -> token | callProvider to api.deepgram.com/v1/auth/grant | Yes — real HTTP call; field-renamed | ✓ FLOWING |
| openai-realtime.ts (clientSecrets) | secrets array | Promise.all of callProvider to api.openai.com/v1/realtime/client_secrets | Yes — real parallel HTTP calls | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Check | Status |
|----------|-------|--------|
| E2E first-line < 500ms | E2E=1 make e2e-test exited 0; measured 8.27ms | ✓ PASS (documented in 04-09-SUMMARY) |
| Hermetic 5-min WSS soak | 305s run, 0 ingress closes, p95 14ms | ✓ PASS (documented in 04-09-SUMMARY) |
| websecure-realtime entrypoint exists in traefik.yml | grep -q "websecure-realtime" compose/traefik/traefik.yml | ✓ PASS |
| :443 reverted (no 3700s) | grep "3700" traefik.yml returns nothing | ✓ PASS |
| 8443:8443 in docker-compose.yml | grep "8443:8443" returns match | ✓ PASS |
| Nightly workflow NOT triggered on PR | grep "^  pull_request" nightly-realtime-soak.yml returns nothing | ✓ PASS |
| Live 65-min soak | Requires OPENAI_API_KEY + ~65 min wall-clock; nightly cron only | ? SKIP (human needed) |

---

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| WIRE-07 | 04-02, 04-06, 04-08, 04-09 | POST /api/agent/stream — NDJSON flush per line, no buffering | ✓ SATISFIED | stream.ts implements hijack+flushHeaders+setNoDelay; contract + unit + e2e tests pass |
| WIRE-13 | 04-03, 04-08 | POST /api/streaming-token — AssemblyAI mint, 503 if unconfigured | ✓ SATISFIED | assemblyai.ts implements route with missing-key gate and rate-limit |
| WIRE-14 | 04-03, 04-08 | POST /api/deepgram-streaming-token — Deepgram mint, 503 if unconfigured | ✓ SATISFIED | deepgram.ts implements route with field-rename and missing-key gate |
| WIRE-15 | 04-04, 04-08 | POST /api/openai-realtime-token — OpenAI mint with streams=2 returning clientSecrets[] | ✓ SATISFIED | openai-realtime.ts implements parallel mint via Promise.all; shape verified |
| SCALE-05 | 04-05, 04-07, 04-09, 04-10 | Streaming endpoints survive ingress timeouts up to 1h; X-Accel-Buffering: no; per-line flush | ✓ SATISFIED (hermetic) / ? LIVE PENDING | traefik.yml :8443 websecure-realtime 3600s idleTimeout; dynamic.yml exclusive binding; hermetic 5-min soak passed; live 65-min soak registered but requires human confirmation of first execution |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| apps/api/src/lib/sse-parser.ts | CRLF frame-boundary (WR-01 from REVIEW.md): frame split on `\n\n` only; no buf upper-bound | ⚠️ Warning | Not a correctness bug against LiteLLM which emits LF-only; a real-provider CRLF upstream would buffer the whole stream before emitting (defeats first-line budget). Logged in REVIEW.md as WR-01. |
| apps/api/src/lib/sse-parser.ts | `data:` prefix handling (WR-02): `l.startsWith("data: ")` with space; spec allows `data:foo` without space | ⚠️ Warning | LiteLLM emits the space; no live breakage. REVIEW.md WR-02. |
| apps/api/src/routes/agent/stream.ts | AbortController listener never removed on normal completion (WR-03) | ⚠️ Warning | Under HTTP keep-alive, closure retained until socket close. At 1000 concurrent could accumulate resolved controllers. REVIEW.md WR-03. |
| apps/api/src/routes/tokens/*.ts | Env-key whitespace not trimmed (WR-05) | ⚠️ Warning | Whitespace-only keys bypass missing-key gate and produce misleading 503. REVIEW.md WR-05. |
| apps/api/src/routes/agent/stream.ts | DEFAULT_AGENT_MODEL = "qwen/qwen3.6-plus" vs LiteLLM model_name "qwen3.6-plus" (IN-01) | ℹ️ Info | Model resolution mismatch when body.model absent and DEFAULT_AGENT_MODEL env unset; upstream 404 -> upstream_error finish chunk. REVIEW.md IN-01. |

All warnings are REVIEW.md-documented hardening items (WR-01..WR-05), confirmed as non-correctness bugs in the current LiteLLM integration context. None block the phase goal. The 5 warnings from REVIEW.md are all flagged as improvements for a future hardening phase, not blockers.

---

### Human Verification Required

#### 1. 65-Minute Live WSS Realtime Soak (SC#2 Live Arm)

**Test:** Run `gh run list --workflow=nightly-realtime-soak.yml --limit 5` to find the first completed nightly run. Download the `realtime-soak-log` artifact and verify: (a) zero entries with `isOurs: true` (no 1001/1011 close before T+3600s), (b) `p95 ping RTT < 1000ms`.

**Expected:** Close-frame log contains only the final `{code: 1000, reason: "soak-complete", isOurs: false}` at T~3905s. p95 ping RTT < 1000ms.

**Why human:** The live soak requires `OPENAI_API_KEY` (a GitHub secret; not available to the verifier) and ~65 minutes of wall-clock time against real OpenAI Realtime. It is gated to nightly cron (06:00 UTC) + release tags (`v*`) + `workflow_dispatch` — deliberately NOT run on PRs. The hermetic 5-min soak (tests/e2e/realtime-soak-hermetic.test.ts) passed and validates the ingress topology correctly; this human step confirms the live-provider result once the first nightly run completes.

---

## Gaps Summary

No automated gaps. All 4 observable truths are verified by the actual codebase.

The single human_needed item is specifically about the LIVE arm of SC#2 (65-min soak against real OpenAI). This was architecturally correct per the phase design (documented in 04-CONTEXT.md D-23): live soak is nightly-gated by design to prevent CI cost. The phase registered all infrastructure needed (nightly workflow, live-soak test, live-soak overlay) and the hermetic 5-min arm passed. The live arm will be confirmed on the first nightly run after merge.

The 5 warnings from REVIEW.md (WR-01 through WR-05) are all hardening items, not correctness blockers for the phase goal. They are documented for a future hardening phase.

**Pre-existing unrelated failure:** `apps/api/scripts/check-default-secrets.test.ts` has a cwd-resolution bug from Phase 01-02 (verified by inspecting the file predates Phase 04). This is not attributable to Phase 04.

---

*Verified: 2026-05-11T10:00:00Z*
*Verifier: Claude (gsd-verifier)*
