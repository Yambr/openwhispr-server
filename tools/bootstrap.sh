#!/usr/bin/env bash
# tools/bootstrap.sh — idempotent secret generator + refuse-to-start gate.
#
# Reads .env.example for the canonical key list, .env for current values,
# generates random replacements for missing or placeholder values, and
# aborts with the offending KEY name if any current value matches the
# deny-list at tools/bootstrap/default-secrets.txt.
#
# Idempotency rule (per RESEARCH-TOOLING Pitfall 1): a key's current value
# is regenerated only if empty or exactly equal to the .env.example
# placeholder for the same key. Operator-set production values are never
# overwritten. A second invocation on the same .env produces the same
# values byte-for-byte.
#
# Self-test integration (per RESEARCH-TOOLING Pitfall 7): if the
# environment variable BOOTSTRAP_REPO_ROOT is set, that path is used as
# the repo root instead of the script's parent directory. This lets
# tests/self-tests/refuse-default-secrets.test.ts run against a
# mkdtempSync directory without clobbering the real repo .env.
#
# Exit codes:
#   0 — .env written or already up-to-date
#   1 — at least one current value matched the deny-list
#   2 — internal error (bash too old, missing .env.example, openssl
#       unavailable, deny-list missing, ...)

set -euo pipefail

# Bash 4+ guard. macOS ships bash 3.2; the associative arrays below
# require bash >= 4.
if (( ${BASH_VERSINFO[0]} < 4 )); then
  echo "bootstrap: bash >= 4 required (current: ${BASH_VERSION})." >&2
  echo "  macOS: brew install bash && hash -r" >&2
  exit 2
fi

REPO_ROOT="${BOOTSTRAP_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
readonly REPO_ROOT
readonly ENV_EXAMPLE="${REPO_ROOT}/.env.example"
readonly ENV_FILE="${REPO_ROOT}/.env"
readonly DENY_LIST="${REPO_ROOT}/tools/bootstrap/default-secrets.txt"

if [[ ! -f "${ENV_EXAMPLE}" ]]; then
  echo "bootstrap: .env.example not found at ${ENV_EXAMPLE}" >&2
  exit 2
fi
if [[ ! -f "${DENY_LIST}" ]]; then
  echo "bootstrap: deny-list not found at ${DENY_LIST}" >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "bootstrap: openssl not found in PATH" >&2
  exit 2
fi

# Deny-list: strip blank lines and # comments. mapfile requires bash >= 4.
mapfile -t DENY_VALUES < <(grep -vE '^[[:space:]]*(#|$)' "${DENY_LIST}" || true)

# Random secret generator: base64url, 43 chars (32 bytes of entropy).
gen_secret() {
  openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'
}

# Special-cased generator for BACKUP_AGE_IDENTITY: prefer age-keygen so the
# value is a real X25519 identity usable by the age CLI. Fall back to
# openssl + a one-line stderr warning when age is not installed.
gen_age_identity() {
  if command -v age-keygen >/dev/null 2>&1; then
    age-keygen 2>/dev/null | grep '^AGE-SECRET-KEY-' | head -n 1
  else
    echo "bootstrap: age-keygen not found; using openssl fallback for BACKUP_AGE_IDENTITY." >&2
    echo "  Install age and re-run bootstrap before configuring backup/restore." >&2
    gen_secret
  fi
}

