## Phase 15 — History-Scrub Atomic Event Mechanics

Research scope: how to execute `git filter-repo --path speaches-audio.md --invert-paths` bundled with FSL relicense (FSL-06 + FSL-07) as ONE atomic release event. Four sub-areas (A–D), each with a table + rationale, then a coherent combined runbook.

---

### Sub-A. Order: scrub BEFORE FSL codemod, or AFTER?

| Option | Pros | Cons | Complexity | Recommendation |
|--------|------|------|------------|----------------|
| Order 1: scrub first → FSL codemod on clean history → ONE force-push | Single linear new history; FSL commits are reviewable as normal PRs *after* event; rollback tag points at pre-scrub state cleanly | Requires offline window for FSL codemod to land on the rewritten tip before force-push, OR a second push later (violates one-force-push rule) | Surface: all of `main` rewritten. Risk: FSL codemod must be staged locally pre-push | Rec if FSL codemod is small enough to land as 1-3 commits squashed locally pre-push |
| Order 2: FSL codemod merged via normal PRs first → scrub at the end | FSL changes get full PR review + CI on real GitHub before the disruptive event; speaches-audio.md scrub becomes the *only* atomic operation | FSL commits' SHAs change after filter-repo (any commit that touched `speaches-audio.md` adjacent files gets rewritten too if path-rename); signed tags on FSL release invalidated | Surface: every commit SHA from root → HEAD shifts. Risk: signed tags re-sign required | Rec if FSL codemod needs public review before disruption — most OSS-friendly path |
| Order 3: side branch `release/fsl-scrub` with both → atomic ref-swap on push | Visible PR artifact; reviewable; admin can fast-forward `main` to side-branch tip with force-push setting | Side branch must be kept in sync; GitHub PR UI degrades on rewritten-history PRs (diff is huge); reviewers see the post-scrub world only | Surface: side branch built clean, swapped in. Risk: review fatigue, drift if `main` moves during prep | Rec if team wants a PR artifact for audit trail but accepts the noisy diff |

**Rationale:** For a 1556-line spec project with active small-team contributors and a protected `main`, **Order 2 (FSL codemod first via normal PRs, then scrub as the single force-push event)** matches industry precedent — Homebrew's 2017 cleanup and Rails' filter-branch event both staged content changes *first* via normal review, then did the destructive rewrite as a separate announced event. This keeps FSL changes auditable on real CI and isolates the force-push to one cause (speaches-audio.md removal), which matches the project's "ONE force-push total" constraint from PITFALLS §10. The scrub will rewrite the FSL commits' SHAs too, but that's a tag re-sign chore, not a review-lost chore.

---

### Sub-B. Force-push window safety

| Option | Pros | Cons | Complexity | Recommendation |
|--------|------|------|------------|----------------|
| α: lock main → local filter-repo → force-push → unlock | Shortest objective window (5–10 min); minimal moving parts; no PR review artifact to mislead reviewers | No external audit artifact; relies on operator discipline; in-flight PRs silently invalidated mid-window | Surface: 1 admin, 1 fresh clone, 1 push. Risk: operator error has no review backstop | Rec if team is ≤3 maintainers and trust-by-protocol works |
| β: `release/fsl-scrub` branch → admin PR with "allow force-push" → admin-merge | Visible artifact; CI runs on rewritten history before swap; reviewable | Longer window (PR review + CI = 30–90 min); GitHub PR diff on rewritten history is unreadable; force-push setting on protected branch is a foot-gun | Surface: branch protection rule edit + PR + merge. Risk: foot-gun stays on after event if not reverted | Rec if compliance/audit requires a PR trail |
| γ: announce hard freeze 24–72h → freeze → force-push → unfreeze | Safest for in-flight contributor work; everyone has time to push outstanding branches; communication-first | Long freeze blocks all contribution; overkill for small team; doesn't actually shorten the force-push window itself | Surface: announce + wait + push. Risk: contributors miss notice | Rec if project has >10 active external contributors with in-flight PRs |

**Rationale:** Small-team OSS context (≤5 active contributors, ~830 unmerged local commits ahead of origin means the active dev is solo right now) makes **Approach α (lock-do-unlock)** the right fit. The force-push window itself is identical across all three approaches — what changes is the announcement/audit envelope. With a small team, a short pre-event advisory issue (T-24h) + lock + push + unlock + post-event issue gives the same safety as approach γ without blocking dev for days. Industry precedent: Homebrew's history-rewrite events used short-locked windows, not multi-day freezes. The branch-protection toggle should be scripted (`gh api -X PATCH /repos/.../branches/main/protection`) so the lock/unlock is two `gh` invocations, not a clickfest.

