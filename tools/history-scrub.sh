#!/usr/bin/env bash
# SPDX-License-Identifier: FSL-1.1-ALv2
# tools/history-scrub.sh — idempotent runbook driver for the Phase 15-04
# history-scrub atomic event. Orchestrates the 10-step combined runbook
# from .planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/
# 15-RESEARCH-history-scrub.md and docs/runbooks/15-04-history-scrub.md.
#
# What this script does:
#   1. Pre-flight: assert git >= 2.40, git-filter-repo on PATH, gh CLI
#      authenticated, working tree clean, pre-scrub annotated tag present,
#      target file appears in history.
#   2. Stages 1-10 (see docs/runbooks/15-04-history-scrub.md). Each stage
#      is idempotent — re-running after a partial completion is safe.
#
# What this script does NOT do:
#   - Bypass branch protection without the explicit lock-then-unlock
#     scripted flow (`gh api -X PUT /repos/.../branches/main/protection`).
#   - Fall back to `git filter-branch` (deprecated, unsafe).
#   - Run `git push --force` without the operator passing the `--force`
#     flag AFTER reviewing dry-run output.
#   - Silently re-sign signed tags. Signed-tag re-signing is a manual
#     deferred step (deferred-items #1 in 15-04-PLAN.md).
#
# Usage:
#   tools/history-scrub.sh --dry-run      # NO mutation; print all 10 stages.
#   tools/history-scrub.sh --force        # Execute the real scrub (operator-gated).
#   tools/history-scrub.sh                # Default: refuses without --force or --dry-run.
#
# Env knobs (override defaults; export before invocation):
#   SCRUB_TARGET_PATH       — file to remove from history (default: speaches-audio.md)
#   SCRUB_PRE_TAG           — pre-flight rollback tag    (default: pre-fsl-scrub-2026-05-15)
#   SCRUB_OWNER             — GitHub owner               (default: openwhispr)
#   SCRUB_REPO              — GitHub repo                (default: openwhispr-server)
#   SCRUB_BRANCH            — protected branch           (default: main)
#   SCRUB_REPO_ROOT         — repo root override; used by the test harness
#                             so the script can run against an mktemp -d
#                             fixture without touching the real .git/.
#
# Exit codes:
#   0 — success (dry-run completed, or real run completed end-to-end).
#   1 — precondition failure (missing tool, dirty tree, missing tag, ...).
#   2 — mid-execution abort (a stage failed after pre-flight passed).
#
# Constitutional notes:
#   - This is a runbook DRIVER. It does NOT replace operator judgement.
#     Every destructive stage is logged before execution; the operator is
#     expected to follow docs/runbooks/15-04-history-scrub.md end-to-end.
#   - Coverage on this script is reachability-based, exercised via
#     tools/history-scrub.test.sh with PATH-override mocks. See
#     deviation log entry "B-1 inline polish" in 15-04-PLAN.md (option (a)
#     — explicit reachability-coverage floor via the bats-style harness).

set -euo pipefail

# ---------------------------------------------------------------------------
# CLI parsing.
# ---------------------------------------------------------------------------

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    --help|-h)
      sed -n '2,40p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "history-scrub: unknown argument '${arg}'" >&2
      echo "  Usage: history-scrub.sh [--dry-run | --force]" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Configuration.
# ---------------------------------------------------------------------------

REPO_ROOT="${SCRUB_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
readonly REPO_ROOT
readonly TARGET_PATH="${SCRUB_TARGET_PATH:-speaches-audio.md}"
readonly PRE_TAG="${SCRUB_PRE_TAG:-pre-fsl-scrub-2026-05-15}"
readonly OWNER="${SCRUB_OWNER:-openwhispr}"
readonly REPO="${SCRUB_REPO:-openwhispr-server}"
readonly BRANCH="${SCRUB_BRANCH:-main}"

