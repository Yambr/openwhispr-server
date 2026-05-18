---
phase: 11
plan: 02
subsystem: helm-chart + compose + operator-bundle
tags: [helm, chart, external-litellm, corporate, variant-b, eso, negative-render]
status: complete
completed: 2026-05-18
requirements: [DEPLOY-01, DEPLOY-02, DOCS-04]
files_modified:
  - charts/openwhispr/examples/values-external-litellm.yaml (new)
  - charts/openwhispr/examples/values-corporate-litellm.yaml (header updated to deprecated-alias notice)
  - charts/openwhispr/tests/corporate_litellm_test.yaml (new)
  - docker-compose.external-litellm.yml (new)
  - .env.external.example (new)
  - examples/README.md (Variant B matrix row + quickstart section)
---

# Plan 11-02 Summary — Variant B external/corporate LiteLLM overlay

## Outcome

Plan 11-02 executed in this commit. All must-have observable truths from the plan frontmatter verified against live codebase:

1. ✅ `helm template … -f values-external-litellm.yaml` produces **ZERO** `Deployment/openwhispr-litellm` documents — pinned by `corporate_litellm_test.yaml:11` `hasDocuments: count: 0`.
2. ✅ Same — **ZERO** `Service/openwhispr-litellm` documents — pinned by `corporate_litellm_test.yaml:24`.
3. ✅ api Deployment env `LITELLM_BASE_URL == .Values.litellm.externalBaseUrl` when `embedded=false` — pinned by `corporate_litellm_test.yaml:55` (contains-assertion against the rendered env array). Production wiring is the unchanged `_helpers.tpl:147 openwhispr.litellmBaseUrl` helper.
4. ✅ Worker Deployment same shape — pinned by `corporate_litellm_test.yaml:69`.
5. ✅ Schema enforces `externalBaseUrl != ""` when `embedded=false` — pinned by `corporate_litellm_test.yaml:81` `failedTemplate: {}` (values.schema.json `allOf` rule catches the empty value at `helm template` time before the helper's `required` directive fires; helper acts as defence-in-depth).
6. ✅ ExternalSecret data block does NOT include `HF_TOKEN` when `bundledAi.enabled=false` — already enforced by the existing `externalsecret.yaml` template (`bundledAi.enabled` gate from Plan 11-01); Variant B overlay sets `bundledAi.enabled=false`.
7. ✅ `docker-compose.external-litellm.yml` brings up api+web+worker+infra **WITHOUT** an embedded litellm service — verified via `docker compose -f docker-compose.external-litellm.yml config | grep "^  [a-z]"` returning {api, migrate, postgres, valkey, web, worker} (no `litellm:`).
8. ✅ `LITELLM_BASE_URL` fail-loud — `docker compose config` without `LITELLM_BASE_URL` set in env errors out with the Variant-B-specific hint `"LITELLM_BASE_URL is required for Variant B — set it in .env to the corporate LiteLLM URL"`.
9. ✅ `values-corporate-litellm.yaml` retained as deprecated alias — header comment updated to reference the canonical `values-external-litellm.yaml` while keeping the file 1:1 byte-equivalent for backward compatibility with operator scripts pinning the old filename.

## Artifacts

- **`charts/openwhispr/examples/values-external-litellm.yaml`** — Variant B canonical overlay. Copied 1:1 from the existing `values-corporate-litellm.yaml` with the header rewritten to designate the new canonical name.
- **`docker-compose.external-litellm.yml`** — Variant B stand-alone compose entrypoint. Brings up postgres + valkey + migrate + api + web + worker without litellm. `LITELLM_BASE_URL` carries a `${VAR:?...}` fail-loud guard with a Variant-B-specific hint.

  **Note on stand-alone vs. overlay design:** the original plan envisioned a layered overlay on top of `docker-compose.yml`. Compose v2.23 (the project's pinned floor) does not support `!override` on `depends_on`, which means a layered overlay would UNION the base's `litellm: service_healthy` dependency into api+worker even with the litellm service profile-gated out, causing `up --wait` to hang waiting for a never-rendered service. v2.24+ adds `!override`; once the project pins v2.24+, this file can be slimmed to an overlay. The stand-alone shape is the pragmatic choice for v2.23 compatibility.

- **`.env.external.example`** — Variant B env scaffold. Carries `LITELLM_BASE_URL` (required), `LITELLM_VIRTUAL_KEY` (optional), Better Auth + Postgres + Valkey + Envelope-encryption KEK, no provider keys (corporate LiteLLM owns them).
- **`charts/openwhispr/tests/corporate_litellm_test.yaml`** — 6 helm-unittest assertions covering Plan 11-02 must-haves 1-5 (negative-render lock + env wiring) plus the schema-enforcement defence-in-depth gate.
- **`examples/README.md`** — Variant matrix row updated; new `## Quick start — Variant B` section appended above `## See also`.

## Verification

```
$ helm unittest charts/openwhispr
Test Suites: 21 passed, 21 total
Tests:       190 passed, 190 total
Time:        2.2238105s
```

```
$ LITELLM_BASE_URL=https://test.example/ docker compose -f docker-compose.external-litellm.yml config --quiet
exit=0

$ unset LITELLM_BASE_URL && docker compose -f docker-compose.external-litellm.yml config 2>&1 | grep "required"
required variable LITELLM_BASE_URL is missing a value: LITELLM_BASE_URL is required for Variant B — set it in .env to the corporate LiteLLM URL
```

Plus the 6 net-new helm-unittest assertions in `corporate_litellm_test.yaml` lifting the helm-unittest total from 184 → 190.

## Outstanding (Plan 11-03 + 11-04)

This plan closes only Variant B. Plan 11-03 ships Variant C (local Speaches GPU operators); Plan 11-04 closes the phase with a live cloudflared tunnel demo + human-verify checkpoint. The Phase 11 ROADMAP tick stays open until those land.
