# LiteLLM Target Spec — Bundled Default + Corporate Override

**Status:** Operator-facing reference. Closes LITELLM-05 (corporate-override env path) and LITELLM-06 (bundled-default reference). Aligns with Phase 03 plan decisions D-06/D-07 REVISED/D-10/D-11/D-12.

**Audience:** operators evaluating, deploying, or migrating an OpenWhispr Server installation.

**Companion docs:**

- `docs/wire-contracts-phase-3.md` — desktop wire shape (`/api/transcribe`, `/api/reason`, `/v1/audio/diarization`, `WSS /v1/realtime`).
- `docs/litellm-mock-mode.md` — hermetic contract-test mock mode (this plan).
- `speaches-audio.md` — the canonical corporate operator example (Speaches CUDA + internal pyannote, 3600s realtime ingress timeouts).

This document is **English-only** per CLAUDE.md.

---

## Topologies

OpenWhispr Server supports two LiteLLM topologies. Both serve the same wire shape to the desktop client; the difference is where AI inference physically runs.

### A. Bundled-default (out of the box)

```
desktop ──HTTPS──▶ Traefik ──▶ api (Fastify) ──▶ litellm (sidecar) ──▶ public providers
                                       │                              (OpenRouter, Groq,
                                       │                               OpenAI Realtime)
                                       └──▶ pyannote.ai (4-step async, NOT via LiteLLM)
```

- `git clone && docker compose up` runs the full stack.
- `compose/litellm/litellm_config.yaml` is mounted into the bundled `litellm` container.
- Operator opens `.env`, pastes provider keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `PYANNOTE_API_KEY`); missing keys produce a 503 envelope (or a close-with-error WSS upgrade for missing `OPENAI_API_KEY`).
- Diarization is special-cased: the Fastify route in the api container talks to pyannote.ai directly because pyannote's cloud API is async-by-design (4 steps). LiteLLM `pass_through_endpoints` cannot orchestrate the upload → diarize → poll cycle. See "Diarization (Sync-Wrapper Pattern)" below.

### B. Corporate-override (point at an internal LiteLLM Proxy)

```
desktop ──HTTPS──▶ Traefik ──▶ api (Fastify) ──▶ corporate LiteLLM Proxy
                                       │                  ▲
                                       │                  │ LITELLM_BASE_URL
                                       │                  │ LITELLM_MASTER_KEY
                                       │             (e.g. https://litellm.corp.example.com)
                                       │                  │
                                       │                  ▼
                                       │           Speaches CUDA + internal pyannote
                                       │           (`speaches-audio.md` reference setup)
                                       └──▶ pyannote.ai (still bundled Fastify route in v1)
```

- Operator sets `LITELLM_BASE_URL=https://litellm.corp.example.com` and `LITELLM_MASTER_KEY=<their-master-key>` in `.env`.
- Bundled `litellm` container can be disabled (`docker compose --profile default up -d --scale litellm=0` or by removing it from a compose override).
- Models (chat, transcription, realtime) are served by the corporate proxy under whichever names operators configure. The api container does not assume specific aliases.
- `speaches-audio.md` is the canonical corporate example (Speaches CUDA image, internal pyannote nginx pass-through, 3600s realtime ingress timeouts).
- Diarization in v1: the bundled Fastify route in the api container still handles `/v1/audio/diarization` regardless of `LITELLM_BASE_URL`. Corporate operators with a single-hop pyannote-compatible endpoint behind their own LiteLLM may register `pass_through_endpoints` for `/v1/audio/diarization` in their override config; a future config flag (`OPENWHISPR_DIARIZATION_VIA_LITELLM=true`) will allow corporate operators to bypass the Fastify wrapper and let LiteLLM forward — tracked as a v2 extension. See "Diarization (Sync-Wrapper Pattern)" below.

---

## Bundled-Default Configuration

The bundled `litellm` container mounts `compose/litellm/litellm_config.yaml` (Plan 01). Excerpt:

```yaml
model_list:
  - model_name: qwen3.6-plus            # D-06: default reasoning model
    litellm_params:
      model: openrouter/qwen/qwen-3.6-plus
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: gpt-4o-mini             # D-10: light reasoning fallback
    litellm_params:
      model: openrouter/openai/gpt-4o-mini
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: whisper-large-v3        # D-11: STT via Groq (fastest hosted Whisper)
    litellm_params:
      model: groq/whisper-large-v3
      api_key: os.environ/GROQ_API_KEY
  - model_name: gpt-realtime            # D-12: OpenAI Realtime API direct
    litellm_params:
      model: openai/gpt-realtime
      api_key: os.environ/OPENAI_API_KEY
      mode: realtime
```

**Operator setup**:

