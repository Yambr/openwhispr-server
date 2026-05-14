<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
---
name: "FSL history scrub — cutover complete"
about: "Operator-only template: posted T+15min after the Phase 15-04 force-push event."
title: "[DONE] FSL history scrub — cutover complete"
labels: [announcement]
assignees: []
---

# FSL history scrub — cutover complete

> Operators: paste this verbatim, fill the `<...>` placeholders, then unpin the
> T-24h `[ANNOUNCE]` issue and pin THIS one for ~7 days.

## Status

The Phase 15-04 history scrub completed successfully at
**`<UTC TIMESTAMP OF FORCE-PUSH>`**.

## New HEAD SHA

The new `main` HEAD SHA (post-scrub) is:

```
<NEW_HEAD_SHA — full 40-character SHA, e.g. 1234abcd...>
```

The pre-scrub `main` tip (the orphan-reachable rollback anchor) is
preserved on `pre-fsl-scrub-2026-05-15`:

```
<PRE_SCRUB_TAG_SHA — full 40-character SHA>
```

## What you need to do — recovery one-liners

### To stay on the new (post-scrub) `main`

```bash
git fetch origin
git checkout main
git reset --hard origin/main
```

This is the **recommended path** for most consumers. The per-commit
*content* of every post-scrub commit is identical to its pre-scrub
counterpart (modulo the `speaches-audio.md` removal). Only the SHAs
shifted.

### To rebase in-flight branches

```bash
OLD_BASE_SHA=<the SHA you recorded from the T-24h advisory>
git fetch origin
git rebase --onto origin/main "$OLD_BASE_SHA" <your-branch>
git rebase --signoff origin/main   # adds DCO trailer per CONTRIBUTING.md
```

### To stay on the pre-FSL Apache-2.0 fork

```bash
git fetch origin tag pre-fsl-relicense-2026-05-15
git checkout -b apache-2.0-fork pre-fsl-relicense-2026-05-15
git push -u <your-remote> apache-2.0-fork
```

## DCO grandfather cutoff

The DCO GitHub App is configured (in `.github/dco.yml`) with
`cutoff_sha: <NEW_HEAD_SHA above>`. Every commit AT OR BEFORE that SHA
is grandfathered into the FSL-1.1-ALv2 grant via the retroactive
consent record referenced in ADR-0013. Every commit AFTER that SHA
MUST carry a `Signed-off-by:` trailer (`git commit --signoff`).

## Where to read more

- Migration guide: [`MIGRATING.md`](../../MIGRATING.md)
- Runbook (mechanics): [`docs/runbooks/15-04-history-scrub.md`](../../docs/runbooks/15-04-history-scrub.md)
- ADR (the *why*): [`docs/adrs/0013-fsl-relicense.md`](../../docs/adrs/0013-fsl-relicense.md)
- DCO policy: [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § Developer Certificate of Origin

## Open issues / follow-up

- Signed-tag re-sign (deferred-items #1): the following tags lost their
  signatures across the rewrite and need manual re-sign by their
  original tagger:

  ```
  <list of signed tags emitted by Stage 7 of the runbook>
  ```

- If you encounter any anomaly post-cutover (CI failures on rebased
  branches, missing artifacts, broken cross-mirror sync), reply to this
  issue with the precise error message and the SHA you are working
  against.
