#!/bin/sh
# packages/data/migrations/init/00-roles.sh
#
# Postgres official image runs every executable in
# /docker-entrypoint-initdb.d/ once on first volume init. We need to
# substitute env-var passwords into the SQL template before psql sees
# it (the Postgres entrypoint does NOT expand ${VAR} inside .sql files
# generically — only the bootstrap superuser env vars are expanded by
# its docker-entrypoint.sh).
#
# `set -eu` aborts on any psql error so a CREATE ROLE failure causes
# the whole container to fail-fast (operator sees the misconfiguration
# in `docker compose logs postgres`).
set -eu

TEMPLATE_DIR="$(dirname "$0")"
TEMPLATE_FILE="${TEMPLATE_DIR}/00-roles.sql.tpl"

if [ ! -f "${TEMPLATE_FILE}" ]; then
	echo "00-roles.sh: template not found at ${TEMPLATE_FILE}" >&2
	exit 1
fi

# envsubst is part of gettext (present in postgres:17-alpine via the
# `gettext-base`-equivalent? No — alpine ships `envsubst` as part of
# `gettext-tiny` or absent). We use a portable sed-only fallback so
# the script works on any official Postgres image variant.
ROLES_SQL="$(
	sed \
		-e "s|\${POSTGRES_OWNER_PASSWORD}|${POSTGRES_OWNER_PASSWORD}|g" \
		-e "s|\${POSTGRES_APP_PASSWORD}|${POSTGRES_APP_PASSWORD}|g" \
		"${TEMPLATE_FILE}"
)"

echo "00-roles.sh: creating openwhispr_owner + openwhispr_app roles" >&2
printf '%s\n' "${ROLES_SQL}" | psql \
	--variable ON_ERROR_STOP=1 \
	--username "${POSTGRES_USER}" \
	--dbname "${POSTGRES_DB}"
