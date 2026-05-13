# Phase 9: Helm Chart & Cloud Deploy — Research

**Researched:** 2026-05-13
**Domain:** Kubernetes packaging (Helm 3) + CloudNativePG operator + Traefik 3 + cert-manager + HPA + GitHub Container Registry release flow + online-migration discipline.
**Confidence:** HIGH for chart shape, service inventory, CNPG override, Traefik patterns, migration linting, GHCR/release flow. MEDIUM for HPA metric choice (cpu vs custom prometheus-adapter), secrets-management split (ESO mandatory vs optional). LOW for nothing critical — flagged areas are explicitly tagged below.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-01 | Single-host compose with full stack + profile to disable bundled LiteLLM. | Already mostly in `docker-compose.yml`; this phase only adds the `bundled-litellm` profile guard and the < 5 min quickstart verification path (DEPLOY-05 ties in). |
| DEPLOY-02 | Helm chart: CNPG HA Postgres, Traefik 3, HPA, cert-manager, OTel Collector DaemonSet, GPU node-selector, disable-bundled-AI option. | Entire chart skeleton documented below — sub-chart layout, CNPG Cluster spec, Traefik IngressRoute templates, HPA spec, GPU nodeSelector + tolerations. |
| DEPLOY-03 | One-command bootstrap (`make up` / `helm install`); one-command upgrade with safe rollback; refuse-to-start on default secrets. | Helm `required` template function + values-schema validation + ConfigMap "preflight" init-container documented below. |
| DEPLOY-04 | Migrations as pre-deploy job; safe under rolling deploy; backwards-compatible across one minor version; **upgrade-matrix CI test installs N-1 → upgrades to N**. | `helm.sh/hook: pre-install,pre-upgrade` Job pattern + `kind` upgrade-matrix workflow design documented below. Online-migration lint (`squawk`) gates PRs. |
| DEPLOY-05 | First-launch SLO: `git clone` → first authenticated `/api/transcribe` in **< 5 min**, CI-enforced. | `helm test` hook design + `kind`-based CI job documented below. Compose path is already < 5 min (Phase 0–8 validated); chart path needs equivalent verification. |

## Summary

Phase 9 wraps the existing 18-service `docker-compose.yml` into a production-grade Helm chart, `charts/openwhispr/`, that installs against a fresh Kubernetes cluster and converges to the same wire surface in under 5 minutes. The chart is a **single umbrella chart** with a small number of **upstream sub-charts** (Bitnami Valkey, MinIO operator-chart or Bitnami MinIO, optionally `cnpg-cluster` if we adopt the community wrapper) plus **first-party templates** for every OpenWhispr service (api, web, worker, litellm, migrate, traefik IngressRoutes, OTel Collector). HA Postgres comes from the **CloudNativePG operator (installed separately, cluster-wide)** referencing our chart's `Cluster` CR — this is the canonical CNPG pattern.

The chart shape is dictated by three constraints already baked into the compose stack: (1) **Postgres 17 only** — CNPG's default catalog ships PG 18, so we override via `imageCatalogRef` + `major: 17` or `imageName: ghcr.io/cloudnative-pg/postgresql:17.x-system-trixie` [VERIFIED: cloudnative-pg.io/docs/1.28/image_catalog/]; (2) **two TLS entrypoints** — `:443` short-JSON + `:8443` long-WSS realtime (Phase 04 Plan 05 lock-in) → mapped to two Traefik `IngressRoute` CRs on distinct `entryPoints`; (3) **bundled-AI opt-out** — a single `values.yaml` flag flips between bundled Whisper/pyannote/faster-whisper pods (with GPU nodeSelector) and pure passthrough to a corporate `LITELLM_BASE_URL`.

The phase is **medium-large in plan count** (10–13 plans across 3–4 waves; full breakdown at end of doc). Most of the chart is mechanical translation; the genuinely hard pieces are (a) the **CNPG Cluster spec with PG 17 override and WAL archive to MinIO/S3**, (b) the **`helm test` first-launch SLO hook**, (c) the **kind-cluster upgrade-matrix workflow in GHA**, and (d) the **`squawk` PR-gate lint** for online-safe migrations.

**Primary recommendation:** ship `charts/openwhispr/` as a single umbrella chart that bundles compose-equivalent first-party templates; install the CNPG operator out-of-band (documented but not embedded as a Helm dependency — most clusters already run it); make every secret `required` at template render time so `helm install` fails fast on placeholder values; gate CI on a `kind`-based install + upgrade + first-transcribe SLO check.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Helm chart packaging | Chart (umbrella) | — | Single source of truth for K8s manifests; all first-party services live here. |
| HA Postgres | CNPG operator (cluster-scoped) | Chart references via `Cluster` CR | Operator pattern — CRD reconciliation handles failover, backups, switchover. |
| Pooled DB access | PgBouncer Deployment (chart) | — | PgBouncer transaction mode is constitutional per STACK.md; runs as a sidecar Deployment, not in-pod. |
| Cache / queue | Bitnami Valkey sub-chart | — | Valkey 8 selected in STACK.md; Bitnami chart is the well-staffed default. |
| Object storage | MinIO operator (or Bitnami MinIO chart) | — | Self-host default; corporate ops override to S3-compatible. |
| Ingress / TLS | Traefik 3 (installed as dependency or operator-prereq) | cert-manager (cluster-scoped prereq) | Traefik selected in STACK.md; ingress-nginx EOL Mar 2026 — DO NOT USE. |
| TLS issuance | cert-manager ClusterIssuer | Operator override per env | LE for OSS quickstart; internal CA Issuer for corp (env-toggle in values). |
| AI plane | LiteLLM Deployment (chart) | Bundled Whisper/pyannote on GPU node | `bundled-ai.enabled` values flag toggles GPU pods + nodeSelector. |
| Observability | OTel Collector DaemonSet (chart) | LGTM stack as cluster-scoped prereq | OTel exporter receivers per-node; Tempo/Mimir/Loki/Grafana installed separately. |
| Secrets | Kubernetes Secret (default) | ESO `ExternalSecret` (corp opt-in) | OSS quickstart uses raw Secrets; corp ops swap in ExternalSecrets via values override. |
| Migrations | Job (`pre-install`,`pre-upgrade` hook) | — | Helm hook pattern; one-shot Job runs Drizzle migrate before pods see new schema. |
| HPA | `HorizontalPodAutoscaler` (api + worker) | prometheus-adapter for custom metrics | CPU default; custom metrics (queue depth, WSS sessions) tier-2 enhancement. |

## Service Inventory Mapping (compose → chart)

