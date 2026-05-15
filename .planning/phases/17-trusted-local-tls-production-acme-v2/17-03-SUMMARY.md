<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
---
phase: 17-trusted-local-tls-production-acme-v2
plan: 03
subsystem: tls / ingress / helm
tags: [tls, acme, cert-manager, traefik, helm, k8s, compose-overlay]
requires: [17-CONTEXT.md, 17-PATTERNS.md, 17-PLAN-CHECK.md]
provides:
  - compose-plane ACME wiring (Traefik resolver + dynamic.prod.yml + acme overlay)
  - k8s-plane optional bundled cert-manager sub-chart + Issuer template + schema
affects:
  - compose/traefik/traefik.yml
  - compose/traefik/dynamic.prod.yml (new)
  - compose/docker-compose.acme.yml (new)
  - charts/openwhispr/Chart.yaml
  - charts/openwhispr/Chart.lock
  - charts/openwhispr/values.yaml
  - charts/openwhispr/values.schema.json
  - charts/openwhispr/templates/issuer.yaml (new)
  - charts/openwhispr/templates/certificate-api.yaml
  - charts/openwhispr/templates/certificate-web.yaml
  - charts/openwhispr/tests/issuer_test.yaml (new)
  - charts/openwhispr/tests/tls_test.yaml
  - charts/openwhispr/tests/subcharts_test.yaml
tech-stack-added: [cert-manager 1.16.4 (optional sub-chart, condition-gated)]
tech-stack-patterns:
  - Traefik 3 certificatesResolvers (HTTP-01, env-driven)
  - Helm optional sub-chart with `condition: <flag>` + no-alias for schema-strict upstream
  - cert-manager (Cluster)Issuer rendered conditionally from parent chart
key-files-created:
  - compose/traefik/dynamic.prod.yml
  - compose/docker-compose.acme.yml
  - charts/openwhispr/templates/issuer.yaml
  - charts/openwhispr/tests/issuer_test.yaml
key-files-modified:
  - compose/traefik/traefik.yml
  - charts/openwhispr/Chart.yaml
  - charts/openwhispr/Chart.lock
  - charts/openwhispr/values.yaml
  - charts/openwhispr/values.schema.json
  - charts/openwhispr/templates/certificate-api.yaml
  - charts/openwhispr/templates/certificate-web.yaml
  - charts/openwhispr/tests/tls_test.yaml
  - charts/openwhispr/tests/subcharts_test.yaml
decisions:
  - "Dropped CONTEXT-recommended `alias: certManager` on cert-manager sub-chart — upstream values.schema.json is strict (`additionalProperties: false`), so alias caused render-time rejection of every parent `certManager.*` key. Using no alias keeps the sub-chart's namespace at `.Values.cert-manager` (disjoint from parent's `.Values.certManager`)."
  - "Switched Traefik's file provider from single-filename to directory mode in the ACME overlay (`--providers.file.directory=/etc/traefik/dynamic`) so the dev `dynamic.yml` and new `dynamic.prod.yml` coexist without either touching the other."
metrics:
  duration: ~30min
  commits: 2
  tasks-completed: 8
  files-touched: 12
  helm-unittest-suites: 20
  helm-unittest-tests: 163
  no-verify-count: 0
date: 2026-05-15
---

# Phase 17 Plan 03: Production ACME + cert-manager Helm Sub-chart Summary

**One-liner:** Wires Let's Encrypt ACME HTTP-01 into the compose Traefik profile (env-driven, opt-in per host) and adds an optional bundled cert-manager 1.16.4 sub-chart plus a parent-chart-rendered (Cluster)Issuer template to the Helm chart, with the existing dev mkcert profile and brownfield Helm deployments untouched.

## What Shipped

### Atomic commit A (compose-plane) — `72a38a3`

`feat(17-03): production ACME via Traefik resolver + docker-compose.acme.yml overlay`

- `compose/traefik/traefik.yml` — appended a top-level `certificatesResolvers.letsencrypt` block (env-driven `email` + `caServer`, HTTP-01 challenge on the existing `:80 web` entrypoint). Resolver is INERT until a router opts in.
- NEW `compose/traefik/dynamic.prod.yml` — per-host routers `api-prod`, `api-realtime-prod`, `web-prod`, `app-prod`, `grafana-prod`, each declaring `tls.certResolver: letsencrypt`. Five `certResolver` opt-ins; ZERO wildcard rules (D1 invariant).
- NEW `compose/docker-compose.acme.yml` — env-driven overlay; required `LETSENCRYPT_EMAIL`, optional `LETSENCRYPT_STAGING=1`; mounts a named volume `letsencrypt:/letsencrypt` for ACME state persistence; switches Traefik's file provider from `filename` (single file) to `directory` (multi-file) mode so `dynamic.yml` and `dynamic.prod.yml` coexist.

