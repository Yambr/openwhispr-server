#!/usr/bin/env bash
#
# setup-branch-protection.sh — Apply branch-protection rules to `main`.
#
# Operator-invoked post-fork (CI-03). Idempotent: re-running with the
# same input is safe and produces the same final state.
#
# Required env:
#   GITHUB_REPOSITORY   owner/repo (e.g. acme/openwhispr-server)
#   GITHUB_TOKEN        Personal access token / GH App token with
#                       admin:repo scope; consumed by `gh` via env.
#
# Usage:
#   GITHUB_REPOSITORY=acme/openwhispr-server \
#   GITHUB_TOKEN=ghp_xxx \
#     bash scripts/setup-branch-protection.sh
#
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set, e.g. owner/openwhispr-server}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN with admin:repo scope must be exported}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${SCRIPT_DIR}/branch-protection.json"

if [[ ! -f "${CONFIG}" ]]; then
  echo "ERROR: branch-protection.json not found at ${CONFIG}" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required. Install: https://cli.github.com/" >&2
  exit 1
fi

echo "Applying branch protection to ${GITHUB_REPOSITORY}:main from ${CONFIG}"
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "repos/${GITHUB_REPOSITORY}/branches/main/protection" \
  --input "${CONFIG}"

echo "Branch protection applied to ${GITHUB_REPOSITORY}:main"
