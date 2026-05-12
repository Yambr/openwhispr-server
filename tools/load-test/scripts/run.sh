#!/bin/sh
# Phase 08 / Plan 06 — Task 5: end-to-end load-test orchestrator.
#
# Usage:
#   tools/load-test/scripts/run.sh mock        # mock-litellm profile (default)
#   tools/load-test/scripts/run.sh realistic   # speaches + whisper profile
#
# Sequence:
#   1. Validate the profile argument.
#   2. Run preflight.sh (docker resources, ports, git tree).
#   3. docker compose build + up --wait for the selected profile.
#   4. If realistic: pre-warm Speaches so cold-start is invisible.
#   5. Build the k6 bundle (tsup -> dist/main.js).
#   6. k6 run with prometheus-rw output + JSON summary; capture under
#      .planning/phases/08-load-test-tuning-slo-publication/runs/.
#   7. Tear the stack down (via trap, so failures still tear down).
#
# Live execution lands in plan 07 — this script is the harness only.

set -eu

PROFILE="${1:-mock}"
case "$PROFILE" in
  mock)
    COMPOSE_PROFILE=load-test-mock
    ;;
  realistic)
    COMPOSE_PROFILE=load-test-realistic
    ;;
  *)
    echo "usage: $0 mock|realistic" >&2
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# Tear-down trap — runs regardless of how the script exits so a failed
# k6 run does not leak a 1000-VU stack onto the developer Mac.
#
# Plan 08.1-01 / Task 1: when OPENWHISPR_LOADTEST_KEEP_STACK=1 is set, the
# trap is a no-op. This is the forensic-capture escape hatch — if k6 exits
# non-zero (threshold failure, error spike, etc.) the stack survives so
# the operator can `docker compose logs api > runs/forensics/api-logs.txt`
# before tearing it down by hand. LOAD-TEST-ONLY env var; documented in
# .env.example. Never set in production / CI.
COMPOSE_BASE="docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile $COMPOSE_PROFILE"
if [ "${OPENWHISPR_LOADTEST_KEEP_STACK:-0}" = "1" ]; then
  trap 'printf "OPENWHISPR_LOADTEST_KEEP_STACK=1 — stack left running for forensic capture. Tear down with: %s down\n" "$COMPOSE_BASE" >&2' EXIT INT TERM
else
  trap '$COMPOSE_BASE down >/dev/null 2>&1 || true' EXIT INT TERM
fi

# 1. Preflight (docker resources, ports, git tree).
sh tools/load-test/scripts/preflight.sh --yes

# 2. Build images (mock-litellm and any other profile-scoped builds).
$COMPOSE_BASE build

# 3. Bring the stack up and block until healthy.
$COMPOSE_BASE up -d --wait

# 4. Realistic profile only — pre-warm Speaches (RESEARCH.md §Pitfall 10).
if [ "$PROFILE" = "realistic" ]; then
  sh tools/load-test/scripts/pre-warm-speaches.sh
fi

# 5. Build the k6 bundle.
# Use `pnpm run` from inside the workspace dir (not --filter) to avoid
# a pnpm 11 issue where filtered scripts running compound commands
# (`tsup && cp`) return to the caller before the trailing command flushes
# under stdin-redirected child shells (run.sh's case). Direct invocation
# from the package dir is synchronous and predictable.
(cd tools/load-test && pnpm run build)

# 6. Capture run outputs under the phase runs/ directory.
RUN_DIR=.planning/phases/08-load-test-tuning-slo-publication/runs
mkdir -p "$RUN_DIR"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
JSON_OUT="$RUN_DIR/${STAMP}-${PROFILE}.json"
SUMMARY_OUT="$RUN_DIR/${STAMP}-${PROFILE}-summary.json"

export K6_PROMETHEUS_RW_SERVER_URL=http://127.0.0.1:9009/api/v1/push
export K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM=true
export K6_INSECURE_SKIP_TLS_VERIFY=true
# Tenant header for Mimir's single-tenant mode (matches
# compose/grafana/provisioning/datasources/mimir.yaml).
export K6_PROMETHEUS_RW_HTTP_HEADERS="X-Scope-OrgID:openwhispr"

k6 run \
  --out experimental-prometheus-rw \
  --out "json=$JSON_OUT" \
  --summary-export "$SUMMARY_OUT" \
  tools/load-test/dist/main.js
K6_EXIT=$?

echo "Results: $JSON_OUT"
echo "Summary: $SUMMARY_OUT"
exit "$K6_EXIT"
