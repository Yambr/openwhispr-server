---
phase: 11
plan: 00
type: execute
wave: 0
depends_on: [10]
files_modified: []
autonomous: true
requirements: [DEPLOY-01, DEPLOY-02, DEPLOY-03, DOCS-03]
tags: [helm, docker-compose, oss, litellm, speaches, cloudflared, secrets, variants]

must_haves:
  truths:
    - "Variant A (embedded LiteLLM) install requires zero HF_TOKEN and zero pyannote-master build"
    - "Variant B (external LiteLLM) install renders zero openwhispr-litellm Deployment docs and api LITELLM_BASE_URL == .Values.litellm.externalBaseUrl"
    - "Variant C (local-speaches) overlay boots Speaches + LiteLLM model alias whisper-large-v3 → speaches:8000"
    - "Variant 11-04 live demo emits a *.trycloudflare.com URL within 30s and a real browser can open it"
    - "Helm Secret upgrade from pre-11 values-oss-quickstart.yaml to post-11 chart drops HF_TOKEN cleanly without operator data loss in non-HF keys"
    - "Three operator-runnable bundles exist: (compose file, values.yaml, .env.example, README quickstart block) per variant"
    - "tools/lint-compose-chart-parity.ts scopes HF_TOKEN as Variant-C-only and does not regress 109/109 helm-unittest baseline"
  artifacts:
    - path: "docker-compose.embedded-litellm.yml"
      provides: "Variant A compose entrypoint"
    - path: "docker-compose.external-litellm.yml"
      provides: "Variant B compose entrypoint (no embedded LiteLLM service)"
    - path: "examples/docker-compose.local-speaches.yml"
      provides: "Variant C overlay (Speaches + HF_TOKEN gated)"
    - path: "examples/docker-compose.live-demo.yml"
      provides: "Variant 11-04 cloudflared sidecar overlay"
    - path: "charts/openwhispr/examples/values-embedded-litellm.yaml"
      provides: "Variant A chart values (renamed/derived from values-oss-quickstart.yaml)"
    - path: "charts/openwhispr/examples/values-external-litellm.yaml"
      provides: "Variant B chart values (litellm.embedded=false)"
    - path: "charts/openwhispr/examples/values-local-speaches.yaml"
      provides: "Variant C chart overlay (bundledAi.enabled=true)"
    - path: ".env.embedded.example"
      provides: "Variant A operator env scaffold"
    - path: ".env.external.example"
      provides: "Variant B operator env scaffold"
    - path: ".env.local-speaches.example"
      provides: "Variant C operator env scaffold"
    - path: "examples/README.md"
      provides: "Variant matrix + quickstart pointers"
    - path: "examples/demo-cloudflared.sh"
      provides: "Live-demo orchestration script (kind + chart + tunnel)"
  key_links:
    - from: "charts/openwhispr/templates/secrets.yaml"
      to: ".Values.bundledAi.enabled"
      via: "conditional $required list — HF_TOKEN appended only when bundledAi.enabled=true"
      pattern: "if \\.Values\\.bundledAi\\.enabled"
    - from: "charts/openwhispr/templates/externalsecret.yaml"
      to: ".Values.bundledAi.enabled"
      via: "ESO HF_TOKEN data block gated"
      pattern: "if \\.Values\\.bundledAi\\.enabled"
    - from: "charts/openwhispr/templates/{api,web,worker,litellm}-deployment.yaml"
      to: "_helpers.tpl openwhispr.requiredSecretKeys"
      via: "shared named template renders the env list once"
      pattern: "openwhispr\\.requiredSecretKeys"
    - from: "tools/lint-compose-chart-parity.ts"
      to: "Variant catalog"
      via: "HF_TOKEN scoped to Variant-C-only fixture path"
      pattern: "VARIANT_C|local-speaches"
    - from: "examples/docker-compose.live-demo.yml"
      to: "cloudflared"
      via: "tunnel --url http://traefik:80"
      pattern: "cloudflare/cloudflared"
---

# Phase 11 — Cloud Profile Refactor (Umbrella)

## Phase Goal

An operator picks the variant that matches their reality — OSS quickstart, corporate LiteLLM override, or local GPU Speaches — and runs a single `docker compose up` (or `helm install -f values-<variant>.yaml`) bundle to landing. HF_TOKEN, pyannote-master builds, and Speaches model pulls are scoped to the one variant that legitimately needs them. A live cloudflared demo path lets contributors share a public URL without DNS or ACME.

## Plan Index

| Plan | Wave | Title | Tasks | Autonomous |
|------|------|-------|-------|------------|
| 11-01 | 1 | Variant A — embedded LiteLLM default + HF_TOKEN demotion + kind upgrade safety test | 7 | true |
| 11-02 | 2 | Variant B — external LiteLLM overlay hardening + negative-render coverage | 5 | true |
| 11-03 | 2 | Variant C — local-speaches example (compose + chart + bats smoke) | 6 | true |
| 11-04 | 3 | Live demo via cloudflared tunnel (assumption A2/A3 verification + script) | 5 | false (checkpoint:human-verify) |

