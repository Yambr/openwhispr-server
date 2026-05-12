#!/bin/sh
# Phase 08 / Plan 06 — Task 5: smoke test for run.sh.
#
# Asserts that the orchestrator script exists, is executable, parses
# the PROFILE argument, rejects unknown profiles, and contains the
# k6 wiring the load run depends on. The live execution is plan 07's
# job — this test stays under 1 second so it can run in CI.

set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/tools/load-test/scripts/run.sh"
PREWARM="$ROOT/tools/load-test/scripts/pre-warm-speaches.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# 1. Files exist and are executable.
test -x "$SCRIPT" || fail "run.sh missing or not executable"
test -x "$PREWARM" || fail "pre-warm-speaches.sh missing or not executable"

# 2. Unknown profile is rejected with a usage hint (no docker compose invocation).
if "$SCRIPT" totally-unknown-profile >/tmp/run-test.out 2>&1; then
  fail "run.sh accepted an unknown profile (should have exited non-zero)"
fi
grep -q "usage" /tmp/run-test.out || fail "run.sh did not print a usage hint on bad input"

# 3. k6 prometheus remote-write env wiring is present.
grep -F "K6_PROMETHEUS_RW_SERVER_URL" "$SCRIPT" >/dev/null \
  || fail "run.sh missing K6_PROMETHEUS_RW_SERVER_URL wiring"
grep -F "experimental-prometheus-rw" "$SCRIPT" >/dev/null \
  || fail "run.sh missing --out experimental-prometheus-rw flag"

# 4. Run output captured into the canonical phase runs/ directory.
grep -F ".planning/phases/08-load-test-tuning-slo-publication/runs" "$SCRIPT" >/dev/null \
  || fail "run.sh missing canonical runs/ path"

# 5. Preflight is invoked before docker compose up (ordering matters —
#    preflight.sh refuses to run if the harness is misconfigured).
preflight_line=$(grep -n "preflight.sh" "$SCRIPT" | head -1 | cut -d: -f1)
up_line=$(grep -n "compose .*up" "$SCRIPT" | head -1 | cut -d: -f1)
[ -n "$preflight_line" ] || fail "run.sh does not call preflight.sh"
[ -n "$up_line" ] || fail "run.sh does not call docker compose up"
[ "$preflight_line" -lt "$up_line" ] \
  || fail "preflight.sh must run before docker compose up"

# 6. Teardown runs unconditionally — exit-code preserved through trap.
grep -F "trap" "$SCRIPT" >/dev/null \
  || fail "run.sh missing trap-based teardown (exit code preservation)"

# 7. pre-warm script targets the speaches container.
grep -F "speaches" "$PREWARM" >/dev/null \
  || fail "pre-warm-speaches.sh does not reference the speaches container"

echo "PASS: run.sh + pre-warm-speaches.sh smoke checks (7/7)"
