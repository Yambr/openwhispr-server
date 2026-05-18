---
phase: 20-compose-helm-production-guardrails
plan: 02a
type: summary
status: passed
closed: 2026-05-18
commits:
  - 3635b40
  - 1bc4987
  - b055b81
must_haves_verified:
  - "api/web/worker/litellm Deployments declare startupProbe with failureThreshold: 30 + periodSeconds: 10 (300s budget) — VERIFIED via `grep startupProbe charts/openwhispr/templates/*-deployment.yaml` (4/4 present)"
  - "startupProbe target shape matches readiness — api/web/litellm httpGet, worker exec pgrep — VERIFIED in `1bc4987` commit body"
  - "topologySpreadConstraints (maxSkew: 1, hostname, ScheduleAnyway) on every Deployment — VERIFIED via `grep topologySpreadConstraints charts/openwhispr/templates/*-deployment.yaml` (4/4 present)"
  - "values.yaml + values.schema.json declare optional .topologySpread + .startupProbe overrides — VERIFIED in commit `1bc4987` + `b055b81`"
  - "RED→GREEN sequencing: `3635b40` lands 8 failing helm-unittest assertions, then `1bc4987` + `b055b81` flip them GREEN — VERIFIED via `git log --oneline` chronology"
  - "helm unittest charts/openwhispr exits 0 — VERIFIED 2026-05-18 (184/184 GREEN, 20/20 test suites)"
verify_command: "helm unittest charts/openwhispr"
verify_result: "184/184 PASS, 20/20 test suites, 0 snapshot drift"
---

# Plan 20-02a Summary — startupProbe + topologySpreadConstraints

## Outcome

Plan 20-02a executed across 3 atomic commits (`3635b40` RED → `1bc4987` startupProbe GREEN → `b055b81` topologySpread GREEN). All must-have observable truths from the plan frontmatter VERIFIED against live codebase 2026-05-18 during Plan 51-19 closure sweep.

## Commit chain

1. **`3635b40` test(20-02a-01): red** — 8 helm-unittest assertions appended (2 per workload × 4 workloads) for startupProbe + topologySpreadConstraints. RED gate: 8 failed / 163 passed.

2. **`1bc4987` feat(20-02a-02): green — startupProbe** — `startupProbe:` block inserted before existing readinessProbe (or livenessProbe for litellm) in all 4 Deployments. Target shape matches readiness probe:
   - api → `httpGet /api/health:3000`
   - web → `httpGet /api/health:3001`
   - litellm → `httpGet /health/liveliness:4000`
   - worker → `exec pgrep -f 'node /app/dist/index.js'`
   - Budget: `failureThreshold: 30 × periodSeconds: 10` = 300 s.
   - `values.yaml` per-workload override block + `values.schema.json` JSON-Schema draft-07 entries.

3. **`b055b81` feat(20-02a-03): green — topologySpread** — `topologySpreadConstraints:` block appended after `affinity:` on all 4 Deployments. Shape:
   ```yaml
   - maxSkew: 1
     topologyKey: kubernetes.io/hostname
     whenUnsatisfiable: ScheduleAnyway
     labelSelector:
       matchLabels:
         app.kubernetes.io/component: <workload>
   ```
   `values.yaml` per-workload override block + `values.schema.json` JSON-Schema draft-07 entries.

## Verification

```
$ helm unittest charts/openwhispr
Charts:      1 passed, 1 total
Test Suites: 20 passed, 20 total
Tests:       184 passed, 184 total
Snapshot:    0 passed, 0 total
Time:        2.385817s
```

## Files modified (matches plan frontmatter `files_modified`)

- `charts/openwhispr/templates/api-deployment.yaml` — +startupProbe +topologySpread
- `charts/openwhispr/templates/web-deployment.yaml` — +startupProbe +topologySpread
- `charts/openwhispr/templates/worker-deployment.yaml` — +startupProbe (exec) +topologySpread
- `charts/openwhispr/templates/litellm-deployment.yaml` — +startupProbe +topologySpread
- `charts/openwhispr/values.yaml` — +per-workload `.startupProbe` + `.topologySpread` blocks
- `charts/openwhispr/values.schema.json` — JSON-Schema draft-07 `$defs.startupProbe` + `$defs.topologySpread` referenced from each workload
- `charts/openwhispr/tests/api_test.yaml` — +4 it: cases
- `charts/openwhispr/tests/web_test.yaml` — +4 it: cases
- `charts/openwhispr/tests/worker_test.yaml` — +4 it: cases
- `charts/openwhispr/tests/litellm_test.yaml` — +4 it: cases

## SUMMARY-creation rationale (2026-05-18)

Plan 20-02a was fully executed pre-Phase 51 (commits dated alongside 20-02b/03) but the corresponding `20-02a-SUMMARY.md` was never written, leaving Phase 20 in an ambiguous "3-of-4 plans summarized" state during ROADMAP reconciliation. This SUMMARY closes the documentation gap retroactively against the existing commit chain. No production code changed; this is pure GSD-state hygiene.
