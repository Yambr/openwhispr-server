#!/bin/sh
# Phase 08.1-followup — behaviour tests for k6-smoke.sh.
#
# Stubs `k6` on PATH with deterministic exit codes + output payloads so
# the smoke wrapper's classification logic is exercised end-to-end
# without booting Docker. Mirrors the run.test.sh stub pattern.

set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/tools/load-test/scripts/k6-smoke.sh"
BUNDLE="$ROOT/tools/load-test/dist/smoke.js"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# 1. File exists and is executable.
test -x "$SCRIPT" || fail "k6-smoke.sh missing or not executable"

# 2. Bundle pre-flight — script must refuse if dist/smoke.js is absent.
STUB_DIR=$(mktemp -d)
trap 'rm -rf "$STUB_DIR"' EXIT
if [ -f "$BUNDLE" ]; then
  # Move bundle aside so we can exercise the missing-bundle branch.
  mv "$BUNDLE" "$STUB_DIR/smoke.js.bak"
  RESTORE_BUNDLE=1
else
  RESTORE_BUNDLE=0
fi

cat >"$STUB_DIR/k6" <<'EOF'
#!/bin/sh
echo "this stub k6 should not be invoked when bundle is missing"
exit 0
EOF
chmod +x "$STUB_DIR/k6"

set +e
PATH="$STUB_DIR:$PATH" "$SCRIPT" >"$STUB_DIR/out.txt" 2>&1
RC=$?
set -e
[ "$RC" -eq 2 ] || fail "missing-bundle branch should exit 2, got $RC"
grep -F "bundle" "$STUB_DIR/out.txt" >/dev/null || fail "missing-bundle branch should mention 'bundle'"

# Restore bundle (or create a placeholder for the remaining tests).
if [ "$RESTORE_BUNDLE" = "1" ]; then
  mv "$STUB_DIR/smoke.js.bak" "$BUNDLE"
else
  mkdir -p "$(dirname "$BUNDLE")"
  echo '// placeholder for k6-smoke.test.sh' >"$BUNDLE"
  PLACEHOLDER_BUNDLE=1
fi

# 3. Happy path — stub k6 with `exit 0` and benign output.
cat >"$STUB_DIR/k6" <<'EOF'
#!/bin/sh
echo "running (10s/30s), 5/5 VUs, 12 iterations"
echo "checks........: 100.00%"
exit 0
EOF
chmod +x "$STUB_DIR/k6"

set +e
PATH="$STUB_DIR:$PATH" SMOKE_LOG="$STUB_DIR/happy.log" \
  "$SCRIPT" >"$STUB_DIR/happy.out" 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || fail "happy-path should exit 0, got $RC (log=$STUB_DIR/happy.out)"
grep -F "PASS" "$STUB_DIR/happy.out" >/dev/null || fail "happy-path should print PASS"

# 4. Host-object regression — stub k6 with the literal TypeError that
#    Plan 08.1-followup's bug emits. The wrapper MUST classify this as
#    the "host object mutation" failure mode, not a generic exit code.
cat >"$STUB_DIR/k6" <<'EOF'
#!/bin/sh
cat <<'OUT'
ERRO[0001] TypeError: Cannot assign to property __k6_http_file of a host object
    at httpFile (file:///tools/load-test/dist/smoke.js:98:27)
OUT
exit 107
EOF
chmod +x "$STUB_DIR/k6"

set +e
PATH="$STUB_DIR:$PATH" SMOKE_LOG="$STUB_DIR/host.log" \
  "$SCRIPT" >"$STUB_DIR/host.out" 2>&1
RC=$?
set -e
[ "$RC" -eq 1 ] || fail "host-object regression should exit 1, got $RC"
grep -F "host-object mutation" "$STUB_DIR/host.out" >/dev/null \
  || fail "host-object regression should be classified as such (got: $(cat "$STUB_DIR/host.out"))"
grep -F "08.1-followup" "$STUB_DIR/host.out" >/dev/null \
  || fail "host-object failure should reference 08.1-followup root-cause docket"

# 5. Generic TypeError (any other than host-object) — wrapper must still
#    fail the gate but report the generic message, not the specific one.
cat >"$STUB_DIR/k6" <<'EOF'
#!/bin/sh
echo "ERRO[0001] TypeError: Cannot read property 'foo' of undefined"
exit 107
EOF
chmod +x "$STUB_DIR/k6"

set +e
PATH="$STUB_DIR:$PATH" SMOKE_LOG="$STUB_DIR/typeerr.log" \
  "$SCRIPT" >"$STUB_DIR/typeerr.out" 2>&1
RC=$?
set -e
[ "$RC" -eq 1 ] || fail "generic TypeError should exit 1, got $RC"
grep -F "TypeError in k6 script" "$STUB_DIR/typeerr.out" >/dev/null \
  || fail "generic TypeError should be classified as 'TypeError in k6 script'"

# 6. Exit-code-only failure (k6 non-zero with no TypeError marker, e.g.
#    threshold breach) — classified as threshold/runtime error.
cat >"$STUB_DIR/k6" <<'EOF'
#!/bin/sh
echo "level=error msg='thresholds on metric http_req_failed have been crossed'"
exit 99
EOF
chmod +x "$STUB_DIR/k6"

set +e
PATH="$STUB_DIR:$PATH" SMOKE_LOG="$STUB_DIR/threshold.log" \
  "$SCRIPT" >"$STUB_DIR/threshold.out" 2>&1
RC=$?
set -e
[ "$RC" -eq 1 ] || fail "threshold breach should exit 1, got $RC"
grep -E "exit=99|threshold breach" "$STUB_DIR/threshold.out" >/dev/null \
  || fail "threshold breach should mention exit code or threshold (got: $(cat "$STUB_DIR/threshold.out"))"

# 7. run.sh integration — verify smoke gate is wired AFTER bundle build
#    and BEFORE the plateau k6 invocation.
RUN_SH="$ROOT/tools/load-test/scripts/run.sh"
build_line=$(grep -n "pnpm run build" "$RUN_SH" | head -1 | cut -d: -f1)
smoke_line=$(grep -n "k6-smoke.sh" "$RUN_SH" | head -1 | cut -d: -f1)
# Match the actual invocation line (`k6 run \` continues onto next line),
# not commented references to `k6 run` earlier in the file.
plateau_line=$(grep -n "^k6 run" "$RUN_SH" | head -1 | cut -d: -f1)
[ -n "$build_line" ] || fail "run.sh: missing pnpm build step"
[ -n "$smoke_line" ] || fail "run.sh: missing k6-smoke.sh wiring"
[ -n "$plateau_line" ] || fail "run.sh: missing main k6 run invocation"
[ "$build_line" -lt "$smoke_line" ] \
  || fail "run.sh: smoke gate must run AFTER bundle build (build@$build_line, smoke@$smoke_line)"
[ "$smoke_line" -lt "$plateau_line" ] \
  || fail "run.sh: smoke gate must run BEFORE plateau (smoke@$smoke_line, plateau@$plateau_line)"

# 8. SMOKE_SKIP=1 bypass — run.sh respects the env-var override.
grep -F "SMOKE_SKIP" "$RUN_SH" >/dev/null \
  || fail "run.sh: missing SMOKE_SKIP bypass branch"

# Cleanup placeholder bundle if we created one.
if [ "${PLACEHOLDER_BUNDLE:-0}" = "1" ]; then
  rm -f "$BUNDLE"
fi

echo "PASS: k6-smoke.sh + run.sh integration (8/8)"
