#!/bin/sh
# Phase 08.1 / Plan 01 / Task 4 — bootstrap.sh behaviour tests.
#
# Two layers:
#   A. Hermetic — drive bootstrap.sh with a fake /entrypoint.sh and
#      AUTH_FILE pointed at a tmp file. Asserts the admin user is appended
#      iff PGBOUNCER_ADMIN_PASSWORD is set + not already present.
#   B. Live (opt-in via BOOTSTRAP_LIVE=1) — docker-compose up postgres
#      + the wrapped pgbouncer image, runs
#      `psql -U pgbouncer_admin pgbouncer -c 'SHOW POOLS'` and asserts
#      rows are returned. Skipped by default (testcontainers boot ≈ 30 s).

set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/compose/pgbouncer/bootstrap.sh"
DOCKERFILE="$ROOT/compose/pgbouncer/Dockerfile"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

test -x "$SCRIPT" || fail "bootstrap.sh missing or not executable"
test -f "$DOCKERFILE" || fail "Dockerfile missing"

# ---------------------------------------------------------------------------
# Layer A — hermetic
# ---------------------------------------------------------------------------

# 1. With PGBOUNCER_ADMIN_PASSWORD set and an empty userlist, the admin
#    line is appended exactly once and entrypoint is exec'd.
SANDBOX=$(mktemp -d)
mkdir -p "$SANDBOX/etc/pgbouncer"
AUTH_FILE="$SANDBOX/etc/pgbouncer/userlist.txt"
: >"$AUTH_FILE"

# Fake /entrypoint.sh that records its invocation arguments and exits 0.
FAKE_ENTRYPOINT="$SANDBOX/entrypoint.sh"
cat >"$FAKE_ENTRYPOINT" <<EOF
#!/bin/sh
echo "FAKE_ENTRYPOINT_INVOKED args=\$*" > "$SANDBOX/entrypoint.out"
exit 0
EOF
chmod +x "$FAKE_ENTRYPOINT"

# Wrap bootstrap.sh into a sandbox: rewrite the hard-coded `/entrypoint.sh`
# path to our fake. We use a temp copy so the source script stays untouched.
COPY="$SANDBOX/bootstrap.sh"
sed "s|/entrypoint.sh|$FAKE_ENTRYPOINT|g" "$SCRIPT" > "$COPY"
chmod +x "$COPY"

PGBOUNCER_ADMIN_PASSWORD=admin-pwd-1 AUTH_FILE="$AUTH_FILE" "$COPY" arg1 arg2 \
  >"$SANDBOX/run1.out" 2>&1 \
  || fail "bootstrap.sh exited non-zero with admin password set"

grep -q '^"pgbouncer_admin" "admin-pwd-1"$' "$AUTH_FILE" \
  || fail "admin user not appended to userlist (T-bootstrap-1)"

[ "$(grep -c '^"pgbouncer_admin"' "$AUTH_FILE")" = "1" ] \
  || fail "admin user appended more than once (T-bootstrap-1)"

grep -q "FAKE_ENTRYPOINT_INVOKED args=arg1 arg2" "$SANDBOX/entrypoint.out" \
  || fail "bootstrap.sh did not exec entrypoint with passthrough args (T-bootstrap-1)"

# 2. Idempotent — re-run on the same file does not append a duplicate.
PGBOUNCER_ADMIN_PASSWORD=admin-pwd-1 AUTH_FILE="$AUTH_FILE" "$COPY" arg1 arg2 \
  >"$SANDBOX/run2.out" 2>&1 \
  || fail "bootstrap.sh exited non-zero on re-run"
[ "$(grep -c '^"pgbouncer_admin"' "$AUTH_FILE")" = "1" ] \
  || fail "admin user duplicated on re-run (T-bootstrap-2)"
grep -q "already present" "$SANDBOX/run2.out" \
  || fail "bootstrap.sh did not emit 'already present' message on re-run (T-bootstrap-2)"

# 3. Missing PGBOUNCER_ADMIN_PASSWORD — emits a stderr warning, does NOT
#    append, still execs the entrypoint (defensive: the admin user is a
#    nice-to-have for SHOW POOLS, but the proxy traffic must still work).
SANDBOX2=$(mktemp -d)
mkdir -p "$SANDBOX2/etc/pgbouncer"
AUTH_FILE2="$SANDBOX2/etc/pgbouncer/userlist.txt"
: >"$AUTH_FILE2"
FAKE2="$SANDBOX2/entrypoint.sh"
cat >"$FAKE2" <<EOF
#!/bin/sh
echo invoked > "$SANDBOX2/entrypoint.out"
EOF
chmod +x "$FAKE2"
COPY2="$SANDBOX2/bootstrap.sh"
sed "s|/entrypoint.sh|$FAKE2|g" "$SCRIPT" > "$COPY2"
chmod +x "$COPY2"

