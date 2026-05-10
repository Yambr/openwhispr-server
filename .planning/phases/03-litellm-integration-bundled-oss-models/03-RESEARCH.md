# Phase 03: LiteLLM Integration + Bundled OSS Models — Research

**Researched:** 2026-05-10
**Domain:** AI proxy plane (LiteLLM v1.83.x), audio routes, spend ingestion, Fastify wsUpstream
**Confidence:** HIGH

## Summary

Phase 03 bundles LiteLLM Proxy (`v1.83.7-stable+`, multipart-passthrough fix is native) as a sidecar in `docker-compose.yml`, wires three audio routes + `/api/reason`, and ingests `LiteLLM_SpendLogs` into our `usage_ledger` via a 30-second BullMQ Job Scheduler. The bundled provider set is **OpenRouter (LLM) + OpenAI Whisper (STT) + pyannote.ai cloud (diarization pass-through)** per CONTEXT D-01 — **no local AI containers, no GPU images, no HF token gating**. Per-user attribution uses the OpenAI-compatible `user` body parameter (or `x-litellm-end-user-id` header) which LiteLLM stores in `LiteLLM_SpendLogs.end_user` — **no virtual-key minting** (CONTEXT D-03).

Realtime WSS is reverse-proxied through Fastify via `@fastify/http-proxy` `wsUpstream` so the desktop client never sees the LiteLLM master key (CONTEXT D-04). Two-mode contract testing (CI uses LiteLLM `mock_response` config variant; manual `make e2e-test` uses real keys from `.env.e2e`) per CONTEXT D-05. Default LLM for `/api/reason` is `openrouter/qwen/qwen-3.5-plus-02-15` per CONTEXT D-06.

**Primary recommendation:** Pin `ghcr.io/berriai/litellm:main-v1.83.14-stable` (latest stable in the v1.83.x line, includes multipart fix), separate `litellm` Postgres database created via init-script (not migration), BullMQ Job Scheduler for 30s spend ingestion with idempotent `INSERT ... ON CONFLICT (request_id) DO NOTHING` into `usage_ledger`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Bundled-default LiteLLM provider set: OpenRouter + pyannote + OpenAI Whisper.**
`compose/litellm/litellm_config.yaml` model_list shipped in the repo:
- LLMs (for /api/reason) → OpenRouter (`api_key: os.environ/OPENROUTER_API_KEY`)
- Transcription (for /api/transcribe) → OpenAI `whisper-1` (`api_key: os.environ/OPENAI_API_KEY`)
- Diarization (for /api/diarization) → pyannote.ai cloud via `pass_through_endpoints` (`api_key: os.environ/PYANNOTE_API_KEY`)
- Missing API key → endpoint returns 503 with explicit message (no silent failure).

**D-02 — Spend-log ingestion: Postgres co-tenant read.**
LiteLLM writes `LiteLLM_SpendLogs` in same Postgres cluster, separate `litellm` database. BullMQ repeatable job (`ingest-litellm-spend`, every 30s) reads by watermark, mirrors to `usage_ledger` with idempotent UPSERT on `request_id`.

**D-03 — NO virtual key minting per user. Use OpenAI-compatible `user` parameter.**
One `LITELLM_MASTER_KEY` for the API; pass `user: "<userId>"` in each request body. LiteLLM auto-stores in `LiteLLM_SpendLogs.end_user`. NO `litellm_virtual_key` column on `users`, NO mint logic, NO rotation.

**D-04 — Realtime WSS topology: Fastify wsUpstream proxy.**
`Traefik → Fastify (auth + LITELLM_MASTER_KEY inject + user query) → LiteLLM`. `@fastify/http-proxy` `wsUpstream`. Preserves opaque-bearer (desktop never sees master key).

**D-05 — Contract-test two-mode strategy: mocks (CI) + real-keys (E2E).**
Mode A (`make contract-test`): `compose/litellm/litellm_config.contract.yaml` with `mock_response` per model.
Mode B (`make e2e-test`): real keys from `.env.e2e`, hits real APIs.

**D-06 — Default LLM model for /api/reason: qwen3.5-plus.**
Model name `openrouter/qwen/qwen-3.5-plus-02-15` via OpenRouter when client doesn't pass `model`.

### Claude's Discretion (advisor research areas)

- Exact `litellm_config.yaml` model_list shape and aliases
- `LiteLLM_SpendLogs` schema and watermark strategy
- `litellm` database creation approach (init script vs migration)
- Fastify `wsUpstream` config with auth pre-handler
- `request_id` propagation mechanism (header vs metadata)
- 503 error envelope shapes for missing keys
- BullMQ retry/backoff config
- `.env.example` final shape
- BullMQ worker process layout (`apps/worker/` package vs in-process)

### Deferred Ideas (OUT OF SCOPE)

