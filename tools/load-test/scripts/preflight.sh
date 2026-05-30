#!/usr/bin/env bash
# preflight.sh — operator safety gate for the Phase 8 load-test run.
#
# Phase 08 / Plan 05 / Task 3. Refuses to proceed unless the host meets
# the documented baseline so the live 1000-VU ramp does not OOM Docker
# Desktop / sysctl-kill the api / silently regress because of an already-
# bound mimir port (RESEARCH.md §Pitfall 1).
#
# Checks (any failure aborts with a clear stderr message):
#   1. Docker daemon is reachable (`docker info`).
#   2. Docker MemTotal >= 24 GB (under the 32 GB recommended floor with
#      enough headroom to absorb dataplane peaks).
#   3. k6 is on PATH OR docker is on PATH (docker fallback warns + proceeds).
#   4. Required load-test ports are FREE on the host: 9009 (mimir),
#      4000 (mock-litellm via docker-internal but the host port is
#      reserved for ad-hoc curls), 8000 (speaches), 80/443 (traefik).
#   5. Host fd limit headroom: `sysctl kern.maxfilesperproc` on darwin
#      OR `ulimit -Hn` on linux >= 65535 (the api/traefik containers
#      cannot raise nofile above the host hard cap).
#   6. Git tree is clean for docker-compose.yml + docker-compose.load-test.yml
#      so the run is reproducible from a known commit.
#
# Operator confirmation: --yes must be passed to acknowledge the load-test
# is destructive to the existing local stack (it will tear down the
# default compose project and re-create services).
#
# Exit codes:
#   0  -> all checks pass; safe to invoke `make load-test PROFILE=...`
#   1  -> at least one check failed; stderr describes the gap
#   2  -> usage error

set -uo pipefail

# RAM floor for a real load-test plateau is 24 GiB. The CI `load-smoke` job runs
# a ≤2-min mock-profile smoke (≤5 VU) on a ~16 GiB GitHub-hosted runner, which
# does not need plateau RAM — it sets PREFLIGHT_MIN_RAM_GIB to lower the floor
# for that scope only. Unset → 24 GiB default preserved (fix 260530-rqk).
REQUIRED_RAM_GIB="${PREFLIGHT_MIN_RAM_GIB:-24}"
REQUIRED_RAM_BYTES=$((REQUIRED_RAM_GIB * 1024 * 1024 * 1024))
REQUIRED_PORTS_TCP=(9009 4000 8000 80 443)
REQUIRED_FD_LIMIT=65535
TRACKED_COMPOSE_FILES=(docker-compose.yml compose/docker-compose.load-test.yml)

YES=0
VERBOSE=0
usage() {
  cat <<USAGE
preflight.sh — Phase 8 load-test preflight checks.

Usage:
  preflight.sh [--yes] [--verbose]
  preflight.sh --help

Options:
  --yes      Acknowledge the load-test run is host-destructive (REQUIRED).
  --verbose  Print each check result, not only failures.
  --help     Show this message.

Exit codes:
  0  all checks pass
  1  at least one check failed
  2  usage error
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --verbose) VERBOSE=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "preflight.sh: unknown flag '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

FAILS=0
WARNS=0
red()   { printf "\033[31m%s\033[0m" "$1"; }
green() { printf "\033[32m%s\033[0m" "$1"; }
yellow(){ printf "\033[33m%s\033[0m" "$1"; }

fail() { red "FAIL"; printf " %s\n" "$1" >&2; FAILS=$((FAILS+1)); }
warn() { yellow "WARN"; printf " %s\n" "$1"; WARNS=$((WARNS+1)); }
ok()   { if [ "$VERBOSE" -eq 1 ]; then green "OK"; printf "   %s\n" "$1"; fi; }
info() { printf "%s\n" "$1"; }

# --yes is the operator-confirmation gate.
if [ "$YES" -ne 1 ]; then
  echo "preflight.sh: must be invoked with --yes to acknowledge the load-test will tear down the local compose stack" >&2
  echo "(re-run as: tools/load-test/scripts/preflight.sh --yes)" >&2
  exit 1
fi

info "==> Phase 8 load-test preflight"

# ---- Check 1: docker daemon ----
if ! command -v docker >/dev/null 2>&1; then
  fail "docker is not on PATH; install Docker Desktop or Docker Engine."
else
  if ! docker info >/dev/null 2>&1; then
    fail "docker info failed; is the daemon running?"
  else
    ok "docker daemon reachable"
  fi
fi