1. `cp .env.example .env` and run `tools/bootstrap.sh` (replaces secret PLACEHOLDERs).
2. Paste real provider keys into `.env`:
   - `OPENROUTER_API_KEY` — chat/reason models (D-06/D-10).
   - `GROQ_API_KEY` — Whisper-large-v3 STT (D-11).
   - `OPENAI_API_KEY` — Realtime WSS upstream (D-12).
   - `PYANNOTE_API_KEY` — diarization (D-07 REVISED — consumed by the Fastify route, NOT the LiteLLM container).
3. `docker compose --profile default up -d --wait`.

Missing keys are not fatal at boot but produce 503 envelopes when the corresponding endpoint is hit (see error matrices in `docs/wire-contracts-phase-3.md`). Realtime WSS upgrades close with an error frame when `OPENAI_API_KEY` is unset.

---

## Corporate-Override Configuration

`speaches-audio.md` is the canonical corporate setup: an internal LiteLLM Proxy fronts Speaches CUDA (Whisper, faster-whisper, realtime) and an internal pyannote service. Operators run that stack independently, then point OpenWhispr Server at it.

**Operator setup**:

1. Run an internal LiteLLM Proxy (`v1.83.7-stable+`) reachable at e.g. `https://litellm.corp.example.com`. Configure model aliases your stack serves (Speaches `whisper-large-v3`, internal `gpt-realtime` equivalent, etc.).
2. In OpenWhispr Server `.env`:
   - `LITELLM_BASE_URL=https://litellm.corp.example.com`
   - `LITELLM_MASTER_KEY=<corporate-master-key>`
3. Disable the bundled `litellm` container (one of):
   - `docker compose --profile default up -d --scale litellm=0`
   - Compose override that removes the `litellm` service.
4. Bring the rest of the stack up: `docker compose --profile default up -d --wait`.

**Notes**:

- The api container forwards every chat/transcription/realtime request to whatever URL `LITELLM_BASE_URL` resolves to. No code change required (LITELLM-05).
- Provider keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`) are only consumed by the bundled LiteLLM container; in corporate-override mode the corporate proxy holds its own credentials.
- `PYANNOTE_API_KEY` remains consumed by the Fastify diarization route (D-07 REVISED) regardless of `LITELLM_BASE_URL`. Corporate operators may register `pass_through_endpoints` for `/v1/audio/diarization` in their own LiteLLM config; the `OPENWHISPR_DIARIZATION_VIA_LITELLM=true` flag to bypass the bundled Fastify wrapper is a v2 extension.
- Realtime WSS over corporate LiteLLM: ensure ingress idle timeouts ≥ 3600s (Speaches reference setup uses exactly this — see `speaches-audio.md` nginx blocks).

---

## Request ID Propagation

Every desktop request carries an internal `request_id` string that the api routes generate (UUID v4). The api forwards the value to LiteLLM via the documented `x-litellm-spend-logs-metadata` header so spend logs can be reconciled back to OpenWhispr usage.

```
desktop → api (Fastify generates request_id)
       → litellm (header: x-litellm-spend-logs-metadata: {"openwhispr_request_id":"<uuid>"})
       → provider (OpenRouter / Groq / OpenAI)
       ⤴ spend log row written by LiteLLM with metadata column = {"openwhispr_request_id":"<uuid>", ...}
```

The BullMQ ingest worker (Plan 08) reads `metadata->>'openwhispr_request_id'` from `LiteLLM_SpendLogs` and writes idempotent `usage_ledger` rows keyed on `request_id`. Plan 02's spike confirmed the JSONB shape end-to-end (Postgres co-tenant read, `ON CONFLICT (request_id) DO NOTHING`).

The same `request_id` is also written inline by `/api/transcribe` (Plan 04) and `/api/reason` (Plan 05). Either writer wins under DATA-03 ("first writer wins") because the `usage_ledger.request_id` UNIQUE constraint is the contract; the metadata header is the optimization.

---

## Env Override Path

| Env var                       | Bundled-default source                                                        | Corporate-override source                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `LITELLM_BASE_URL`            | unset → defaults to `http://litellm:4000` (compose service DNS)               | `https://litellm.corp.example.com` (operator-supplied)                          |
| `LITELLM_MASTER_KEY`          | bootstrap-generated; auth between Fastify api and the bundled LiteLLM         | corporate master key (operator-supplied; NEVER exposed to desktop)              |
| `LITELLM_DATABASE_URL`        | DIRECT `postgres:5432/litellm` (auto-created by migrate runner — Plan 01)     | corporate proxy holds its own DB; this var is unused                            |
| `OPENROUTER_API_KEY`          | operator-supplied real key OR contract-test mock                              | corporate proxy holds the credential; this var unused on api side               |
| `GROQ_API_KEY`                | operator-supplied real key (D-11 Whisper-large-v3 STT)                        | corporate proxy holds it                                                        |
| `OPENAI_API_KEY`              | operator-supplied real key (D-12 Realtime WSS direct)                         | corporate proxy holds it                                                        |
| `PYANNOTE_API_KEY`            | operator-supplied real key — **consumed by Fastify diarization route (D-07 REVISED), NOT by the LiteLLM container** | same — bundled Fastify route still handles diarization in v1; v2 will allow corporate operators to bypass via `OPENWHISPR_DIARIZATION_VIA_LITELLM=true` |
| `LITELLM_DEFAULT_CHAT_MODEL`  | `qwen3.6-plus` (D-06)                                                         | operator picks corporate alias                                                  |
| `LITELLM_READ_DATABASE_URL`   | optional — defaults to the same DIRECT `postgres:5432` URL the migrate runner uses; lets the worker target a read replica | corporate proxy DB; usually unused (worker reads bundled DB only)               |