| Compose service | Chart resource(s) | Notes |
|----------------|--------------------|-------|
| `postgres` | CNPG `Cluster` CR (not a Deployment) | Operator manages StatefulSet underneath. Replaces the `openwhispr/postgres:17.5-pgpartman` custom image with CNPG-blessed PG 17 image; the `pg_partman` extension is loaded via `Cluster.spec.postgresql.shared_preload_libraries` or a `Database` CR `extensions` block. |
| `pgbouncer` | `Deployment` + `Service` + `ConfigMap` (userlist.txt) | The Phase 01.2 init pattern (SCRAM hash regen on boot) translates to an initContainer. CNPG also offers a `Pooler` CR — **decision needed during planning**: use CNPG `Pooler` (managed) vs first-party Deployment (current behavior). Recommend `Pooler` for fewer moving parts. [CITED: cloudnative-pg.io/docs/1.28/connection_pooling/] |
| `valkey` | Bitnami Valkey sub-chart OR `StatefulSet` first-party | Bitnami chart preferred (community-maintained, well-versioned). Single replica default; HA optional. |
| `minio` | MinIO operator `Tenant` CR OR Bitnami MinIO sub-chart | Self-host default = single-disk MinIO; cloud override = bypass and point at S3 via values. |
| `traefik` | **NOT in chart** — installed as cluster prereq via `traefik/traefik` Helm chart | Chart ships only `IngressRoute` CRs + `Middleware` CRs + the dynamic config equivalent (forwardedHeaders trustedIPs as a `Middleware`). Documented as prereq in chart README. |
| `otel-collector` | `DaemonSet` + ConfigMap (existing collector config) | Per STACK.md: collector runs DaemonSet in cloud topology to scrape per-node. |
| `loki` / `tempo` / `mimir` / `grafana` | **NOT in chart by default** — installed as cluster prereqs via grafana/loki, grafana/tempo, grafana/mimir, grafana/grafana charts | Chart values include a `lgtmStack.embedded: false` toggle; with `true` we vendor minimal sub-charts (OSS quickstart). |
| `migrate` | `Job` with `helm.sh/hook: pre-install,pre-upgrade` + `helm.sh/hook-weight: -5` + `helm.sh/hook-delete-policy: before-hook-creation` | Runs Drizzle migrate; blocks rollout until success. |
| `litellm` | `Deployment` + `Service` + `ConfigMap` (config.yaml) | `bundled-ai.enabled=false` → chart skips the deployment entirely; api pods point at `LITELLM_BASE_URL` from values. |
| `api` | `Deployment` + `Service` + `HorizontalPodAutoscaler` + `PodDisruptionBudget` | Standard. Min 2 replicas in cloud topology for HA. |
| `worker` | `Deployment` + `Service` (headless, for metrics) + `HorizontalPodAutoscaler` + `PodDisruptionBudget` | HPA on CPU default; prometheus-adapter for `bullmq_queue_depth` is a tier-2 enhancement. |
| `web` | `Deployment` + `Service` + `IngressRoute` | Next.js 15 SSR pod. |
| `mailpit` | Optional sub-chart, dev-only | `dev.enabled=true` in values; off by default. |
| `fixture-idp` / `seed` / `contract-test-runner` | **NOT in chart** — test-only, compose-local | Documented as compose-only test artifacts. |
| **NEW** Speaches (bundled ASR) | `Deployment` with `nodeSelector` + `tolerations` + `resources.limits.nvidia.com/gpu: 1` | Only when `bundled-ai.enabled=true`. Multi-arch caveat: GPU image is amd64-only. |

**Compose ↔ chart parity gate:** add a CI script (`tools/lint-compose-chart-parity.ts`) that diffs the set of compose services (minus the `NOT in chart` exclusion list) against `kubectl kustomize`-rendered chart manifests, asserting 1:1 mapping. This guards against drift when new compose services are added in later phases without a corresponding chart update.

## CNPG Postgres 17 Cluster Spec (template)

CNPG 1.29's default catalog ships PG 18; explicit override required. Two patterns supported:

