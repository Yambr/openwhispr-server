# Phase 08.1 / Plan 01 / Task 4 — pgbouncer image wrapper.
#
# Why we extend edoburu/pgbouncer instead of using it directly:
#   The upstream image's own entrypoint writes the proxy role
#   (openwhispr_app) to userlist.txt at start but never writes the
#   admin role (pgbouncer_admin). Without the admin SCRAM hash present
#   `psql -U pgbouncer_admin pgbouncer -c 'SHOW POOLS'` fails SASL auth.
#   This wrapper adds a bootstrap.sh that appends the admin user before
#   handing off to the upstream entrypoint. See bootstrap.sh for full
#   rationale.
#
# Pinned to v1.25.1-p0 (same version the load-test compose used pre-08.1)
# so we don't accidentally bump pgbouncer or its security posture as a
# side effect of this bugfix.

FROM edoburu/pgbouncer:v1.25.1-p0

COPY bootstrap.sh /usr/local/bin/bootstrap.sh

# Image inherits the upstream USER + working dir + healthcheck. We only
# override the entrypoint.
ENTRYPOINT ["/usr/local/bin/bootstrap.sh"]
# Preserve the upstream image's default command — our bootstrap exec's
# /entrypoint.sh "$@", which then exec's $@ (the pgbouncer binary).
CMD ["/usr/bin/pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
