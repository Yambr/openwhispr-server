# RESEARCH — Publish openwhispr/postgres:17.5-pgpartman to GHCR

Date: 2026-05-24
Branch: worktree-agent-ab3c2fc80f37384e1

## Problem

CI `test` job fails because integration tests spin testcontainers from
`openwhispr/postgres:17.5-pgpartman`, but that image is local-built only
(no registry hosts it). Docker daemon resolves the bare name against
Docker Hub and fails:

```
Error: (HTTP code 404) unexpected - pull access denied for openwhispr/postgres,
repository does not exist or may require 'docker login'
```

Source: `gh run view 26345389476 --log-failed` (test job).

## Inventory of the two Dockerfiles

### `compose/postgres/Dockerfile` (Alpine)
- Base: `postgres:17.5-alpine`
- pg_partman 5.2.4 built **from source** with `NO_BGW=1`
- No `shared_preload_libraries` requirement (BGW disabled — partition
  maintenance runs via BullMQ recurring job per Phase 6 D-A4)
- Size: ~150-200 MB compressed
- Consumed by: `docker-compose.yml`, `compose/docker-compose.embedded-litellm.yml`,
  ~22 test files via `PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")`

### `images/cnpg-postgres-17-pgpartman/Dockerfile` (Debian)
- Base: `ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie`
- pg_partman from `apt install postgresql-17-partman` (Debian Trixie
  ships 5.1.0 as of 2026-05)
- Has `pg_partman_bgw.so` for `shared_preload_libraries`
- Size: ~400-500 MB compressed
- Consumed by: Helm chart's CNPG Cluster spec only
- Already published: `ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman:17.6-<tag>`
  via `.github/workflows/release.yml` matrix entry (line 38-43).

## All 22 references to `openwhispr/postgres:17.5-pgpartman`

Sources (grep), file:line:

| File | Line | Context |
|---|---|---|
| docker-compose.yml | 50 | `image:` (runtime) |
| compose/docker-compose.embedded-litellm.yml | 61 | `image:` (overlay) |
| tools/lint-rls.test.ts | 50 | `new PostgreSqlContainer(...)` |
| tests/self-tests/rls-introspection.test.ts | 32 | testcontainer |
| tests/e2e/rls-fail-closed.test.ts | 54 | testcontainer |
| packages/data/migrations/__tests__/0014-audit-log-partition.test.ts | 22 | `PARTMAN_IMAGE` |
| packages/data/tests/unit/__tests__/pgbouncer-interleave.test.ts | 91 | testcontainer |
| packages/data/tests/unit/__tests__/audit-log-partitioning.test.ts | 21 | `PARTMAN_IMAGE` |
| packages/data/tests/unit/__tests__/settings-rls.test.ts | 65 | testcontainer |
| packages/data/tests/unit/__tests__/migration-0006-backfill.test.ts | 47 | testcontainer |
| packages/data/tests/unit/__tests__/rls-property.test.ts | 85 | testcontainer |
| packages/data/tests/unit/__tests__/audit-log-actions.test.ts | 20 | `PARTMAN_IMAGE` |
| packages/data/tests/unit/__tests__/worker-rls-property.test.ts | 97 | testcontainer |
| packages/data/src/__tests__/helpers.ts | 73 + 179 | default `image` + `POSTGRES_PARTMAN_IMAGE` constant |
| apps/api/tests/unit/__tests__/better-auth-encryption.integration.test.ts | 113 | testcontainer |
| apps/api/tests/unit/lib/audit.test.ts | 49 | `PARTMAN_IMAGE` |
| apps/api/tests/integration/r31-realtime-ga-shape.test.ts | 78 | testcontainer |
| apps/api/tests/support/shared-pg.ts | 47 | `SHARED_POSTGRES_IMAGE` constant |
| apps/api/tests/integration/r22-verify-email-session.test.ts | 110 | testcontainer |
| apps/api/tests/integration/auth-04-token-rotation-overlap.test.ts | 88 | testcontainer |
| apps/api/tests/integration/better-auth-envelope-at-rest.test.ts | 57 | testcontainer |
| apps/api/tests/integration/r21-verification-status-email-path.test.ts | 150 | testcontainer |
| apps/api/tests/integration/r20-bearer-session-resolution.test.ts | 57 | testcontainer |
| apps/api/src/routes/v1/keys/__tests__/setup.ts | 54 | `PARTMAN_IMAGE` |
| apps/api/src/routes/__tests__/setup.ts | 62 | `PARTMAN_IMAGE` |
| apps/worker/tests/unit/jobs/partman-maintenance.test.ts | 29 | `PARTMAN_IMAGE` |
| docs/operations.md | 61, 71, 73 | operator runbook |

Doc-only mentions (comments / planning archives) are NOT swapped — they
describe the historical pattern.

`.github/workflows/ci.yml` lines 283, 289, 382, 388 build a local
`openwhispr/postgres:ci` tag in the `lint-rls` + `test-migration` jobs.
Those jobs are independent of registry availability and stay as-is
(they're already self-contained; pulling from GHCR there would slow
the job, not speed it up — they own the image lifecycle).

## GHCR publish pattern (existing reference)

`.github/workflows/release.yml` matrix lines 32-119 already publishes
the CNPG variant. The shape:

- `name: <slug>` → image `ghcr.io/<owner>/openwhispr-<slug>:<tag>`
- `pg_minor: "17.6"` produces convenience tag `:17.6-<tag>`
- Multi-arch buildx (linux/amd64,linux/arm64)
- Triggered by `workflow_dispatch` (manual) or `push: tags: v*`

## Decision matrix: unify vs publish two

| Axis | Unify (drop Alpine, use Debian everywhere) | Keep two, publish both |
|---|---|---|
| pg_partman version | Downgrade compose 5.2.4 → 5.1.0 (Debian Trixie apt) — risk migration 0014 semantic drift | No change — both ship the version they were authored against |
| Image size per testcontainer pull | +300 MB × 22 testcontainers per CI run | No change |
| Maintenance | One Dockerfile | Two — but they already exist and work |
| BGW config | Debian image preloads `pg_partman_bgw`; compose stack does NOT preload — silent override needed | No change |
| Repo namespace | `ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman` used everywhere | New entry: `ghcr.io/yambr/openwhispr-postgres-17-pgpartman` |
| Cost | Re-test all 22 testcontainer call sites against 5.1.0 | One CI matrix line + 22 reference swaps |

**Decision: KEEP TWO. Publish both.** See CONTEXT.md.

## Failing tests confirmation

`gh run view 26345389476` test job log shows:

```
postgres Warning pull access denied for openwhispr/postgres,
  repository does not exist or may require 'docker login'
Error: (HTTP code 404) unexpected - pull access denied for openwhispr/postgres,
  repository does not exist or may require 'docker login'
```

Followed by failed integration test suites:
- compose-overlays.test.ts (7 failed)
- traefik-network-alias.test.ts (8 failed)
- contract-test-runner-compose.test.ts (3 failed)
- oidc-env-wiring.test.ts (4 failed)
- observability-stack-up.test.ts (5 failed)
- and the `apps/api/tests/integration/*` cohort that uses `PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")`

A subset of failures (compose-overlays, traefik-network-alias) are
shape failures unrelated to the postgres image; those are separate
issues. The testcontainer-based failures unblock once GHCR pull works.
