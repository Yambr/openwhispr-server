#!/usr/bin/env bash
# profile-lint.test.sh — integration test for docker-compose.load-test.yml.
#
# Phase 08 / Plan 05 / Task 1. Enforces every must_have truth from the plan
# at the configuration level. This script is written FIRST (RED) before the
# override file lands; the override file is iterated until this exits 0.
#
# Truths enforced (mirrors 08-05 plan must_haves.truths):
#  T1.  `docker compose -f docker-compose.yml config --quiet` returns 0.
#  T2.  `docker compose -f docker-compose.yml -f docker-compose.load-test.yml
#        --profile load-test-mock config --quiet` returns 0.
#  T3.  `docker compose -f docker-compose.yml -f docker-compose.load-test.yml
#        --profile load-test-realistic config --quiet` returns 0.
#  T4.  Default profile (no override file) contains NEITHER mock-litellm NOR
#        speaches NOR pgbouncer-1..4.
#  T5.  Under load-test-mock: services mock-litellm, pgbouncer-1..pgbouncer-4,
#        api, traefik, mimir, postgres, valkey all present; speaches absent.
#  T6.  Under load-test-mock: each pgbouncer-N shares network alias `pgbouncer`
#        with DEFAULT_POOL_SIZE=100.
#  T7.  Under load-test profiles: postgres command contains `max_connections=500`.
#  T8.  Under load-test profiles: api.ulimits.nofile.soft==65535 AND
#        traefik.ulimits.nofile.soft==65535.
#  T9.  Under load-test profiles: traefik runs fd-probe via entrypoint override
#        OR via thin Dockerfile (we use Dockerfile per plan decision).
#  T10. Under load-test profiles: mimir exposes 9009 on host; default does not.
#  T11. Under load-test profiles: api.environment.OPENWHISPR_DISABLE_RATE_LIMIT=="1";
#        default does NOT set this.
#  T12. Under load-test-mock: mock-litellm has alias `litellm` on
#        openwhispr_internal so api's LITELLM_BASE_URL=http://litellm:4000 resolves.
#  T13. Under load-test-realistic: speaches present with WHISPER_MODEL env and
#        healthcheck.start_period >= 180s; mock-litellm absent.
#
# Exit 0 only when every truth above holds. Any failure prints a clear assertion
# message to stderr and exits 1.

set -uo pipefail

# Resolve repo root robustly even if invoked from a sub-directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

BASE_COMPOSE="docker-compose.yml"
OVERRIDE_COMPOSE="docker-compose.load-test.yml"

FAILS=0
pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1" >&2; FAILS=$((FAILS+1)); }
heading() { printf "\n==> %s\n" "$1"; }

require_python_yaml() {
  if ! python3 -c "import yaml" >/dev/null 2>&1; then
    echo "ERROR: python3 with PyYAML is required (brew install python or pip install pyyaml)" >&2
    exit 2
  fi
}

# Render a compose configuration and load it as a Python dict. Caller picks the
# profile + override-file combination. We always write to a temp file so the
# downstream Python parsers can mmap it cheaply.
render_config() {
  local out="$1"; shift
  docker compose "$@" config >"$out" 2>/tmp/profile-lint.err
}

# Generic Python query — runs an inline script against a rendered compose file
# and prints the result. Exits non-zero on KeyError/assertion failures.
yq_py() {
  local file="$1"; shift
  python3 - "$file" "$@" <<'PY'
import sys, yaml
path = sys.argv[1]
expr = sys.argv[2]
with open(path) as f:
    doc = yaml.safe_load(f)
# expr is a dotted path like services.api.environment.OPENWHISPR_DISABLE_RATE_LIMIT
node = doc
for part in expr.split('.'):
    if part == '':
        continue
    if isinstance(node, dict):
        node = node.get(part)
    elif isinstance(node, list):
        try:
            node = node[int(part)]
        except (ValueError, IndexError):
            node = None
    else:
        node = None
    if node is None:
        print("__MISSING__")
        sys.exit(0)
print(node if not isinstance(node, (dict, list)) else yaml.safe_dump(node, default_flow_style=False).strip())
PY
}

# ---------- preflight ----------
require_python_yaml

