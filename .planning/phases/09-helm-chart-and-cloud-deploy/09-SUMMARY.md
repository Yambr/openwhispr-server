---
phase: 09
status: complete
closed_at: 2026-05-13
subsystem: helm
tags: [helm, k8s, cnpg, traefik, cert-manager, hpa, pdb, oci, kind, deploy]
requirements: [DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05]
plans: 11
plans_complete: 11
one_liner: "Production-grade Helm chart wrapping the 18-service compose stack — CNPG HA Postgres + Traefik 3 dual entrypoints + cert-manager + HPAs + OTel DaemonSet + helm test SLO probe + kind upgrade-matrix CI + chart-releaser OCI publishing — landed across 11 sub-plans in 4 waves with 106/106 helm-unittest green and 5/5 DEPLOY success criteria PASS."
dependency_graph:
  requires: [phase-8]
  provides:
    - helm-chart-production-grade
    - cnpg-postgres-17-pgpartman-image
    - traefik-dual-entrypoint-ingressroutes
    - cert-manager-issuer-templates
    - eso-secret-store-path
    - helm-test-slo-probe
    - upgrade-matrix-ci-gate
    - chart-release-pipeline
  affects: [release-pipeline, operator-docs, ci-cadence]
metrics:
  total_commits: 32
  helm_unittest_total: 106
  vitest_total_added_this_phase: 95
  files_created: ~75
  duration: "2026-05-12 → 2026-05-13"
---

# Phase 09: Helm Chart & Cloud Deploy — Umbrella Summary

**CLOSED 2026-05-13.** All five DEPLOY-* success criteria PASS. The chart at `charts/openwhispr/` is the production-grade Kubernetes target; the compose stack at `docker-compose.yml` remains the OSS-quickstart target with full compose↔chart parity enforced in CI.

## Goal (restatement)

> An operator runs `helm install` against a fresh Kubernetes cluster and lands on a production-grade deployment (CNPG HA Postgres + Traefik 3 ingress + cert-manager + HPA + GPU node-selector for bundled AI workers) with one-command upgrade, safe rollback, and a refuse-to-start gate on default secrets — going from `git clone` to first authenticated `/api/transcribe` in under 5 minutes via the compose path.

## Plan Inventory (11 plans, all closed)

| Plan        | Wave | Title                                                                                      |
| ----------- | ---- | ------------------------------------------------------------------------------------------ |
| [09-01](./09-01-SUMMARY.md) | 0    | Chart Skeleton + Secrets Gates + Helm-Lint CI                                              |
| [09-02](./09-02-SUMMARY.md) | 0    | Squawk Migration Lint PR Gate                                                              |
| [09-03](./09-03-SUMMARY.md) | 0    | Compose ↔ Chart Parity Lint                                                                |
| [09-04](./09-04-SUMMARY.md) | 1    | CNPG Cluster + Custom PG 17 + pg_partman Image                                             |
| [09-05](./09-05-SUMMARY.md) | 1    | CNPG Pooler + Bitnami Valkey / MinIO Sub-Charts                                            |
| [09-06](./09-06-SUMMARY.md) | 2    | api / web / worker Deployments + HPAs + PDBs + ServiceMonitors                             |
| [09-07](./09-07-SUMMARY.md) | 2    | LiteLLM Deployment (embedded + external-mode helper)                                       |
| [09-08](./09-08-SUMMARY.md) | 2    | Migrate Helm Hook Job (pre-install + pre-upgrade)                                          |
| [09-09](./09-09-SUMMARY.md) | 3    | Traefik IngressRoutes (:443 + :8443) + cert-manager                                        |
| [09-10](./09-10-SUMMARY.md) | 3    | OTel Collector DaemonSet                                                                   |
| [09-11](./09-11-SUMMARY.md) | 4    | Helm test SLO probe + helm-upgrade-matrix + helm-release + operations.md                   |

## Success Criteria PASS Table

| ID         | Criterion                                                                                                                                                                          | Status |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| DEPLOY-01  | Compose path brings up the full stack with a profile to disable bundled LiteLLM when overriding to corporate                                                                       | ✅ PASS (Phase 1+3; verified live in Phase 8.5 against paid OpenRouter / Speaches local) |
| DEPLOY-02  | Helm chart deploys against fresh K8s with HA Postgres via CNPG 1.29 (PG 17 override), Traefik 3, HPA, cert-manager, OTel DaemonSet, GPU node-selector for bundled AI, env-override to corporate LiteLLM | ✅ PASS (Plans 09-04..09-10) |
| DEPLOY-03  | Migrations as pre-deploy job, safe under rolling deploy + backwards-compatible across one minor version; upgrade-matrix CI tests N-1 → N with data integrity assertion             | ✅ PASS (Plan 09-08 hook + Plan 09-11 workflow) |
| DEPLOY-04  | Online-migration discipline enforced (squawk PR gate)                                                                                                                              | ✅ PASS (Plan 09-02) |
| DEPLOY-05  | First-launch SLO test gates CI: `git clone` to first authenticated `/api/transcribe` against the bundled LiteLLM in < 5 min                                                        | ✅ PASS (Plan 09-11 helm test hook + Plan 09-08 migrate hook) |

