#!/bin/sh
# Phase 08.5-02 / Task 3 — Mac realistic baseline runner.
#
# Companion to tools/load-test/scripts/run.sh. Drives the 100 VU × 12 min
# baseline scenario (5m + 5m + 2m) defined by src/baseline.ts against the
# realistic profile stack (real LiteLLM + Speaches + Whisper-large-v3).
#
# Usage:
#   tools/load-test/scripts/baseline.sh                # mac baseline
#   tools/load-test/scripts/baseline.sh --dry-run      # print argv, exit 0
#
# Operator H100 re-run path (08.5-RESEARCH §Baseline run shape):
#   BASELINE_VUS=1000 BASELINE_DURATION_SUSTAIN=20m \
#     tools/load-test/scripts/baseline.sh
#   # Outputs land under runs/<stamp>-realistic-mac.json regardless of
#   # platform — the operator renames after the fact for clarity.
#
# Env:
#   OPENWHISPR_LOADTEST_REUSE_STACK=1 — assume the load-test-realistic
#     stack is already running (e.g. via `make load-test PROFILE=realistic`)
#     and skip preflight + compose up + smoke gate. Tears down on exit
#     unless OPENWHISPR_LOADTEST_KEEP_STACK=1 is also set.
#   OPENWHISPR_LOADTEST_KEEP_STACK=1 — never tear the stack down. Mirrors
#     run.sh semantics.

set -eu

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<USAGE
Usage: $0 [--dry-run]

Runs the 100 VU × 12 min Mac realistic baseline against the
load-test-realistic compose profile. Outputs land under
.planning/phases/08.5-realistic-profile-boot-and-baseline/runs/.

Operator H100 re-run: set BASELINE_VUS and BASELINE_DURATION_SUSTAIN
in the environment, leave OPENWHISPR_LOADTEST_REUSE_STACK unset.
USAGE
      exit 0
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# Three-file overlay so the real LiteLLM container wins (08.5-01 Task 2).
COMPOSE_BASE="docker compose \
  -f docker-compose.yml \
  -f compose/docker-compose.load-test.yml \
  -f compose/docker-compose.load-test.realistic.yml \
  --profile load-test-realistic"

RUN_DIR=".planning/phases/08.5-realistic-profile-boot-and-baseline/runs"
mkdir -p "$RUN_DIR"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
JSON_OUT="$RUN_DIR/${STAMP}-realistic-mac.json"
SUMMARY_OUT="$RUN_DIR/${STAMP}-realistic-mac-summary.json"

BUNDLE="tools/load-test/dist/baseline.js"

# Dry-run: print the k6 argv and exit. The test harness in
# tools/load-test/scripts/baseline.test.sh asserts this output.
if [ "$DRY_RUN" -eq 1 ]; then
  printf 'baseline.sh DRY-RUN — k6 argv:\n'
  printf '  k6 run --out json=%s --summary-export %s %s\n' \
    "$JSON_OUT" "$SUMMARY_OUT" "$BUNDLE"
  printf 'baseline.sh DRY-RUN — compose layering:\n'
  printf '  %s\n' "$COMPOSE_BASE"
  exit 0
fi

# Trap mirrors run.sh: KEEP_STACK forensics escape hatch wins, otherwise
# the stack is torn down on every exit (even k6 non-zero).
if [ "${OPENWHISPR_LOADTEST_KEEP_STACK:-0}" = "1" ]; then
  trap 'printf "OPENWHISPR_LOADTEST_KEEP_STACK=1 — stack left running for forensic capture. Tear down with: %s down\n" "$COMPOSE_BASE" >&2' EXIT INT TERM
elif [ "${OPENWHISPR_LOADTEST_REUSE_STACK:-0}" = "1" ]; then
  # Reuse mode: assume the operator brought the stack up via run.sh and
  # will tear it down themselves. Do not touch the stack on exit.
  :
else
  trap '$COMPOSE_BASE down >/dev/null 2>&1 || true' EXIT INT TERM
fi

if [ "${OPENWHISPR_LOADTEST_REUSE_STACK:-0}" = "1" ]; then
  printf 'baseline.sh: reuse-stack mode — assuming load-test-realistic is already healthy\n' >&2
else
  # Mirror run.sh's lifecycle: preflight, build, up, pre-warm, smoke.
  sh tools/load-test/scripts/preflight.sh --yes
  $COMPOSE_BASE build
  $COMPOSE_BASE up -d --wait
  # Phase 08.5-01 Task 4 — pre-warm auto-enters strict mode when
  # LOADTEST_PROFILE=realistic is exported.
  LOADTEST_PROFILE=realistic sh tools/load-test/scripts/pre-warm-speaches.sh
  (cd tools/load-test && pnpm run build)
  # ROADMAP success criterion 2: smoke at 5 VU × 60 s.
  SMOKE_DURATION="${SMOKE_DURATION:-60s}" sh tools/load-test/scripts/k6-smoke.sh
fi

if [ ! -f "$BUNDLE" ]; then
  printf 'baseline.sh: bundle missing %s — run `pnpm --filter @openwhispr/load-test build` first\n' \
    "$BUNDLE" >&2
  exit 2
fi

export K6_INSECURE_SKIP_TLS_VERIFY=true

set +e
k6 run \
  --out "json=$JSON_OUT" \
  --summary-export "$SUMMARY_OUT" \
  "$BUNDLE"
K6_EXIT=$?
set -e

echo "Results: $JSON_OUT"
echo "Summary: $SUMMARY_OUT"
# advisory thresholds (abortOnFail:false) — propagate exit code for
# visibility but the run is informational.
exit "$K6_EXIT"
