<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
---
name: "FSL history scrub — T-24h advance notice"
about: "Operator-only template: posted 24h before the Phase 15-04 force-push event."
title: "[ANNOUNCE] FSL history scrub — T-24h advance notice"
labels: [announcement, breaking]
assignees: []
---

# FSL history scrub — advance notice

> Operators: paste this verbatim, fill the `<...>` placeholders, then pin the issue.

## What is happening

The `main` branch of `openwhispr/openwhispr-server` will be **rewritten
via `git filter-repo`** on **`<UTC TIMESTAMP, e.g. 2026-05-16T14:00Z>`**
to remove the stale reference file `speaches-audio.md` from history.
This is the Phase 15-04 atomic event — see
[ADR-0013](../../docs/adrs/0013-fsl-relicense.md) for the full rationale.

The force-push window is expected to be **≤ 7 minutes** with branch
protection locked before and after.

## Why this is happening

`speaches-audio.md` was a temporary reference doc that was deleted in
the working tree before the FSL relicense. It still appears in git
history. Per **FSL-06**, the scrub is bundled into the same atomic
release event as the FSL relicense so contributors absorb one force-push,
not two.

## What you need to do

### If you maintain a fork of this repo

After the scrub completes (a follow-up `[DONE]` issue will be posted at
T+15min), refresh `main` with the recovery one-liner:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
```

### If you have in-flight work on a branch off `main`

1. Record the SHA your branch was based on (`git merge-base main <your-branch>`).
2. After T+15min, rebase onto the new `main`:
   ```bash
   OLD_BASE_SHA=<the SHA you recorded above>
   git fetch origin
   git rebase --onto origin/main "$OLD_BASE_SHA" <your-branch>
   ```
3. Add `Signed-off-by:` trailers to every rebased commit (DCO is enforced
   on every new commit per `CONTRIBUTING.md`):
   ```bash
   git rebase --signoff origin/main
   ```

### If you want to stay on the pre-FSL Apache-2.0 fork

Fetch the preserved annotated tag and base a long-lived fork branch off it:

```bash
git fetch origin tag pre-fsl-relicense-2026-05-15
git checkout -b apache-2.0-fork pre-fsl-relicense-2026-05-15
git push -u <your-remote> apache-2.0-fork
```

The `pre-fsl-relicense-2026-05-15` tag and the `pre-fsl-scrub-2026-05-15`
tag (the latter pushed in Stage 1 of the runbook) will both remain on
origin pointing at the **pre-rewrite** commit graph. GitHub keeps
orphaned commits reachable via tags for the standard reflog window
(~90 days).

## Where the full procedure lives

- Runbook: [`docs/runbooks/15-04-history-scrub.md`](../../docs/runbooks/15-04-history-scrub.md)
- ADR (the *why*): [`docs/adrs/0013-fsl-relicense.md`](../../docs/adrs/0013-fsl-relicense.md)
- Migration guide: [`MIGRATING.md`](../../MIGRATING.md)

## Questions

Reply to this issue. Maintainers will respond before T0.
