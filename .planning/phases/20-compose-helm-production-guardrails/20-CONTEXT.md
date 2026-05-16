# Phase 20: Compose+Helm Production Guardrails — Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Source:** Audit-driven (no discuss-phase) — see `20-AUDIT-SOURCE.md` + ROADMAP.md "Phase 20" section
**Mode:** standard (not MVP)

## Phase Boundary

This phase closes **P0 BLOCKER + HIGH-severity findings only** from the 2026-05-16 read-only compose+Helm audit. P1 (NetworkPolicy, POSIX cap_drop, logging driver) and P2 (HPA/PDB on web+litellm, checksum annotations, SELF_HOSTING.md) are explicitly out of scope and stay in the audit backlog for follow-up phases.

Two deployment surfaces are in scope, treated as **one guardrail contract**:
- **Compose** (`docker-compose.yml` + `compose/*.yml` overlays + `compose/e2e/*.yml` + `compose/live-soak/*.yml`) — single-host OSS quickstart + test profiles + load-test profiles.
- **Helm chart** (`charts/openwhispr/`) — K8s production HA, target 1000 concurrent users.

Plus the CI gate that enforces compose lint going forward.

## Locked decisions (from ROADMAP Phase 20 entry — authoritative)

### Compose resource limits (SR-20.1)
- **Every** long-running service in `docker-compose.yml` and every overlay in `compose/*.yml` must declare `deploy.resources.limits.memory`.
- CPU limits optional but recommended.
- Floors: Postgres ≥ 2G; LiteLLM/api ≥ 1G; worker/web ≥ 512M (web's chart-defaults floor of 384M is the lower bound; 512M is the recommended compose-side value per 20-01 PLAN + 20-RESEARCH §3 — adopting 512M to give Next.js standalone build headroom); observability stack right-sized (loki/tempo/mimir ~512M, grafana ~256M, otel-collector ~256M, valkey/traefik ~256M, pgbouncer ~128M, minio ~512M).
- Enforced by new lint script `tools/lint-compose-resources.ts` (vitest-tested ≥ 90/90/90/90 coverage).

### Compose restart policies (SR-20.2)
- `restart: unless-stopped` on:
  - Traefik (`compose/docker-compose.ingress.yml`)
  - PgBouncer (`compose/docker-compose.pgbouncer.yml`)
  - MinIO (`compose/docker-compose.storage.yml`)
  - All 5 LGTM services (`compose/docker-compose.observability.yml`): otel-collector, loki, tempo, mimir, grafana
- Lint script extends to flag missing `restart:` on long-running services.

### Helm startup probes (SR-20.3)
- Targets: `api-deployment.yaml`, `web-deployment.yaml`, `worker-deployment.yaml`, `litellm-deployment.yaml`
- Probe shape: `failureThreshold: 30`, `periodSeconds: 10` → 300 s startup budget
- Reuse existing readiness probe path/port (httpGet for api/web/litellm; exec/pgrep for worker)
- helm-unittest assertions verify presence

### Helm topology spread (SR-20.4)
- Targets: every Deployment (api, web, worker, litellm) + OTel Collector DaemonSet
- Constraint: `maxSkew: 1`, `topologyKey: kubernetes.io/hostname`, `whenUnsatisfiable: ScheduleAnyway`
- Label selector matches the workload
- Values-driven so operators can override per environment

### Helm securityContext (SR-20.5)
Pod-level on api/web/worker/litellm:
- `runAsNonRoot: true`
- `runAsUser: 1000`
- `fsGroup: 1000`
- `seccompProfile: { type: RuntimeDefault }`

Container-level on api/web/worker/litellm:
- `readOnlyRootFilesystem: true`
- `allowPrivilegeEscalation: false`
- `capabilities: { drop: [ALL] }`

OTel Collector (partial — hostmetrics requires root):
- Keeps `runAsUser: 0` (documented exception)
- Adds `allowPrivilegeEscalation: false`
- Adds `seccompProfile: RuntimeDefault`

**Image-runtime audit required.** If any of the 4 app images refuses uid 1000, file an in-phase production-fix sub-task to rebuild the Dockerfile (`USER 1000` + ownership of writable dirs). Where `readOnlyRootFilesystem: true` breaks a runtime (e.g. tmp writes), mount a minimal `emptyDir` and document.

### CI compose-lint job (SR-20.6)
- New job in `.github/workflows/ci.yml` named `compose-lint`
- Runs `docker compose -f docker-compose.yml -f compose/docker-compose.<overlay>.yml … --profile <p> config > /dev/null` across 8 profile combinations: default, contract-test, observability, pgbouncer, storage, load-test-mock, load-test-realistic, e2e
- Parallel to existing helm-lint job
- Required gate on PRs touching `docker-compose*.yml` or `compose/**/*.yml`

### Test-first per constitutional TDD (SR-20.7)
- Every change = RED commit (failing lint / helm-unittest / vitest) → GREEN commit
- No production-only commits without preceding RED
- Per CLAUDE.md "Strict TDD" and Hard Rule #1 (never edit production to make tests pass — but for new tests against new lint logic, RED+GREEN is the *expected* pattern)

## Claude's discretion (planner-owned)

- **Plan boundaries**: ROADMAP suggests 20-01 (compose) / 20-02 (Helm) / 20-03 (CI). Planner may further split Helm work if helm-unittest matrix gets unwieldy (e.g. 20-02a startupProbe+topology / 20-02b securityContext).
- **Lint script implementation**: prefer reusing patterns from `tools/lint-compose-chart-parity.ts` and `tools/lint-traefik-routes.ts` (Phase 19b precedent) — same tsx CLI shape, same vitest layout under `tools/__tests__/`.
- **values.yaml additions**: topologySpread + securityContext blocks SHOULD live under values to allow override; OTel Collector already has `.Values.observability.collector.resources` precedent.
- **Memory-limit values per service**: floors locked in ROADMAP; planner sets exact numbers per service based on observed usage (Phase 8 load-test runs available in `runs/`).
- **Wave/parallelism**: 20-01 (compose) and 20-02 (Helm) are independent — can land in parallel waves. 20-03 (CI compose-lint) depends on 20-01 (lint script exists).

## Constraints (constitutional, non-negotiable)

- **Strict TDD** RED → GREEN → REFACTOR on every commit, every fix
- **Per-phase coverage** ≥ 90% lines/branches/functions/statements on new/modified code
- **English-only** source artifacts
- **No mocks of internal logic** — lint script tests use real YAML fixtures; helm-unittest uses real templates
- **GitHub Actions** is the only CI; all gates wire there
- **No `--no-verify`** on commits
- **HTTPS-only externally** — already enforced, this phase doesn't change ingress posture
- **Hard Rule #1**: never edit production to make tests pass. For new lint/helm-unittest, RED commit asserts the desired guardrail; GREEN commit adds the production YAML keys that satisfy it.
- **Hard Rule #3**: orchestrator verifies sub-agent claims independently (commits exist, tests green, files have claimed edits, working tree clean)

## Out of scope (explicit deferrals)

From the audit's P1/P2 backlog — track in deferred-items or future phases:
- POSIX `cap_drop: [ALL]`, `security_opt: no-new-privileges`, `read_only` on compose (audit A3)
- `logging.driver: json-file` with rotation on compose (audit A4)
- Worker healthcheck on compose (audit A8)
- `ulimits.nofile` on base compose api/traefik/web (audit A10)
- NetworkPolicy templates in Helm (audit B5)
- HPA + PDB for web and litellm in Helm (audit B6, B7)
- `automountServiceAccountToken: false` (audit B8)
- `checksum/config` annotations on api/web/worker Deployments (audit B4)
- Helm schema fail gates on `POSTGRES_APP_PASSWORD`, `MINIO_ROOT_PASSWORD` (audit C2, C4)
- Helm example overlays for contract-test / load-test profiles (audit C3, C9)
- `docs/SELF_HOSTING.md` (audit C10)

## Reference artifacts

- Audit source: `.planning/phases/20-compose-helm-production-guardrails/20-AUDIT-SOURCE.md` (copy of `/Users/dev/.claude/plans/synchronous-forging-ripple.md`)
- ROADMAP entry: `.planning/ROADMAP.md` Phase 20 section
- Compose precedents: `tools/lint-traefik-routes.ts` + `tools/lint-traefik-routes.test.ts` (Phase 19b)
- Helm-unittest precedents: `tests/openwhispr/*.yaml` (Phase 9, 09.1, 09.2)
- CI precedents: `.github/workflows/helm-lint.yml` (parallel structure target for new compose-lint)
- Phase 14 BYOK lint precedents (loud-fail patterns)
- Phase 09.1 live-kind precedent for SR-20.5 verification (uid 1000 image-runtime audit)
