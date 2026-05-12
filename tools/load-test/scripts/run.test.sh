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

# 8. Plan 08.1-01 — OPENWHISPR_LOADTEST_KEEP_STACK env-gated trap branch
#    is present (forensic-capture escape hatch). Body verification: the
#    keep-stack branch MUST short-circuit BEFORE the docker compose down
#    trap is wired, so we assert both env-var name + the no-down branch
#    by source-grep.
grep -F "OPENWHISPR_LOADTEST_KEEP_STACK" "$SCRIPT" >/dev/null \
  || fail "run.sh missing OPENWHISPR_LOADTEST_KEEP_STACK env branch"
# 8a. Behaviour check via dry-run: stub k6 with `exit 99`, stub docker, set
#     KEEP_STACK=1, assert the post-exit invocation prints the keep-alive
#     hint and that the down command is NOT issued. A sentinel file proves
#     the teardown branch was skipped.
STUB_DIR=$(mktemp -d)
SENTINEL="$STUB_DIR/teardown-was-called"
# Stub `docker` so the script does not actually hit the daemon. If the
# teardown trap runs `docker compose ... down`, our stub writes the sentinel.
cat >"$STUB_DIR/docker" <<EOF
#!/bin/sh
for arg in "\$@"; do
  if [ "\$arg" = "down" ]; then
    : >"$SENTINEL"
    exit 0
  fi
done
exit 0
EOF
chmod +x "$STUB_DIR/docker"
# Stub k6 with `exit 99` so the non-zero path is exercised.
cat >"$STUB_DIR/k6" <<'EOF'
#!/bin/sh
exit 99
EOF
chmod +x "$STUB_DIR/k6"
# Stub sh-invoked helpers (preflight + pre-warm) by shadowing them inside
# a scratch tree we point ROOT at — simpler: prepend STUB to PATH for the
# docker+k6 fakes, then bypass preflight by running with a side-channel.
# We cannot rebind ROOT cheaply; instead, set PATH so `docker` is a stub,
# patch preflight by stubbing `sh tools/load-test/scripts/preflight.sh`.
# The script uses literal `sh tools/load-test/scripts/preflight.sh` — we
# replace the preflight script with a no-op via bind-style shadow: copy
# run.sh into the stub dir with preflight + build calls neutered. Cleanest
# is invoking run.sh with PATH containing only stubs PLUS the system PATH,
# AND replacing the preflight/pnpm invocations via a copy.
RUN_COPY="$STUB_DIR/run.sh"
# Neutralise preflight + pnpm build + docker compose build/up — leave only
# the trap wiring and k6 invocation to exercise the keep-stack branch.
sed \
  -e 's|sh tools/load-test/scripts/preflight.sh --yes|true|' \
  -e 's|\$COMPOSE_BASE build|true|' \
  -e 's|\$COMPOSE_BASE up -d --wait|true|' \
  -e 's|(cd tools/load-test && pnpm run build)|true|' \
  "$SCRIPT" > "$RUN_COPY"
chmod +x "$RUN_COPY"
# Run with KEEP_STACK=1 and our stub docker+k6 on PATH.
OPENWHISPR_LOADTEST_KEEP_STACK=1 \
  PATH="$STUB_DIR:$PATH" \
  "$RUN_COPY" mock >"$STUB_DIR/run.out" 2>&1 || true
if [ -f "$SENTINEL" ]; then
  fail "OPENWHISPR_LOADTEST_KEEP_STACK=1 did not suppress 'docker compose down' (T-keepstack-1)"
fi
grep -F "OPENWHISPR_LOADTEST_KEEP_STACK=1" "$STUB_DIR/run.out" >/dev/null \
  || fail "keep-stack trap did not print the keep-alive hint (T-keepstack-1)"

# 8b. Inverse: WITHOUT the env var, the teardown DOES run.
rm -f "$SENTINEL"
PATH="$STUB_DIR:$PATH" \
  "$RUN_COPY" mock >"$STUB_DIR/run-down.out" 2>&1 || true
[ -f "$SENTINEL" ] \
  || fail "default trap branch did not invoke 'docker compose down' (T-keepstack-1 inverse)"
rm -rf "$STUB_DIR"

# ---------------------------------------------------------------
# Phase 08.5-02 Task 1 — RED cases for run.sh realistic extensions.
# These fail until Wave 2 Task 4 wires the realistic branch.
# ---------------------------------------------------------------

# 9. Realistic branch layers docker-compose.load-test.realistic.yml.
grep -F "docker-compose.load-test.realistic.yml" "$SCRIPT" >/dev/null \
  || fail "run.sh missing 08.5 third compose overlay (docker-compose.load-test.realistic.yml)"

# 10. Realistic branch exports LOADTEST_PROFILE=realistic so pre-warm
# auto-enters strict mode (Wave 1 Task 4 contract).
grep -E "LOADTEST_PROFILE.*realistic" "$SCRIPT" >/dev/null \
  || fail "run.sh realistic branch does not export LOADTEST_PROFILE=realistic"

# 11. Realistic branch defaults SMOKE_DURATION=60s (per ROADMAP success
# criterion 2 — smoke at 5 VU × 60 s). Allow operator override via env.
grep -E "SMOKE_DURATION.*60s" "$SCRIPT" >/dev/null \
  || fail "run.sh realistic branch does not default SMOKE_DURATION=60s"

echo "PASS: run.sh + pre-warm-speaches.sh smoke checks (11/11)"
