#!/usr/bin/env bash
# Phase 08 / Plan 04 — Task 1: apps/api fd-probe unit tests (RED -> GREEN).
#
# Contract (D-TUNE-2):
#   exit 0 with exec-chain — soft fd ulimit >= 65535
#   exit 1 with descriptive stderr — soft fd ulimit  < 65535
#
# Host caveat: on macOS, the shell's `ulimit -n N` for N > current parent
# soft limit may fail. We work around this by:
#   * Always running tests 2/3 at exactly 65535 (the threshold) — at-or-below
#     the typical 256/1024/unlimited host default so the simulation succeeds.
#   * Skipping tests 1 (1024 case) and 4 (70000 case) gracefully on hosts
#     where `ulimit -n N` cannot be set. The plan-02 harness + Docker smoke
#     cover the low/high boundary in real containers.
#
# Tests:
#   T1: ulimit 1024 -> exit 1, stderr contains "1024" and "65535"
#   T2: ulimit 65535 -> exit 0 via exec true
#   T3: ulimit 65535 -> exit 1 via exec false (exit code propagates)
#   T4: ulimit 70000 -> exit 0 via exec true
#   T5: script is executable
#   T6: Dockerfile contains "/app/scripts/fd-probe.sh" in ENTRYPOINT integration
#   T7: probe appears BEFORE check-default-secrets in the ENTRYPOINT chain
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
PROBE="${HERE}/fd-probe.sh"
DOCKERFILE="${REPO_ROOT}/apps/api/Dockerfile"

PASS=0
FAIL=0
SKIP=0

_pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1" >&2; }
_skip() { SKIP=$((SKIP + 1)); printf '  skip %s — %s\n' "$1" "$2"; }

# Helper: try to set a soft ulimit -n in a subshell and run the probe.
# Returns: <rc>|<stderr_capture>. If the ulimit itself cannot be set,
# emits the marker "ULIMIT_UNSETTABLE".
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

echo "apps/api fd-probe tests"

# Sanity: probe must exist as a regular file for tests 1-4 to mean anything.
if [[ ! -f "$PROBE" ]]; then
  echo "  (probe file not yet created — RED expected)"
fi

# T1: low ulimit -> exit 1, stderr mentions 1024 and 65535.
result="$(_try_ulimit_run 1024 true)"
rc="${result%%|*}"
err="${result#*|}"
if [[ "$err" == *"ULIMIT_UNSETTABLE"* ]]; then
  _skip "T1 ulimit 1024 -> exit 1 + stderr" "host cannot lower ulimit"
elif [[ "$rc" -eq 1 && "$err" == *"1024"* && "$err" == *"65535"* ]]; then
  _pass "T1 ulimit 1024 -> exit 1 with descriptive stderr"
else
  _fail "T1 ulimit 1024 -> expected exit=1 stderr~/1024.*65535/, got rc=$rc stderr=[$err]"
fi

# T2: threshold ulimit -> exit 0 (exec true).
result="$(_try_ulimit_run 65535 true)"
rc="${result%%|*}"
err="${result#*|}"
if [[ "$err" == *"ULIMIT_UNSETTABLE"* ]]; then
  _skip "T2 ulimit 65535 -> exit 0 via exec true" "host cannot set ulimit 65535"
elif [[ "$rc" -eq 0 ]]; then
  _pass "T2 ulimit 65535 -> exec true -> exit 0"
else
  _fail "T2 ulimit 65535 -> expected exit=0, got rc=$rc stderr=[$err]"
fi

# T3: threshold ulimit + failing exec target -> exit code propagates.
result="$(_try_ulimit_run 65535 false)"
rc="${result%%|*}"
err="${result#*|}"
if [[ "$err" == *"ULIMIT_UNSETTABLE"* ]]; then
  _skip "T3 ulimit 65535 -> exec false propagates" "host cannot set ulimit 65535"
elif [[ "$rc" -eq 1 ]]; then
  _pass "T3 ulimit 65535 -> exec false -> exit 1 (propagated)"
else
  _fail "T3 ulimit 65535 -> expected exit=1 from exec false, got rc=$rc"
fi

# T4: high ulimit -> exit 0.
result="$(_try_ulimit_run 70000 true)"
rc="${result%%|*}"
err="${result#*|}"
if [[ "$err" == *"ULIMIT_UNSETTABLE"* ]]; then
  _skip "T4 ulimit 70000 -> exit 0" "host cannot set ulimit 70000"
elif [[ "$rc" -eq 0 ]]; then
  _pass "T4 ulimit 70000 -> exit 0"
else
  _fail "T4 ulimit 70000 -> expected exit=0, got rc=$rc stderr=[$err]"
fi

# T5: probe must be executable.
if [[ -x "$PROBE" ]]; then
  _pass "T5 probe is executable"
else
  _fail "T5 probe is not executable (or missing): $PROBE"
fi

# T6: Dockerfile must reference the probe path.
if [[ -f "$DOCKERFILE" ]] && grep -F '"/app/scripts/fd-probe.sh"' "$DOCKERFILE" >/dev/null; then
  _pass "T6 Dockerfile ENTRYPOINT references /app/scripts/fd-probe.sh"
else
  _fail "T6 Dockerfile does not reference /app/scripts/fd-probe.sh"
fi

# T7: probe must appear BEFORE check-default-secrets in the same ENTRYPOINT line
# (or BEFORE in the chained entrypoint.sh script). The plan allows either:
#   (a) ENTRYPOINT array prepends fd-probe.sh before any reference to
#       check-default-secrets in the same line, OR
#   (b) ENTRYPOINT array prepends fd-probe.sh before /app/entrypoint.sh,
#       and entrypoint.sh internally runs check-default-secrets.
# We accept either by checking the Dockerfile ENTRYPOINT line itself: the
# fd-probe.sh token must come before any check-default-secrets token, OR
# fd-probe.sh must precede /app/entrypoint.sh (which is the secrets gate).
if [[ -f "$DOCKERFILE" ]]; then
  entrypoint_line="$(grep -E '^ENTRYPOINT' "$DOCKERFILE" | head -1)"
  if [[ -z "$entrypoint_line" ]]; then
    _fail "T7 No ENTRYPOINT line found in Dockerfile"
  else
    probe_pos=$(echo "$entrypoint_line" | awk '{ for(i=1;i<=NF;i++) if ($i ~ /fd-probe\.sh/) { print i; exit } }')
    # accept either check-default-secrets directly or /app/entrypoint.sh as the gate
    gate_pos=$(echo "$entrypoint_line" | awk '{
      for(i=1;i<=NF;i++) if ($i ~ /check-default-secrets|entrypoint\.sh/) { print i; exit }
    }')
    if [[ -n "$probe_pos" && -n "$gate_pos" && "$probe_pos" -lt "$gate_pos" ]]; then
      _pass "T7 fd-probe.sh appears before secrets gate in ENTRYPOINT (probe@$probe_pos, gate@$gate_pos)"
    else
      _fail "T7 fd-probe.sh must precede secrets gate in ENTRYPOINT (probe_pos=$probe_pos, gate_pos=$gate_pos, line=$entrypoint_line)"
    fi
  fi
else
  _fail "T7 Dockerfile not found at $DOCKERFILE"
fi

echo "apps/api fd-probe: ${PASS} pass / ${FAIL} fail / ${SKIP} skip"
[[ $FAIL -eq 0 ]]