- Bundled local AI models (Speaches/Ollama/faster-whisper/GPU profile) — REJECTED
- Per-user virtual key minting/rotation/encrypted storage — REJECTED per D-03
- Streaming NDJSON `/api/agent/stream` (Phase 4)
- WSS first-line latency benchmark (Phase 4)
- Streaming-token mints AssemblyAI/Deepgram/OpenAI Realtime (Phase 4 / WIRE-13/14/15)
- web-search tool (Phase 5)
- Audit log for key issuance (DATA-04 in Phase 6)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WIRE-05 | `POST /api/transcribe` — multipart → LiteLLM `/v1/audio/transcriptions`; documented JSON shape | §5 multipart streaming, §7 wire shape |
| WIRE-06 | `POST /api/reason` — LiteLLM `/v1/chat/completions`; `{text, model, provider, promptMode, matchType}` | §6 reason wire shape |
| LITELLM-01 | Bundle LiteLLM ≥v1.83.7-stable | §1 deployment topology, pinned image `v1.83.14-stable` |
| LITELLM-02 | Default config wires to public APIs (OpenRouter / OpenAI / pyannote) — REINTERPRETED per CONTEXT D-01 | §2 config schema |
| LITELLM-03 | Three audio routes (transcriptions, diarization pass-through, WSS realtime), 3600s timeouts | §2, §4, §5 |
| LITELLM-04 | Pass `user: <userId>` parameter — REINTERPRETED per CONTEXT D-03 | §2 end-user tracking |
| LITELLM-05 | Env override path (`LITELLM_BASE_URL`) for corporate operators | §1, §11 .env.example |
| LITELLM-06 | `docs/litellm-target-spec.md` derived from speaches-audio.md | §12 doc outline |
| LITELLM-07 | Spend log ingestion via Postgres co-tenant + BullMQ | §3 SpendLogs schema, §8 BullMQ |
| PROVIDER-01 | Single LiteLLM endpoint abstraction | §1 (single base URL, env-override) |
| DATA-03 | Usage_ledger idempotent on `request_id` (schema already in place) | §3 watermark + §8 ON CONFLICT |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** Node 24 LTS + Fastify 5 + TypeScript + Drizzle + Postgres 17 + PgBouncer + Valkey 8 + BullMQ.
- **LiteLLM deployment:** separate sidecar container (NOT embedded in Node — polyglot disaster).
- **TDD constitutional:** tests precede production code; per-phase coverage ≥90% on touched files.
- **No workarounds / no `--legacy` / no mocks in production code:** mocks ONLY in test profile (LiteLLM `mock_response` IS a native LiteLLM feature, not a custom mock — acceptable).
- **English-only source artifacts:** docs, comments, identifiers, log keys (Russian only allowed in CONTEXT.md user-text sections, not in code).
- **Real services in CI:** testcontainers for Postgres/Valkey; LiteLLM in-compose with mock_response variant for contract-tests profile.
- **Integrate into existing infra:** add `litellm` service to existing `docker-compose.yml`, do NOT create parallel compose files. Worker process either as additional `apps/worker/` package or as separate compose service from same image.
- **GitHub Actions only sanctioned CI;** branch protection on `main`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| LiteLLM Proxy | `v1.83.14-stable` (image: `ghcr.io/berriai/litellm:main-v1.83.14-stable`) | AI proxy plane, OpenAI-compatible router | Multipart-passthrough fix native (PR #25464); current latest stable in v1.83.x line; signed via cosign [VERIFIED: docs.litellm.ai release notes] |
| `@fastify/http-proxy` | `^11.x` (Fastify 5 compatible) | Reverse-proxy `WSS /v1/realtime` → LiteLLM, plus optional REST upstreams | Native `wsUpstream` + `wsClientOptions.rewriteRequestHeaders` for master-key injection [VERIFIED: github.com/fastify/fastify-http-proxy] |
| `@fastify/multipart` | `^9.x` (already pinned by Fastify 5) | Receive desktop multipart audio uploads | Stream mode supports forward-without-buffer (file >>RAM scenarios) [CITED: fastify.dev plugins] |
| `bullmq` | `^5.x` (latest, > v5.16.0 uses Job Schedulers API) | Spend-ingest cron job every 30s | Repeatable Jobs API deprecated v5.16+; use Job Scheduler `{ every: 30_000 }` [VERIFIED: docs.bullmq.io/guide/job-schedulers] |
| `undici` | bundled with Node 24 | Outbound HTTP (chat/completions, streaming proxy) | Native fetch in Node 24; preferred over `node-fetch` |
| `pg` | already in `@openwhispr/data` | Direct connection for `litellm` co-tenant database read | Compatible with PgBouncer transaction-mode [VERIFIED: in repo] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fastify/websocket` | `^11.x` | Only if we need to handle WS server-side (we don't — http-proxy handles it) | Skip in Phase 3 |
| `pino` | already wired | Structured logging with request_id correlation | All routes |
| `zod` | already wired (contract-tests/schemas) | Wire-shape validation for req/res bodies | New routes' schemas |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@fastify/http-proxy` for WSS | Hand-rolled `ws` client + Fastify upgrade hook | More code, no benefit; `wsUpstream` is the boring choice [CITED: github.com/fastify/fastify-http-proxy] |
| BullMQ Job Scheduler | `node-cron` in-process | BullMQ already required by ROADMAP (SCALE-03); cron-in-process loses across restarts and replicas |
| Polling LiteLLM `/spend/logs` HTTP | Postgres co-tenant read | CONTEXT D-02 locked; PG read is authoritative, no polling lag, no API rate-limit |
| Mint per-user virtual keys | `user` body param | CONTEXT D-03 locked; simpler, no storage, no rotation |
| Embed LiteLLM in Node | Sidecar container | Polyglot Python/Node bridge is a maintenance disaster (CLAUDE.md §4) |

**Installation:**

```bash
pnpm --filter @openwhispr/litellm-client add @fastify/http-proxy bullmq
# undici, pg already present
```

**Version verification commands** (planner MUST run before locking):

```bash
# Confirm latest LiteLLM stable tag at plan time
docker pull ghcr.io/berriai/litellm:main-v1.83.14-stable
# Confirm fastify-http-proxy v11+
npm view @fastify/http-proxy version
npm view bullmq version
```

## Architecture Patterns

### Recommended Project Structure

```
apps/
  api/
    src/
      routes/
        transcribe.ts          # POST /api/transcribe (multipart → LiteLLM)
        reason.ts              # POST /api/reason (JSON → LiteLLM /chat/completions)
        diarization.ts         # POST /api/diarization (multipart pass-through)
        realtime.ts            # WSS /v1/realtime (wsUpstream)
        index.ts               # extend buildAllRoutes with the 4 new factories
      lib/
        request-id.ts          # generate UUID per request, attach to req + log + LiteLLM header
        litellm-error-envelope.ts # 503 helpers for missing-key cases
  worker/                       # NEW package OR run inside apps/api as separate entry point
    src/
      index.ts                 # BullMQ Worker boot, graceful SIGTERM handler
      jobs/
        ingest-litellm-spend.ts # 30s scheduler; reads LiteLLM_SpendLogs → usage_ledger
      db/
        litellm-pool.ts        # pg pool to litellm DB (separate from app DB)
packages/
  litellm-client/
    src/
      index.ts                 # replaces placeholder; chatCompletions(), audioTranscriptions()
      http-proxy-config.ts     # @fastify/http-proxy options builder
  data/
    migrations/
      init/
        01-litellm-database.sh # POST-postgres-init shell script (NOT a Drizzle migration)
compose/
  litellm/
    litellm_config.yaml         # bundled-default model_list (OpenRouter, OpenAI, pyannote pass-through)
    litellm_config.contract.yaml # mock_response variant for CI
docs/
  litellm-target-spec.md       # bundled + corporate-override topologies
  litellm-mock-mode.md         # CI mock_response mode explained
```

**Worker process recommendation:** Create a new `apps/worker/` package (separate Dockerfile reusing the same multi-stage build pattern as `apps/api/Dockerfile`). Reasons:
1. Independent scaling (Phase 6 SCALE-03 anticipates multiple worker types).
2. Clean separation of HTTP-serving from background processing.
3. Independent restart cycles (avoid restarting API on worker code changes).
4. Aligns with ROADMAP Phase 6 worker decomposition.

### Pattern 1: LiteLLM Sidecar in docker-compose

```yaml
# Source: pattern from existing migrate/api services + LiteLLM Quick Start
# https://docs.litellm.ai/docs/proxy/docker_quick_start
litellm:
  image: ghcr.io/berriai/litellm:main-v1.83.14-stable
  profiles: [default]
  networks: [openwhispr_internal]
  environment:
    LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}
    DATABASE_URL: postgres://openwhispr_owner:${POSTGRES_OWNER_PASSWORD}@postgres:5432/litellm
    OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
    OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    PYANNOTE_API_KEY: ${PYANNOTE_API_KEY:-}
    STORE_MODEL_IN_DB: "True"
  command: ["--config", "/etc/litellm/config.yaml", "--port", "4000", "--num_workers", "2"]
  volumes:
    - ./compose/litellm/litellm_config.yaml:/etc/litellm/config.yaml:ro
  depends_on:
    postgres:
      condition: service_healthy
    migrate:
      condition: service_completed_successfully  # ensures litellm DB exists
  healthcheck:
    test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:4000/health/liveliness"]
    interval: 10s
    timeout: 3s
    retries: 5
    start_period: 30s
```

LiteLLM exposes `/health/liveliness` (no auth) and `/health/readiness` (auth). Source: docs.litellm.ai/docs/proxy/health.

For the **contract-test profile**, override the config-file mount with `litellm_config.contract.yaml` (no API keys needed — every model uses `mock_response`). Reuse same image, same env shell, just different config volume.

### Pattern 2: Separate `litellm` Database via Init Script

Postgres `CREATE DATABASE` cannot run inside a transaction and cannot be issued via `psql -c` against a database that doesn't exist yet. Drizzle migrations run inside a transaction → unsuitable. Use the `/docker-entrypoint-initdb.d/` mechanism that runs ONCE on first init:

```bash
# packages/data/migrations/init/01-litellm-database.sh
# Runs after Postgres is initialized but BEFORE any client can connect.
# Note: ONLY runs when postgres data volume is empty (first-init only).
# For existing volumes, operators run a one-shot helper (documented in operations.md).
#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE DATABASE litellm OWNER ${POSTGRES_OWNER_USER:-openwhispr_owner};
EOSQL
```

[VERIFIED: github.com/docker-library/postgres issue #151, dev.to/bgord/multiple-postgres-databases-in-a-single-docker-container]

Mount via existing `postgres` service:

```yaml
volumes:
  - ./packages/data/migrations/init:/docker-entrypoint-initdb.d:ro  # (already mounted today)
```

LiteLLM auto-creates its own tables (`LiteLLM_SpendLogs`, `LiteLLM_VerificationToken`, etc.) via Prisma migrate on first boot — we just need the empty database to exist. [CITED: docs.litellm.ai/docs/proxy/db_info]

**Existing-volume migration path:** For installations that already have a postgres data volume (no first-init re-run), document a one-shot `make litellm-init-db` target that runs `psql -c "CREATE DATABASE litellm"` against the running postgres container. This is the upgrade path.

### Pattern 3: `litellm_config.yaml` (bundled-default)

```yaml
# Source: docs.litellm.ai/docs/proxy/configs + customers + pass_through
model_list:
  # LLMs via OpenRouter (D-06 default)
  - model_name: qwen3.5-plus
    litellm_params:
      model: openrouter/qwen/qwen-3.5-plus-02-15
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: claude-opus-4.7
    litellm_params:
      model: openrouter/anthropic/claude-opus-4.7
      api_key: os.environ/OPENROUTER_API_KEY
  # ... add additional aliases as the product needs

  # Transcription via OpenAI Whisper
  - model_name: whisper-1
    litellm_params:
      model: openai/whisper-1
      api_key: os.environ/OPENAI_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL  # litellm DB
  store_model_in_db: True
  # Pass-through diarization → pyannote.ai cloud
  pass_through_endpoints:
    - path: "/v1/audio/diarization"
      target: "https://api.pyannote.ai/v1/diarize"
      auth: true                       # require LiteLLM master key
      headers:
        Authorization: "Bearer os.environ/PYANNOTE_API_KEY"
        content-type: application/json
      forward_headers: false
      methods: ["POST"]

litellm_settings:
  drop_params: True
  set_verbose: False
```

[VERIFIED: docs.litellm.ai/docs/proxy/pass_through, docs.litellm.ai/docs/proxy/configs]

⚠️ **pyannote.ai shape mismatch (CRITICAL):** pyannote.ai's API is *not* a direct multipart upload to `/v1/diarize`. It's a two-step flow:
1. `POST /v1/media/input` returns a presigned upload URL.
2. Upload binary, then `POST /v1/diarize` with `{"url": "media://..."}`.

LiteLLM `pass_through_endpoints` does single-hop forwarding — it cannot orchestrate the two-step pyannote.ai flow. **The planner must decide between three options:**

- **Option A (recommended for v1):** The Fastify `/api/diarization` route handles the two-step flow client-side (call pyannote.ai directly, bypassing LiteLLM). Document `PYANNOTE_API_KEY` as an API-side env, NOT a LiteLLM config entry. We lose LiteLLM spend metering for diarization (CONTEXT acknowledges pass-through unmetered → already accepted in LITELLM-07).
- **Option B:** Use a self-hostable pyannote endpoint that accepts direct multipart (e.g., HF Inference Endpoints with `pyannote/speaker-diarization-3.1`). Adds operator config burden.
- **Option C:** Two-shot endpoint with LiteLLM `pass_through_endpoints` per step (`/v1/audio/diarization-upload` and `/v1/audio/diarization-result`) and our route orchestrates. More code, marginal value.

**Recommendation:** Option A. Add this as a discuss-phase question for user lock if uncertainty remains; otherwise lock Option A in the plan with explicit note that diarization spend is not metered (already documented in CONTEXT/spec).

### Pattern 4: `litellm_config.contract.yaml` (CI mock variant)

```yaml
# Source: docs.litellm.ai/docs/proxy/reliability (mock_response in litellm_params)
model_list:
  - model_name: qwen3.5-plus
    litellm_params:
      model: openai/qwen3.5-plus  # provider doesn't matter for mocks
      api_key: "fake-key-for-mock"
      mock_response: |
        {"id":"chatcmpl-mock","object":"chat.completion","created":1000,"model":"qwen3.5-plus","choices":[{"index":0,"message":{"role":"assistant","content":"mocked reasoning"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}

  - model_name: whisper-1
    litellm_params:
      model: openai/whisper-1
      api_key: "fake-key-for-mock"
      mock_response: |
        {"text":"mocked transcript","language":"en","duration":1.0,"segments":[]}

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  # NO pass_through_endpoints in mock variant — diarization is hit via the
  # pass-through path which mock_response does NOT cover. Use a dedicated
  # in-Fastify mock for /api/diarization in contract-test profile (e.g.,
  # MOCK_PYANNOTE=true env on api service short-circuits to a fixed JSON).
```

[VERIFIED: docs.litellm.ai/docs/proxy/reliability — `mock_response` accepts a string; tests at api boundary parse as JSON]

### Anti-Patterns to Avoid

- **Embedding LiteLLM in the Node process** — polyglot deploy nightmare; CLAUDE.md §4 forbids.
- **Buffering full multipart audio into Node memory before forwarding** — kills 1000-concurrent SCALE-01; pipe `req.raw` straight through `undici` request body or use `@fastify/http-proxy`.
- **Inserting LiteLLM master key into desktop-facing responses** — desktop must always see opaque bearer (AUTH-03).
- **Using `mock_response` in production config** — contract-test profile only.
- **Polling `/spend/logs` HTTP** — locked OUT by D-02; PG co-tenant read only.
- **Per-user virtual key minting** — locked OUT by D-03.
- **Bundled local AI models / GPU images / HF token** — locked OUT by user.
- **DDL through PgBouncer transaction-mode** — `litellm` DB creation goes via init script direct to postgres:5432; same anti-pattern that the migrate runner refuses (existing CONTAINER-A1).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS reverse proxy with header injection | Custom `ws` server + upgrade hook | `@fastify/http-proxy` `wsUpstream` + `wsClientOptions.rewriteRequestHeaders` | Battle-tested; handles upgrade, frames, ping/pong, close codes |
| Multipart streaming forward | `req.pipe(remote)` + manual content-length tracking | `@fastify/multipart` `attachFieldsToBody: false` + `undici.request({body: req.raw})` OR `@fastify/http-proxy` for the route | Edge cases: large files, abort, content-type boundaries |
| Cron-style 30s scheduler | `setInterval` in-process | BullMQ Job Scheduler with `{ every: 30_000 }` | Survives restarts, multi-replica safe (one worker per scheduled job via Redis lock) |
| Per-user spend attribution | Custom keys table + mint endpoint | `user` body param → `LiteLLM_SpendLogs.end_user` | Native LiteLLM/OpenAI feature, zero storage |
| Spend-log ingest deduplication | Read-and-skip in app | Postgres `INSERT ... ON CONFLICT (request_id) DO NOTHING` (existing `usage_ledger_request_id_unique` index) | Atomic, idempotent across replicas |
| LiteLLM masking in tests | Custom HTTP mock server | LiteLLM `mock_response` in `litellm_params` | Tests run against real LiteLLM stack — exercises wire path end-to-end |
| Request-ID generation | Random in-route | Reuse existing pino `genReqId` (Fastify built-in); propagate via `x-litellm-spend-logs-metadata: {"openwhispr_request_id": "..."}` to LiteLLM | Single source of truth across logs/traces |

## Runtime State Inventory

> Phase 03 is greenfield (new routes, new services). No rename/refactor in scope.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — adds new tables (`LiteLLM_*` in separate `litellm` DB; `usage_ledger` already exists) | none |
| Live service config | None — adds new compose service `litellm` with config under git | none |
| OS-registered state | None | none |
| Secrets/env vars | NEW: `LITELLM_MASTER_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `PYANNOTE_API_KEY`, `LITELLM_BASE_URL` (override hint). Bootstrap.sh must generate `LITELLM_MASTER_KEY` like other secrets; provider keys remain placeholder for operator. | Update `tools/bootstrap.sh` + `.env.example` |
| Build artifacts | None — LiteLLM image pulled from registry; new package `apps/worker` introduces fresh dist | none |

## Common Pitfalls

### Pitfall 1: pyannote.ai's Two-Step Upload vs LiteLLM Single-Hop Pass-Through
**What goes wrong:** Naïve `pass_through_endpoints` config to `https://api.pyannote.ai/v1/diarize` fails because pyannote.ai requires a presigned-URL upload first.
**Why it happens:** LiteLLM pass-through forwards a single HTTP request; pyannote.ai wants two.
**How to avoid:** Per Pattern 3 above, use Option A — Fastify route calls pyannote.ai directly. Skip LiteLLM for diarization (already noted as unmetered in LITELLM-07).
**Warning signs:** 4xx from pyannote.ai with `{"detail":"Invalid url"}` body.

### Pitfall 2: Postgres `CREATE DATABASE` Cannot Run in Drizzle Migration
**What goes wrong:** Adding `CREATE DATABASE litellm` to `drizzle-kit` migration fails — drizzle wraps every migration in a transaction; `CREATE DATABASE` is not transactional.
**Why it happens:** Postgres restriction.
**How to avoid:** Use `/docker-entrypoint-initdb.d/` shell script (Pattern 2). Document upgrade path for existing volumes via `make litellm-init-db`.
**Warning signs:** `ERROR: CREATE DATABASE cannot run inside a transaction block`.

### Pitfall 3: First-Init-Only Init Script Skipped on Existing Volumes
**What goes wrong:** Operators upgrading from Phase 2 already have a populated `postgres_data` volume; init scripts only run when volume is empty. New `litellm` DB never created → LiteLLM crashes on boot.
**Why it happens:** Postgres entrypoint contract.
**How to avoid:** (a) Migrate runner could detect missing `litellm` DB and create it via direct connection to postgres:5432 (NOT pgbouncer) before LiteLLM starts. (b) Operations doc has explicit one-shot `make litellm-init-db` target. **Recommend (a)** — automated, no operator action.
**Warning signs:** LiteLLM container exits with `database "litellm" does not exist`.

### Pitfall 4: BullMQ Repeatable Jobs API Deprecated v5.16+
**What goes wrong:** Following old tutorials uses `addJob({}, { repeat: { every: 30000 } })` — deprecated.
**Why it happens:** BullMQ v5.16 introduced Job Schedulers as the canonical API.
**How to avoid:** Use `queue.upsertJobScheduler('ingest-litellm-spend', { every: 30_000 }, { name: 'ingest', data: {} })` [VERIFIED: docs.bullmq.io/guide/job-schedulers]
**Warning signs:** Deprecation warning in logs.

### Pitfall 5: Multipart Body Buffering in Fastify Handler Defeats Streaming
**What goes wrong:** `await req.file()` reads entire upload into memory before forwarding → OOM with large audio + 1000 concurrent.
**Why it happens:** Default `@fastify/multipart` parses + buffers fields.
**How to avoid:** Either (a) use `@fastify/http-proxy` to mount the route as a proxy (no body parsing in API), or (b) `app.register(multipart, { attachFieldsToBody: false })` and stream `await req.file()` `.file` (Readable) into `undici` `request` body.
**Warning signs:** API memory grows linearly with active uploads; long-tail latency.

### Pitfall 6: `request_id` Mismatch Between API Logs and LiteLLM Spend Logs
**What goes wrong:** Our API generates request_id X; LiteLLM auto-generates request_id Y; usage_ledger ingestion can't correlate.
**Why it happens:** LiteLLM auto-generates `request_id` (Prisma `@id` String) UNLESS we pass our own.
**How to avoid:** Either (a) inject `x-litellm-spend-logs-metadata: {"openwhispr_request_id": "<id>"}` header — LiteLLM stores in `metadata` JSON column, ingestion job extracts; (b) attempt to set `request_id` directly via `litellm_metadata.request_id` body param (verify in plan-time spike). Recommend (a) — official documented header. [CITED: docs.litellm.ai/docs/proxy/request_headers]
**Warning signs:** `usage_ledger.request_id` doesn't match Fastify access log request id.

### Pitfall 7: WSS Upgrade Loses Authorization Header
**What goes wrong:** Browser/WS clients can't always set custom `Authorization` headers on WS upgrade; Traefik may strip or mangle.
**Why it happens:** Browser WebSocket API has no header customization. Desktop client uses Node `ws` so headers work, but Traefik must forward them.
**How to avoid:** Verify Traefik `forwardingTimeouts.readTimeout/writeTimeout = 3600s` (already needed). Set `wsClientOptions.rewriteRequestHeaders` in Fastify to inject upstream `Authorization: Bearer ${LITELLM_MASTER_KEY}` regardless of incoming. Auth via Fastify `preHandler` runs before upgrade — ensure dual-auth hook works on WS routes too (Fastify treats WS as a normal route with `wsHandler`/proxy).
**Warning signs:** WS connection opens then immediately closes with 1008 from LiteLLM (auth fail).

### Pitfall 8: 503-vs-401 Envelope Confusion on Missing API Key
**What goes wrong:** When `OPENROUTER_API_KEY` is unset, LiteLLM returns 401 from the upstream (OpenRouter rejects); we surface 401 to desktop → desktop logs out user.
**Why it happens:** WIRE-18 contract: 401 means session expired.
**How to avoid:** API route's pre-call check: if required env unset → 503 envelope `{"error":"OPENROUTER_API_KEY is not configured. Set it in .env to enable /api/reason."}`. Plan should add a startup-time presence-check too (warning log on missing keys).
**Warning signs:** Desktop suddenly signs out users when LLM calls fail.

### Pitfall 9: PgBouncer Transaction-Mode + cross-DB Query
**What goes wrong:** Worker uses pgbouncer pool (transaction-mode) and tries `SELECT FROM litellm.LiteLLM_SpendLogs` — fails (PgBouncer pool maps to one DB only).
**Why it happens:** PgBouncer pools are per-database.
**How to avoid:** Worker creates a SECOND `pg.Pool` connecting DIRECTLY to postgres:5432 (NOT pgbouncer) for the `litellm` database read. The owner connection already does direct in migrate runner — same pattern.
**Warning signs:** `ERROR: cross-database references are not implemented` or PgBouncer errors.

## Code Examples

### Example 1: Fastify wsUpstream config for /v1/realtime

```typescript
// Source: github.com/fastify/fastify-http-proxy README (verified)
// apps/api/src/routes/realtime.ts

import fastifyHttpProxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';

export async function buildRealtimeRoutes(app: FastifyInstance, opts: {
  litellmBaseUrl: string;       // e.g. http://litellm:4000
  litellmMasterKey: string;
}): Promise<void> {
  await app.register(fastifyHttpProxy, {
    upstream: opts.litellmBaseUrl,                  // REST upstream (unused for this mount)
    wsUpstream: opts.litellmBaseUrl.replace(/^http/, 'ws'),
    prefix: '/v1/realtime',
    rewritePrefix: '/v1/realtime',
    websocket: true,
    wsClientOptions: {
      rewriteRequestHeaders: (headers, request) => ({
        ...headers,
        // Strip desktop's opaque bearer; inject LiteLLM master key.
        authorization: `Bearer ${opts.litellmMasterKey}`,
        // request_id propagation
        'x-litellm-spend-logs-metadata': JSON.stringify({
          openwhispr_request_id: request.id,
          openwhispr_user_id: (request as any).user?.id ?? 'anonymous',
        }),
      }),
    },
    preHandler: async (req, _reply) => {
      // Existing dualAuthHook attaches req.user; if not present → 401
      if (!(req as any).user) throw new Error('unauthorized');
      // Append ?user=<userId> so LiteLLM stores end_user in spend logs
      const url = new URL(req.url, 'http://internal');
      url.searchParams.set('user', (req as any).user.id);
      req.raw.url = url.pathname + url.search;
    },
  });
}
```

### Example 2: /api/transcribe multipart streaming forward

```typescript
// Source: pattern derived from @fastify/multipart streaming + undici
// apps/api/src/routes/transcribe.ts

import { request as undiciRequest } from 'undici';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTenant } from '@openwhispr/data';
import { usageLedger } from '@openwhispr/data/schema';

export async function buildTranscribeRoutes(app: FastifyInstance, opts: { ... }) {
  app.route({
    method: 'POST',
    url: '/api/transcribe',
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      if (!process.env.OPENAI_API_KEY) {
        return reply.code(503).send({ error: 'OPENAI_API_KEY is not configured. Set it in .env to enable /api/transcribe.' });
      }
      const userId = req.user!.id;
      const tenantId = req.tenant!;

      // Forward multipart untouched. We mount @fastify/http-proxy on the
      // route OR call undici with req.raw piped — second option lets us
      // also do post-call ledger insert in same handler.
      const { statusCode, body } = await undiciRequest(`${opts.litellmBaseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        body: req.raw,                                    // streamed, not buffered
        headers: {
          authorization: `Bearer ${opts.litellmMasterKey}`,
          'content-type': req.headers['content-type'] ?? '',
          'x-litellm-end-user-id': userId,
          'x-litellm-spend-logs-metadata': JSON.stringify({ openwhispr_request_id: req.id }),
        },
      });
      const upstream = await body.json() as {
        text: string; duration?: number; language?: string; segments?: unknown[];
      };

      // DATA-03: idempotent ledger insert. Worker also writes from spend
      // logs but app-side write is ALSO idempotent — first writer wins.
      const minutes = Math.ceil((upstream.duration ?? 0) / 60);
      await withTenant(opts.db, tenantId, async (tx) => {
        await tx.execute(
          `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
           VALUES ($1, $2, $3, 'transcribe_minutes', $4)
           ON CONFLICT (request_id) DO NOTHING`,
          [tenantId, userId, req.id, minutes],
        );
      });

      // WIRE-05 response shape (limitReached always false in v1)
      return reply.code(statusCode).send({
        text: upstream.text,
        wordsUsed: minutes,           // mirrors `units` for ledger correlation
        wordsRemaining: 999_999_999,  // unlimited in v1
        plan: 'unlimited',
        limitReached: false,
        sttProvider: 'openai',
        sttModel: 'whisper-1',
        language: upstream.language,
        duration: upstream.duration,
        segments: upstream.segments,
      });
    },
  });
}
```

### Example 3: BullMQ spend-ingest job

```typescript
// Source: docs.bullmq.io/guide/job-schedulers (verified)
// apps/worker/src/jobs/ingest-litellm-spend.ts

