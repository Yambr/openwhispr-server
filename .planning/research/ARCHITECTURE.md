# Architecture Research

**Domain:** Multi-tenant, wire-compatible cloud backend for OpenWhispr desktop client
**Researched:** 2026-05-08
**Confidence:** HIGH (wire contract is fully reverse-engineered; LiteLLM/Speaches deployment is production-proven; 1000-concurrent sizing is standard math)

> **Source confidence note.** Component decomposition and data-path shapes are HIGH confidence — derived directly from `BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `speaches-audio.md`, and the desktop client's `ARCHITECTURE.md`. Numerical sizing (FD limits, p95 budgets, sidecar vs separate-deployment) is MEDIUM confidence — based on standard nginx / Linux defaults and load patterns in similar streaming-LLM stacks; **must be validated under load test (SCALE-06)** before being committed as SLO.

---

## 1. System Overview

The system is a layered cloud backend with explicit failure domains. Each box is one container in compose / one Deployment+Service in Helm.

```
                          ┌──────────────────────────┐
                          │  Desktop Client (BYOC)   │
                          │  Electron, opaque bearer │
                          └────────────┬─────────────┘
                                       │ HTTPS (TLS 1.3)
                                       │ + WSS upgrade
                                       │ + multipart/form-data
                                       │ + application/x-ndjson
                                       v
