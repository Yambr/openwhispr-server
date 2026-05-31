#!/usr/bin/env bash
# preflight.test.sh — test harness for tools/load-test/scripts/preflight.sh.
#
# Phase 08 / Plan 05 / Task 3. RED-first: each test stubs the underlying
# command so the check fails predictably, then asserts preflight.sh exits
# non-zero with the expected error. The happy-path test invokes preflight
# unstubbed against the real host and accepts either exit 0 (everything OK)
# or a documented refusal — we only assert the script does NOT crash on a
# valid syntax / missing-dependency error.
#
# Stub strategy: prepend a temp dir to PATH that contains fake `docker`,
# `lsof`, `sysctl`, `git`, `command` shims. Each test creates a fresh
# scratch PATH with only the stubs it cares about.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PREFLIGHT="$SCRIPT_DIR/preflight.sh"

FAILS=0
pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1" >&2; FAILS=$((FAILS+1)); }

# Build a temp stub dir; populate via stub_set NAME 'shell-body'.
make_stubdir() {
  local d
  d=$(mktemp -d)
  echo "$d"
}
stub_set() {
  local dir="$1" name="$2" body="$3"
  cat > "$dir/$name" <<EOF
#!/usr/bin/env bash
$body
EOF
  chmod +x "$dir/$name"
}

# T0: script exists and is executable
if [ -x "$PREFLIGHT" ]; then
  pass "preflight.sh exists and is executable"
else
  fail "preflight.sh missing or not executable at $PREFLIGHT"
  echo "Total failures: $FAILS"
  exit 1
fi

# T1: --help is wired
if "$PREFLIGHT" --help >/dev/null 2>&1; then
  pass "preflight.sh --help exits 0"
else
  fail "preflight.sh --help does not exit 0"
fi

# T2: invocation without --yes must refuse with a clear stderr message
out=$("$PREFLIGHT" 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q -i -- "--yes"; then
  pass "preflight.sh refuses without --yes (rc=$rc, mentions --yes)"
else
  fail "preflight.sh did NOT refuse without --yes (rc=$rc, out=$out)"
fi

# T3: docker info failure -> refuse
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'echo "Cannot connect to the Docker daemon" >&2; exit 1'
stub_set "$stubdir" lsof  'exit 1'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo "" '   # clean tree
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q -i -E "docker"; then
  pass "preflight.sh refuses when docker info fails"
else
  fail "preflight.sh accepted a broken docker daemon (rc=$rc, out=$out)"
fi

# T4: low RAM -> refuse
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'echo "MemTotal: 8589934592"; exit 0'
stub_set "$stubdir" lsof 'exit 1'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo "" '
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q -i -E "(ram|memory|mem)"; then
  pass "preflight.sh refuses when Docker RAM < 24 GB"
else
  fail "preflight.sh did NOT refuse low-RAM Docker (rc=$rc, out=$out)"
fi

# T5: port occupied -> refuse. Stub `lsof` to ALWAYS report 9009 in use.
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 34359738368"; fi; exit 0'
stub_set "$stubdir" lsof 'echo "fakeproc 12345 user 5u IPv4 0t0 TCP localhost:9009 (LISTEN)"; exit 0'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo "" '
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q -i -E "port"; then
  pass "preflight.sh refuses when a load-test port is occupied"
else
  fail "preflight.sh did NOT refuse occupied port (rc=$rc, out=$out)"
fi

# T5b: lsof reports only outbound ESTABLISHED connections on the port (no LISTEN)
# -> preflight must treat the port as FREE. Regression guard for the case where
# e.g. Telegram has an outbound TCP -> remote:443 (ESTABLISHED) but nothing is
# bound to local :443. Real lsof on macOS returns such rows for `lsof -i :443`.
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 34359738368"; fi; exit 0'
# Stub responds to both query forms:
#   - bare `lsof -i :PORT` (legacy): returns ESTABLISHED outbound row, exit 0
#   - `lsof -nP -iTCP:PORT -sTCP:LISTEN` (fixed): returns nothing, exit 1
stub_set "$stubdir" lsof 'for a in "$@"; do case "$a" in -sTCP:LISTEN) exit 1;; esac; done; echo "Telegram 11626 nick 23u IPv4 0xdead 0t0 TCP 198.18.0.1:61108->149.154.167.41:443 (ESTABLISHED)"; exit 0'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo "" '
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -eq 0 ]; then
  pass "preflight.sh treats outbound-only ESTABLISHED rows as port-free"