**Corporate-override is `LITELLM_BASE_URL` plus `LITELLM_MASTER_KEY` only.** Every other LiteLLM-related var is either inherited from `.env.example` defaults or unused on the api side when the bundled container is disabled.

---

## Diarization (Sync-Wrapper Pattern)

**D-07 REVISED, 2026-05-10:** Bundled mode does **NOT** use LiteLLM for diarization. The Fastify route `apps/api/src/routes/diarization.ts` (Plan 06) implements a sync-wrapper over pyannote.ai's 4-step async API. This section documents the operator-visible behavior and the rationale.

### Why NOT via LiteLLM

pyannote.ai cloud is async-by-design (verified live 2026-05-10). LiteLLM `pass_through_endpoints` forwards a single HTTP request and cannot orchestrate the upload → diarize → poll cycle. Replicate cold-start (30–90s) and HuggingFace Inference (unstable) were evaluated and rejected. The Fastify sync-wrapper is ~150 LOC of route handler — minimal complexity vs architectural compromise. `compose/litellm/litellm_config.yaml` deliberately omits a pyannote `pass_through_endpoints` entry (a single grep against the config and the api package confirms this — see Plan 06 SUMMARY "Grep evidence" section).

### 4-step async flow (server-side orchestration)

1. **Authentication & idempotency**. Bearer/cookie auth via the dual-auth-hook. `Idempotency-Key` header (Stripe pattern); fallback to `SHA-256(file)`. Lookup in Valkey under `diar:idem:<key>` with **24h TTL**. Same key + same body hash → reuse cached `jobId`; same key + different hash → 409 Conflict.
2. **Step 1 — `POST /v1/media/input`**. Get presigned PUT URL + `media://` reference.
3. **Step 2 — `PUT <presigned_url>`**. Upload binary audio.
4. **Step 3 — `POST /v1/diarize {url: media://...}`**. Submit diarization job, receive `jobId`. Bind `jobId` to idempotency cache entry.
5. **Step 4 — `GET /v1/jobs/{jobId}`**. Poll every **1500ms** with **5-minute (300_000ms) ceiling**.
6. **Client disconnect**. `request.raw.on('close')` triggers `AbortController.abort()` — poll loop exits early; pyannote job continues server-side; idempotency cache retains `jobId` so client retries are cheap (skip submit, jump straight to poll).
7. **Per-route Fastify config**. `connectionTimeout: 360_000` (6min, 1min slack over poll ceiling) — does NOT affect global 120s default for other routes.

### Status code matrix