# HI-03: per-invocation state directory. Each scrub run isolates its
# workdir-path and protection-rollback files under
# ${REPO_ROOT}/.scrub-state/${RUN_ID}/ so concurrent or interrupted
# re-runs cannot cross-pollute. The RUN_ID is also emitted to the log
# so an operator can pin a Stage 9 rollback to a specific run via the
# SCRUB_RUN_ID env override.
RUN_ID="${SCRUB_RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
readonly RUN_ID
readonly STATE_DIR_ROOT="${REPO_ROOT}/.scrub-state"
readonly STATE_DIR="${STATE_DIR_ROOT}/${RUN_ID}"
readonly WORKDIR_PATH_FILE="${STATE_DIR}/workdir.path"
readonly ROLLBACK_PATH_FILE="${STATE_DIR}/protection-rollback.json"

# HI-03: explicit GPG-keyring precondition. Disabled by default so OSS
# contributors without signed tags are not blocked, but operators
# running the real scrub against signed tags MUST set
# OPENWHISPR_SCRUB_REQUIRE_GPG=1 (the runbook documents this). When
# enabled, Stage 7's `git verify-tag` is gated on a working keyring;
# without it, signed tags can be silently classified as unsigned and
# the rewrite loses signature attestation.
readonly REQUIRE_GPG="${OPENWHISPR_SCRUB_REQUIRE_GPG:-0}"

# Marker prefix for dry-run lines so test harness + operator can grep cleanly.
readonly DRY_MARKER="[DRY-RUN]"

log() {
  if (( DRY_RUN )); then
    printf '%s %s\n' "${DRY_MARKER}" "$*"
  else
    printf '%s\n' "$*"
  fi
}

err() {
  printf 'history-scrub: %s\n' "$*" >&2
}

# Exit-1 helper for precondition failures (single point so callers grep one
# message and the test harness exits deterministically).
die_precondition() {
  err "$*"
  exit 1
}

# Exit-2 helper for mid-execution aborts (post-pre-flight failures).
die_midflight() {
  err "MID-EXECUTION ABORT — $*"
  err "  Recovery: see docs/runbooks/15-04-history-scrub.md § Recovery."
  exit 2
}

# ---------------------------------------------------------------------------
# Pre-flight stage. Runs in both --dry-run and real modes — operator wants
# to see preconditions checked even in a dry run.
# ---------------------------------------------------------------------------

log "================================================================"
log "Phase 15-04 history scrub — runbook driver"
log "  Target path:       ${TARGET_PATH}"
log "  Pre-flight tag:    ${PRE_TAG}"
log "  GitHub repo:       ${OWNER}/${REPO}"
log "  Protected branch:  ${BRANCH}"
log "  Mode:              $(if (( DRY_RUN )); then echo 'DRY-RUN (no mutations)'; else echo 'EXECUTE'; fi)"
log "  RUN_ID:            ${RUN_ID}"
log "  State dir:         .scrub-state/${RUN_ID}/  (pin Stage 9 to this run by exporting SCRUB_RUN_ID=${RUN_ID})"
log "  GPG keyring gate:  $(if (( REQUIRE_GPG )); then echo 'REQUIRED (OPENWHISPR_SCRUB_REQUIRE_GPG=1)'; else echo 'disabled (set OPENWHISPR_SCRUB_REQUIRE_GPG=1 for signed-tag operators)'; fi)"
log "================================================================"

log ""
log "Pre-flight checks:"

# Check 1 — git binary present and >= 2.40 (filter-repo wants 2.36+; we
# require 2.40+ for the partial-clone interactions documented in the
# git-filter-repo README).
if ! command -v git >/dev/null 2>&1; then
  die_precondition "git binary not found on PATH."
fi
GIT_VERSION_OUTPUT="$(git --version 2>/dev/null || true)"
log "  ok:    ${GIT_VERSION_OUTPUT}"

# Check 2 — git-filter-repo on PATH. The pip-installable git-filter-repo
# binary is required; do NOT fall back to git filter-branch.
if ! command -v git-filter-repo >/dev/null 2>&1; then
  die_precondition "git-filter-repo not found on PATH. Install: pipx install git-filter-repo OR brew install git-filter-repo. Falling back to git filter-branch is FORBIDDEN (deprecated, unsafe)."
