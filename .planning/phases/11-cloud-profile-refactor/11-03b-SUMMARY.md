---
phase: 11
plan: 03b
subsystem: helm-chart-template
tags: [helm, chart, speaches, bundledAi, variant-c, gpu]
status: complete
completed: 2026-05-18
requirements: [DEPLOY-01, DEPLOY-02]
parent_plan: 11-03
files_modified:
  - charts/openwhispr/templates/speaches-deployment.yaml (new)
  - charts/openwhispr/templates/_helpers.tpl (added speaches.selectorLabels)
  - charts/openwhispr/values.yaml (added bundledAi.resources + bundledAi.persistence)
  - charts/openwhispr/tests/local_speaches_test.yaml (new — 9 assertions)
---

# Plan 11-03b Summary — Variant C chart Deployment template

## Outcome

Plan 11-03b lands the Speaches workload Deployment + Service + PVC
that Plan 11-03's `values-local-speaches.yaml` overlay was scaffolding
for. The chart now renders a full Variant C topology when
`bundledAi.enabled=true`, and zero documents when false (Variants A
and B unchanged).

## What landed

  * `charts/openwhispr/templates/speaches-deployment.yaml` — gated on
    `.Values.bundledAi.enabled`, renders Deployment + Service + PVC
    (or Deployment + Service if `bundledAi.persistence.enabled=false`,
    falling back to a 25Gi emptyDir for the HF cache). Strategy is
    `Recreate` (not RollingUpdate) — Speaches loads ~3 GB of model
    weights at startup, rolling-surge would briefly double the GPU
    footprint; Recreate accepts a ~60 s warm-cache outage during
    chart upgrades in exchange for steady-state GPU pressure.

  * `charts/openwhispr/templates/_helpers.tpl` — adds
    `openwhispr.speaches.selectorLabels` matching the existing
    api/worker/litellm pattern (label `app.kubernetes.io/component:
    speaches`).

  * `charts/openwhispr/values.yaml` — `bundledAi.resources` (default
    requests 2 CPU / 4 GiB, limits 4 CPU / 8 GiB) +
    `bundledAi.persistence` (default enabled, 20Gi, no
    storageClassName so the cluster default is used).

  * `charts/openwhispr/tests/local_speaches_test.yaml` — 9
    helm-unittest assertions:
    1. ZERO docs at `bundledAi.enabled=false` (Variant A/B default)
    2. 3 docs (Deployment + Service + PVC) at `enabled=true`
    3. Container shape — name, image, port 8000, PRELOAD_MODELS env
    4. startupProbe 60 × 10 = 600 s budget
    5. Strategy = Recreate
    6. Service exposes :8000
    7. PVC 20Gi ReadWriteOnce
    8. PVC omitted when `persistence.enabled=false` (count=2)
    9. GPU node-selector + toleration propagated to pod spec

## Verification

```
$ helm unittest charts/openwhispr -f tests/local_speaches_test.yaml
 PASS  speaches — Deployment + Service + PVC (Variant C, Plan 11-03b)
 Tests:       9 passed, 9 total

$ helm unittest charts/openwhispr
 Test Suites: 22 passed, 22 total
 Tests:       199 passed, 199 total
```

Net: helm-unittest count lifted from 190 → 199 in this commit
(+9 Variant C assertions; +1 test suite).

## Outstanding (Plan 11-03c — still deferred)

The bats live-smoke (`examples/test-local-speaches.{sh,bats}`) and the
parity-lint VARIANT_C fixture pair remain deferred — they require a
real Speaches build (~10 min) + real HF_TOKEN + GPU runner OR a
patient CPU runner. Both are environmental gates the author cannot
satisfy without operator-supplied credentials and runtime access.

## Phase 11 progress after this commit

3.5 of 4 sub-plans summarized:
  * 11-01 Variant A — CLOSED 2026-05-13
  * 11-02 Variant B — CLOSED 2026-05-18
  * 11-03 Variant C operator scaffold — CLOSED 2026-05-18
  * 11-03b Variant C chart template — CLOSED 2026-05-18 (this)
  * 11-03c bats smoke + parity lint — DEFERRED (env-gated)
  * 11-04 cloudflared tunnel demo + human-verify — explicitly human-
    gated; closes when a person at the keyboard ratifies the demo.