# ---- Check 2: Docker MemTotal ----
# `docker info` prints "Total Memory: 24GiB" OR "MemTotal: <bytes>" depending
# on the API version. Parse both shapes; fall back to GB-numeric extraction.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  mem_raw="$(docker info 2>/dev/null | grep -iE "(total memory|memtotal)" | head -1 || true)"
  mem_bytes=0
  if echo "$mem_raw" | grep -qiE "memtotal:[[:space:]]*[0-9]+$"; then
    mem_bytes=$(echo "$mem_raw" | grep -oE "[0-9]+")
  elif echo "$mem_raw" | grep -qiE "[0-9.]+ ?gib"; then
    gib=$(echo "$mem_raw" | grep -oE "[0-9.]+" | head -1)
    mem_bytes=$(python3 -c "print(int(float('$gib') * (1024**3)))" 2>/dev/null || echo 0)
  elif echo "$mem_raw" | grep -qiE "[0-9.]+ ?gb"; then
    gb=$(echo "$mem_raw" | grep -oE "[0-9.]+" | head -1)
    mem_bytes=$(python3 -c "print(int(float('$gb') * (1000**3)))" 2>/dev/null || echo 0)
  fi
  if [ "$mem_bytes" -ge "$REQUIRED_RAM_BYTES" ] 2>/dev/null; then
    ok "Docker MemTotal=${mem_bytes} bytes >= ${REQUIRED_RAM_GIB} GiB"
  else
    fail "Docker MemTotal=${mem_bytes} bytes < ${REQUIRED_RAM_GIB} GiB floor (mem_raw: $mem_raw)"
  fi
fi

# ---- Check 3: k6 / docker fallback ----
if command -v k6 >/dev/null 2>&1; then
  ok "k6 binary: $(k6 version 2>/dev/null | head -1 || echo present)"
else
  if command -v docker >/dev/null 2>&1; then
    warn "k6 not on PATH; docker fallback (grafana/k6 image) will be used"
  else
    fail "neither k6 nor docker on PATH; install grafana/k6"
  fi
fi

# ---- Check 4: required load-test ports are free ----
# Probe for LISTEN sockets only — `lsof -i :PORT` without `-sTCP:LISTEN` also
# returns outbound ESTABLISHED rows (e.g. Telegram client -> remote:443) which
# do not occupy the local port for a server to bind. The `-nP` flags skip DNS +
# service-name resolution to keep the probe fast and deterministic.
# nc -z is the fallback when lsof is unavailable; nc only probes connectivity
# to localhost so it implicitly only triggers on LISTEN sockets.
for port in "${REQUIRED_PORTS_TCP[@]}"; do
  if command -v lsof >/dev/null 2>&1; then
    out=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$out" ]; then
      fail "port $port is already in use on the host (lsof output: $(echo "$out" | head -1))"
    else
      ok "port $port is free"
    fi
  elif command -v nc >/dev/null 2>&1; then
    if nc -z localhost "$port" 2>/dev/null; then
      fail "port $port is already in use on the host (nc -z localhost $port succeeded)"
    else
      ok "port $port is free (via nc)"
    fi
  else
    warn "neither lsof nor nc available; cannot probe port $port"
  fi
done

# ---- Check 5: host fd headroom ----
host_fd_limit=0
if command -v sysctl >/dev/null 2>&1; then
  raw=$(sysctl kern.maxfilesperproc 2>/dev/null || true)
  host_fd_limit=$(echo "$raw" | grep -oE "[0-9]+" | tail -1 || echo 0)
fi
if [ "$host_fd_limit" -lt "$REQUIRED_FD_LIMIT" ] 2>/dev/null; then
  # Linux fallback: ulimit -Hn
  hard=$(ulimit -Hn 2>/dev/null || echo 0)
  if [ "$hard" -ge "$REQUIRED_FD_LIMIT" ] 2>/dev/null; then
    ok "host fd hard limit=$hard >= $REQUIRED_FD_LIMIT"
  else
    fail "host fd limit=$host_fd_limit (sysctl) / $hard (ulimit -Hn) < $REQUIRED_FD_LIMIT; api/traefik ulimits cannot raise above this"
  fi
else
  ok "kern.maxfilesperproc=$host_fd_limit >= $REQUIRED_FD_LIMIT"
fi

# ---- Check 6: git tree clean for compose files ----
if command -v git >/dev/null 2>&1; then
  dirty=$(git status --porcelain -- "${TRACKED_COMPOSE_FILES[@]}" 2>/dev/null || true)
  if [ -n "$dirty" ]; then
    fail "uncommitted changes to compose files (clean tree required for reproducibility):"
    echo "$dirty" | sed 's/^/        /' >&2
  else
    ok "git tree clean for ${TRACKED_COMPOSE_FILES[*]}"
  fi
else
  warn "git not on PATH; cannot verify clean tree"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  green "preflight OK"
  printf " (warns: %d)\n" "$WARNS"
  exit 0
else
  red "preflight FAILED"
  printf " (%d failure(s), %d warn(s))\n" "$FAILS" "$WARNS" >&2
  exit 1
fi