| Status | When                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Job succeeded within 5-minute ceiling — body = `{duration, segments[]}` (Speaches sync wire-shape, desktop client unchanged)                                                                          |
| 400    | Malformed multipart, missing file field, file > 100 MB                                                                                                                                                |
| 409    | `Idempotency-Key` reused with conflicting body hash (Stripe semantics)                                                                                                                                |
| 502    | Pyannote returned `failed` or `cancelled`                                                                                                                                                             |
| 503    | `PYANNOTE_API_KEY` missing (operator-actionable message) OR pyannote 5xx unreachable (`Retry-After: 30`) OR pyannote 401/403 auth error (NEVER surfaces as 401 to desktop per Pitfall #8 — would otherwise sign out users) |
| 504    | Exceeded 5-minute ceiling — body includes `jobId` hint for manual retrieval; suggests corporate LiteLLM override + Speaches for files > 5 min                                                         |

### Spend metering

Diarization is **unmetered** in v1 (LITELLM-07 acknowledgment). The Fastify route writes nothing to `usage_ledger`. v2 may add cost mirroring from a separate `pyannote_usage_log` table or webhook-event-driven ledger inserts.

### Migration path for v2 (Phase 5+)

Webhook delivery + Valkey pub/sub will replace polling — pyannote.ai supports webhook callbacks. Drop-in handler swap when public webhook ingress + HMAC verification land. Status code matrix and wire shape unchanged.

### Corporate operators

If your internal pyannote endpoint is single-hop (POST multipart → 200 segments), you may add `pass_through_endpoints` for `/v1/audio/diarization` in your own LiteLLM override config and route via `LITELLM_BASE_URL`. The bundled Fastify route currently always handles diarization; the future `OPENWHISPR_DIARIZATION_VIA_LITELLM=true` flag (v2) will let corporate operators bypass the Fastify wrapper and let LiteLLM forward.

---

## Realtime WSS Topology

```
desktop ──WSS──▶ Traefik (idle 3600s) ──▶ api (Fastify wsUpstream) ──▶ litellm
       (Authorization: Bearer <opaque>)                              │
                                                                     ▼
                                                         OpenAI Realtime API
                                                  (wss://api.openai.com/v1/realtime
                                                          ?model=gpt-realtime,
                                                   LiteLLM `mode: realtime`)
```

- **Default backend (D-12):** OpenAI Realtime API direct via LiteLLM `mode: realtime`. Default model alias `gpt-realtime` (GA). Aliases shipped in `compose/litellm/litellm_config.yaml`: `gpt-realtime`, `gpt-realtime-mini`, `gpt-4o-realtime-preview` (legacy).
- **Pricing reminder:** OpenAI Realtime is `$0.06/min` audio in + `$0.24/min` audio out (operator-visible cost; surface via Grafana usage dashboards).
- **Opaque-bearer preserved.** The desktop bearer is the OpenWhispr session token (validated by Better Auth on upgrade). Neither `LITELLM_MASTER_KEY` nor `OPENAI_API_KEY` is exposed to the desktop — LiteLLM injects upstream credentials server-side.
- **Ingress timeouts.** Traefik `forwardingTimeouts.idleConnTimeout` and `routerTransport.respondingTimeouts.idleTimeout` are both 3600s on the realtime route (Plan 07). Shorter timeouts cause spurious mid-session disconnects on long dictations (`BACKEND_SPEC.md:L788-L791`).
- **Corporate override.** Set `LITELLM_BASE_URL` to your internal proxy serving `gpt-realtime` (Speaches realtime, Azure OpenAI realtime, etc.). Wire shape on the desktop side is identical.

---

## Spend Log Ingestion

The BullMQ Job Scheduler in `apps/worker` (Plan 08) reconciles LiteLLM spend logs into OpenWhispr's `usage_ledger`:

- **Cadence:** every 30s (`upsertJobScheduler` with `every: 30_000`).
- **Source:** DIRECT Postgres read on `litellm.LiteLLM_SpendLogs` (Pitfall #9 — never via PgBouncer; cross-DB read needs the `current_database` to remain stable across statements).
- **Watermark:** Valkey key `litellm:spend:last_start_time`. Cold start scans `WHERE startTime > now - 5 min`. Steady state advances after each successful batch (replay-safe — partial-batch crash re-scans the window and `ON CONFLICT DO NOTHING` absorbs duplicates).
- **Idempotency:** `usage_ledger.request_id UNIQUE` is the contract. The worker resolves `request_id = metadata->>'openwhispr_request_id'` first, falling back to LiteLLM's own `request_id` column.
- **Pass-through endpoints unmetered (LITELLM-07 acknowledgment).** Diarization is also unmetered in v1 — its Fastify route does not write to `LiteLLM_SpendLogs` at all (per D-07 REVISED, the bundled diarization path bypasses LiteLLM entirely).
- **Kind inference:** `whisper > realtime > default` priority (`apps/worker/src/lib/infer-kind.ts`). Unknown aliases fall back to `reason_tokens`; documented as a clearly visible miscount rather than a silent billing corruption.

---

## Migration Path from Phase 2 (HIGH-1 fix)

Operators upgrading from Phase 2 do **not** need any manual action. The `litellm` database is auto-created by the Drizzle migrate runner on every `docker compose up` (idempotent — see Plan 01 Task 2 step 1a). The `make clean-stack` target remains available as a development/test convenience for fully resetting a local stack but is **explicitly NOT REQUIRED** for upgrades and **explicitly NOT RECOMMENDED** for production operators (it destroys all postgres data).

Zero-action migration: `git pull && docker compose up -d` is sufficient — the migrate service ensures the litellm database exists before LiteLLM starts.

---

*Last updated: 2026-05-10 (Phase 03 Plan 09 — D-06 / D-07 REVISED / D-10 / D-11 / D-12).*
