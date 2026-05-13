---
phase: 09
plan: 00
type: execute
wave: 0
depends_on: []
files_modified: []
autonomous: false
requirements: [DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05]
umbrella: true
tags: [helm, k8s, cnpg, traefik, cert-manager, hpa, deploy, gha, kind]
must_haves:
  truths:
    - "Operator runs `helm install` against a fresh kind cluster with CNPG+Traefik+cert-manager preinstalled and reaches green pods within `helm install --wait --timeout 10m`."
    - "Operator's first authenticated `/api/transcribe` succeeds within 5 minutes from `git clone` (helm test SLO probe enforces)."
    - "`helm install` refuses to start when any secret is empty or a placeholder string (`CHANGE_ME`) at render time (helm-values mode), or at pod-start initContainer (eso mode)."
    - "Migrations execute as a pre-install/pre-upgrade Helm hook Job; `helm rollback` reverts cleanly within one minor version."
    - "Upgrade-matrix GHA workflow installs N-1 chart, seeds data, upgrades to HEAD, runs helm test, asserts seeded data integrity — all green."
    - "Squawk PR-gate blocks migrations that lack `CONCURRENTLY`, `NOT VALID`, or batched column adds."
    - "Compose-parity lint blocks PRs adding compose services without corresponding chart resources."
    - "Two TLS entrypoints (:443 short-JSON + :8443 long-WSS) route correctly via two Traefik IngressRoute CRs on distinct entryPoints."
    - "Bundled-AI Speaches Deployment renders only when `bundledAi.enabled=true` with GPU nodeSelector+tolerations+`nvidia.com/gpu: 1`."
    - "CNPG `Cluster` CR pins PG 17 via custom `openwhispr/cnpg-postgres-17-pgpartman` image, with `pg_partman_bgw` in `shared_preload_libraries`."
    - "CNPG `Pooler` CRD replaces compose 4-instance PgBouncer pattern (per A6)."
  artifacts:
    - path: "charts/openwhispr/Chart.yaml"
      provides: "Chart metadata, appVersion locked to release tag"
    - path: "charts/openwhispr/values.yaml"
      provides: "Default values including secrets.mode, bundledAi.enabled=false, postgres.imageName pinned to :17., observability.embedded=false"
    - path: "charts/openwhispr/values.schema.json"
      provides: "JSON Schema enforcing secret minLength + placeholder regex ban + image-tag regex"
    - path: "charts/openwhispr/templates/postgres-cluster.yaml"
      provides: "CNPG Cluster CR with PG 17 imageName override + pg_partman shared_preload_libraries + barmanObjectStore"
    - path: "charts/openwhispr/templates/pooler.yaml"
      provides: "CNPG Pooler CRD for PgBouncer (replaces first-party Deployment per A6)"
    - path: "charts/openwhispr/templates/ingressroute-api.yaml"
      provides: "Traefik IngressRoute on websecure entrypoint (:443) for /api short-JSON"
    - path: "charts/openwhispr/templates/ingressroute-api-realtime.yaml"
      provides: "Traefik IngressRoute on websecure-realtime entrypoint (:8443) for /v1/realtime"
    - path: "charts/openwhispr/templates/migrate-job.yaml"
      provides: "pre-install/pre-upgrade Helm hook Job running drizzle migrate against CNPG cluster"
    - path: "charts/openwhispr/templates/tests/first-launch-slo.yaml"
      provides: "helm test hook pod running test-probe against deployed stack with 300s SLO deadline"
    - path: "charts/openwhispr/templates/secrets.yaml"
      provides: "Render-time `fail` gates + inline Secret resource (helm-values mode)"
    - path: "charts/openwhispr/templates/externalsecret.yaml"
      provides: "ESO ExternalSecret resource (eso mode) gated on secrets.mode"
    - path: "charts/openwhispr/templates/deployment-speaches.yaml"
      provides: "Bundled-AI Speaches Deployment with GPU nodeSelector, gated on bundledAi.enabled"
    - path: "charts/openwhispr/templates/hpa-api.yaml"
      provides: "HPA for api on CPU 70% utilization with PDB sibling"
    - path: "charts/openwhispr/templates/hpa-worker.yaml"
      provides: "HPA for worker with optional bullmq_queue_waiting_total external metric"
    - path: "charts/openwhispr/templates/otel-collector-daemonset.yaml"
      provides: "OTel Collector DaemonSet with hostNetwork + Phase 06 collector ConfigMap port"
    - path: "charts/openwhispr/examples/cnpg-install.sh"
      provides: "One-line CNPG operator install script (A2)"
    - path: "charts/openwhispr/examples/lgtm-install.sh"
      provides: "Greenfield LGTM stack install (A3 documented prereq)"
    - path: "charts/openwhispr/examples/traefik-values.yaml"
      provides: "Required Traefik install values with websecure + websecure-realtime entrypoints"
    - path: "charts/openwhispr/examples/values-oss-quickstart.yaml"
      provides: "OSS quickstart overlay (bundledAi off, observability off, single replicas)"
    - path: "charts/openwhispr/examples/values-corporate-litellm.yaml"
      provides: "Corp overlay (bundledAi off, secrets.mode=eso, LITELLM_BASE_URL override)"
    - path: "tools/test-probe/src/probe.ts"
      provides: "First-launch SLO probe: seed user → transcribe → assert elapsed-ms < 300000"
    - path: "tools/test-probe/Dockerfile"
      provides: "test-probe image build, published to GHCR as openwhispr/test-probe"
    - path: "tools/lint-migrations.ts"
      provides: "Squawk driver: finds new SQL since merge-base, pipes through squawk with pinned rule set"
    - path: "tools/lint-compose-chart-parity.ts"
      provides: "Compose-vs-chart service inventory diff with allowlist for test-only services"
    - path: "tools/seed-test-data.js"
      provides: "Upgrade-matrix data seeder (used by N-1 install step)"
    - path: "tools/integrity-check.js"
      provides: "Upgrade-matrix integrity check (asserts seeded rows survive N-1 → N upgrade)"
    - path: "images/cnpg-postgres-17-pgpartman/Dockerfile"
      provides: "Custom CNPG PG 17 image with postgresql-17-partman apt-installed (A4)"
    - path: ".github/workflows/helm-lint.yml"
      provides: "helm lint + helm-unittest + values-schema CI"
    - path: ".github/workflows/helm-upgrade-matrix.yml"
      provides: "kind-based N-1 → N upgrade matrix with helm test SLO and integrity check"
    - path: ".github/workflows/lint-migrations.yml"
      provides: "Squawk PR gate"
    - path: ".github/workflows/helm-release.yml"
      provides: "chart-releaser-action on tagged releases pushing to GHCR Pages"
    - path: ".github/ci/values-ci.yaml"
      provides: "kind-safe overrides (no GPU, no LGTM, RWO storage, observability off)"
    - path: ".chart-versions/previous"
      provides: "Pinned N-1 chart tag for upgrade-matrix workflow"
    - path: "docs/operations.md"
      provides: "Helm chart section: prereqs, install, upgrade, rollback, secrets posture, troubleshooting"
  key_links:
    - from: "charts/openwhispr/templates/migrate-job.yaml"
      to: "templates/postgres-cluster.yaml"
      via: "initContainer pg_isready loop against $(cluster)-rw service"
      pattern: "pg_isready.*-rw"
    - from: "charts/openwhispr/templates/api-deployment.yaml"
      to: "templates/pooler.yaml"
      via: "DATABASE_URL pointing at Pooler service"
      pattern: "DATABASE_URL.*-pooler"
    - from: "charts/openwhispr/templates/ingressroute-api-realtime.yaml"
      to: "examples/traefik-values.yaml"
      via: "entryPoints: [websecure-realtime] matches Traefik install"
      pattern: "websecure-realtime"
    - from: ".github/workflows/helm-upgrade-matrix.yml"
      to: "charts/openwhispr/templates/tests/first-launch-slo.yaml"
      via: "helm test ow --timeout 5m"
      pattern: "helm test"
    - from: "tools/lint-migrations.ts"
      to: ".github/workflows/lint-migrations.yml"
      via: "pnpm exec tsx tools/lint-migrations.ts --since origin/main"
      pattern: "lint-migrations"
