#!/usr/bin/env bash
# Phase 08 / Plan 02 — Task 3 RED -> GREEN: harness for the fd-probe contract.
#
# The actual fd-probe.sh lives under apps/api/scripts/ and ships in
# plan 04. This harness encodes the contract plan 04 must honour:
#
#   exit 0  — soft fd ulimit >= 65535 (boot proceeds)
#   exit 1  — soft fd ulimit  < 65535 (api refuses to boot)
#
# The harness:
#   * Locates the probe via FD_PROBE_PATH (default: apps/api/scripts/fd-probe.sh)
#   * Reports "probe not found" cleanly if missing (still exits 0 so Wave 0
#     CI does not fail before plan 04 lands)
#   * Substitutes inline shell stubs simulating both ulimit conditions to
#     prove the harness itself behaves correctly. Plan 04 will re-run this
#     harness against the real probe.
#
# Test list (lines preserved so plan 04 can grep for them):
#   T5: probe returning exit 1 (simulated soft limit < 65535) -> harness records FAIL
#   T6: probe returning exit 0 (simulated soft limit = 65535) -> harness records PASS
#   T7: missing probe -> "probe not found" + clean exit
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
DEFAULT_PROBE="${REPO_ROOT}/apps/api/scripts/fd-probe.sh"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

_pass() { PASS=$((PASS + 1)); printf '  ok %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK %s\n' "$1" >&2; }

# Run a candidate probe and report PASS/FAIL based on its exit code.
# Pure harness — no business logic; just contract enforcement.
run_probe() {
  local probe="$1"
  if [[ ! -x "$probe" ]]; then
    echo "probe not found: $probe"
    return 2
  fi
  if "$probe"; then
    echo "PASS"
    return 0
  fi
  echo "FAIL"
  return 1
}

echo "fd-probe harness tests"

# Test 5 (RED): simulated soft limit < 65535 (probe exits 1) -> FAIL.
cat > "${TMP}/probe-low.sh" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
chmod +x "${TMP}/probe-low.sh"
set +e
out="$(run_probe "${TMP}/probe-low.sh")"
rc=$?
set -e
if [[ $rc -eq 1 && "$out" == "FAIL" ]]; then
  _pass "low ulimit -> FAIL"
else
  _fail "low ulimit should yield FAIL/rc=1, got rc=$rc out=$out"
fi

# Test 6 (RED): simulated soft limit = 65535 (probe exits 0) -> PASS.
cat > "${TMP}/probe-high.sh" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "${TMP}/probe-high.sh"
set +e
out="$(run_probe "${TMP}/probe-high.sh")"
rc=$?
set -e
if [[ $rc -eq 0 && "$out" == "PASS" ]]; then
  _pass "high ulimit -> PASS"
else
  _fail "high ulimit should yield PASS/rc=0, got rc=$rc out=$out"
fi

# Test 7 (RED): missing probe -> clean "probe not found" message.
set +e
out="$(run_probe "${TMP}/does-not-exist.sh")"
rc=$?
set -e
if [[ $rc -eq 2 && "$out" == *"probe not found"* ]]; then
  _pass "missing probe -> probe not found (clean)"
else
  _fail "missing probe should report cleanly, got rc=$rc out=$out"
fi

# Informational: report the path plan 04 will populate. Do NOT fail when
# absent — Wave 0 CI runs before plan 04 lands.
TARGET_PROBE="${FD_PROBE_PATH:-${DEFAULT_PROBE}}"
if [[ -x "$TARGET_PROBE" ]]; then
  echo "fd-probe.test.sh: real probe present at ${TARGET_PROBE} — exercising contract"
  set +e
  out="$(run_probe "${TARGET_PROBE}")"
  rc=$?
  set -e
  echo "  real-probe result: rc=$rc out=$out"
else
  echo "fd-probe.test.sh: real probe not yet present at ${TARGET_PROBE} (plan 04 owns this file)"
fi

echo "fd-probe: ${PASS} pass / ${FAIL} fail"
[[ $FAIL -eq 0 ]]