**Wave layout:**
- **Wave 1:** 11-01 is the blocking refactor (chart secret enumeration moves to Variant-C-gated). Must land first; 11-02 and 11-03 both consume its slimmer base.
- **Wave 2 (parallel):** 11-02 (external-LiteLLM, chart-only) and 11-03 (local-speaches, compose+chart+bats) touch disjoint files. No shared paths beyond the umbrella `examples/README.md` (each appends its own section).
- **Wave 3:** 11-04 demo depends on 11-01's slim Variant A values as its baseline.

## Threat Model

### Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Operator → Helm Secret | Pre-11 operators may have manually-edited Secret keys; Helm upgrade may drop them. Document; do not destructively cleanup. |
| Public internet → cloudflared tunnel | Quick-tunnel hostname rotates per restart; treated as throwaway demo posture only. |
| Operator → ESO `data:` | Corporate Vault provisions; we must not demand keys we do not read. |
| Variant-C operator → Speaches container | HF_TOKEN authorises model weight pulls; never logged or persisted. |

### STRIDE Threat Register

| ID | Category | Component | Disposition | Mitigation |
|----|----------|-----------|-------------|------------|
| T-11-01 | Information Disclosure | Live `openwhispr-secrets` Secret on chart upgrade | mitigate | 11-01 ships a real kind upgrade test (`helm upgrade` from pre-11 values → post-11 chart, assert non-HF keys preserved). Document Pitfall #1 in `docs/operations.md` upgrade section. |
| T-11-02 | Spoofing | cloudflared `*.trycloudflare.com` wildcard origin in Better Auth `trustedOrigins` | accept | 11-04 chart values overlay marks `AUTH_TRUSTED_ORIGINS_EXTRA=https://*.trycloudflare.com` **demo-only**; production overlays (`values-cloud-ha.yaml`) MUST NOT inherit. README banner enforces. |
| T-11-03 | Tampering | Corporate ESO data block requesting HF_TOKEN | mitigate | 11-01 deletes the unconditional `HF_TOKEN` ref from `externalsecret.yaml`; 11-02 adds helm-unittest assertion that ESO `data:` does NOT contain HF_TOKEN when `bundledAi.enabled=false`. |
| T-11-04 | Denial of Service | Variant-C operator on no-GPU cluster | mitigate | 11-03 README banner + chart values `nodeSelector` requirement; api Deployment retains existing pre-flight check at `values.yaml:84-88`. |
| T-11-05 | Repudiation | Demo-only `trustedOrigins=*` accidentally inherited into production overlay | mitigate | 11-04 helm-unittest asserts `values-cloud-ha.yaml` render does NOT include wildcard origins; `lint-values-overlay.ts` (if absent, in-scope addition for 11-04) walks all `values-*.yaml` for forbidden demo strings. |
| T-11-06 | Information Disclosure | New `.env.*.example` files committing real keys | mitigate | All three new `.env.*.example` files contain placeholder values only (`OPENAI_API_KEY=sk-REPLACE_ME`); CI `lint-english.ts` + git-secrets pattern remains active. |

## Deferred (Out of Scope)

- Stable named cloudflared tunnels with CF account + DNS provisioning — quick-tunnel demo path is the only deliverable in 11-04.
- Speaches GPU-mode chart values defaults (`bundledAi.enabled=true` + nvidia node-selector) beyond the example overlay — production GPU recipes are operator-driven.
- Bundling mailpit into 11-04 demo for email verification capture — out of scope; 11-04 sets `disableEmailVerification: true` for the demo flow only (matches `values-kind.yaml:106-107`).
- Removing the legacy `values-oss-quickstart.yaml` — kept as a renamed alias to `values-embedded-litellm.yaml` for backward-compat (symlink or alias file with deprecation comment, decided in 11-01).
- Migrating `tools/lint-compose-chart-parity.ts` to a fully variant-aware multi-fixture model — 11-01 scopes the minimal change: tolerate HF_TOKEN absent in Variant-A/B paths, present in Variant-C path.

## Source Audit

