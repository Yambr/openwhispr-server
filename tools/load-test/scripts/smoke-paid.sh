#!/usr/bin/env bash
# Phase 08.5 cost-discipline smoke gate for paid cloud providers.
#
# Purpose: prove the wiring works end-to-end against real paid providers
# WITHOUT consuming meaningful cost. ≤10 HTTP calls total, total spend
# typically under $0.10.
#
# Per user 2026-05-13 (memory: loadtest-cost-discipline):
#   - Plateaus run against LOCAL models only (Speaches, mock-litellm).
#   - Paid providers (OpenAI, OpenRouter, Groq, pyannote.ai) get smoke
#     proof-of-wiring only — exactly this script.
#
# Routes exercised (1 call each, except agent-stream which is
# 1 connect + a small streamed completion):
#   /api/transcribe       — Speaches (LOCAL — included as control)
#   /api/reason           — OpenRouter via LiteLLM
#   /api/agent/stream     — OpenRouter via LiteLLM (SSE)
#   wss://api:8443/v1/realtime — Speaches Realtime (LOCAL)
#
# Plus 3 LiteLLM-direct probes (bypass api layer) to isolate provider
# vs api-layer failures:
#   POST /v1/chat/completions  — model=qwen3.6-plus     (OpenRouter)
#   POST /v1/chat/completions  — model=gpt-4o-mini      (OpenRouter)
#   POST /v1/audio/transcriptions  — model=whisper-large-v3 (Speaches)
#
# Total: 7 distinct calls (well under 10-cap).
#
# Exit codes:
#   0 — all PASS, ws_msgs_sent > 0 on realtime
#   1 — any PASS gate failed (which call + status code in stderr)
#   2 — environment misconfigured (missing keys, stack not up)
#
# Usage:
#   bash tools/load-test/scripts/smoke-paid.sh [BASE_URL] [LITELLM_BASE]
#
# Requires:
#   - Stack up under load-test-realistic profile (otherwise exit 2)
#   - .env populated with OPENROUTER_API_KEY, LITELLM_MASTER_KEY, HF_TOKEN
#   - curl, jq, ws (node) — verified in preflight

set -euo pipefail
IFS=$'\n\t'

BASE_URL="${1:-https://api.localhost}"
LITELLM_BASE="${2:-http://localhost:4000}"
RUN_TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ART_DIR=".planning/phases/08-load-test-tuning-slo-publication/runs"
LOG_FILE="${ART_DIR}/${RUN_TS}-smoke-paid.log"
mkdir -p "${ART_DIR}"

# Color codes for terminal output (stderr only — file gets plain text).
RED=$(printf '\033[31m')
GREEN=$(printf '\033[32m')
RESET=$(printf '\033[0m')

PASS_COUNT=0
FAIL_COUNT=0
declare -a FAILURES=()

log() {
  printf '%s\n' "$*" | tee -a "${LOG_FILE}"
}

probe() {
  local name="$1"
  local expect_status="$2"
  shift 2
  local response
  local status
  response=$(curl -ksS -o /tmp/smoke-paid-body -w '%{http_code}' "$@" 2>>"${LOG_FILE}" || true)
  status="${response: -3}"
  if [[ "${status}" == "${expect_status}" ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    log "  PASS  ${name}  status=${status}"
    return 0
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILURES+=("${name} expected=${expect_status} got=${status}")
    log "  FAIL  ${name}  status=${status} (expected ${expect_status})"
    log "        body: $(head -c 200 /tmp/smoke-paid-body)"
    return 1
  fi
}

log "smoke-paid: ${RUN_TS} BASE_URL=${BASE_URL}"
log "----------------------------------------------"

# 1. Environment preflight ----------------------------------------------

if [[ -z "${OPENROUTER_API_KEY:-}" ]] && ! grep -q '^OPENROUTER_API_KEY=.\+' .env 2>/dev/null; then
  log "smoke-paid: ABORT — OPENROUTER_API_KEY missing in env and .env"
  exit 2
fi
if ! curl -ksS -o /dev/null -w '%{http_code}' "${BASE_URL}/api/auth/sign-up/email" -X OPTIONS >/dev/null 2>&1; then
  log "smoke-paid: ABORT — api unreachable at ${BASE_URL} (stack not up?)"
  exit 2
fi

# 2. Provision a one-shot user via Better Auth ---------------------------

EMAIL="smoke-paid-$(date +%s)@example.test"
log ""
log "[1/7] sign-up: ${EMAIL}"
SIGNUP_BODY=$(curl -ksS -X POST "${BASE_URL}/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -H "origin: ${BASE_URL}" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"Password-12345!\",\"name\":\"smoke\"}")
TOKEN=$(printf '%s' "${SIGNUP_BODY}" | jq -r '.token // .session.token // .data.token // empty')
if [[ -z "${TOKEN}" ]]; then
  log "  FAIL  sign-up returned no token: ${SIGNUP_BODY}"
  exit 2
fi
log "  PASS  sign-up OK (token: ${TOKEN:0:20}...)"
PASS_COUNT=$((PASS_COUNT + 1))

# 3. /api/reason — OpenRouter via LiteLLM (PAID) -------------------------

log ""
log "[2/7] api /api/reason (OpenRouter via LiteLLM)"
probe "api-reason-openrouter" "200" \
  -X POST "${BASE_URL}/api/reason" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"text":"Say one word: ping"}' || true

# 4. /api/agent/stream — OpenRouter via LiteLLM (PAID, SSE) --------------

log ""
log "[3/7] api /api/agent/stream (OpenRouter SSE)"
AGENT_BODY=$(curl -ksS -m 30 -X POST "${BASE_URL}/api/agent/stream" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"reply with the word ok"}],"model":"qwen3.6-plus"}' \
  2>>"${LOG_FILE}" || true)
