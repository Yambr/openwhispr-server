---
phase: 09
plan: 06
subsystem: helm-chart
tags: [deploy, helm, k8s, hpa, pdb, eso]
requires:
  - 09-05 (Wave 1: Pooler CR + Bitnami valkey/minio sub-charts)
provides:
  - charts/openwhispr/templates/api-deployment.yaml
  - charts/openwhispr/templates/api-service.yaml
  - charts/openwhispr/templates/api-hpa.yaml
  - charts/openwhispr/templates/api-pdb.yaml
  - charts/openwhispr/templates/api-servicemonitor.yaml
  - charts/openwhispr/templates/configmap-api.yaml
  - charts/openwhispr/templates/worker-deployment.yaml
  - charts/openwhispr/templates/worker-service.yaml
  - charts/openwhispr/templates/worker-hpa.yaml
  - charts/openwhispr/templates/worker-pdb.yaml
  - charts/openwhispr/templates/worker-servicemonitor.yaml
  - charts/openwhispr/templates/configmap-worker.yaml
  - charts/openwhispr/templates/web-deployment.yaml
  - charts/openwhispr/templates/web-service.yaml
  - openwhispr.poolerHost / valkeyHost / minioHost / litellmBaseUrl helpers
  - openwhispr.{api,worker,web,litellm}.selectorLabels helpers
affects:
  - tools/compose-chart-parity.allowlist.json (api/web/worker removed)
  - charts/openwhispr/values.yaml (api/web/worker/litellm sections)
  - charts/openwhispr/values.schema.json (litellm allOf/if/then)
  - charts/openwhispr/examples/values-corporate-litellm.yaml (externalBaseUrl added)
tech-stack:
  added: []
  patterns:
    - "envFrom secretRef <fullname>-secrets + per-pod secret-presence-probe initContainer (pitfall #5 mitigation)"
    - "HPA v2 Resource CPU + optional External metric for worker queue depth"
    - "ServiceMonitor gated on observability.serviceMonitor.enabled (avoids CRD-missing crash on clusters without Prometheus Operator)"
key-files:
  created:
    - charts/openwhispr/templates/api-deployment.yaml
    - charts/openwhispr/templates/api-service.yaml
    - charts/openwhispr/templates/api-hpa.yaml
    - charts/openwhispr/templates/api-pdb.yaml
    - charts/openwhispr/templates/api-servicemonitor.yaml
    - charts/openwhispr/templates/configmap-api.yaml
    - charts/openwhispr/templates/worker-deployment.yaml
    - charts/openwhispr/templates/worker-service.yaml
    - charts/openwhispr/templates/worker-hpa.yaml
    - charts/openwhispr/templates/worker-pdb.yaml
    - charts/openwhispr/templates/worker-servicemonitor.yaml
    - charts/openwhispr/templates/configmap-worker.yaml
    - charts/openwhispr/templates/web-deployment.yaml
    - charts/openwhispr/templates/web-service.yaml
    - charts/openwhispr/tests/api_test.yaml
    - charts/openwhispr/tests/worker_test.yaml
    - charts/openwhispr/tests/web_test.yaml
  modified:
    - charts/openwhispr/templates/_helpers.tpl
    - charts/openwhispr/values.yaml
    - charts/openwhispr/values.schema.json
    - charts/openwhispr/examples/values-corporate-litellm.yaml
    - tools/compose-chart-parity.allowlist.json
decisions:
  - "Web does NOT autoscale by default — single SSR replica fits 1k-user installation; HPA can be added in a later plan if SSR latency tightens"
  - "Worker service is headless (clusterIP: None) so Prometheus per-pod scrape sees individual replica metrics (BullMQ work-stealing differs per pod)"
  - "Schema enforces litellm.externalBaseUrl when embedded=false via allOf/if/then (instead of inline if/then which always evaluates against defaults)"
metrics:
  duration: ~20 min
  completed: 2026-05-13