**Pattern A — direct `imageName`** (simpler; chart's first-cut):

```yaml
# templates/postgres-cluster.yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: {{ include "openwhispr.fullname" . }}-pg
  namespace: {{ .Release.Namespace }}
spec:
  instances: {{ .Values.postgres.replicas | default 3 }}
  imageName: ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie
  primaryUpdateStrategy: unsupervised
  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "512MB"
      shared_preload_libraries: "pg_partman_bgw"
    pg_hba:
      - host openwhispr openwhispr_owner 0.0.0.0/0 scram-sha-256
  bootstrap:
    initdb:
      database: openwhispr
      owner: openwhispr_owner
      secret:
        name: {{ include "openwhispr.fullname" . }}-pg-owner
      postInitApplicationSQL:
        - CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;
  storage:
    size: {{ .Values.postgres.storageSize | default "20Gi" }}
    storageClass: {{ .Values.postgres.storageClass }}
  backup:
    barmanObjectStore:
      destinationPath: s3://{{ .Values.backup.bucket }}/cnpg
      endpointURL: {{ .Values.backup.s3Endpoint }}
      s3Credentials:
        accessKeyId:
          name: {{ include "openwhispr.fullname" . }}-backup
          key: access-key
        secretAccessKey:
          name: {{ include "openwhispr.fullname" . }}-backup
          key: secret-key
    retentionPolicy: "30d"
```

**Pattern B — `imageCatalogRef` + `major`** (preferred for fleet management) [CITED: cloudnative-pg.io/docs/1.28/image_catalog/]:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: ImageCatalog
metadata:
  name: openwhispr-pg-catalog
spec:
  images:
    - major: 17
      image: ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: openwhispr-pg
spec:
  instances: 3
  imageCatalogRef:
    apiGroup: postgresql.cnpg.io
    kind: ImageCatalog
    name: openwhispr-pg-catalog
    major: 17
  # ... rest same as Pattern A
```

**Recommendation:** ship Pattern A as the chart default for simplicity; expose Pattern B as an opt-in (`postgres.imageCatalog.enabled=true`) for multi-cluster fleets. [VERIFIED: cloudnative-pg.io/docs/1.28/image_catalog/]

**The `pg_partman` custom image issue:** the compose stack runs a self-built `openwhispr/postgres:17.5-pgpartman` image (Phase 01 D-A2) because `pg_partman` is not in the upstream CNPG image. **Three resolution options** (planner decides):
1. Build `openwhispr/cnpg-postgres-17-pgpartman:<tag>` image extending `ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie` and publish to GHCR.
2. Switch to `pg_partman` via the CNPG `extensions` API once it lands (currently 1.29-rc; check status at plan time).
3. Drop `pg_partman_bgw` background worker and run partition rotation as a BullMQ job. [ASSUMED — operationally feasible but changes a Phase 1 lock-in.]

Recommendation: option 1 (custom CNPG-base image) — least risk, preserves Phase 1 partitioning behavior end-to-end. [VERIFIED: ghcr.io/cloudnative-pg/postgresql tag listing]

## Traefik 3 IngressRoute Templates

Two `IngressRoute` CRs corresponding to the two compose entrypoints (Phase 04 Plan 05 lock-in):

```yaml
# templates/ingressroute-api.yaml — :443 short-JSON
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: {{ include "openwhispr.fullname" . }}-api
spec:
  entryPoints: [websecure]
  routes:
    - match: Host(`{{ .Values.host.api }}`) && PathPrefix(`/api`)
      kind: Rule
      services:
        - name: {{ include "openwhispr.fullname" . }}-api
          port: 3000
      middlewares:
        - name: {{ include "openwhispr.fullname" . }}-forwarded-headers
  tls:
    secretName: {{ .Values.tls.apiSecretName }}  # populated by cert-manager
---
# templates/ingressroute-api-realtime.yaml — :8443 long-WSS
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: {{ include "openwhispr.fullname" . }}-api-realtime
spec:
  entryPoints: [websecure-realtime]   # MUST be defined in Traefik install values
  routes:
    - match: Host(`{{ .Values.host.api }}`) && PathPrefix(`/v1/realtime`)
      kind: Rule
      priority: 100
      services:
        - name: {{ include "openwhispr.fullname" . }}-api
          port: 3000
          serversTransport: openwhispr-realtime-transport
  tls:
    secretName: {{ .Values.tls.apiSecretName }}
---
# templates/serverstransport-realtime.yaml — long idleConnTimeout
apiVersion: traefik.io/v1alpha1
kind: ServersTransport
metadata:
  name: openwhispr-realtime-transport
spec:
  forwardingTimeouts:
    idleConnTimeout: 3600s
    responseHeaderTimeout: 60s
```

**Prerequisite:** Traefik must be installed with both `websecure` (`:443`) and `websecure-realtime` (`:8443`) entrypoints. Chart README documents the required Traefik install values:

```yaml
# Required Traefik install values (operator runs before openwhispr chart):
ports:
  websecure:
    port: 8443        # in-pod listener
    expose: { default: true }
    exposedPort: 443
  websecure-realtime:
    port: 8444
    expose: { default: true }
    exposedPort: 8443
    transport:
      respondingTimeouts:
        readTimeout: 0
        writeTimeout: 0
        idleTimeout: 3600s
```

Provide a `charts/openwhispr/examples/traefik-values.yaml` reference file so operators copy-paste rather than discovering this via failure. [VERIFIED: doc.traefik.io/traefik/reference/install-configuration/entrypoints/]

**Cert-manager wiring:** `templates/certificate.yaml` references a ClusterIssuer (`{{ .Values.certManager.clusterIssuer }}`, default `letsencrypt-prod`); the `Certificate` populates `apiSecretName`. Chart README documents the two reference ClusterIssuers (LE-prod and LE-staging) plus the corporate internal-CA Issuer pattern. [CITED: cert-manager.io/docs/configuration/acme/]

## HPA Specs

```yaml
# templates/hpa-api.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "openwhispr.fullname" . }}-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "openwhispr.fullname" . }}-api
  minReplicas: {{ .Values.api.autoscaling.minReplicas | default 2 }}
  maxReplicas: {{ .Values.api.autoscaling.maxReplicas | default 20 }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
```

```yaml
# templates/hpa-worker.yaml — same shape, with optional custom metric
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "openwhispr.fullname" . }}-worker
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "openwhispr.fullname" . }}-worker
  minReplicas: 1
  maxReplicas: {{ .Values.worker.autoscaling.maxReplicas | default 30 }}
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
{{- if .Values.worker.autoscaling.queueDepthMetric }}
    - type: External
      external:
        metric:
          name: bullmq_queue_waiting_total
          selector: { matchLabels: { queue: "transcription" } }
        target: { type: AverageValue, averageValue: "5" }
{{- end }}
```

The `bullmq_queue_waiting_total` metric requires **prometheus-adapter** (cluster prereq) [CITED: github.com/kubernetes-sigs/prometheus-adapter]. CPU-based default is the chart's first-cut; custom metric is a values opt-in.

## GPU Node-Selector (bundled-AI workers only)

```yaml
# templates/deployment-speaches.yaml — only rendered if .Values.bundledAi.enabled
{{- if .Values.bundledAi.enabled }}
apiVersion: apps/v1
kind: Deployment
metadata: { name: {{ include "openwhispr.fullname" . }}-speaches }
spec:
  replicas: {{ .Values.bundledAi.replicas | default 1 }}
  template:
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
      containers:
        - name: speaches
          image: {{ .Values.bundledAi.image | default "ghcr.io/speaches-ai/speaches:master-cuda-12.6.3" }}
          resources:
            limits:
              nvidia.com/gpu: 1
              memory: 12Gi
{{- end }}
```

Cluster prereq: `nvidia-device-plugin` DaemonSet (installed via `nvidia/nvidia-device-plugin` Helm chart, or by the cluster's GPU operator). Chart README documents.

## Helm Test Hook (DEPLOY-05 First-Launch SLO)

A `test` hook pod runs a synthetic transcribe against the deployed stack. Helm fires it via `helm test <release>`; CI invokes after `helm install`.

```yaml
# templates/tests/first-launch-slo.yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "openwhispr.fullname" . }}-test-first-launch
  annotations:
    helm.sh/hook: test
    helm.sh/hook-delete-policy: hook-succeeded
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: {{ .Values.image.repository }}/test-probe:{{ .Chart.AppVersion }}
      env:
        - name: TARGET
          value: https://{{ .Values.host.api }}
        - name: SLO_DEADLINE_MS
          value: "300000"   # 5 min
      command: ["/probe", "first-launch-slo"]
```

The `test-probe` image (built by phase 9; lives at `tools/test-probe/`) performs: (1) seed test user via Better Auth API; (2) POST a 5s WAV to `/api/transcribe`; (3) assert 200 + JSON envelope; (4) emit elapsed-ms to stdout; (5) exit nonzero if elapsed > deadline. [CITED: helm.sh/docs/topics/chart_tests/]

## Upgrade-Matrix GHA Workflow

```yaml
# .github/workflows/helm-upgrade-matrix.yml
name: helm-upgrade-matrix
on: { pull_request: { paths: ['charts/openwhispr/**'] }, push: { branches: [main] } }
jobs:
  upgrade-matrix:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        from: [N-1]   # populated by the chart's previous tag
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: helm/kind-action@v1
        with: { cluster_name: upgrade-matrix, kubectl_version: v1.31.0 }
      - name: Install CNPG operator
        run: |
          helm repo add cnpg https://cloudnative-pg.github.io/charts
          helm install cnpg cnpg/cloudnative-pg --namespace cnpg-system --create-namespace --wait
      - name: Install Traefik
        run: |
          helm repo add traefik https://traefik.github.io/charts
          helm install traefik traefik/traefik -f charts/openwhispr/examples/traefik-values.yaml --wait
      - name: Install cert-manager
        run: |
          helm repo add jetstack https://charts.jetstack.io
          helm install cert-manager jetstack/cert-manager --set crds.enabled=true --wait
      - name: Checkout N-1 chart
        run: git checkout ${{ matrix.from }} -- charts/openwhispr
      - name: helm install N-1
        run: helm install ow charts/openwhispr -f .github/ci/values-ci.yaml --wait --timeout 10m
      - name: Seed data
        run: kubectl exec -i deploy/ow-api -- node /app/tools/seed-test-data.js
      - name: Checkout HEAD chart
        run: git checkout HEAD -- charts/openwhispr
      - name: helm upgrade N
        run: helm upgrade ow charts/openwhispr -f .github/ci/values-ci.yaml --wait --timeout 10m
      - name: helm test (first-launch SLO)
        run: helm test ow --timeout 5m
      - name: Integrity check (seeded data still queryable)
        run: kubectl exec -i deploy/ow-api -- node /app/tools/integrity-check.js
