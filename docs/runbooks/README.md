<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->

# Operational Runbooks

This directory holds **executable operator runbooks** — step-by-step
procedures for one-shot, high-stakes, out-of-band operational events that
do not fit the normal pull-request review flow. Examples: history
rewrites, security incident response, datastore migrations, key rotation,
license-change cutovers.

Each runbook MUST:

1. State its preconditions (what must be true before starting).
2. Enumerate every step the operator runs, with the exact command line.
3. List a recovery procedure for the most likely failure modes.
4. Identify the owning ADR (the *why*) the runbook implements.
5. Be paired with a driver script under `tools/` where automation is
   feasible (`tools/<runbook-name>.sh`) and a test for that driver under
   `tools/<runbook-name>.test.sh`.

The runbook drivers default to refusing to execute without `--dry-run`
or `--force`. Operators MUST run `--dry-run` first, review the output,
then re-run with `--force` to perform the real mutation.

## Index

| Runbook | Phase | Driver script | Owning ADR |
|---|---|---|---|
| [`15-04-history-scrub.md`](./15-04-history-scrub.md) | 15-04 | [`tools/history-scrub.sh`](../../tools/history-scrub.sh) | [ADR-0013](../adrs/0013-fsl-relicense.md) |

Future runbooks should follow the `NN-MM-<short-name>.md` naming
convention where `NN-MM` is the phase + plan identifier and
`<short-name>` is the canonical event slug.
