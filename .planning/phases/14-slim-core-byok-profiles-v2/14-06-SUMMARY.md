---
phase: 14-slim-core-byok-profiles-v2
plan: 06
subsystem: helm-chart
tags: [byok, helm, toggles, compose-parity]
requires: [14-01, 14-03, 14-04]
provides:
  - "observability.enabled umbrella toggle (AND-gates collector + serviceMonitor sub-toggles)"
  - "storage.enabled toggle (gates minio sub-chart + MINIO_ENDPOINT env injection on api/worker)"
  - "tls.enabled toggle (gates IngressRoute / Middleware / ServersTransport / Certificate)"
  - "pooler.enabled default flipped true->false (slim-core compose parity)"
  - "mailpit.enabled informational-only toggle (parity linter recognition)"
  - "cloud-HA values overlay flipping the four production toggles back on"
affects:
  - charts/openwhispr/Chart.yaml
  - charts/openwhispr/values.yaml
  - charts/openwhispr/templates/api-deployment.yaml
  - charts/openwhispr/templates/worker-deployment.yaml
  - charts/openwhispr/templates/api-servicemonitor.yaml
  - charts/openwhispr/templates/worker-servicemonitor.yaml
  - charts/openwhispr/templates/otel-collector-{daemonset,configmap,serviceaccount,clusterrole,clusterrolebinding}.yaml
  - charts/openwhispr/templates/ingressroute-{api,api-realtime,web}.yaml
  - charts/openwhispr/templates/serverstransport-realtime.yaml
  - charts/openwhispr/templates/middleware-forwarded-headers.yaml
  - charts/openwhispr/templates/certificate-{api,web}.yaml
  - charts/openwhispr/tests/{observability,storage,tls,mailpit,pooler,ingress,api,worker,otel,subcharts}_test.yaml
  - charts/openwhispr/examples/values-cloud-ha.yaml
  - tools/lint-compose-chart-parity.ts
tech-stack:
  added: []
  patterns:
    - "umbrella AND-gate: outer top-level toggle + inner sub-toggle, both must be true for resource to render"
    - "1:1 compose-overlay-to-Helm-toggle mapping for parity linter recognition"
key-files:
  created:
    - charts/openwhispr/tests/observability_test.yaml
    - charts/openwhispr/tests/storage_test.yaml
    - charts/openwhispr/tests/tls_test.yaml
    - charts/openwhispr/tests/mailpit_test.yaml
  modified:
    - charts/openwhispr/values.yaml
    - charts/openwhispr/Chart.yaml
    - charts/openwhispr/examples/values-cloud-ha.yaml
    - charts/openwhispr/templates/api-deployment.yaml
    - charts/openwhispr/templates/worker-deployment.yaml
    - "+ 13 other templates wrapped with tls / observability gates"
    - charts/openwhispr/tests/pooler_test.yaml
    - charts/openwhispr/tests/ingress_test.yaml
    - charts/openwhispr/tests/api_test.yaml
    - charts/openwhispr/tests/worker_test.yaml
    - charts/openwhispr/tests/otel_test.yaml
    - charts/openwhispr/tests/subcharts_test.yaml
    - tools/lint-compose-chart-parity.ts
decisions:
  - "Honored CONTEXT decision 6 + RESEARCH §C.1 recommendation (b): mailpit.enabled is informational-only, NO mailpit-deployment.yaml template added. The toggle exists solely for parity-linter 1:1 mapping."
  - "Kept non-toggle ingress.* sub-keys (realtimeEntrypointName, trustedIPs, preflight*) as-is rather than renaming to tls.* — RESEARCH §C.1 churn-avoidance recommendation."
  - "Cloud-HA overlay incidentally fixed a pre-existing typo (`otelCollector` instead of `collector`) — the upstream key was unreachable so this is a Rule 1 bug-fix consolidated into the overlay rewrite."
  - "Parity linter DEFAULT_HELM_ARGS was promoted from slim-core defaults to full-profile (all toggles on) so the union-overlay compose service set has chart resources to match against. Slim-core default rendering is still verified by the dedicated tls_test/storage_test/observability_test/pooler_test suites."
metrics:
  duration_minutes: ~30
  completed: "2026-05-14"
---

# Phase 14 Plan 06: 5 Helm BYOK Toggles + Template Gates Summary

One-liner: brought the OpenWhispr Helm chart to 1:1 parity with the Phase 14 compose-overlay layer via five top-level `*.enabled` toggles (observability umbrella, storage, tls, pooler-flipped, mailpit informational), with full helm-unittest coverage and parity-linter integration.

## Toggles Added / Flipped (5)