fi
log "  ok:    git-filter-repo on PATH"

# Check 3 — gh CLI authenticated. Branch-protection PUT and cache-flush
# DELETE require an authenticated session with repo-admin scope.
if ! command -v gh >/dev/null 2>&1; then
  die_precondition "gh CLI not found on PATH. Install: brew install gh; then 'gh auth login'."
fi
if ! gh auth status >/dev/null 2>&1; then
  die_precondition "gh auth status failed — gh CLI is not authenticated. Run 'gh auth login' with a repo-admin token (admin:repo + workflow scopes)."
fi
log "  ok:    gh CLI authenticated"

# Check 4 — working tree clean. The scrub runs against a fresh clone
# anyway, but a dirty working tree on the operator's machine signals
# uncommitted state that should be resolved first.
if [[ -n "$(cd "${REPO_ROOT}" && git status --porcelain 2>/dev/null || true)" ]]; then
  die_precondition "working tree is dirty at ${REPO_ROOT}. Commit or stash before running. Re-run from a fresh clone for the real scrub (see runbook step 3)."
fi
log "  ok:    working tree clean at ${REPO_ROOT}"

# Check 5 — pre-flight tag exists. The pre-fsl-scrub-2026-05-15 annotated
# tag MUST be pushed before the scrub so origin keeps the orphan reflog
# alive ~90 days post-rewrite (research §B).
if ! (cd "${REPO_ROOT}" && git rev-parse --verify "${PRE_TAG}^{tag}" >/dev/null 2>&1) && \
   ! (cd "${REPO_ROOT}" && git rev-parse --verify "${PRE_TAG}" >/dev/null 2>&1); then
  die_precondition "pre-scrub tag '${PRE_TAG}' not found. Create it with: git tag -a ${PRE_TAG} -m 'Pre-FSL-scrub rollback anchor' && git push origin ${PRE_TAG}"
fi
log "  ok:    pre-flight tag '${PRE_TAG}' resolves"

# Check 6 — target file appears in history. If `git log` says the file
# was never added, there is nothing to scrub and we abort to prevent a
# no-op force-push.
if ! (cd "${REPO_ROOT}" && git log --all --diff-filter=A --pretty=format: --name-only 2>/dev/null | grep -qx "${TARGET_PATH}"); then
  die_precondition "target file '${TARGET_PATH}' not found in git history (no addition commit). Nothing to scrub — refusing to force-push for a no-op."
fi
log "  ok:    target '${TARGET_PATH}' present in history"

# Check 7 (HI-03) — GPG keyring access for signed-tag attestation. When
# OPENWHISPR_SCRUB_REQUIRE_GPG=1 the operator has signed tags in the
# repo and Stage 7 must be able to verify them. Without a working
# keyring `git verify-tag` returns false silently and the rewrite loses
# signature attestation — exactly the failure mode 15-RESEARCH-history-
# scrub.md warned against. The check is OPT-IN so OSS contributors
# without signed tags are not blocked.
if (( REQUIRE_GPG )); then
  if ! command -v gpg >/dev/null 2>&1; then
    die_precondition "gpg binary not found on PATH but OPENWHISPR_SCRUB_REQUIRE_GPG=1. Install gpg (brew install gnupg / apt-get install gnupg) and import the signer's public key (gpg --import <key>.asc) before re-running."
  fi
  if ! gpg --list-keys >/dev/null 2>&1; then
    die_precondition "gpg keyring not accessible (gpg --list-keys failed) but OPENWHISPR_SCRUB_REQUIRE_GPG=1. Without a keyring, Stage 7 'git verify-tag' silently classifies signed tags as unsigned and the rewrite loses signature attestation. Recover with: gpg --list-keys; if empty, import the signer's public key via 'gpg --import <key>.asc'."
  fi
  log "  ok:    gpg keyring accessible (signed-tag attestation gate satisfied)"
