#!/usr/bin/env bash
# wait-healthy.sh — block until every Compose service reports Health=healthy.
#
# Usage: wait-healthy.sh [timeout-seconds]   (default 60)
# Exit: 0 success, 1 timeout/unhealthy, 2 dependency error.
set -euo pipefail

TIMEOUT="${1:-60}"

if ! command -v docker >/dev/null 2>&1; then
  echo "wait-healthy: docker CLI not found" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "wait-healthy: jq not found" >&2
  exit 2
fi

deadline=$(( $(date +%s) + TIMEOUT ))

while :; do
  # docker compose ps --format json emits one JSON object per line in v2.
  # Aggregate to an array via jq -s, then assert all .Health == "healthy".
  status_json=$(docker compose ps --format json 2>/dev/null || true)
  if [ -n "$status_json" ]; then
    if printf '%s\n' "$status_json" \
      | jq -se 'length > 0 and all(.[]; .Health == "healthy")' >/dev/null 2>&1; then
      echo "wait-healthy: all services healthy"
      exit 0
    fi
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "wait-healthy: timeout after ${TIMEOUT}s; current state:" >&2
    docker compose ps >&2 || true
    exit 1
  fi

  sleep 2
done
