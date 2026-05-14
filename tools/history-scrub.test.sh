#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# tools/history-scrub.test.sh — pure-bash conformance test for the
# tools/history-scrub.sh runbook driver. Phase 15 / Plan 04 / Task 1.
#
# Exercises the --dry-run path + precondition asserts against PATH-override
# mocks of `git`, `gh`, and `git-filter-repo`. The real repo's .git/ is
# NEVER touched: every test runs against a fresh `mktemp -d` fixture and a
# fixture `bin/` prepended to PATH.
#
# Exit 0 = all assertions GREEN. Non-zero = at least one assertion FAILED.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCRUB="${REPO_ROOT}/tools/history-scrub.sh"

declare -i FAILED=0
declare -i PASSED=0

fail() {
  printf '  FAIL: %s\n' "$1" >&2
  FAILED+=1
}

pass() {
  printf '  ok:   %s\n' "$1"
  PASSED+=1
}

# Build a throwaway PATH-override bin/ with mocks for git, gh, git-filter-repo.
# Each invocation also gets a fresh fixture .git working tree.
#
# Args to make_fixture:
#   $1 — scenario name, recorded as $FIXTURE/scenario
# Env honoured by the mocks (read at mock-exec time):
#   MOCK_GIT_TAG_EXISTS=1|0     — `git rev-parse --verify <tag>` exit code
#   MOCK_GIT_DIRTY=1|0          — `git status --porcelain` output is non-empty
#   MOCK_FILTER_REPO_MISSING=1|0 — drop git-filter-repo from PATH override
#   MOCK_GH_AUTH_FAIL=1|0       — `gh auth status` returns non-zero
#   MOCK_GIT_FILE_IN_HISTORY=1|0 — target file appears in `git log`
make_fixture() {
  local scenario="$1"
  FIXTURE="$(mktemp -d)"
  ARGV_LOG="${FIXTURE}/argv.log"
  : > "${ARGV_LOG}"
  mkdir -p "${FIXTURE}/bin"

  # --- git mock ----------------------------------------------------------
  cat > "${FIXTURE}/bin/git" <<EOF
#!/usr/bin/env bash
echo "git \$*" >> "${ARGV_LOG}"
case "\$1 \${2:-} \${3:-}" in
  "--version "*)
    echo "git version 2.45.0"
    exit 0
    ;;
  "rev-parse --verify "*)
    if [[ "\${MOCK_GIT_TAG_EXISTS:-1}" == "1" ]]; then
      echo "abc1234567890abc1234567890abc1234567890a"
      exit 0
    else
      echo "fatal: Needed a single revision" >&2
      exit 128
    fi
    ;;
  "status --porcelain "*|"status --porcelain")
    if [[ "\${MOCK_GIT_DIRTY:-0}" == "1" ]]; then
      echo " M some-file.txt"
    fi
    exit 0
    ;;
  "log --all "*)
    if [[ "\${MOCK_GIT_FILE_IN_HISTORY:-1}" == "1" ]]; then
      echo "speaches-audio.md"
    fi
    exit 0
    ;;
  "rev-parse HEAD "*|"rev-parse HEAD"|"rev-parse --abbrev-ref "*)
    echo "abc1234567890abc1234567890abc1234567890a"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
  chmod +x "${FIXTURE}/bin/git"

  # --- gh mock -----------------------------------------------------------
  cat > "${FIXTURE}/bin/gh" <<EOF
#!/usr/bin/env bash
echo "gh \$*" >> "${ARGV_LOG}"
case "\$1 \${2:-}" in
  "auth status")
    if [[ "\${MOCK_GH_AUTH_FAIL:-0}" == "1" ]]; then
      echo "not logged in" >&2
      exit 1
    fi
    echo "Logged in to github.com"
    exit 0
    ;;
  "api "*)
    # Echo back empty JSON so callers can pipe-parse harmlessly.
    echo "{}"
    exit 0
    ;;
  "variable "*)
    exit 0
    ;;
  "issue "*)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
EOF
  chmod +x "${FIXTURE}/bin/gh"

  # --- git-filter-repo mock ---------------------------------------------
  if [[ "${MOCK_FILTER_REPO_MISSING:-0}" != "1" ]]; then
    cat > "${FIXTURE}/bin/git-filter-repo" <<EOF
#!/usr/bin/env bash
echo "git-filter-repo \$*" >> "${ARGV_LOG}"
echo "git-filter-repo 2.47.0"
exit 0
EOF
    chmod +x "${FIXTURE}/bin/git-filter-repo"
  fi

  echo "${scenario}" > "${FIXTURE}/scenario"
}

cleanup_fixture() {
  if [[ -n "${FIXTURE:-}" && -d "${FIXTURE}" ]]; then
    rm -rf "${FIXTURE}"
  fi
  unset FIXTURE ARGV_LOG
  unset MOCK_GIT_TAG_EXISTS MOCK_GIT_DIRTY MOCK_FILTER_REPO_MISSING
  unset MOCK_GH_AUTH_FAIL MOCK_GIT_FILE_IN_HISTORY
}