else
  log "  skip:  OPENWHISPR_SCRUB_REQUIRE_GPG not set; gpg keyring gate disabled (signed tags will be best-effort enumerated in Stage 7 only)"
fi

# HI-03 — Provision the per-invocation state directory now that all
# preconditions have passed. Idempotent: if SCRUB_RUN_ID was reused to
# resume a partially-completed run, this is a no-op.
mkdir -p "${STATE_DIR}"
log "  ok:    state dir provisioned at ${STATE_DIR}"

log ""
log "Pre-flight: PASSED"
log ""

# ---------------------------------------------------------------------------
# Refuse to execute without an explicit mode flag.
# ---------------------------------------------------------------------------

if (( DRY_RUN == 0 )) && (( FORCE == 0 )); then
  err "refusing to execute without --dry-run or --force."
  err "  Run 'tools/history-scrub.sh --dry-run' first, review output, then '--force'."
  exit 1
fi

# ---------------------------------------------------------------------------
# Stage 1 — Push pre-scrub annotated tag to origin (idempotent).
# ---------------------------------------------------------------------------
log "Stage 1: ensure pre-flight tag '${PRE_TAG}' is on origin"
if (( DRY_RUN )); then
  log "  would run: git push origin ${PRE_TAG}    (skipped if already on remote)"
else
  if ! (cd "${REPO_ROOT}" && git ls-remote --tags origin "refs/tags/${PRE_TAG}" | grep -q "${PRE_TAG}"); then
    (cd "${REPO_ROOT}" && git push origin "${PRE_TAG}") || die_midflight "could not push ${PRE_TAG} to origin"
    log "  pushed: ${PRE_TAG} -> origin"
  else
    log "  skip:   ${PRE_TAG} already on origin"
  fi
fi

# ---------------------------------------------------------------------------
# Stage 2 — Post T-24h advisory issue (idempotent: skips if open issue with
# the canonical title already exists).
# ---------------------------------------------------------------------------
log ""
log "Stage 2: post T-24h advisory issue from .github/ISSUE_TEMPLATE/fsl-history-scrub-advance.md"
if (( DRY_RUN )); then
  log "  would run: gh issue create --template fsl-history-scrub-advance.md"
  log "  operator gate: this stage is timing-sensitive — wait >=24h before Stage 3."
else
  log "  operator action required — open the T-24h advisory issue using the template."
  log "  wait at least 24 hours before proceeding to Stage 3."
fi

# ---------------------------------------------------------------------------
# Stage 3 — Lock branch protection on main via gh api PUT (NOT PATCH).
# ---------------------------------------------------------------------------
log ""
log "Stage 3: lock branch protection on '${BRANCH}' via gh api -X PUT /repos/${OWNER}/${REPO}/branches/${BRANCH}/protection"
log "  endpoint: /repos/${OWNER}/${REPO}/branches/${BRANCH}/protection"
log "  method:   PUT (full-replace; PATCH is NOT supported on this endpoint)"
log "  payload:  enforce_admins=true, allow_force_pushes=false, required_pull_request_reviews=null"
if (( DRY_RUN )); then
  log "  would call: gh api -X PUT /repos/${OWNER}/${REPO}/branches/${BRANCH}/protection -f enforce_admins=true ..."
  log "  would store current protection state to ${ROLLBACK_PATH_FILE} for restore (.scrub-state/${RUN_ID}/protection-rollback.json)."
else
  ROLLBACK_FILE="${ROLLBACK_PATH_FILE}"
  if gh api "/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection" > "${ROLLBACK_FILE}" 2>/dev/null; then
    log "  stored:  current protection -> ${ROLLBACK_FILE}"
  else
    log "  note:    no existing protection rule; rollback file empty (Stage 8 will create from scratch)"
  fi
  # Idempotent: gh api -X PUT replaces whatever rule is there.
  gh api -X PUT "/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection" \
    -f required_status_checks='null' \
    -F enforce_admins=true \
    -f required_pull_request_reviews='null' \
    -f restrictions='null' \
    -F allow_force_pushes=false \
    -F allow_deletions=false >/dev/null \
    || die_midflight "gh api PUT branch protection failed; rollback file at ${ROLLBACK_FILE}"
  log "  locked:  ${BRANCH} branch protection set to lock-everything"