---

### Sub-C. Contributor recovery doc location

| Option | Pros | Cons | Complexity | Recommendation |
|--------|------|------|------------|----------------|
| `MIGRATING.md` only (FSL-01 artifact) | Discoverable at repo root; canonical OSS convention; one file to find | Mixes license-migration concerns with history-rewrite recipe; future readers (post-event) won't need the recipe | Surface: 1 file. Risk: doc rots after event but stays prominent | Rec if FSL-01 is the only contributor-facing migration doc |
| `docs/adrs/0013-fsl-relicense.md` runbook section only | ADR is the durable architectural record; recipe lives with the decision it implements | Less discoverable for contributors who don't browse ADRs; not at repo root | Surface: 1 file deeper in tree. Risk: contributors miss it | Rec if team uses ADRs as primary doc surface |
| Both: short pointer in `MIGRATING.md` → full recipe in ADR-0013 | Discoverable AND durable; `MIGRATING.md` can later shrink to "see ADR-0013 §Recovery"; ADR captures the *why* alongside the *how* | Two files to keep in sync; duplication risk if not pointer-only | Surface: 2 files, one is pointer. Risk: drift if both expand independently | Rec — discoverability via root + durability via ADR matches enterprise-grade doc discipline |

**Rationale:** The project already uses `docs/adrs/` (per gitStatus context — Phase 12 referenced ADRs). The recovery recipe — `git fetch origin && git reset --hard origin/main` for clean checkouts, or `git rebase --onto origin/main <old-base-sha-recorded-in-advisory> <work-branch>` for in-flight branches — belongs in ADR-0013 as the durable record alongside the FSL decision rationale, with `MIGRATING.md` carrying a short pointer + the one-liner `git reset --hard` for the 90% case. This matches the "every requirement ships with corresponding documentation" constitutional rule and the FSL-04 DCO requirement that contributors re-read contribution docs anyway.

---

### Sub-D. Signed-commit / DCO re-signing strategy

| Option | Pros | Cons | Complexity | Recommendation |
|--------|------|------|------------|----------------|
| Backfill `Signed-off-by:` retroactively via `git filter-repo --commit-callback` | Every commit in history carries DCO trailer; DCO bot passes for old commits too; cleanest from a compliance-bot perspective | Retroactive DCO is arguably *false* — original committers didn't actually sign at commit time; project-history revisionism; some DCO interpretations forbid this | Surface: filter-repo callback adds 1 trailer per commit. Risk: legal/optics — "did they really sign?" | Not recommended — DCO is an attestation at commit time, not a label |
| Only require sign-off on NEW commits (post-event) | Honest: DCO attestation applies from FSL-04 forward; matches how cert-manager / Linux kernel introduced DCO mid-stream | DCO bot may fail on old PRs that get rebased onto new `main`; need bot config to grandfather pre-event commits | Surface: DCO bot config + advisory. Risk: contributors with in-flight branches must `--signoff` on rebase | Rec — honest, matches industry practice (kernel, cert-manager) |
| Hybrid: backfill on rewritten commits only (which are now "new" SHAs), require on future commits | Technically every commit on post-event `main` has the trailer; semi-honest because rewritten commits *are* new objects | Same revisionism concern as option 1, just narrower; complicates the filter-repo callback | Surface: filter-repo callback + bot config. Risk: same optics issue, smaller surface | Rec if DCO bot can't be configured to grandfather — a tool-constraint fallback |

**Rationale:** DCO is a *legal attestation by the committer at the time of commit* (Linux Foundation framing). Retroactively stamping `Signed-off-by:` on commits the original author never signed is arguably a misrepresentation, even if the committer email matches. Industry precedent (Linux kernel adopting DCO in 2004, cert-manager mid-stream adoption) introduces DCO going-forward and configures the DCO bot to grandfather pre-cutoff commits via a commit-date or SHA-allowlist. **Require sign-off on new commits only**, document the cutoff SHA (the post-scrub `main` tip) in ADR-0013, and configure the DCO GitHub App with that cutoff. This sidesteps the filter-repo callback complexity entirely and is the honest answer.

---

## Combined Recommended Runbook (10-step ordered checklist)

Coherent combo: **A2 + Bα + C-both + D-new-only**. Single force-push, FSL codemod reviewed normally first, scrub is the lone atomic event.