# --- Test 1 ----------------------------------------------------------------
echo "Test 1: --dry-run reports 10 stages without writing"
make_fixture "dry-run-happy"
OUT="$(PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" --dry-run 2>&1 || true)"
if echo "${OUT}" | grep -q 'Stage 1:' && echo "${OUT}" | grep -q 'Stage 10:'; then
  pass "Stage 1 and Stage 10 both reported"
else
  fail "missing Stage 1 or Stage 10 in --dry-run output"
fi
if echo "${OUT}" | grep -qi 'DRY[- ]RUN'; then
  pass "output explicitly marks dry-run"
else
  fail "no DRY-RUN marker in output"
fi
cleanup_fixture

# --- Test 2 ----------------------------------------------------------------
echo "Test 2: missing pre-flight tag exits non-zero"
make_fixture "missing-tag"
set +e
MOCK_GIT_TAG_EXISTS=0 \
  PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" >/dev/null 2>"${FIXTURE}/err"
RC=$?
set -e
if (( RC != 0 )); then
  pass "non-zero exit (${RC}) when pre-scrub tag absent"
else
  fail "expected non-zero exit, got 0"
fi
if grep -q 'pre-fsl-scrub-2026-05-15' "${FIXTURE}/err"; then
  pass "stderr names the missing tag"
else
  fail "stderr does not name the missing pre-scrub tag"
fi
cleanup_fixture

# --- Test 3 ----------------------------------------------------------------
echo "Test 3: git filter-repo not on PATH exits non-zero"
make_fixture "no-filter-repo"
# Re-create fixture WITHOUT the filter-repo mock.
rm -f "${FIXTURE}/bin/git-filter-repo"
set +e
PATH="${FIXTURE}/bin:/usr/bin:/bin" bash "${SCRUB}" --dry-run >/dev/null 2>"${FIXTURE}/err"
RC=$?
set -e
if (( RC != 0 )); then
  pass "non-zero exit (${RC}) when git-filter-repo absent"
else
  fail "expected non-zero exit, got 0"
fi
if grep -qi 'filter-repo' "${FIXTURE}/err"; then
  pass "stderr mentions filter-repo"
else
  fail "stderr does not mention filter-repo"
fi
cleanup_fixture

# --- Test 4 ----------------------------------------------------------------
echo "Test 4: gh auth status failure exits non-zero"
make_fixture "no-gh-auth"
set +e
MOCK_GH_AUTH_FAIL=1 \
  PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" --dry-run >/dev/null 2>"${FIXTURE}/err"
RC=$?
set -e
if (( RC != 0 )); then
  pass "non-zero exit (${RC}) when gh not authenticated"
else
  fail "expected non-zero exit, got 0"
fi
if grep -qi 'gh' "${FIXTURE}/err" && grep -qi 'auth' "${FIXTURE}/err"; then
  pass "stderr mentions gh auth"
else
  fail "stderr does not mention gh auth"
fi
cleanup_fixture

# --- Test 5 ----------------------------------------------------------------
echo "Test 5: dirty working tree exits non-zero"
make_fixture "dirty-tree"
set +e
MOCK_GIT_DIRTY=1 \
  PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" --dry-run >/dev/null 2>"${FIXTURE}/err"
RC=$?
set -e
if (( RC != 0 )); then
  pass "non-zero exit (${RC}) on dirty working tree"
else
  fail "expected non-zero exit, got 0"
fi
if grep -qi 'working tree' "${FIXTURE}/err" || grep -qi 'dirty' "${FIXTURE}/err"; then
  pass "stderr mentions dirty working tree"
else
  fail "stderr does not mention dirty working tree"
fi
cleanup_fixture

# --- Test 6 ----------------------------------------------------------------
echo "Test 6: branch protection lock uses gh api PUT (not PATCH)"
make_fixture "put-not-patch"
# Capture stdout+stderr of a fresh --dry-run into a single variable so the
# OR-chain is straight-forward (no pipefail interactions on subprocess pipes).
OUT6="$(PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" --dry-run 2>&1 || true)"
if echo "${OUT6}" | grep -q -- '-X PUT'; then
  pass "PUT invocation declared for branch protection"
else
  fail "no PUT invocation found in --dry-run output"
fi
if echo "${OUT6}" | grep -q -E '\-X PATCH +/repos/.*/branches/main/protection'; then
  fail "script uses PATCH (forbidden; full-replace PUT only per GitHub API)"
else
  pass "no PATCH used for branch-protection endpoint"
fi
cleanup_fixture

# --- Test 7 ----------------------------------------------------------------
echo "Test 7: --dry-run is idempotent (same output twice)"
make_fixture "idempotent"
OUT1="$(PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" --dry-run 2>&1 || true)"
OUT2="$(PATH="${FIXTURE}/bin:${PATH}" bash "${SCRUB}" --dry-run 2>&1 || true)"
if [[ "${OUT1}" == "${OUT2}" ]]; then
  pass "two --dry-run invocations produce identical output"
else
  fail "non-idempotent output across two --dry-run runs"
fi
cleanup_fixture

# --- Summary ---------------------------------------------------------------
printf '\n%s: %d passed, %d failed\n' "$(basename "${BASH_SOURCE[0]}")" "${PASSED}" "${FAILED}" >&2
if (( FAILED > 0 )); then
  exit 1
fi
exit 0
