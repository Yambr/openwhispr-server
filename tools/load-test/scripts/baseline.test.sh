#!/bin/sh
# Phase 08.5-02 / Task 1 — RED tests for baseline.sh runner.
#
# baseline.sh is a Wave-2 Task-3 deliverable. Until it lands these tests
# fail. Expectations:
#   * --dry-run prints a k6 argv that contains dist/baseline.js (NOT
#     dist/main.js — operator H100 re-run is supposed to use this same
#     bundle, only env values change).
#   * The output JSON path ends with `-realistic-mac.json`.
#   * The output dir is rooted at
#     .planning/phases/08.5-realistic-profile-boot-and-baseline/runs.

set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/tools/load-test/scripts/baseline.sh"

PASS=0
FAIL=0

_pass() { PASS=$((PASS + 1)); printf '  ok %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK %s\n' "$1" >&2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "baseline.sh tests"

# Test 1: file exists and is executable.
if [ -x "$SCRIPT" ]; then
  _pass "baseline.sh exists and is executable"
else
  _fail "baseline.sh missing or not executable: $SCRIPT"
  echo "baseline.sh: ${PASS} pass / ${FAIL} fail"
  [ "$FAIL" -eq 0 ]
  exit
fi

# Test 2: --dry-run exits 0 and prints the k6 argv.
set +e
DRY_OUT=$("$SCRIPT" --dry-run 2>&1)
DRY_RC=$?
set -e
if [ "$DRY_RC" -eq 0 ]; then
  _pass "--dry-run exits 0"
else
  _fail "--dry-run exited $DRY_RC, output: $DRY_OUT"
fi

# Test 3: dry-run argv includes dist/baseline.js.
if printf '%s' "$DRY_OUT" | grep -F "dist/baseline.js" >/dev/null 2>&1; then
  _pass "dry-run argv invokes dist/baseline.js"
else
  _fail "dry-run argv missing dist/baseline.js (got: $DRY_OUT)"
fi

# Test 4: dry-run argv does NOT invoke dist/main.js (would be a mis-wire).
if ! printf '%s' "$DRY_OUT" | grep -F "dist/main.js" >/dev/null 2>&1; then
  _pass "dry-run argv does NOT invoke dist/main.js"
else
  _fail "dry-run argv accidentally invokes dist/main.js"
fi

# Test 5: output JSON path ends with -realistic-mac.json.
if printf '%s' "$DRY_OUT" | grep -E -- '-realistic-mac\.json' >/dev/null 2>&1; then
  _pass "dry-run argv targets -realistic-mac.json output"
else
  _fail "dry-run argv does not target -realistic-mac.json (got: $DRY_OUT)"
fi

# Test 6: output dir under the 08.5 phase runs/ directory.
if printf '%s' "$DRY_OUT" | grep -F ".planning/phases/08.5-realistic-profile-boot-and-baseline/runs" >/dev/null 2>&1; then
  _pass "dry-run argv writes under 08.5/runs/"
else
  _fail "dry-run argv missing 08.5/runs/ path"
fi

echo "baseline.sh: ${PASS} pass / ${FAIL} fail"
[ "$FAIL" -eq 0 ]
