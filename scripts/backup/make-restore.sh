#!/usr/bin/env bash
# scripts/backup/make-restore.sh — age decrypt | pg_restore.
#
# REFUSES to run if the target Postgres has any non-system tables in
# the public schema (D-25 — "Idempotent: errors clearly if target
# already has data"). To restore on top of an existing database, drop
# and recreate it first.
#
# Two operating modes mirror make-backup.sh:
#
#   * test/CI mode (DATABASE_URL_OWNER set):
#       psql + pg_restore go directly against the URL.
#
#   * local-dev mode (no DATABASE_URL_OWNER):
#       docker compose exec into the postgres container for psql and
#       pg_restore so the client major matches the server major.
#
# Usage:
#   BACKUP=path/to/file.dump.age bash scripts/backup/make-restore.sh
#
# Optional env:
#   BACKUP_AGE_IDENTITY_FILE — path to AGE-SECRET-KEY-1... identity
#     (default: ${HOME}/.age/key.txt)
#
# Exit codes:
#   0 — restored
#   1 — refused (target non-empty) or runtime failure (age or pg_restore)
#   2 — preflight error (missing tool, missing identity, BACKUP unset)

set -euo pipefail

BACKUP="${BACKUP:-}"
IDENTITY_FILE="${BACKUP_AGE_IDENTITY_FILE:-${HOME}/.age/key.txt}"

if [[ -z "${BACKUP}" ]]; then
  echo "make-restore: set BACKUP=path/to/file.dump.age" >&2
  exit 1
fi
if [[ ! -f "${BACKUP}" ]]; then
  echo "make-restore: BACKUP not found: ${BACKUP}" >&2
  exit 1
fi
if [[ ! -f "${IDENTITY_FILE}" ]]; then
  echo "make-restore: identity file not found: ${IDENTITY_FILE} (set BACKUP_AGE_IDENTITY_FILE to override)" >&2
  exit 2
fi
if ! command -v age >/dev/null 2>&1; then
  echo "make-restore: age not found in PATH — install via apt/brew/scoop" >&2
  exit 2
fi

if [[ -n "${DATABASE_URL_OWNER:-}" ]]; then
  if ! command -v psql >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
    echo "make-restore: psql/pg_restore not found in PATH (test mode requires Postgres client tools)" >&2
    exit 2
  fi
  COUNT="$(psql "${DATABASE_URL_OWNER}" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')"
  if [[ "${COUNT}" != "0" ]]; then
    echo "make-restore: refusing — target has ${COUNT} tables in public schema (drop database first to restore)" >&2
    exit 1
  fi
  age -d -i "${IDENTITY_FILE}" "${BACKUP}" | pg_restore -d "${DATABASE_URL_OWNER}"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "make-restore: docker not found in PATH (compose mode); set DATABASE_URL_OWNER for direct restore instead" >&2
    exit 2
  fi
  COUNT="$(docker compose exec -T postgres psql \
    -U "${POSTGRES_OWNER_USER:-openwhispr_owner}" \
    -d "${POSTGRES_DB:-openwhispr}" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | tr -d '[:space:]')"
  if [[ "${COUNT}" != "0" ]]; then
    echo "make-restore: refusing — target has ${COUNT} tables in public schema (drop database first to restore)" >&2
    exit 1
  fi
  age -d -i "${IDENTITY_FILE}" "${BACKUP}" \
    | docker compose exec -T postgres pg_restore \
        -U "${POSTGRES_OWNER_USER:-openwhispr_owner}" \
        -d "${POSTGRES_DB:-openwhispr}"
fi

echo "make-restore: ok"
