#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# scripts/seed-keycloak-realm.sh — Phase 69 / Plan 69-05 (SSO-IMPL-05a).
#
# Imports the test realm `acme` into a running Keycloak 26 fixture via the
# Keycloak Admin REST API, AFTER the container is healthy. This is the
# load-bearing realm-path-separation trick (69-RESEARCH Pitfall 1):
#
#   - The realm JSON lives in compose/test/keycloak-realms/ (a SEPARATE
#     dir that is NOT bind-mounted into the container).
#   - The mounted ./compose/test/keycloak/ import dir stays EMPTY (only
#     .gitkeep), so scenario @cjm-sso-1.6 (loud-fail on an empty realm
#     import dir) still observes an empty dir.
#   - The realm is loaded at runtime over HTTP via POST /admin/realms,
#     not file-imported by `start-dev --import-realm`.
#
# Idempotent: a 409 (realm already exists) is treated as success so a
# re-seed against an already-provisioned container is a no-op.
#
# Environment (all test-only; LOCKER-03 allows localhost/admin literals in
# scripts/):
#   KC_URL            Base URL of the Keycloak instance
#                     (default http://127.0.0.1:8089).
#   KC_ADMIN_USER     Bootstrap admin username (default admin).
#   KC_ADMIN_PASSWORD Bootstrap admin password (default admin). Read from
#                     the environment and passed to curl ONLY via --data
#                     urlencode fields — NEVER interpolated into a command
#                     string (LOCKER-06). Callers invoking this from TS use
#                     argv-array spawn(shell:false) with the secret in env.
#   KC_REALM_FILE     Path to the realm JSON to import
#                     (default compose/test/keycloak-realms/realm-openwhispr-test.json).
#
# Exit codes:
#   0   — realm imported (201) or already present (409).
#   2   — KC_REALM_FILE missing / not readable.
#   3   — invalid KC_URL (failed the input-safety regex).
#   4   — token acquisition failed.
#   5   — realm import returned an unexpected HTTP status.
#   127 — required CLI (curl / jq) not found.
#
# Bash 3.2 compatible (macOS system bash): no `declare -A`, no `mapfile`.
# Uses `set -uo pipefail` (NOT `set -e`) so we can map failures to the
# documented exit codes instead of aborting on the first non-zero command.

set -uo pipefail

KC_URL="${KC_URL:-http://127.0.0.1:8089}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-admin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KC_REALM_FILE="${KC_REALM_FILE:-${SCRIPT_DIR}/../compose/test/keycloak-realms/realm-openwhispr-test.json}"

if ! command -v curl >/dev/null 2>&1; then
  echo "seed-keycloak-realm: curl CLI not found in PATH" >&2
  exit 127
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "seed-keycloak-realm: jq CLI not found in PATH" >&2
  exit 127
fi

if [[ ! -r "$KC_REALM_FILE" ]]; then
  echo "seed-keycloak-realm: realm file not readable: $KC_REALM_FILE" >&2
  exit 2
fi

# Input-safety guard (T-69 defence-in-depth): the base URL is later passed
# as a curl argument. Although curl is invoked via execve (no shell), a
# crafted URL with shell metacharacters could be dangerous if a future
# caller wrapped this in `eval`/`sh -c`. Restrict to the URL character set.
if ! [[ "$KC_URL" =~ ^https?://[a-zA-Z0-9._:/-]+$ ]]; then
  echo "seed-keycloak-realm: refusing unsafe KC_URL (failed safety regex)" >&2
  exit 3
fi

# 1) Acquire an admin token. The admin username/password cross into curl
#    ONLY via --data-urlencode fields sourced from the environment — they
#    are NEVER concatenated into a command string (LOCKER-06). curl reads
#    the env-backed shell variables as discrete argv entries.
TOKEN_ENDPOINT="${KC_URL}/realms/master/protocol/openid-connect/token"
token_response="$(
  curl -sS \
    --data-urlencode "client_id=admin-cli" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "username=${KC_ADMIN_USER}" \
    --data-urlencode "password=${KC_ADMIN_PASSWORD}" \
    "$TOKEN_ENDPOINT"
)"
token_rc=$?
if [[ $token_rc -ne 0 ]]; then
  echo "seed-keycloak-realm: token request failed (curl rc=$token_rc)" >&2
  exit 4
fi

access_token="$(printf '%s' "$token_response" | jq -r '.access_token // empty')"
if [[ -z "$access_token" ]]; then
  # Do NOT echo the response body — it may carry sensitive material.
  echo "seed-keycloak-realm: no access_token in token response" >&2
  exit 4
fi

# 2) Import the realm. POST the JSON to /admin/realms with the Bearer token.
#    The Authorization header value is built from the token variable as a
#    discrete argv entry, not an interpolated command string.
IMPORT_ENDPOINT="${KC_URL}/admin/realms"
http_status="$(
  curl -sS -o /dev/null -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${access_token}" \
    -H "Content-Type: application/json" \
    --data-binary "@${KC_REALM_FILE}" \
    "$IMPORT_ENDPOINT"
)"
import_rc=$?
if [[ $import_rc -ne 0 ]]; then
  echo "seed-keycloak-realm: import request failed (curl rc=$import_rc)" >&2
  exit 5
fi

case "$http_status" in
  201)
    echo "seed-keycloak-realm: realm imported (HTTP 201)"
    exit 0
    ;;
  409)
    echo "seed-keycloak-realm: realm already exists (HTTP 409) — idempotent no-op"
    exit 0
    ;;
  *)
    echo "seed-keycloak-realm: unexpected import status HTTP $http_status" >&2
    exit 5
    ;;
esac