if [ ! -f "$BASE_COMPOSE" ]; then
  echo "ERROR: $BASE_COMPOSE not found at repo root ($REPO_ROOT)" >&2
  exit 2
fi

# ---------- T1: default profile parses ----------
heading "T1: default compose parses"
DEFAULT_OUT="$(mktemp)"
if render_config "$DEFAULT_OUT" -f "$BASE_COMPOSE"; then
  pass "docker compose -f $BASE_COMPOSE config returns 0"
else
  fail "docker compose -f $BASE_COMPOSE config FAILED (see /tmp/profile-lint.err)"
fi

# ---------- T4 & T11 (default-side): default contains NO load-test bits ----------
heading "T4: default profile excludes load-test services"
for svc in mock-litellm speaches pgbouncer-1 pgbouncer-2 pgbouncer-3 pgbouncer-4; do
  if grep -qE "^  $svc:" "$DEFAULT_OUT" 2>/dev/null; then
    fail "default profile UNEXPECTEDLY contains service '$svc'"
  else
    pass "default profile does not contain '$svc'"
  fi
done

heading "T11(default): OPENWHISPR_DISABLE_RATE_LIMIT NOT set in default api env"
val=$(yq_py "$DEFAULT_OUT" "services.api.environment.OPENWHISPR_DISABLE_RATE_LIMIT")
if [ "$val" = "__MISSING__" ] || [ -z "$val" ]; then
  pass "default api has no OPENWHISPR_DISABLE_RATE_LIMIT"
else
  fail "default api UNEXPECTEDLY has OPENWHISPR_DISABLE_RATE_LIMIT=$val"
fi

heading "T10(default): mimir has no host-port publication for 9009"
mimir_ports=$(yq_py "$DEFAULT_OUT" "services.mimir.ports")
if [ "$mimir_ports" = "__MISSING__" ] || ! echo "$mimir_ports" | grep -q "9009"; then
  pass "default mimir does not publish 9009"
else
  fail "default mimir UNEXPECTEDLY publishes 9009 ($mimir_ports)"
fi

# ---------- Override file must exist for T2/T3/T5+ ----------
if [ ! -f "$OVERRIDE_COMPOSE" ]; then
  fail "Override file $OVERRIDE_COMPOSE does not exist — cannot evaluate T2..T13"
  echo
  echo "Total failures: $FAILS"
  exit 1
fi

# ---------- T2: load-test-mock parses ----------
heading "T2: load-test-mock profile parses"
MOCK_OUT="$(mktemp)"
if render_config "$MOCK_OUT" -f "$BASE_COMPOSE" -f "$OVERRIDE_COMPOSE" --profile load-test-mock; then
  pass "load-test-mock config returns 0"
else
  fail "load-test-mock config FAILED (see /tmp/profile-lint.err)"
fi

# ---------- T3: load-test-realistic parses ----------
heading "T3: load-test-realistic profile parses"
REAL_OUT="$(mktemp)"
if render_config "$REAL_OUT" -f "$BASE_COMPOSE" -f "$OVERRIDE_COMPOSE" --profile load-test-realistic; then
  pass "load-test-realistic config returns 0"
else
  fail "load-test-realistic config FAILED (see /tmp/profile-lint.err)"
fi

# Skip downstream service-shape assertions if either profile failed to render.
if [ ! -s "$MOCK_OUT" ] || [ ! -s "$REAL_OUT" ]; then
  echo
  echo "Total failures: $FAILS"
  exit 1
fi

# ---------- T5: load-test-mock service inventory ----------
heading "T5: load-test-mock service inventory"
for svc in mock-litellm pgbouncer-1 pgbouncer-2 pgbouncer-3 pgbouncer-4 api traefik mimir postgres valkey; do
  if grep -qE "^  $svc:" "$MOCK_OUT"; then
    pass "load-test-mock has service '$svc'"
  else
    fail "load-test-mock MISSING service '$svc'"
  fi
done
if grep -qE "^  speaches:" "$MOCK_OUT"; then
  fail "load-test-mock UNEXPECTEDLY contains 'speaches'"
else
  pass "load-test-mock excludes 'speaches'"
fi

