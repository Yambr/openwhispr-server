#!/usr/bin/env bash
# Phase 08 / Plan 02 — Task 3 GREEN: compose-profile validator.
#
# Wraps `docker compose --profile <name> config --quiet` for the two
# load-test profiles that Wave 1 (plan 05) adds to docker-compose.yml:
#   * load-test-mock        — wires mock-litellm + Speaches stub
#   * load-test-realistic   — wires real LiteLLM + Speaches CPU image
#
# Usage:
#   tools/load-test/scripts/verify-compose.sh <load-test-mock|load-test-realistic>
#
# Exit codes:
#   0   — compose config validates cleanly
#   1   — bad arg (missing or unknown profile)
#   *   — propagated from `docker compose config`
set -euo pipefail

PROFILE="${1:-}"
if [[ -z "$PROFILE" ]]; then
  echo "usage: $0 <load-test-mock|load-test-realistic>" >&2
  exit 1
fi

case "$PROFILE" in
  load-test-mock|load-test-realistic)
    ;;
  *)
    echo "unknown profile: $PROFILE" >&2
    echo "  expected one of: load-test-mock, load-test-realistic" >&2
    exit 1
    ;;
esac

exec docker compose --profile "$PROFILE" config --quiet
