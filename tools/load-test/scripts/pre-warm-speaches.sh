#!/bin/sh
# Phase 08 / Plan 06 — Task 5: Speaches pre-warm.
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
# The script is intentionally tolerant: a failed warm-up logs a warning
# but does not abort the run. The plan-07 verification step will catch
# any actual outages via the run's metrics.

set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURE="$ROOT/tools/load-test/src/fixtures/sample-5s-16k.wav"
test -s "$FIXTURE" || { echo "[pre-warm] FAILED — fixture missing: $FIXTURE" >&2; exit 1; }

echo "[pre-warm] copying fixture into speaches container..."
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.load-test.yml --profile load-test-realistic"

# Copy via stdin into a known path inside the container, then curl
# locally. `docker compose cp` is the portable form; falls back to
# `docker cp` against the resolved container name if needed.
CONTAINER=$($COMPOSE ps -q speaches 2>/dev/null || true)
if [ -z "$CONTAINER" ]; then
  echo "[pre-warm] WARN — speaches container not running; skipping warm-up" >&2
  exit 0
fi

docker cp "$FIXTURE" "$CONTAINER:/tmp/warm.wav" \
  || { echo "[pre-warm] WARN — docker cp failed; skipping" >&2; exit 0; }

echo "[pre-warm] sending one transcription to load Whisper weights..."
$COMPOSE exec -T speaches sh -c '
  curl -fsS \
    -F "file=@/tmp/warm.wav;type=audio/wav" \
    -F "model=Systran/faster-whisper-large-v3" \
    -F "language=en" \
    http://localhost:8000/v1/audio/transcriptions
' || {
  echo "[pre-warm] WARN — transcription request failed; proceeding anyway" >&2
  exit 0
}

echo "[pre-warm] OK — Whisper model now resident"
