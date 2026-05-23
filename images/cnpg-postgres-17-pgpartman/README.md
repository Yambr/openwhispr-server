# cnpg-postgres-17-pgpartman

Custom CloudNativePG-compatible Postgres 17 image with the `pg_partman` extension
pre-installed. Used by `charts/openwhispr/templates/postgres-cluster.yaml`
(`values.postgres.imageName`) to satisfy migration 0014 (audit_log monthly RANGE
partitioning, D-A2) without compiling pg_partman from source at runtime.

## Why this image exists

The upstream CNPG image catalog ships Postgres 18 as its default (T-09-02),
and even the PG 17 `system-trixie` variant does NOT include pg_partman.
Migration 0014 requires:

- `pg_partman_bgw` in `shared_preload_libraries` (pitfall #14 of `09-RESEARCH.md`)
- `CREATE EXTENSION pg_partman SCHEMA partman;` at cluster bootstrap

We base on `ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie` (Debian Trixie
roots) and `apt-get install -y --no-install-recommends postgresql-17-partman`.
That Debian package ships the `.so` linked against PG 17, no source build needed.

## Pre-flight check

Before bumping the base image tag, re-verify that Trixie still packages the
extension for the target PG major:

```bash
docker run --rm debian:trixie sh -c 'apt-get update -qq && apt-cache search postgresql-17-partman'
# Expected: "postgresql-17-partman - PostgreSQL Partition Manager"
```

If that returns empty, STOP. Do NOT pivot to source compilation silently —
re-open Plan 09-04 and decide between (a) waiting for the package to return,
(b) pinning to an older base, or (c) accepting a from-source build cost. Per
CLAUDE.md "no workarounds": this is a real architectural decision, not a
runtime fallback.

## Local build

Single-arch smoke build (whatever your dev host is):

```bash
docker build -t openwhispr-cnpg-postgres-17-pgpartman:local images/cnpg-postgres-17-pgpartman
docker run --rm --entrypoint /bin/sh openwhispr-cnpg-postgres-17-pgpartman:local \
  -c 'ls /usr/lib/postgresql/17/lib/ | grep pg_partman_bgw.so'
```

Multi-arch publish happens via `.github/workflows/release.yml`'s buildx job
on every `git tag v*` push. Both `linux/amd64` and `linux/arm64` land in the
manifest list at `ghcr.io/Yambr/openwhispr-cnpg-postgres-17-pgpartman`.

## Tag scheme

The release workflow publishes two tags per release:

- `<chart.appVersion>` — e.g. `0.9.0-rc1`
- `17.<pg-minor>-<chart.appVersion>` — e.g. `17.6-0.9.0-rc1`

The second variant guarantees the chart's `values.postgres.imageName` always
matches the `^.+:17\.[0-9]+.*$` regex in `charts/openwhispr/values.schema.json`
(T-09-02 mitigation: refuse to install on a non-17 image).