1. **T-7d:** Land all FSL codemod commits (FSL-01..FSL-05) via normal PRs on `main`. Includes `MIGRATING.md` (pointer) + `docs/adrs/0013-fsl-relicense.md` (full runbook + recovery recipe + DCO cutoff policy). DCO bot NOT yet enforced.
2. **T-24h:** Open contributor advisory issue: "History rewrite scheduled <UTC timestamp>; push outstanding work; record your branch base-SHA." Pin issue + post to discussions.
3. **T-0 −5min:** On the operator's box, fresh `git clone --mirror` of origin into a throwaway dir. Verify HEAD matches expected SHA. Run `git filter-repo --analyze` and snapshot the report.
4. **T-0:** Create + push annotated rollback tag `pre-fsl-scrub-2026-05-15` pointing at current `origin/main` (signed with maintainer GPG key).
5. **T-0 +1min:** Lock branch protection on `main` via `gh api -X PATCH /repos/{owner}/{repo}/branches/main/protection` (set `enforce_admins=true`, disable pushes to all). Scripted, idempotent.
6. **T-0 +2min:** Run `git filter-repo --path speaches-audio.md --invert-paths --force` in the fresh mirror clone. Verify `speaches-audio.md` absent from `git log --all -- speaches-audio.md` (should be empty).
7. **T-0 +5min:** `git push --force origin main` + `git push --force --tags origin` (only tags surviving filter-repo; the `pre-fsl-scrub-*` tag from step 4 was pushed *before* the filter and is preserved on origin pointing at the old commit graph — verify it still resolves on GitHub UI).
8. **T-0 +6min:** Invalidate GHA caches: GitHub UI → Actions → Caches → "Delete all", OR scripted via `gh api -X DELETE /repos/{owner}/{repo}/actions/caches?key=...` in a loop. Bump `CACHE_VERSION` repo variable as a belt-and-braces measure so any cache key referencing it auto-busts.
9. **T-0 +8min:** Unlock branch protection (revert step 5's PATCH). Enable DCO GitHub App with cutoff = new `main` HEAD SHA (grandfather all pre-cutoff commits). Close all currently-open PRs against `main` with a templated comment pointing to ADR-0013 §Recovery + the contributor advisory issue, asking authors to rebase onto new `main` with `--signoff` and reopen.
10. **T-0 +15min:** Post completion notice on the advisory issue with: new `main` HEAD SHA, the preserved `pre-fsl-scrub-2026-05-15` tag SHA for rollback, the recovery one-liner (`git fetch origin && git reset --hard origin/main` for clean checkouts; `git rebase --onto origin/main <recorded-base-sha> <work-branch>` then `git rebase --signoff` for in-flight work), and the DCO cutoff SHA. Re-sign any pre-event signed release tags whose target commits got rewritten (typically: re-tag at the new SHA with `-rewritten` suffix, keep originals as historical artifacts pointing into the orphaned old graph).

**Window:** branch protection locked for ~7 minutes (steps 5→9). One force-push to `main`. One force-push for tags. GHA caches busted. Advisory communicated pre- and post-event. DCO honest. Rollback tag preserved on origin pointing at the pre-rewrite graph (GitHub keeps orphaned commits reachable via tags for the standard reflog window — typically 90 days — giving a generous undo runway).

---

Sources:
- [git-filter-repo (newren/git-filter-repo)](https://github.com/newren/git-filter-repo)
- [git-filter-repo manpage](https://www.mankier.com/1/git-filter-repo)
- [Removing large files: filter-repo & BFG (DeployHQ)](https://www.deployhq.com/git/removing-large-files-from-git-history)
- [Git History Rewrite at Scale (Opstree, 2026)](https://opstree.com/blog/2026/04/07/git-history-rewrite-at-scale-removing-100mb-files-safely/)
- [Remove files from Git history using git-filter-repo (Marco Franssen)](https://marcofranssen.nl/remove-files-from-git-history-using-git-filter-repo)
- [GitHub Actions cache invalidation (amlab)](https://lab.amalitsky.com/posts/2022/github-actions-cache-invalidation/)
- [actions/cache docs](https://github.com/actions/cache)
- [Managing commit signoff policy (GitHub Docs)](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-commit-signoff-policy-for-your-repository)
- [DCO sign-off (cert-manager)](https://cert-manager.io/docs/contributing/sign-off/)
- [Fix DCO retroactively (src-d/guide)](https://github.com/src-d/guide/blob/master/developer-community/fix-DCO.md)
- [Sign-off multiple previous git commits (pmhahn)](https://blog.pmhahn.de/git-signoff/)