```

**Caveats:**
- `kind` GPU support: none. Bundled-AI path tests `enabled=false` in this CI; a separate matrix entry with `enabled=true` runs on a self-hosted GPU runner (deferred unless cheap).
- N-1 tag discovery: the `git checkout ${{ matrix.from }}` line is a placeholder; planner specifies whether to use `git describe --tags --abbrev=0 HEAD^` or a hard-pinned previous-release tag stored in `.chart-versions/`.
- LGTM cluster prereqs: in CI we skip the LGTM stack (set `observability.enabled=false` in `values-ci.yaml`) to keep the matrix fast.

## Online-Migration Lint (`squawk`)

**Tool choice:** `squawk` — `pgroll` is a migration **executor** (expand/contract pattern), not a linter. Squawk performs static analysis on the `.sql` migration files and blocks unsafe patterns (`ADD CONSTRAINT NOT NULL` without batched-fill, `CREATE INDEX` without `CONCURRENTLY`, blocking `ALTER TYPE`, etc.). [VERIFIED: squawkhq.com — "Squawk is a linter for Postgres migrations"]

**Note on Drizzle:** Drizzle generates SQL via `drizzle-kit generate` to `drizzle/<timestamp>.sql`. Squawk runs against those generated files. Add `squawk` as a dev dependency and a `tools/lint-migrations.ts` driver that finds new SQL files since the merge-base and pipes each through `squawk`.

```yaml
# .github/workflows/lint-migrations.yml (or fold into ci.yml)
- name: Lint new migrations with squawk
  run: |
    pnpm exec tsx tools/lint-migrations.ts \
      --since origin/main --rules \
      adding-required-field,\
      ban-drop-column,\
      changing-column-type,\
      constraint-missing-not-valid,\
      disallowed-unique-constraint,\
      prefer-big-int,\
      prefer-bigint-over-int,\
      prefer-text-field,\
      require-concurrent-index-creation,\
      require-concurrent-index-deletion,\
      renaming-column,\
      transaction-nesting
```

[CITED: squawkhq.com/docs/safe_migrations + github.com/sbdchd/squawk-action]

**Companion: `pgroll` as deferred (not Phase 9).** If a future phase needs true zero-downtime schema migrations (expand/contract with dual schemas), introduce `pgroll`; for now Drizzle + squawk + the migration-as-pre-deploy-Job pattern is sufficient. [CITED: github.com/xataio/pgroll]

## Secrets Management

**Chart shipping shape (defaults):** raw `Secret` resources rendered from values with a refuse-to-start gate.

```yaml
# templates/secrets.yaml
{{- $required := list "litellmMasterKey" "openrouterApiKey" "openaiApiKey" "pyannoteApiKey" "hfToken" "postgresOwnerPassword" "pgbouncerAdminPassword" "betterAuthSecret" -}}
{{- range $required }}
  {{- if not (index $.Values.secrets .) }}
    {{- fail (printf "values.secrets.%s is required — refusing to install with default/empty secret" .) }}
  {{- end }}
  {{- if eq (index $.Values.secrets .) "CHANGE_ME" }}
    {{- fail (printf "values.secrets.%s is set to placeholder 'CHANGE_ME' — refusing to install" .) }}
  {{- end }}
{{- end }}
---
apiVersion: v1
kind: Secret
metadata: { name: {{ include "openwhispr.fullname" . }}-secrets }
type: Opaque
stringData:
  LITELLM_MASTER_KEY: {{ .Values.secrets.litellmMasterKey | quote }}
  OPENROUTER_API_KEY: {{ .Values.secrets.openrouterApiKey | quote }}
  # ... rest of keys
```

This implements **DEPLOY-03's refuse-to-start gate** at chart-render time (fails `helm install` before any pod runs). [VERIFIED: helm.sh/docs/chart_template_guide/control_structures/ — `fail` action]

**Schema validation** (defense in depth): ship `charts/openwhispr/values.schema.json` flagging the same keys as `required` with `not: { enum: ["", "CHANGE_ME", "changeme"] }` patterns so `helm lint` also catches it.

**Corporate opt-in: External Secrets Operator.** Add a `secrets.external.enabled=true` flag. When set, the chart renders `ExternalSecret` CRs that pull from a `SecretStore` (Vault, AWS Secrets Manager, Azure KV) instead of consuming inline values. [CITED: external-secrets.io] — gated as a values flag, not a hard dependency.

```yaml
{{- if .Values.secrets.external.enabled }}
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata: { name: {{ include "openwhispr.fullname" . }}-secrets }
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: {{ .Values.secrets.external.storeRef }}
    kind: {{ .Values.secrets.external.storeKind | default "ClusterSecretStore" }}
  target:
    name: {{ include "openwhispr.fullname" . }}-secrets
    creationPolicy: Owner
  data:
    - secretKey: LITELLM_MASTER_KEY
      remoteRef: { key: {{ .Values.secrets.external.path }}/litellm-master-key }
    # ...
{{- end }}
```

**Decision deferred to discuss-phase (per /gsd-discuss-phase posture):** is ESO a chart-shipped option (current recommendation) or do we ship the chart with **only** the inline-Secret path and refer corp ops to ESO via docs? Both are common; the inline+optional ESO posture matches Better Auth + LiteLLM precedent of "OSS default works, corp override via env / values". [ASSUMED — needs user lock at discuss-phase.]

## Image Registry Strategy

**Registry:** GitHub Container Registry (GHCR), namespace `ghcr.io/<org>/openwhispr-*`. Already used by upstreams (LiteLLM, CNPG, Speaches) so no new account/credential. Workflow: existing `release.yml` (already present in `.github/workflows/`) extends to push `openwhispr/api`, `openwhispr/web`, `openwhispr/worker`, `openwhispr/migrate`, `openwhispr/pgbouncer`, `openwhispr/cnpg-postgres-17-pgpartman`, `openwhispr/test-probe`.

**Tag scheme:**
- `:latest` — head of main, never used in production manifests
- `:main-<short-sha>` — every main push, used by chart CI matrix
- `:vX.Y.Z` — semver, matching chart `appVersion` and release tag
- `:vX.Y` — moving alias for latest patch (optional)

**Multi-arch:** amd64 + arm64 via `docker buildx` — STACK.md hard rule. The Speaches/CUDA image is amd64-only and that's accepted (bundled-AI is GPU-only anyway).

**Chart values pin one tag per image:**
```yaml
image:
  api:    { repository: ghcr.io/<org>/openwhispr-api, tag: "" }   # empty -> uses Chart.AppVersion
  web:    { repository: ghcr.io/<org>/openwhispr-web, tag: "" }
  worker: { repository: ghcr.io/<org>/openwhispr-worker, tag: "" }