| Toggle                  | Before                            | After                             | Compose overlay                                                |
| ----------------------- | --------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `observability.enabled` | (absent)                          | NEW umbrella, default `false`     | `compose/docker-compose.observability.yml`                     |
| `storage.enabled`       | (absent — only `minio.enabled`)   | NEW, default `false`              | `compose/docker-compose.storage.yml`                           |
| `tls.enabled`           | (absent — only `ingress.*` block) | NEW, default `false`              | `compose/docker-compose.ingress.yml`                           |
| `pooler.enabled`        | `true` (HA default)               | `false` (slim-core default)       | `compose/docker-compose.pgbouncer.yml`                         |
| `mailpit.enabled`       | (absent)                          | NEW informational-only, `false`   | `compose/docker-compose.dev-tools.yml` (informational mapping) |

## Templates Gated

### `tls.enabled` (7 templates)

- `templates/ingressroute-api.yaml`
- `templates/ingressroute-api-realtime.yaml`
- `templates/ingressroute-web.yaml`
- `templates/serverstransport-realtime.yaml`
- `templates/middleware-forwarded-headers.yaml`
- `templates/certificate-api.yaml` (AND-gated with existing `certManager.enabled`)
- `templates/certificate-web.yaml` (AND-gated with existing `certManager.enabled`)

### `observability.enabled` AND-gate (7 templates)

- `templates/otel-collector-daemonset.yaml` (AND with `collector.enabled`)
- `templates/otel-collector-configmap.yaml` (AND with `collector.enabled`)
- `templates/otel-collector-serviceaccount.yaml` (AND with `collector.enabled`)
- `templates/otel-collector-clusterrole.yaml` (AND with `collector.enabled`)
- `templates/otel-collector-clusterrolebinding.yaml` (AND with `collector.enabled`)
- `templates/api-servicemonitor.yaml` (AND with `serviceMonitor.enabled`)
- `templates/worker-servicemonitor.yaml` (AND with `serviceMonitor.enabled`)

### `storage.enabled` (3 places)

- `Chart.yaml` — Bitnami minio sub-chart `condition: storage.enabled` (was `condition: minio.enabled`)
- `templates/api-deployment.yaml` — `MINIO_ENDPOINT` env injection block
- `templates/worker-deployment.yaml` — `MINIO_ENDPOINT` env injection block

### `pooler.enabled` — default flipped only; existing `templates/pooler.yaml` guard unchanged.

### `mailpit.enabled` — NO template change (informational-only per CONTEXT decision 6).

## helm-unittest Coverage Delta

| Metric                  | Before | After | Delta |
| ----------------------- | ------ | ----- | ----- |
| Total test suites       | 15     | 19    | +4    |
| Total assertion cases   | 125    | 156   | +31   |
| Suite pass status       | 15/15  | 19/19 | -     |

New suites: `observability_test.yaml` (9 cases), `storage_test.yaml` (4 cases), `tls_test.yaml` (14 cases), `mailpit_test.yaml` (3 cases).

Extended suites: `pooler_test.yaml` (default-render case flipped + cloud-HA case requires explicit `pooler.enabled=true`), `ingress_test.yaml` (suite-level `set: tls.enabled: true`), `api_test.yaml` + `worker_test.yaml` (ServiceMonitor cases AND-gated with umbrella), `otel_test.yaml` (every collector render case AND-gated with umbrella), `subcharts_test.yaml` (MinIO render cases AND-gated with `storage.enabled`).

## Default-Render Manifest (Slim-Core Profile)

After this plan, `helm template charts/openwhispr` with values-ci.yaml defaults emits:

- **Renders:** Cluster (CNPG), ConfigMap (6), Deployment (api/web/worker/litellm), Job (migrate), NetworkPolicy, PodDisruptionBudget, Role/RoleBinding/Secrets (3), Service (6), ServiceAccount (3), StatefulSet (valkey).
- **Suppresses:** 0 IngressRoute, 0 Middleware, 0 ServersTransport, 0 Certificate, 0 DaemonSet, 0 ServiceMonitor, 0 Pooler, 0 MinIO sub-chart, 0 `MINIO_ENDPOINT` env entries on api/worker.

Full-profile render (all four toggles on) adds: 3 IngressRoute, 1 Middleware, 1 ServersTransport, 2 Certificate, 1 DaemonSet, 2 ServiceMonitor, 1 Pooler, 1 MinIO Deployment + Secret/Service, 2 `MINIO_ENDPOINT` env entries.

## Cloud-HA Overlay Deltas

`charts/openwhispr/examples/values-cloud-ha.yaml`:

- NEW top-level block: `storage.enabled: true`, `tls.enabled: true`, `pooler.enabled: true`, `mailpit.enabled: false`.
- Consolidated former two `observability:` blocks into one with `enabled: true`, `serviceMonitor.enabled: true`, `collector.enabled: true`, `lgtm.endpoint: https://otlp.example.com` (placeholder satisfying values.schema.json — operator replaces before install).
- Pre-existing typo fixed: legacy `otelCollector` (unreachable) renamed to canonical `collector` (Rule 1).

