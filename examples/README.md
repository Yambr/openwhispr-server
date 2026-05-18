# OpenWhispr Server — operator quickstarts

This directory documents the operator variants OpenWhispr ships and provides
copy-paste quickstart blocks for each. Variant A is the default OSS entry
point; Variants B and C trade defaults for specific corporate / GPU local
scenarios.

## Variant matrix

| Variant | Compose entrypoint | Chart values overlay | AI plane | When to pick |
|---|---|---|---|---|
| **A** | `compose/docker-compose.embedded-litellm.yml` | `charts/openwhispr/examples/values-embedded-litellm.yaml` | Embedded LiteLLM Proxy, hosted providers via `.env` keys (OpenRouter / OpenAI) | Default OSS self-host. No GPU; relies on hosted APIs. |
| **B** | `docker-compose.external-litellm.yml` | `charts/openwhispr/examples/values-external-litellm.yaml` (canonical; `values-corporate-litellm.yaml` retained as deprecated alias) | External corporate LiteLLM (Bedrock proxy, vLLM, internal gateway) | Enterprise operator pointing at an existing on-prem LiteLLM. |
| **C** | Variant A overlay + Speaches container (Plan 11-03) | values overlay with `bundledAi.enabled=true` | Embedded LiteLLM + local Speaches (gated pyannote weights) | GPU-equipped operators wanting fully-offline transcription + diarization. |

## Quick start — Variant A

Variant A is the canonical OSS quickstart. It ships an embedded LiteLLM Proxy
pre-wired to the OpenRouter + OpenAI provider catalog and never references
HF_TOKEN. A fresh clone runs in two steps:

### Docker Compose path

```bash
cp .env.embedded.example .env
# edit .env — populate every REPLACE_ME (see comments for provenance pointers)
docker compose -f compose/docker-compose.embedded-litellm.yml up --wait
# https://api.localhost serves the api + web stack via Traefik
```

The compose file boots: api, web, worker, migrate, postgres, pgbouncer,
valkey, minio, traefik, otel-collector, grafana, loki, tempo, mimir, the
embedded LiteLLM, plus mailpit as a dev SMTP catch-all (operators with a
real SMTP relay set `SMTP_HOST=` in `.env` to bypass mailpit silently).

### Helm / kind / cloud path

```bash
helm install openwhispr ./charts/openwhispr \
  -f ./charts/openwhispr/examples/values-embedded-litellm.yaml \
  --set-string secrets.litellmMasterKey="$LITELLM_MASTER_KEY" \
  --set-string secrets.openrouterApiKey="$OPENROUTER_API_KEY" \
  --set-string secrets.openaiApiKey="$OPENAI_API_KEY" \
  --set-string secrets.postgresOwnerPassword="$POSTGRES_OWNER_PASSWORD" \
  --set-string secrets.postgresAppPassword="$POSTGRES_APP_PASSWORD" \
  --set-string secrets.pgbouncerAdminPassword="$PGBOUNCER_ADMIN_PASSWORD" \
  --set-string secrets.betterAuthSecret="$BETTER_AUTH_SECRET" \
  --set-string secrets.valkeyPassword="$VALKEY_PASSWORD" \
  --set-string secrets.minioRootPassword="$MINIO_ROOT_PASSWORD" \
  --set-string secrets.traefikAdminPassword="$TRAEFIK_ADMIN_PASSWORD" \
  --set-string secrets.grafanaAdminPassword="$GRAFANA_ADMIN_PASSWORD" \
  --set-string secrets.masterKek="$MASTER_KEK" \
  --set-string secrets.backupAgeIdentity="$BACKUP_AGE_IDENTITY"
```

The chart's secrets template enforces every key at render time — empty
values fail the install fast (DEPLOY-03 / T-09-01).

### Variant A is HF_TOKEN-free

The chart helper `openwhispr.requiredSecretKeys` only appends `HF_TOKEN`
when `bundledAi.enabled=true`. Variant A leaves that flag at its baked-in
`false`, so:

- the rendered Secret omits the `HF_TOKEN` stringData key;
- the ExternalSecret omits the `HF_TOKEN` data ref (ESO mode);
- the `secret-presence-probe` initContainer never checks for HF_TOKEN.

Upgrade safety is verified empirically by the kind-cluster upgrade test
authored in Plan 11-05 (asserts that operators upgrading from a pre-11
chart with a populated HF_TOKEN value do not lose any of the other 12
required keys when the new chart drops HF_TOKEN from the required list).

## Quick start — Variant B (external/corporate LiteLLM)