```

[VERIFIED: docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry]

## Migration Job (Helm hook pattern)

```yaml
# templates/migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "openwhispr.fullname" . }}-migrate-{{ .Release.Revision }}
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-5"
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: {{ .Values.image.migrate.repository }}:{{ .Values.image.migrate.tag | default .Chart.AppVersion }}
          envFrom:
            - secretRef: { name: {{ include "openwhispr.fullname" . }}-secrets }
          env:
            - name: DATABASE_URL
              value: postgres://openwhispr_owner@{{ include "openwhispr.fullname" . }}-pg-rw:5432/openwhispr
          command: ["node", "/app/tools/migrate.js"]
```

`helm.sh/hook-weight: -5` ensures migrate runs before any other pre-install hook. `before-hook-creation` deletion policy keeps the previous Job around for debugging until the next deploy starts. [VERIFIED: helm.sh/docs/topics/charts_hooks/]

**Backwards-compatibility under rolling deploy (DEPLOY-04):** migrations must be expand-only (add column → backfill → switch app code in next release → drop column in release after). The squawk lint enforces the basics; phase-level convention (documented in `docs/operations.md` per Phase 10) covers the multi-release dance.

## Predicted Files Tree

```
charts/openwhispr/
├── Chart.yaml                          # appVersion = release tag
├── Chart.lock
├── values.yaml                         # all defaults
├── values.schema.json                  # required-secrets enforcement
├── README.md                           # quickstart + prereqs (CNPG, Traefik, cert-manager, optional ESO)
├── templates/
│   ├── _helpers.tpl
│   ├── NOTES.txt                       # post-install summary, includes `helm test` instruction
│   ├── serviceaccount.yaml
│   ├── secrets.yaml                    # inline secrets path + `fail` gates
│   ├── externalsecret.yaml             # opt-in ESO path
│   ├── configmap-api.yaml
│   ├── configmap-worker.yaml
│   ├── configmap-litellm.yaml
│   ├── configmap-otel-collector.yaml
│   ├── postgres-cluster.yaml           # CNPG Cluster CR
│   ├── postgres-imagecatalog.yaml      # optional, gated
│   ├── pgbouncer-deployment.yaml       # OR pooler.yaml for CNPG Pooler
│   ├── pgbouncer-service.yaml
│   ├── pgbouncer-userlist-configmap.yaml
│   ├── valkey/                         # sub-chart values overlay (charts dir + this dir for overrides)
│   ├── minio/                          # ditto
│   ├── migrate-job.yaml
│   ├── litellm-deployment.yaml
│   ├── litellm-service.yaml
│   ├── speaches-deployment.yaml        # bundled-AI only, GPU nodeSelector
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── api-hpa.yaml
│   ├── api-pdb.yaml
│   ├── api-servicemonitor.yaml         # Prometheus Operator CR, opt-in
│   ├── worker-deployment.yaml
│   ├── worker-service.yaml
│   ├── worker-hpa.yaml
│   ├── worker-pdb.yaml
│   ├── web-deployment.yaml
│   ├── web-service.yaml
│   ├── otel-collector-daemonset.yaml
│   ├── otel-collector-clusterrole.yaml
│   ├── otel-collector-serviceaccount.yaml
│   ├── ingressroute-api.yaml           # :443 short-JSON
│   ├── ingressroute-api-realtime.yaml  # :8443 long-WSS
│   ├── ingressroute-web.yaml
│   ├── middleware-forwarded-headers.yaml
│   ├── serverstransport-realtime.yaml
│   ├── certificate-api.yaml            # cert-manager Certificate
│   ├── networkpolicy.yaml              # optional, gated
│   └── tests/
│       └── first-launch-slo.yaml       # `helm test` SLO hook
├── charts/                             # sub-charts vendor dir (Bitnami Valkey, MinIO if vendored)
└── examples/
    ├── values-oss-quickstart.yaml
    ├── values-cloud-ha.yaml
    ├── values-corporate-litellm.yaml   # bundled-ai off, ESO on
    ├── traefik-values.yaml             # required Traefik install values
    └── cert-manager-clusterissuer-letsencrypt.yaml
```

Plus chart-adjacent additions:

```
.github/workflows/
├── helm-lint.yml                       # helm lint + values-schema validation, every PR
├── helm-upgrade-matrix.yml             # N-1 → N upgrade + first-launch SLO, every PR touching charts/
├── lint-migrations.yml                 # squawk gate
└── helm-release.yml                    # `chart-releaser-action` on tagged releases

