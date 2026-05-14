# Custom CloudNativePG-compatible Postgres 17 image with pg_partman extension.
#
# Phase 09 Plan 04 (A4 decision): the upstream CNPG default image catalog ships
# Postgres 18 (T-09-02), and even the PG 17 system-trixie variant does NOT include
# pg_partman. Migration 0014 (audit_log monthly RANGE partitioning, D-A2) requires
# `pg_partman_bgw` to be in `shared_preload_libraries` and the `pg_partman` extension
# to be createable at bootstrap (pitfall #14 of 09-RESEARCH.md).
#
# Strategy (CLAUDE.md "no workarounds" rule): apt-install the packaged extension
# `postgresql-17-partman` from Debian Trixie's repos rather than compiling from
# source. Trixie ships the extension natively (verified 2026-05-13:
# `apt-cache search postgresql-17-partman` against `debian:trixie` returns
# "postgresql-17-partman - PostgreSQL Partition Manager").
#
# Multi-arch (amd64 + arm64) is published via the release workflow's buildx step.
# Tag scheme: `<chart.appVersion>` with optional `:17.<pg-minor>-<chart.appVersion>`
# convenience tag so `values.postgres.imageName` always matches the
# `^.+:17\.[0-9]+.*$` schema regex (T-09-02 mitigation in values.schema.json).
ARG BASE_IMAGE=ghcr.io/cloudnative-pg/postgresql:17.6-system-trixie
FROM ${BASE_IMAGE}

USER root

# postgresql-17-partman is the Debian-packaged build of the pg_partman extension
# linked against the in-image PG 17 server. We pin no version here; apt resolves
# the latest available for the base distro. Build-time fail-fast if the package
# disappears upstream (no silent fallback to source compilation).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-17-partman; \
    rm -rf /var/lib/apt/lists/*; \
    # Smoke-verify the shared library landed where Postgres expects it.
    ls /usr/lib/postgresql/17/lib/pg_partman_bgw.so

USER 26

LABEL org.opencontainers.image.source="https://github.com/openwhispr/openwhispr-server" \
      org.opencontainers.image.description="CloudNativePG-compatible Postgres 17 with pg_partman pre-installed" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"
