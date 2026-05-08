#!/usr/bin/env bash
# scripts/backup/make-backup.sh — pg_dump | age envelope encryption.
#
# Produces ${OUT_DIR}/<UTC-timestamp>.dump.age, encrypted to the X25519
# recipient at keys/backup.age.pub. Two operating modes:
#
#   * test/CI mode (DATABASE_URL_OWNER set in env):
#       runs pg_dump directly against the URL. Used by the integration
#       test (testcontainers) and by the GHA nightly backup-roundtrip
#       job (Postgres service container reachable on localhost:5432).
#
#   * local-dev mode (no DATABASE_URL_OWNER):
#       runs `docker compose exec -T postgres pg_dump ...` so the dump
#       comes out of the same Postgres major as the running server
#       (RESEARCH-TOOLING Pitfall 4 — pg_dump major must match server).
#
# Usage:
#   bash scripts/backup/make-backup.sh [<output-dir>]
#
# Required tools: age in PATH, pg_dump (test mode) or docker (compose
# mode), bash >= 4.
#
# Exit codes:
#   0 — backup written
#   1 — runtime failure (pg_dump or age non-zero)
#   2 — preflight error (missing pubkey, missing tool)

set -euo pipefail

OUT_DIR="${1:-${PWD}/backups}"
PUBKEY_FILE="${PWD}/keys/backup.age.pub"

if [[ ! -f "${PUBKEY_FILE}" ]]; then
  echo "make-backup: missing ${PUBKEY_FILE} — run tools/bootstrap.sh first to generate the X25519 keypair, or commit the operator's public recipient" >&2
  exit 2
fi
if ! command -v age >/dev/null 2>&1; then
  echo "make-backup: age not found in PATH — install via 'apt install age' (debian/ubuntu), 'brew install age' (macOS), or 'scoop install age' (windows)" >&2
  exit 2
fi

mkdir -p "${OUT_DIR}"
TS="$(date -u +%Y-%m-%dT%H-%M-%S)"
OUT="${OUT_DIR}/${TS}.dump.age"
PUB="$(tr -d '[:space:]' < "${PUBKEY_FILE}")"

if [[ -z "${PUB}" ]]; then
  echo "make-backup: ${PUBKEY_FILE} is empty" >&2
  exit 2
fi

if [[ -n "${DATABASE_URL_OWNER:-}" ]]; then
  # Test/CI mode — direct pg_dump against the connection URI.
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "make-backup: pg_dump not found in PATH (test mode requires Postgres client tools)" >&2
    exit 2
  fi
  pg_dump -Fc "${DATABASE_URL_OWNER}" | age -r "${PUB}" > "${OUT}"
else
  # Local-dev mode — run pg_dump inside the postgres container so the
  # client major matches the server major (RESEARCH-TOOLING Pitfall 4).
  if ! command -v docker >/dev/null 2>&1; then
    echo "make-backup: docker not found in PATH (compose mode); set DATABASE_URL_OWNER for direct pg_dump instead" >&2
    exit 2
  fi
  docker compose exec -T postgres pg_dump -Fc \
    -U "${POSTGRES_OWNER_USER:-openwhispr_owner}" \
    "${POSTGRES_DB:-openwhispr}" \
    | age -r "${PUB}" > "${OUT}"
fi

echo "make-backup: wrote ${OUT}"
