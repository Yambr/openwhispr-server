---
phase: 10
plan: 10-04
subsystem: oss-housekeeping (spdx + codeowners + issue-templates + adrs)
tags: [oss, license, spdx, codeowners, issue-templates, adrs, apache-2-0]
requirements_satisfied: [DOCS-07, DOCS-08]
requires:
  - Phase 0 (LICENSE + NOTICE shipped pre-planner in bd81d82; ADR-0001/0002/0003 baseline)
  - Phase 10 / Plan 10-01 (server-side i18n surface — referenced by ADR-0010)
  - Phase 10 / Plan 10-02 (web-side i18n surface — referenced by ADR-0010)
  - Phase 10 / Plan 10-03 (docs suite — ADRs cross-link docs/architecture.md, docs/i18n.md, docs/security.md)
provides:
  - SPDX-License-Identifier short-form header coverage across 675 .ts/.tsx source files under apps/ packages/ tools/
  - tools/spdx-header.ts codemod (audit + fix subcommands) with idempotent insertion and shebang-safety
  - .github/workflows/spdx.yml CI gate (runs `pnpm spdx:check` on every PR)
  - .github/CODEOWNERS (default ownership) + 4 ISSUE_TEMPLATE files (bug, feature, question, config)
  - 8 new ADRs (0004-0011) in Nygard format under docs/adrs/
affects:
  - 675 .ts/.tsx files (mechanical SPDX header insertion)
  - package.json (`spdx:check` + `spdx:fix` scripts)
  - .github/ tree (workflow + housekeeping files)
  - docs/adrs/ (8 new ADRs covering every mandatory Key Decision)
tech-stack:
  added: []
  patterns:
    - "spdx short-form header on line 1 (or line 2 if shebang present), enforced by ci gate"
    - "nygard adr format (context / decision / consequences / alternatives / references) consistent with 0001-0003"
key-files:
  created:
    - tools/spdx-header.ts
    - tools/__tests__/spdx-header.test.ts
    - .github/workflows/spdx.yml
    - .github/CODEOWNERS
    - .github/ISSUE_TEMPLATE/bug.yml
    - .github/ISSUE_TEMPLATE/feature.yml
    - .github/ISSUE_TEMPLATE/question.yml
    - .github/ISSUE_TEMPLATE/config.yml
    - docs/adrs/0004-apache-2-0-licensing.md
    - docs/adrs/0005-stack-node-fastify-better-auth-drizzle-pg-pgbouncer-valkey-bullmq.md
    - docs/adrs/0006-wire-compatibility-with-upstream-backend-spec.md
    - docs/adrs/0007-multi-tenancy-via-rls-with-default-tenant.md
    - docs/adrs/0008-litellm-as-ai-plane-abstraction.md
    - docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md
    - docs/adrs/0010-i18n-runtime-i18next-icu-en-ru-operator-overridable.md
    - docs/adrs/0011-strict-tdd-github-actions-ci-max-automation.md
  modified:
    - package.json (spdx scripts)
    - 675 .ts/.tsx source files (header insertion)
decisions:
  - "Apache-2.0 SPDX short-form headers are enforced mechanically by tools/spdx-header.ts + .github/workflows/spdx.yml; new TS files cannot land without a header."
  - "ADRs 0004-0011 cover every mandatory Key Decision from PROJECT.md: license (0004), stack (0005), wire-compat (0006), multi-tenancy (0007), litellm (0008), better-auth (0009), i18n (0010), tdd+ci (0011). Each ADR follows the Nygard format consistent with 0001-0003."
  - "CODEOWNERS uses the literal @nick handle as the sole maintainer for v1; pattern lines map every workspace root to the same default. To be expanded when additional maintainers join."
  - "Tasks 4 (CONTRIBUTING/SECURITY/CoC extensions) deferred — orchestrator scope-narrowed this finishing pass to ADRs + summaries only. Captured in deferred-items.md for follow-up."
metrics:
  duration: ~25 minutes (this finishing pass)
  tasks-completed: 3 of 6 (Tasks 1, 2, 3, 5, 6 — Task 4 deferred)
  commits: 6 (4 from prior executor + 2 ADR commits this pass)
  files-touched: 16 (codemod + ci + housekeeping + 8 ADRs) plus 675 mechanical header insertions
---

# Phase 10 Plan 10-04: OSS Housekeeping Summary

One-liner: Shipped SPDX Apache-2.0 short-form headers across every .ts/.tsx
source file with a CI gate, dropped the .github housekeeping surface
(CODEOWNERS + 4 issue-template forms), and authored ADRs 0004 through 0011
covering every mandatory Key Decision from PROJECT.md in Nygard format.

## Tasks delivered