┌────────────────────────────────────────────────────────────────────┐
│                       EDGE / INGRESS                                │
│  nginx (compose) / ingress-nginx (k8s)                              │
│  - TLS termination (cert-manager)                                   │
│  - WebSocket Upgrade                                                │
│  - proxy_read_timeout / send_timeout = 3600s (1h)                   │
│  - proxy_request_buffering off (multipart streaming)                │
│  - proxy_buffering off on /api/agent/stream and /v1/realtime        │
│  - client_max_body_size = 100M (audio uploads)                      │
│  - rate-limit zones (per-IP, fail-open if redis dead)               │
└─────────────────┬──────────────────────────────────────┬────────────┘
                  │                                      │
                  │ /api/*                               │ /api/desktop-signin/*
                  v                                      │ + /auth/desktop-callback
┌─────────────────────────────────────────┐              │
│            API TIER (stateless)         │              │
│  3-N replicas, horizontal autoscale     │              │
│  - Wire endpoints (BACKEND_SPEC.md)     │              │
│  - Better-Auth-compatible cookie+bearer │              │
│  - Tenant resolution + RLS GUC          │              │
│  - Quota check BEFORE provider forward  │              │
│  - NDJSON line-flush for /agent/stream  │              │
│  - WSS upstream-proxy to Speaches       │              │
│  - Provider abstraction (LLM/STT/...)   │              │
└──┬──────────┬───────────┬─────────┬─────┘              │
   │          │           │         │                    v
   │          │           │         │       ┌─────────────────────────┐
   │          │           │         │       │      AUTH SHIM          │
   │          │           │         │       │  (subset of API tier or │
   │          │           │         │       │   sibling deployment)   │
   │          │           │         │       │  - /api/desktop-signin/ │
   │          │           │         │       │  - IdP round-trip       │
   │          │           │         │       │  - channel-scheme echo  │
   │          │           │         │       │  - bearer token issue   │
   │          │           │         │       │  - set-auth-token rotation
   │          │           │         │       └────────┬────────────────┘
   │          │           │         │                │
   │          │           │         │                v
   │          │           │         │       ┌─────────────────────────┐
   │          │           │         │       │  IdP (Google / MS /     │
   │          │           │         │       │  Apple / OIDC / SAML /  │
   │          │           │         │       │  email-password)        │
   │          │           │         │       └─────────────────────────┘
   │          │           │         │
   │          │           │         │       ┌─────────────────────────┐
   │          │           │         └──────>│   OBJECT STORAGE        │
   │          │           │                 │   S3 / MinIO / GCS      │
   │          │           │                 │   (transcripts, audit)  │
   │          │           │                 └─────────────────────────┘
   │          │           v
   │          │   ┌───────────────────────┐
   │          │   │     POSTGRES 16       │
   │          │   │   - RLS by tenant     │
   │          │   │   - app.tenant_id GUC │
   │          │   │   - usage ledger      │
   │          │   │   - PgBouncer pool    │
   │          │   │   - HA: streaming     │
   │          │   │     repl, patroni / CNPG
   │          │   └───────────────────────┘
   │          v
   │   ┌──────────────────────┐
   │   │       REDIS 7        │
   │   │   - rate-limit       │
   │   │   - job queue (BullMQ│
   │   │     or asynq)        │
   │   │   - ephemeral session│
   │   │     pieces, idempot. │
   │   └──────────┬───────────┘
   │              │
   │              v
   │   ┌──────────────────────┐
   │   │    WORKER TIER       │
   │   │  (same image as API, │
   │   │  different entrypoint│
   │   │  - webhook fanout    │
   │   │  - email send        │
   │   │  - usage rollups     │
   │   │  - tenant cleanup    │
   │   │  - LiteLLM spend log │
   │   │    ingest            │
   │   └──────────────────────┘
   │
   v
┌─────────────────────────────────────────────────────────────────────┐
│             PROVIDER PLANE (default backend)                         │
│                                                                       │
│  ┌──────────────────────┐         ┌─────────────────────────────┐    │
│  │  LiteLLM Proxy       │ ──────> │  Speaches (audio backend)   │    │
│  │  - virtual-key auth  │  HTTPS  │  - Whisper transcription    │    │
│  │  - model routing     │  +WSS   │  - pyannote diarization     │    │
│  │  - spend logs        │         │  - OpenAI Realtime spec WSS │    │
│  │  - multipart pass-   │         │    GPU node pool            │    │
│  │    through (patched) │         └─────────────────────────────┘    │
│  │  - realtime mode     │                                            │
│  │  - alternate LLMs    │ ──────> External: OpenAI, Anthropic,      │
│  │    routed here       │         Gemini, Bedrock, Vertex, Azure    │
│  └──────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────┘
                  │
                  v
┌─────────────────────────────────────────────────────────────────────┐
│             OBSERVABILITY PLANE                                      │
│  otel-collector ──> Prometheus / Grafana / Loki / Tempo              │
│  All tiers emit OTel spans; LiteLLM spend logs sink via webhook      │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Edge / ingress** | TLS, HTTP/2, WSS upgrade, multipart-streaming passthrough, 1h timeouts, per-IP rate-limit | nginx (compose) or ingress-nginx (Helm); cert-manager for TLS |
| **API tier** | All `/api/*` wire endpoints, tenant resolution, RLS GUC injection, quota pre-check, NDJSON line-flush, WSS proxy to Speaches Realtime, provider dispatch | Stateless app instances (Node/Fastify, Go/Fiber, or Python/FastAPI — TBD by STACK research). 3-N replicas. |
| **Auth shim** | `/api/desktop-signin/{provider}` initiation, IdP round-trip, **channel-scheme echo**, bearer issue, `set-auth-token` rotation, `withSessionRefresh()` 401 contract | Same binary as API tier with route subset, OR sibling deployment if cookie-jar isolation requires distinct host. Better-Auth-server-compatible token shape. |
| **LiteLLM Proxy** | Virtual-key auth, LLM/STT/realtime routing, spend logs, multipart pass-through (patched), model alias map | Stateful container (own DB optional, but spend logs piped to platform). 2+ replicas behind ClusterIP. |
| **Speaches** | Whisper transcription, pyannote diarization, OpenAI-Realtime-spec WSS | GPU-equipped pod (CUDA 12.6+); separate node pool in k8s. 1+ replica per audio capacity unit. |
| **Worker tier** | Webhook fanout, email send, usage rollups, tenant cleanup, LiteLLM spend log ingestion, retention deletes | Same image as API, queue consumer entrypoint. BullMQ (Node), asynq (Go), or arq (Python). 2-N replicas. |
| **Postgres** | Source of truth: tenants, users, sessions, virtual-key bindings, usage ledger, audit log, ledger of consent / deletions | PG16+ with row-level security, `app.tenant_id` GUC, PgBouncer pool, streaming replication. CloudNativePG (CNPG) operator in k8s. |
| **Redis** | Rate-limit token buckets, queue, ephemeral idempotency keys, OAuth-state nonces, session cache | Redis 7 with persistence (AOF). Cluster mode optional past 1k users. |
| **Object storage** | Transcript blobs (if persisted), audio retention (opt-in), audit log archives | MinIO (compose) / S3-GCS-Azure-Blob (cloud). S3-compatible API. |
| **Observability** | Traces, metrics, logs, LiteLLM spend ingestion | otel-collector + Prometheus + Grafana + Loki/Vector + Tempo. Pre-built dashboards shipped. |

---

## 2. Request Lifecycle: The Three Hot Paths

### 2.1 `POST /api/transcribe` (multipart upload → Speaches Whisper)

```
Desktop                Ingress              API tier            LiteLLM           Speaches
   │                      │                    │                   │                 │
   │  POST /api/transcribe│                    │                   │                 │
   │  Content-Type:       │                    │                   │                 │
   │   multipart/form-data│                    │                   │                 │
   │  Authorization:      │                    │                   │                 │
   │   Bearer <opaque>    │                    │                   │                 │
   ├─────────────────────>│                    │                   │                 │
   │                      │                    │                   │                 │
   │                      │ proxy_request_     │                   │                 │
   │                      │ buffering OFF      │                   │                 │
   │                      │ (stream upload)    │                   │                 │
   │                      ├───────────────────>│                   │                 │
   │                      │                    │                   │                 │
   │                      │                    │ 1. Resolve token  │                 │
   │                      │                    │    -> user_id, tenant_id            │
   │                      │                    │ 2. SET LOCAL app.tenant_id = $1     │
   │                      │                    │    (RLS active)   │                 │
   │                      │                    │ 3. Quota pre-check: SELECT          │
   │                      │                    │    words_remaining FROM usage_ledger
   │                      │                    │    WHERE tenant_id = current_setting('app.tenant_id')
   │                      │                    │                   │                 │
   │                      │                    │ IF limitReached:  │                 │
   │                      │                    │    return 200 +   │                 │
   │                      │                    │    {limitReached:true,              │
   │                      │                    │     wordsUsed,wordsRemaining,plan}  │
   │                      │                    │    (NO upstream call — saves cost)  │
   │                      │                    │                   │                 │
   │                      │                    │ 4. Stream multipart upstream:       │
   │                      │                    │    POST /v1/audio/transcriptions    │
   │                      │                    │    Authorization: Bearer <virtual_key_for_tenant>
   │                      │                    │    model=<tenant.stt_model>         │
   │                      │                    ├──────────────────>│                 │
   │                      │                    │                   │ Pass-through    │
   │                      │                    │                   │ (patched        │
   │                      │                    │                   │  multipart)     │
   │                      │                    │                   ├────────────────>│
   │                      │                    │                   │                 │ Whisper
   │                      │                    │                   │                 │ inference
   │                      │                    │                   │<────────────────┤
   │                      │                    │                   │ {text, language,│
   │                      │                    │                   │  segments,...}  │
   │                      │                    │<──────────────────┤                 │
   │                      │                    │                   │                 │
   │                      │                    │ 5. Compute words = wordCount(text)  │
   │                      │                    │ 6. UPDATE usage_ledger              │
   │                      │                    │    SET words_used += $1             │
   │                      │                    │    (RLS-scoped)                     │
   │                      │                    │ 7. Build response per BACKEND_SPEC: │
   │                      │                    │    {text, wordsUsed, wordsRemaining,│
   │                      │                    │     plan, limitReached:false,       │
   │                      │                    │     sttProvider, sttModel,          │
   │                      │                    │     sttProcessingMs, ...}           │
   │                      │<───────────────────┤                   │                 │
   │<─────────────────────┤ 200 OK             │                   │                 │
```

**Critical invariants:**
- Quota exhaustion returns `200 + limitReached:true` (NEVER 4xx). Wire contract.
- Quota check happens **before** upstream forward — saves money + protects providers.
- `proxy_request_buffering off` at ingress prevents large-audio bursts hitting disk.
- Multipart streaming through LiteLLM requires the v1.83.7 backport patch (see PITFALLS.md).
- Word counting is server-side authoritative; client trusts what we return.

### 2.2 `POST /api/agent/stream` (NDJSON line-flushed)

```
Desktop                Ingress              API tier            LiteLLM           LLM (any)
   │                      │                    │                   │                 │
   │  POST /api/agent/stream                   │                   │                 │
   │  Authorization: Bearer                    │                   │                 │
   │  body: {messages, tools, sessionId}       │                   │                 │
   ├─────────────────────>│                    │                   │                 │
   │                      │ proxy_buffering OFF                    │                 │
   │                      │ (must not buffer 1MB before client reads)               │
   │                      │ X-Accel-Buffering: no                  │                 │
   │                      ├───────────────────>│                   │                 │
   │                      │                    │ 1. Auth + tenant resolve            │
   │                      │                    │ 2. Quota pre-check (token-based)    │
   │                      │                    │ 3. Set Content-Type:                │
   │                      │                    │    application/x-ndjson             │
   │                      │                    │ 4. Open agent loop                  │
   │                      │                    │                   │                 │
   │                      │                    │ Loop iter 1:      │                 │
   │                      │                    │   POST /v1/chat/completions         │
   │                      │                    │   stream=true     │                 │
   │                      │                    ├──────────────────>├────────────────>│
   │                      │                    │                   │ SSE deltas      │
   │                      │                    │<──────────────────┤<────────────────┤
   │                      │                    │                   │                 │
   │                      │                    │ For each delta:   │                 │
   │                      │                    │   line = JSON({type:"text-delta",   │
   │                      │                    │                 delta: "..."})      │
   │                      │                    │   write(line + "\n")                │
   │                      │                    │   flush() <-- CRITICAL              │
   │                      │<───────────────────┤                   │                 │
   │<─────────────────────┤ chunked: line\n    │                   │                 │
   │                      │                    │                   │                 │
   │                      │                    │ If tool-call:     │                 │
   │                      │                    │   emit {type:"tool-call",...}\n     │
   │                      │                    │   execute tool (web-search,         │
   │                      │                    │     search_notes, ...)              │
   │                      │                    │   emit {type:"tool-result",...}\n   │
   │                      │                    │   re-enter loop with tool result    │
   │                      │                    │                   │                 │
   │                      │                    │ Final chunk:      │                 │
   │                      │                    │   {type:"finish",                   │
   │                      │                    │    usage:{promptTokens,             │
   │                      │                    │           completionTokens}}\n      │
   │                      │                    │   flush()         │                 │
   │                      │                    │   close stream    │                 │
   │<─────────────────────┤────────────────────┤                   │                 │
   │                      │                    │ 5. UPDATE usage_ledger (tokens)     │
```

**Critical invariants:**
- Each line MUST be flushed immediately. nginx `proxy_buffering off` + framework auto-flush + explicit `Transfer-Encoding: chunked`.
- nginx default 4k buffer **kills** real-time streaming if not disabled — single biggest pitfall.
- Connection lives for tens of seconds to several minutes. Sized in §11.

### 2.3 `WSS /v1/realtime` (desktop ↔ API tier ↔ Speaches)

The wire contract calls for `POST /api/openai-realtime-token` to mint a short-lived secret, then the desktop opens WSS **directly** to wherever the token says. For self-host with Speaches default, two architectures are valid:

**Option A — Direct Speaches (recommended for self-host).** The token endpoint returns `{ clientSecret, wsUrl: "wss://<our-domain>/v1/realtime?model=..." }` pointing at LiteLLM-fronted Speaches. The desktop opens WSS straight there. API tier is not on the data path.

**Option B — API-tier proxy (for tenancy + quota).** API tier is a WSS proxy: desktop → API → LiteLLM → Speaches. Per-frame quota & audit; required if tenant must not see provider URL.

```
Desktop                Ingress              API tier            LiteLLM         Speaches
   │ POST /api/openai-realtime-token            │                   │                │
   │ {model, language, streams:1}               │                   │                │
   ├─────────────────────────────────────────>──┤                   │                │
   │                                            │ Auth + tenant     │                │
   │                                            │ Mint LiteLLM      │                │
   │                                            │  virtual-key      │                │
   │                                            │  (key/generate    │                │
   │                                            │  with TTL=2h,     │                │
   │                                            │  budget per call) │                │
   │                                            ├──────────────────>│                │
   │                                            │<──────────────────┤                │
   │                                            │ {clientSecret:    │                │
   │                                            │  <vkey>,          │                │
   │                                            │  wsUrl: "wss://   │                │
   │                                            │   <us>/v1/realtime"│               │
   │<───────────────────────────────────────────┤                   │                │
   │                                            │                   │                │
   │ WSS /v1/realtime  (Authorization: Bearer <vkey>)               │                │
   ├─────────────────────>│                     │                   │                │
   │                      │ Upgrade: websocket  │                   │                │
   │                      │ proxy_read_timeout 3600                 │                │
   │                      │ (Option A: directly to LiteLLM ─────────────>│           │
   │                      │  Option B: through API tier first)      │   │            │
   │                                                                │   │ realtime   │
   │                                                                │   │ mode forwards
   │                                                                │   ├───────────>│
   │ session.created                                                 │   │           │
   │<───────────────────────────────────────────────────────────────┤<──┤<──────────┤
   │                                                                │   │           │
   │ session.update {input_audio_format:"pcm16",...}                │   │           │
   ├───────────────────────────────────────────────────────────────>│   │           │
   │ input_audio_buffer.append (binary frames)                      │   │           │
   ├───────────────────────────────────────────────────────────────>│   │           │
   │ conversation.item.created.input_audio_transcription.completed  │   │           │
   │<───────────────────────────────────────────────────────────────┤<──┤<──────────┤
```

**Critical invariants:**
- Ingress `proxy_read_timeout` and `proxy_send_timeout` MUST be ≥ 3600s. Default 60s tears realtime sessions down.
- WebSocket Upgrade headers preserved end-to-end.
- Virtual key TTL'd; each session is single-use; max-budget caps runaway usage.
- Choose Option A unless audit/tenancy law forbids leaking provider host.

---

## 3. Auth Flow Data Path (channel-scheme echo)

```
Desktop (Electron)            Browser                  Auth shim          IdP             Postgres
       │                         │                         │                │                 │
   1. signInWithSocial("google") │                         │                │                 │
       │ getOAuthProtocol() ─> "openwhispr-dev"            │                │                 │
       │                         │                         │                │                 │
   2. shell.openExternal(        │                         │                │                 │
        ${AUTH_URL}/api/desktop-signin/google              │                │                 │
        ?callbackURL=https://openwhispr.com/auth/desktop-callback?protocol=openwhispr-dev)    │
       ├────────────────────────>│                         │                │                 │
       │                         │ HTTPS                   │                │                 │
       │                         ├────────────────────────>│                │                 │
       │                         │                         │ 3. Validate provider, parse      │
       │                         │                         │    callbackURL → extract        │
       │                         │                         │    `protocol` query param       │
       │                         │                         │    "openwhispr-dev"             │
       │                         │                         │ 4. INSERT oauth_state           │
       │                         │                         │    (state_token, tenant_id,     │
       │                         │                         │     channel_scheme)             │
       │                         │                         ├────────────────────────────────>│
       │                         │                         │ 5. 302 IdP authorize URL,       │
       │                         │                         │    state=<token>                │
       │                         │<────────────────────────┤                │                 │
       │                         │ 6. browser nav          │                │                 │
       │                         ├────────────────────────────────────────>│                 │
       │                         │ user authorizes         │                │                 │
       │                         │<────────────────────────────────────────┤                 │
       │                         │ 7. 302 ${AUTH_URL}/api/auth/callback/google?code=..&state=..
       │                         ├────────────────────────>│                │                 │
       │                         │                         │ 8. SELECT oauth_state           │
       │                         │                         │    WHERE state = $1             │
       │                         │                         │    -> tenant_id, channel_scheme │
       │                         │                         │<────────────────────────────────┤
       │                         │                         │ 9. Exchange code -> id_token,   │
       │                         │                         │    user_email                   │
       │                         │                         │ 10. UPSERT user (email,         │
       │                         │                         │     tenant_id, idp_subject)     │
       │                         │                         │ 11. INSERT session, mint        │
       │                         │                         │     opaque bearer token         │
       │                         │                         │     (token + token_hash row,    │
       │                         │                         │      tenant_id, expires_at)     │
       │                         │                         ├────────────────────────────────>│
       │                         │                         │ 12. Build redirect URL using    │
       │                         │                         │     channel_scheme from step 8: │
       │                         │                         │     "openwhispr-dev://?bearer_token=<opaque>"
       │                         │                         │     (CRITICAL: echo scheme,     │
       │                         │                         │      do NOT hardcode)           │
       │                         │ 13. 302 https://openwhispr.com/auth/desktop-callback      │
       │                         │     ?protocol=openwhispr-dev&bearer_token=<opaque>        │
       │                         │<────────────────────────┤                │                 │
       │                         │ 14. callback page JS:   │                │                 │
       │                         │     window.location =   │                │                 │
       │                         │     "openwhispr-dev://?bearer_token=<opaque>"             │
       │                         │ 15. OS dispatches       │                │                 │
       │                         │     openwhispr-dev://   │                │                 │
       │                         │     to Electron app     │                │                 │
       │<────────────────────────┤                         │                │                 │
       │ 16. handleOAuthDeepLink()                         │                │                 │
       │     extract bearer_token, tokenStore.set()        │                │                 │
       │ 17. Subsequent /api/* calls:                      │                │                 │
       │     Authorization: Bearer <opaque>                │                │                 │
```

**Critical invariants:**
- The channel scheme (`openwhispr` / `-dev` / `-staging` / arbitrary override) MUST round-trip from `callbackURL` query param through `oauth_state` storage to the final 302. Hardcoding `openwhispr://` breaks dev/staging and arbitrary-override builds.
- Self-host MAY collapse step 13 (drop the `openwhispr.com` callback page) and emit `<scheme>://?bearer_token=...` directly. Desktop only inspects the **last** redirect.
- HTTP `401` triggers `withSessionRefresh()`. Returning `200 + {error:"unauth"}` breaks the retry contract.
- `set-auth-token` response header rotates tokens transparently — emit on any auth-client response when the token's age exceeds threshold.

---

## 4. Multi-Tenancy Model

### 4.1 Tenant resolution (priority order)

| Method | When | Notes |
|--------|------|-------|
| **Token claim** (preferred) | Authenticated calls | Bearer token row `sessions.tenant_id` resolved at session lookup. Single source of truth. |
| **Subdomain** (`{tenant}.openwhispr.example.com`) | Pre-auth + multi-domain installs | Parsed at edge or API tier; sets initial tenant context for `/api/check-user` and OAuth init. Falls back to `default` tenant if missing. |
| **Header** (`X-OpenWhispr-Tenant: <slug>`) | Programmatic / admin / testing | Lowest trust — must be paired with admin-scoped token. |
| **Default tenant** | Single-org installs | Bootstrap creates one row `tenants(slug='default')`. Every user belongs to it unless otherwise routed. |

Resolution rule: token-claim ALWAYS wins for authenticated calls. Cross-tenant requests (token claim ≠ resolved tenant from subdomain/header) → `403 Forbidden` + audit-log entry.

### 4.2 Postgres isolation: row-level security

**Recommendation: RLS with `app.tenant_id` GUC.** Schema-per-tenant doesn't scale to 1000 orgs (PG handles it but vacuum/migrations get painful). DB-per-tenant is operator nightmare.

#### DDL sketch

```sql
-- Every tenant-scoped table gets a tenant_id column + RLS
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  display_name text NOT NULL,
  plan        text NOT NULL DEFAULT 'free',
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  email       citext NOT NULL,
  idp_subject text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  bytea NOT NULL UNIQUE,        -- store SHA-256 of opaque bearer
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sessions ON sessions
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE usage_ledger (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  metric       text NOT NULL,                -- 'transcribe_words' | 'reason_tokens' | 'streaming_minutes'
  delta        bigint NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  request_id   text NOT NULL,                -- idempotency
  UNIQUE (request_id, metric)
);
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_usage ON usage_ledger
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Application role MUST NOT bypass RLS. NO SUPERUSER, NO BYPASSRLS.
CREATE ROLE openwhispr_app NOINHERIT NOLOGIN;
GRANT USAGE ON SCHEMA public TO openwhispr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openwhispr_app;
```

#### Per-request GUC injection (every connection checkout)

```sql
-- Pseudocode in API tier middleware after auth resolve:
BEGIN;
SET LOCAL app.tenant_id = '<uuid-from-token>';
-- ... do the work ...
COMMIT;
```

**Pitfall:** `SET` (no LOCAL) leaks across pooled connections — would cause cross-tenant data leak. ALWAYS `SET LOCAL`. Wrap in transaction even for single-statement reads.

**Migration runner** uses a separate `openwhispr_migrator` role with `BYPASSRLS` — only ever runs DDL/data backfills. Audit-logged.

### 4.3 Cross-tenant audit

Every API tier middleware MUST:
1. Resolve `claimed_tenant_id` from token.
2. Resolve `target_tenant_id` from subdomain/header (if any).
3. If both present and not equal → 403 + `audit_log(event='cross_tenant_attempt', user_id, claimed, target)`.
4. Set `app.tenant_id` GUC to **claimed** (never target).

---

## 5. Provider Abstraction Architecture

### Interface signatures (TypeScript shape; language-agnostic)

```typescript
// All providers resolve from tenant config. Hot-reload-safe via versioned config snapshot.

interface LLMProvider {
  readonly id: string;                              // 'litellm' | 'openai' | 'anthropic' | ...
  generate(request: LLMRequest, ctx: TenantCtx): Promise<LLMResult>;
  stream(request: LLMRequest, ctx: TenantCtx): AsyncIterable<LLMStreamEvent>;
}

interface STTProvider {
  readonly id: string;                              // 'litellm-speaches' | 'assemblyai' | 'deepgram' | 'openai-whisper' | 'groq'
  transcribe(audio: ReadableStream, opts: STTOpts, ctx: TenantCtx): Promise<STTResult>;
}

interface RealtimeProvider {
  readonly id: string;                              // 'speaches-realtime' | 'openai-realtime' | 'assemblyai-streaming' | 'deepgram-streaming'
  mintToken(opts: RealtimeOpts, ctx: TenantCtx): Promise<RealtimeToken>;
  // The ws upgrade itself happens in API tier ingress, not here — provider only mints credentials.
}

interface StorageProvider {
  readonly id: string;                              // 's3' | 'minio' | 'gcs' | 'azure-blob'
  put(key: string, body: ReadableStream, ctx: TenantCtx): Promise<{ url: string; etag: string }>;
  get(key: string, ctx: TenantCtx): Promise<ReadableStream>;
  delete(key: string, ctx: TenantCtx): Promise<void>;
  presign(key: string, op: 'GET'|'PUT', ttl: number, ctx: TenantCtx): Promise<string>;
}

interface EmailProvider {
  readonly id: string;                              // 'smtp' | 'sendgrid' | 'ses' | 'postmark'
  send(msg: EmailMessage, ctx: TenantCtx): Promise<{ messageId: string }>;
}

interface BillingProvider {
  readonly id: string;                              // 'stripe' | 'null'
  createCheckout(plan: PlanId, ctx: TenantCtx): Promise<{ url: string }>;
  createPortal(ctx: TenantCtx): Promise<{ url: string }>;
  switchPlan(plan: PlanId, ctx: TenantCtx): Promise<{ ok: boolean }>;
  previewSwitch(plan: PlanId, ctx: TenantCtx): Promise<ProrationPreview>;
}

interface IdPProvider {
  readonly id: string;                              // 'oidc' | 'saml' | 'google' | 'microsoft' | 'apple' | 'github' | 'email-password' | 'magic-link'
  buildAuthorizeURL(state: string, ctx: TenantCtx): string;
  exchangeCode(code: string, state: string, ctx: TenantCtx): Promise<IdPClaims>;
}

interface TenantCtx {
  tenantId: string;
  userId?: string;
  requestId: string;
  traceId: string;
  config: ResolvedTenantConfig;                     // snapshot at request-start
}
```

### Runtime selection

```
Request arrives
   │
   v
Auth middleware: token -> tenant_id, user_id, requestId
   │
   v
ConfigResolver.resolve(tenantId)        // versioned cache, refreshed on config-change pubsub
   │
   v
TenantCtx { config: { llm: 'litellm', stt: 'litellm-speaches', realtime: 'speaches-realtime', ... } }
   │
   v
Endpoint handler:
   const llm = providerRegistry.llm(ctx.config.llm);
   const result = await llm.generate(req, ctx);
```

- **Hot-reload-safe:** config changes go to Postgres → notify channel → API tier invalidates cached snapshot. In-flight requests keep their existing snapshot (no swap mid-request).
- **Per-tenant override:** any provider can be overridden in `tenant_config` table. `default` tenant uses operator-level defaults from env/YAML.
- **Fail-loud on missing:** unknown provider id → 500 + audit log. No silent fallback.

---

## 6. Data Flow for Usage / Quota

```
Request: POST /api/transcribe
   │
   v
[API tier handler]
   │
   ├── 1. Quota pre-check (synchronous, BEFORE upstream)
   │      SELECT (plan_limit - words_used) AS remaining
   │      FROM usage_summary_view
   │      WHERE tenant_id = current_setting('app.tenant_id')
   │
   │      IF remaining <= 0 → return 200 + {limitReached:true}
   │      (NO upstream call — this is the contract)
   │
   ├── 2. Forward to LiteLLM (multipart pass-through)
   │      LiteLLM emits spend log → spend_logs table OR webhook
   │
   ├── 3. On response: word_count = countWords(text)
   │
   ├── 4. INSERT INTO usage_ledger (tenant_id, user_id, metric='transcribe_words',
   │                                delta=word_count, request_id=<idempotent>)
   │      RETURNING id;                  -- ledger is append-only, idempotent on request_id
   │
   ├── 5. usage_summary_view (materialized) refreshed by worker job
   │      every 30s OR after each ledger insert (trigger-based incremental update)
   │
   └── 6. Response: {text, wordsUsed, wordsRemaining, plan, limitReached:false, ...}

[Worker tier — async]
   │
   ├── LiteLLM webhook ingest:
   │      Receives spend_log → INSERT INTO usage_ledger (metric='dollars', delta=...)
   │      Reconciles word-count vs token-count for billing audit
   │
   ├── Daily rollup job:
   │      INSERT INTO usage_daily_rollup (tenant_id, date, words, tokens, dollars)
   │      FROM usage_ledger WHERE occurred_at::date = $1
   │
   └── Plan-reset job (at billing cycle):
          UPDATE tenants SET cycle_started_at = now()
          (Aggregate views key off cycle_started_at)
```

**Contract pieces:**
- `wordsUsed` = sum(delta) for current cycle.
- `wordsRemaining` = `plan_limit - wordsUsed` (clamped at 0).
- `limitReached` = `wordsRemaining <= 0`.
- `plan` = tenant.plan or user.plan (which one is plan-tier-dependent — design now says **tenant** is canonical, user inherits).

**Idempotency:** every request gets a `request_id` (from `clientTranscriptionId` if present, else server-generated). Ledger has `UNIQUE(request_id, metric)` so retries don't double-count.

---

## 7. Build Order / Phase Implications

### Suggested phase ordering

```
Phase 0: Repo bootstrap                       (1-2 days)
  - Monorepo layout, lint/test/CI, license headers, .editorconfig
  - DOCS-09 (English-only) policy enforced via lint rule

Phase 1: Core infra (compose-only)            (3-5 days)
  - docker-compose.yml: nginx + Postgres + Redis + MinIO + LiteLLM + Speaches
  - Postgres init: tenants/users/sessions/usage_ledger schema + RLS DDL
  - Bootstrap "default" tenant
  - Healthchecks, otel-collector + Prometheus + Grafana minimum
  - Validates: SCALE-01 footprint, observability scaffolding

Phase 2: Auth + wire-API skeleton             (5-7 days)
  - /api/check-user, /api/auth/verification-status, /api/auth/delete-account
  - /api/desktop-signin/{provider} shim, channel-scheme echo
  - Better-Auth-compatible bearer issue + cookie fallback
  - withSessionRefresh-compatible 401 handling
  - set-auth-token rotation header
  - VALIDATES: WIRE-01, AUTH-01-05; desktop client can sign in

Phase 3: LiteLLM + Speaches default backend   (4-6 days)
  - LiteLLM config spec (DOCS-05)
  - Multipart pass-through patch deployment
  - Virtual-key generation per user
  - /api/transcribe → LiteLLM → Speaches Whisper end-to-end
  - /api/reason → LiteLLM → routed LLM (default openai/gpt-4o-mini or local)
  - VALIDATES: LITELLM-01..05, WIRE-02 partial

Phase 4: Streaming + realtime                 (5-7 days)
  - /api/agent/stream NDJSON line-flush (verified at p99 < 50ms ttfb)
  - WSS /v1/realtime proxy (Option A direct)
  - /api/openai-realtime-token virtual-key minting
  - Ingress 1h timeouts + buffering off rules
  - VALIDATES: SCALE-05, WIRE-02 streaming subset

Phase 5: Multi-provider abstraction           (5-8 days)
  - Provider interface implementations beyond LiteLLM
  - AssemblyAI, Deepgram, OpenAI Whisper, Groq STT
  - Direct OpenAI/Anthropic/Gemini/Bedrock/Azure/Vertex LLM
  - Per-tenant config resolver
  - /api/streaming-token, /api/deepgram-streaming-token (token mints)
  - VALIDATES: PROVIDER-01..04

Phase 6: Quotas + billing + referrals         (4-6 days)
  - usage_ledger writes, usage_summary_view, daily rollup worker
  - LiteLLM spend-log ingestion
  - Stripe provider implementation (checkout/portal/switch/preview)
  - /api/referrals/{stats,invite,invites} + email send
  - VALIDATES: PROVIDER-05, DATA-03, OBS-04

Phase 7: Observability + ops hardening        (3-5 days)
  - End-to-end tracing across API → LiteLLM → Speaches
  - Grafana dashboards (RED + saturation)
  - Structured logging w/ correlation IDs
  - Audit log + PII redaction
  - VALIDATES: OBS-01..04, DATA-04..05

Phase 8: Frontend UI-SPEC                     (3-5 days)
  - Admin console UI-SPEC (UI-01)
  - End-user self-service UI-SPEC (UI-02)
  - Component inventory + WCAG 2.2 AA
  - VALIDATES: UI-01..03

Phase 9: Load test + tuning                   (5-8 days)
  - 1000-concurrent simulation: transcribe + reason + stream + WSS
  - Identify and fix bottlenecks (FD limits, PgBouncer pool, Redis ops/sec)
  - Confirm p95 SLO budgets
  - VALIDATES: SCALE-06

Phase 10: Helm chart + cloud deploy           (5-8 days)
  - HA Postgres operator (CNPG), autoscaling, ingress, cert-manager
  - One-command bootstrap, one-command upgrade, migration safety
  - VALIDATES: DEPLOY-01..04

Phase 11: i18n + docs + OSS housekeeping      (3-5 days)
  - en + ru locale files, locale negotiation
  - All DOCS-* deliverables
  - CONTRIBUTING/SECURITY/CoC, ADRs
  - VALIDATES: I18N-01..02, DOCS-01..09
```

### Dependency rationale

- Phase 1 before everything: nothing works without infra.
- **Auth (Phase 2) before LiteLLM (Phase 3):** desktop can't call `/api/transcribe` without a valid bearer; smoke-testing transcribe needs auth.
- **Streaming (Phase 4) after sync endpoints (Phase 3):** sync paths flush out provider/quota plumbing without time pressure of buffering bugs.
- **Multi-provider (Phase 5) after LiteLLM happy-path (Phase 3+4):** abstraction is shaped by real-world LiteLLM/Speaches needs; building abstractions first risks over-engineering.
- **Quotas (Phase 6) after providers stable:** ledger needs real upstream calls to validate counts.
- **Load test (Phase 9) before Helm (Phase 10):** k8s amplifies bugs (per-pod FD limits, HPA flapping). Compose tuned first → port to Helm.
- **i18n (Phase 11) at end:** stable copy is harder to translate twice. But locale framework wiring should exist from Phase 2 onward (string keys, not literals).

---

## 8. Failure Domains and Graceful Degradation

| Component down | Affected endpoints | Behavior | Recovery |
|----------------|--------------------|----------|----------|
| **LiteLLM** | `/api/transcribe`, `/api/reason`, `/api/agent/stream`, `/v1/realtime` | All return `503 + {error:"upstream unavailable"}`. Cannot degrade — these are core. Health endpoints surface red. | LiteLLM restart; circuit-breaker on API tier reopens after 3 successful health probes. |
| **Speaches** | `/api/transcribe`, `/v1/realtime` | LiteLLM proxies to Speaches; if Speaches is the configured STT model, returns 503. Operator with multi-STT can route to fallback (Deepgram/AssemblyAI). | Speaches restart. GPU OOM is the typical failure — pre-set memory limits + restart on OOM. |
| **Postgres primary** | All authenticated endpoints | Patroni/CNPG promotes replica (~10-30s). API tier middleware uses bounded retries with backoff (max 3 attempts, 100ms-1s); after exhaust → 503 SERVER_ERROR. **Pre-auth /api/check-user falls through to "user does not exist"** per wire contract — desktop routes to sign-up; not a regression. | Failover automatic. PgBouncer reconnects. |
| **Postgres all replicas** | All endpoints | 503 across the board. /api/health returns 5xx. Desktop sees "offline" UI. | Restore from backup; data path is unrecoverable without Postgres. |
| **Redis** | Rate limit + quota cache + queue | **Fail-OPEN on rate limit** (better UX than blocking everyone), **fail-CLOSED on idempotency keys** (avoid duplicate ledger inserts). Queue jobs back up — workers idle. Email/webhook delays. | Redis restart. Sentinel/Cluster makes this rare. |
| **Worker tier** | Background jobs only | Synchronous endpoints unaffected. Webhooks delayed; usage rollups stale (current-cycle counts still served from ledger directly, but daily aggregates lag). | HPA brings workers back. Backlog drains. |
| **Object storage** | Transcript persist (if enabled), audit-log archive | Optional path — if disabled, no impact. If enabled and down, writes go to local disk fallback queue + retry by worker. Reads of historical blobs return 503. | Storage restart. |
| **Ingress single replica** | Everything | Site down. → 2+ replicas required. | k8s rescheduling; compose: single point — accept or use external LB. |
| **Email provider** | Verification emails, referral invites | `/api/auth/verification-status` keeps polling — verified flips false until email lands; UX delay only. Referrals queued + retried. | Email retry with backoff. After N failures, alert operator. |
| **IdP (Google/MS/Apple)** | New sign-ins via that provider | Existing sessions unaffected. New sign-ins through other providers OK. Email-password works always. | IdP recovery. |
| **Stripe** | `/api/stripe/*` | Return 503; desktop UI shows error. Existing subscriptions/quotas keep working (quota in our DB, not Stripe's). | Stripe SLA; retries via worker. |

**Cross-cutting pattern:** every external call is wrapped in:
1. Timeout (per-provider; 3s for /health, 30s for sync STT/LLM, 60min for streaming).
2. Retries with jittered backoff (idempotent only).
3. Circuit breaker (open after N failures within window; half-open probe; close on success).
4. Audit/metric for each state transition.

---

## 9. Container Topology

### Compose (single-host self-host)

```
docker-compose.yml services:
  nginx           (reverse proxy + TLS)
  api             (3 replicas via deploy.replicas)
  worker          (2 replicas)
  auth            (option A: subset of api, no separate service)
  postgres        (single, with backups via pg_basebackup volume)
  pgbouncer       (in front of postgres)
  redis           (single, AOF persistence)
  litellm         (1 replica; multipart-patched image)
  speaches        (1 replica; needs GPU, --gpus all on host with CUDA)
  minio           (S3-compatible)
  otel-collector
  prometheus
  grafana
  loki
```

- **Sidecar-style for LiteLLM/Speaches?** No — separate deployments. They have different lifecycles, different scale axes, and Speaches needs GPU. Sidecars (one-per-API-pod) would 10x GPU cost.

### Helm (k8s cloud)

```
Deployments:
  ingress-nginx        (DaemonSet or Deployment, 2+)
  api                  (HPA 3-30 replicas, CPU+RPS-based)
  worker               (HPA 2-20)
  auth                 (HPA 2-10) — optional split if cookie isolation needs it
  litellm              (Deployment, 2-4 replicas, ClusterIP)
  speaches             (StatefulSet, 1-N replicas, **node-selector: gpu**)

Operators / managed:
  cnpg-cluster         (3 nodes Postgres, automated backups, pooler)
  redis-sentinel       (3 nodes) or Redis Cluster

Networking:
  Ingress (cert-manager) → api Service
  api → litellm.ClusterIP
  litellm → speaches.ClusterIP (svc-headless if statefulset for sticky sessions during realtime)
  All pods → otel-collector DaemonSet

Helm values surface:
  - replicas per tier (overridable)
  - postgres connection (CNPG cluster name)
  - litellm config (mounted as Secret)
  - tenant defaults (ConfigMap)
  - GPU node selector for Speaches
```

**Sticky sessions for WSS realtime:** at ingress, hash by `Authorization` token (or `sec-websocket-key`) to keep a session pinned to one Speaches pod for its lifetime. Otherwise, mid-session pod restart drops audio.

---

## 10. Streaming / Long-Lived Connection Sizing (1000 concurrent)

### Connection inventory at peak

Assume worst-case mix at 1000 concurrent users:
- 200 holding `/api/agent/stream` (NDJSON, ~30s-3min each)
- 100 on WSS `/v1/realtime` (~5min average)
- 700 in idle / sync request mix (50 RPS for transcribe + reason etc., 200ms p50)

**Sockets held simultaneously (steady-state peak):**

| Path | Sockets ingress→api | Sockets api→litellm | Sockets litellm→speaches |
|------|---------------------|---------------------|--------------------------|
| Sync RPS (50/s × 200ms p50) | ~10-20 in-flight | ~10-20 | ~10-20 |
| Agent stream (200 concurrent) | 200 | 200 | n/a (LLM is upstream) |
| Realtime WSS (100 concurrent) | 100 | 100 (Option B) or 0 (A) | 100 |
| **Subtotal** | **~310 ingress** | **~310** | **~110-130 GPU** |
| Plus client→ingress double-direction socket fan-out |    | |  |

### nginx / ingress sizing

- `worker_connections 8192;` (default 1024 is too low).
- `worker_rlimit_nofile 65535;` (raise FD limit).
- `keepalive_requests 1000; keepalive_timeout 75s;` for connection reuse.
- 2 ingress replicas → 16k worker connections headroom; 4x safety margin over 310 simultaneous.
- Per-replica RAM: ~256MB base + ~100MB for buffers; **2GB request, 4GB limit** is safe.

### API tier sizing

Stateless tier; concurrency model matters:
- **Node/Fastify (event loop):** 1 process per CPU core; 200-500 concurrent open requests per process is fine because most are I/O-bound waiting on LiteLLM. **3 pods × 4 vCPU × ~500 = 6000-capable**, well over 1000.
- **Go/Fiber (goroutines):** essentially unlimited per pod within RAM. 3 pods × 2 vCPU is plenty.
- **Python/FastAPI (asyncio):** similar to Node. 4 workers × 3 pods.
- Memory: streaming = no payload buffered server-side; ~10-30MB per connection (TLS state + small internal buffers). 310 × 30MB = ~9GB across cluster — **3 pods × 4GB request, 6GB limit**.
- **CRITICAL:** disable any framework body-buffering on `/api/transcribe` and `/api/agent/stream`. Default Fastify has `bodyLimit: 1MB` → must increase or switch to streaming `multipart` plugin. FastAPI with `UploadFile` is fine.

### Postgres sizing

- 1000 users × ~2 RPS during active use = 2000 RPS. Auth lookup + tenant resolve + GUC set + endpoint query = 3-5 queries. **6k-10k QPS peak.**
- PgBouncer transaction-mode pool: 100 server connections is enough; 1000 client-side waiters fan in.
- Postgres max_connections: 200 (pgbouncer multiplexes).
- 1 primary + 2 replicas (read-heavy quota lookups go to replicas via routing layer).
- Disk: ledger inserts heavy; SSD with WAL on separate volume; 50GB initial.

### Redis sizing

- Rate-limit ops: ~3 ops per HTTP call → 6k-10k ops/s. Single Redis 7 instance does 100k+ ops/s. 1 instance fine; 2 for HA.

### Speaches GPU sizing

- Whisper-large-v3 transcription: ~real-time × 5 on a single GPU lane. 50 concurrent transcriptions per A10/L4-class GPU.
- Realtime sessions: heavier; ~20 concurrent per GPU.
- 1000 users does NOT mean 1000 concurrent transcribes — peak ~100-200. **2-4 GPU pods** sized at A10G or L4.
- This is the most expensive tier — tune actively post-load-test.

### File-descriptor math (single API pod)

- 310 client sockets + 310 upstream sockets + 100 DB pool conns + 50 Redis conns + 20 file/log = ~800.
- Default `ulimit -n` on Linux: 1024 (TIGHT) or 65535. **Set explicitly to 65535.**
- k8s: `securityContext.sysctls` or set in container entrypoint.

---

## 11. Architectural Patterns

### Pattern 1: Tenant context middleware

**What:** Every authenticated request resolves tenant once, sets DB GUC, passes immutable `TenantCtx` to handlers.
**When:** Every authenticated path. No exceptions.
**Trade-offs:** Adds 1ms overhead per request. Buys safety: handlers can't accidentally bypass RLS.

```pseudo
async function tenantMiddleware(req, res, next) {
  const token = parseAuthHeader(req);
  const session = await sessionStore.find(hash(token));
  if (!session) return res.status(401).json({error: "Unauthorized"});

  // Cross-tenant guard
  const subdomainTenant = parseSubdomain(req.host);
  if (subdomainTenant && subdomainTenant !== session.tenantId) {
    auditLog.crossTenantAttempt(session, subdomainTenant);
    return res.status(403).json({error: "Forbidden"});
  }

  const ctx = {
    tenantId: session.tenantId,
    userId: session.userId,
    requestId: req.headers['x-request-id'] ?? uuid(),
    traceId: getTraceId(req),
    config: await configResolver.resolve(session.tenantId),
  };

  // Acquire DB connection + set GUC
  await db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL app.tenant_id = $1`, [ctx.tenantId]);
    req.ctx = { ...ctx, tx };
    await next();
  });
}
```

### Pattern 2: Provider registry with hot-reload-safe snapshots

**What:** Tenant config is resolved once per request into an immutable snapshot. Changes to config don't affect in-flight requests.
**When:** All provider dispatches.
**Trade-offs:** Slightly stale config for inflight requests (acceptable). Simple correctness.

```pseudo
class ConfigResolver {
  constructor(db, redis) {
    this.cache = new Map(); // tenantId -> { version, config }
    redis.subscribe('tenant_config_changed', (tenantId) => this.cache.delete(tenantId));
  }
  async resolve(tenantId) {
    if (this.cache.has(tenantId)) return this.cache.get(tenantId).config;
    const row = await db.queryOne(`SELECT config, version FROM tenant_config WHERE tenant_id = $1`, [tenantId]);
    this.cache.set(tenantId, row);
    return row.config;
  }
}
```

### Pattern 3: Streaming with explicit flush

**What:** NDJSON endpoints write each line and explicitly flush before returning to the I/O loop.
**When:** `/api/agent/stream` only.
**Trade-offs:** Requires framework support; some HTTP libraries don't expose `flush`. Audit choice in STACK research.

```pseudo
async function agentStream(req, res, ctx) {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx hint
  res.setHeader('Cache-Control', 'no-store');

  for await (const event of agentLoop(req.body, ctx)) {
    res.write(JSON.stringify(event) + '\n');
    res.flush?.();   // explicit; framework-dependent
  }
  res.end();
}
```

### Pattern 4: Quota pre-check + ledger insert (write-through)

**What:** Read-then-call-then-write. Quota check before upstream; ledger insert after upstream returns.
**When:** Every metered endpoint.
**Trade-offs:** Two DB roundtrips per request. Race condition: two simultaneous requests at exactly limit can both pass pre-check. Acceptable — ledger is canonical, slight overage tolerated, audit log catches it.

### Pattern 5: Circuit-breaker per upstream

**What:** Wrap every external call in a per-target breaker.
**When:** All provider calls (LLM, STT, Realtime, Email, Stripe, IdP).
**Trade-offs:** Adds complexity. Mandatory at scale.

---

## 12. Anti-Patterns

### Anti-Pattern 1: Buffering the NDJSON response

**What people do:** Return NDJSON from a handler that builds a full `string[]` then JSON-stringifies and sends once.
**Why it's wrong:** Defeats the streaming wire contract; client UI waits for full response → terrible UX. Memory blows up on long agent runs.
**Do this instead:** Generator/async-iterable + `res.write(line + '\n')` + `res.flush()` per line.

### Anti-Pattern 2: Hardcoding `openwhispr://` in OAuth redirect

**What people do:** Final 302 emits `openwhispr://?bearer_token=...` regardless of input.
**Why it's wrong:** Dev/staging builds (`openwhispr-dev`, `openwhispr-staging`) get the URL dispatched to wrong app or ignored. Breaks all non-prod testing. **Will break arbitrary-channel overrides too.**
**Do this instead:** Persist `channel_scheme` from `callbackURL` in `oauth_state` table; echo it in the final redirect verbatim.

### Anti-Pattern 3: Setting `app.tenant_id` GUC without `LOCAL`

**What people do:** `SET app.tenant_id = $1` (no LOCAL) at request start.
**Why it's wrong:** Pooled connection retains the GUC after the request returns → next request on same connection runs as wrong tenant → cross-tenant data leak.
**Do this instead:** Always `SET LOCAL app.tenant_id = $1` inside an explicit transaction. Audit-test by running concurrent requests on a known-pooled connection.

### Anti-Pattern 4: Returning 4xx for quota exhaustion on `/api/transcribe`

**What people do:** Return `429 Quota exceeded` to be "RESTful."
**Why it's wrong:** Wire contract says `200 + limitReached:true`. Returning 4xx triggers `withSessionRefresh()` retry-on-401 logic on adjacent endpoints; surfaces as generic API error UI; quota-exhaustion UX never appears.
**Do this instead:** `200 + {limitReached:true, wordsUsed, wordsRemaining:0, plan, ...}`.

### Anti-Pattern 5: Sidecar-deploying Speaches per API pod

**What people do:** Make Speaches a sidecar container in the API Deployment.
**Why it's wrong:** Each API pod replica needs its own GPU. Cost: 10x. Scaling axes are different (audio sessions vs HTTP requests).
**Do this instead:** Separate Deployment, dedicated GPU node pool. Scale independently.

### Anti-Pattern 6: Relying on LiteLLM's spend log for primary quota

**What people do:** Skip our own usage_ledger; just query LiteLLM `/spend/logs` for usage UI.
**Why it's wrong:** LiteLLM spend is async and lossy under load; doesn't model words (only tokens/dollars); pass-through endpoints (diarization) don't show in spend at all.
**Do this instead:** Our `usage_ledger` is canonical. LiteLLM spend = audit/reconciliation only.

### Anti-Pattern 7: Default nginx `proxy_buffering on`

**What people do:** Use default nginx config.
**Why it's wrong:** Default 4-8k buffer kills realtime streaming; client sees nothing for seconds. Default 60s `proxy_read_timeout` kills WSS realtime sessions.
**Do this instead:** Per-location overrides for `/api/agent/stream` (`proxy_buffering off`) and `/v1/realtime` (`proxy_read_timeout 3600s`). `client_max_body_size 100M` for `/api/transcribe`.

---

## 13. Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| LiteLLM Proxy | HTTPS REST + WSS | Same-cluster ClusterIP; bearer = per-tenant virtual key minted via key/generate API. Master key never leaves operator's secret store. Multipart pass-through requires v1.83.7 backport. |
| Speaches | Behind LiteLLM only | Never exposed directly — LiteLLM is the trust boundary for audio routes. |
| OpenAI/Anthropic/etc. (alternate providers) | Via LiteLLM model alias OR direct provider class | Direct only when LiteLLM lacks a feature (unlikely in v1). |
| IdP (Google/MS/Apple/OIDC) | Server-side OAuth at auth shim; Authorization Code flow | Per `OAUTH_SPEC.md`. Channel-scheme echo is the contract. |
| Stripe | API + webhooks | Webhook ingestion at worker tier; sign-verify; idempotency-key on subscription events. |
| Email (SMTP/SendGrid/SES/Postmark) | Provider abstraction; queued send via worker | Templates per locale (en/ru). |
| S3-compatible storage | Presigned URLs for large blob upload | MinIO in compose; S3/GCS/Azure-Blob in cloud. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| API tier ↔ Postgres | TCP via PgBouncer (transaction pool) | RLS GUC injection per request. SSL required if PG not on same host. |
| API tier ↔ Redis | TCP | TLS optional in same-cluster; required across zones. |
| API tier ↔ LiteLLM | HTTPS internal | Mutual TLS optional; bearer auth required. |
| LiteLLM ↔ Speaches | HTTPS + WSS internal | Same-cluster; behind LiteLLM trust boundary. |
| API ↔ Worker | Redis queue (BullMQ/asynq) | Job payload includes `tenantId` for RLS scoping. |
| API ↔ Worker (sync notify) | Redis pub/sub | Config invalidation, cache busts. |

---

## 14. Sources

- `/Users/nick/openwhispr-server/.planning/PROJECT.md` — Project context and constraints (HIGH).
- `/Users/nick/openwhispr/docs/SELF_HOSTING.md` — Wire walkthrough, custom-protocol channel-scheme contract (HIGH).
- `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` — Per-endpoint contract for all 19 endpoints + Conventions + Global Error Envelope (HIGH).
- `/Users/nick/openwhispr/docs/OAUTH_SPEC.md` — Auth-flow trace; channel-scheme echo source-of-truth (HIGH).
- `/Users/nick/openwhispr-server/speaches-audio.md` — LiteLLM v1.82.3 multipart bug, Speaches three-route deployment shape, ingress 3600s realtime timeouts, virtual-key auth (HIGH; production-validated at Alfaleasing).
- `/Users/nick/openwhispr/docs/ARCHITECTURE.md` — Desktop client process model and IPC surface (HIGH; informs auth-token attachment paths).
- nginx ingress streaming configuration patterns (`proxy_buffering off`, `proxy_request_buffering off`, `X-Accel-Buffering: no`) — well-known nginx idioms (MEDIUM, requires verification under load).
- PostgreSQL row-level security + `current_setting()` GUC pattern — PostgreSQL official docs and well-established multi-tenant-SaaS practice (HIGH).
- LiteLLM realtime mode (`mode: realtime`) per `speaches-audio.md` reference (HIGH).
- 1000-concurrent sizing math derived from standard nginx/Linux defaults; **MUST be validated under SCALE-06 load test** before being committed as SLO (MEDIUM).

---

*Architecture research for: OpenWhispr Server (multi-tenant, wire-compatible cloud backend)*
*Researched: 2026-05-08*
