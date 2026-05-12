#!/usr/bin/env bash
# Phase 08 / Plan 02 — Task 3 RED: tests for verify-compose.sh.
#
# verify-compose.sh validates a compose profile via
# `docker compose --profile <name> config --quiet`. Wave 1 (plan 05) adds
# the `load-test-mock` and `load-test-realistic` profiles. Wave 0 ships
# argument-parsing only — happy-path validation lands when Wave 1 does.
#
# To keep these tests hermetic, we stub `docker` on $PATH so we can
# assert the *arguments* the script forwards, not the live exit of
# `docker compose config`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${HERE}/verify-compose.sh"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

_pass() { PASS=$((PASS + 1)); printf '  ok %s\n' "$1"; }
_fail() { FAIL=$((FAIL + 1)); printf '  NOT OK %s\n' "$1" >&2; }

# Stub docker on PATH so the script never touches the real daemon.
mkdir -p "${TMP}/bin"
cat > "${TMP}/bin/docker" <<'STUB'
#!/usr/bin/env bash
# Echo every argument we received so the test can assert call shape.
printf '%s\n' "$@" >> "${DOCKER_STUB_LOG}"
exit 0
STUB
chmod +x "${TMP}/bin/docker"
export DOCKER_STUB_LOG="${TMP}/docker.log"

echo "verify-compose.sh tests"

# Test 1: no arg -> usage + exit 1.
: > "${DOCKER_STUB_LOG}"
set +e
out="$(PATH="${TMP}/bin:${PATH}" "$SCRIPT" 2>&1)"
rc=$?
set -e
if [[ $rc -eq 1 && "$out" == *usage* ]]; then
  _pass "no arg -> usage + exit 1"
else
  _fail "no arg should exit 1 with usage, got rc=$rc out=$out"
fi

# Test 2: unknown profile -> exit 1, stderr contains the profile name.
: > "${DOCKER_STUB_LOG}"
set +e
out="$(PATH="${TMP}/bin:${PATH}" "$SCRIPT" gibberish-profile 2>&1)"
rc=$?
set -e
if [[ $rc -eq 1 && "$out" == *gibberish-profile* ]]; then
  _pass "unknown profile -> exit 1 with offending name on stderr"
else
  _fail "unknown profile should exit 1 mentioning name, got rc=$rc out=$out"
fi

# Test 3: known profile -> invokes `docker compose --profile <name> config --quiet`.
: > "${DOCKER_STUB_LOG}"
set +e
PATH="${TMP}/bin:${PATH}" "$SCRIPT" load-test-mock >/dev/null 2>&1
rc=$?
set -e
log_content="$(cat "${DOCKER_STUB_LOG}")"
if [[ $rc -eq 0 \
  && "$log_content" == *compose* \
  && "$log_content" == *--profile* \
  && "$log_content" == *load-test-mock* \
  && "$log_content" == *config* \
  && "$log_content" == *--quiet* ]]; then
  _pass "happy path -> docker compose --profile load-test-mock config --quiet"
else
  _fail "happy path should forward correct docker args, got rc=$rc log=$log_content"
fi

# Test 4: script declares `set -euo pipefail`.
if grep -q 'set -euo pipefail' "$SCRIPT"; then
  _pass "verify-compose.sh declares set -euo pipefail"
else
  _fail "verify-compose.sh missing 'set -euo pipefail'"
fi

# ---------------------------------------------------------------
# Phase 08.5-01 Task 1 — RED cases for the third compose overlay
# (docker-compose.load-test.realistic.yml). These run real
# `docker compose config` (no daemon required) and grep the rendered
# output. Until Task 2/3 land, the overlay file does not exist and the
# rendered config shows the mock-litellm image under realistic.
# ---------------------------------------------------------------
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
if command -v docker >/dev/null 2>&1; then
  cd "$ROOT"
  RENDER_LOG="$TMP/render.yaml"
  set +e
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.load-test.yml \
    -f docker-compose.load-test.realistic.yml \
    --profile load-test-realistic config >"$RENDER_LOG" 2>&1
  render_rc=$?
  set -e

  # T5: third-overlay file must exist and render must succeed.
  if [ $render_rc -eq 0 ]; then
    _pass "realistic 3-file overlay renders successfully"
  else
    _fail "realistic 3-file overlay render failed (rc=$render_rc): $(head -3 "$RENDER_LOG")"
  fi

  # T6: real LiteLLM image under realistic — not the mock.
  if grep -E "image: ghcr\.io/berriai/litellm:main-v1\.83\.14-stable" "$RENDER_LOG" >/dev/null 2>&1; then
    _pass "realistic overlay selects real LiteLLM image"
  else
    _fail "realistic overlay missing real LiteLLM image (saw: $(grep -E 'image:.*litellm' "$RENDER_LOG" | head -3))"
  fi

  # T7: mock image MUST NOT appear in the realistic-only render.
  if ! grep -F "openwhispr-mock-litellm" "$RENDER_LOG" >/dev/null 2>&1; then
    _pass "realistic overlay excludes the mock-litellm image"
  else
    _fail "realistic overlay still selects mock-litellm: $(grep -F 'mock-litellm' "$RENDER_LOG" | head -2)"
  fi

  # T8: realistic config file is mounted into the litellm container.
  if grep -F "litellm_config.realistic.yaml" "$RENDER_LOG" >/dev/null 2>&1; then
    _pass "realistic overlay mounts litellm_config.realistic.yaml"
  else
    _fail "realistic overlay missing litellm_config.realistic.yaml mount"
  fi

  # T9: Speaches PRELOAD_MODELS env contains both expected model ids.
  if grep -E "PRELOAD_MODELS.*Systran/faster-whisper-large-v3" "$RENDER_LOG" >/dev/null 2>&1 \
    && grep -E "PRELOAD_MODELS.*pyannote/speaker-diarization-community-1" "$RENDER_LOG" >/dev/null 2>&1; then
    _pass "speaches.PRELOAD_MODELS includes whisper + pyannote ids"
  else
    _fail "speaches.PRELOAD_MODELS missing one or both model ids"
  fi

  # T10: Speaches HF cache mount targets /home/ubuntu/.cache/huggingface
  # (NOT /root/.cache/huggingface — latest-cpu runs as ubuntu).
  if grep -E "target:\s*/home/ubuntu/\.cache/huggingface" "$RENDER_LOG" >/dev/null 2>&1 \
    || grep -E ":/home/ubuntu/\.cache/huggingface" "$RENDER_LOG" >/dev/null 2>&1; then
    _pass "speaches HF cache mount targets /home/ubuntu/.cache/huggingface"
  else
    _fail "speaches HF cache mount NOT at /home/ubuntu/.cache/huggingface"
  fi

  # T11: legacy /root/.cache/huggingface mount must be gone.
  if ! grep -E ":/root/\.cache/huggingface" "$RENDER_LOG" >/dev/null 2>&1 \
    && ! grep -E "target:\s*/root/\.cache/huggingface" "$RENDER_LOG" >/dev/null 2>&1; then
    _pass "speaches no longer mounts to /root/.cache/huggingface"
  else
    _fail "speaches still mounts the wrong /root/.cache/huggingface path"
  fi
else
  echo "  SKIP — docker CLI not available, skipping realistic-overlay render cases"
fi

echo "verify-compose: ${PASS} pass / ${FAIL} fail"
[[ $FAIL -eq 0 ]]
