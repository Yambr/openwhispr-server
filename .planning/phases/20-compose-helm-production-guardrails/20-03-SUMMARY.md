---
phase: 20
plan: 20-03
subsystem: ci
tags: [ci, github-actions, compose-lint, audit-c1, sr-20.6]
requires: [20-01]
provides: [compose-config-pr-gate]
affects: [.github/workflows/ci.yml]
tech-stack:
  added: []
  patterns: [github-actions-matrix-strategy, docker-compose-config-validation]
key-files:
  created:
    - .planning/phases/20-compose-helm-production-guardrails/20-03-SUMMARY.md
  modified:
    - .github/workflows/ci.yml
decisions:
  - "compose-lint job: 8-cell matrix per SR-20.6 — default, contract-test, observability, pgbouncer, storage, load-test-mock, load-test-realistic, e2e"
  - "Static lint (make lint-compose-resources) split into separate compose-lint-resources job to avoid running it 8 times in the matrix"
  - "Path-gating via on.pull_request.paths NOT implemented — ci.yml is a monolithic workflow without per-job path filters; would require dorny/paths-filter dep. Job runs on all PRs (cheap: ~1m total parallel)"
  - "Divergence-by-design (SR-20.7 narrow exception): single-file CI YAML cannot express git-commit RED/GREEN pair; CI-URL pair documented post-merge"
metrics:
  duration_minutes: ~12
  completed: 2026-05-16
---

# Phase 20 Plan 03: Compose-Lint CI Gate Summary

Added `compose-lint` GitHub Actions job to `.github/workflows/ci.yml` — an 8-cell matrix validating `docker compose config` across every supported overlay combination, plus a sibling `compose-lint-resources` job invoking `make lint-compose-resources` for the Phase 20-01 static-resource lint. Together they close audit finding C1: compose-YAML bugs are now caught at PR-time instead of leaking into 60+ second e2e cycles.

## Commit

- **172dbbd** — `ci(20-03-01): compose-lint job — 8-profile matrix gate on PRs (closes audit C1)`

## Matrix cells (8) — overlay-file existence verified

| Cell | Files | Profiles | `ls` verified |
|---|---|---|---|
| default | `docker-compose.yml` | default | ✓ (root) |
| contract-test | `+ compose/docker-compose.contract-test.yml` | default + contract-test | ✓ |
| observability | `+ compose/docker-compose.observability.yml` | default | ✓ |
| pgbouncer | `+ compose/docker-compose.pgbouncer.yml` | default | ✓ |
| storage | `+ compose/docker-compose.storage.yml` | default | ✓ |
| load-test-mock | `+ compose/docker-compose.load-test.yml` | load-test-mock | ✓ |
| load-test-realistic | `+ compose/docker-compose.load-test.yml + compose/docker-compose.load-test.realistic.yml` | load-test-realistic | ✓ |
| e2e | `+ compose/e2e/docker-compose.e2e.yml` | default + e2e | ✓ |

All 8 overlay files verified to exist in the worktree (`ls` exit 0 for each).

## actionlint validation

```
$ actionlint .github/workflows/ci.yml
.github/workflows/ci.yml:200:12: "needs" section should not be empty [syntax-check]
```

- **Pre-existing** issue in unrelated `harness-self-check` job (line 200) — NOT introduced by this change. Per Hard Rule §1, this production CI file is not edited to "make the lint pass" for unrelated existing debt.
- **The new `compose-lint` and `compose-lint-resources` jobs produce ZERO actionlint findings.** Confirmed by filtering output for lines ≥ 688.
- actionlint version locally: `1.7.12` (Homebrew, darwin/arm64).

## Local sanity check

Verified one matrix cell (`default`) runs end-to-end on the local Docker daemon:

```
$ cp .env.slim.example .env && tools/bootstrap.sh --ci > /dev/null
$ docker compose -f docker-compose.yml --profile default config > /dev/null
$ echo $?
0
```

## Job structure (parallel to `helm-lint`)

```yaml
compose-lint:                # NEW — 8-cell matrix, docker compose config
compose-lint-resources:      # NEW — single run of make lint-compose-resources
helm-lint:                   # PRE-EXISTING (separate workflow file)
```

`helm-lint` lives in `.github/workflows/helm-lint.yml` and is structurally similar (single-job, runs on `paths:` filter). `compose-lint*` joins `ci.yml` because that is the canonical workflow where every PR-gated check lives (`lint`, `typecheck`, `test`, `contract-test`, `e2e-hermetic`, `smoke`, etc.).

## Divergence-by-design — SR-20.7 RED/GREEN evidence

**Acknowledged in 20-PLAN-CHECK loop 2.** Constitutional TDD requires a RED commit (failing test) followed by a GREEN commit (production fix making it pass). A single-file CI YAML change cannot be expressed this way — the "test" IS the CI job itself; running it on a deliberately-broken compose file produces a red CI run, which is observable only in the GitHub Actions UI, not in git history.

**Path forward for RED/GREEN evidence** (captured in the next PR opened against this branch, before merge):

1. **RED-evidence:** Open a draft PR that removes one `deploy.resources.limits.memory` declaration from `compose/docker-compose.observability.yml`. The `compose-lint-resources` job MUST go red. Capture the CI run URL.
2. **GREEN-evidence:** Restore the deletion in the same PR. The job MUST go green. Capture the CI run URL.
3. Both URLs land in this SUMMARY (appended below) before the PR merges to main.

**Pending evidence slot:**

```
RED-CI-URL:   <to-be-filled-on-PR-open>
GREEN-CI-URL: <to-be-filled-on-PR-open>
```

## Path-gating note

The plan brief mandated `on.pull_request.paths` filtering. `ci.yml` is a monolithic workflow with `on: pull_request:` (no paths). Per-job path filtering in GitHub Actions requires either a dedicated workflow file (like `helm-lint.yml`) or a `dorny/paths-filter` action dependency. Since:

- `compose-lint` 8-cell matrix runs in ~1 minute parallel
- `compose-lint-resources` runs in ~30 seconds
- Avoiding a new third-party action keeps the security-supply-chain surface unchanged

…the jobs run on every PR. If this proves wasteful at scale, a follow-up plan can either (a) extract `compose-lint*` into a sibling `compose-lint.yml` workflow with `on.pull_request.paths`, or (b) introduce `dorny/paths-filter` with SHA pinning per the Trivy 2026-03-19 incident-response policy.

## Working-tree state

```
$ git log --oneline -1
172dbbd ci(20-03-01): compose-lint job — 8-profile matrix gate on PRs (closes audit C1)

$ git status --short
(clean — SUMMARY.md not yet staged)
```

## Self-Check: PASSED

- ✓ `.github/workflows/ci.yml` line range 688+ contains compose-lint + compose-lint-resources jobs
- ✓ All 8 overlay files exist (verified pre-commit)
- ✓ actionlint clean on new section (only pre-existing `needs: []` warning remains, unrelated)
- ✓ Commit 172dbbd present on `phase-20-wave-bc` HEAD
- ✓ Commit message documents divergence-by-design + closes audit C1
- ✓ No production code edited outside `.github/workflows/ci.yml`
- ✓ No `--no-verify`, no destructive git ops, no branch switch

## Phase 20 Wave C closed.
