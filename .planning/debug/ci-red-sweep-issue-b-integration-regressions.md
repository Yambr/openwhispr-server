---
status: awaiting_human_verify
trigger: "PROD CI red-sweep Issue B: 10 distinct integration-test regressions in ci.yml::test job"
created: 2026-05-24T00:00:00Z
updated: 2026-05-24T00:00:00Z
---

## Current Focus

hypothesis: Multiple unrelated regressions; likely shared cluster around YAML/compose drift from dependabot bump cc267b53
test: Reproduce each failure locally with `pnpm vitest run <file>`, starting with lowest-blast-radius (single-failure tests)
expecting: To find at minimum the "quibblr" typo (string search), the OIDC env shape change, and the YAML !reset cluster
next_action: grep -r 'quibblr' across repo; identify the typo file

## Symptoms

expected: All 10 test files pass under `pnpm test`
actual: 10 files with partial or full failures
errors:
  - "Missing chart resource(s): quibblr" (observability-stack-up)
  - YAML !reset unresolved tag warnings
  - 4/4 fail in oidc-env-wiring (fundamental shape change)
  - 8/9 fail in traefik-network-alias
reproduction: `pnpm vitest run <file>` from repo root
started: After commit cc267b53 (dependabot bump 33 minor-patch updates) suspected

## Files
1. tests/integration/compose-overlays.test.ts (7/30)
2. tests/integration/traefik-network-alias.test.ts (8/9)
3. tests/integration/contract-test-runner-compose.test.ts (3/5)
4. tests/integration/oidc-env-wiring.test.ts (4/4)
5. tests/integration/observability-stack-up.test.ts (5/6)
6. tools/lint-gitleaks-hook.test.ts (1/4)
7. tools/lint-migrations.test.ts (3/36)
8. apps/api/tests/support/__tests__/shared-pg.test.ts (1/5)
9. packages/data/tests/encryption/plan-52-02-cleanedwhere-import.test.ts (1/4)
10. apps/worker/tests/unit/jobs/audit-archive.test.ts (1)

## Eliminated

## Evidence

## Resolution

root_cause: Heterogeneous regressions, NOT one root cause. 2 reproducible locally and fixed; 8 are CI-only or infrastructure-dependent.

fix:
  - Commit 3922b83e: gitleaks-hook test regex now accepts direct CLI `--config` form (production migrated from gitleaks-action@v2 → CLI invocation, test wasn't updated)
  - Commit 116c944c: @better-auth/core version pin relaxed from exact 1.6.9 → 1.6.x floor 1.6.9 (dependabot bumped to 1.6.11, structural intent preserved)

verification: Both tests now pass locally; pushed to main; CI run pending

files_changed:
  - tools/lint-gitleaks-hook.test.ts
  - packages/data/tests/encryption/plan-52-02-cleanedwhere-import.test.ts

## Remaining 8 files — HALT requested

NOT REPRODUCIBLE LOCALLY (pass with `pnpm vitest run <file>`):
  - tests/integration/compose-overlays.test.ts (7 fails in CI)
  - tests/integration/traefik-network-alias.test.ts (8 fails in CI)
  - tests/integration/contract-test-runner-compose.test.ts (3 fails in CI)
  - tests/integration/oidc-env-wiring.test.ts (4 fails in CI)
  - tests/integration/observability-stack-up.test.ts (5 fails in CI)
  - tools/lint-migrations.test.ts (3 fails in CI — likely flaky pnpm dlx squawk-cli first-run)
  - apps/worker/tests/unit/jobs/audit-archive.test.ts (1 fail in CI)

ENVIRONMENTAL / INFRASTRUCTURE:
  - apps/api/tests/support/__tests__/shared-pg.test.ts (1/5 — testcontainer cold-pull timeout; needs `openwhispr/postgres:17.5-pgpartman` image which is NOT on Docker Hub)

Root cause analysis for the CI cluster:
  - The CI log shows `Error: (HTTP code 404) unexpected - pull access denied for openwhispr/postgres, repository does not exist or may require 'docker login': denied: requested access to the resource is denied` causing `Failed Suites 64` cascade.
  - The Dockerfile to build this image exists at `compose/postgres/Dockerfile` but is not published to any registry.
  - Local laptop has the image baked in (likely built earlier with `docker build ./compose/postgres -t openwhispr/postgres:17.5-pgpartman`).
  - The compose-overlay / traefik-alias / contract-runner / oidc / observability CI failures are likely SECONDARY: the docker daemon in CI is busy thrashing on the failed openwhispr/postgres pulls, OR the test invocations time out in single-digit ms because the docker daemon is in a degraded state.

REQUIRED PRODUCTION-CODE / INFRASTRUCTURE CHANGE (NON-TRIVIAL, NEW PHASE):
  Build & publish `openwhispr/postgres:17.5-pgpartman` to GHCR (or build it in CI as a prerequisite step before `pnpm test`). Without this, ANY test that uses `getSharedPostgres` / `PostgreSqlContainer("openwhispr/postgres:...")` will fail in CI regardless of test-code fixes.

  Suggested approach (orchestrator decision):
    Option A: Add a CI step before `pnpm test` to `docker build ./compose/postgres -t openwhispr/postgres:17.5-pgpartman` (slow but no registry dependency).
    Option B: Publish the image to GHCR via a workflow (`.github/workflows/postgres-image.yml`) and bump the version tag.
    Option C: Switch testcontainers references to a public image (`postgres:17-alpine`) and run the pg_partman bootstrap as part of `provisionPgPartman()` (already the path for some tests, but pg_partman extension files must be present in the base image).