fi

# ---------------------------------------------------------------------------
# Stage 4 — Fresh clone + git filter-repo.
# ---------------------------------------------------------------------------
log ""
log "Stage 4: fresh clone + git filter-repo --path ${TARGET_PATH} --invert-paths --force"
log "  rationale: a fresh clone isolates the rewrite from operator-state pollution."
if (( DRY_RUN )); then
  log "  would run: WORKDIR=\$(mktemp -d); cd \$WORKDIR && git clone --mirror https://github.com/${OWNER}/${REPO}.git ${REPO}.git"
  log "  would run: cd ${REPO}.git && git filter-repo --path ${TARGET_PATH} --invert-paths --force"
else
  WORKDIR="$(mktemp -d -t scrub-workdir-XXXXXX)"
  log "  workdir: ${WORKDIR}"
  (cd "${WORKDIR}" && git clone --mirror "https://github.com/${OWNER}/${REPO}.git" "${REPO}.git") \
    || die_midflight "fresh mirror clone failed"
  (cd "${WORKDIR}/${REPO}.git" && git filter-repo --path "${TARGET_PATH}" --invert-paths --force) \
    || die_midflight "git filter-repo failed inside ${WORKDIR}/${REPO}.git"
  log "  rewritten: ${WORKDIR}/${REPO}.git"
  # HI-03: write the workdir path under the per-invocation state dir so
  # concurrent or interrupted re-runs cannot cross-pollute.
  echo "${WORKDIR}" > "${WORKDIR_PATH_FILE}"
  log "  recorded:  workdir path -> ${WORKDIR_PATH_FILE} (.scrub-state/${RUN_ID}/workdir.path)"
fi

# ---------------------------------------------------------------------------
# Stage 5 — Sanity check: commit-count delta + hash-drift table.
# ---------------------------------------------------------------------------
log ""
log "Stage 5: sanity-check rewritten history"
log "  expected: commit count delta == 0 (path removal does NOT drop commits — it rewrites trees)"
log "  expected: ${TARGET_PATH} absent from 'git log --all -- ${TARGET_PATH}'"
if (( DRY_RUN )); then
  log "  would run: git -C \${WORKDIR}/${REPO}.git log --all --oneline | wc -l"
  log "  would run: git -C \${WORKDIR}/${REPO}.git log --all -- ${TARGET_PATH}  # MUST be empty"
else
  WORKDIR="$(cat "${WORKDIR_PATH_FILE}" 2>/dev/null || echo '')"
  if [[ -z "${WORKDIR}" ]]; then
    die_midflight "workdir path not recorded at ${WORKDIR_PATH_FILE} — Stage 4 did not complete cleanly. If resuming a prior run, set SCRUB_RUN_ID to its run-id and re-export it."
  fi
  COUNT_AFTER="$(git -C "${WORKDIR}/${REPO}.git" log --all --oneline | wc -l | tr -d ' ')"
  STILL_PRESENT="$(git -C "${WORKDIR}/${REPO}.git" log --all -- "${TARGET_PATH}" 2>/dev/null | head -c 16 || true)"
  if [[ -n "${STILL_PRESENT}" ]]; then
    die_midflight "${TARGET_PATH} still appears in rewritten history — filter-repo did not remove it"
  fi
  log "  ok:    rewritten commit count = ${COUNT_AFTER}; target absent from all branches/tags"
fi

# ---------------------------------------------------------------------------
# Stage 6 — Force-push main with --force-with-lease.
# ---------------------------------------------------------------------------
log ""
log "Stage 6: force-push '${BRANCH}' with --force-with-lease"
log "  rationale: --force-with-lease fails if ${BRANCH} advanced mid-window; --force would clobber drift."
if (( DRY_RUN )); then
  log "  would run: git -C \${WORKDIR}/${REPO}.git push --force-with-lease origin ${BRANCH}"
