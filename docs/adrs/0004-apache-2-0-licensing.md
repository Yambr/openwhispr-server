# ADR-0004: Apache-2.0 licensing for OpenWhispr Server

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping

## Context

OpenWhispr Server is an open-source, self-hosted backend distributed for use by
hobbyists, OSS contributors, and enterprise operators alike. The project ships a
LiteLLM proxy, multi-tenancy primitives, observability glue, and a Helm chart —
all of which can land inside corporate networks and proprietary derivative
products. A license is required that:

- Permits commercial use, modification, and redistribution without compelling
  derivative-work disclosure.
- Includes an explicit patent grant covering contributor patent claims (the
  surface includes audio, ASR, LLM routing, OIDC, and rate-limit primitives —
  patent-rich territory).
- Is compatible with the project's third-party dependency licenses (MIT, BSD-2,
  BSD-3, Apache-2.0, ISC across pnpm graph).
- Is recognized as a top-tier permissive license by enterprise legal review so
  procurement cycles do not stall.

The LICENSE and NOTICE files were shipped pre-planner in commit `bd81d82` once
the license-choice question was resolved out of band; this ADR records the
decision for posterity.

## Decision

OpenWhispr Server is licensed under **Apache License, Version 2.0** (SPDX
identifier `Apache-2.0`). Every TypeScript and TSX source file under `apps/`,
`packages/`, and `tools/` carries an `SPDX-License-Identifier: Apache-2.0`
short-form header on line 1 (or line 2 if a shebang is present on line 1),
enforced mechanically by `tools/spdx-header.ts` and the `spdx-check` CI job.

A `NOTICE` file accompanies `LICENSE` per Apache-2.0 §4(d) and is preserved
in derivative redistributions. Documentation, Helm charts, and operator-facing
artifacts inherit the same license; locale resource bundles are licensed under
the same Apache-2.0 grant.

## Consequences

- **Easier:** unambiguous procurement story for enterprise adopters; explicit
  patent grant reduces patent-troll exposure for contributors and consumers;
  SPDX short-form headers enable automated SBOM generation and license-scan
  tooling (Trivy, Syft, FOSSA) without per-file ambiguity.
- **Harder:** the NOTICE file becomes a maintained artifact — every vendored
  third-party component with its own NOTICE must be merged in. CI does not
  enforce NOTICE drift today (Phase 11 candidate).
- **Risk:** Apache-2.0 is not GPL-compatible in the v2-only direction; we
  cannot consume GPLv2-only dependencies. Mitigated by the dependency policy
  (allowlisted permissive licenses) audited in Phase 7 security review.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **MIT** | No explicit patent grant; enterprise legal review flags the implicit-grant ambiguity as a concern for audio/LLM patent surface. |
| **BSD-3-Clause** | Same patent-grant gap as MIT, plus the no-endorsement clause adds attribution complexity for downstream packagers without offsetting benefit. |
| **AGPL-3.0** | Network-copyleft would force every operator running a hosted instance to publish their full corresponding source — fundamentally incompatible with the corporate self-host use case. |
| **MPL-2.0** | File-level copyleft is workable but rarer in the Node/TS ecosystem; weaker enterprise familiarity, weaker tooling coverage. |
| **Dual MIT/Apache-2.0** (Rust-style) | Adds licensing complexity without practical benefit for a Node monorepo; SPDX scanners handle dual-license but operators do not benefit. |

## References

- LICENSE (root, Apache-2.0 verbatim)
- NOTICE (root, attribution + copyright header)
- commit `bd81d82` (initial license drop, pre-planner)
- `tools/spdx-header.ts` (codemod + audit)
- `.github/workflows/spdx.yml` (CI gate)
- https://www.apache.org/licenses/LICENSE-2.0
- https://spdx.org/licenses/Apache-2.0.html