| Source | Item | Plan | Status |
|--------|------|------|--------|
| GOAL | "Variant A — embedded LiteLLM default — OSS quickstart" | 11-01 | COVERED |
| GOAL | "Variant B — external LiteLLM corporate" | 11-02 | COVERED |
| GOAL | "Variant C — local-speaches opt-in example" | 11-03 | COVERED |
| GOAL | "Live demo via cloudflared tunnel" | 11-04 | COVERED |
| GOAL | "HF_TOKEN gated off in Variants A/B; on only in Variant C" | 11-01 (gate), 11-02 (assert absent), 11-03 (assert present) | COVERED |
| GOAL | "Three complete operator-runnable bundles (compose file, values.yaml, .env.example, README)" | 11-01, 11-02, 11-03 | COVERED |
| RESEARCH | Variant A render does not require HF_TOKEN (REQ-11-01-a, b) | 11-01 | COVERED |
| RESEARCH | `litellm.embedded=false` produces 0 Deployment docs (REQ-11-02-a, b) | 11-02 | COVERED |
| RESEARCH | Variant C bats smoke boots Speaches with whisper alias (REQ-11-03-a) | 11-03 | COVERED |
| RESEARCH | cloudflared sidecar emits public URL (REQ-11-04-a, b) | 11-04 | COVERED |
| RESEARCH | Conditional `$required` list in secrets.yaml | 11-01 | COVERED |
| RESEARCH | `_helpers.tpl openwhispr.requiredSecretKeys` named template | 11-01 | COVERED |
| RESEARCH | Conditional ESO data block | 11-01 | COVERED |
| RESEARCH | Speaches block extraction from docker-compose.load-test.yml | 11-03 | COVERED |
| RESEARCH | Variant C bats smoke (`examples/test-local-speaches.sh`) | 11-03 | COVERED |
| RESEARCH | Cloudflared sidecar + wildcard `trustedOrigins` (demo-only) | 11-04 | COVERED |
| RESEARCH | bats smoke parsing cloudflared stdout for *.trycloudflare.com | 11-04 | COVERED |
| RESEARCH | Pitfall #1 helm Secret upgrade kind test | 11-01 | COVERED |
| RESEARCH | Pitfall #5 negative-render assertion (litellm.embedded=false count: 0) | 11-02 | COVERED |
| RESEARCH | Pitfall #6 Compose profile precedence (Option A — leave Speaches in load-test.yml gated by load-test-realistic profile) | 11-03 | COVERED |
| RESEARCH | tools/lint-compose-chart-parity.ts variant scoping (A4) | 11-01 | COVERED |
| RESEARCH | Open Q #1 helm test diarization dependency check | 11-02 | COVERED (rolled into Variant B helm-test assertion) |
| RESEARCH | Open Q #2 keep `secrets.hfToken: ""` in values.yaml schema | 11-01 | COVERED |
| RESEARCH | Open Q #3 docs/self-hosting.md hosts variant matrix | 11-01, 11-02, 11-03 (each appends its section) | COVERED |
| CONTEXT | Strict TDD per phase (CLAUDE.md) | all 4 sub-plans (RED → GREEN sequenced tasks) | COVERED |
| CONTEXT | ≥90/90/90/90 coverage on new code | all 4 sub-plans (helm-unittest + bats + vitest where touched) | COVERED |
| CONTEXT | English-only source-artifact | all 4 sub-plans (lint-english gate runs in CI) | COVERED |
| CONTEXT | No regression vs 109/109 helm-unittest, 763/763 web, 160/160 worker, 967/974 api | umbrella verification | COVERED |
| CONTEXT | "No bundled local AI models" doctrinal lock (memory) | 11-01 enforces; 11-03 is the documented opt-in | COVERED |
| CONTEXT | A1 Helm Secret upgrade kind test | 11-01 Task 7 | COVERED |
| CONTEXT | A2 Better Auth wildcard trustedOrigins | 11-04 Task 1 (pre-flight assumption verification) | COVERED |
| CONTEXT | A3 cloudflared quick mode no-account | 11-04 Task 1 (pre-flight assumption verification) | COVERED |
| CONTEXT | A4 lint-compose-chart-parity tolerance | 11-01 Task 5 + 11-03 Task 5 | COVERED |

No unplanned items. No gaps.

## Verification

- `pnpm -r test` green (≥ 967/974 api, ≥ 763/763 web, ≥ 160/160 worker — no regressions)
- `helm unittest charts/openwhispr` green (≥ 109 baseline + new assertions per sub-plan)
- `pnpm test:i18n-completeness` green
- `pnpm lint:english` green
- `pnpm typecheck` green
- `tools/lint-compose-chart-parity.ts` green with Variant-aware fixture scoping
- Coverage ≥ 90/90/90/90 on diff for every changed TS file
- Manual: 11-04 cloudflared demo URL opened in browser by operator (checkpoint)

## Success Criteria

1. Three variant bundles exist; each can be installed via a single `docker compose -f <variant>.yml up` or `helm install -f <variant>.yaml` command quoted verbatim in `examples/README.md`.
2. Variant A install consumes 12 secrets (HF_TOKEN absent); Variant C install adds HF_TOKEN as the 13th.
3. `litellm.embedded=false` corporate path renders 0 openwhispr-litellm Deployment docs; api Deployment env `LITELLM_BASE_URL` resolves to `.Values.litellm.externalBaseUrl`.
4. Variant C bats smoke boots Speaches + LiteLLM and proves `whisper-large-v3` model alias routes to `speaches:8000`.
5. 11-04 cloudflared demo script (`examples/demo-cloudflared.sh`) provisions kind + chart + tunnel and prints a `https://*.trycloudflare.com` URL openable from an external browser. Pre-flight tasks verify A2 (Better Auth wildcard) + A3 (no-account quick mode) before the demo runs.
6. No regression on helm-unittest baseline or app test counts.

## Output

Each plan produces a SUMMARY at `.planning/phases/11-cloud-profile-refactor/11-{NN}-SUMMARY.md`.
