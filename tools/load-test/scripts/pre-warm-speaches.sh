#!/bin/sh
# Phase 08 / Plan 06 — Task 5: Speaches pre-warm.
# Phase 08.5-01 / Task 4: extended with `--strict` mode (08.5-RESEARCH §G7 / §P12).
#
# RESEARCH.md §Pitfall 10: Whisper-large-v3 takes ~30-90 s to load on
# the first request after Speaches boots. If we do not warm the model
# before the k6 run starts, the entire 5-minute ramp window absorbs the
# cold-start latency and the SLO numbers are unrepresentative.
#
# Approach: copy the WAV fixture into the speaches container and POST
# it to /v1/audio/transcriptions. Wait for the response. Whisper now
# has the weights resident; subsequent k6 iterations see warm latency.
#
# Default (no flag): tolerant — failed warm-up logs a warning and exits 0
# so Phase 08 callers (mock-only profile) are unaffected.
#
# --strict (or LOADTEST_PROFILE=realistic): fail-fast.
#   * Missing speaches container -> exit 1 (no silent skip).
#   * Transcribe warm failure -> exit 1.
#   * Preloaded model dirs absent from the HF cache -> exit 1.
# Use this under the realistic profile so smoke gate iter-0 doesn't
# absorb a cold-start (08.5-RESEARCH §P12 / Pre-warm strategy).

set -eu

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
  esac
done
# Auto-strict when the orchestrator (run.sh) marks the profile as
# realistic. Keeps run.sh's invocation simple — no explicit flag needed.
if [ "${LOADTEST_PROFILE:-}" = "realistic" ]; then
  STRICT=1
fi

# Helper: under strict mode, abort with non-zero. Under default, warn
# and exit 0 (back-compat with Phase 08 callers).
_bail() {
  msg="$1"
  if [ "$STRICT" -eq 1 ]; then
    printf '[pre-warm] FAIL (strict) — %s\n' "$msg" >&2
    exit 1
  fi
  printf '[pre-warm] WARN — %s\n' "$msg" >&2
  exit 0
}

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURE="$ROOT/tools/load-test/src/fixtures/sample-5s-16k.wav"
test -s "$FIXTURE" || { echo "[pre-warm] FAILED — fixture missing: $FIXTURE" >&2; exit 1; }

echo "[pre-warm] copying fixture into speaches container..."
COMPOSE="docker compose -f docker-compose.yml -f compose/docker-compose.load-test.yml --profile load-test-realistic"

# Copy via stdin into a known path inside the container, then curl
# locally. `docker compose cp` is the portable form; falls back to
# `docker cp` against the resolved container name if needed.
CONTAINER=$($COMPOSE ps -q speaches 2>/dev/null || true)
if [ -z "$CONTAINER" ]; then
  _bail "speaches container not running"
fi

docker cp "$FIXTURE" "$CONTAINER:/tmp/warm.wav" \
  || _bail "docker cp failed"

echo "[pre-warm] sending one transcription to load Whisper weights..."
if ! $COMPOSE exec -T speaches sh -c '
  curl -fsS \
    -F "file=@/tmp/warm.wav;type=audio/wav" \
    -F "model=Systran/faster-whisper-large-v3" \
    -F "language=en" \
    http://localhost:8000/v1/audio/transcriptions
'; then
  _bail "transcription request failed"
fi

# Strict mode: also assert PRELOAD_MODELS landed both expected model
# directories under the HF cache. Without these the pre-warm above
# might have succeeded against a partially loaded Whisper while the
# pyannote weights silently failed to materialise.
if [ "$STRICT" -eq 1 ]; then
  echo "[pre-warm] strict — checking HF model dirs are resident..."
  HUB_LIST=$($COMPOSE exec -T speaches sh -c \
    'ls /home/ubuntu/.cache/huggingface/hub/ 2>/dev/null || true')
  if ! printf '%s' "$HUB_LIST" | grep -q 'models--Systran--faster-whisper-large-v3'; then
    _bail "Whisper-large-v3 model dir missing from HF cache (PRELOAD_MODELS did not land)"
  fi
  if ! printf '%s' "$HUB_LIST" | grep -q 'models--pyannote--speaker-diarization-community-1'; then
    _bail "pyannote community-1 model dir missing from HF cache (PRELOAD_MODELS did not land or HF_TOKEN missing)"
  fi
  echo "[pre-warm] strict — both preloaded model dirs present"
fi

echo "[pre-warm] OK — Whisper model now resident"
