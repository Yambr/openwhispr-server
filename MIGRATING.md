# Migration guide

## 2026-05-15 — Relicense from Apache-2.0 to FSL-1.1-ALv2

OpenWhispr Server has been relicensed from Apache License 2.0 to
**Functional Source License, Version 1.1, ALv2 Future License**
(`FSL-1.1-ALv2`), effective **2026-05-15**.

The full rationale, alternatives considered, contributor consent record,
and consequence analysis live in
[ADR-0013](docs/adrs/0013-fsl-relicense.md). This file is the short
operator-facing pointer.

### What changed

- **`LICENSE`** now carries the FSL-1.1-ALv2 verbatim text (fetched from
  https://fsl.software/FSL-1.1-ALv2.template.md).
- **SPDX headers** on every TS/TSX/JS/MJS/CJS source file flipped from
  `Apache-2.0` to `FSL-1.1-ALv2`.
- **DCO `Signed-off-by:` is now required** on every new commit (see
  `CONTRIBUTING.md`).
- **The repository will be force-pushed once** as part of Phase 15-04 to
  scrub a stale reference file (`speaches-audio.md`) from history. The
  force-push window is ≤ 7 minutes with branch protection re-locked
  before and after. The post-scrub HEAD SHA is recorded below once 15-04
  ships.

### 7-day notice window

A T-24h advisory issue + T+15min post-event issue will be opened by the
15-04 runbook around the force-push event. Active forkers and downstream
consumers should:

1. Fetch the pre-relicense tag: `git fetch origin tag pre-fsl-relicense-2026-05-15`.
2. Watch for the T-24h advisory issue with the precise scrub window.
3. After T+15min, re-clone or follow the Recovery one-liner below.

### Recovery (one-liner)

If you maintain a fork or active branch and want to **stay on Apache-2.0**
indefinitely (rebasing off the last Apache-2.0 HEAD):

```bash
# Fetch the pre-relicense tag (annotated, force-push-survivable).
git fetch origin tag pre-fsl-relicense-2026-05-15

# Create a long-lived Apache-2.0 fork branch from that tag.
git checkout -b apache-2.0-fork pre-fsl-relicense-2026-05-15
git push -u origin apache-2.0-fork
```

If you want to **adopt FSL-1.1-ALv2** and stay on `main` across the
force-push (the recommended path for most consumers):

```bash
# Wait for the T+15min advisory issue, then refresh local main.
git fetch origin
git checkout main
git reset --hard origin/main
```

If you have local in-flight branches, rebase them onto the new `main`
HEAD after the force-push completes; the per-commit content of every
post-scrub commit is identical to its pre-scrub counterpart except for
the relicense changes already landed in Plan 15-03.

The full Recovery section (including signed-tag re-anchoring, GHA cache
flushing, and corporate-mirror update procedures) lives in
[ADR-0013 § Recovery](docs/adrs/0013-fsl-relicense.md#recovery-for-downstream-consumers-who-need-to-stay-on-apache-20).

<!--
POST-SCRUB-HEAD-SHA placeholder.

Status (2026-05-15): the 15-04 plan-authoring run has shipped
`tools/history-scrub.sh`, `docs/runbooks/15-04-history-scrub.md`, and
the two `.github/ISSUE_TEMPLATE/fsl-history-scrub-*.md` advisory
templates. The actual `git filter-repo` + force-push has NOT yet run.

The operator, immediately after executing
`bash tools/history-scrub.sh --force`, captures the new HEAD SHA emitted
by Stage 10 and replaces this comment block with a "### Post-scrub HEAD"
section in the SAME atomic commit (subject
`ops(15-04): execute history scrub`) that also updates
`.github/dco.yml`'s `cutoff_sha`. Template for that section:

    ### Post-scrub HEAD (Phase 15-04 atomic event)

    - **Force-push date (UTC):** `<YYYY-MM-DDTHH:MMZ>`
    - **New `main` HEAD SHA:** `<NEW_HEAD_SHA>` (full 40 characters)
    - **Pre-scrub rollback tag:** `pre-fsl-scrub-2026-05-15` →
      `<PRE_SCRUB_TAG_SHA>` (preserved on origin, ~90-day reflog window)
    - **Recovery one-liner:** `git fetch origin && git reset --hard origin/main`

Until that commit lands, the value below is intentionally left as the
sentinel `<filled-by-15-04-execution>` — DO NOT replace it with a
guessed SHA. The runbook driver (`tools/history-scrub.sh` Stage 10)
emits the real SHA when the operator runs the force-push.

Sentinel value (replace verbatim in the ops commit):
POST-SCRUB-HEAD-SHA: <filled-by-15-04-execution>
-->

### Questions?

- **License rationale, alternatives, retroactive consent:** [ADR-0013](docs/adrs/0013-fsl-relicense.md).
- **DCO `Signed-off-by:` requirement:** [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **History scrub runbook (atomic event, 15-04):** `docs/runbooks/15-04-history-scrub.md` (authored in plan 15-04).
- **Open an issue:** https://github.com/Yambr/openwhispr-server/issues/new.
