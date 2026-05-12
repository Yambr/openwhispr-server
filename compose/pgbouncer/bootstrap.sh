#!/bin/sh
# Phase 08.1 / Plan 01 / Task 4 — pgbouncer bootstrap wrapper.
#
# Why this exists.
#   The edoburu/pgbouncer image's own entrypoint generates userlist.txt
#   from DB_USER / DB_PASSWORD env vars at container start so the proxy
#   role (`openwhispr_app`) can authenticate via SCRAM-SHA-256. BUT the
#   admin user used by `psql -U pgbouncer_admin -c 'SHOW POOLS'` is NEVER
#   written to userlist.txt by that entrypoint — only the proxy user is.
#   Plan 07's live run had to fall back to scraping pgbouncer's container
#   `LOG stats:` lines because every `SHOW POOLS` query returned SASL
#   auth failure. Plan 08-07 Anomaly #3.
#
# What this script does.
#   1. Honours $AUTH_FILE if set, otherwise defaults to /etc/pgbouncer/userlist.txt
#   2. If $PGBOUNCER_ADMIN_PASSWORD is set and the admin user is not
#      already in the file, appends one line:
#        "pgbouncer_admin" "<PGBOUNCER_ADMIN_PASSWORD>"
#      Per edoburu's entrypoint conventions and pgbouncer 1.21+ behaviour,
#      writing the plaintext password is the canonical way to opt into
#      pgbouncer-handles-SCRAM mode (pgbouncer hashes per connection).
#   3. Hands off to the original entrypoint (`/entrypoint.sh "$@"`).
#
# Why plaintext is OK here.
#   - The file lives only inside the pgbouncer container (no host mount
#     in load-test profiles — the compose definition mounts only
#     pgbouncer.ini, not userlist.txt).
#   - The pgbouncer_admin role is local to the pgbouncer admin virtual
#     database — it does NOT grant any backend Postgres privileges. The
#     worst case if leaked is `SHOW POOLS` access.
#   - The proxy role (openwhispr_app) is also stored plaintext by the
#     upstream entrypoint — this script reuses the same convention.
#
# Idempotency.
#   The grep-then-append pattern makes the script safe to run multiple
#   times against the same userlist.txt; the admin line is appended only
#   when not already present.

set -eu

AUTH_FILE="${AUTH_FILE:-/etc/pgbouncer/userlist.txt}"

# The upstream entrypoint touches the file when missing. Mirror that so
# our append never has to deal with a non-existent target.
if [ ! -e "$AUTH_FILE" ]; then
  touch "$AUTH_FILE"
fi

if [ -n "${PGBOUNCER_ADMIN_PASSWORD:-}" ]; then
  if ! grep -q '^"pgbouncer_admin"' "$AUTH_FILE"; then
    echo "\"pgbouncer_admin\" \"${PGBOUNCER_ADMIN_PASSWORD}\"" >> "$AUTH_FILE"
    echo "bootstrap: wrote pgbouncer_admin credentials to $AUTH_FILE"
  else
    echo "bootstrap: pgbouncer_admin already present in $AUTH_FILE — skipping"
  fi
else
  echo "bootstrap: PGBOUNCER_ADMIN_PASSWORD unset — SHOW POOLS auth will FAIL" >&2
fi

# Hand off to edoburu's own entrypoint with the original args (e.g.
# `pgbouncer /etc/pgbouncer/pgbouncer.ini`). Its first step is the same
# generate_userlist_if_needed pattern for the proxy user, which is a
# no-op once we've appended our admin line (the proxy-user grep is
# separate so the two appends do not collide).
exec /entrypoint.sh "$@"
