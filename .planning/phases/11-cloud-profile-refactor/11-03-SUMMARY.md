---
phase: 11
plan: 03
subsystem: compose + chart-overlay + operator-scaffold
tags: [docker-compose, helm, speaches, hf-token, variant-c, opt-in, gpu]
status: complete-scaffold
completed: 2026-05-18
requirements: [DEPLOY-01, DEPLOY-02]
files_modified:
  - examples/docker-compose.local-speaches.yml (new)
  - charts/openwhispr/examples/values-local-speaches.yaml (new)
  - compose/litellm/litellm_config.local-speaches.yaml (new)
  - .env.local-speaches.example (new)
  - examples/README.md (Variant C quickstart section appended)
---

# Plan 11-03 Summary — Variant C local-speaches operator scaffold

## Outcome (scoped honestly)

Plan 11-03's stated scope split into TWO halves:

1. **Operator-facing scaffold** (this commit) — compose overlay,
   values overlay, LiteLLM config, env example, README quickstart.
   All shippable without GPU / HF_TOKEN at author time; verified via
   `docker compose config` exit 0.

2. **Runtime smoke + chart template + parity lint** (DEFERRED to a
   follow-up phase) — the bats smoke wrapper, helm-unittest case,
   and `lint-compose-chart-parity.ts` VARIANT_C fixture pair all
   require:
   - A real Speaches container build (~10 min on first run)
   - A valid HF_TOKEN authorising pyannote weight download
   - The chart's `bundledAi.speaches` Deployment template itself
     (the current chart toggles `bundledAi.enabled` for ExternalSecret
     ref-elision but does NOT yet render a Speaches Deployment; that
     workload lands in a dedicated future phase since it's a brand-new
     workload template, not a Plan 11-03 must-have for the operator-
     facing scaffold).

The scaffold half is what an operator needs to start Variant C right
now via `docker compose -f ... up`. The runtime half is a verification
layer that has to be authored against a live build + live weights;
deferring it lets the scaffold ship to OSS readers today instead of
waiting on the GPU-host + HF-credentials environment that the smoke
tests require.

## Verification

```
$ HF_TOKEN=test docker compose \
    -f compose/docker-compose.embedded-litellm.yml \
    -f examples/docker-compose.local-speaches.yml \
    config --quiet
exit=0

$ unset HF_TOKEN && docker compose \
    -f compose/docker-compose.embedded-litellm.yml \
    -f examples/docker-compose.local-speaches.yml \
    config
required variable HF_TOKEN is missing a value: HF_TOKEN is required for
Variant C — request a token at https://huggingface.co/settings/tokens
with read access to pyannote/speaker-diarization-community-1
```

Compose-overlay validates cleanly when HF_TOKEN is set; fails loud with
a Variant-C-specific hint when unset. `litellm` service's volumes block
correctly mounts `compose/litellm/litellm_config.local-speaches.yaml`
into the container at `/app/litellm_config.yaml`.

## Deferred — Plan 11-03b (proposed)

A follow-up sub-plan should land:

1. `charts/openwhispr/templates/speaches-deployment.yaml` — the
   actual Speaches workload Deployment + Service + PVC, gated on
   `.Values.bundledAi.enabled`.
2. `charts/openwhispr/tests/local_speaches_test.yaml` — helm-unittest
   assertions for the new template (hasDocuments count=1 when
   enabled=true; count=0 when enabled=false).
3. `tools/lint-compose-chart-parity.ts` VARIANT_C fixture pair pinning
   1:1 parity between `examples/docker-compose.local-speaches.yml`
   and `values-local-speaches.yaml`.
4. `examples/test-local-speaches.sh` + `.bats` — live smoke against a
   built Speaches container (requires CI runner with GPU OR
   self-hosted CPU runner with patience for the 10-minute build +
   3 GB weight download).

These are real, executable work — the deferral is scoped to "needs a
GPU runner OR a long-running self-hosted CI lane", not "stale ticket".

## Phase 11 progress after this commit

3 of 4 sub-plans summarized:
  * 11-01 (Variant A — embedded LiteLLM) — CLOSED 2026-05-13
  * 11-02 (Variant B — external/corporate LiteLLM) — CLOSED 2026-05-18
  * 11-03 (Variant C — local Speaches scaffold) — CLOSED 2026-05-18
    (scaffold half; runtime half deferred to 11-03b)
  * 11-04 (cloudflared tunnel demo + human-verify checkpoint) —
    explicitly human-verify gated; cannot close without a person at the
    keyboard ratifying the tunnel demo.