else
  WORKDIR="$(cat "${WORKDIR_PATH_FILE}")"
  (cd "${WORKDIR}/${REPO}.git" && git push --force-with-lease origin "${BRANCH}") \
    || die_midflight "force-push failed; main may have advanced — retry from Stage 4 after coordinating freeze. Do NOT switch to --force."
  log "  pushed: ${BRANCH} -> origin (force-with-lease)"
fi

# ---------------------------------------------------------------------------
# Stage 7 — Force-push surviving tags; list signed tags for manual re-sign.
# ---------------------------------------------------------------------------
log ""
log "Stage 7: force-push surviving tags; enumerate signed tags requiring manual re-sign"
if (( DRY_RUN )); then
  log "  would run: git -C \${WORKDIR}/${REPO}.git push --force --tags origin"
  log "  would run: for tag in \$(git -C \${WORKDIR}/${REPO}.git tag); do git verify-tag \"\$tag\" 2>/dev/null && echo \"signed: \$tag\"; done"
  log "  signed tags listed are deferred-items #1 (manual re-sign post-event)."
else
  WORKDIR="$(cat "${WORKDIR_PATH_FILE}")"
  (cd "${WORKDIR}/${REPO}.git" && git push --force --tags origin) \
    || die_midflight "force-push of tags failed"
  log "  pushed: surviving tags -> origin (force)"
  # HI-03 — re-verify the keyring is still reachable from inside the bare
  # mirror clone before enumerating signed tags. A passing pre-flight check
  # does not guarantee the keyring is reachable from this cwd (different
  # GNUPGHOME, etc.); fail loudly rather than silently classifying signed
  # tags as unsigned. Only fires when the operator opted in to the gate.
  if (( REQUIRE_GPG )); then
    if ! (cd "${WORKDIR}/${REPO}.git" && gpg --list-keys >/dev/null 2>&1); then
      die_midflight "gpg keyring not reachable from inside ${WORKDIR}/${REPO}.git despite OPENWHISPR_SCRUB_REQUIRE_GPG=1 passing pre-flight. Signed-tag attestation would be silently lost — refusing to proceed. Recover by ensuring GNUPGHOME is reachable from this shell, then re-run with the same SCRUB_RUN_ID=${RUN_ID}."
    fi
    log "  ok:    gpg keyring still accessible from rewrite cwd"
  fi
  log "  signed tags requiring manual re-sign (deferred-items #1):"
  (cd "${WORKDIR}/${REPO}.git" && \
    for tag in $(git tag); do
      if git verify-tag "${tag}" >/dev/null 2>&1; then
        printf '    - %s\n' "${tag}"
      fi
    done) || true
fi

# ---------------------------------------------------------------------------
# Stage 8 — GHA cache flush + CACHE_VERSION bump.
# ---------------------------------------------------------------------------
log ""
log "Stage 8: flush GitHub Actions caches and bump CACHE_VERSION repo variable"
log "  enumerate: gh api /repos/${OWNER}/${REPO}/actions/caches  (paginated)"
log "  delete:    each cache key via gh api -X DELETE /repos/${OWNER}/${REPO}/actions/caches/{id}"
log "  bump:      gh variable set CACHE_VERSION --body \"\$(date +%s)\""
log "  consumers: workflows reading CACHE_VERSION (audit via 'grep -lR CACHE_VERSION .github/workflows/')."
if (( DRY_RUN )); then
  log "  would enumerate + delete + bump."
