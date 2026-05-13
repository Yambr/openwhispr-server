---
phase: 09
status: resolved
created: 2026-05-13
resolved: 2026-05-13
resolutions:
  A1: both — helm-values default + ESO gated by values.yaml secrets.mode
  A2: cluster prerequisite (CNPG installed first; examples/cnpg-install.sh)
  A3: prerequisite + ServiceMonitor only (chart ships SM/PM/OTel ConfigMap, no embedded LGTM)
  A4: custom openwhispr/cnpg-postgres-17-pgpartman image published to GHCR
  A5: Bitnami sub-charts for Valkey + MinIO (verify 2024 licensing acceptable)
  A6: CNPG Pooler CRD (replaces 4-instance pattern A from compose)
---

# Phase 9 Discuss-Phase Blockers

The Phase 9 (Helm Chart + Cloud Deploy) research is complete with HIGH confidence on the chart shape, CNPG override, Traefik two-entrypoint mapping, squawk gate, and GHA upgrade-matrix. Six architectural decisions remain that the user must answer before the planner can produce a non-speculative plan.

**Do not auto-plan Phase 9 without resolving these.** Each is documented with the candidate options, the trade-off, and a recommended default if the user explicitly defers.

## A1. External Secrets Operator (ESO) posture

The chart must handle secrets (LITELLM_MASTER_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, HF_TOKEN, PYANNOTE_API_KEY, POSTGRES_OWNER_PASSWORD, PGBOUNCER_ADMIN_PASSWORD).

- **Option A — Helm values direct (OSS quickstart).** Operator passes secrets via `--set` or values.yaml; chart creates `Secret` resources. Pros: zero external deps. Cons: secrets in values.yaml unless operator pipes via stdin or external secret manager.
- **Option B — ESO with `ClusterSecretStore` (corp default).** Chart includes `ExternalSecret` resources templating against operator's ESO; secrets pulled from Vault / AWS / GCP / Azure at sync time. Pros: corporate standard. Cons: ESO is a hard cluster prerequisite.
- **Option C — Both, gated by `values.yaml: secrets.mode: helm-values | eso`.** Recommended default.

**Recommendation:** Option C. OSS quickstart gets Helm-values mode; corp operators flip to ESO. The chart README documents both.

## A2. CNPG operator embedding

CloudNativePG (CNPG) is the chosen Postgres HA operator (1.29 per STACK.md).

- **Option A — Embed CNPG as a Helm dependency (sub-chart).** Pros: single `helm install` brings everything. Cons: cluster-scoped CRDs from a sub-chart is fragile; conflicts if operator already installed.
- **Option B — Document CNPG as a cluster prerequisite.** README says "install CNPG operator first per <link>", chart uses `Cluster` CRD assuming it's available. Pros: matches CNPG's own recommendation. Cons: 2-step install for OSS operators.

**Recommendation:** Option B. Cluster-scoped operators don't belong in app sub-charts. README + `examples/cnpg-install.sh` make it one-line.

## A3. LGTM observability stack embedding

Loki + Grafana + Tempo + Mimir + OTel Collector — already wired in compose.

- **Option A — Embed all 5 as Helm dependencies.** Pros: single install. Cons: 5 sub-charts massively bloat the chart; operators almost always have existing observability.
- **Option B — Document as cluster prerequisite.** Chart only ships `ServiceMonitor` + `PodMonitor` + OTel ConfigMap. Pros: leverages existing observability investments.
- **Option C — Optional flag `values.observability.embedded: true`.** Default false; turning on includes the 5 sub-charts.

**Recommendation:** Option B with a `examples/lgtm-install.sh` script for greenfield clusters.

## A4. pg_partman in CNPG image

Phase 6 plan 06-02 added pg_partman for the `audit_log` monthly RANGE partition. CNPG's default Postgres images do NOT include pg_partman.

- **Option A — Build `openwhispr/cnpg-postgres-17-pgpartman` custom image** based on CNPG's PG 17 image with pg_partman compiled in. Pros: clean schema-level partition continues to work. Cons: custom image registry burden.
- **Option B — Rework Phase 1/6 partitioning to use Postgres-native declarative partitioning + manual maintenance jobs.** Pros: stock image. Cons: more code, more maintenance.

**Recommendation:** Option A. The image is straightforward to build (apt install postgresql-17-partman in the Dockerfile) and the CI matrix can publish it to GHCR.

## A5. Bitnami vs operator sub-charts for Valkey / MinIO

- **Option A — Vendor Bitnami Helm charts for Valkey + MinIO.** Both Bitnami charts have decent multi-arch + sensible defaults. Pros: zero in-repo Helm templates for these. Cons: Bitnami licensing recently changed; corporate may not allow.
- **Option B — Use the dedicated operators (Redis Operator for Valkey, MinIO Operator).** Pros: native HA + automated upgrades. Cons: cluster-scoped operator setup overhead.
- **Option C — Hand-roll minimal templates.** Pros: zero deps. Cons: more code to maintain.

**Recommendation:** Option A for OSS quickstart; document Option B in `examples/` for corp ops.

## A6. PgBouncer: pattern A (current 4-instance scale-out) or CNPG `Pooler`

Phase 8 has 4 PgBouncer instances behind a shared docker network alias `pgbouncer` (DNS round-robin).

- **Option A — Replicate the 4-instance pattern as Kubernetes Deployments + headless Service.** Pros: matches compose semantics 1:1.
- **Option B — Use CNPG's built-in `Pooler` CRD** which provisions PgBouncer attached to the Cluster. Pros: native CNPG integration, automatic credential rotation. Cons: less control over individual instance settings.

**Recommendation:** Option B (CNPG Pooler). Less code, native HA, automatic SCRAM credential management — the Phase 08.1 admin password fix becomes built-in.

## How to unblock

After the user answers all 6 questions (or accepts the recommended defaults verbatim), the planner can be spawned with the resolutions baked in. Suggest:

```
/gsd-plan-phase 9 --skip-research  (research is done)
```

…and update this file to `status: resolved` before spawning.

## Research file

`.planning/phases/09-helm-chart-and-cloud-deploy/09-RESEARCH.md` (498-line technical analysis with chart skeleton, CNPG cluster spec, Traefik IngressRoute templates, HPA, GPU node-selector, helm test hook design, upgrade-matrix GHA outline, squawk lint, secrets shape).