---

# Phase 09: Helm Chart & Cloud Deploy — Umbrella Plan

This umbrella aggregates 11 sub-plans across 4 waves wrapping the 18-service `docker-compose.yml` into the production-grade `charts/openwhispr/` Helm chart, with full CI enforcement (helm lint + helm-unittest + squawk + compose-parity + kind upgrade-matrix + helm test SLO).

## Source Audit (mandatory)

| Source | ID / Item | Disposition | Plan |
|---|---|---|---|
| GOAL | "helm install → green, < 5 min via compose path, refuse-to-start on default secrets" | COVERED | 09-01, 09-08, 09-11 |
| REQ | DEPLOY-01 (compose + bundled-litellm profile + < 5 min quickstart) | COVERED | 09-11 (verification of compose), pre-existing compose validates SLO path |
| REQ | DEPLOY-02 (chart with CNPG + Traefik + HPA + cert-manager + OTel + GPU + disable-bundled-AI) | COVERED | 09-04 (CNPG), 09-05 (Pooler + Valkey + MinIO), 09-06 (api/web/worker + HPA), 09-07 (LiteLLM + Speaches GPU), 09-09 (Traefik + cert-manager), 09-10 (OTel) |
| REQ | DEPLOY-03 (one-command bootstrap + upgrade + safe rollback + refuse on default secrets) | COVERED | 09-01 (fail gates), 09-08 (migrate hook + rollback safety), 09-11 (upgrade-matrix exercises rollback) |
| REQ | DEPLOY-04 (migrate pre-deploy job + safe rolling + N-1 upgrade-matrix + squawk gate) | COVERED | 09-02 (squawk), 09-08 (migrate Job), 09-11 (upgrade-matrix) |
| REQ | DEPLOY-05 (first-launch SLO < 5 min CI-enforced) | COVERED | 09-11 (test-probe + helm test + matrix gate) |
| RESEARCH | CNPG PG 17 override via custom image (A4) | COVERED | 09-04 |
| RESEARCH | CNPG Pooler over first-party PgBouncer (A6) | COVERED | 09-05 |
| RESEARCH | Bitnami Valkey + MinIO sub-charts (A5) | COVERED | 09-05 |
| RESEARCH | ESO opt-in + helm-values default (A1) | COVERED | 09-01 |
| RESEARCH | CNPG + LGTM as cluster prereqs (A2, A3) | COVERED | 09-01 (examples/), 09-10 (ServiceMonitor only) |
| RESEARCH | Two Traefik entrypoints :443 + :8443 | COVERED | 09-09 |
| RESEARCH | GPU nodeSelector for bundled-AI | COVERED | 09-07 |
| RESEARCH | Squawk PR gate (deferred pgroll) | COVERED | 09-02 |
| RESEARCH | Compose-parity lint | COVERED | 09-03 |
| RESEARCH | helm test SLO probe + upgrade-matrix workflow | COVERED | 09-11 |
| RESEARCH | Refuse-to-start fail gates at render + initContainer for ESO | COVERED | 09-01 (render-time), 09-06 (initContainer for ESO) |
| CONTEXT | A1 helm-values + ESO gated by secrets.mode | COVERED | 09-01 |
| CONTEXT | A2 CNPG as prerequisite + examples/cnpg-install.sh | COVERED | 09-01 + 09-04 |
| CONTEXT | A3 LGTM prerequisite + ServiceMonitor + lgtm-install.sh | COVERED | 09-10 + 09-01 |
| CONTEXT | A4 custom openwhispr/cnpg-postgres-17-pgpartman image, GHCR-published | COVERED | 09-04 |
| CONTEXT | A5 Bitnami Valkey + MinIO sub-charts (verify license) | COVERED | 09-05 |
| CONTEXT | A6 CNPG Pooler CRD replaces 4-instance compose | COVERED | 09-05 |

