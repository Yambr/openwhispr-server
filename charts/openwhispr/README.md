# openwhispr Helm chart

> Pairs with the [OpenWhispr desktop client](https://github.com/Yambr/openwhispr) — signed builds at [releases](https://github.com/Yambr/openwhispr/releases). Pairing guide: [`docs/client.md`](../../docs/client.md).

Production-grade Helm chart for OpenWhispr Server. Wraps the 18-service compose
stack into a single chart suitable for fresh `kind` clusters, single-node
self-host installs, and multi-AZ HA production clusters.

This chart is built and verified in Phase 9 of the OpenWhispr roadmap. Wave 0
(this commit) ships the skeleton: `Chart.yaml`, `values.yaml`,
`values.schema.json`, `_helpers.tpl`, `NOTES.txt`, ServiceAccount, the two
secrets paths (helm-values + ESO), example overlays, and helm-lint CI.
Subsequent waves add the data plane (CNPG Cluster, Pooler, Valkey, MinIO),
app plane (api/web/worker/litellm/migrate), and ingress + observability
(IngressRoute, cert-manager Certificate, OTel Collector DaemonSet).

## Cluster prerequisites

The chart is intentionally NOT a kitchen-sink umbrella. The following must be
installed out-of-band, in the order listed:

1. **CloudNativePG operator** — provides the `Cluster`, `Pooler`, and
   `ImageCatalog` CRDs. Install one-line with `examples/cnpg-install.sh`.
2. **Traefik 3** — must be configured with two TLS entrypoints,
   `websecure :443` (short-JSON) and `websecure-realtime :8443` (long-WSS).
   Reference values in `examples/traefik-values.yaml`. Phase 04 Plan 05
   locked this two-entrypoint topology to prevent slow-WSS DoS bleed.
3. **cert-manager** — provides the `Certificate` CRD. Install with the
   official one-liner (see cert-manager docs).
4. **(Optional) LGTM stack** — Loki + Grafana + Tempo + Mimir for
   observability. Per A3 the chart does NOT embed these. Install with
   `examples/lgtm-install.sh` for greenfield clusters.
5. **(Optional) External Secrets Operator** — required only if you set
   `secrets.mode=eso`. Install per the upstream ESO docs.

## Secrets posture (A1)

`values.yaml` exposes a `secrets.mode` flag:

- `helm-values` (default) — chart renders an inline `Secret` resource from
  the 8 required values. Render-time `fail` gates refuse to install when any
  required key is empty or set to a placeholder string (`CHANGE_ME`). The
  `values.schema.json` enforces `minLength: 32` defense-in-depth. The Secret
  gets `helm.sh/resource-policy: keep` so it survives `helm uninstall` (per
  T-09-09 — prevents Better Auth secret regression on upgrade).
- `eso` — chart renders an `ExternalSecret` referencing your `SecretStore`
  (Vault, AWS Secrets Manager, Azure KV, GCP Secret Manager). Render-time
  fail gates and inline Secret are SKIPPED (per pitfall #5 — helm fail
  evaluates BEFORE ESO syncs). Refuse-to-start enforcement instead runs as a
  pod-start initContainer in Plan 09-06.

The 8 required keys:

| Values key                  | Pod env var               |
|----------------------------|---------------------------|
| `litellmMasterKey`         | `LITELLM_MASTER_KEY`      |
| `openrouterApiKey`         | `OPENROUTER_API_KEY`      |
| `openaiApiKey`             | `OPENAI_API_KEY`          |
| `pyannoteApiKey`           | `PYANNOTE_API_KEY`        |
| `hfToken`                  | `HF_TOKEN`                |
| `postgresOwnerPassword`    | `POSTGRES_OWNER_PASSWORD` |
| `pgbouncerAdminPassword`   | `PGBOUNCER_ADMIN_PASSWORD`|
| `betterAuthSecret`         | `BETTER_AUTH_SECRET`      |

## Install (OSS quickstart)

```bash
# 1. Cluster prereqs (one-time).
charts/openwhispr/examples/cnpg-install.sh

# 2. Install the chart.
helm install ow charts/openwhispr \
  -f charts/openwhispr/examples/values-oss-quickstart.yaml \
  --set-string secrets.litellmMasterKey=$(openssl rand -base64 32) \
  --set-string secrets.openrouterApiKey=sk-or-... \
  --set-string secrets.openaiApiKey=sk-... \
  --set-string secrets.pyannoteApiKey=pyn-... \
  --set-string secrets.hfToken=hf_... \
  --set-string secrets.postgresOwnerPassword=$(openssl rand -base64 32) \
  --set-string secrets.pgbouncerAdminPassword=$(openssl rand -base64 32) \
  --set-string secrets.betterAuthSecret=$(openssl rand -base64 32) \
  --wait --timeout 10m

# 3. Run the first-launch SLO probe (Wave 4).
helm test ow --timeout 5m
```

## Install (corporate, ESO mode)

```bash
helm install ow charts/openwhispr \
  -f charts/openwhispr/examples/values-corporate-litellm.yaml \
  --set secrets.mode=eso \
  --set secrets.external.storeRef=vault-clusterstore \
  --set-string api.env.LITELLM_BASE_URL=https://litellm.internal/ \
  --wait --timeout 10m
```

## CI gates

| Gate                                | Workflow                              |
|-------------------------------------|---------------------------------------|
| `helm lint` + `helm-unittest`       | `.github/workflows/helm-lint.yml`     |
| Compose ↔ chart parity              | `.github/workflows/helm-lint.yml`     |
| Squawk migration linter             | `.github/workflows/lint-migrations.yml` |
| `kind` upgrade matrix N-1 → N       | `.github/workflows/helm-upgrade-matrix.yml` (Wave 4) |
| Release publish (chart-releaser)    | `.github/workflows/helm-release.yml` (Wave 4) |

## Hard constraints (Phase 9)

- **Postgres 17 only.** `values.schema.json` rejects any `postgres.imageName`
  that does not match `:17.<minor>`. CNPG 1.29's default catalog ships PG 18;
  silent major-version drift is the #1 chart pitfall.
- **No `Ingress` resources** — Traefik `IngressRoute` CRs only.
  ingress-nginx is EOL March 2026 (STACK.md hard rule).
- **HTTPS only** — no plaintext entrypoints. `Certificate` CR is mandatory.
- **Bundled-AI off by default** — `bundledAi.enabled=false` to prevent CI
  pods pending on missing GPU nodes.