# ---------- T6: pgbouncer-N alias 'pgbouncer' + DEFAULT_POOL_SIZE=100 ----------
heading "T6: pgbouncer-1..4 share alias 'pgbouncer' with DEFAULT_POOL_SIZE=100"
for n in 1 2 3 4; do
  aliases=$(yq_py "$MOCK_OUT" "services.pgbouncer-$n.networks.openwhispr_internal.aliases")
  if echo "$aliases" | grep -q "pgbouncer"; then
    pass "pgbouncer-$n has network alias 'pgbouncer'"
  else
    fail "pgbouncer-$n missing alias 'pgbouncer' (got: $aliases)"
  fi
  pool=$(yq_py "$MOCK_OUT" "services.pgbouncer-$n.environment.DEFAULT_POOL_SIZE")
  if [ "$pool" = "100" ]; then
    pass "pgbouncer-$n DEFAULT_POOL_SIZE=100"
  else
    fail "pgbouncer-$n DEFAULT_POOL_SIZE=$pool (expected 100)"
  fi
done

# ---------- T7: postgres command contains max_connections=500 ----------
heading "T7: postgres has max_connections=500"
pg_cmd=$(yq_py "$MOCK_OUT" "services.postgres.command")
if echo "$pg_cmd" | grep -q "max_connections=500"; then
  pass "postgres command contains max_connections=500"
else
  fail "postgres command missing max_connections=500 (got: $pg_cmd)"
fi

# ---------- T8: api + traefik ulimits.nofile.soft==65535 ----------
heading "T8: api + traefik ulimits.nofile.soft=65535"
api_nofile=$(yq_py "$MOCK_OUT" "services.api.ulimits.nofile.soft")
if [ "$api_nofile" = "65535" ]; then
  pass "api.ulimits.nofile.soft=65535"
else
  fail "api.ulimits.nofile.soft=$api_nofile (expected 65535)"
fi
traefik_nofile=$(yq_py "$MOCK_OUT" "services.traefik.ulimits.nofile.soft")
if [ "$traefik_nofile" = "65535" ]; then
  pass "traefik.ulimits.nofile.soft=65535"
else
  fail "traefik.ulimits.nofile.soft=$traefik_nofile (expected 65535)"
fi

# ---------- T9: traefik runs fd-probe (Dockerfile path) ----------
heading "T9: traefik runs fd-probe via thin Dockerfile"
if [ -f "compose/traefik/Dockerfile" ]; then
  if grep -q "fd-probe" compose/traefik/Dockerfile; then
    pass "compose/traefik/Dockerfile COPYs fd-probe"
  else
    fail "compose/traefik/Dockerfile present but does NOT reference fd-probe"
  fi
else
  fail "compose/traefik/Dockerfile is missing"
fi
traefik_ep=$(yq_py "$MOCK_OUT" "services.traefik.entrypoint")
if echo "$traefik_ep" | grep -q "fd-probe"; then
  pass "traefik.entrypoint references fd-probe"
else
  fail "traefik.entrypoint missing fd-probe reference (got: $traefik_ep)"
fi

# ---------- T10: mimir publishes 9009 under load-test ----------
heading "T10: mimir publishes port 9009 under load-test profiles"
mimir_ports_mock=$(yq_py "$MOCK_OUT" "services.mimir.ports")
if echo "$mimir_ports_mock" | grep -q "9009"; then
  pass "load-test-mock mimir publishes 9009"
else
  fail "load-test-mock mimir missing 9009 (got: $mimir_ports_mock)"
fi

# ---------- T11(profile): OPENWHISPR_DISABLE_RATE_LIMIT=1 under load-test ----------
heading "T11: api.environment.OPENWHISPR_DISABLE_RATE_LIMIT=1 under load-test profiles"
flag_mock=$(yq_py "$MOCK_OUT" "services.api.environment.OPENWHISPR_DISABLE_RATE_LIMIT")
if [ "$flag_mock" = "1" ]; then
  pass "load-test-mock api OPENWHISPR_DISABLE_RATE_LIMIT=1"
else
  fail "load-test-mock api OPENWHISPR_DISABLE_RATE_LIMIT=$flag_mock (expected 1)"
