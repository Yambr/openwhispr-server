# Phase 6 / Plan 02 — custom Postgres 17 image with pg_partman 5.x.
#
# Why this exists:
#   The flat `audit_log` table (Phase 1) is being converted to a monthly
#   RANGE-partitioned parent managed by pg_partman 5.2.4+ (CONTEXT D-A2).
#   Upstream `postgres:17-alpine` does NOT ship pg_partman; we build it
#   from source against the matching pg_config. Alpine has no apk for
#   pg_partman (community/edge none as of 2026-05).
#
# Build matrix:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#       -t openwhispr/postgres:17 ./compose/postgres
#
# NO_BGW=1 — skip pg_partman's background-worker. We run maintenance
# via a BullMQ recurring job (`partman-maintenance`) per D-A4 instead,
# avoiding the need to load partman into `shared_preload_libraries`.
#
# Patch tag (image pin discipline — Phase 01.1 D-02): we pin postgres
# at 17.5 (matches docker-compose.yml) so a fresh build is reproducible.

FROM postgres:17.5-alpine
LABEL org.opencontainers.image.source="https://github.com/Yambr/openwhispr-server" \
      org.opencontainers.image.licenses="FSL-1.1-ALv2"

ARG PG_PARTMAN_VERSION=5.2.4

# Build deps for pg_partman; removed in the same RUN to keep the layer
# small. clang15/llvm15 produce the JIT bytecode the postgres:17-alpine
# image's pg_config expects (matches the upstream Alpine build flags).
RUN apk add --no-cache --virtual .build-deps \
        build-base \
        clang15 \
        llvm15 \
        git \
    && git clone --depth 1 \
        --branch v${PG_PARTMAN_VERSION} \
        https://github.com/pgpartman/pg_partman.git /tmp/pg_partman \
    && cd /tmp/pg_partman \
    && make NO_BGW=1 \
    && make NO_BGW=1 install \
    && rm -rf /tmp/pg_partman \
    && apk del .build-deps

# The init scripts in /docker-entrypoint-initdb.d only run on a freshly
# initialized data volume. The existing Phase 1 role-bootstrap scripts
# mount at the same target via docker-compose; this Dockerfile does NOT
# copy them in — keeps responsibilities split.