import { Queue, Worker } from 'bullmq';
import { Pool } from 'pg';

const litellmDb = new Pool({
  connectionString: process.env.LITELLM_READ_DATABASE_URL, // direct postgres:5432, NOT pgbouncer
});
const appOwnerDb = new Pool({
  connectionString: process.env.DATABASE_URL_OWNER,        // direct postgres:5432
});

const QUEUE_NAME = 'litellm-spend-ingest';
const connection = { host: 'valkey', port: 6379, password: process.env.VALKEY_PASSWORD };

export const queue = new Queue(QUEUE_NAME, { connection });

// One Job Scheduler per worker boot — BullMQ deduplicates by scheduler key.
export async function ensureScheduler() {
  await queue.upsertJobScheduler(
    'ingest-litellm-spend',
    { every: 30_000 },
    { name: 'ingest', data: {} },
  );
}

export const worker = new Worker(QUEUE_NAME, async () => {
  // Watermark in Redis (or in app DB; choose one — Redis for simplicity).
  const watermarkKey = 'litellm:spend:last_start_time';
  const since = (await connection.client?.get?.(watermarkKey)) ?? new Date(Date.now() - 5 * 60_000).toISOString();
  const { rows } = await litellmDb.query(`
    SELECT request_id, "end_user", spend, total_tokens, model, "startTime", metadata
    FROM "LiteLLM_SpendLogs"
    WHERE "startTime" > $1
    ORDER BY "startTime" ASC
    LIMIT 1000
  `, [since]);

  for (const r of rows) {
    // Extract our request_id from the metadata JSON we injected (Pitfall #6).
    const ourRid = r.metadata?.openwhispr_request_id ?? r.request_id;
    const userId = r.end_user; // already our userId per D-03
    const tenantId = await resolveTenantForUser(userId);
    const kind = inferKind(r.model);  // 'reason_tokens' | 'transcribe_minutes' | ...
    const units = kind === 'reason_tokens' ? r.total_tokens : Math.ceil((r.metadata?.duration ?? 0) / 60);
    await appOwnerDb.query(`
      INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (request_id) DO NOTHING
    `, [tenantId, userId, ourRid, kind, units]);
  }

  if (rows.length > 0) {
    await connection.client?.set?.(watermarkKey, rows[rows.length - 1].startTime);
  }
}, { connection });