tools/
├── lint-migrations.ts                  # squawk driver
├── lint-compose-chart-parity.ts        # compose-service vs chart-Deployment parity check
├── test-probe/                         # first-launch SLO image source
│   ├── Dockerfile
│   ├── package.json
│   └── src/probe.ts
└── seed-test-data.js                   # used by upgrade-matrix integrity check
```

## Pitfalls

| # | Pitfall | Why It Happens | Mitigation |
|---|---------|---------------|-----------|
| 1 | **CNPG default catalog is PG 18, not 17.** | CNPG 1.29 ships PG 18 in the default `ClusterImageCatalog`. Without override, `Cluster` CR creates PG 18 pods → silent major-version mismatch vs the application's PG 17 schema assumptions. | Explicit `imageName: ghcr.io/cloudnative-pg/postgresql:17.x-system-trixie` OR `imageCatalogRef + major: 17`. Add a chart-lint check that fails if `postgres.imageName` doesn't include `:17.`. |
| 2 | **`pg_partman` is not in the upstream CNPG image.** | Phase 1 baked `pg_partman_bgw` into a custom Postgres image. CNPG's image doesn't include it. | Build `openwhispr/cnpg-postgres-17-pgpartman:<tag>` extending CNPG base; publish to GHCR. Verify `shared_preload_libraries` accepted on cluster boot. |
| 3 | **ingress-nginx EOL March 2026.** | STACK.md hard rule. Some operators reflexively reach for nginx. | Chart's `IngressRoute` CRs are Traefik-only; document NO `Ingress` resources will be added. README explicitly forbids ingress-nginx. |
| 4 | **Traefik `websecure-realtime` entrypoint must be declared in the Traefik install, not in the IngressRoute.** | Operators install Traefik with default ports only → our `IngressRoute` references a non-existent entrypoint → realtime traffic 404s. | Ship `examples/traefik-values.yaml` with the entrypoint; `NOTES.txt` post-install message reminds operator to verify Traefik has both entrypoints. Add a preflight initContainer in `api-deployment` that probes Traefik's `/api/entrypoints` and fails fast if missing. |
| 5 | **Helm `fail` evaluates at render time, before secrets are even fetched from ESO.** | If `secrets.external.enabled=true`, the chart still passes secret values through `.Values.secrets.*` — which are empty when ESO is the source. The `fail` gate then false-fires. | When ESO is enabled, the chart skips the inline-Secret rendering AND the `fail` gates; instead, an initContainer in api pod runs `test -n "$LITELLM_MASTER_KEY"` against the env loaded from the ESO-populated Secret. Refuse-to-start moves from render-time to pod-start time. |
| 6 | **`helm test` hooks run AFTER `helm install` returns, not before.** | Operators expect `helm install` to fail if the stack doesn't converge. With `--wait`, install waits for pod readiness but not for the test pod. | CI invokes `helm install <release> --wait` then `helm test <release> --timeout 5m`; failure of the test step fails the upgrade-matrix job. README documents this two-step flow for operators. |
| 7 | **kind clusters have no PersistentVolume dynamic provisioner by default for `ReadWriteMany`.** | CNPG needs RWO (works on `standard` storage class); MinIO single-disk works too. But if anyone adds an RWX-needing volume later, kind silently hangs. | Pin CI to RWO-only and document the constraint. Add a `values-ci.yaml` that sets all storage class names explicitly to `standard`. |
| 8 | **Upgrade-matrix N-1 tag discovery is brittle.** | `git describe --tags --abbrev=0 HEAD^` returns the wrong tag if main is between releases. | Maintain `.chart-versions/previous` text file pinned to the last released chart tag; CI reads it. Update the file as part of the release workflow. |
| 9 | **Drizzle generates migrations that pass squawk individually but break under rolling deploy.** | Squawk lints per-file. A `DROP COLUMN` in version N is "safe" by itself but breaks N-1 pods still using the column during rolling deploy. | Convention (doc'd in `docs/operations.md`): expand in release X, switch app in X+1, contract in X+2. Add a chart-lint check that scans migrations for `DROP COLUMN` / `DROP TABLE` and warns (does not block — sometimes deliberate). |
| 10 | **CNPG `Pooler` (managed PgBouncer) doesn't expose the `userlist.txt` SCRAM-regen pattern from Phase 01.2.** | The Phase 01.2 fix regenerated PgBouncer's userlist SCRAM hash on each boot to match Postgres. CNPG's `Pooler` manages this differently (uses `pg_hba` + cert auth). | Decision deferred: option A keep first-party PgBouncer Deployment (preserves 01.2 behavior); option B switch to CNPG `Pooler` and accept different auth pattern (re-verifies 01.2 invariants in cloud topology). Recommend option A for chart parity with compose; revisit in Phase 11+. |
| 11 | **GPU nodeSelector matches in kind CI = pod never schedules.** | If `bundledAi.enabled=true` accidentally leaks into CI, the speaches pod pends forever and `helm install --wait` times out. | `values-ci.yaml` hard-sets `bundledAi.enabled=false`. CI workflow asserts `helm template -f values-ci.yaml | grep -c "kind: Deployment.*speaches"` returns 0. |
| 12 | **OTel Collector DaemonSet needs hostNetwork/hostPort for some receivers.** | Collector receivers like `hostmetrics` need access to `/proc`, `/sys`. Without `hostNetwork: true` and the right `volumeMounts`, half the signals go missing silently. | Reuse Phase 06's collector ConfigMap verbatim; document the DaemonSet's `securityContext` requirements; add a `kubectl logs` assertion in `helm test` that the collector started successfully. |
| 13 | **`values.schema.json` only validates user-provided values, not chart-rendered output.** | An operator who supplies `secrets.litellmMasterKey: "x"` passes schema validation, but `"x"` is a terrible secret. | Schema enforces `minLength: 32` and a regex banning placeholder strings. Combined with the render-time `fail` gates, this catches the obvious cases. |
| 14 | **PG 17 partition rotation needs `pg_partman_bgw` enabled at `shared_preload_libraries`.** | Setting only `CREATE EXTENSION pg_partman` is insufficient — the background worker requires the lib in `shared_preload_libraries` AND a Postgres restart. CNPG handles restart but only if the param is in `Cluster.spec.postgresql.parameters`. | Template's `Cluster` spec includes `shared_preload_libraries: "pg_partman_bgw"` in `postgresql.parameters`. Add a smoke test in `helm test` that queries `SHOW shared_preload_libraries`. |
| 15 | **`helm install --wait` doesn't wait for CRD-backed resources** (CNPG `Cluster`, Traefik `IngressRoute`). | The Helm `--wait` flag waits for Deployments/StatefulSets/DaemonSets but not custom resources. `helm install` returns "success" before Postgres is actually up. | The migrate Job hook waits on the CNPG Cluster being primary (via initContainer running `cnpg-controller status` or a simple `pg_isready` loop against the cluster's `-rw` service). This serializes correctly even when `--wait` doesn't help. |

## Project Constraints (from CLAUDE.md)

- **Strict TDD**: every Phase 9 task ships RED → GREEN → REFACTOR. Helm template tests via `helm-unittest` plugin or rendered-manifest snapshots in `charts/openwhispr/tests/`.
- **Coverage ≥ 90%** on all new TypeScript (`tools/lint-migrations.ts`, `tools/lint-compose-chart-parity.ts`, `tools/test-probe/src/probe.ts`).
- **E2E mandatory**: `helm-upgrade-matrix.yml` IS the e2e for this phase (boots kind, installs, upgrades, tests). Plus a `make e2e-test-helm` local target wrapping the same.
- **No mocks of internal logic**: the probe image hits the real LiteLLM (or mock-litellm, the existing test boundary) via the real chart deployment.
- **GitHub Actions only**: all new CI lives in `.github/workflows/`.
- **English only**: chart values keys, README, NOTES.txt, all template comments.
- **HTTPS only**: chart's `Certificate` resources are mandatory; no plaintext `IngressRoute` rules.
- **Verification gate**: phase passes only when full upgrade-matrix is green across at least one N-1 → N transition.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Inline-Secret + optional ESO is the right posture (vs ESO-required). | Secrets Management | Corp ops may prefer ESO-only; rework is a values-shape change (low effort). |
| A2 | CNPG operator installed out-of-band (cluster-scoped), not as a chart dependency. | Architecture Map | If user wants in-chart operator install, add a `cnpg.embedded` flag — moderate template work. |
| A3 | LGTM stack also out-of-band; chart ships `ServiceMonitor`/`PodMonitor` CRs and an OTel Collector but doesn't embed Prometheus/Loki/Tempo/Mimir/Grafana. | Architecture Map | Some quickstart operators may want the whole LGTM bundled; add `observability.embedded=true` opt-in. |
| A4 | Build `openwhispr/cnpg-postgres-17-pgpartman` extending CNPG base for `pg_partman` is the right resolution. | CNPG Cluster Spec | If user prefers dropping `pg_partman_bgw` for a BullMQ partition-rotation job, Phase 1's partitioning approach changes scope. |
| A5 | Bitnami Valkey + Bitnami MinIO sub-charts (vs first-party templates or MinIO operator). | Service Inventory | Subjective. Bitnami is the well-staffed default per STACK.md; if user wants MinIO operator's `Tenant` CR, template rewrite. |
| A6 | First-party PgBouncer Deployment (preserves Phase 01.2 SCRAM regen) vs CNPG `Pooler`. | Pitfalls #10 | Choosing `Pooler` re-verifies Phase 1 invariants; low risk but explicit decision needed. |
| A7 | `kind` is the right test runtime for upgrade-matrix CI (vs `k3d` or a managed GHA runner). | Upgrade-Matrix Workflow | `kind` is the most common GHA pattern; `k3d` is faster boot but less common. |
| A8 | Chart `appVersion` and `version` move together (semver-locked). | Image Registry Strategy | Standard Helm pattern; some projects decouple. |

## Environment Availability

| Dependency | Required By | Available locally | Fallback |
|------------|------------|-------------------|----------|
| `helm` CLI | All chart work | Likely yes (verify in plan 01) | Install via `brew install helm` / official tarball. |
| `kind` | Local upgrade-matrix runs + CI | Likely yes | `brew install kind` / official binary. |
| `kubectl` | All cluster work | Likely yes | Standard install. |
| `helm-unittest` plugin | Template snapshot tests | No | `helm plugin install https://github.com/helm-unittest/helm-unittest`. |
| `squawk` | Migration lint | No (will install in plan 03) | `cargo install squawk` or download binary; pinned version in `tools/lint-migrations.ts`. |
| GHCR push credentials | Image publish | GHA token sufficient | N/A. |
| GPU node in CI | Bundled-AI matrix entry | No (CI is amd64 CPU) | Skip bundled-AI matrix in default CI; gate behind `[gpu]` label or nightly. |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (chart) | `helm-unittest` v0.5+ for template snapshots; raw `helm lint` for syntax |
| Framework (TS tools) | Existing Vitest (per repo convention) |
| Test runner | `pnpm test --filter '**/charts/**'` + `helm unittest charts/openwhispr` |
| E2E | `helm-upgrade-matrix.yml` (kind cluster) |
| First-launch SLO | `helm test` hook pod from `tools/test-probe/` |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | File status |
|-----|----------|-----------|-------------------|-------------|
| DEPLOY-01 | Compose stack boots, `bundled-litellm` profile toggles LiteLLM. | Integration | `docker compose --profile bundled-litellm up -d && make health` | Existing harness; small extension needed. |
| DEPLOY-02 | Helm chart installs cleanly on fresh kind. | E2E | `kind create cluster && helm install ow charts/openwhispr -f .github/ci/values-ci.yaml --wait` | Wave 0 — workflow + values-ci file. |
| DEPLOY-03a | Refuse to start on placeholder secret. | Unit (chart) | `helm template charts/openwhispr -f tests/values-bad-secret.yaml` (expect failure) | Wave 0. |
| DEPLOY-03b | One-command upgrade w/ rollback. | E2E | `helm upgrade ... && helm rollback ow 1 --wait` | Wave 0. |
| DEPLOY-04a | Migrate as pre-install/pre-upgrade Job. | Unit (chart) | `helm template ... | grep 'helm.sh/hook: pre-install,pre-upgrade'` | Wave 0. |
| DEPLOY-04b | Upgrade-matrix N-1 → N green. | E2E | `helm-upgrade-matrix.yml` | Wave 0. |
| DEPLOY-04c | Squawk blocks unsafe migration on PR. | Unit | `pnpm exec tsx tools/lint-migrations.ts --since main -- fixtures/bad-migration.sql` (expect nonzero) | Wave 0. |
| DEPLOY-05 | First-launch SLO < 5 min. | E2E | `helm test ow --timeout 5m` (probe asserts elapsed-ms) | Wave 0. |