No unplanned items. No deferred-idea leakage.

## Wave Structure

| Wave | Plans | Parallel | Autonomous | Theme |
|---|---|---|---|---|
| 0 | 09-01, 09-02, 09-03 | yes (file-disjoint) | yes | Foundations: skeleton + secrets gates + squawk + compose-parity |
| 1 | 09-04, 09-05 | sequential (Pooler refs Cluster) | yes | Data plane: CNPG Cluster + Pooler + Valkey + MinIO |
| 2 | 09-06, 09-07, 09-08 | yes (file-disjoint) | yes | App plane: api/web/worker, LiteLLM+Speaches, migrate Job |
| 3 | 09-09, 09-10 | yes (file-disjoint) | yes | Ingress + observability: IngressRoutes + cert-manager + OTel DaemonSet |
| 4 | 09-11 | sequential | no (checkpoint: human-verify upgrade-matrix green) | Gates + release: test-probe + upgrade-matrix + release workflow + ops docs |

## Threat Model

### Trust Boundaries

| Boundary | Description |
|---|---|
| operator → helm | values.yaml inputs cross into chart render; placeholder/empty secrets are untrusted input |
| chart render → cluster | rendered manifests cross into apiserver; CRD references must exist (CNPG, Traefik, cert-manager) |
| internet → :443/:8443 | TLS-only ingress; two entrypoints prevent slow-WSS DoS bleed into short-JSON |
| kind CI → GHCR | upgrade-matrix pulls images; must not require humans |

### STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-09-01 | Tampering / InfoDisclosure | values.secrets.* | mitigate | Render-time `helm fail` on empty/`CHANGE_ME`; values.schema.json `minLength: 32` + regex placeholder ban; ESO-mode runs initContainer secret-presence probe (09-01, 09-06) |
| T-09-02 | Tampering | postgres.imageName | mitigate | Chart-lint asserts `:17.` substring; values.schema.json regex `^.*:17\.[0-9]+.*$` (09-04) |
| T-09-03 | DoS | shared timeouts between short-JSON and long-WSS | mitigate | Two Traefik entrypoints with distinct `idleConnTimeout`; Phase 04 Plan 05 carry-over (09-09) |
| T-09-04 | InfoDisclosure | test-probe logs | mitigate | Probe never logs secrets; uses ephemeral test-user bearer token; structured JSON output redacts auth header (09-11) |
| T-09-05 | Resource exhaustion | kind cluster lingering | mitigate | `if: always()` step deletes kind cluster; CI workflow `concurrency` cancels superseded runs (09-11) |
| T-09-06 | ElevationOfPrivilege | OTel Collector hostNetwork | accept | Required for hostmetrics; restrict via PodSecurityPolicy/PSA `privileged` namespace label, RBAC scoped to nodes/metrics only (09-10) |
| T-09-07 | Tampering | migration Job pulls latest image | mitigate | image tag pinned to `Chart.AppVersion` not `latest`; image pull policy `IfNotPresent`; squawk gate blocks unsafe SQL pre-merge (09-02, 09-08) |
| T-09-08 | DoS | bundled-AI pod leaks into CI and pends | mitigate | `values-ci.yaml` hard-sets `bundledAi.enabled=false`; CI assertion greps rendered output for absence of speaches Deployment (09-07, 09-11) |
| T-09-09 | Spoofing | Better Auth secret regression on upgrade | mitigate | secret persisted in cluster across upgrades; chart `metadata.annotations: "helm.sh/resource-policy": keep` on Secret resource (09-01) |
| T-09-10 | Repudiation | helm rollback loses migration audit trail | accept | Drizzle migrations are forward-only; rollback under one-minor-version constraint preserves schema compatibility per DEPLOY-04 contract (09-08) |

## Deferred (NOT in scope)

