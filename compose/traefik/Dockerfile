# Phase 08 / Plan 05 — thin Traefik wrapper that bakes the fd-probe.sh
# entrypoint shim into the image so the load-test profile can refuse to
# start whenever the soft fd limit is < 65535 (D-TUNE-2 regression guard).
#
# The image is referenced only under docker-compose.load-test.yml; the
# default profile keeps pulling stock `traefik:v3.6` directly. The
# upstream Traefik entrypoint is `/entrypoint.sh` (Alpine-based image),
# so we wedge fd-probe.sh in front of it via compose-level entrypoint
# override AND bake the script at a known absolute path here.
#
# Build:
#   docker build -t openwhispr-traefik-loadtest:dev compose/traefik/
#
# This Dockerfile is intentionally minimal:
#   * pinned to the same Traefik version as docker-compose.yml (v3.6) so
#     the load-test image and the default-profile image stay byte-identical
#     in behaviour barring the fd-probe wedge.
#   * COPYs fd-probe.sh out of THIS build context (compose/traefik/), kept
#     BYTE-IDENTICAL to apps/api/scripts/fd-probe.sh (plan 08-04 contract;
#     the compose/traefik/fd-probe.test.sh harness enforces `diff -q`).
#   * marks the script 0755 in the same COPY instruction to keep the
#     image one layer thinner.
FROM traefik:v3.6

COPY --chmod=0755 fd-probe.sh /usr/local/bin/fd-probe.sh