fi
flag_real=$(yq_py "$REAL_OUT" "services.api.environment.OPENWHISPR_DISABLE_RATE_LIMIT")
if [ "$flag_real" = "1" ]; then
  pass "load-test-realistic api OPENWHISPR_DISABLE_RATE_LIMIT=1"
else
  fail "load-test-realistic api OPENWHISPR_DISABLE_RATE_LIMIT=$flag_real (expected 1)"
fi

# ---------- T12: mock-litellm alias 'litellm' on openwhispr_internal ----------
heading "T12: mock-litellm has network alias 'litellm'"
mock_aliases=$(yq_py "$MOCK_OUT" "services.mock-litellm.networks.openwhispr_internal.aliases")
if echo "$mock_aliases" | grep -q "litellm"; then
  pass "mock-litellm has alias 'litellm'"
else
  fail "mock-litellm missing alias 'litellm' (got: $mock_aliases)"
fi

# ---------- T13: speaches present under realistic with PRELOAD_MODELS + start_period>=180s ----------
heading "T13: load-test-realistic has speaches with PRELOAD_MODELS + start_period>=180s"
if grep -qE "^  speaches:" "$REAL_OUT"; then
  pass "load-test-realistic has 'speaches' service"
else
  fail "load-test-realistic MISSING 'speaches' service"
fi
# Phase 08.5-01 Task 2: WHISPER_MODEL/WHISPER__MODEL replaced with the
# canonical PRELOAD_MODELS env (08.5-RESEARCH §G3 / §P1). Assertion shifts.
preload=$(yq_py "$REAL_OUT" "services.speaches.environment.PRELOAD_MODELS")
if [ "$preload" != "__MISSING__" ] \
  && echo "$preload" | grep -q "Systran/faster-whisper-large-v3" \
  && echo "$preload" | grep -q "pyannote/speaker-diarization-community-1"; then
  pass "speaches.PRELOAD_MODELS=$preload"
else
  fail "speaches.PRELOAD_MODELS missing or incomplete (got: $preload)"
fi
start_period=$(yq_py "$REAL_OUT" "services.speaches.healthcheck.start_period")
# Compose normalises durations to either nanoseconds (int) or compound
# forms like "10m0s" (Phase 08.5-01 bumped start_period from 180s to
# 600s for the first-boot HF model download buffer per RESEARCH §P8).
case "$start_period" in
  180000000000|180s|3m|3m0s|600000000000|600s|10m|10m0s)
    pass "speaches.healthcheck.start_period=$start_period (>=180s)"
    ;;
  *)
    # Generic normaliser: handle nanoseconds, single-unit, AND compound
    # forms ("1h30m", "10m0s") that go.ParseDuration accepts.
    norm=$(python3 -c "
v = '''$start_period'''.strip()
if not v or v == '__MISSING__':
    print('-1')
elif v.isdigit():
    print(int(v) // 1_000_000_000)
else:
    import re
    units = {'ns':1e-9,'us':1e-6,'ms':1e-3,'s':1,'m':60,'h':3600}
    total = 0.0
    matches = re.findall(r'(\d+(?:\.\d+)?)([a-z]+)', v)
    if not matches:
        print('-1')
    else:
        ok = True
        for n, u in matches:
            if u not in units:
                ok = False; break
            total += float(n) * units[u]
        print(int(total) if ok else '-1')
" 2>/dev/null)
    if [ -n "$norm" ] && [ "$norm" -ge 180 ] 2>/dev/null; then
      pass "speaches.healthcheck.start_period=$start_period (~${norm}s >=180s)"
    else
      fail "speaches.healthcheck.start_period=$start_period (need >=180s)"
    fi
    ;;
esac

# realistic must NOT contain mock-litellm
if grep -qE "^  mock-litellm:" "$REAL_OUT"; then
  fail "load-test-realistic UNEXPECTEDLY contains 'mock-litellm'"
else
  pass "load-test-realistic excludes 'mock-litellm'"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  printf "\033[32mAll profile-lint assertions PASSED.\033[0m\n"
  exit 0
else
  printf "\033[31m%d profile-lint assertion(s) FAILED.\033[0m\n" "$FAILS" >&2
  exit 1
fi
