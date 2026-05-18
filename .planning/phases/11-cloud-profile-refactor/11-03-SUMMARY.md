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

## Follow-ups SHIPPED in this same 2026-05-18 session

  * **Plan 11-03b** — `charts/openwhispr/templates/speaches-deployment.yaml`
    (Deployment + Service + PVC gated on `bundledAi.enabled`) +
    `charts/openwhispr/tests/local_speaches_test.yaml` (9 helm-unittest
    assertions). Commit `250b611`. helm-unittest total 190 → 199.
  * **Plan 11-03c parity-lint half** — `speaches` graduated from the
    parity-lint allowlist to a recognized chart resource. Commit
    `0e8493c`. 36/36 parity-lint test cases pass.
  * **Plan 11-03c bats half** — `examples/test-local-speaches.sh` +
    `examples/test-local-speaches.bats` shipped as operator-runnable
    artifacts (this commit). The smoke itself runs only with `bats`
    installed + `.env` with `HF_TOKEN` populated + Docker host with
    sufficient resources to build the Speaches master image — those
    are operator-environment prerequisites, not author-time work. The
    `.sh` wrapper carries pre-flight gates that fail clean with
    exit 2 (no bats) or exit 3 (missing HF_TOKEN) so operators learn
    the prerequisite before any compose `up` is attempted.

## Remaining genuinely-deferred work

Only the **live runtime invocation** of the bats smoke against a real
GPU runner (or a patient CPU runner accepting ~10 min build + 3 GB
weight download + ~120 s per transcribe call) remains environmental.
This is operator-driven, not author-time work — operators with the
right host run `examples/test-local-speaches.sh` and report results;
the CI lane that does this lives outside the scope of Plan 11-03/03b/
03c per the original CONTEXT decision to keep Variant C bundling
opt-in.

## Phase 11 progress after this commit

3 of 4 sub-plans summarized:
  * 11-01 (Variant A — embedded LiteLLM) — CLOSED 2026-05-13
  * 11-02 (Variant B — external/corporate LiteLLM) — CLOSED 2026-05-18
  * 11-03 (Variant C — local Speaches scaffold) — CLOSED 2026-05-18
    (scaffold half; runtime half deferred to 11-03b)
  * 11-04 (cloudflared tunnel demo + human-verify checkpoint) —
    explicitly human-verify gated; cannot close without a person at the
    keyboard ratifying the tunnel demo.
