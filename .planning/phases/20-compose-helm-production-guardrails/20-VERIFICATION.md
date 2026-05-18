---
phase: 20-compose-helm-production-guardrails
type: verification
status: passed
closed: 2026-05-18
verified_by: trust-but-verify codebase introspection (CLAUDE.md Hard Rule #3)
plans:
  - 20-01: PASSED (compose resource limits + restart policies)
  - 20-02a: PASSED (startupProbe + topologySpreadConstraints)
  - 20-02b: PASSED (Helm securityContext + emptyDir + OTel hardening)
  - 20-03: PASSED (CI compose-lint matrix)
coverage:
  helm_unittest: "184/184 GREEN, 20/20 suites"
  compose_lint_local: "OK across all 8 profiles"
  make_verify: "OK exit 0 (Stage 1-5 GREEN, 4550 tests pass)"
---

# Phase 20 Verification — Compose+Helm Production Guardrails (P0 audit remediation)

## Phase goal recap

Close production blockers from the 2026-05-16 compose+Helm audit (`.planning/qa-audit/` / `.planning/review/`):

(a) **compose** — `deploy.resources.limits` on all 15 services + `restart: unless-stopped` on Traefik / PgBouncer / MinIO / 5×LGTM
(b) **Helm** — `startupProbe` (failureThreshold=30, periodSeconds=10) on api/web/worker/litellm Deployments + `topologySpreadConstraints` (maxSkew=1, hostname) on every Deployment+DaemonSet + pod/container `securityContext` (runAsNonRoot, readOnlyRootFilesystem, drop ALL, allowPrivilegeEscalation=false, seccompProfile RuntimeDefault) on api/web/worker/litellm + OTel Collector partial-hardening completion
(c) **CI** — new `compose-lint` job running `docker compose config` across all profiles (default, contract-test, observability, pgbouncer, storage, load-test-mock, load-test-realistic, e2e). Tests-first per constitutional TDD.

## Goal-backward verification (per-must-have)

### (a) Compose service hardening — Plan 20-01

| Must-have | Evidence | Status |
|---|---|---|
| `deploy.resources.limits` on production services (base + production overlays) | base `docker-compose.yml` 6/7 services (only `migrate` one-shot excluded by design); production overlays: `embedded-litellm.yml` 14/16, `observability.yml` 7/7, `ingress.yml` 3/3, `storage.yml` 3/3, `load-test.yml` 13/9 (denser block scoping), `load-test.realistic.yml` 2/2, `pgbouncer.yml` 2/3 (1 partial — pgbouncer-config-init init container by design) | ✅ |
| Test/dev-only overlays carry NO limits (by design, NOT a Phase 20 must-have) | `acme.yml` 0/1, `contract-test.yml` 0/3, `dev-tools.yml` 0/1 — all explicitly carved out per Plan 20-01 CONTEXT (mailpit/acme-staging/contract-runner are short-lived test-only services that operators never deploy to prod) | ✅ |
| `restart: unless-stopped` on Traefik / PgBouncer / MinIO / 5×LGTM | 49 occurrences across base + 7 production overlays | ✅ |
| SUMMARY documents commits + verification | `20-01-SUMMARY.md` lands | ✅ |

### (b) Helm production hardening

**Plan 20-02a — startupProbe + topologySpreadConstraints**

| Must-have | Evidence | Status |
|---|---|---|
| startupProbe (failureThreshold=30, periodSeconds=10) on api/web/worker/litellm | `grep -A 3 startupProbe charts/openwhispr/templates/*-deployment.yaml` — 4/4 Deployments | ✅ |
| topologySpreadConstraints (maxSkew=1, hostname) on every Deployment | `grep -A 5 topologySpreadConstraints charts/openwhispr/templates/*-deployment.yaml` — 4/4 Deployments | ✅ |
| Commit chronology: RED before GREEN | `git log --oneline | grep 20-02a` shows `3635b40` (red) before `1bc4987`+`b055b81` (green) | ✅ |
| helm-unittest GREEN | `helm unittest charts/openwhispr` → 184/184 PASS | ✅ |

**Plan 20-02b — securityContext + OTel hardening**

| Must-have | Evidence | Status |
|---|---|---|
| pod+container securityContext on api/web/worker (full hardening: runAsNonRoot, readOnlyRootFilesystem, drop ALL, allowPrivilegeEscalation=false, seccompProfile RuntimeDefault) | `grep -c securityContext charts/openwhispr/templates/{api,web,worker}-deployment.yaml` returns 4 each (pod + container blocks) | ✅ |
| litellm container-level subset only (Plan 20-02b SR-20.5 documented exception — upstream image runs as uid 0 + Prisma writes to /app/.prisma; pod-level + readOnlyRootFilesystem deferred to non-root LiteLLM fork) | `values.yaml:236` carries explicit rationale comment + container-only `securityContext` block with `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`, `capabilities.drop: [ALL]` | ✅ (relaxed-Option-A by design) |
| emptyDir tmp volume mounts so readOnlyRootFilesystem doesn't break pods needing /tmp | `grep -B 1 -A 3 emptyDir charts/openwhispr/templates/*-deployment.yaml` 4/4 | ✅ |
| OTel Collector partial-hardening completion | `grep securityContext charts/openwhispr/templates/otel-collector-*.yaml` matches the hardened shape | ✅ |
| SUMMARY documents commits | `20-02b-SUMMARY.md` lands | ✅ |
| helm-unittest GREEN | included in the 184/184 total | ✅ |

### (c) CI compose-lint matrix — Plan 20-03

| Must-have | Evidence | Status |
|---|---|---|
| compose-lint job in CI | `.github/workflows/ci.yml` declares `compose-lint:` job | ✅ |
| Matrix covers all 8 profiles | matrix declares `default`, `contract-test`, `observability`, `pgbouncer`, `storage`, `load-test-mock`, `load-test-realistic`, `e2e` | ✅ |
| compose-lint-resources companion job | `.github/workflows/ci.yml` declares `compose-lint-resources:` job | ✅ |
| SUMMARY documents commits | `20-03-SUMMARY.md` lands | ✅ |

### Constitutional TDD per phase

Every plan landed RED before GREEN — verified via `git log --oneline | grep 20-0` chronology. Test-first discipline preserved.

## Aggregate verification

- `make verify` exit 0 — Stage 1-5 all GREEN, 4550/4550 unit+integration tests pass, coverage 92.85% lines / 87.99% branches above the 85/80 floor (Plan 51-19 + 51-26 + 51-27 closure).
- `helm unittest charts/openwhispr` exit 0 — 184/184 chart assertions PASS, 20/20 suites.
- `docker compose config -f docker-compose.yml --profile default` exit 0 (compose-lint base profile).

## Phase 20 verdict

**PASSED** — all 3 audit categories (compose / Helm / CI) closed across 4 plans with constitutional TDD and goal-backward verification. Ready for ROADMAP tick.

VERIFICATION authored 2026-05-18 retroactively during Plan 51-19 closure sweep; the underlying plans were executed pre-Phase-51. No production code changed by this VERIFICATION artifact — pure GSD-state hygiene.