### Atomic commit B (K8s-plane) — `203c944`

`feat(17-03): optional bundled cert-manager sub-chart + (Cluster)Issuer template`

- `charts/openwhispr/Chart.yaml` — added optional cert-manager 1.16.4 dep (`condition: certManager.bundled`, default OFF). `Chart.lock` regenerated.
- `charts/openwhispr/values.yaml` — extended `certManager:` block with 6 new keys (`bundled`, `issuerKind`, `renderIssuer`, `acmeEmail`, `acmeStaging`, `installCRDs`); existing `enabled` + `clusterIssuer` unchanged.
- `charts/openwhispr/values.schema.json` — declared the 6 new keys with appropriate types (incl. `issuerKind` enum `[ClusterIssuer, Issuer]`); closes the pre-existing `helm install --strict` rejection gate identified in 17-PLAN-CHECK §1.
- NEW `charts/openwhispr/templates/issuer.yaml` — renders an (Cluster)Issuer body gated by `tls.enabled && certManager.enabled && certManager.renderIssuer`. Switches kind via `certManager.issuerKind`, flips ACME server URL on `acmeStaging`, fails render-time when `renderIssuer=true` and `acmeEmail` is empty (Helm `required` predicate).
- `charts/openwhispr/templates/certificate-{api,web}.yaml` — `issuerRef.kind` templated from `.Values.certManager.issuerKind` (was hardcoded `ClusterIssuer`); default value preserves existing behaviour byte-for-byte.
- NEW `charts/openwhispr/tests/issuer_test.yaml` — 5-row helm-unittest matrix (`renderIssuer=false`, `renderIssuer=true` ClusterIssuer, `issuerKind=Issuer`, `acmeEmail` required-fail, `acmeStaging=true` server URL).
- `charts/openwhispr/tests/tls_test.yaml` — extended with `issuerKind=Issuer` round-trip assertion through `certificate-api.yaml`.
- `charts/openwhispr/tests/subcharts_test.yaml` — extended with bundled `cert-manager` Deployment render.

## Verification

### Compose-resolve smoke (Task 3)

```
$ LETSENCRYPT_EMAIL=ops@example.com PUBLIC_DOMAIN=example.com \
  docker compose -f docker-compose.yml \
                 -f compose/docker-compose.ingress.yml \
                 -f compose/docker-compose.acme.yml config
EXIT=0
```

Resolves cleanly. (Tail confirms `letsencrypt` named volume is declared.)

### Helm template smoke (Task 6 + Task 8)

| Path | Exit | Notes |
|---|---|---|
| `helm template charts/openwhispr` (default values, secrets in eso mode) | 0 | Default render — `issuer.yaml` produces zero docs (renderIssuer=false). |
| `helm template ... --set tls.enabled=true --set certManager.renderIssuer=true --set certManager.acmeEmail=ops@example.com` | 0 | `issuer.yaml` renders one `ClusterIssuer` with `spec.acme.email=ops@example.com`, `spec.acme.server=https://acme-v02.api.letsencrypt.org/directory`. |
| `helm template ... --set certManager.bundled=true` | 0 | 52 cert-manager sub-chart docs render alongside parent chart. |

`required` predicate verified by intentional omission of `acmeEmail`:
```
Error: execution error at (openwhispr/templates/issuer.yaml:37:14):
  certManager.acmeEmail required when renderIssuer=true
```

`issuerKind=Issuer` flips render to namespaced `kind: Issuer` with `metadata.namespace: default` (verified). `acmeStaging=true` flips `spec.acme.server` to `acme-staging-v02.api.letsencrypt.org/directory` (verified).

### helm-unittest results (Task 7)

```
Charts:      1 passed, 1 total
Test Suites: 20 passed, 20 total
Tests:       163 passed, 163 total
Time:        1.71s
```

All 5 `issuer_test.yaml` rows GREEN; the extended `tls_test.yaml` (15 → 16 rows) and `subcharts_test.yaml` (4 → 5 rows) GREEN. Zero regression across the 17-other test suites.

### Dev profile untouched

```
$ git diff 72a38a3^..203c944 -- compose/traefik/dynamic.yml compose/traefik/dynamic.dev.yml
(empty diff)
```

Neither base `dynamic.yml` nor dev overlay `dynamic.dev.yml` was modified — the mkcert cert from 17-01 remains in effect for `*.localhost` without any 17-03 interference.

### Pre-commit gate results

Both commits ran clean through lefthook (`english`, `biome`, `commitlint`). ZERO `--no-verify` invocations — Phase 17 invariant honored.