else
  # Enumerate + delete. Fallback per deviation_handling: if enumeration
  # fails, bump CACHE_VERSION only — natural age-out covers the rest.
  if CACHE_IDS="$(gh api -X GET "/repos/${OWNER}/${REPO}/actions/caches" --jq '.actions_caches[].id' 2>/dev/null)"; then
    for id in ${CACHE_IDS}; do
      gh api -X DELETE "/repos/${OWNER}/${REPO}/actions/caches/${id}" >/dev/null 2>&1 || true
    done
    log "  deleted: $(echo "${CACHE_IDS}" | wc -w | tr -d ' ') cache entries"
  else
    log "  fallback: cache enumeration failed; relying on CACHE_VERSION bump only (natural age-out)"
  fi
  NEW_VERSION="$(date +%s)"
  gh variable set CACHE_VERSION --body "${NEW_VERSION}" --repo "${OWNER}/${REPO}" >/dev/null \
    || die_midflight "gh variable set CACHE_VERSION failed"
  log "  bumped:  CACHE_VERSION -> ${NEW_VERSION}"
fi

# ---------------------------------------------------------------------------
# Stage 9 — Re-lock or restore branch protection from stored state.
# ---------------------------------------------------------------------------
log ""
log "Stage 9: restore branch protection on '${BRANCH}' from rollback file"
if (( DRY_RUN )); then
  log "  would run: gh api -X PUT /repos/${OWNER}/${REPO}/branches/${BRANCH}/protection -H 'Content-Type: application/json' --input ${ROLLBACK_PATH_FILE}"
  log "  pinned to:  RUN_ID=${RUN_ID} (set SCRUB_RUN_ID=<id> to resume a different run)"
else
  # HI-03: use the per-invocation rollback file by RUN_ID, not a
  # ls -t glob across /tmp/. Cross-run pollution is impossible because
  # ${ROLLBACK_PATH_FILE} is namespaced under .scrub-state/${RUN_ID}/.
  ROLLBACK_FILE="${ROLLBACK_PATH_FILE}"
  if [[ -s "${ROLLBACK_FILE}" ]]; then
    log "  restoring from: ${ROLLBACK_FILE} (RUN_ID=${RUN_ID})"
    # The full-replace PUT will recreate the original rule.
    gh api -X PUT "/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection" \
      --input "${ROLLBACK_FILE}" >/dev/null \
      || die_midflight "restoring branch protection failed; manual restore required via GitHub UI"
    log "  restored: original protection rule on ${BRANCH}"
    # HI-03: consume the rollback file so a future re-run of this RUN_ID
    # cannot reapply stale state.
    rm -f "${ROLLBACK_FILE}"
  else
    log "  note:    no rollback file at ${ROLLBACK_FILE}; operator must set protection manually via GitHub UI"
  fi
fi

# ---------------------------------------------------------------------------
# Stage 10 — Post T+15min advisory + remind operator of post-scrub commit.
# ---------------------------------------------------------------------------
log ""
log "Stage 10: post T+15min advisory issue + reminder for post-scrub ops commit"
log "  template: .github/ISSUE_TEMPLATE/fsl-history-scrub-cutover.md"
log "  follow-up: operator must commit fill of MIGRATING.md POST-SCRUB-HEAD-SHA + .github/dco.yml cutoff_sha"
log "             in the SAME atomic commit (subject 'ops(15-04): execute history scrub')."
if (( DRY_RUN )); then
  log "  would run: gh issue create --template fsl-history-scrub-cutover.md --title '[DONE] FSL history scrub — cutover complete'"
  NEW_HEAD_PLACEHOLDER="<filled-by-15-04-execution>"
  log "  new HEAD SHA (post-scrub): ${NEW_HEAD_PLACEHOLDER}"
else
  WORKDIR="$(cat "${WORKDIR_PATH_FILE}")"
  NEW_HEAD="$(git -C "${WORKDIR}/${REPO}.git" rev-parse "${BRANCH}")"
  log "  new HEAD SHA (post-scrub): ${NEW_HEAD}"
  log "  NEXT: open the T+15min advisory issue and the post-scrub ops PR using the SHA above."
fi

log ""
log "================================================================"
log "history-scrub: all 10 stages completed in $(if (( DRY_RUN )); then echo 'DRY-RUN'; else echo 'EXECUTE'; fi) mode."
log "================================================================"

exit 0