### Sampling rate
- Per task: `helm lint charts/openwhispr` + `helm unittest charts/openwhispr` (< 10s).
- Per wave merge: full kind install (5-10 min).
- Phase gate: full upgrade-matrix workflow green.

### Wave 0 Gaps
- `.github/workflows/helm-lint.yml` — lint + unittest + values-schema
- `.github/workflows/helm-upgrade-matrix.yml` — kind upgrade matrix
- `.github/workflows/lint-migrations.yml` — squawk gate (or fold into ci.yml)
- `.github/ci/values-ci.yaml` — kind-safe overrides (no GPU, no LGTM, RWO storage)
- `charts/openwhispr/tests/values-bad-secret.yaml` + render-fails fixture
- `tools/test-probe/` package + image build wired into release workflow
- `tools/lint-migrations.ts` + tests
- `tools/lint-compose-chart-parity.ts` + tests
- `tools/seed-test-data.js` + `tools/integrity-check.js`
- `.chart-versions/previous` (initial value = current release tag)

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (chart wires Better Auth secrets) | Better Auth (existing) + refuse-to-start gate on `betterAuthSecret`. |
| V3 Session Management | yes (TLS termination) | cert-manager-issued certs; no plaintext entry-points; chart asserts via `kubectl get certificate` health. |
| V4 Access Control | yes | NetworkPolicy template (opt-in) restricts cross-namespace traffic. RBAC for service accounts is least-privilege. |
| V5 Input Validation | yes | `values.schema.json` enforces secret minLength, image-name regex, replica bounds. |
| V6 Cryptography | yes | TLS via cert-manager; never hand-roll. CNPG manages its own internal mTLS for replication. |
| V10 Malicious Code | yes | Trivy scan on every chart-published image (extends existing `verify-images.yml` workflow). |
| V14 Configuration | yes | Refuse-to-start on default secrets is the V14 enforcement point. `values.schema.json` is the V14 documentation point. |

