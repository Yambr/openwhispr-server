#!/usr/bin/env bash
# Phase 08 / Plan 04 — Task 2: compose/traefik fd-probe unit tests (RED -> GREEN).
#
# The traefik probe MUST be byte-identical to apps/api/scripts/fd-probe.sh —
# we duplicate (vs. symlink) because Docker build contexts are per-service
# and a symlink would not survive `COPY`. The byte-identity test (T4) is
# the drift detector: any future edit to one copy fails this test until
# both are updated in lockstep.
#
# Tests:
#   T1: ulimit 1024 -> exit 1 with stderr containing "65535"
#   T2: ulimit 65535 -> exit 0 via exec true
#   T3: script is executable
#   T4: byte-identical to apps/api/scripts/fd-probe.sh (single source of truth)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
PROBE="${HERE}/fd-probe.sh"
API_PROBE="${REPO_ROOT}/apps/api/scripts/fd-probe.sh"

PASS=0
FAIL=0
SKIP=0

_pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1" >&2; }
_skip() { SKIP=$((SKIP + 1)); printf '  skip %s — %s\n' "$1" "$2"; }

_try_ulimit_run() {
  local target="$1"; shift
  local stderr_file
  stderr_file="$(mktemp)"
  set +e
  (
    ulimit -n "$target" 2>/dev/null || { echo "ULIMIT_UNSETTABLE"; exit 99; }
    "$PROBE" "$@" 2>"$stderr_file"
  )
  local rc=$?
  set -e
  local stderr_content
  stderr_content="$(cat "$stderr_file")"
  rm -f "$stderr_file"
  printf '%s|%s' "$rc" "$stderr_content"
}

echo "compose/traefik fd-probe tests"

# T1: low ulimit -> exit 1 stderr~65535
result="$(_try_ulimit_run 1024 /entrypoint.sh traefik)"
rc="${result%%|*}"
err="${result#*|}"
if [[ "$err" == *"ULIMIT_UNSETTABLE"* ]]; then
  _skip "T1 low ulimit -> exit 1" "host cannot lower ulimit"
elif [[ "$rc" -eq 1 && "$err" == *"65535"* ]]; then
  _pass "T1 low ulimit -> exit 1 with stderr mentioning 65535"
else
  _fail "T1 expected exit=1 stderr~/65535/, got rc=$rc stderr=[$err]"
fi

# T2: threshold ulimit -> exit 0 via exec true
result="$(_try_ulimit_run 65535 true)"
rc="${result%%|*}"
err="${result#*|}"
if [[ "$err" == *"ULIMIT_UNSETTABLE"* ]]; then
  _skip "T2 threshold -> exit 0" "host cannot set ulimit 65535"
elif [[ "$rc" -eq 0 ]]; then
  _pass "T2 ulimit 65535 -> exec true -> exit 0"
else
  _fail "T2 expected exit=0, got rc=$rc stderr=[$err]"
fi

# T3: executable
if [[ -x "$PROBE" ]]; then
  _pass "T3 probe is executable"
else
  _fail "T3 probe is not executable (or missing): $PROBE"
fi

# T4: byte-identical to api copy (drift detector)
if [[ ! -f "$PROBE" ]]; then
  _fail "T4 traefik probe missing — cannot compare to api copy"
elif [[ ! -f "$API_PROBE" ]]; then
  _fail "T4 api probe missing at $API_PROBE — cannot compare"
elif diff -q "$API_PROBE" "$PROBE" >/dev/null; then
  _pass "T4 traefik probe is byte-identical to apps/api/scripts/fd-probe.sh"
else
  _fail "T4 traefik probe drifted from apps/api/scripts/fd-probe.sh — update both in lockstep"
fi

echo "compose/traefik fd-probe: ${PASS} pass / ${FAIL} fail / ${SKIP} skip"
[[ $FAIL -eq 0 ]]
