# ADR-0013: Relicense to FSL-1.1-ALv2 with delayed Apache-2.0 grant

**Status:** accepted

**Date:** 2026-05-15

**Phase:** 15 — Repo Refactor + FSL Relicense + History Scrub (v2)

## Context

OpenWhispr Server is an open-source, enterprise-grade, self-hosted backend
distributed for use by hobbyists, OSS contributors, and enterprise operators
alike. Until 2026-05-15 it was licensed under Apache License 2.0 (ADR-0004),
which permits arbitrary commercial use including redistribution as a managed
service that competes directly with the project's own hosted offerings.

Since ADR-0004 was authored, the project surface has grown to include:

- A drop-in OpenWhispr backend that any organization can self-host — the
  exact substitution surface most at risk of "wrap-as-a-service" appropriation
  by hyperscalers and managed-AI vendors.
- A bundled LiteLLM Proxy abstraction layer with multi-tenancy primitives
  (RLS, BullMQ, anti-abuse rate limiting) that, taken together, are
  commercially valuable as a standalone competing product.
- An UI-SPEC-aligned web frontend (Phase 12 in flight at relicense time).

The project's commercial-protection requirements have shifted: we want
permissive use for internal/non-commercial/professional-services scenarios,
but we want a 2-year delayed grant before the work becomes Apache-2.0 and
freely available for competitive managed-service redistribution. This is
exactly the use case FSL was designed for (Sentry, Sourcegraph, GitButler,
Convex, Keygen precedent).

Forces at play:

- **Commercial sustainability** — without delayed permissive grant, larger
  organizations have no incentive to upstream improvements once they can
  fork-and-rebrand the entire backend as a managed service. FSL preserves
  the upstream investment loop for 2 years per release.
- **OSS ethos preservation** — FSL-1.1-ALv2 is "almost permissive" —
  internal use, education, research, and professional-services use are
  Permitted Purposes. Only Competing Use is restricted. The Future License
  grant guarantees that every release does become Apache-2.0 on its 2nd
  anniversary, preserving long-term OSS preservation.
- **Contributor consent** — FSL changes contributor obligations vs Apache-2.0.
  A retroactive consent thread is required (see Retroactive Consent
  section). Future contributions require a DCO `Signed-off-by:` line, with
  the cutoff SHA grandfathering all prior commits (filled by 15-04 once
  the post-scrub HEAD is known).
- **Dependency compatibility** — FSL-1.1-ALv2 outbound terms do not prevent
  consumption of MIT, BSD, ISC, Apache-2.0 inputs; existing dep policy
  remains in force.

## Decision

OpenWhispr Server is relicensed under **Functional Source License, Version
1.1, ALv2 Future License** (SPDX identifier `FSL-1.1-ALv2`), effective
2026-05-15.

The FSL grant has two phases per release:

1. **Years 0–2 from release date:** Permitted Purposes are permitted;
   Competing Use is restricted.
2. **Year 2+ from release date:** the release converts automatically to
   Apache License 2.0 via the Future License grant clause of FSL-1.1-ALv2.

Operational artifacts:

- **`LICENSE`** carries the FSL-1.1-ALv2 verbatim text fetched from
  https://fsl.software/FSL-1.1-ALv2.template.md (template SHA256
  `36b6082235c0a2105174927fc57cc6ae9c41f45a08af2bdcaee18a8dace56177`,
  3751 bytes).
- **`NOTICE`** records the relicense effective date, the pre-relicense
  annotated tag, and the patent grant + redistribution requirement.
- **`SPDX-License-Identifier: FSL-1.1-ALv2`** on line 1 (or line 2 after
  a shebang) of every TypeScript / TSX / JS / MJS / CJS source file under
  `apps/`, `packages/`, `tools/`, `compose/`, `scripts/`, `.github/`, and
  tests, enforced by `tools/spdx-header.ts` and the `reuse lint` CI gate.
- **`REUSE.toml`** at the repo root carries REUSE 3.3+ annotations covering
  every SPDX-managed file pattern, including patterns the in-tree codemod
  does not write headers for (`.sh`, `.py`, `.sql`, `.yaml`, `.yml`,
  `Dockerfile`, `.md`).
- **Every workspace `package.json`** declares `"license": "FSL-1.1-ALv2"`
  (baseline — previously absent across the workspace).
