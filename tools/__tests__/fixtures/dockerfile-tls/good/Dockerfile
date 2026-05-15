# SPDX-License-Identifier: FSL-1.1-ALv2
# Good fixture for lint-dockerfile-tls — mirrors compose/traefik/Dockerfile
# shape with NO forbidden dev-CA artefacts. Used by the unit test to
# assert zero violations on the clean baseline.
FROM traefik:v3.6
COPY --chmod=0755 fd-probe.sh /usr/local/bin/fd-probe.sh
HEALTHCHECK --interval=10s --timeout=2s CMD wget -q -O- http://localhost:8080/ping || exit 1