Variant B is for enterprise operators with an existing internal LiteLLM
Proxy (Bedrock proxy, vLLM gateway, in-house LiteLLM, etc.). The
OpenWhispr server brings up api + web + worker + infra (postgres +
valkey + migrate) WITHOUT a bundled LiteLLM service — every model call
routes to your corporate LiteLLM via `LITELLM_BASE_URL`.

### Docker Compose path

```bash
cp .env.external.example .env
# edit .env — at minimum set LITELLM_BASE_URL to the corporate LiteLLM
# URL (e.g. https://litellm.corp.internal/) and LITELLM_VIRTUAL_KEY if
# the corporate proxy requires per-tenant virtual keys per
# docs/litellm-target-spec.md §2.
docker compose -f docker-compose.external-litellm.yml up -d --wait
# https://api.localhost serves the api + web stack via Traefik
```

### Helm / kind / cloud path

```bash
helm install openwhispr ./charts/openwhispr \
  -f ./charts/openwhispr/examples/values-external-litellm.yaml \
  --set litellm.externalBaseUrl=https://litellm.corp.internal/
```

The `litellm.embedded: false` toggle in the values overlay
short-circuits both `Deployment/openwhispr-litellm` AND
`Service/openwhispr-litellm` render — verified by helm-unittest
negative-render assertions in
`charts/openwhispr/tests/corporate_litellm_test.yaml`. The
`bundledAi.enabled: false` toggle (also set in the overlay) further
strips `HF_TOKEN` from the ExternalSecret data block since corporate
operators do NOT run local pyannote weights.

The corporate LiteLLM MUST honour the wire contract documented in
`docs/litellm-target-spec.md` (model alias namespace, virtual-key
auth, spend-logs metadata, streaming-passthrough headers).

## Quick start — Variant C (local Speaches, GPU operators)

Variant C is for operators who want fully self-contained transcription
+ diarization with no third-party Whisper API in the loop. It layers a
Speaches service (built from upstream master per Phase 08.6 so the
diarization router is present) on top of Variant A's embedded
LiteLLM, then rewires the `whisper-large-v3` and `pyannote-3.1`
LiteLLM aliases to point at `http://speaches:8000` inside the docker
network.

> ⚠️ **GPU strongly recommended.** First boot downloads ~3 GB of
> weights (Whisper + pyannote). CPU inference works for development —
> Whisper-large-v3 runs at ~0.5 RTF on a recent M-class chip — but is
> NOT suitable for the 1000-concurrent-user production SLO. GPU
> operators set `SPEACHES_BASE_IMAGE=nvidia/cuda:12.6.3-base-ubuntu24.04`
> in `.env` AND install nvidia-container-runtime on the host BEFORE
> `docker compose up --wait`.
>
> ⚠️ **HF_TOKEN required.** The pyannote diarization model is gated;
> the Speaches container refuses to start without HF_TOKEN. Request a
> token at https://huggingface.co/settings/tokens with `read` access to
> `pyannote/speaker-diarization-community-1`. Operators who only need
> transcription should use Variant A (hosted Whisper API) instead.

### Docker Compose path

```bash
cp .env.local-speaches.example .env
# edit .env — set HF_TOKEN (required) plus the Variant A keys
# (LITELLM_MASTER_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY,
#  BETTER_AUTH_SECRET, MASTER_KEK, postgres + valkey passwords)
docker compose \
  -f compose/docker-compose.embedded-litellm.yml \
  -f examples/docker-compose.local-speaches.yml \
  up -d --wait
# First boot pulls + builds the Speaches master image (~10 min) AND
# downloads ~3 GB of weights — be patient. The healthcheck has a
# 600 s start_period for this reason.
```

### Helm / kind / cloud path

```bash
helm install openwhispr ./charts/openwhispr \
  -f ./charts/openwhispr/examples/values-local-speaches.yaml \
  --set bundledAi.speaches.image=speaches/speaches:master-cuda-12.6.3
# GPU operators MUST install the NVIDIA device plugin on the cluster
# (helm install nvidia-device-plugin nvidia/k8s-device-plugin) BEFORE
# scheduling the Speaches workload; the chart's resource requests
# include nvidia.com/gpu: 1 when bundledAi.speaches.image carries the
# cuda tag.
```

## See also

- `charts/openwhispr/examples/` — every chart overlay (Variant A/B/C, kind
  smoke, cloud-HA, cert-manager / Traefik install overlays).
- `docs/self-hosting.md` — long-form operator guide covering networking,
  ingress, secrets rotation, and observability.
- `docs/operations.md` — day-2 runbook (upgrades, backups, troubleshooting).