else
  fail "preflight.sh wrongly refused on outbound-only ESTABLISHED rows (rc=$rc, out=$out)"
fi

# T6: dirty git tree -> refuse
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 34359738368"; fi; exit 0'
stub_set "$stubdir" lsof 'exit 1'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git '
case "$1" in
  status)
    # Simulate dirty docker-compose.yml
    echo " M docker-compose.yml"
    ;;
  *) echo "" ;;
esac
'
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q -i -E "(git|uncommit|dirty)"; then
  pass "preflight.sh refuses on dirty docker-compose.yml"
else
  fail "preflight.sh accepted dirty docker-compose.yml (rc=$rc, out=$out)"
fi

# T7: happy path with all stubs healthy -> exit 0
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 34359738368"; fi; exit 0'
stub_set "$stubdir" lsof 'exit 1'  # exit 1 = no process found = port free
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo ""'  # clean tree for any args
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -eq 0 ]; then
  pass "preflight.sh exits 0 on healthy host"
else
  fail "preflight.sh failed on healthy host (rc=$rc, out=$out)"
fi

# T8: missing k6 AND missing docker fallback -> refuse
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 34359738368"; fi; exit 0'
stub_set "$stubdir" lsof 'exit 1'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" git 'echo ""'
# k6 omitted entirely; docker IS present so the warn fallback may apply
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
# Documented: missing k6 with docker fallback is a WARN, not a refusal.
# So this should still exit 0 but with a warning string in the output.
if [ "$rc" -eq 0 ] && echo "$out" | grep -q -i -E "k6"; then
  pass "preflight.sh tolerates missing k6 when docker fallback is available (warn-only)"
else
  fail "preflight.sh handling of missing k6 + docker fallback unexpected (rc=$rc, out=$out)"
fi

# T9: PREFLIGHT_MIN_RAM_GIB override lets a smaller host pass the RAM check.
# A ~16 GiB GitHub-hosted runner running a ≤2-min mock smoke does not need the
# 24 GiB plateau floor; CI sets PREFLIGHT_MIN_RAM_GIB=12 (fix 260530-rqk).
# 17179869184 bytes = 16 GiB Docker MemTotal.
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 17179869184"; fi; exit 0'
stub_set "$stubdir" lsof 'exit 1'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo ""'
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" PREFLIGHT_MIN_RAM_GIB=12 "$PREFLIGHT" --yes 2>&1)
rc=$?
# rc=0 and NO RAM-floor failure line means the override took effect. (Per-check
# OK lines only print under --verbose, so assert on the absence of the failure.)
if [ "$rc" -eq 0 ] && ! echo "$out" | grep -q -i -E "GiB floor"; then
  pass "preflight.sh honors PREFLIGHT_MIN_RAM_GIB override (16 GiB passes a 12 GiB floor)"
else
  fail "preflight.sh ignored PREFLIGHT_MIN_RAM_GIB override (rc=$rc, out=$out)"
fi

# T10: the DEFAULT RAM floor is unchanged — 16 GiB still refused without the
# override. Guards against the override accidentally lowering the plateau floor.
stubdir=$(make_stubdir)
stub_set "$stubdir" docker 'if [ "$1" = "info" ]; then echo "MemTotal: 17179869184"; fi; exit 0'
stub_set "$stubdir" lsof 'exit 1'
stub_set "$stubdir" sysctl 'echo "kern.maxfilesperproc: 65535"'
stub_set "$stubdir" k6 'echo "k6 v0.50.0"'
stub_set "$stubdir" git 'echo ""'
out=$(env -i PATH="$stubdir:/usr/bin:/bin" HOME="$HOME" "$PREFLIGHT" --yes 2>&1)
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q -i -E "(ram|memory|mem)"; then
  pass "preflight.sh keeps the 24 GiB default floor when PREFLIGHT_MIN_RAM_GIB is unset"
else
  fail "preflight.sh default RAM floor regressed — 16 GiB should refuse (rc=$rc, out=$out)"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  printf "\033[32mAll preflight tests PASSED.\033[0m\n"
  exit 0
else
  printf "\033[31m%d preflight test(s) FAILED.\033[0m\n" "$FAILS" >&2
  exit 1
fi
