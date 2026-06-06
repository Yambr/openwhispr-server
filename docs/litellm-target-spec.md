# LiteLLM Target Spec — Bundled Default + Corporate Override

**Status:** Operator-facing reference. Closes LITELLM-05 (corporate-override env path) and LITELLM-06 (bundled-default reference). Aligns with Phase 03 plan decisions D-06/D-07 REVISED/D-10/D-11/D-12.

**Audience:** operators evaluating, deploying, or migrating an OpenWhispr Server installation.

**Companion docs:**

- `docs/wire-contracts-phase-3.md` — desktop wire shape (`/api/transcribe`, `/api/reason`, `WSS /v1/realtime`).
- `docs/litellm-mock-mode.md` — hermetic contract-test mock mode (this plan).
- `speaches-audio.md` — the canonical corporate operator example (Speaches CUDA, 3600s realtime ingress timeouts).

This document is **English-only** per CLAUDE.md.

---

## Topologies

OpenWhispr Server supports two LiteLLM topologies. Both serve the same wire shape to the desktop client; the difference is where AI inference physically runs.

### A. Bundled-default (out of the box)

```
desktop ──HTTPS──▶ Traefik ──▶ api (Fastify) ──▶ litellm (sidecar) ──▶ public providers
                                                                      (OpenRouter, Groq,
                                                                       OpenAI Realtime)
```

