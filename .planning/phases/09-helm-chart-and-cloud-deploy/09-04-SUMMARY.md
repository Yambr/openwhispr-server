---
phase: 09
plan: 04
subsystem: helm-chart
tags: [cnpg, postgres, pg_partman, multi-arch, ghcr, deploy-02]
status: complete
completed: 2026-05-13
duration_minutes: 25
tasks_completed: 2
commits:
  - c7caa54: custom cnpg-postgres-17-pgpartman image + multi-arch release workflow
  - b2ffe53: cnpg cluster cr template + barman backup secret + helm-unittest suite
---

# Phase 9 Plan 4: CNPG Cluster + Custom PG 17 + pg_partman Image Summary

`images/cnpg-postgres-17-pgpartman/Dockerfile` builds a CloudNativePG-compatible Postgres 17.6 image with `postgresql-17-partman` (pg_partman 5.4.3) installed from Debian Trixie's PGDG repos. `.github/workflows/release.yml` publishes amd64+arm64 to GHCR on tagged releases with two tags per release (`<appVersion>` + `<pg-minor>-<appVersion>`). `charts/openwhispr/templates/postgres-cluster.yaml` renders a CNPG Cluster CR pinned via `imageName` to the `:17.*` regex (T-09-02 mitigation), with `shared_preload_libraries: pg_partman_bgw` (pitfall #14), `postInitApplicationSQL: CREATE EXTENSION pg_partman SCHEMA partman`, replicas/storage from values, and an optional `barmanObjectStore` block consuming AWS-style credentials from `postgres-backup-secret.yaml`. 8 helm-unittest assertions cover all positive + negative paths.

## What landed

- `images/cnpg-postgres-17-pgpartman/Dockerfile` — `FROM ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie`; `apt-get install -y --no-install-recommends postgresql-17-partman`; build-time fail-fast `ls /usr/lib/postgresql/17/lib/pg_partman_bgw.so`; restores `USER 26`. Per CLAUDE.md "no-workarounds" rule: no source compilation fallback — if the apt package disappears upstream the build stops loud rather than papering over.
- `images/cnpg-postgres-17-pgpartman/README.md` — pre-flight check command (`docker run --rm debian:trixie sh -c 'apt-get update -qq && apt-cache search postgresql-17-partman'`), local build/test commands, multi-arch publish flow, tag scheme rationale (the `<pg-minor>-<appVersion>` form is what keeps `values.postgres.imageName` matching `^.+:17\.[0-9]+.*$` schema regex).
- `.github/workflows/release.yml` — replaces the placeholder workflow. Matrix-built (`fail-fast: false`) buildx job pushes `linux/amd64,linux/arm64` to `ghcr.io/<org>/openwhispr-cnpg-postgres-17-pgpartman:<tag>` on `tags: ['v*']` push and on `workflow_dispatch`. Tag stripping `v*` prefix so chart appVersion alignment is one transform. Provenance + SBOM + GHA cache wired.
- `charts/openwhispr/templates/postgres-cluster.yaml` — full Cluster CR (postgresql.cnpg.io/v1). `instances`, `imageName`, `storage.size/storageClass`, `bootstrap.initdb.{database,owner,secret,postInitApplicationSQL}`, `postgresql.parameters` (max_connections, shared_buffers, `shared_preload_libraries: pg_partman_bgw`), `pg_hba` scram-sha-256, `primaryUpdateStrategy: unsupervised`, `monitoring.enablePodMonitor` toggle.
- `charts/openwhispr/templates/postgres-backup-secret.yaml` — `Opaque` Secret with `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` + `helm.sh/resource-policy: keep`. Renders only when `backup.enabled=true` AND `secrets.mode=helm-values`. Fails render with explicit message when fields empty.
- `charts/openwhispr/values.yaml` — adds `postgres.backup.accessKeyId` / `secretAccessKey` (used only in helm-values mode).
- `charts/openwhispr/tests/postgres_cluster_test.yaml` — 8 assertions: positive Cluster render (image regex, instances, partman extension, bootstrap secret), backup-omitted-when-disabled, backup-rendered-with-correct-paths, bucket-required-failure, secret-omitted-in-eso, secret-rendered-in-helm-values, secret-skip-when-disabled, accessKeyId-required-failure.

## Verification

- Local Docker build (`docker build images/cnpg-postgres-17-pgpartman`) — pulls cnpg base image, apt-installs `postgresql-17-partman 5.4.3-1.pgdg13+1`, verifies `pg_partman_bgw.so` present, returns size-stable image. `postgres -V` reports 17.6.
- Apt availability pre-check: `apt-cache search postgresql-17-partman` against `debian:trixie` returns `postgresql-17-partman - PostgreSQL Partition Manager` (verdict: AVAILABLE, 2026-05-13).
- `helm unittest charts/openwhispr` — 21/21 PASS (was 13 before plan; this plan added 8).
- `helm lint charts/openwhispr --set-string secrets.*=...` — 0 ERROR.
- `helm template ow charts/openwhispr -f .github/ci/values-ci.yaml --set-string secrets.*=...` — renders `kind: Cluster` with `name: ow-openwhispr-pg`.
- `actionlint .github/workflows/release.yml` — 0 errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical] Plan was silent on `postgres-backup-secret.yaml` field validation; added explicit render-time fail.**

- **Found during:** Task 2 design.
- **Issue:** If `backup.enabled=true` in helm-values mode and the operator forgets `accessKeyId`, the Cluster CR would reference a Secret whose `stringData.ACCESS_KEY_ID` is empty — the CNPG operator would log auth failures rather than refuse to install. CLAUDE.md "no-workarounds" requires loud failure at install time.
- **Fix:** `{{- fail ... }}` gates with named field in the error message (matches the secrets.yaml pattern from 09-01).
- **Files:** `charts/openwhispr/templates/postgres-backup-secret.yaml`.

**2. [Rule 1 - Bug] release.yml placeholder needed full replacement, not extension.**

- **Found during:** Task 1.
- **Issue:** The plan said "extend the existing release.yml matrix", but the file was a placeholder with one trivial `echo` job. Extending would have produced incoherent YAML.
- **Fix:** Wrote a full release workflow (buildx + QEMU + GHCR login + multi-arch push + GHA cache + provenance + SBOM) using a matrix that's scoped to the one image this plan ships. Future plans (09-06/07/08/11) extend the matrix by appending entries — no restructuring needed.

### Auth gates

None.

### Architectural deferrals

- Image catalog Pattern B (`imageCatalogRef`) explicitly deferred per plan's own note: Pattern A (direct `imageName` pin) is the default; B is opt-in for fleet managers.
- Pitfall #15 (`helm --wait` doesn't wait on CRDs) deferred to Plan 09-08 (migrate Job pg_isready initContainer); a TODO marker lives in the cluster template's frontmatter comment.

## Self-Check: PASSED

Files created:
- FOUND: images/cnpg-postgres-17-pgpartman/Dockerfile
- FOUND: images/cnpg-postgres-17-pgpartman/README.md
- FOUND: charts/openwhispr/templates/postgres-cluster.yaml
- FOUND: charts/openwhispr/templates/postgres-backup-secret.yaml
- FOUND: charts/openwhispr/tests/postgres_cluster_test.yaml

Files modified:
- FOUND: .github/workflows/release.yml (placeholder -> real)
- FOUND: charts/openwhispr/values.yaml (backup.{accessKeyId,secretAccessKey})

Commits: FOUND c7caa54, b2ffe53.
