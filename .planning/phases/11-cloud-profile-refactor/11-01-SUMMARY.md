---
phase: 11
plan: 01
subsystem: helm-chart + compose + operator-bundle
tags: [helm, chart, secrets, hf-token, variant-a, embedded-litellm, parity-linter]
status: complete
completed: 2026-05-13
scope: tasks-1-through-6
out_of_scope: task-7-pulled-into-11-05
requirements: [DEPLOY-01, DEPLOY-02, DEPLOY-03]
requires:
  - phase-09 helm chart skeleton + ESO + helm-unittest baseline
  - phase-10 compose-chart parity linter
provides:
  - Variant A canonical operator bundle (compose + values + env + README)
  - openwhispr.requiredSecretKeys helper (single source of truth for required env list)
  - HF_TOKEN gated behind .Values.bundledAi.enabled (Variant C only)
  - helm-unittest 125/125 (109 baseline + 16 new)
affects:
  - charts/openwhispr/templates/{secrets.yaml,externalsecret.yaml,api/web/worker/litellm-deployment.yaml,_helpers.tpl,probe-helpers.yaml}
  - charts/openwhispr/examples/values-embedded-litellm.yaml + values-oss-quickstart.yaml (deprecation alias header)
  - docker-compose.embedded-litellm.yml (new)
  - .env.embedded.example (new), .env.example (HF_TOKEN block relocation)
  - tools/lint-compose-chart-parity.ts + tools/lint-compose-chart-parity.test.ts
  - examples/README.md, docs/self-hosting.md, README.md
tech-stack:
  added:
    - probe template pattern (gated ConfigMap for helm-unittest helper assertions)
  patterns:
    - "_helpers.tpl single-source-of-truth for required secret env list"
    - "conditional ESO data block (if .Values.bundledAi.enabled)"
    - "Variant-driven scope exclusion in compose-chart parity linter (VARIANT_C_ONLY_KEYS)"
key-files:
  created:
    - charts/openwhispr/templates/probe-helpers.yaml
    - charts/openwhispr/tests/helpers_required_secret_keys_test.yaml
    - charts/openwhispr/examples/values-embedded-litellm.yaml
    - docker-compose.embedded-litellm.yml
    - .env.embedded.example
    - examples/README.md
    - tools/lint-compose-chart-parity.test.ts
  modified:
    - charts/openwhispr/templates/_helpers.tpl (added openwhispr.requiredSecretKeys + openwhispr.secretValuesKey helpers; deprecated openwhispr.secretPresenceProbeCmd)
    - charts/openwhispr/templates/secrets.yaml (consumes helper)
    - charts/openwhispr/templates/externalsecret.yaml (HF_TOKEN ref wrapped in .Values.bundledAi.enabled)
    - charts/openwhispr/templates/{api,web,worker,litellm}-deployment.yaml (initContainer iterates helper)
    - charts/openwhispr/values.yaml (added helperProbe.enabled default false)
    - charts/openwhispr/tests/{api,web,worker,litellm,secrets,examples_render}_test.yaml (new HF_TOKEN assertions)
    - charts/openwhispr/examples/values-oss-quickstart.yaml (deprecation alias header)
    - .env.example (HF_TOKEN block relocated under Variant-C banner)
    - tools/lint-compose-chart-parity.ts (VARIANT_C_ONLY_KEYS)
    - README.md, docs/self-hosting.md (point at docker-compose.embedded-litellm.yml as canonical default)
decisions:
  - "D2 probe template pattern: rendered probe-helpers.yaml ConfigMap gated by .Values.helperProbe.enabled (default false) so production installs never see it; helm-unittest flips it on to assert helper output directly. Filename has no leading underscore because helm-unittest filters those; the .enabled guard is the sole production-mode kill switch."
  - "Helper namespace .Values.helperProbe is deliberately distinct from .Values.testProbe (helm-test hook for first-launch SLO) to avoid silently disabling the SLO probe."
  - "Variant A canonical = 13 core secret keys (no HF_TOKEN). HF_TOKEN appended ONLY when .Values.bundledAi.enabled=true (Variant C). PYANNOTE_API_KEY remains soft-warned, not hard-required, per /v1/audio/diarization graceful-503 behavior."
  - "values-oss-quickstart.yaml retained as deprecated alias (header banner only) for backward-compat; canonical Variant A overlay is now values-embedded-litellm.yaml."
metrics:
  duration: ~prior-executor (resumed and verified by this agent)
  tasks: 6
  files_changed: 27
  helm_unittest_before: 109
  helm_unittest_after: 125
  parity_linter_tests_before: ~(co-located new file)
  parity_linter_tests_after: 36
completed_date: 2026-05-13
---

# Phase 11 Plan 01: Variant A — Embedded LiteLLM Default + HF_TOKEN Demotion Summary

**Tasks 1-6 of plan 11-01 (chart refactor + Variant A operator bundle + parity linter scope change). Task 7 (kind upgrade workflow + A1 verification + frozen pre-11 chart tarball) split into new sub-plan 11-05 per pre-execution decision D1.**