// Graceful shutdown — required by CLAUDE.md operational discipline
process.on('SIGTERM', async () => {
  await worker.close();           // finishes in-flight job, refuses new
  await litellmDb.end();
  await appOwnerDb.end();
});
```

[VERIFIED: docs.bullmq.io/guide/workers/graceful-shutdown]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LiteLLM v1.82.x (multipart pass-through 500 bug) | LiteLLM **v1.83.7-stable+** (fix native, PR #25464) | 2026 (fix in v1.83.7) | Delete `patches/fix_passthrough_multipart.py` if it ever existed; pin to `v1.83.14-stable` |
| Per-user virtual key minting via `/key/generate` | OpenAI-compatible `user` body param + `LiteLLM_SpendLogs.end_user` | always available; just newly-recommended | Zero storage, zero rotation logic |
| `BullMQ.add({ repeat: { every: ... } })` | `queue.upsertJobScheduler(...)` | BullMQ v5.16+ | Cleaner API, single canonical surface |
| `node-fetch` for outbound | `undici.request` (or globalThis.fetch) | Node 18+ | Native, faster, streams support |

**Deprecated/outdated:**
- LiteLLM "Repeatable" jobs API in BullMQ — superseded by Job Schedulers
- LiteLLM `mock_response` as `Exception(...)` Python (Python SDK only) — YAML uses string

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LiteLLM `pass_through_endpoints` cannot orchestrate pyannote.ai's two-step upload flow → recommend Option A (Fastify-direct) | Pattern 3 / Pitfall 1 | If wrong, we lose LiteLLM spend metering on diarization (already accepted in LITELLM-07); no major impact |
| A2 | BullMQ Job Schedulers API (`upsertJobScheduler`) is the v5.16+ canonical surface | Pattern + code example | If wrong, fall back to documented `repeat` option; functionality identical |
| A3 | Postgres init scripts only run on first init (empty volume) — existing-volume operators need a one-shot helper | Pattern 2 / Pitfall 3 | Verified [CITED: docker-library/postgres docs]; recommendation to auto-create from migrate runner is the safe default |
| A4 | LiteLLM stores `x-litellm-spend-logs-metadata` JSON in the `metadata` column of `LiteLLM_SpendLogs` | Pitfall 6 / Example 3 | If wrong, planner spike at plan time; alternative: write our own request_id into a dedicated metadata field via `litellm_metadata.request_id` body param |
| A5 | OpenAI Whisper response shape includes `duration` field for word-count derivation | Example 2 / WIRE-05 wire shape | OpenAI Whisper does return `duration` in verbose-json response_format; in default JSON only `text`. May need to request `response_format=verbose_json` or compute server-side |
| A6 | `wordsUsed` in WIRE-05 schema is minutes-of-audio, not actual word count | Example 2 / WIRE-05 wire shape | Spec says ledger kind is `transcribe_minutes`; field name is misleading from upstream. Plan should confirm by inspecting upstream `BACKEND_SPEC.md` desktop expectations |
| A7 | `apps/worker/` as new package is preferred over in-`apps/api` entry point | Architecture Patterns | Either works; new package aligns with Phase 6 worker decomposition |
| A8 | OpenRouter `qwen/qwen-3.5-plus-02-15` is the current OpenRouter model identifier | Pattern 3 | Verify at plan-time via `curl https://openrouter.ai/api/v1/models` |

