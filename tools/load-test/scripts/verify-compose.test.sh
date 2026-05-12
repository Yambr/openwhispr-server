#!/usr/bin/env bash
# Phase 08 / Plan 02 — Task 3 RED: tests for verify-compose.sh.
#
# verify-compose.sh validates a compose profile via
# `docker compose --profile <name> config --quiet`. Wave 1 (plan 05) adds
# the `load-test-mock` and `load-test-realistic` profiles. Wave 0 ships
# argument-parsing only — happy-path validation lands when Wave 1 does.
#
# To keep these tests hermetic, we stub `docker` on $PATH so we can
# assert the *arguments* the script forwards, not the live exit of
# `docker compose config`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/verify-compose.sh"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

_pass() { PASS=$((PASS + 1)); printf '  ok %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK %s\n' "$1" >&2; }

# Stub docker on PATH so the script never touches the real daemon.
mkdir -p "${TMP}/bin"
cat > "${TMP}/bin/docker" <<'STUB'
#!/usr/bin/env bash
# Echo every argument we received so the test can assert call shape.
printf '%s\n' "$@" >> "${DOCKER_STUB_LOG}"
exit 0
STUB
chmod +x "${TMP}/bin/docker"
export DOCKER_STUB_LOG="${TMP}/docker.log"

echo "verify-compose.sh tests"

# Test 1: no arg -> usage + exit 1.
: > "${DOCKER_STUB_LOG}"
set +e
out="$(PATH="${TMP}/bin:${PATH}" "$SCRIPT" 2>&1)"
rc=$?
set -e
if [[ $rc -eq 1 && "$out" == *usage* ]]; then
  _pass "no arg -> usage + exit 1"
else
  _fail "no arg should exit 1 with usage, got rc=$rc out=$out"
fi

# Test 2: unknown profile -> exit 1, stderr contains the profile name.
: > "${DOCKER_STUB_LOG}"
set +e
out="$(PATH="${TMP}/bin:${PATH}" "$SCRIPT" gibberish-profile 2>&1)"
rc=$?
set -e
if [[ $rc -eq 1 && "$out" == *gibberish-profile* ]]; then
  _pass "unknown profile -> exit 1 with offending name on stderr"
else
  _fail "unknown profile should exit 1 mentioning name, got rc=$rc out=$out"
fi

# Test 3: known profile -> invokes `docker compose --profile <name> config --quiet`.
: > "${DOCKER_STUB_LOG}"
set +e
PATH="${TMP}/bin:${PATH}" "$SCRIPT" load-test-mock >/dev/null 2>&1
rc=$?
set -e
log_content="$(cat "${DOCKER_STUB_LOG}")"
if [[ $rc -eq 0 \
  && "$log_content" == *compose* \
  && "$log_content" == *--profile* \
  && "$log_content" == *load-test-mock* \
  && "$log_content" == *config* \
  && "$log_content" == *--quiet* ]]; then
  _pass "happy path -> docker compose --profile load-test-mock config --quiet"
else
  _fail "happy path should forward correct docker args, got rc=$rc log=$log_content"
fi

# Test 4: script declares `set -euo pipefail`.
if grep -q 'set -euo pipefail' "$SCRIPT"; then
  _pass "verify-compose.sh declares set -euo pipefail"
else
  _fail "verify-compose.sh missing 'set -euo pipefail'"
fi

echo "verify-compose: ${PASS} pass / ${FAIL} fail"
[[ $FAIL -eq 0 ]]
