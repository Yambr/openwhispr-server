# Phase 20: Compose+Helm Production Guardrails — Context (recovered)

**Gathered:** 2026-05-16
**Recovered:** 2026-05-16 (original artifacts lost to parallel `git clean -fd` from sibling worktree agents; reconstructed from in-history commit messages + locked-decision memory)
**Status:** Wave A complete (commits on main); Wave B + C pending
**Source:** Audit-driven (`/Users/dev/.claude/plans/synchronous-forging-ripple.md` was the source audit; runtime SC7 PASS captured below)
**Worktree:** `.claude/worktrees/phase-20-wave-bc` (branch `phase-20-wave-bc`)

## Phase Boundary

Closes **P0 BLOCKER + HIGH-severity** findings only from the 2026-05-16 compose+Helm audit. P1/P2 backlog stays for follow-up phases. Two deployment surfaces (compose + Helm) treated as one guardrail contract.

## Locked decisions (from ROADMAP Phase 20 entry — authoritative)

### SR-20.1 Compose resource limits
- Every long-running service declares `deploy.resources.limits.memory`
- Floors: postgres 2G, litellm/api 1G, worker/web 512M, observability sized per service
- Enforced by `tools/lint-compose-resources.ts` (≥ 90/90/90/90 coverage)

### SR-20.2 Compose restart policies
- `restart: unless-stopped` on Traefik, PgBouncer, MinIO, 5 LGTM services (otel-collector, loki, tempo, mimir, grafana)

### SR-20.3 Helm startupProbe
- Targets: api/web/worker/litellm Deployments
- `failureThreshold: 30`, `periodSeconds: 10` → 300 s budget
- Reuse readiness probe path/port (exec/pgrep for worker)

### SR-20.4 Helm topologySpreadConstraints
- Targets: api/web/worker/litellm Deployments only
- **OTel DaemonSet EXEMPT** — DaemonSet controller already enforces 1-pod-per-node, spread is no-op
- `maxSkew: 1`, `topologyKey: kubernetes.io/hostname`, `whenUnsatisfiable: ScheduleAnyway`

### SR-20.5 Helm securityContext
**Pod-level** (api/web/worker/litellm):
- `runAsNonRoot: true`, `runAsUser: 1000`, `fsGroup: 1000`, `seccompProfile: RuntimeDefault`

**Container-level** (api/web/worker):
- `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`

**LiteLLM relaxed-hardening exception** (upstream image runs as uid 0, Prisma writes /app/.prisma):
- Drop runAsNonRoot, runAsUser, readOnlyRootFilesystem
- Keep `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`, `capabilities.drop: [ALL]`
- File "LiteLLM non-root image fork" in deferred-items.md

**OTel Collector partial-hardening completion**:
- Already has runAsUser: 0 (intentional — hostmetrics needs root), readOnlyRootFS, drop ALL
- Add `allowPrivilegeEscalation: false` + `seccompProfile: RuntimeDefault`

**Dockerfile changes required**:
- apps/api/Dockerfile: `USER 1000` (currently `USER node` uid 1000 — make explicit)
- apps/worker/Dockerfile: `USER 1000` (currently `USER node` uid 1000)
- apps/web/Dockerfile: switch uid 1001 → 1000, `mkdir -p /app/apps/web/.next/cache` BEFORE numeric `chown -R 1000:1000`
- emptyDir mounts for /tmp (api/worker), /tmp + /app/apps/web/.next/cache (web)

### SR-20.6 CI compose-lint job
- New `compose-lint` job in `.github/workflows/ci.yml`
- 8 profile combinations via matrix: default, contract-test, observability, pgbouncer, storage, load-test-mock, load-test-realistic, e2e
- Parallel to helm-lint, gates merge to main

### SR-20.7 Test-first TDD
- RED → GREEN per file
- 20-03 (CI single-file YAML) has documented divergence-by-design exception: RED→GREEN signal captured as CI run URLs in SUMMARY

## Wave A status (COMPLETE — 6 commits on main)

