#!/bin/bash
# compose/postgres/initdb/01-litellm-database.sh
#
# Phase 03 / Plan 01 / Task 2 — fresh-install path for the separate
# `litellm` Postgres database. Mounted via the postgres service into
# /docker-entrypoint-initdb.d/litellm and invoked once on first volume
# init by the official postgres image entrypoint.
#
# Idempotency: the SELECT-NOT-EXISTS / \gexec pattern is a no-op when
# `litellm` already exists, so re-running the entrypoint on a partially
# initialized cluster does NOT error.
#
# Existing-volume upgrade path (HIGH-1, Phase 03 Plan 01): initdb
# scripts only run on a freshly-initialized data volume; operators
# upgrading from Phase 2 already have a populated volume so this script
# is skipped on `up`. The migrate runner (packages/data/src/migrate.ts)
# carries an `ensureLitellmDatabase()` step that covers that path
# without `make clean-stack`.

set -e

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname postgres <<-EOSQL
  SELECT 'CREATE DATABASE litellm OWNER ' || quote_ident('${POSTGRES_OWNER_USER}')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'litellm')\gexec
EOSQL

echo "01-litellm-database.sh: ensured litellm database (owner=${POSTGRES_OWNER_USER})"
