---
phase: 10
plan: 10-03
subsystem: docs (architecture + i18n + security + readme + ops + auth + wire + litellm)
tags: [docs, oss, architecture, security, i18n, mermaid, operations, threat-model]
requires:
  - Phase 10 / Plan 10-01 (server-side i18n surface — i18next + LOCALES_DIR + users.locale + audit Cyrillic guard)
  - Phase 10 / Plan 10-02 (web-side i18n surface — Next.js Edge middleware + en/ru bundles + LanguageSwitcher)
  - Phase 9 / Plan 09 (Helm chart — LITELLM_BASE_URL override path + secrets schema)
  - Phase 8 (load harness + SLO publication — RTO/RPO targets cited)
  - Phase 6 (SSRF gate + pino redact policy + audit-log partitioning)
provides:
  - docs/architecture.md (421 lines; 5 mermaid blocks: 3 hot-path sequenceDiagrams, RLS flowchart, BullMQ topology flowchart)
  - docs/i18n.md (418 lines; operator locale guide, LOCALES_DIR mechanism, CLDR plural reference, troubleshooting)
  - docs/security.md (351 lines; posture summary, SSRF gate, secret loading, pino redact, audit-log threat model, 19-row threat-ID registry)
  - README.md extended (212 lines; <5 min quickstart, Apache-2.0 + languages badges, doc TOC, tech-stack table, project goals)
  - docs/operations.md extended (588 -> 1046 lines; upgrade/scale/restore/i18n runbooks)
  - docs/auth.md extended (234 -> 289 lines; users.locale lifecycle + email locale flow)
  - docs/wire-contract.md extended (217 -> 275 lines; v2-deferred rationale + locale-driven envelope note)
  - docs/litellm-target-spec.md extended (240 -> 284 lines; Helm corporate-override knobs)
affects:
  - README.md (full rewrite of quickstart section)
  - docs/architecture.md (new)
  - docs/i18n.md (new)
  - docs/security.md (new)
  - docs/operations.md (upgrade + scale + restore + i18n sections appended before "Future phases")
  - docs/auth.md (Phase 10 users.locale section appended)
  - docs/wire-contract.md (v2-deferred rationale + envelope-locale section appended)
  - docs/litellm-target-spec.md (Helm cross-reference section appended)
tech-stack:
  added: []
  patterns: [mermaid sequenceDiagram + flowchart for component diagrams, consolidated threat-ID registry table, operator-facing doc layout (posture/config/troubleshooting)]
key-files:
  created:
    - docs/architecture.md
    - docs/i18n.md
    - docs/security.md
    - .planning/phases/10-i18n-docs-oss-housekeeping/10-03-SUMMARY.md
  modified:
    - README.md
    - docs/operations.md
    - docs/auth.md
    - docs/wire-contract.md
    - docs/litellm-target-spec.md
decisions:
  - "docs/architecture.md hosts the canonical hot-path sequence diagrams (transcribe, /v1/realtime WSS :8443, /api/agent/stream NDJSON) plus the RLS chokepoint flowchart and the 9-queue BullMQ topology — single source of truth for new contributors."
  - "docs/i18n.md is the operator-facing entry point; the constitutional English-only rule and the i18n surface allow-list are documented there with cross-links to lint-english.ts and the audit-log Cyrillic guard."
  - "docs/security.md consolidates the threat-ID registry from all phases (19 rows) so the verifier agent has a single source for `gaps_found` heuristics."
  - "README quickstart targets <5 min from clone to first /api/transcribe call; chosen path is mailpit-mediated email verification (dev profile) + GROQ_API_KEY (cheapest Whisper)."
  - "operations.md upgrade runbook treats Helm rollback as safe because Phase 9 enforces additive-only migrations via the lint-migrations CI gate."
  - "wire-contract.md frames v2-deferred Stripe + referrals as a load-bearing CONTRACT-01 invariant (404 + canonical envelope) rather than a documentation-only deferral."
  - "litellm-target-spec.md Helm cross-reference documents the litellm.mode=external knob that skips both the bundled Deployment and the spend-log scheduler when the corporate proxy ingests its own ledger."
metrics:
  duration: ~11 minutes
  tasks-completed: 5
  commits: 5
  files-touched: 8
  lines-added: 1052 (architecture 421 + i18n 418 + security 351 + readme +148 + ops +458 + auth +55 + wire +58 + litellm +44 — gross before edits)
---

# Phase 10 Plan 10-03: Docs Suite Summary

One-liner: Shipped the OSS documentation surface — 3 new docs
(architecture, i18n, security) and 5 extended docs (README,
operations, auth, wire-contract, litellm-target-spec) all
cross-linked through the README documentation index and gated by
`pnpm lint:english`.

## Tasks delivered