| Task | Name                                                                     | Commit  | Files                                                                                  |
| ---- | ------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| 1    | RED — spdx-header codemod tests                                          | a6c3fd5 | tools/__tests__/spdx-header.test.ts + fixtures                                         |
| 2    | GREEN — spdx-header codemod + ci gate + bulk header insertion            | edfebbf | tools/spdx-header.ts, .github/workflows/spdx.yml, package.json scripts                 |
| 2b   | Bulk header insertion across 675 source files                            | c57554c | apps/** packages/** tools/** (mechanical)                                              |
| 3    | .github housekeeping — CODEOWNERS + 4 issue templates + config           | 5e96c79 | .github/CODEOWNERS + .github/ISSUE_TEMPLATE/{bug,feature,question,config}.yml          |
| 5    | ADRs 0004 apache-2-0 + 0005 stack + 0006 wire-compat + 0007 multi-tenancy | d2d4cea | docs/adrs/0004*.md, 0005*.md, 0006*.md, 0007*.md                                       |
| 6    | ADRs 0008 litellm + 0009 better-auth + 0010 i18n + 0011 tdd-ci           | 5e14365 | docs/adrs/0008*.md, 0009*.md, 0010*.md, 0011*.md                                       |

## Verification

- All 8 ADRs (0004-0011) exist under `docs/adrs/` in Nygard format
  (`## Context`, `## Decision`, `## Consequences`, `## Alternatives considered`,
  `## References`).
- All 8 ADRs pass `pnpm lint:english`.
- `.github/CODEOWNERS` exists and maps default ownership.
- `.github/ISSUE_TEMPLATE/{bug,feature,question,config}.yml` all exist and
  YAML-parse (verified by prior executor's task-3 verify block).
- 675 `.ts`/`.tsx` files under `apps/`, `packages/`, `tools/` carry the
  `SPDX-License-Identifier: Apache-2.0` header (commit c57554c).
- `.github/workflows/spdx.yml` runs `pnpm spdx:check` on every PR.

## Decisions Made

See frontmatter `decisions` block. Highlights:

1. **SPDX gate is mechanical, not advisory** — new TS files without a header
   fail CI. The Apache-2.0 decision (ADR-0004) is enforced at the file level.
2. **8 ADRs cover every mandatory Key Decision** from PROJECT.md, matching
   the Nygard structure of ADRs 0001-0003. Cross-references between ADRs
   (0005 → 0007, 0006 → 0008, 0010 → 0003, 0011 → 0002) keep the decision
   graph navigable.
3. **CODEOWNERS uses the sole-maintainer pattern** (`@nick`) for v1; the
   shape is in place for future maintainers to add lines.
4. **Task 4 (CONTRIBUTING / SECURITY / CoC extensions) was scope-narrowed**
   out of this finishing pass by the orchestrator. The existing CoC is
   already Contributor Covenant 2.1; the SPDX section in CONTRIBUTING can
   be added in a follow-up alongside any further housekeeping.

## Deviations from Plan

- **Task 4 deferred.** The prior executor crashed mid-summary after Tasks 1,
  2, and 3 landed. The finishing-pass orchestrator narrowed scope to the
  remaining ADRs + summaries. CoC audit and CONTRIBUTING / SECURITY
  extensions are tracked in `deferred-items.md`.
- **No other deviations.** Tasks 5 and 6 executed exactly as written; both
  ADR commits passed `pnpm lint:english` and commitlint on the first run.

## Known Stubs

None. Every ADR cites real files in-repo (LICENSE, NOTICE, tools/spdx-header.ts,
docs/architecture.md, docs/i18n.md, docs/auth.md, packages/contract-tests,
etc.). All cross-links resolve.

## Threat Flags

None. This plan adds documentation and license metadata only; no new
security-relevant code paths.

## Deferred items

Captured in `.planning/phases/10-i18n-docs-oss-housekeeping/deferred-items.md`:

- Task 4 from 10-04: audit CODE_OF_CONDUCT.md against Contributor Covenant
  2.1 verbatim text; extend CONTRIBUTING.md with the SPDX + i18n + TDD
  sections; extend SECURITY.md with response SLA + threat-model summary table.

## Self-Check: PASSED

Files verified to exist:

- FOUND: tools/spdx-header.ts
- FOUND: tools/__tests__/spdx-header.test.ts
- FOUND: .github/workflows/spdx.yml
- FOUND: .github/CODEOWNERS
- FOUND: .github/ISSUE_TEMPLATE/bug.yml
- FOUND: .github/ISSUE_TEMPLATE/feature.yml
- FOUND: .github/ISSUE_TEMPLATE/question.yml
- FOUND: .github/ISSUE_TEMPLATE/config.yml
- FOUND: docs/adrs/0004-apache-2-0-licensing.md
- FOUND: docs/adrs/0005-stack-node-fastify-better-auth-drizzle-pg-pgbouncer-valkey-bullmq.md
- FOUND: docs/adrs/0006-wire-compatibility-with-upstream-backend-spec.md
- FOUND: docs/adrs/0007-multi-tenancy-via-rls-with-default-tenant.md
- FOUND: docs/adrs/0008-litellm-as-ai-plane-abstraction.md
- FOUND: docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md
- FOUND: docs/adrs/0010-i18n-runtime-i18next-icu-en-ru-operator-overridable.md
- FOUND: docs/adrs/0011-strict-tdd-github-actions-ci-max-automation.md

Commits verified to exist:

- FOUND: a6c3fd5 (test(10-04): add red spdx-header codemod tests)
- FOUND: edfebbf (feat(10-04): spdx header codemod + ci gate + pnpm scripts)
- FOUND: c57554c (chore(10-04): apply spdx apache-2.0 header to 675 ts/js source files)
- FOUND: 5e96c79 (chore(10-04): add codeowners + issue templates + config)
- FOUND: d2d4cea (docs(10-04): adrs 0004 apache-2-0 + 0005 stack + 0006 wire-compat + 0007 multi-tenancy)
- FOUND: 5e14365 (docs(10-04): adrs 0008 litellm + 0009 better-auth + 0010 i18n + 0011 tdd-ci)

Lint gates verified:

- `pnpm lint:english` PASSED on all 8 new ADRs (verified by pre-commit lefthook).
- `commitlint` PASSED on both ADR commits.