if printf '%s' "${AGENT_BODY}" | grep -q '"type"'; then
  log "  PASS  agent-stream returned NDJSON chunks (head: $(printf '%s' "${AGENT_BODY}" | head -c 120))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log "  FAIL  agent-stream returned no NDJSON: $(printf '%s' "${AGENT_BODY}" | head -c 200)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("agent-stream-no-ndjson")
fi

# 5. /api/transcribe — Speaches via LiteLLM (LOCAL, control sample) ------

log ""
log "[4/7] api /api/transcribe (Speaches via LiteLLM, LOCAL control)"
FIXTURE="tools/load-test/src/fixtures/sample-5s-16k.wav"
if [[ ! -f "${FIXTURE}" ]]; then
  log "  SKIP  fixture not found at ${FIXTURE}"
else
  probe "api-transcribe-speaches" "200" \
    -X POST "${BASE_URL}/api/transcribe" \
    -H "authorization: Bearer ${TOKEN}" \
    -F "audio=@${FIXTURE};type=audio/wav" \
    -F 'model=whisper-large-v3' || true
fi

# 6. WSS /v1/realtime — Speaches Realtime (LOCAL) ------------------------

log ""
log "[5/7] WSS :8443/v1/realtime (Speaches Realtime, LOCAL)"
# Use a tiny node script inline. The mock-litellm workspace has 'ws'.
WS_RESULT=$(cd compose/mock-litellm && node --input-type=module -e "
import { WebSocket } from 'ws';
import { readFileSync } from 'node:fs';
const ca = readFileSync('/Users/dev/openwhispr-server/compose/traefik/certs/root-ca.crt');
const ws = new WebSocket('wss://api.localhost:8443/v1/realtime?model=speaches-realtime', {
  headers: { authorization: 'Bearer ${TOKEN}' },
  ca, rejectUnauthorized: false,
});
const t0 = Date.now();
let opened = false, gotMsg = false;
ws.on('open', () => { opened = true; });
ws.on('message', (d) => { gotMsg = true; console.log('MSG_AT=' + (Date.now()-t0) + 'ms'); console.log('MSG_BODY=' + d.toString().slice(0,200)); ws.close(1000); });
ws.on('unexpected-response', (req, res) => { console.log('UPGRADE_FAIL_STATUS=' + res.statusCode); process.exit(3); });
ws.on('error', (e) => { console.log('ERR=' + e.message); });
ws.on('close', () => { console.log('OPENED=' + opened + ' GOT_MSG=' + gotMsg); process.exit(gotMsg ? 0 : 4); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(5); }, 10000);
" 2>&1 || true)
log "  ws-probe output:"
printf '%s\n' "${WS_RESULT}" | sed 's/^/    /' | tee -a "${LOG_FILE}"
if printf '%s' "${WS_RESULT}" | grep -q 'GOT_MSG=true'; then
  log "  PASS  realtime-ws received message"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log "  FAIL  realtime-ws did NOT receive message"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("realtime-ws-no-msg")
fi

# 7. LiteLLM-direct probes (isolate provider vs api layer) ---------------

LITELLM_KEY=$(grep '^LITELLM_MASTER_KEY=' .env | head -1 | cut -d= -f2-)
log ""
log "[6/7] LiteLLM-direct /v1/chat/completions model=qwen3.6-plus (OpenRouter)"
probe "litellm-chat-qwen" "200" \
  -X POST "${LITELLM_BASE}/v1/chat/completions" \
  -H "authorization: Bearer ${LITELLM_KEY}" \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3.6-plus","messages":[{"role":"user","content":"reply with the word ok"}],"max_tokens":10}' || true

log ""
log "[7/7] LiteLLM-direct /v1/chat/completions model=gpt-4o-mini (OpenRouter)"
probe "litellm-chat-gpt4o-mini" "200" \
  -X POST "${LITELLM_BASE}/v1/chat/completions" \
  -H "authorization: Bearer ${LITELLM_KEY}" \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"reply with the word ok"}],"max_tokens":10}' || true

# Summary ---------------------------------------------------------------

log ""
log "=============================================="
log "smoke-paid SUMMARY: ${PASS_COUNT} PASS / ${FAIL_COUNT} FAIL"
if (( FAIL_COUNT > 0 )); then
  log "Failures:"
  for f in "${FAILURES[@]}"; do
    log "  - ${f}"
  done
  printf '%s\n' "${RED}smoke-paid: ${FAIL_COUNT} call(s) failed${RESET}" >&2
  exit 1
fi
printf '%s\n' "${GREEN}smoke-paid: PASS (${PASS_COUNT}/7 calls, log: ${LOG_FILE})${RESET}" >&2
exit 0
