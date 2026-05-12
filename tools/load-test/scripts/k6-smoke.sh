#!/bin/sh
# Phase 08.1-followup — k6 smoke gate.
#
# Runs a 30-second low-VU sanity check against the live api stack before
# the 30-minute plateau in run.sh. Catches:
#   * Host-object mutation (Plan 08.1-followup root cause — the bug this
#     gate is designed to catch).
#   * Module-resolution failures (missing bundle externals, etc).
#   * Schema / header regressions that 100% the error rate from iter 0.
#   * Env misconfiguration (BASE_URL, TLS, profile).
#
# Failure semantics: any of these abort the gate (and therefore run.sh):
#   1. k6 exit code non-zero (threshold breach or runtime error).
#   2. stderr/stdout contains `TypeError` or `panic:`.
#   3. stderr/stdout contains `Cannot assign to property` (the literal
#      goja host-object-mutation TypeError).
#   4. ws_msgs_sent == 0 or ws_msgs_received == 0 for realtime-ws
#      (Phase 08.4 regression class — k6 client dropped the auth header
#      so the upgrade was 401-rejected and `open` never fired, leaving
#      ws_sessions populated but zero frames round-tripped). Catches
#      the next instance of this class in 30 seconds instead of after
#      a 30-minute plateau.
#
# Usage: tools/load-test/scripts/k6-smoke.sh [BASE_URL]
#   BASE_URL defaults to https://api.localhost
#
# Env vars:
#   SMOKE_VUS       — VU count (default 5)
#   SMOKE_DURATION  — k6 duration (default 30s)
#   SMOKE_USERS     — pre-provisioned users (default 5)
#   SMOKE_LOG       — output log path (default RUN_DIR/.../<stamp>-smoke.log)

set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

BUNDLE="tools/load-test/dist/smoke.js"
if [ ! -f "$BUNDLE" ]; then
  printf 'k6-smoke: bundle %s missing — run `pnpm --filter @openwhispr/load-test build` first\n' \
    "$BUNDLE" >&2
  exit 2
fi

RUN_DIR=".planning/phases/08-load-test-tuning-slo-publication/runs"
mkdir -p "$RUN_DIR"
STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DEFAULT_LOG="$RUN_DIR/${STAMP}-smoke.log"
SMOKE_LOG="${SMOKE_LOG:-$DEFAULT_LOG}"

export SMOKE_VUS="${SMOKE_VUS:-5}"
export SMOKE_DURATION="${SMOKE_DURATION:-30s}"
export SMOKE_USERS="${SMOKE_USERS:-5}"
export K6_INSECURE_SKIP_TLS_VERIFY=true

printf 'k6-smoke: vus=%s duration=%s users=%s → %s\n' \
  "$SMOKE_VUS" "$SMOKE_DURATION" "$SMOKE_USERS" "$SMOKE_LOG" >&2

# Run k6 — capture both stdout and stderr to the same log so error-string
# matching catches messages from either channel.
set +e
k6 run --linger=false "$BUNDLE" >"$SMOKE_LOG" 2>&1
K6_EXIT=$?
set -e

# Behaviour-classification: parse the captured log for hard-failure
# markers. These take precedence over the exit code so even a threshold
# breach with a hidden TypeError is reported correctly.
FAIL_REASON=""
if grep -F "Cannot assign to property" "$SMOKE_LOG" >/dev/null 2>&1; then
  FAIL_REASON="host-object mutation TypeError (Plan 08.1-followup regression)"
elif grep -E "^.*TypeError:" "$SMOKE_LOG" >/dev/null 2>&1; then
  FAIL_REASON="TypeError in k6 script"
elif grep -F "panic:" "$SMOKE_LOG" >/dev/null 2>&1; then
  FAIL_REASON="goja/k6 panic"
elif [ "$K6_EXIT" -ne 0 ]; then
  FAIL_REASON="k6 exit=$K6_EXIT (threshold breach or runtime error)"
else
  # Phase 08.4 regression gate — only checked when k6 itself exited 0
  # (otherwise the prior branches own the failure classification).
  #
  # Trigger only when the smoke run actually exercised the realtime-ws
  # path: presence of `ws_sessions` or `realtime-ws` in the log. If the
  # smoke profile didn't include WS at all (future variant), do not
  # require ws_msgs lines.
  if grep -E "ws_sessions|realtime-ws" "$SMOKE_LOG" >/dev/null 2>&1; then
    # (a) ws_msgs_sent absent entirely → upgrade failed at handshake,
    # `open` never fired, no send() ever ran. Run 4 footprint.
    if ! grep -E "ws_msgs_sent" "$SMOKE_LOG" >/dev/null 2>&1; then
      FAIL_REASON="ws_msgs_sent line missing — no WS frames sent (Phase 08.4 regression: realtime-ws upgrade likely auth-rejected)"
    # (b) ws_msgs_sent present but explicit zero (e.g. `ws_msgs_sent: 0 0/s`).
    elif grep -E "ws_msgs_sent[^:]*:[[:space:]]+0[[:space:]]" "$SMOKE_LOG" >/dev/null 2>&1; then
      FAIL_REASON="ws_msgs_sent == 0 — no WS frames sent (Phase 08.4 regression: realtime-ws upgrade likely auth-rejected)"
    # (c) ws_msgs_received absent → upstream echo never reached client.
    elif ! grep -E "ws_msgs_received" "$SMOKE_LOG" >/dev/null 2>&1; then
      FAIL_REASON="ws_msgs_received line missing — no WS frames received (Phase 08.4 regression class)"
    # (d) ws_msgs_received present but explicit zero.
    elif grep -E "ws_msgs_received[^:]*:[[:space:]]+0[[:space:]]" "$SMOKE_LOG" >/dev/null 2>&1; then
      FAIL_REASON="ws_msgs_received == 0 — no WS frames received (Phase 08.4 regression class)"
    fi
  fi
fi

if [ -n "$FAIL_REASON" ]; then
  printf 'k6-smoke: FAIL — %s\n' "$FAIL_REASON" >&2
  printf 'k6-smoke: log preserved at %s\n' "$SMOKE_LOG" >&2
  # Dump last 40 lines so the operator sees the failure inline.
  tail -n 40 "$SMOKE_LOG" >&2 || true
  exit 1
fi

printf 'k6-smoke: PASS (vus=%s duration=%s)\n' "$SMOKE_VUS" "$SMOKE_DURATION" >&2
exit 0