One-liner: HF_TOKEN gated behind `.Values.bundledAi.enabled`, per-pod required-env list factored into single `openwhispr.requiredSecretKeys` helper, canonical Variant A operator bundle shipped (compose + values + env + README), and `tools/lint-compose-chart-parity.ts` scoped so Variant-C-only keys do not trigger drift.

## Scope (executed)

| Task | Type | Subject | Commit |
|------|------|---------|--------|
| 1 | RED  | helm-unittest scaffolding for variant-A render + helpers + ESO conditional | `4c1ca19` |
| 2 | GREEN | `_helpers.tpl openwhispr.requiredSecretKeys` + secrets.yaml + externalsecret.yaml conditional gating | `df8cc14` |
| 3 | GREEN | Deployments consume helper for `secret-presence-probe` initContainer (api/web/worker/litellm) | `162c0cd` |
| 4 | GREEN | Variant A operator bundle (`docker-compose.embedded-litellm.yml` + `values-embedded-litellm.yaml` + `.env.embedded.example` + `examples/README.md` + docs/self-hosting + README pointers) | `294dba8` |
| 5 | GREEN | `tools/lint-compose-chart-parity.ts` Variant-aware scope (`VARIANT_C_ONLY_KEYS = {"HF_TOKEN"}`) | `219f8fb` |
| 6 | GREEN | Positive-render guards for Variant-C HF_TOKEN path (secrets + ESO mode) | `8bae19c` |

## Scope (out — owned by 11-05)

- Task 7 — kind-cluster helm upgrade test in GitHub Actions
- Frozen pre-11 chart tarball at `tests/fixtures/pre-11-chart.tar.gz` from anchor SHA `40d04fe5b3ea8d3012bb9791d834c2c18040c961` (D3)
- A1 verification (Helm 3 Secret upgrade drops removed `stringData` keys without preserving them)

## Verification results

