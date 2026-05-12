#!/bin/sh
# fd-probe.sh — refuse to start if soft fd limit < 65535 (D-TUNE-2).
#
# DUPLICATED at compose/traefik/fd-probe.sh — kept BYTE-IDENTICAL.
# Update both copies in the same commit. The
# compose/traefik/fd-probe.test.sh harness enforces this via `diff -q`.
# Symlinking is not viable because Docker build contexts are per service.
#
# Phase 08 / Plan 04. Coordinated with the `ulimits:` block on the api +
# traefik services in docker-compose.yml (added in plan 05 / Wave 1).
# Without this probe, a future PR that drops the `ulimits:` block would
# silently regress the container back to the host default (often 1024 on
# Linux distros, 256 on macOS without overrides) — under sustained 1000-
# concurrent-user load that yields EMFILE storms and 5xx cliffs. The probe
# makes the regression loud at boot.
#
# Contract:
#   - exit 1 with a descriptive stderr message if `ulimit -n` < 65535
#   - exec-chain into "$@" otherwise (so this slots transparently into an
#     ENTRYPOINT array as the first element)
ulimit_n=$(ulimit -n)
if [ "$ulimit_n" -lt 65535 ]; then
  echo "[fd-probe] soft fd limit $ulimit_n < 65535 — refusing to start (D-TUNE-2)" >&2
  exit 1
fi
exec "$@"