- **Every `Dockerfile`** under `apps/`, `images/`, `tools/`, `packages/`,
  and `compose/` declares
  `LABEL org.opencontainers.image.licenses="FSL-1.1-ALv2"`.
- **`README.md`** carries a shields.io FSL-1.1-ALv2 badge linking to the
  LICENSE file.

Contributor obligations:

- Every commit after the 15-04 history scrub cutoff SHA must carry a
  `Signed-off-by:` trailer per the Developer Certificate of Origin
  (https://developercertificate.org/). This is enforced by a DCO bot whose
  grandfather cutoff is the post-scrub HEAD SHA (filled in 15-04 once the
  rewrite lands). `CONTRIBUTING.md` carries the contributor-facing copy.

Supersession:

- This ADR **supersedes ADR-0004** (Apache-2.0 licensing). ADR-0004's
  header is patched to `**Status:** superseded by ADR-0013 (2026-05-15)`.

## Consequences

**Easier:**

- Project sustainability is improved: a 2-year delayed grant prevents
  Competing Use during the period when each release has the most commercial
  value, while preserving long-term OSS preservation.
- The Future License clause guarantees every release converts to Apache-2.0
  at its 2-year anniversary — no rug-pull risk for downstream consumers
  willing to pin to a 2-year-old release line.
- DCO `Signed-off-by:` adds a lightweight contribution-attribution
  audit trail; no CLA, no per-contributor signing ceremony.

**Harder:**

- Downstream consumers running OpenWhispr Server as a managed-SaaS competing
  product must either purchase a separate commercial license from the
  Licensor, switch to a 2-year-old release line, or stop. This is the
  intended effect.
- Maintainers must vet contributions for DCO compliance going forward (DCO
  bot handles this mechanically).
- `reuse lint` adds a new CI gate; Python toolchain (`pipx install reuse`)
  is now a CI dependency.
- The chart-releaser pipeline split (new `chart-release.yml` on
  `chart-v*` tags; existing `helm-release.yml` continues on `v*`) means
  chart semver is now decoupled from server semver. Operators upgrading
  the Helm chart must consult both lanes.

**Risks:**

- FSL is younger than Apache-2.0; enterprise legal teams may need a
  one-time review pass. Mitigation: the FSL FAQ at https://fsl.software/
  and the rapidly-growing precedent list (Sentry, Sourcegraph, Convex,
  GitButler, Keygen) provide an off-the-shelf rationale.
- GPL compatibility: FSL-1.1-ALv2 is not OSI-approved (this is by design;
  the Open Source Initiative defines "open source" as permissive at the
  time of release, while FSL is delayed-permissive). Mitigation: the
  project does not ship under an "OSI-approved" badge; the README badge
  reads `FSL-1.1-ALv2` honestly.
- Retroactive consent for pre-relicense commits is required (Apache-2.0
  contributors did not consent to FSL terms for their existing
  contributions). Mitigation: the relicense applies only to the project
  going forward; existing Apache-2.0 distributions remain Apache-2.0
  retroactively via the pre-fsl-relicense-2026-05-15 tag, which is
  preserved (orphan-reflog-protected ≥ 90 days) as the historical
  baseline for any downstream consumer who needs to rebase off the last
  Apache-2.0 commit.

## Recovery (for downstream consumers who need to stay on Apache-2.0)

Downstream consumers who do not wish to operate under FSL-1.1-ALv2 may
continue using the project under Apache-2.0 by rebasing off the
`pre-fsl-relicense-2026-05-15` annotated tag. The one-liner recovery
recipe:

```bash
# 1. Fetch the pre-relicense tag.
git fetch origin tag pre-fsl-relicense-2026-05-15

# 2. Reset your working tree to the last Apache-2.0 HEAD.
git checkout pre-fsl-relicense-2026-05-15

# 3. (Optional) create a long-lived Apache-2.0 fork branch.
git checkout -b apache-2.0-fork pre-fsl-relicense-2026-05-15
git push -u origin apache-2.0-fork
```

The pre-relicense tag is annotated, not lightweight, and is pushed to the
origin remote. Even after the Phase 15-04 history scrub, the tag remains
discoverable via `git fetch origin --tags` because force-push of `main`
does not delete annotated tags.

If you maintain a long-lived Apache-2.0 fork: future security-relevant
backports from upstream FSL-1.1-ALv2 releases to your Apache-2.0 fork are
permitted under the FSL Future License grant ONLY 2 years after each
upstream release. Earlier backports require either (a) direct commercial
license negotiation with the Licensor or (b) reimplementation. Either is
permitted; neither is required.

The full atomic-event runbook for the upcoming 15-04 history scrub
(which preserves the tag, force-pushes `main`, and re-locks branch
protection in ≤ 7 minutes) lives at
`docs/runbooks/15-04-history-scrub.md` (authored in plan 15-04).

## Retroactive consent

Pre-relicense contributors who hold copyright on commits up to the
pre-fsl-relicense-2026-05-15 tag are asked to record their consent to the
FSL-1.1-ALv2 relicense on a per-contributor basis. The retroactive consent
record lives at:

- **Tracking issue:** https://github.com/openwhispr/openwhispr-server/issues/TBD-RETROACTIVE-CONSENT
  (the issue number is filled in by 15-04 once the tracking issue is
  authored against the post-scrub HEAD; see the 15-04 runbook).
- **Cutoff SHA:** the post-scrub HEAD SHA (filled by 15-04). Commits at or
  before this SHA are grandfathered into FSL-1.1-ALv2 if the contributor
  is listed in the tracking issue with explicit consent.

For commits **after** the cutoff SHA, the DCO `Signed-off-by:` line in the
commit trailer serves as the per-commit affirmation of the FSL-1.1-ALv2
contributor license; no separate retroactive consent step is required for
post-cutoff commits.

Contributors who decline retroactive consent retain copyright on their
contributions under the original Apache-2.0 license; their work continues
to be redistributable in the `pre-fsl-relicense-2026-05-15` snapshot and
in any downstream Apache-2.0 fork rebased off that tag.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Retain Apache-2.0** (status quo, ADR-0004) | Permits unlimited Competing Use immediately upon release; no commercial-protection runway during the 2-year window when each release is most valuable. Fails the project's updated sustainability constraint. |
| **BUSL-1.1** (Business Source License) | Source-available but explicitly NOT open source (no permissive grant on release; converts only via Change License clause at vendor's discretion). Convertible to Apache-2.0 after a configurable Change Date — similar shape to FSL but with weaker upstream commitment. Rejected because FSL guarantees the Future License grant irrevocably whereas BUSL's Change License is per-release vendor-set. |
| **SSPL-1.0** | Stronger copyleft (Section 13 requires SaaS providers to open-source their entire orchestration stack). Mongo-style restriction. Rejected because it goes further than the project's commercial-protection need and creates more downstream-consumer friction than FSL does for internal-use scenarios. |
| **Elastic License v2** | Source-available; restricts hosted-service redistribution. Similar competitive-protection shape to FSL but lacks the FSL Future License clause — no automatic future Apache-2.0 grant. |
| **Dual MIT/commercial** | Maintenance overhead of a CLA; per-contributor signing ceremony; loses the "permissive by default" UX. |
| **Sustainable Use License (Sustainable OSS)** | Similar shape to FSL; smaller precedent base; less tooling support for SPDX identifier in scanners. |

The FSL precedent base (Sentry switched to FSL in 2023; Sourcegraph,
Convex, Keygen, GitButler followed) and the explicit Apache-2.0 future
grant clause made FSL-1.1-ALv2 the decisive winner over the alternatives.

## References

- **FSL canonical site:** https://fsl.software/
- **FSL-1.1-ALv2 template (fetched 2026-05-15, SHA256 36b6082235c0a2105174927fc57cc6ae9c41f45a08af2bdcaee18a8dace56177):** https://fsl.software/FSL-1.1-ALv2.template.md
- **DCO:** https://developercertificate.org/
- **REUSE specification:** https://reuse.software/spec/
- **SPDX FSL-1.1-ALv2 identifier:** https://spdx.org/licenses/FSL-1.1-ALv2.html
- **Sentry FSL announcement (precedent, 2023):** https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/
- **Predecessor ADR (superseded):** [ADR-0004](./0004-apache-2-0-licensing.md)
- **Plan:** [`.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-03-PLAN.md`](../../.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-03-PLAN.md)
- **Phase 15 CONTEXT:** [`.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-CONTEXT.md`](../../.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-CONTEXT.md)
- **Pre-relicense annotated tag:** `pre-fsl-relicense-2026-05-15` (last Apache-2.0 HEAD = commit `040a814`)
- **Post-scrub cutoff SHA:** filled by Plan 15-04 once `git filter-repo --path speaches-audio.md --invert-paths` lands and force-pushes the rewritten history.