**Total assumptions:** 8 — all bounded; planner / discuss-phase should confirm A1, A4, A5, A6 before locking implementation details.

## Open Questions

1. **A1 — pyannote.ai integration shape.**
   - What we know: pyannote.ai requires two-step (presigned URL → upload → diarize); LiteLLM `pass_through_endpoints` is single-hop.
   - What's unclear: Whether the user prefers Option A (Fastify-direct, no LiteLLM metering) or Option C (two LiteLLM pass-throughs orchestrated by Fastify).
   - Recommendation: Lock Option A in plan; raise as discuss point if planner uncertain.

2. **A4 — request_id propagation mechanism.**
   - What we know: LiteLLM accepts `x-litellm-spend-logs-metadata` JSON header [CITED: docs.litellm.ai/docs/proxy/request_headers].
   - What's unclear: Exact column where it lands (`metadata` JSON vs dedicated). Verified column list shows `metadata Json?` exists.
   - Recommendation: Plan-time spike — POST a chat completion with the header, query `LiteLLM_SpendLogs.metadata`, confirm shape. Adjust extraction logic accordingly. Wave 0 task.

3. **A5/A6 — `wordsUsed` semantics in WIRE-05.**
   - What we know: WIRE-05 schema field is `wordsUsed`; ledger kind is `transcribe_minutes`. Mismatch.
   - What's unclear: Whether desktop expects literal word count or minutes-of-audio.
   - Recommendation: Spike — read `/Users/nick/openwhispr/docs/BACKEND_SPEC.md` (1556 lines, mentioned in CLAUDE.md as authoritative) to confirm; planner extracts the canonical schema. If unable, default to minutes (matches ledger kind) and document.

