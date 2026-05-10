# Phase 04: Streaming + Realtime — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 04-streaming-realtime
**Mode:** advisor (parallel research, minimal_decisive calibration)
**Areas discussed:** NDJSON flush + buffering chain, Realtime 65-min soak + ingress timeouts, Token-mint gating + provider scope, Agent stream tooling + LiteLLM routing

---

## Gray Area Selection (initial)

User was offered 4 gray areas (multiSelect). User selected all 4 and added directive:
> "Все сам ресерчи и предлагай исходя из общих целей без костылей и оверинжиниринга все для Энтерпрайз"
> ("Research everything yourself and propose based on overall goals — no workarounds, no over-engineering, all enterprise-grade.")

Interpreted as: route to advisor-research flow (parallel `gsd-advisor-researcher` agents per area, minimal_decisive calibration), present synthesized recommendations, lock on user approval.

---

## Area 1 — NDJSON flush + buffering chain

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-rolled async iterator (undici + SSE parser + reply.raw.write per line) | Full control, zero deps, matches BACKEND_SPEC byte-for-byte | ✓ |
| Vercel AI SDK `streamText` + adapter | SDK emits its own data-stream protocol, requires double transform back to NDJSON, plus active LiteLLM↔AI-SDK bugs | |
| `@fastify/http-proxy` body transform | Cannot shape-transform without buffering — defeats the goal | |

**User's choice:** Hand-rolled async iterator.
**Notes:** Research confirmed Node 24 `http.ServerResponse` has no `flush()` (only `compression` middleware patches it on). Canonical idiom = `flushHeaders()` once + `socket.setNoDelay(true)` + `reply.raw.write()` per chunk. Traefik 3 does NOT buffer by default (no `proxy_buffering on` equivalent), so the success-criterion "per-route proxy_buffering off" translates to "verify no buffering middleware attached." Negative-control test (wrap handler in `stream.Transform({highWaterMark:4096})` and assert first-line > 800ms) is non-negotiable — proves the positive test isn't a false negative.

---

## Area 2 — Realtime 65-min soak + ingress timeouts

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `websecure-realtime` entrypoint (3600s timeouts on a separate port), hermetic mock-realtime in PR CI + live nightly | Per-route isolation; only Traefik 3-correct path; defense-in-depth preserved | ✓ |
| Global :443 timeouts to 3600s | One entrypoint but FD leakage at 1000 concurrent, weakens slowloris posture | |

**User's choice:** Dedicated entrypoint.
**Notes:** Confirmed Traefik 3 `respondingTimeouts` are entrypoint-scoped only — no per-router timeout middleware exists. Only correct mechanism for per-route timeout isolation = second entrypoint on a distinct port. Hermetic mock-realtime WS echo server (~50 LoC) runs on every PR under E2E=1 in ~5min. Live OpenAI Realtime 65-min run gated to nightly/release-tag only (~$15-25/run). Test client drives ping every 20s (OpenAI doesn't send keepalives during silence). Close-code inspection distinguishes ingress-timeout closes from OpenAI's documented random 1006 disconnects.

---

## Area 3 — Token-mint gating + provider scope

| Option | Description | Selected |
|--------|-------------|----------|
| Direct mint via undici from Fastify | Server holds keys, zero proxy hops, clean per-route 503 gating, easy per-user rate limit | ✓ |
| LiteLLM `pass_through_endpoints` | Auth-shaped calls add Python hop for zero functional gain (no model routing, no spend log) | |

**User's choice:** Direct mint via undici.
**Notes:** Provider APIs verified:
- AssemblyAI v3: `GET /v3/token?expires_in_seconds=60`
- Deepgram Grant-Token: `POST /v1/auth/grant` (30s TTL, unlimited issuance, no project_id needed — reject `/v1/projects/{id}/keys` which caps at 250/day)
- OpenAI Realtime: `POST /v1/realtime/client_secrets` body `{session:{type:"realtime",model:"gpt-realtime"}}`
- `streams=2` maps to two parallel mints (OpenAI has no native multi-stream session), return both in `clientSecrets[]`
- Missing-key → 503 with envelope citing exact env var name, no Retry-After (config gap, not transient)
- Per-user 30/min rate limit on Valkey (Phase 2 D-28 plugin)

---

## Area 4 — Agent stream tooling + LiteLLM routing

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-rolled undici → LiteLLM `/v1/chat/completions` streaming | Zero SDK coupling, exact wire control, sidesteps known SDK↔LiteLLM bugs | ✓ |
| Vercel AI SDK `streamText` + `@ai-sdk/openai` pointed at LiteLLM | SDK v5/v6 chunk vocab doesn't match spec's v3-era shape; active bugs in LiteLLM↔AI-SDK streaming translation | |

**User's choice:** Hand-rolled.
**Notes:**
- Tools translated server-side from spec's `[{name,description,parameters}]` (v3 shape) to OpenAI `[{type:"function",function:{...}}]` for the LiteLLM call.
- Client-side tool execution model — server emits `tool-call` chunks, never executes tools inline (matches desktop's IPC pattern from BACKEND_SPEC).
- Tool-call accumulation: accumulate `delta.tool_calls[].function.arguments` by index, emit ONE consolidated `tool-call` chunk per call when `finish_reason==="tool_calls"` (not per delta — spec's `args:{}` is complete object).
- Model default: `req.body.model ?? process.env.DEFAULT_AGENT_MODEL ?? "qwen/qwen3.6-plus"`.
- systemPrompt is additive prepend (never replaces existing system messages).
- Usage: `stream_options:{include_usage:true}` guarantees final chunk; map `prompt_tokens/completion_tokens` → `promptTokens/completionTokens`. Capture `x-litellm-call-id` server-side only for D-08 spend-log reconciliation; never leak to client.

---

## Approval Question

**Question:** "Approve all four area recommendations as locked Phase 4 decisions, or revise any?"
**Options presented:**
- Approve all 4 — write CONTEXT.md (Recommended)
- Approve with notes
- Revise Area 1 (NDJSON)
- Revise Area 2 (Realtime soak)

**User's choice:** Approve all 4 — write CONTEXT.md.

---

## Claude's Discretion

Five items deferred to planner discretion (entrypoint port, test-file placement, env-var vs hardcoded TTLs, route-file organization, mock-realtime package layout). All listed in CONTEXT.md under "Claude's Discretion".

## Deferred Ideas

- Internal mTLS Traefik↔Fastify↔LiteLLM — future hardening phase
- Per-tenant provider sub-accounts — v2 multi-tenancy
- `workflow_dispatch` UI for ad-hoc live-soak runs — CI ergonomics, planner may include
- OpenTelemetry spans on token mints — Phase 6 OBS-* territory
- Webhook-driven realtime session lifecycle — Phase 5+ if OpenAI ships them
