#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# Phase 11 / Plan 11-03c — Variant C bats smoke wrapper.
#
# Boots the Variant C compose overlay (embedded LiteLLM + local
# Speaches, built from upstream master per Phase 08.6) and runs the
# bats assertions in examples/test-local-speaches.bats to verify that
# `/v1/audio/transcriptions` via LiteLLM routes to Speaches and
# returns a 200 OK + non-empty transcript.
#
# Operator prerequisites:
#   1. bats installed (https://bats-core.readthedocs.io/en/stable/installation.html)
#        macOS: brew install bats-core
#        Debian/Ubuntu: apt install bats
#        Other: see the upstream installation docs
#   2. .env file with HF_TOKEN populated (gated pyannote weights).
#      cp .env.local-speaches.example .env first.
#   3. ~10 min + ~3 GB free disk for the first build (Speaches master
#      image build + Whisper + pyannote weight download). Subsequent
#      runs reuse the `openwhispr_speaches_models` named volume.
#   4. GPU strongly recommended for non-flaky timing. CPU works for a
#      one-shot pass but the assertions tolerate up to 120 s per call.
#
# Usage:
#   ./examples/test-local-speaches.sh
#
# Exit codes:
#   0  — bats assertions all pass; Variant C wiring is healthy
#   1  — at least one assertion failed or compose-up failed
#   2  — bats not installed
#   3  — .env missing or HF_TOKEN unset
#
# This script is operator-facing and ENVIRONMENTAL — it deliberately
# pulls real Docker images from GHCR + Hugging Face. CI runs are
# expected to fail without GPU + HF_TOKEN; the operator's runbook (see
# examples/README.md §"Quick start — Variant C") documents the
# expected ~10 min first-run wall time.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Pre-flight check 1: bats available.
if ! command -v bats >/dev/null 2>&1; then
  echo "ERROR: bats not installed. See https://bats-core.readthedocs.io/en/stable/installation.html"
  echo "  macOS: brew install bats-core"
  echo "  Debian/Ubuntu: apt install bats"
  exit 2
fi

# Pre-flight check 2: .env exists + HF_TOKEN set.
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  echo "ERROR: ${REPO_ROOT}/.env missing. Copy .env.local-speaches.example to .env and populate it."
  exit 3
fi
# shellcheck source=/dev/null
set -a
. "${REPO_ROOT}/.env"
set +a
if [[ -z "${HF_TOKEN:-}" || "${HF_TOKEN}" == "REPLACE_ME" ]]; then
  echo "ERROR: HF_TOKEN unset or still REPLACE_ME in .env."
  echo "  Request a token at https://huggingface.co/settings/tokens with read"
  echo "  access to pyannote/speaker-diarization-community-1."
  exit 3
fi

# Export for bats to consume.
export REPO_ROOT
export OPENWHISPR_API_URL="${OPENWHISPR_API_URL:-https://api.localhost}"

cd "${REPO_ROOT}"

# Hand off to bats. The .bats file owns the up/down lifecycle and the
# transcribe-round-trip assertion.
exec bats "${SCRIPT_DIR}/test-local-speaches.bats"