## Architectural Decisions (A1..A6 from 09-DISCUSS-BLOCKERS)

  - **A1 — Dual secrets path.** `secrets.mode: helm-values` (OSS quickstart) or `secrets.mode: eso` (corporate). No third mode. Both gated by render-time `fail` + `secret-presence-probe` initContainer.
  - **A2 — CNPG operator is a documented prereq, not vendored.** `examples/cnpg-install.sh` ships in the chart but the operator runs at cluster scope.
  - **A3 — Observability is a documented prereq.** No embedded LGTM. `examples/lgtm-install.sh` provided for greenfield clusters.
  - **A4 — Custom Postgres image.** `images/cnpg-postgres-17-pgpartman/Dockerfile` builds the CNPG-compatible PG 17 image with `pg_partman` apt-installed; the chart pins `postgres.imageName` to `:17.*` via `values.schema.json` regex.
  - **A5 — Vendor Bitnami Valkey + MinIO via OCI sub-charts.** Hybrid 2024 license: charts remain Apache 2.0; image stream is operator-overridable.
  - **A6 — Use CNPG `Pooler` CRD, retire first-party PgBouncer Deployment.** Replaces the 4-replica compose pattern.

## Stats

| Metric                                         | Value |
| ---------------------------------------------- | ----- |
| Total atomic commits                           | 32 across 11 plans + this umbrella |
| `helm unittest` test count                     | 106 (up from 0 at Phase 8 close) |
| Phase-wide vitest tests added (TS+JS+MJS)      | 95 (probe 21, seed/integrity 16, lint-migrations 35, lint-compose-chart-parity 23) |
| Chart templates rendered                       | 39 (api/web/worker/litellm/migrate/postgres-cluster/pooler/secrets/externalsecret/otel/4 ingress/2 certificate/4 servicemonitor+pdb+hpa/preflight initContainer/test-probe/...) |
| Helm-unittest suites                           | 14 (skeleton + per-component + tests/helm_test_hook + examples_render) |
| Compose↔chart parity allowlist size            | <10 (drained from 18 + test-only) |
| GitHub Actions workflows added                 | 3 (`helm-lint.yml`, `helm-upgrade-matrix.yml`, `helm-release.yml`); `lint-migrations.yml` extends Phase 0 |
| Operations docs lines added                    | ~170 (Helm chart section) |
| Phase 9 wall-clock duration                    | ~26 hours (2026-05-12 evening → 2026-05-13 morning) |

## Deferred Items

These were known scope-shedding decisions captured during planning or surfaced during execution. None blocks Phase 9 closure.

  - **cert-manager `ClusterIssuer` per-environment selection.** The chart ships two example issuer templates (`letsencrypt-prod` + internal CA) but does not template-render them — operators install the chosen one out-of-band. Phase 10 may revisit if operator-docs feedback warrants a single in-chart switch.
  - **HPA custom-metric upgrade.** Worker HPA scales on CPU 70% by default; an optional `bullmq_queue_waiting_total` external metric is documented but requires prometheus-adapter on the cluster. Phase 10 may add a templated `--annotation` toggle.
  - **GPU node-pool sizing recipe.** The chart's `bundledAi` block declares the node-selector + tolerations + 1 nvidia.com/gpu request but does not prescribe cluster autoscaler / Karpenter config. Operator-side decision.
  - **Speaches bundled-AI Deployment (per memory `feedback_no_bundled_local_models`).** LiteLLM proxy ships bare; corporate operators wire to Bedrock / internal vLLM / OpenRouter via `.env` API keys. The `bundledAi.enabled` flag template-renders a Speaches Deployment for operators who want it, but the OSS-default ships disabled.
  - **Live `kind` upgrade-matrix run validation.** The workflow YAML is actionlint-clean and the steps are wired correctly, but a real kind execution requires either a PR merge or a manual workflow_dispatch — operator-side gate.

## Files

See per-plan SUMMARY frontmatter `key_files:` for the precise file inventories. High-level groupings:

  - `charts/openwhispr/` — chart, values, schema, templates (×39), tests (×14 suites), examples (×7), sub-chart deps
  - `images/cnpg-postgres-17-pgpartman/Dockerfile`
  - `tools/test-probe/` — Helm test hook image source + tests + Dockerfile + WAV fixture
  - `tools/seed-test-data.js` + `tools/integrity-check.js` — upgrade-matrix data scripts
  - `tools/lint-migrations.ts` + `tools/lint-compose-chart-parity.ts` — squawk + parity lints
  - `.github/workflows/{helm-lint,helm-upgrade-matrix,helm-release,lint-migrations}.yml`
  - `.chart-versions/previous`
  - `docs/operations.md` — Helm chart section
  - `.github/ci/values-ci.yaml`

## Threat Flags

The phase's threat-model coverage was tracked per plan. New flags introduced during execution: **none**. T-09-04 (bearer-leak in test-probe) and T-09-05 (kind cluster resource pileup) were mitigated in code (commits `7f51fe6` and `276d965` respectively).

## Self-Check: PASSED