unset PGBOUNCER_ADMIN_PASSWORD || true
AUTH_FILE="$AUTH_FILE2" "$COPY2" pgbouncer >"$SANDBOX2/run.out" 2>"$SANDBOX2/run.err" \
  || fail "bootstrap.sh exited non-zero with unset admin password (must be defensive)"
grep -q "PGBOUNCER_ADMIN_PASSWORD unset" "$SANDBOX2/run.err" \
  || fail "bootstrap.sh did not warn on unset admin password (T-bootstrap-3)"
[ ! -s "$AUTH_FILE2" ] || fail "userlist.txt should remain empty when admin password unset (T-bootstrap-3)"
test -f "$SANDBOX2/entrypoint.out" \
  || fail "bootstrap.sh skipped entrypoint exec on unset admin password (T-bootstrap-3)"

# 4. AUTH_FILE that doesn't exist yet — bootstrap.sh creates it
#    (mirrors the upstream entrypoint's safety touch).
SANDBOX3=$(mktemp -d)
mkdir -p "$SANDBOX3/etc/pgbouncer"
AUTH_FILE3="$SANDBOX3/etc/pgbouncer/userlist.txt"  # does NOT exist
FAKE3="$SANDBOX3/entrypoint.sh"
cat >"$FAKE3" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$FAKE3"
COPY3="$SANDBOX3/bootstrap.sh"
sed "s|/entrypoint.sh|$FAKE3|g" "$SCRIPT" > "$COPY3"
chmod +x "$COPY3"
PGBOUNCER_ADMIN_PASSWORD=p AUTH_FILE="$AUTH_FILE3" "$COPY3" pgbouncer >/dev/null 2>&1 \
  || fail "bootstrap.sh failed on non-existent AUTH_FILE (T-bootstrap-4)"
test -f "$AUTH_FILE3" || fail "bootstrap.sh did not create missing AUTH_FILE (T-bootstrap-4)"
grep -q '^"pgbouncer_admin"' "$AUTH_FILE3" \
  || fail "bootstrap.sh did not append admin to freshly-created AUTH_FILE (T-bootstrap-4)"

# 5. Dockerfile shape — ENTRYPOINT points at bootstrap.sh, COPY brings it in.
grep -q 'ENTRYPOINT \["/usr/local/bin/bootstrap.sh"\]' "$DOCKERFILE" \
  || fail "Dockerfile ENTRYPOINT does not point at bootstrap.sh"
grep -q "COPY bootstrap.sh /usr/local/bin/bootstrap.sh" "$DOCKERFILE" \
  || fail "Dockerfile does not COPY bootstrap.sh into the image"

# Cleanup.
rm -rf "$SANDBOX" "$SANDBOX2" "$SANDBOX3"

echo "PASS: bootstrap.sh hermetic behaviour checks (5/5)"

# ---------------------------------------------------------------------------
# Layer B — live integration (opt-in)
# ---------------------------------------------------------------------------
if [ "${BOOTSTRAP_LIVE:-0}" != "1" ]; then
  echo "SKIP: BOOTSTRAP_LIVE not set — live SHOW POOLS check skipped (run with BOOTSTRAP_LIVE=1 to enable)"
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "BOOTSTRAP_LIVE=1 but docker is not installed"

(
  cd "$ROOT"
  PROJECT="bootstrap-test-$$"
  docker compose -p "$PROJECT" \
    -f docker-compose.yml -f docker-compose.load-test.yml \
    --profile load-test-mock \
    up -d --wait postgres pgbouncer
  trap 'docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock down >/dev/null 2>&1 || true' EXIT
  # Resolve the admin password from .env (load-test profile shares it).
  PWD_LINE=$(grep '^PGBOUNCER_ADMIN_PASSWORD=' .env 2>/dev/null | head -1)
  ADMIN_PWD="${PWD_LINE#PGBOUNCER_ADMIN_PASSWORD=}"
  [ -n "$ADMIN_PWD" ] || fail "PGBOUNCER_ADMIN_PASSWORD missing from .env"
  CID=$(docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-mock ps -q pgbouncer)
  [ -n "$CID" ] || fail "pgbouncer container not found"
  # Use PGPASSWORD; pgbouncer's special `pgbouncer` admin database serves SHOW POOLS.
  docker exec -e PGPASSWORD="$ADMIN_PWD" "$CID" \
    psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer -c "SHOW POOLS" >/tmp/show-pools.out 2>&1 \
    || fail "SHOW POOLS query failed: $(cat /tmp/show-pools.out)"
  grep -q "openwhispr_app" /tmp/show-pools.out \
    || fail "SHOW POOLS did not list openwhispr_app pool"
  echo "PASS: live SHOW POOLS returns rows under pgbouncer_admin"
)