| Item | Why deferred | Tracking |
|---|---|---|
| cert-manager ClusterIssuer choice (LE-prod vs internal CA) | Per-env decision; chart ships both example files | Documented in 09-09 README; operator selects via `values.certManager.clusterIssuer` |
| HPA custom-metric source (prometheus-adapter for queue depth) | CPU baseline sufficient for v1; custom metric is values opt-in | 09-06 ships the template branch gated on `worker.autoscaling.queueDepthMetric` |
| GPU node-pool sizing recommendations | Cluster-operator concern, not chart concern | Documented in `docs/operations.md` (09-11) |
| pgroll expand/contract migration runner | Squawk + pre-deploy Job sufficient for Phase 9 | Tracked as post-09 enhancement; pitfall #9 documents the multi-release dance convention |
| In-chart LGTM stack (`observability.embedded=true`) | A3 locked to prereq-only | Future enhancement; values key reserved |
| GPU CI matrix entry | No GPU runner in default GHA | Gated behind `[gpu]` label / self-hosted runner future plan |

## Sub-Plans

- 09-01-PLAN.md (Wave 0) — Chart skeleton + secrets fail gates + values.schema.json + helm-lint workflow + example overlays + examples/cnpg-install.sh + examples/lgtm-install.sh
- 09-02-PLAN.md (Wave 0) — tools/lint-migrations.ts (squawk driver) + lint-migrations.yml workflow + good/bad fixture set + ≥90% TS coverage
- 09-03-PLAN.md (Wave 0) — tools/lint-compose-chart-parity.ts + compose-parity workflow integration + allowlist for test-only services + ≥90% TS coverage
- 09-04-PLAN.md (Wave 1) — CNPG Cluster CR template (PG 17 override) + images/cnpg-postgres-17-pgpartman Dockerfile + release-workflow extension for GHCR publish + chart-lint `:17.` assertion + WAL barmanObjectStore to MinIO/S3
- 09-05-PLAN.md (Wave 1) — CNPG Pooler CRD template (replaces PgBouncer Deployment per A6) + Bitnami Valkey sub-chart + Bitnami MinIO sub-chart + Chart.yaml dependencies + license verification note
- 09-06-PLAN.md (Wave 2) — api / web / worker Deployments + Services + HPAs + PDBs + ServiceMonitors + ESO-mode initContainer secret-presence probe
- 09-07-PLAN.md (Wave 2) — LiteLLM Deployment + ConfigMap + bundled-AI Speaches Deployment with GPU nodeSelector + tolerations + nvidia.com/gpu limit, gated on bundledAi.enabled
- 09-08-PLAN.md (Wave 2) — Migrate Job with pre-install/pre-upgrade hook + initContainer pg_isready loop on CNPG -rw service + rolling-deploy safety verification snapshot test
- 09-09-PLAN.md (Wave 3) — IngressRoute :443 (short-JSON) + IngressRoute :8443 (websecure-realtime, long-WSS) + ServersTransport + Middleware forwarded-headers + cert-manager Certificate + examples/traefik-values.yaml + ClusterIssuer examples + preflight initContainer probing Traefik /api/entrypoints
- 09-10-PLAN.md (Wave 3) — OTel Collector DaemonSet + ClusterRole + ServiceAccount + ConfigMap (port Phase 06 collector config) + ServiceMonitor for api/worker
- 09-11-PLAN.md (Wave 4) — tools/test-probe/ package + Dockerfile + GHCR release wiring + helm test SLO hook pod + .github/workflows/helm-upgrade-matrix.yml (kind + N-1→N + integrity check) + .chart-versions/previous + .github/workflows/helm-release.yml (chart-releaser-action) + docs/operations.md chart section + checkpoint:human-verify upgrade-matrix green

## Success Criteria (phase gate)

- All 11 sub-plans verified per their own must_haves
- `helm lint charts/openwhispr` clean
- `helm unittest charts/openwhispr` 100% green
- `helm-upgrade-matrix.yml` green at least once on a real N-1 → N transition (seed v0.9.0-rc1 → v0.9.0 in 09-11)
- `helm test ow --timeout 5m` returns 0 with elapsed-ms < 300000
- Squawk gate fires on `fixtures/bad-migration.sql` (negative test)
- Compose-parity gate fires on fixture missing-service test
- `helm template charts/openwhispr -f charts/openwhispr/tests/values-bad-secret.yaml` exits nonzero with descriptive message
- Coverage ≥ 90/90/90/90 on every TS file under `tools/` introduced this phase