| Threat | STRIDE | Mitigation |
|--------|--------|-----------|
| Operator deploys with `CHANGE_ME` secret | Tampering / Info disclosure | Render-time `fail` gate + schema-level pattern ban. |
| Postgres CR image silently bumped to PG 18 by operator update | Tampering | `imageName` pinned in values; chart-lint check on `:17.` substring. |
| Ingress short-JSON route shares timeouts with WSS realtime → DoS | DoS | Two-entrypoint topology (`:443` + `:8443`) carries over from compose (Phase 04 Plan 05). |
| Helm test probe leaks LiteLLM master key in logs | Info disclosure | Probe never logs the key; uses bearer token from a temp test-user account. |
| Upgrade-matrix CI cluster left running across runs | Resource exhaustion (Brave squirrels) | `kind delete cluster` in workflow `if: always()` step. |

## Plan Layout Suggestion

**Total predicted: 11 plans, organized into 4 waves.**

**Wave 0 — Foundations (parallel, 3 plans):**
- 09-01 — Chart skeleton (Chart.yaml, values.yaml, values.schema.json, _helpers.tpl, NOTES.txt, README; `helm lint` and `helm-unittest` wired). Plus refuse-to-start `fail` gates with snapshot tests.
- 09-02 — `tools/lint-migrations.ts` (squawk driver) + GHA workflow + fixture set.
- 09-03 — `tools/lint-compose-chart-parity.ts` + GHA workflow + initial allowlist.

**Wave 1 — Data plane (sequential, 2 plans):**
- 09-04 — CNPG Cluster CR template (PG 17 override, pg_partman base image build, WAL archive to MinIO/S3). Includes `openwhispr/cnpg-postgres-17-pgpartman` image Dockerfile + release-workflow wiring.
- 09-05 — PgBouncer Deployment + Secret rotation initContainer (Phase 01.2 parity) + sub-chart values (Valkey, MinIO).

**Wave 2 — App plane (parallel, 3 plans):**
- 09-06 — api / web / worker Deployments + Services + HPAs + PDBs + ServiceMonitors.
- 09-07 — LiteLLM Deployment + optional bundled-AI (Speaches) GPU-nodeSelector path.
- 09-08 — Migrate Job (pre-install/pre-upgrade hook) + initContainer that waits on CNPG Cluster primary.

**Wave 3 — Ingress + observability + tests (parallel, 2 plans):**
- 09-09 — IngressRoutes (`:443` + `:8443`) + Middleware + ServersTransport + cert-manager Certificate + example traefik-values.yaml + example ClusterIssuers.
- 09-10 — OTel Collector DaemonSet + RBAC + ConfigMap (port of Phase 06 config).

**Wave 4 — Gates + release (sequential, 1 plan):**
- 09-11 — First-launch SLO `helm test` probe (`tools/test-probe/`) + `helm-upgrade-matrix.yml` workflow (kind, N-1 → N, integrity check) + release-workflow extensions (`chart-releaser-action` on tagged releases) + `docs/operations.md` chart section.

**Phase exit gate:** all 11 plans verified, `helm-upgrade-matrix.yml` green at least once on a real N-1 → N transition (which means the very first transition is a contrived "v0.9.0-rc1 → v0.9.0" pair seeded by plan 09-11).

## Sources

### Primary (HIGH confidence)
- [CloudNativePG ImageCatalog docs](https://cloudnative-pg.io/docs/1.28/image_catalog/) — Cluster spec override patterns.
- [CloudNativePG Cluster API reference](https://cloudnative-pg.io/docs/1.28/cloudnative-pg.v1/) — `imageName`, `imageCatalogRef`, `bootstrap.initdb`, `backup.barmanObjectStore`.
- [CloudNativePG Connection Pooling](https://cloudnative-pg.io/docs/1.28/connection_pooling/) — `Pooler` CR alternative to first-party PgBouncer.
- [Helm Chart Hooks docs](https://helm.sh/docs/topics/charts_hooks/) — pre-install / pre-upgrade / test hook semantics, weight ordering, deletion policies.
- [Helm Chart Tests docs](https://helm.sh/docs/topics/chart_tests/) — `helm test` annotation pattern.
- [Helm template `fail` action](https://helm.sh/docs/chart_template_guide/control_structures/) — render-time refusal pattern.
- [Squawk docs — safe migrations](https://squawkhq.com/docs/safe_migrations) + [Squawk CLI](https://squawkhq.com/docs/cli/) + [squawk-action GitHub Action](https://github.com/sbdchd/squawk-action).
- [Traefik 3 IngressRoute CRD reference](https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/crd/http/ingressroute/) + [Traefik EntryPoints reference](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/).
- [Traefik Helm chart EXAMPLES](https://github.com/traefik/traefik-helm-chart/blob/master/EXAMPLES.md).
- [cert-manager + Traefik + Let's Encrypt walkthrough (Traefik blog)](https://traefik.io/blog/secure-web-applications-with-traefik-proxy-cert-manager-and-lets-encrypt).

### Secondary (MEDIUM confidence)
- [External Secrets Operator concepts](https://external-secrets.io/) — `ExternalSecret`, `SecretStore`, `ClusterSecretStore`.
- [pgroll README](https://github.com/xataio/pgroll) — confirms pgroll is a **runner**, not a linter (rules out as squawk replacement).
- [kind GitHub Action](https://github.com/helm/kind-action) — kind cluster setup in GHA, default kubectl version handling.
- [prometheus-adapter](https://github.com/kubernetes-sigs/prometheus-adapter) — custom-metrics HPA prereq for BullMQ queue-depth scaling.
- [chart-releaser-action](https://github.com/helm/chart-releaser-action) — standard chart-publish workflow for tagged releases.

### Tertiary (LOW — assumed / convention-derived)
- All `[ASSUMED]` claims in the Assumptions Log table. Most are conventional defaults; user/discuss-phase confirmation tightens to MEDIUM/HIGH.

## Metadata

**Confidence breakdown:**
- Chart skeleton + service mapping: HIGH — direct compose-to-chart translation, well-trodden Helm patterns.
- CNPG Postgres 17 override: HIGH — official docs verify the `imageName` / `imageCatalogRef + major` patterns.
- Traefik 3 two-entrypoint IngressRoute: HIGH — Traefik docs + Phase 04 Plan 05 prior art.
- HPA: MEDIUM — CPU baseline is HIGH; custom-metric (queue depth) is MEDIUM pending prometheus-adapter availability.
- Squawk PR gate: HIGH — squawkhq.com is authoritative + GitHub Action exists.
- Upgrade-matrix workflow: HIGH for shape, MEDIUM for N-1 tag discovery mechanism.
- Secrets management posture: MEDIUM — inline+ESO recommendation needs user lock at discuss-phase.
- `pg_partman` resolution: MEDIUM — three viable options, option 1 (custom image) is the recommendation but not the only path.
- First-launch SLO probe: HIGH — pattern is standard `helm test`, probe code is straightforward.

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days — CNPG and Traefik release cadence is moderate; squawk is stable; Helm core unchanged in years).