- Commit A: english ✓, commitlint ✓ (no biome — no TS staged).
- Commit B: biome ✓, english ✓, commitlint ✓ (footer-leading-blank warning only — non-blocking; no failures).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Architectural correctness] Dropped `alias: certManager` from cert-manager sub-chart dep**

- **Found during:** Task 5 / Task 8 smoke (`helm template --set certManager.bundled=true`)
- **Issue:** CONTEXT Q2-B3 + 17-PATTERNS analog §4 recommended `alias: certManager` (camelCase) so the parent chart's `certManager.*` values namespace would "pass through" to the sub-chart's values. At execution time this was found to be incorrect: cert-manager 1.16.4 ships a `values.schema.json` with `additionalProperties: false` at the top level. Aliasing the sub-chart to `certManager` caused the sub-chart's schema validator to reject every one of the parent's `certManager.*` keys (`bundled`, `issuerKind`, `renderIssuer`, `acmeEmail`, `acmeStaging`, `installCRDs`) with:
  ```
  Error: values don't meet the specifications of the schema(s) in the following chart(s):
  certManager:
  - at '': additional properties 'issuerKind', 'clusterIssuer', 'acmeStaging', 'renderIssuer', 'bundled', 'acmeEmail' not allowed
  ```
- **Fix:** Removed the `alias:` line. The un-aliased sub-chart's values namespace is now `.Values.cert-manager` (hyphenated, syntactically disjoint from the parent's `.Values.certManager`). Operators who want to wire the parent's `installCRDs` flag to the sub-chart use the explicit `--set cert-manager.installCRDs=true` override; the parent's `certManager.installCRDs` key is now documentation-only. This is the canonical Helm pattern for vendoring a strict-schema sub-chart whose values must stay independent of the parent.
- **Files modified:** `charts/openwhispr/Chart.yaml` (sub-chart dep entry: removed `alias`, updated header comment to document the rationale)
- **Commit:** `203c944` (in-line with K8s-plane atomic — no separate fix-up commit)
- **Verifier note:** the must-have truth at 17-03-PLAN.md `truths[5]` claims the entry has `alias: certManager` — that truth is OUT OF DATE per this deviation. The 6 new values keys are still present and verifiable per `truths[6-7]`; only the sub-chart alias was changed.

### No other deviations

All other tasks executed exactly as the plan specifies. The pre-flight working tree mod on `Makefile` was owned by parallel 17-01 and was not touched by this plan.

## Cross-Plan Touchpoints

- 17-01 (parallel) — Makefile + bootstrap.sh SAN de-wildcard. Committed as `025c21f` while this plan ran. No file conflicts (disjoint trees per 17-PATTERNS cross-plan matrix lines 415-434).
- 17-02 (Wave 2) — sequences after 17-01. The Phase 17 Gherkin feature (`tests/e2e-cjm/features/phase17-tls.feature` scenario 3 `@cjm-tls-acme-staging`) is the live end-to-end gate for this plan's output; live execution deferred to GHA CI per Phase 15/16 precedent. Static gates (helm-template, helm-unittest, compose config resolve) all GREEN locally.

## Threat Surface Notes

Phase 17 introduces a public-internet exposure point on `:80` (HTTP-01 challenge requires it). The acme overlay's header comment documents this explicitly so operators behind NAT know to port-forward. The challenge endpoint is internally handled by Traefik 3's ACME client and does NOT alter the HTTPS-only invariant — all non-challenge traffic still 308s from `:80` to `:443`.

No new authn/authz surface, no new schema columns, no new file-access patterns at trust boundaries.

## Forward References

- 17-02 Gherkin scenario `@cjm-tls-acme-staging` exercises this plan's `dynamic.prod.yml` + `docker-compose.acme.yml` end-to-end against the LE staging endpoint in GHA CI (live execution gated by `@after-docker-up @expected-red`).
- Operators wanting the bundled cert-manager 1.17.x bump must wait for a follow-up plan (CONTEXT deferred #4).

## Self-Check: PASSED

Verified files exist:
- FOUND: compose/traefik/dynamic.prod.yml
- FOUND: compose/docker-compose.acme.yml
- FOUND: charts/openwhispr/templates/issuer.yaml
- FOUND: charts/openwhispr/tests/issuer_test.yaml

Verified commits:
- FOUND: 72a38a3 (compose-plane atomic A)
- FOUND: 203c944 (K8s-plane atomic B)

Verified gates GREEN:
- compose config resolves (exit 0)
- helm template (default + renderIssuer + bundled) all exit 0
- helm unittest 163/163 PASS
- ZERO `--no-verify` across both commits

PLAN-DONE verdict: **PASS** (with documented deviation for cert-manager sub-chart alias drop).