## Parity Linter Change

`tools/lint-compose-chart-parity.ts` `DEFAULT_HELM_ARGS` extended with:

```
--set observability.enabled=true
--set storage.enabled=true
--set tls.enabled=true
--set pooler.enabled=true
```

So the linter renders the full-profile chart (matching the union of slim-core base + every overlay) and reports 1:1 parity GREEN. Without this, the linter would have falsely reported `minio / otel-collector / pgbouncer` as missing.

## Commits

| Hash    | Type | Description                                                                                                            |
| ------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 56656ee | test | RED helm-unittest for 5 BYOK toggles (14 failures across observability/storage/tls/pooler suites)                       |
| 356a02d | feat | GREEN values.yaml + Chart.yaml + 17 template/test edits (SEE DEVIATIONS — incidentally bundled into 14-05 docs commit) |
| b1702d2 | feat | Cloud-HA values override + parity linter full-profile render                                                            |

## Verification

```
$ helm unittest charts/openwhispr
Test Suites: 19 passed, 19 total
Tests:       156 passed, 156 total

$ helm lint charts/openwhispr
1 chart(s) linted, 0 chart(s) failed

$ pnpm vitest run tools/lint-compose-chart-parity.test.ts
Test Files  1 passed (1)
     Tests  36 passed (36)

$ helm template ow charts/openwhispr ... | grep -c "kind: IngressRoute"
0      # slim-core default
$ helm template ow charts/openwhispr --set tls.enabled=true ... | grep -c "kind: IngressRoute"
3      # full profile
```

## Deviations from Plan

### Parallel-execution attribution mishap (process deviation, not a code defect)

Plan 14-05 ran in parallel and shared the same git index (no worktree isolation per the run prompt). When I had completed the Task 2 GREEN edits and queued `git add` + `git commit`, plan 14-05's own `git commit` ran concurrently and absorbed my staged hunks into its `docs(14-05): complete virtual-key-rotation removal plan` commit (356a02d). The work is functionally correct and committed — values.yaml, Chart.yaml, all 17 template/test edits landed on `main` — but the commit message belongs to plan 14-05.

Mitigation taken:

- Plan 14-05's executor acknowledged the bundle in a follow-up commit `ccc711b docs(14-05): note bundled chart commit in summary deviations`.
- This SUMMARY explicitly records the correct attribution (Task 2 → commit 356a02d).
- Earlier in the run, I caught and reverted a similar mishap (commit f9db2ce — `git reset --soft` + selective re-stage) before the wrongly-bundled commit had any downstream effect. The second mishap landed before I could intervene.

Root cause: orchestrator's "inline on `main`, no worktree" execution policy makes the git index a shared resource across parallel executors. Recommendation for future parallel runs: either spawn each executor in its own worktree, or serialize parallel-safe plans that touch staged state.

No code correctness impact. helm-unittest, helm lint, and the parity linter all GREEN against the final state.

### Rule 1 bug found: cloud-HA overlay had unreachable `otelCollector` key

The pre-existing `charts/openwhispr/examples/values-cloud-ha.yaml` used `otelCollector.enabled: true` — but the chart's templates read `.Values.observability.collector.enabled`. The legacy key was silently ignored, meaning the canonical cloud-HA overlay would have rendered ZERO collector resources despite the operator's apparent intent. Renamed to `collector` while consolidating the two `observability:` blocks into one for Plan 14-06.

### Rule 2 critical: cloud-HA overlay missing `observability.lgtm.endpoint`

With the umbrella + collector both on, `values.schema.json` requires a non-empty `https?://` URL for `observability.lgtm.endpoint`. The pre-existing overlay omitted it; an operator copying this overlay would hit a schema-validation failure at `helm install`. Added a documented placeholder `https://otlp.example.com` so the overlay renders cleanly; operator instructions in the comment direct them to substitute their real OTLP/HTTP ingest URL.

## Self-Check: PASSED

- helm unittest charts/openwhispr: 156/156 PASS
- helm lint charts/openwhispr: GREEN (1 INFO about icon — unchanged from baseline)
- pnpm vitest run tools/lint-compose-chart-parity.test.ts: 36/36 PASS
- charts/openwhispr/values.yaml contains: `storage:\n  enabled: false` ✓
- charts/openwhispr/Chart.yaml contains: `condition: storage.enabled` ✓
- All 4 new test files exist on disk: observability_test.yaml, storage_test.yaml, tls_test.yaml, mailpit_test.yaml ✓
- All 3 commits present in `git log --oneline -20`: 56656ee, 356a02d, b1702d2 ✓