---

# Phase 09 Plan 06: api / web / worker Deployments + HPAs + PDBs + ServiceMonitors Summary

JWT-of-Wave-2: three compose services (`api`, `web`, `worker`) translated into full K8s workload stacks (Deployment + Service + HPA + PDB + ServiceMonitor + ConfigMap each), DATABASE_URL wired through CNPG Pooler, secret-presence-probe initContainer fail-fasts ESO sync race (pitfall #5).

## Commits

- `149e413` — feat(09-06): api Deployment + Service + HPA + PDB + ServiceMonitor + ConfigMap (15 helm-unittest cases)
- `0c178db` — feat(09-06): worker Deployment + Service + HPA + PDB + ServiceMonitor + ConfigMap (11 helm-unittest cases; queue-depth metric branch tested in both states)
- `a840f49` — feat(09-06): web Deployment + Service; trim api/web/worker from parity allowlist (6 helm-unittest cases)

## Service Name Helpers (added to _helpers.tpl)

- `openwhispr.poolerHost` → `<fullname>-pg-pooler-rw` (CNPG Pooler RW Service)
- `openwhispr.postgresRwHost` → `<fullname>-pg-rw` (CNPG primary RW Service; used by 09-08 migrate Job)
- `openwhispr.valkeyHost` → `<release>-valkey-primary` (Bitnami sub-chart)
- `openwhispr.minioHost` → `<release>-minio` (Bitnami sub-chart)
- `openwhispr.litellmBaseUrl` → `http://<fullname>-litellm:4000` (embedded) or `.Values.litellm.externalBaseUrl` (external)
- Component selector helpers: api/worker/web/litellm

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] values-corporate-litellm.yaml example file failed new schema constraint**
- **Found during:** Task 1 (after schema added)
- **Issue:** The example overlay set `litellm.embedded: false` but did not set `litellm.externalBaseUrl`; new schema rule (Plan 09-07 mandated, implemented early as part of helper) required it.
- **Fix:** Added `litellm.externalBaseUrl: https://litellm.internal/` (moved from `api.env.LITELLM_BASE_URL` which was the legacy compose-style override location).
- **Files modified:** `charts/openwhispr/examples/values-corporate-litellm.yaml`
- **Commit:** `149e413`

**2. [Rule 1 - Bug] JSON Schema if/then matched defaults**
- **Found during:** Task 1 (full chart unittest after adding the litellm conditional)
- **Issue:** Inline `if/then` at object level triggered against defaults even when `embedded=true`, producing false-positive schema errors.
- **Fix:** Wrapped condition in `allOf: [{ if: { properties: { embedded: { const: false } }, required: [embedded] }, then: {...} }]` so the conditional only fires when `embedded=false` is explicitly set.
- **Files modified:** `charts/openwhispr/values.schema.json`
- **Commit:** `149e413`

### Auth Gates

None.

## Test Counts After Plan 09-06

| Suite | Before | After | Delta |
|---|---|---|---|
| helm-unittest | 29 | 61 | +32 (api 15, worker 11, web 6) |
| vitest (lint-compose-chart-parity) | 29 | 29 | 0 |
| `helm template ... \| kubectl --dry-run=client apply` | clean | clean | — |

## Compose-Parity Progress

| Phase | Allowlisted services | Chart resources |
|---|---|---|
| End of Wave 1 | 19 | 5 |
| End of Plan 09-06 | 16 (removed: api, web, worker) | 8 |
| Expected after Plan 09-07 | 15 (litellm removed) | 9 |
| Expected after Plan 09-08 | 14 (migrate removed) | 10 |

## Self-Check: PASSED

- All 17 created template/test files exist on disk
- 3 commits visible in `git log` (149e413, 0c178db, a840f49)
- helm-unittest: 61/61 PASS
- parity vitest: 29/29 PASS
- `helm template ... --dry-run`: clean render