| Task | Name                                                          | Commit  | Files                                          |
| ---- | ------------------------------------------------------------- | ------- | ---------------------------------------------- |
| 1    | Write docs/architecture.md with three hot-path mermaid diagrams | f0f5726 | docs/architecture.md (new, 421 lines, 5 mermaid blocks) |
| 2    | Write docs/i18n.md operator locale guide                       | e7c6762 | docs/i18n.md (new, 418 lines)                  |
| 3    | Write docs/security.md posture and threat-model index          | 3b57cb8 | docs/security.md (new, 351 lines)              |
| 4    | Extend readme quickstart and operations runbooks               | fcd6458 | README.md (212), docs/operations.md (1046)     |
| 5    | Audit and extend auth wire-contract and litellm-target-spec    | 5537ec2 | docs/auth.md (289), docs/wire-contract.md (275), docs/litellm-target-spec.md (284) |

## Verification

All `<verify>` blocks green:

- `docs/architecture.md`: 421 lines (≥350), 5 mermaid blocks (≥4), lint-english green.
- `docs/i18n.md`: 418 lines (≥180), LOCALES_DIR present, `one/few/many/other` present, lint-english green.
- `docs/security.md`: 351 lines (≥220), SSRF + redact present, lint-english green.
- `README.md`: 212 lines (≥180), Apache-2.0 badge present, full quickstart present, lint-english green.
- `docs/operations.md`: 1046 lines (≥700), LOCALES_DIR runbook present, lint-english green.
- `docs/auth.md`: 289 lines (≥260), `users.locale` section added.
- `docs/wire-contract.md`: 275 lines (≥250), v2-deferred + envelope-locale sections added.
- `docs/litellm-target-spec.md`: 284 lines (≥250), Helm corporate-override section added.

All 8 touched docs pass `pnpm lint:english`. The README documentation
table-of-contents resolves to existing files in-repo (manual sweep).

## Decisions Made

See frontmatter `decisions` block. Highlights:

1. **architecture.md hosts the canonical mermaid diagrams** for the
   three hot paths (transcribe, realtime WSS, agent stream NDJSON),
   the RLS chokepoint, and the 9-queue BullMQ topology. This is the
   single source new contributors are pointed at.
2. **i18n.md is operator-facing first** — the constitutional
   English-only rule and the allow-list summary live there for ease
   of operator review, with deep links back to `tools/lint-english.ts`
   and `apps/api/src/lib/audit.ts`.
3. **security.md consolidates the threat-ID registry** — 19 rows
   covering phases 1-10. The verifier agent can use this table as a
   single source for `gaps_found` checks rather than crawling every
   plan's `<threat_model>` block.
4. **README quickstart targets <5 min** by composing the cheapest
   hosted-Whisper path (`GROQ_API_KEY`) with mailpit (dev profile)
   for verification email. Operators wanting full e2e use mailpit's
   web UI at `http://localhost:8025`.

## Deviations from Plan

None — plan executed exactly as written. All 5 task `<verify>` blocks
satisfied on first run; no Rule 1-3 auto-fixes were needed.

## Known Stubs

None. Every linked file in the README documentation TOC is present
in-repo at the path linked. Every cross-link inside the new docs
points to an existing target (verified by manual sweep).

## Threat Flags

None. The docs suite documents existing threat surface; it does not
introduce new security-relevant code paths.

## Cross-references

- Wave 1 of Phase 10 closed with this plan (10-01a/b/c/d + 10-02 + 10-03).
- Wave 3 (Plan 10-04) covers SPDX header codemod, CODEOWNERS, issue
  templates, CoC 2.1, and ADRs 0004-0011 — explicitly out of scope here.
- The README documentation TOC is the canonical entry point for
  contributors and operators going forward.

## Self-Check: PASSED

Files verified to exist:
- FOUND: docs/architecture.md
- FOUND: docs/i18n.md
- FOUND: docs/security.md
- FOUND: README.md (extended)
- FOUND: docs/operations.md (extended)
- FOUND: docs/auth.md (extended)
- FOUND: docs/wire-contract.md (extended)
- FOUND: docs/litellm-target-spec.md (extended)

Commits verified to exist:
- FOUND: f0f5726 (docs(10-03): write docs/architecture.md ...)
- FOUND: e7c6762 (docs(10-03): write docs/i18n.md ...)
- FOUND: 3b57cb8 (docs(10-03): write docs/security.md ...)
- FOUND: fcd6458 (docs(10-03): extend readme quickstart and operations runbooks)
- FOUND: 5537ec2 (docs(10-03): audit and extend auth wire-contract and litellm-target-spec)

Lint gates verified:
- `pnpm lint:english` PASSED on every touched doc.
- `lefthook commit-msg` (commitlint) PASSED on every commit.