| SHA | Plan | Type | Message |
|---|---|---|---|
| `120fda1` | 20-01-01 | RED | test(20-01-01): red — lint-compose-resources fails on services missing limits + restart |
| `3635b40` | 20-02a-01 | RED | test(20-02a-01): red — helm-unittest fails on missing startupProbe + topologySpread |
| `1bc4987` | 20-02a-02 | GREEN | feat(20-02a-02): green — startupProbe on api/web/worker/litellm Deployments |
| `b055b81` | 20-02a-03 | GREEN | feat(20-02a-03): green — topologySpreadConstraints on 4 Deployments |
| `a5614e2` | 20-01-02 | GREEN | feat(20-01-02): green — compose resource limits + restart + lint-english unblock |
| `b9e5210` | 20-01-03 | chore | chore(20-01-03): wire make lint-compose-resources target |

**SC7 runtime verification: PASS** (daemon-restart smoke 2026-05-16T11:56Z — all 14 containers auto-restarted within ~20 s of Docker Desktop daemon coming back online after `osascript quit Docker.app` + `open Docker.app` cycle). The `docker kill` recipe in the original PLAN was misleading: Docker Desktop treats CLI `docker kill` as user-initiated stop and does NOT trigger `restart: unless-stopped`. Daemon-restart is the authoritative test. Evidence in 20-01-SUMMARY.md.

## Wave B (20-02b) — pending in this worktree

7 atomic-per-file commits (TDD RED+GREEN pairs where applicable), push after each. See 20-02b-PLAN.md.

## Wave C (20-03) — pending in this worktree

Single commit (CI YAML divergence-by-design). See 20-03-PLAN.md.

## Constraints (constitutional, non-negotiable)

- Strict TDD RED → GREEN per file
- ≥ 90/90/90/90 coverage on new/modified TS
- English-only source artifacts
- No `--no-verify`, no destructive git ops
- Hard Rule #1: never edit production to make tests pass (new lint = RED first, GREEN satisfies)
- Hard Rule #3: orchestrator verifies sub-agent claims independently
- **NEW LOCKER-01..06** (CLAUDE.md updated mid-session): lint-no-env-branches, lint-no-suppressions, lint-no-hardcode, lint-prod-readiness, lint-secret-shape-in-error, lint-shell-credential-interpolation
- **Concurrency safety** (16 parallel worktrees on shared main): atomic commits + immediate `git push`-equivalent (locally: keep work on `phase-20-wave-bc` branch, merge to main only at end)

## Out of scope (P1/P2 deferrals from audit)

POSIX cap_drop/read_only/security_opt on compose (A3), logging driver (A4), worker healthcheck (A8), ulimits.nofile (A10), NetworkPolicy templates (B5), HPA/PDB web+litellm (B6/B7), automountServiceAccountToken: false (B8), checksum/config annotations (B4), schema fail gates on POSTGRES_APP_PASSWORD/MINIO_ROOT_PASSWORD (C2/C4), Helm example overlays for contract-test/load-test (C3/C9), docs/SELF_HOSTING.md (C10).

## Recovery notes

Original artifacts (`20-RESEARCH.md` ~72KB, `20-PATTERNS.md` ~33KB, full versions of PLAN.md files, PLAN-CHECK.md) were authored 2026-05-16 morning in the shared `/Users/dev/openwhispr-server` checkout and **never committed to git**. They were deleted by `git clean -fd` from one of 15 sibling worktree executor agents (phases 22–30, 42) working in shared checkout concurrently. The 6 Phase 20 production commits survived (they were `git commit`-ed before the clean). 

This recovered CONTEXT.md + 20-02b-PLAN.md + 20-03-PLAN.md are derived from:
1. Commit messages of `120fda1`, `3635b40`, `1bc4987`, `b055b81`, `a5614e2`, `b9e5210` (rich, detailed, captured locked decisions)
2. ROADMAP Phase 20 section (`.planning/ROADMAP.md` lines 1064–1085) — authoritative SR-20.1..SR-20.7 + 8 Success Criteria
3. Orchestrator memory of the planner+plan-checker round-trip (loop 1 CONCERNS → 7 fixes → loop 2 PASS-WITH-NOTES)

Lost forever (low-impact): the RESEARCH.md memory-floor tables (now in `a5614e2` commit body), PATTERNS.md analog mappings (commit body of `a5614e2` cites `tools/lint-traefik-routes.ts` as primary analog). RESEARCH §5 (DaemonSet exemption rationale) and §6 (LiteLLM Option-A relaxed-hardening) are recovered in the SR-20.4 / SR-20.5 sections above. RESEARCH §10 P2 (Docker Desktop `docker kill` quirk) is recovered in the SC7 section above.