4. **Diarization wire shape for `/api/diarization`.**
   - What we know: pyannote.ai returns `{jobId, status, output: {segments: [...]}}` async (poll for completion).
   - What's unclear: Whether desktop expects sync response or async polling. ROADMAP only lists `/v1/audio/diarization` as exposed; `/api/diarization` is not in WIRE-XX list.
   - Recommendation: Diarization may be exposed as `/v1/audio/diarization` only (raw passthrough), not `/api/diarization`. Plan should confirm whether a top-level `/api/diarization` is part of v1 wire surface or not. If not, scope it to `/v1/audio/diarization` mount via Fastify.

5. **OpenRouter model lineup beyond qwen3.5-plus.**
   - What we know: D-06 sets default; CONTEXT doesn't lock other aliases.
   - Recommendation: Plan with `qwen3.5-plus` (default) + 1-2 more aliases (claude-opus, gpt-5) for desktop's model-picker. Operator can edit `litellm_config.yaml` for more.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker / docker-compose | All compose work | ✓ (existing) | per Phase 1 | — |
| Postgres 17 | LiteLLM DB + worker reads | ✓ (existing service) | 17.5-alpine | — |
| Valkey 8 | BullMQ | ✓ (existing service) | 8.1-alpine | — |
| Traefik 3 | TLS + WS upgrade | ✓ (existing service) | v3.6 | — |
| Network: ghcr.io | Pull `litellm:main-v1.83.14-stable` | Assumed (CI uses GHA-hosted runners with internet); first contributor pull may need DOCKER_HUB_TOKEN if rate-limited | — | — |
| OPENROUTER_API_KEY | Default LLM | ✗ (operator-supplied) | — | 503 envelope on `/api/reason` |
| OPENAI_API_KEY | Default STT | ✗ (operator-supplied) | — | 503 envelope on `/api/transcribe` |
| PYANNOTE_API_KEY | Default diarization | ✗ (operator-supplied) | — | 503 envelope on `/api/diarization` |

