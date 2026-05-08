#!/usr/bin/env bash
# smoke.sh — bring the data plane up and assert the Phase 0 placeholder API
# is reachable through the Traefik ingress at https://api.localhost.
#
# Note on api.localhost resolution: RFC 6761 reserves the .localhost TLD and
# all DNS resolvers SHOULD return loopback. macOS and most Linux glibc
# resolvers honor this; some corporate resolvers do not. Operators on such
# resolvers must add `127.0.0.1 api.localhost grafana.localhost
# minio-console.localhost` to /etc/hosts.
#
# Exit: 0 success, 1 assertion failed, 2 dependency error.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "smoke: docker CLI not found" >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "smoke: curl not found" >&2
  exit 2
fi

echo "smoke: bringing stack up via make up"
make up

echo "smoke: waiting for healthchecks (60s)"
bash "${HERE}/wait-healthy.sh" 60

echo "smoke: probing https://api.localhost/api/health through Traefik"
if ! curl -fkS --max-time 10 https://api.localhost/api/health >/dev/null; then
  echo "smoke: api.localhost health probe failed" >&2
  exit 1
fi

echo "smoke: PASS"
exit 0
