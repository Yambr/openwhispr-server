#!/bin/sh
# OpenWhispr API container entrypoint — Phase 2 Plan 02.
#
# 1. Run the defense-in-depth deny-list check. The Phase 1 bootstrap.sh
#    (Layer 1) already refuses to write a .env containing deny-listed
#    values; this is Layer 2 — the container itself refuses to start if
#    a bad secret slipped past bootstrap (closes Phase 1 D-08 / SC#1).
# 2. `exec "$@"` REPLACES the shell with the CMD process so Node becomes
#    PID 1 and receives SIGTERM directly from `docker stop`. Without
#    `exec`, signals are swallowed by /bin/sh and the container only
#    stops after the 10s grace period — measurable as a self-test.
set -e
node /app/dist/scripts/check-default-secrets.cjs
exec "$@"