**Missing dependencies with no fallback:** None blocking — all real-API keys gated by 503 envelope; CI uses mock_response variant.

**Missing dependencies with fallback:** All three provider keys — fallback is well-defined 503 envelope.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (already configured in repo, per Phase 0) |
| Config file | `vitest.config.ts` per package; `packages/contract-tests/vitest.config.ts` for contract suite |
| Quick run command | `pnpm --filter <pkg> test` |
| Full suite command | `make test` (runs every package's vitest), `make contract-test` (runs HTTP contract suite against compose stack) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE-05 | `POST /api/transcribe` returns documented JSON shape; multipart streamed; ledger row written | contract | `make contract-test PROFILE=mock` then `make e2e-test` for real STT | ❌ Wave 0 — `packages/contract-tests/src/transcribe.test.ts` |
| WIRE-05 | Multipart not buffered (large file < 100MB streams) | integration | `pnpm --filter @openwhispr/api test src/routes/transcribe.test.ts` | ❌ Wave 0 |
| WIRE-06 | `POST /api/reason` returns `{text, model, provider, promptMode, matchType}`; default model qwen3.5-plus | contract | `make contract-test PROFILE=mock` | ❌ Wave 0 — `packages/contract-tests/src/reason.test.ts` |
| WIRE-06 | `user` parameter forwarded; LiteLLM_SpendLogs.end_user populated (E2E only) | E2E | `make e2e-test` | ❌ Wave 0 |
| LITELLM-01 | LiteLLM container healthy (`/health/liveliness` 200) | smoke | `docker compose ps litellm` + curl | ❌ Wave 0 — `tests/self-tests/litellm-up.test.ts` |
| LITELLM-02 | Bundled config wires to OpenRouter/OpenAI/pyannote (config parses, models registered) | unit | `pnpm --filter @openwhispr/api test src/__tests__/litellm-config.test.ts` (yaml.parse + assert model_list shape) | ❌ Wave 0 |
| LITELLM-02 | Missing key → 503 envelope (NOT 401) | contract | `make contract-test` with `OPENROUTER_API_KEY=""` profile | ❌ Wave 0 |
| LITELLM-03 | All three audio routes reachable; 3600s timeout configured on Traefik for `/v1/realtime` | integration + smoke | dedicated test + traefik dynamic-config inspection | ❌ Wave 0 |
| LITELLM-04 | `user` body param injected; verifiable in LiteLLM_SpendLogs (E2E) | integration + E2E | `apps/api/src/routes/reason.test.ts` (asserts undici body contains `user`) + E2E SQL probe | ❌ Wave 0 |
| LITELLM-05 | `LITELLM_BASE_URL` override path documented + Fastify reads env | unit | `apps/api/src/lib/litellm-config.test.ts` | ❌ Wave 0 |
| LITELLM-06 | `docs/litellm-target-spec.md` exists with required sections | docs lint | `tools/lint-docs-headings.ts` (extend) | ❌ Wave 0 |
| LITELLM-07 | Spend-ingest job populates `usage_ledger` from `LiteLLM_SpendLogs` idempotently | integration (testcontainers) | `pnpm --filter @openwhispr/worker test src/jobs/ingest-litellm-spend.test.ts` | ❌ Wave 0 |
| LITELLM-07 | Job is idempotent (run twice → same row count) | integration | same file, second test | ❌ Wave 0 |
| PROVIDER-01 | All AI traffic flows through single LiteLLM endpoint (env override → all routes follow) | integration | `apps/api/src/routes/__tests__/litellm-base-url-override.test.ts` | ❌ Wave 0 |
| DATA-03 | `usage_ledger.request_id` UNIQUE — duplicate insert fails / ON CONFLICT no-op | integration | `packages/data/src/__tests__/usage-ledger-idempotency.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter <touched-pkg> test` (vitest watch mode locally; full vitest in CI)
- **Per wave merge:** `make test && make contract-test` (full vitest + HTTP contract suite against compose mock-LiteLLM)
- **Phase gate:** `make test && make contract-test && make e2e-test` (E2E with real keys from `.env.e2e` provided by user) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/contract-tests/src/transcribe.test.ts` — covers WIRE-05
- [ ] `packages/contract-tests/src/reason.test.ts` — covers WIRE-06
- [ ] `packages/contract-tests/src/diarization.test.ts` — covers `/v1/audio/diarization` (or `/api/diarization`)
- [ ] `packages/contract-tests/src/realtime.test.ts` — WSS smoke (handshake only in mock mode)
- [ ] `apps/api/src/routes/transcribe.test.ts` — unit + integration with mock LiteLLM
- [ ] `apps/api/src/routes/reason.test.ts` — same
- [ ] `apps/api/src/routes/diarization.test.ts` — same
- [ ] `apps/api/src/routes/realtime.test.ts` — same (WS preHandler header injection)
- [ ] `apps/api/src/lib/litellm-config.test.ts` — env override + 503 envelope
- [ ] `apps/worker/src/jobs/ingest-litellm-spend.test.ts` — testcontainer Postgres + Valkey
- [ ] `packages/data/src/__tests__/usage-ledger-idempotency.test.ts` — DATA-03 ON CONFLICT
- [ ] `packages/contract-tests/src/schemas.ts` — extend with `TranscribeRequest`, `TranscribeResponse`, `ReasonRequest`, `ReasonResponse` zod schemas (single source of truth)
- [ ] `tests/fixtures/audio/sample-1s.wav` — small WAV fixture for multipart tests
- [ ] `compose/litellm/litellm_config.contract.yaml` — mock_response variant
- [ ] `Makefile` — add `e2e-test` target
- [ ] CI workflow extension: `.github/workflows/ci.yml` add `e2e-test` job (manual / nightly trigger, gated on `secrets.OPENROUTER_API_KEY` presence)

## Sources

### Primary (HIGH confidence)
- [LiteLLM v1.83.7-stable release notes](https://docs.litellm.ai/release_notes/v1.83.7/v1-83-7-stable) — multipart fix native, PR #25464
- [LiteLLM v1.83.14-stable release notes](https://docs.litellm.ai/release_notes/v1.83.14/v1-83-14) — current latest stable
- [LiteLLM Customers / End-Users docs](https://docs.litellm.ai/docs/proxy/customers) — `user` body param + `x-litellm-end-user-id` header → `end_user` column
- [LiteLLM Pass-through endpoints docs](https://docs.litellm.ai/docs/proxy/pass_through) — config shape verified
- [LiteLLM Request headers docs](https://docs.litellm.ai/docs/proxy/request_headers) — `x-litellm-spend-logs-metadata` JSON header
- [LiteLLM Realtime docs](https://docs.litellm.ai/docs/realtime) — model_list realtime mode + WSS
- [LiteLLM Reliability / mock_response](https://docs.litellm.ai/docs/proxy/reliability) — mock_response in litellm_params
- [LiteLLM schema.prisma](https://github.com/BerriAI/litellm/blob/main/schema.prisma) — `LiteLLM_SpendLogs` columns verified
- [@fastify/http-proxy README](https://github.com/fastify/fastify-http-proxy) — `wsUpstream`, `wsClientOptions.rewriteRequestHeaders`, Fastify 5 compat
- [BullMQ Job Schedulers docs](https://docs.bullmq.io/guide/job-schedulers) — `upsertJobScheduler`, `every: 30000`
- [BullMQ Graceful shutdown docs](https://docs.bullmq.io/guide/workers/graceful-shutdown) — `worker.close()` on SIGTERM
- [pyannote.ai API reference — diarize](https://docs.pyannote.ai/api-reference/diarize) — endpoint shape
- [pyannote.ai API reference — upload media](https://docs.pyannote.ai/api-reference/upload-media) — two-step flow confirmed
- [OpenRouter Qwen3.5-plus model page](https://openrouter.ai/qwen/qwen3.5-plus-02-15) — model identifier verified

### Secondary (MEDIUM confidence)
- [docker-library/postgres issue #151](https://github.com/docker-library/postgres/issues/151) — multi-database init script pattern
- [LiteLLM Spend Tracking docs](https://docs.litellm.ai/docs/proxy/cost_tracking) — verified end_user attribution
- [LiteLLM db_info docs](https://docs.litellm.ai/docs/proxy/db_info) — DB tables overview

### Tertiary (LOW confidence)
- None — all critical claims verified against primary sources.

## Metadata

**Confidence breakdown:**
- LiteLLM stack + version pin: HIGH — release notes + container registry verified
- `LiteLLM_SpendLogs` schema: HIGH — Prisma schema fetched directly
- Pass-through endpoints config: HIGH — official docs verified
- pyannote.ai two-step flow: HIGH — official docs verified, integration approach (Option A) is recommendation, locked by user only after discuss
- `request_id` propagation: MEDIUM — header documented; exact column-storage shape needs plan-time spike
- BullMQ Job Scheduler API: HIGH — docs.bullmq.io verified
- Fastify wsUpstream: HIGH — README verified
- WIRE-05 `wordsUsed` semantics: LOW — needs `BACKEND_SPEC.md` cross-reference at plan time

**Research date:** 2026-05-10
**Valid until:** 2026-06-10 (30 days; LiteLLM ships weekly minors but v1.83.x line stable; revalidate model identifiers and image tag at plan time)

## RESEARCH COMPLETE

Ready for planning. Six items recommended for plan-time spikes / Wave 0 verification:
1. Lock pyannote.ai integration choice (recommend Option A — Fastify-direct).
2. Spike LiteLLM `x-litellm-spend-logs-metadata` storage shape against running container.
3. Cross-reference `BACKEND_SPEC.md` for `wordsUsed` semantics on `/api/transcribe`.
4. Confirm `/api/diarization` vs `/v1/audio/diarization` mount point in v1 wire surface.
5. Verify OpenRouter model identifiers at plan-time (`curl https://openrouter.ai/api/v1/models`).
6. Decide `apps/worker/` package vs `apps/api` second-entry-point (recommend new package).
