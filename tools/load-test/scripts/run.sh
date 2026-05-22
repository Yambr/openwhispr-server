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
# Phase 08.5-02 Task 4: under PROFILE=realistic, layer the third compose
# overlay (08.5-01) so the real LiteLLM container wins over the mock.
# Mock profile path is unchanged otherwise.
#
# Phase 61 / AUDIT load-test fix: `docker-compose.load-test.yml` declares
# partial overlay fragments for grafana/loki/tempo/mimir/otel-collector
# (volume mounts + resource limits) that expect the FULL service
# definitions — but Phase 14's slim-core split moved those services out
# of the base `docker-compose.yml` into `compose/docker-compose.observability.yml`.
# `run.sh` was never reconciled, so the merged project errored with
# `service "grafana" has neither an image nor a build context`. The
# observability overlay must be layered BEFORE the load-test overlay so
# the partial fragments merge onto a complete base.
# Observability overlay (grafana/loki/tempo/mimir/otel-collector) — see the
# comment above. Storage overlay (minio + S3_* defaults) — Phase 14's BYOK
# guard refuses to boot the api when `S3_ENDPOINT` is unset AND the storage
# overlay is not enabled; the load-test stack must layer it so the api
# starts. Both overlays are slim-core extractions the load-test predates.
COMPOSE_OBS="-f compose/docker-compose.observability.yml"
COMPOSE_STORAGE="-f compose/docker-compose.storage.yml"
if [ "$PROFILE" = "realistic" ]; then
  COMPOSE_BASE="docker compose -f docker-compose.yml ${COMPOSE_OBS} ${COMPOSE_STORAGE} -f compose/docker-compose.load-test.yml -f compose/docker-compose.load-test.realistic.yml --profile $COMPOSE_PROFILE"
else
  COMPOSE_BASE="docker compose -f docker-compose.yml ${COMPOSE_OBS} ${COMPOSE_STORAGE} -f compose/docker-compose.load-test.yml --profile $COMPOSE_PROFILE"
fi
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
# Phase 08.5-02 Task 4: export LOADTEST_PROFILE=realistic so pre-warm
# auto-enters --strict mode (08.5-01 Task 4 contract). Iter-0 cold-start
# pollution becomes a fail-fast surface instead of a smoke gate p95 mystery.
if [ "$PROFILE" = "realistic" ]; then
  LOADTEST_PROFILE=realistic sh tools/load-test/scripts/pre-warm-speaches.sh
fi

# 5. Build the k6 bundle.
# Use `pnpm run` from inside the workspace dir (not --filter) to avoid
# a pnpm 11 issue where filtered scripts running compound commands
# (`tsup && cp`) return to the caller before the trailing command flushes
# under stdin-redirected child shells (run.sh's case). Direct invocation
# from the package dir is synchronous and predictable.
(cd tools/load-test && pnpm run build)

# 5a. Plan 08.1-followup — smoke gate. Runs a 30-second low-VU sanity
#     check before the 30-minute plateau so host-object mutation,
#     module-resolution breakage, or schema regressions abort within
#     seconds instead of after a 5-minute ramp-up. Set SMOKE_SKIP=1 to
#     bypass when iterating on the harness itself.
if [ "${SMOKE_SKIP:-0}" = "1" ]; then
  echo "run.sh: SMOKE_SKIP=1 — bypassing k6 smoke gate" >&2
else
  # Phase 08.5-02 Task 4: ROADMAP success criterion 2 — under the
  # realistic profile run the smoke gate at 5 VU × 60s (default 30s is
  # too short for real Whisper-large-v3 even when pre-warmed). Operator
  # override preserved when SMOKE_DURATION is explicitly set.
  if [ "$PROFILE" = "realistic" ]; then
    SMOKE_DURATION="${SMOKE_DURATION:-60s}" sh tools/load-test/scripts/k6-smoke.sh
  else
    sh tools/load-test/scripts/k6-smoke.sh
  fi
fi

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
