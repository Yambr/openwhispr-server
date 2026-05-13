---
phase: 09
plan: 07
subsystem: helm-chart
tags: [deploy, helm, litellm, ai-plane]
requires:
  - 09-06 (Wave 2 api/web/worker — litellmBaseUrl helper consumes this Service)
provides:
  - charts/openwhispr/templates/litellm-deployment.yaml
  - charts/openwhispr/templates/litellm-service.yaml
  - charts/openwhispr/templates/configmap-litellm.yaml
affects:
  - tools/compose-chart-parity.allowlist.json (litellm removed)
tech-stack:
  added: []
  patterns:
    - "Helm ConfigMap passthrough via toYaml — operators add LiteLLM providers without forking the chart"
    - "checksum/config pod annotation rolls pods on config change"
key-files:
  created:
    - charts/openwhispr/templates/litellm-deployment.yaml
    - charts/openwhispr/templates/litellm-service.yaml
    - charts/openwhispr/templates/configmap-litellm.yaml
    - charts/openwhispr/tests/litellm_test.yaml
  modified:
    - tools/compose-chart-parity.allowlist.json
decisions:
  - "LiteLLM image pinned to ghcr.io/berriai/litellm:main-v1.83.14-stable (Phase 08.5 lock; v1.82.x is on the What NOT to Use list)"
  - "LiteLLM bypasses the chart Pooler — uses CNPG primary -rw directly (LiteLLM owns its own Prisma pooling)"
  - "Plan 09-07 Task 2 (Speaches bundled-AI GPU path) DEFERRED — Speaches stays reference-only per project memory feedback_no_bundled_local_models"
metrics:
  duration: ~5 min
  completed: 2026-05-13
---

# Phase 09 Plan 07: LiteLLM Deployment Summary

LiteLLM Proxy embedded path templated — Deployment + Service + ConfigMap gated on `litellm.embedded` toggle; corporate operators flip `embedded=false` + `externalBaseUrl` to point api/worker at an internal LiteLLM with zero chart resources rendered.

## Commits

- `d3d792d` — feat(09-07): litellm deployment + service + configmap (embedded vs external toggle) — 10 helm-unittest cases (5 enabled-state + 3 disabled-state + 2 ConfigMap passthrough)

## Deviations from Plan

### Deferred Scope

**Task 2 (Speaches bundled-AI GPU Deployment) — DEFERRED**
- **Reason:** Project memory `feedback_no_bundled_local_models` is explicit: "LiteLLM proxy ships bare; default wires to OpenRouter/pyannote/OpenAI via .env API keys (corp ops swap in Bedrock/internal). Speaches был reference-only."
- **Impact on parity allowlist:** `speaches` stays in `bundled-ai-conditional` category (no chart render expected for OSS quickstart; was never going to land as a default-rendered template).
- **What was NOT done:** `deployment-speaches.yaml`, `service-speaches.yaml`, `speaches_test.yaml`, CI assertion in helm-lint.yml.
- **Effect on `must_haves.truths`:** The Speaches-gated truths (rows 3-5 of plan frontmatter) and T-09-08 (bundled-AI CI leak) mitigation are de-facto satisfied because the templates do not exist — the absence of any Speaches resource in `helm template` output is structurally guaranteed.
- **Re-open trigger:** A future plan with explicit user request to support GPU-onboard ASR can layer Task 2 work on top.

### Auto-fixed Issues

None — the LiteLLM `embedded`-toggle helper already landed in Plan 09-06 (`openwhispr.litellmBaseUrl`), and the `values.litellm.externalBaseUrl` schema constraint also landed in 09-06 (because the api/worker Deployments required the helper). Plan 09-07 inherits both without further fixes.

### Auth Gates

None.

## Test Counts After Plan 09-07

| Suite | Before | After | Delta |
|---|---|---|---|
| helm-unittest | 61 | 71 | +10 |
| vitest (lint-compose-chart-parity) | 29 | 29 | 0 |

## Compose-Parity Progress

| Phase | Allowlisted services | Chart resources |
|---|---|---|
| End of Plan 09-06 | 16 | 8 |
| End of Plan 09-07 | 15 (removed: litellm) | 9 |
| Expected after Plan 09-08 | 14 (migrate removed) | 10 |

## Self-Check: PASSED

- All 3 created template files exist on disk; tests file exists
- 1 commit visible in `git log` (d3d792d)
- helm-unittest: 71/71 PASS
- parity vitest: 29/29 PASS
- `helm template ...` clean render
