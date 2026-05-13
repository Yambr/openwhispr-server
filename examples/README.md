# OpenWhispr Server — operator quickstarts

This directory documents the operator variants OpenWhispr ships and provides
copy-paste quickstart blocks for each. Variant A is the default OSS entry
point; Variants B and C trade defaults for specific corporate / GPU local
scenarios.

## Variant matrix

| Variant | Compose entrypoint | Chart values overlay | AI plane | When to pick |
|---|---|---|---|---|
| **A** | `docker-compose.embedded-litellm.yml` | `charts/openwhispr/examples/values-embedded-litellm.yaml` | Embedded LiteLLM Proxy, hosted providers via `.env` keys (OpenRouter / OpenAI) | Default OSS self-host. No GPU; relies on hosted APIs. |
| **B** | base `docker-compose.yml` with `LITELLM_BASE_URL=` override | `charts/openwhispr/examples/values-corporate-litellm.yaml` | External corporate LiteLLM (Bedrock proxy, vLLM, internal gateway) | Enterprise operator pointing at an existing on-prem LiteLLM. |
| **C** | Variant A overlay + Speaches container (Plan 11-03) | values overlay with `bundledAi.enabled=true` | Embedded LiteLLM + local Speaches (gated pyannote weights) | GPU-equipped operators wanting fully-offline transcription + diarization. |

## Quick start — Variant A

Variant A is the canonical OSS quickstart. It ships an embedded LiteLLM Proxy
pre-wired to the OpenRouter + OpenAI provider catalog and never references
HF_TOKEN. A fresh clone runs in two steps:

### Docker Compose path

```bash
cp .env.embedded.example .env
# edit .env — populate every REPLACE_ME (see comments for provenance pointers)
docker compose -f docker-compose.embedded-litellm.yml up --wait
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

## See also

- `charts/openwhispr/examples/` — every chart overlay (Variant A/B/C, kind
  smoke, cloud-HA, cert-manager / Traefik install overlays).
- `docs/self-hosting.md` — long-form operator guide covering networking,
  ingress, secrets rotation, and observability.
- `docs/operations.md` — day-2 runbook (upgrades, backups, troubleshooting).