- `git clone && docker compose up` runs the full stack.
- `compose/litellm/litellm_config.yaml` is mounted into the bundled `litellm` container.
- Operator opens `.env`, pastes provider keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`); missing keys produce a 503 envelope (or a close-with-error WSS upgrade for missing `OPENAI_API_KEY`).

### B. Corporate-override (point at an internal LiteLLM Proxy)

```
desktop ──HTTPS──▶ Traefik ──▶ api (Fastify) ──▶ corporate LiteLLM Proxy
                                                          ▲
                                                          │ LITELLM_BASE_URL
                                                          │ LITELLM_MASTER_KEY
                                                     (e.g. https://litellm.corp.example.com)
                                                          │
                                                          ▼
                                                   Speaches CUDA
                                                   (`speaches-audio.md` reference setup)
```

- Operator sets `LITELLM_BASE_URL=https://litellm.corp.example.com` and `LITELLM_MASTER_KEY=<their-master-key>` in `.env`. Note: `LITELLM_MASTER_KEY` is enforced at boot — see `docs/security.md` §13 (`validateLitellmBoot`). Missing / empty / set to the well-known dev-overlay default exits 78 in production.
- Bundled `litellm` container can be disabled (`docker compose --profile default up -d --scale litellm=0` or by removing it from a compose override).
- Models (chat, transcription, realtime) are served by the corporate proxy under whichever names operators configure. The api container does not assume specific aliases.
- `speaches-audio.md` is the canonical corporate example (Speaches CUDA image, 3600s realtime ingress timeouts).

---

## Bundled-Default Configuration

The bundled `litellm` container mounts `compose/litellm/litellm_config.yaml` (Plan 01). Excerpt:

```yaml
model_list:
  - model_name: qwen3.6-plus            # D-06: default reasoning model
    litellm_params:
      model: openrouter/qwen/qwen3.6-plus
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: gemini-3-flash          # alternate reasoning model
    litellm_params:
      model: openrouter/google/gemini-3.1-flash-lite
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: gpt-4o-mini             # D-10: light reasoning fallback
    litellm_params:
      model: openrouter/openai/gpt-4o-mini
      api_key: os.environ/OPENROUTER_API_KEY
  - model_name: qwen3.6-cleanup         # R33: fast dictation-cleanup model
    litellm_params:
      model: openrouter/qwen/qwen3.6-35b-a3b
      api_key: os.environ/OPENROUTER_API_KEY
      api_base: os.environ/REASONING_CLEANUP_API_BASE
  - model_name: whisper-large-v3        # D-11: STT via Groq (fastest hosted Whisper)
    litellm_params:
      model: groq/whisper-large-v3
      api_base: https://api.groq.com/openai/v1
      api_key: os.environ/GROQ_API_KEY
  - model_name: realtime-default        # D-12: OpenAI Realtime API direct
    litellm_params:
      model: openai/gpt-realtime
      api_key: os.environ/OPENAI_API_KEY
      mode: realtime
```

The full catalog also registers backward-compat realtime aliases
(`gpt-realtime`, `gpt-realtime-mini`, `gpt-4o-realtime-preview`) for
older desktop builds that still send an explicit `?model=`.

**Operator setup**:

1. `cp .env.embedded.example .env` and run `tools/bootstrap.sh` (replaces secret PLACEHOLDERs).
2. Paste real provider keys into `.env`:
   - `OPENROUTER_API_KEY` — chat/reason models (D-06/D-10).
   - `GROQ_API_KEY` — Whisper-large-v3 STT (D-11).
   - `OPENAI_API_KEY` — Realtime WSS upstream (D-12).
3. `docker compose --profile default up -d --wait`.

Missing keys are not fatal at boot but produce 503 envelopes when the corresponding endpoint is hit (see error matrices in `docs/wire-contracts-phase-3.md`). Realtime WSS upgrades close with an error frame when `OPENAI_API_KEY` is unset.

---

## Corporate-Override Configuration

`speaches-audio.md` is the canonical corporate setup: an internal LiteLLM Proxy fronts Speaches CUDA (Whisper, faster-whisper, realtime). Operators run that stack independently, then point OpenWhispr Server at it.

**Operator setup**:

1. Run an internal LiteLLM Proxy (`v1.83.7-stable+`) reachable at e.g. `https://litellm.corp.example.com`. Configure model aliases your stack serves (Speaches `whisper-large-v3`, internal `gpt-realtime` equivalent, etc.).
2. In OpenWhispr Server `.env` (start from `cp .env.full.example .env` — its
   `LITELLM_BASE_URL` block documents the corporate-override path):
   - `LITELLM_BASE_URL=https://litellm.corp.example.com`
   - `LITELLM_MASTER_KEY=<corporate-master-key>`
3. Disable the bundled `litellm` container (one of):
   - `docker compose --profile default up -d --scale litellm=0`
   - Compose override that removes the `litellm` service.
4. Bring the rest of the stack up: `docker compose --profile default up -d --wait`.

**Notes**:

- The api container forwards every chat/transcription/realtime request to whatever URL `LITELLM_BASE_URL` resolves to. No code change required (LITELLM-05).
- Provider keys (`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`) are only consumed by the bundled LiteLLM container; in corporate-override mode the corporate proxy holds its own credentials.
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
| `LITELLM_DEFAULT_CHAT_MODEL`  | `qwen3.6-plus` (D-06)                                                         | operator picks corporate alias                                                  |
| `LITELLM_READ_DATABASE_URL`   | optional — defaults to the same DIRECT `postgres:5432` URL the migrate runner uses; lets the worker target a read replica | corporate proxy DB; usually unused (worker reads bundled DB only)               |

**Corporate-override is `LITELLM_BASE_URL` plus `LITELLM_MASTER_KEY` only.** Every other LiteLLM-related var is either inherited from `.env.full.example` defaults or unused on the api side when the bundled container is disabled.

---

## Diarization — REMOVED (client-local)

**Quick 260606-g90:** the server no longer exposes a diarization route.
Diarization is client-local — the OpenWhispr desktop performs speaker
splitting offline with sherpa-onnx, and no client flow called the former
`/v1/audio/diarization` route. This section previously documented a Fastify
sync-wrapper over pyannote.ai's async API; that route, its pyannote client,
the idempotency cache, and the `PYANNOTE_API_KEY` / `SPEACHES_DIARIZATION_*`
env vars have all been removed. Corporate operators who want server-side
diarization would add it as a fresh pass-through in their own LiteLLM config;
the bundled server ships no such surface.

---

## Realtime WSS Topology

```
desktop ──WSS──▶ Traefik (idle 3600s) ──▶ api (Fastify wsUpstream) ──▶ litellm
       (Authorization: Bearer <opaque>,                              │
        NO ?model= — server injects it)        api forces             ▼
                                          ?model=realtime-default  OpenAI Realtime API
                                          ?user=<userId>      (wss://api.openai.com/v1/realtime
                                                                      ?model=gpt-realtime,
                                                               LiteLLM `mode: realtime`)
```

- **Server-injected model alias (D1).** LiteLLM routes `/v1/realtime` on the `?model=` query parameter, NOT the in-band `session.update` frame. The api (`apps/api/src/routes/realtime.ts`) **forces** `?model=<LITELLM_REALTIME_MODEL>` (default `realtime-default`) onto the upstream-bound URL in the same preHandler that forces `?user=<userId>` — **overwriting whatever the desktop client sent (or omitted)**. The realtime model is therefore pure operator config: **the desktop client sends no model**, and OpenAI→Speaches is a one-line `litellm_config` retarget of the `realtime-default` alias with zero client change. The `LITELLM_REALTIME_MODEL` env var sets the alias; operators normally leave it at `realtime-default` and retarget the alias in `litellm_config.yaml` instead.
- **Default backend (D-12):** OpenAI Realtime API direct via LiteLLM `mode: realtime`. Default alias `realtime-default` → `openai/gpt-realtime` (GA). Extra aliases shipped in `compose/litellm/litellm_config.yaml` for backward compat with older desktop builds that still send an explicit `?model=`: `gpt-realtime`, `gpt-realtime-mini`, `gpt-4o-realtime-preview` (legacy).
- **Pricing reminder:** OpenAI Realtime is `$0.06/min` audio in + `$0.24/min` audio out (operator-visible cost; surface via Grafana usage dashboards).
- **Opaque-bearer preserved.** The desktop bearer is the OpenWhispr session token (validated by Better Auth on upgrade). Neither `LITELLM_MASTER_KEY` nor `OPENAI_API_KEY` is exposed to the desktop — LiteLLM injects upstream credentials server-side.
- **Ingress timeouts.** Traefik `forwardingTimeouts.idleConnTimeout` and `routerTransport.respondingTimeouts.idleTimeout` are both 3600s on the realtime route (Plan 07). Shorter timeouts cause spurious mid-session disconnects on long dictations (`BACKEND_SPEC.md:L788-L791`).
- **Corporate override.** Set `LITELLM_BASE_URL` to your internal proxy and point the `realtime-default` alias at your realtime upstream (Speaches realtime, Azure OpenAI realtime, etc.). Wire shape on the desktop side is identical — and unchanged regardless of which provider serves `realtime-default`.

---

## Spend Log Ingestion

The BullMQ Job Scheduler in `apps/worker` (Plan 08) reconciles LiteLLM spend logs into OpenWhispr's `usage_ledger`:

- **Cadence:** every 30s (`upsertJobScheduler` with `every: 30_000`).
- **Source:** DIRECT Postgres read on `litellm.LiteLLM_SpendLogs` (Pitfall #9 — never via PgBouncer; cross-DB read needs the `current_database` to remain stable across statements).
- **Watermark:** Valkey key `litellm:spend:last_start_time`. Cold start scans `WHERE startTime > now - 5 min`. Steady state advances after each successful batch (replay-safe — partial-batch crash re-scans the window and `ON CONFLICT DO NOTHING` absorbs duplicates).
- **Idempotency:** `usage_ledger.request_id UNIQUE` is the contract. The worker resolves `request_id = metadata->>'openwhispr_request_id'` first, falling back to LiteLLM's own `request_id` column.
- **Kind inference:** `whisper > realtime > default` priority (`apps/worker/src/lib/infer-kind.ts`). Unknown aliases fall back to `reason_tokens`; documented as a clearly visible miscount rather than a silent billing corruption.

---

## Migration Path from Phase 2 (HIGH-1 fix)

Operators upgrading from Phase 2 do **not** need any manual action. The `litellm` database is auto-created by the Drizzle migrate runner on every `docker compose up` (idempotent — see Plan 01 Task 2 step 1a). The `make clean-stack` target remains available as a development/test convenience for fully resetting a local stack but is **explicitly NOT REQUIRED** for upgrades and **explicitly NOT RECOMMENDED** for production operators (it destroys all postgres data).

Zero-action migration: `git pull && docker compose up -d` is sufficient — the migrate service ensures the litellm database exists before LiteLLM starts.

---

## Helm chart override (Phase 9 cross-reference)

The Helm chart at `charts/openwhispr/` exposes the corporate-override
path via the same env-var contract the docker-compose deployment
uses. The relevant `values.yaml` knobs:

```yaml
litellm:
  # Mode "external" disables the bundled litellm Deployment + Service
  # entirely. The api Deployment receives LITELLM_BASE_URL +
  # LITELLM_MASTER_KEY from the secrets block and routes upstream.
  mode: external                                    # "embedded" | "external"
  external:
    baseUrl: https://litellm.corp.example.com
    # masterKey is supplied via secrets.values.litellmMasterKey
    # (or ExternalSecret-resolved when secrets.mode=eso).

secrets:
  mode: values                                       # or "eso"
  values:
    litellmMasterKey: "<corp-issued master key>"     # Helm rejects placeholders
```

When `litellm.mode=external` the chart:

- skips rendering the `litellm` Deployment, Service, and PVC;
- omits the spend-log ingestion BullMQ scheduler (the bundled-ingest
  path scans the local `litellm.LiteLLM_SpendLogs` table; with
  external mode the corporate proxy emits its own ledger);
- adds a `litellm-preflight` init container on the api that
  validates `LITELLM_BASE_URL` is reachable + `LITELLM_MASTER_KEY`
  authenticates against `/health/liveliness` before the api pod
  starts.

The `values.schema.json` enforces that `external.baseUrl` is set when
`mode=external` and rejects `secrets.values.litellmMasterKey=""`
placeholders.

See [`operations.md` § Helm chart upgrade](./operations.md) for the
operator-side rollout flow and [`security.md`](./security.md) §3 for
the secret-loading model.

---

*Last updated: 2026-05-13 (Phase 10 Plan 10-03 — Helm cross-reference + i18n linkage).*
