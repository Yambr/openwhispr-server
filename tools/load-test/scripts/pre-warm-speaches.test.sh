#!/bin/sh
# Phase 08.5-01 Task 1 — RED tests for pre-warm-speaches.sh --strict mode.
#
# Two scenarios:
#   1. --strict + container missing -> exit non-zero (was: exit 0 with warn).
#   2. --strict + warm transcribe failure -> exit non-zero (was: exit 0).
#
# Also asserts:
#   3. Default (no flag) behaviour preserved — container missing still
#      exits 0 with warning (back-compat with Phase 08 callers).
#   4. LOADTEST_PROFILE=realistic env auto-enters strict mode (no explicit
#      flag needed).

set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/tools/load-test/scripts/pre-warm-speaches.sh"

PASS=0
FAIL=0

_pass() { PASS=$((PASS + 1)); printf '  ok %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK %s\n' "$1" >&2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Stub docker so the script never touches a real daemon.
# - `docker compose ... ps -q speaches` -> empty (no container)
# - `docker cp` -> success no-op
# - `docker compose exec ...` -> drive via STUB_EXEC_RC
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'STUB'
#!/bin/sh
# Cheap arg-parser for the stubs we care about.
for a in "$@"; do
  case "$a" in
    ps) STUB_MODE=ps; break ;;
    cp) STUB_MODE=cp; break ;;
    exec) STUB_MODE=exec; break ;;
  esac
done
case "${STUB_MODE:-other}" in
  ps)
    # Print whatever the test pre-loaded as the container id (or empty).
    printf '%s' "${STUB_PS_OUT:-}"
    ;;
  cp)
    exit 0
    ;;
  exec)
    exit "${STUB_EXEC_RC:-0}"
    ;;
  *)
    exit 0
    ;;
esac
STUB
chmod +x "$TMP/bin/docker"

echo "pre-warm-speaches.sh tests"

# ---------------------------------------------------------------
# Test 1 (RED until Task 4): --strict + container missing -> exit 1.
# ---------------------------------------------------------------
set +e
STUB_PS_OUT="" PATH="$TMP/bin:$PATH" \
  "$SCRIPT" --strict >"$TMP/t1.out" 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  _pass "--strict + no container -> exit $rc"
else
  _fail "--strict + no container should exit non-zero, got $rc out=$(cat "$TMP/t1.out")"
fi

# ---------------------------------------------------------------
# Test 2 (RED until Task 4): --strict + transcribe warm failure -> exit 1.
# ---------------------------------------------------------------
set +e
STUB_PS_OUT="ctr-id-abc" STUB_EXEC_RC=22 PATH="$TMP/bin:$PATH" \
  "$SCRIPT" --strict >"$TMP/t2.out" 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  _pass "--strict + transcribe failure -> exit $rc"
else
  _fail "--strict + transcribe failure should exit non-zero, got $rc out=$(cat "$TMP/t2.out")"
fi

# ---------------------------------------------------------------
# Test 3: default (no flag) — container missing -> exit 0 (back-compat).
# ---------------------------------------------------------------
set +e
STUB_PS_OUT="" PATH="$TMP/bin:$PATH" \
  "$SCRIPT" >"$TMP/t3.out" 2>&1
rc=$?
set -e
if [ "$rc" -eq 0 ]; then
  _pass "default mode + no container -> exit 0 (back-compat)"
else
  _fail "default mode should remain tolerant, got rc=$rc"
fi

# ---------------------------------------------------------------
# Test 4 (RED until Task 4): LOADTEST_PROFILE=realistic auto-enters strict.
# ---------------------------------------------------------------
set +e
STUB_PS_OUT="" LOADTEST_PROFILE=realistic PATH="$TMP/bin:$PATH" \
  "$SCRIPT" >"$TMP/t4.out" 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  _pass "LOADTEST_PROFILE=realistic auto-strict -> exit $rc"
else
  _fail "LOADTEST_PROFILE=realistic should auto-enter strict, got $rc"
fi

echo "pre-warm-speaches: ${PASS} pass / ${FAIL} fail"
[ "$FAIL" -eq 0 ]