# Read existing .env values (if any) into an associative array.
declare -A CURRENT
if [[ -f "${ENV_FILE}" ]]; then
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    line="${raw_line%$'\r'}"
    [[ -z "${line}" ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    if [[ "${line}" == *=* ]]; then
      key="${line%%=*}"
      value="${line#*=}"
      CURRENT["${key}"]="${value}"
    fi
  done < "${ENV_FILE}"
fi

# Walk .env.example for the canonical key list, deciding regenerate vs
# preserve per key. The ordered KEYS array preserves the order of
# .env.example so the generated .env reads in the same sequence.
declare -a KEYS=()
declare -A EXAMPLE
declare -A RESULT
declare -a OFFENDERS=()
declare -i GENERATED=0
declare -i PRESERVED=0

while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
  line="${raw_line%$'\r'}"
  [[ -z "${line}" ]] && continue
  [[ "${line}" =~ ^[[:space:]]*# ]] && continue
  if [[ ! "${line}" =~ ^[A-Z_][A-Z0-9_]*= ]]; then
    continue
  fi
  key="${line%%=*}"
  example_value="${line#*=}"
  KEYS+=("${key}")
  EXAMPLE["${key}"]="${example_value}"
done < "${ENV_EXAMPLE}"

# Phase 1: deny-list check on every CURRENT value, before any write. Only
# values actually present in .env are checked; an unset key is handled by
# the generation phase, not here.
for key in "${KEYS[@]}"; do
  current="${CURRENT[${key}]:-}"
  [[ -z "${current}" ]] && continue
  for bad in "${DENY_VALUES[@]}"; do
    if [[ "${current}" == "${bad}" ]]; then
      OFFENDERS+=("${key}")
      break
    fi
  done
done

if (( ${#OFFENDERS[@]} > 0 )); then
  echo "bootstrap: refusing to write .env — offending keys with deny-list values:" >&2
  for k in "${OFFENDERS[@]}"; do
    echo "  ${k}" >&2
  done
  exit 1
fi

# Phase 2: decide regenerate vs preserve per key.
#
# Phase 01.2 — composite values containing `${OTHER_KEY}` placeholders are
# interpolated against the running RESULT map instead of being treated as
# secret-generation candidates. This is required for compose env-vars like
# DATABASE_URL=postgres://user:${POSTGRES_APP_PASSWORD}@host/db whose
# correct value is a structured connection string built from earlier-
# generated secrets, NOT a random opaque token. Iteration over KEYS in
# .env.example order guarantees the referenced secrets are already in
# RESULT by the time the composite key is processed.
contains_placeholder() {
  [[ "${1}" == *'${'*'}'* ]]
}

interpolate() {
  # Replace every ${KEY} reference in $1 with RESULT[KEY]. Unknown keys
  # are left literally so the operator notices the misconfiguration in
  # the written .env (better than a silent empty substitution).
  local template="${1}"
  local result="${template}"
  local ref ref_key ref_value
  while [[ "${result}" =~ \$\{([A-Z_][A-Z0-9_]*)\} ]]; do
    ref_key="${BASH_REMATCH[1]}"
    ref="\${${ref_key}}"
    ref_value="${RESULT[${ref_key}]:-}"
    if [[ -z "${ref_value}" ]]; then
      echo "bootstrap: warning — composite value references unset \${${ref_key}}; leaving literal" >&2
      break
    fi
    # Substitute every occurrence; a key may legitimately appear twice.
    result="${result//${ref}/${ref_value}}"
  done
  printf '%s' "${result}"
}

# Phase 02.2 — `.env.example` uses three distinct value semantics, and
# bootstrap MUST treat them differently:
#
#   1. literal `PLACEHOLDER_BOOTSTRAP_WILL_REPLACE` — explicit secret slot;
#      always regenerated to a fresh random secret.
#   2. value containing `${OTHER_KEY}` — composite (e.g. DATABASE_URL);
#      always rebuilt from the current RESULT map. Operator-set overrides
#      for composites are intentionally NOT supported (keeps password
#      rotation safe).
#   3. anything else (including empty string and concrete defaults like
#      `https://api.localhost`, `openwhispr_owner`, `1025`,
#      `no-reply@openwhispr.local`, the empty SMTP_HOST=) — a real default
#      config value or empty operator slot. Preserved as-is on first
#      bootstrap; preserved if operator overrode in their .env.
#
# The previous logic regenerated category 3 as random secrets when current
# was empty or matched the example, which corrupted URL-shaped keys
# (OPENWHISPR_API_URL, AUTH_URL, OIDC_*, SMTP_*) into opaque base64 tokens
# — surfaced via api container "Invalid URL" crash on better-auth init.
readonly PLACEHOLDER_LITERAL='PLACEHOLDER_BOOTSTRAP_WILL_REPLACE'

for key in "${KEYS[@]}"; do
  current="${CURRENT[${key}]:-}"
  example_value="${EXAMPLE[${key}]}"
  if contains_placeholder "${example_value}"; then
    RESULT["${key}"]="$(interpolate "${example_value}")"
    GENERATED+=1
  elif [[ "${example_value}" == "${PLACEHOLDER_LITERAL}" ]]; then
    # Explicit secret slot. Regenerate if current is empty OR still the
    # placeholder; preserve operator-set value otherwise.
    if [[ -z "${current}" || "${current}" == "${PLACEHOLDER_LITERAL}" ]]; then
      if [[ "${key}" == "BACKUP_AGE_IDENTITY" ]]; then
        RESULT["${key}"]="$(gen_age_identity)"
      else
        RESULT["${key}"]="$(gen_secret)"
      fi
      GENERATED+=1
    else
      RESULT["${key}"]="${current}"
      PRESERVED+=1
    fi
  else
    # Real default / operator-overridable config value. Use current if set,
    # else the .env.example default (which may legitimately be empty).
    if [[ -n "${current}" ]]; then
      RESULT["${key}"]="${current}"
      PRESERVED+=1
    else
      RESULT["${key}"]="${example_value}"
      GENERATED+=1
    fi
  fi
done

# Phase 3: atomic write via mktemp + mv, then chmod 600.
tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
{
  echo "# Generated by tools/bootstrap.sh."
  echo "# Do not commit — gitignored. Re-run bootstrap to fill new keys; existing"
  echo "# operator-set values are preserved (only empty / placeholder values are"
  echo "# regenerated). See tools/bootstrap/README.md for the full contract."
  for key in "${KEYS[@]}"; do
    printf '%s=%s\n' "${key}" "${RESULT[${key}]}"
  done
} > "${tmp}"
mv "${tmp}" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo "bootstrap: .env written (${#KEYS[@]} keys, ${GENERATED} generated, ${PRESERVED} preserved)"

# Phase 4 (Plan 01-06): derive the X25519 public recipient at
# keys/backup.age.pub from BACKUP_AGE_IDENTITY when both `age-keygen`
# is available AND the public file is missing. Idempotent — never
# overwrites an existing recipient (operators may have committed one
# already, or rotated the identity manually).
identity="${RESULT[BACKUP_AGE_IDENTITY]:-}"
PUBKEY_FILE="${REPO_ROOT}/keys/backup.age.pub"
if [[ -n "${identity}" && "${identity}" == AGE-SECRET-KEY-1* && ! -f "${PUBKEY_FILE}" ]]; then
  if command -v age-keygen >/dev/null 2>&1; then
    mkdir -p "${REPO_ROOT}/keys"
    if printf '%s\n' "${identity}" | age-keygen -y > "${PUBKEY_FILE}.tmp" 2>/dev/null; then
      mv "${PUBKEY_FILE}.tmp" "${PUBKEY_FILE}"
      echo "bootstrap: wrote keys/backup.age.pub (X25519 recipient derived from BACKUP_AGE_IDENTITY)"
    else
      rm -f "${PUBKEY_FILE}.tmp"
      echo "bootstrap: age-keygen -y refused BACKUP_AGE_IDENTITY — value is not a valid X25519 identity" >&2
    fi
  else
    echo "bootstrap: age-keygen not in PATH; cannot derive keys/backup.age.pub. Install age (apt/brew/scoop) and re-run before using make backup." >&2
  fi
fi
