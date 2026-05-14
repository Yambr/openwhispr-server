<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->

# Runbook 15-04 — History Scrub Atomic Event

**Owning phase:** 15 — Repo Refactor + FSL Relicense + History Scrub (v2)
**Owning plan:** 15-04
**Owning ADR:** [ADR-0013 — FSL Relicense](../adrs/0013-fsl-relicense.md)
**Driver script:** [`tools/history-scrub.sh`](../../tools/history-scrub.sh)
**Driver tests:** [`tools/history-scrub.test.sh`](../../tools/history-scrub.test.sh)
**Closes requirements:** FSL-06, FSL-07
**Authored:** 2026-05-15
**Status:** ready for execution (operator-gated; this document does NOT
itself execute the scrub)

---

## What this runbook does

Removes the stale `speaches-audio.md` reference file from **all** of git
history via `git filter-repo --path speaches-audio.md --invert-paths`,
bundled with the FSL relicense (already landed in 15-03) as ONE
force-push event so contributors absorb a single rewrite, not two.

After execution, every commit SHA on `main` shifts. Surviving annotated
tags are re-anchored. Signed tags are listed for manual re-sign (a
deferred manual step — see `deferred-items.md` #1).

## What this runbook does NOT do

- Bypass branch protection without the scripted lock-then-unlock flow.
- Fall back to `git filter-branch` (deprecated, slower, more failure modes).
- Re-sign signed tags automatically — that is a manual one-shot per
  deferred-items #1.
- Switch `git push --force-with-lease` to `--force` if the lease fails.
  A lease failure means `main` advanced mid-window; the correct response
  is to retry from Stage 4 after coordinating to freeze new commits.
- Touch the DCO bot grandfather cutoff SHA — that is filled by the
  separate `ops(15-04): execute history scrub` follow-up commit using the
  new HEAD SHA emitted by Stage 10.

---

## Preconditions

Before running the scrub:

1. **15-03 is merged** on `main` and the FSL relicense is live. CI on
   `main` must be GREEN.
2. **`pre-fsl-relicense-2026-05-15` annotated tag** exists and is
   pushed to origin (15-03 deliverable). Verify with
   `git ls-remote --tags origin | grep pre-fsl-relicense`.
3. **`pre-fsl-scrub-2026-05-15` annotated tag** exists locally pointing
   at the current `main` HEAD. Push it to origin in Stage 1 below
   *before* the rewrite — this preserves the orphan reflog on GitHub
   for ~90 days post-rewrite. The local tag is created by the 15-04
   plan-authoring commit; the *push* is a Stage 1 operator action.
4. **`git filter-repo`** is installed on the operator's machine.
   Install via `pipx install git-filter-repo` or `brew install git-filter-repo`.
   Do NOT fall back to `git filter-branch`.
5. **`gh` CLI** is installed and authenticated with a token carrying
   `admin:repo` + `workflow` scopes. Verify with `gh auth status`.
6. **A target scrub timestamp (T0)** has been agreed and an advisory
   issue has been opened at T-24h using the
   [`fsl-history-scrub-advance.md`](../../.github/ISSUE_TEMPLATE/fsl-history-scrub-advance.md)
   template.
7. **No in-flight PRs you cannot rebase post-event.** Currently-open PRs
   will need to be rebased onto the new `main`; coordinate with PR
   authors via the T-24h advisory.

## Dry-run first — ALWAYS

```bash
# From the repo root, on a clean checkout (no modified files).
bash tools/history-scrub.sh --dry-run
```

Expected output: 10 stages enumerated with `[DRY-RUN]` prefix, all
preconditions reported `ok:`, and a final summary line. If any
precondition fails, the script exits 1 with a clear error and a fix
hint. Resolve every error before proceeding to the real run.

If the dry-run output looks wrong, **stop**. Investigate. The real
run inherits every behaviour from the dry-run except the mutations.

---

## The 10 stages

### Stage 1 — Push pre-scrub annotated tag

```bash
# Local creation happens at 15-04 plan-authoring time; verify it exists.
git tag -l pre-fsl-scrub-2026-05-15
# Push to origin BEFORE the rewrite (preserves orphan reflog ~90 days).
git push origin pre-fsl-scrub-2026-05-15
```

The driver skips this step if the tag is already on origin.

### Stage 2 — Post T-24h advisory issue

Use the [`fsl-history-scrub-advance.md`](../../.github/ISSUE_TEMPLATE/fsl-history-scrub-advance.md)
template:

```bash
gh issue create \
  --title "[ANNOUNCE] FSL history scrub — T-24h advance notice" \
  --label announcement \
  --label breaking \
  --body-file .github/ISSUE_TEMPLATE/fsl-history-scrub-advance.md
```

**Wait at least 24 hours** before proceeding. Use this window to:

- Notify contributors via discussions + pinned issue.
- Audit currently-open PRs against `main` and message authors.
- Take a `pg_dump` of any in-flight integration tests.

### Stage 3 — Lock branch protection on `main`

```bash
# Driver does this idempotently; manual command shown for reference.
gh api -X PUT /repos/openwhispr/openwhispr-server/branches/main/protection \
  -f required_status_checks='null' \
  -F enforce_admins=true \
  -f required_pull_request_reviews='null' \
  -f restrictions='null' \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

**Endpoint:** `PUT` (full-replace) — `PATCH` is NOT supported on the
branch-protection endpoint per the GitHub REST API. The driver stores
the current protection JSON to `/tmp/scrub-protection-rollback.*.json`
for Stage 9 restore.

If the repo has migrated to GitHub Rulesets instead of legacy branch
protection, edit the driver to use
`gh api /repos/.../rulesets` instead. Do NOT bypass protection.

### Stage 4 — Fresh clone + `git filter-repo`

Run from a fresh `mktemp -d` directory, NOT the operator's working tree:

```bash
WORKDIR=$(mktemp -d -t scrub-workdir-XXXXXX)
cd "$WORKDIR"
git clone --mirror https://github.com/openwhispr/openwhispr-server.git openwhispr-server.git
cd openwhispr-server.git
git filter-repo --path speaches-audio.md --invert-paths --force
```

The mirror clone isolates the rewrite from any operator-state
pollution. `--force` is required because filter-repo refuses to run on
a non-fresh clone by default.

### Stage 5 — Sanity check

```bash
# Commit count delta: should be 0 (filter-repo rewrites trees, not commit objects).
git -C "$WORKDIR/openwhispr-server.git" log --all --oneline | wc -l
# Target absent: MUST emit nothing.
git -C "$WORKDIR/openwhispr-server.git" log --all -- speaches-audio.md
```

If the target file still appears, the rewrite did not take. **Abort
and re-run filter-repo with the correct `--path` value.**

### Stage 6 — Force-push `main` with `--force-with-lease`

```bash
git -C "$WORKDIR/openwhispr-server.git" push --force-with-lease origin main
```

`--force-with-lease` (NOT `--force`) fails if `main` advanced after
Stage 3's lock. A lease failure is a SIGNAL — coordinate to freeze any
new commits, then retry from Stage 4. Do NOT switch to `--force`; that
would silently clobber concurrent work.

### Stage 7 — Force-push surviving tags; list signed tags

```bash
git -C "$WORKDIR/openwhispr-server.git" push --force --tags origin

# Enumerate signed tags requiring manual re-sign:
cd "$WORKDIR/openwhispr-server.git"
for tag in $(git tag); do
  git verify-tag "$tag" >/dev/null 2>&1 && echo "signed: $tag"
done
```

Each signed tag listed needs manual re-sign by its original tagger
(deferred-items #1). Re-tag at the new SHA with the same name +
re-sign with the original key, then `git push --force --tags origin`.

### Stage 8 — GHA cache flush + `CACHE_VERSION` bump

```bash
# Enumerate + delete all cache entries.
for id in $(gh api /repos/openwhispr/openwhispr-server/actions/caches \
              --jq '.actions_caches[].id'); do
  gh api -X DELETE "/repos/openwhispr/openwhispr-server/actions/caches/$id"
done

# Bump the CACHE_VERSION repo variable so any cache key reading it busts.
gh variable set CACHE_VERSION \
  --body "$(date +%s)" \
  --repo openwhispr/openwhispr-server
```

**Consumer workflows** that should reference `CACHE_VERSION` in their
cache keys (audit + add the var on the next cache-using PR):

- `.github/workflows/ci.yml`
- `.github/workflows/e2e-cjm.yml`
- `.github/workflows/conformance-axe.yml`
- `.github/workflows/helm-release.yml`
- `.github/workflows/chart-release.yml`

As of 2026-05-15 none of these workflows reference `CACHE_VERSION`
yet — the variable is set up as a forward-compatibility hook. The
unconditional bump in this stage is the belt-and-braces measure even
if no workflow reads it; cache entries are deleted explicitly above.

If cache enumeration fails because the page count is too high, fall
back to the `CACHE_VERSION` bump only — natural age-out covers the
rest. The driver applies this fallback automatically.

### Stage 9 — Restore branch protection

```bash
# Driver replays from the rollback JSON stored in Stage 3.
gh api -X PUT /repos/openwhispr/openwhispr-server/branches/main/protection \
  --input /tmp/scrub-protection-rollback.<RANDOM>.json
```

Verify the rule is back via the GitHub UI (Settings → Branches → main).

### Stage 10 — T+15min advisory + capture new HEAD SHA

```bash
# Capture the new HEAD SHA for the follow-up ops commit:
NEW_HEAD=$(git -C "$WORKDIR/openwhispr-server.git" rev-parse main)
echo "Post-scrub HEAD: $NEW_HEAD"

# Post the cutover advisory:
gh issue create \
  --title "[DONE] FSL history scrub — cutover complete" \
  --label announcement \
  --body-file .github/ISSUE_TEMPLATE/fsl-history-scrub-cutover.md
```

After this stage, open a follow-up PR titled
`ops(15-04): execute history scrub` that fills:

1. `MIGRATING.md` — replace the `<!-- POST-SCRUB-HEAD-SHA: filled by
   15-04 once \`git filter-repo\` lands. -->` placeholder with a section
   recording the new HEAD SHA, the pre-scrub tag SHA, the date, and
   the recovery one-liner.
2. `.github/dco.yml` — replace `cutoff_sha: ""` with
   `cutoff_sha: <NEW_HEAD>` (full 40-character SHA — short SHAs are
   ambiguous and the DCO bot refuses).

Land both edits in ONE atomic commit; that commit MUST itself be on
the post-scrub history (so its parent is the new HEAD).

---

## Recovery one-liners

### Downstream consumer wants to stay on FSL `main` across the force-push

```bash
git fetch origin
git checkout main
git reset --hard origin/main
```

### Downstream consumer wants to stay on Apache-2.0 (pre-relicense fork)

```bash
git fetch origin tag pre-fsl-relicense-2026-05-15
git checkout -b apache-2.0-fork pre-fsl-relicense-2026-05-15
git push -u <your-remote> apache-2.0-fork
```

### Downstream consumer has in-flight work that branched off pre-rewrite `main`

```bash
# Get the SHA the branch was based on (recorded in the T-24h advisory).
OLD_BASE_SHA=<record from advisory>
git fetch origin
git rebase --onto origin/main "$OLD_BASE_SHA" <work-branch>
# Then add Signed-off-by trailers (DCO requirement post-cutoff):
git rebase --signoff origin/main
```

### Operator's force-push failed lease

```bash
# main advanced mid-window. Coordinate to freeze, then re-run:
rm -rf "$WORKDIR"
bash tools/history-scrub.sh --dry-run  # re-verify preconditions
bash tools/history-scrub.sh --force    # restart Stages 1-10
```

### Branch protection restore failed (Stage 9)

The original rule is preserved in `/tmp/scrub-protection-rollback.*.json`.
Open it, edit any drifted fields, then replay manually:

```bash
gh api -X PUT /repos/openwhispr/openwhispr-server/branches/main/protection \
  --input /tmp/scrub-protection-rollback.<RANDOM>.json
```

If the JSON itself was lost (e.g., the temp dir was cleaned), recreate
the rule via the GitHub UI (Settings → Branches → Add rule for `main`)
referencing the documented policy in
[`docs/security.md`](../security.md) § Branch protection.

### Phase 13 Gherkin suite fails post-scrub

The history rewrite SHOULD NOT affect tests against working-tree
content. A failure is a real signal: investigate before landing the
`ops(15-04)` follow-up commit. Do not proceed until root cause is
identified.

---

## Advisory issue templates

Both templates live in `.github/ISSUE_TEMPLATE/`:

- [`fsl-history-scrub-advance.md`](../../.github/ISSUE_TEMPLATE/fsl-history-scrub-advance.md)
  — T-24h advance notice (opened in Stage 2 above).
- [`fsl-history-scrub-cutover.md`](../../.github/ISSUE_TEMPLATE/fsl-history-scrub-cutover.md)
  — T+15min cutover-complete notice (opened in Stage 10 above).

Operators paste the body verbatim, filling the `<...>` placeholders
with the actual scrub T0 timestamp (advance) or the new HEAD SHA
(cutover).

---

## Operator checklist — exact sequence to execute the scrub

This is the SOLE actionable section of this runbook. Tick each box as
you go; do not skip steps; do not run them out of order.

- [ ] **C1.** Confirm `pre-fsl-relicense-2026-05-15` is on origin
      (`git ls-remote --tags origin | grep pre-fsl-relicense`).
- [ ] **C2.** From a fresh clone of `main`, run
      `bash tools/history-scrub.sh --dry-run`. Review output. Resolve
      every error before proceeding.
- [ ] **C3.** Push the local pre-scrub tag:
      `git push origin pre-fsl-scrub-2026-05-15`.
- [ ] **C4.** Open the T-24h advisory issue using
      `.github/ISSUE_TEMPLATE/fsl-history-scrub-advance.md`. Pin it.
      Post link in discussions. **Wait ≥ 24 hours.**
- [ ] **C5.** Lock `main` branch protection via
      `gh api -X PUT /repos/openwhispr/openwhispr-server/branches/main/protection ...`
      (Stage 3 above; the driver does this for you when `--force`).
- [ ] **C6.** Run `bash tools/history-scrub.sh --force` from a fresh
      clone. Watch each stage echo. Do NOT interrupt mid-stage.
- [ ] **C7.** Verify on github.com: new HEAD on `main`, surviving tags
      re-anchored, branch protection re-enabled.
- [ ] **C8.** Open the T+15min cutover advisory using
      `.github/ISSUE_TEMPLATE/fsl-history-scrub-cutover.md`, filling
      the new HEAD SHA and the date.
- [ ] **C9.** Open follow-up PR with ONE commit
      `ops(15-04): execute history scrub` filling:
      - `MIGRATING.md` POST-SCRUB-HEAD-SHA placeholder
      - `.github/dco.yml` `cutoff_sha: <NEW_HEAD>` (40-char full SHA)
- [ ] **C10.** Watch CI on the follow-up PR. Phase 13 Gherkin + `reuse
      lint` + `helm unittest` + `pnpm vitest run` + `pnpm test:spdx-header`
      MUST be GREEN. If any go red, **do not merge** — investigate
      first.
- [ ] **C11.** Merge the follow-up PR.
- [ ] **C12.** Re-sign signed tags listed by Stage 7
      (deferred-items #1, manual).

When every box is ticked, Phase 15-04 is closed.

---

## What this runbook does NOT cover (intentionally)

- **Signed-tag re-signing automation** — deferred to Phase 18+ if
  multiple history rewrites accrue. Manual today (deferred-items #1).
- **Cross-mirror sync** — corporate forks that mirror this repo will
  see the force-push. They follow the same recovery one-liners above;
  there is no special path.
- **Database migrations** — orthogonal to git history; covered by
  `docs/operations.md` § Database migrations.
- **Secret rotation post-scrub** — no secrets were ever committed to
  `speaches-audio.md`, so no rotation is required. If a future scrub
  removes a committed secret, follow `docs/security.md` § Secret
  rotation in addition to this runbook.
