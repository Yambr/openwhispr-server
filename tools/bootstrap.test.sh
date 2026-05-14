#!/usr/bin/env bash
# tools/bootstrap.test.sh — pure-bash conformance test for the
# BOOTSTRAP_ENV_TEMPLATE override and --print-template dry-run flag.
#
# Phase 14 / Plan 02 / Task 1. No bats dependency; shells out to a real
# `bash tools/bootstrap.sh` so we exercise the real script, not a mock.
#
# Exit 0 = all assertions GREEN. Non-zero = at least one assertion FAILED.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP="${REPO_ROOT}/tools/bootstrap.sh"

declare -i FAILED=0
declare -i PASSED=0

fail() {
  printf '  FAIL: %s\n' "$1" >&2
  FAILED+=1
}

pass() {
  printf '  ok:   %s\n' "$1"
  PASSED+=1
}

# All three tests use --print-template, which must short-circuit BEFORE any
# .env write / deny-list check / cert generation runs.

# --- Test 1 ----------------------------------------------------------------
# With BOOTSTRAP_ENV_TEMPLATE unset, --print-template prints the absolute
# path to ${REPO_ROOT}/.env.slim.example.
echo "Test 1: default template is .env.slim.example"
EXPECTED_1="${REPO_ROOT}/.env.slim.example"
ACTUAL_1="$(unset BOOTSTRAP_ENV_TEMPLATE; bash "${BOOTSTRAP}" --print-template 2>/dev/null || true)"
if [[ "${ACTUAL_1}" == "${EXPECTED_1}" ]]; then
  pass "default template path == .env.slim.example"
else
  fail "expected '${EXPECTED_1}', got '${ACTUAL_1}'"
fi

# --- Test 2 ----------------------------------------------------------------
# With BOOTSTRAP_ENV_TEMPLATE=/tmp/custom.env.example (file must exist so the
# existence guard does not trip), --print-template prints that path.
echo "Test 2: BOOTSTRAP_ENV_TEMPLATE override honoured"
SCRATCH="$(mktemp -d)"
CUSTOM="${SCRATCH}/custom.env.example"
printf 'POSTGRES_APP_PASSWORD=PLACEHOLDER_BOOTSTRAP_WILL_REPLACE\n' > "${CUSTOM}"
ACTUAL_2="$(BOOTSTRAP_ENV_TEMPLATE="${CUSTOM}" bash "${BOOTSTRAP}" --print-template 2>/dev/null || true)"
if [[ "${ACTUAL_2}" == "${CUSTOM}" ]]; then
  pass "override path printed verbatim"
else
  fail "expected '${CUSTOM}', got '${ACTUAL_2}'"
fi
rm -rf "${SCRATCH}"

# --- Test 3 ----------------------------------------------------------------
# With BOOTSTRAP_ENV_TEMPLATE pointing at a non-existent file, bootstrap.sh
# exits non-zero with a clear "template not found" message on stderr. Must
# NOT silently fall back to .env.slim.example.
echo "Test 3: missing template -> non-zero exit + clear stderr"
MISSING="/tmp/openwhispr-bootstrap-nope-$$-does-not-exist"
STDERR_FILE="$(mktemp)"
set +e
BOOTSTRAP_ENV_TEMPLATE="${MISSING}" bash "${BOOTSTRAP}" --print-template \
  >/dev/null 2>"${STDERR_FILE}"
RC=$?
set -e
STDERR_CONTENT="$(cat "${STDERR_FILE}")"
rm -f "${STDERR_FILE}"
if (( RC != 0 )); then
  pass "non-zero exit (${RC}) on missing template"
else
  fail "expected non-zero exit, got 0"
fi
if [[ "${STDERR_CONTENT}" == *"template not found"* ]]; then
  pass "stderr contains 'template not found'"
else
  fail "stderr missing 'template not found': '${STDERR_CONTENT}'"
fi
if [[ "${STDERR_CONTENT}" == *"${MISSING}"* ]]; then
  pass "stderr names the offending path"
else
  fail "stderr does not name '${MISSING}': '${STDERR_CONTENT}'"
fi

# --- Summary ---------------------------------------------------------------
printf '\n%s: %d passed, %d failed\n' "$(basename "${BASH_SOURCE[0]}")" "${PASSED}" "${FAILED}" >&2
if (( FAILED > 0 )); then
  exit 1
fi
exit 0