| Check | Baseline (D5) | Post-plan | Delta |
|---|---|---|---|
| helm-unittest | 109/109 | **125/125** | +16 new cases (helpers, secrets ×2, api/web/worker/litellm probe absence, examples render, ESO conditional, Variant-C positive-render) |
| compose config | `docker-compose.embedded-litellm.yml config -q` | **green** | new compose validates |
| helm template (Variant A) | n/a | **0 HF_TOKEN occurrences** | as designed |
| helm-lint Variant A | n/a | **green** | 1 chart linted, 0 failed |
| `tools/lint-compose-chart-parity.test.ts` | (new file) | **36/36 green** | co-located at `tools/` not `tools/__tests__/` |
| `pnpm tsx tools/lint-compose-chart-parity.ts` | green | **green** | no regression |
| apps/api | 967/7/2 | unchanged | zero apps/* code modified (verified via `git diff --stat 4c1ca19^..8bae19c -- 'apps/**'` returns empty) |
| apps/worker | 160/160 | unchanged | same |
| apps/web | 763/763 | unchanged | same |
| packages/i18n | 2/2 | unchanged | same |
| packages/contract-tests parse error | pre-existing baseline | unchanged | not touched |

## Key implementation notes

### D2 probe template (Task 1 RED scaffolding)

`charts/openwhispr/templates/probe-helpers.yaml` renders a `ConfigMap` whose `data.requiredSecretKeys` value is the verbatim output of `include "openwhispr.requiredSecretKeys" .`. Two-fold gating:

1. Production safety: the entire body is wrapped in `{{- if .Values.helperProbe.enabled -}}` and `.Values.helperProbe.enabled` defaults to `false` in `values.yaml`. Production installs never see this ConfigMap.
2. Naming: the file has no leading underscore (helm-unittest filters `_`-prefixed files as partials and won't let you select them). Filename is `probe-helpers.yaml`.
3. Namespace discipline: `.Values.helperProbe` is **deliberately distinct** from `.Values.testProbe` (used by `helm test` first-launch SLO hook). Sharing the namespace would have made the helper probe accidentally co-disable the SLO probe.

helm-unittest case `helpers_required_secret_keys_test.yaml` sets `helperProbe.enabled: true` + selector `template: probe-helpers.yaml` and asserts on `data.requiredSecretKeys`:

- `bundledAi.enabled: false` → 13-key literal, no HF_TOKEN.
- `bundledAi.enabled: true` → same 13 keys + ` HF_TOKEN` suffix.

### Helper signature

```gotemplate
{{- define "openwhispr.requiredSecretKeys" -}}
LITELLM_MASTER_KEY OPENROUTER_API_KEY OPENAI_API_KEY POSTGRES_OWNER_PASSWORD POSTGRES_APP_PASSWORD PGBOUNCER_ADMIN_PASSWORD BETTER_AUTH_SECRET VALKEY_PASSWORD MINIO_ROOT_PASSWORD TRAEFIK_ADMIN_PASSWORD GRAFANA_ADMIN_PASSWORD MASTER_KEK BACKUP_AGE_IDENTITY
{{- if .Values.bundledAi.enabled }} HF_TOKEN{{- end }}
{{- end }}
```

A companion `openwhispr.secretValuesKey` helper maps `UPPER_SNAKE → lowerCamel` so both `secrets.yaml` (helm-values mode) and `externalsecret.yaml` (ESO mode) derive their respective `stringData`/`data` blocks from the same iteration.

### Deviations from plan

**1. [Convention deviation] Parity linter test file location**
Plan `files_modified` listed `tools/__tests__/lint-compose-chart-parity.test.ts`, but the executor authored it as `tools/lint-compose-chart-parity.test.ts` (co-located, matching existing pattern in `tools/`). Verified via `find tools -name '*parity*'`. Vitest picks it up from the project-wide include glob. No functional impact; documenting for accuracy.

**2. [Helper extension] `openwhispr.secretValuesKey` helper added (not in plan signature)**
Task 2 required `openwhispr.requiredSecretKeys`. The executor additionally added `openwhispr.secretValuesKey` (env-name → values-key dict mapping) so `secrets.yaml` and `externalsecret.yaml` could iterate the helper output and look up the corresponding `.Values.secrets.<camelCase>` value. This is a natural consequence of factoring the env list into a helper — without the second helper, each consumer would have hard-coded the case mapping. Rule 2 (auto-add missing critical functionality).

**3. [Helper deprecation alias] `openwhispr.secretPresenceProbeCmd` retained as no-op alias**
The old helper was kept as a deprecated alias (renders a `sh -c 'echo "deprecated"'` body) for any external dependents during the 11-01 transition. No Deployment template references it post-Task 3. Safe to drop in a future cleanup plan.

## Known stubs

None. Variant A bundle is fully wired; no placeholder data flows.

## Threat flags

None — no new network surface, auth path, or trust boundary introduced. The change is a strict reduction in attack surface: HF_TOKEN is no longer demanded by ESO in Variants A/B, reducing Vault secret-scope leakage (ASVS V4 improvement noted in RESEARCH).

## Pointers for downstream sub-plans

- **11-02 (Variant B hardening):** Now relies on the 13-key Variant A baseline. `values-corporate-litellm.yaml` ESO refs should drop the HF_TOKEN data block (it is already conditional on `.Values.bundledAi.enabled` in `externalsecret.yaml`, so the corporate overlay just needs to confirm `bundledAi.enabled: false`).
- **11-03 (Variant C extraction):** Will set `bundledAi.enabled: true` and `secrets.hfToken: <operator-supplied>`. Helper auto-appends HF_TOKEN; ESO data block auto-renders. No further chart change needed for Variant C secret enumeration.
- **11-05 (kind upgrade test — pulled out of this plan):** Anchor SHA captured in `11-DECISIONS.md` §D3 (`40d04fe5b3ea8d3012bb9791d834c2c18040c961`). 11-05 must `git archive` that SHA's `charts/openwhispr/` into `tests/fixtures/pre-11-chart.tar.gz` as its first commit, then build the kind workflow that upgrades from the tarball to HEAD and asserts HF_TOKEN-drop / 12-key preservation.

## Self-Check: PASSED

**Files exist:**

- `charts/openwhispr/templates/probe-helpers.yaml` — FOUND
- `charts/openwhispr/templates/_helpers.tpl` (with `openwhispr.requiredSecretKeys`) — FOUND
- `charts/openwhispr/tests/helpers_required_secret_keys_test.yaml` — FOUND
- `charts/openwhispr/examples/values-embedded-litellm.yaml` — FOUND
- `docker-compose.embedded-litellm.yml` — FOUND
- `.env.embedded.example` — FOUND
- `examples/README.md` — FOUND
- `tools/lint-compose-chart-parity.test.ts` — FOUND

**Commits exist (in order):**

- `4c1ca19` test(11-01): add red helm-unittest cases for hf_token conditional + helpers — FOUND
- `df8cc14` feat(11-01): gate hf_token behind bundledai.enabled in chart secret enumeration — FOUND
- `162c0cd` refactor(11-01): consume openwhispr.requiredSecretKeys helper in all four deployments — FOUND
- `294dba8` feat(11-01): ship variant a embedded-litellm operator bundle (compose + values + env + readme) — FOUND
- `219f8fb` refactor(11-01): scope hf_token as variant-c-only in compose-chart parity linter — FOUND
- `8bae19c` test(11-01): add positive-render guards for variant-c hf_token path — FOUND

**Verification baselines:**

- helm-unittest 125/125 (≥109 D5 baseline + 16 new) — VERIFIED
- `docker-compose.embedded-litellm.yml config -q` — green — VERIFIED
- `helm template charts/openwhispr -f charts/openwhispr/examples/values-embedded-litellm.yaml | grep -c HF_TOKEN` returns `0` — VERIFIED
- `tools/lint-compose-chart-parity.test.ts` 36/36 — VERIFIED
- apps/api, apps/worker, apps/web, packages/i18n untouched (zero file changes under those paths) — VERIFIED
