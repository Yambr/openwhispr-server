---
phase: 00-repo-bootstrap-constitutional-ci
plan: 04
subsystem: infra
tags: [github-actions, ci, security, dependabot, codeql, trivy, gitleaks, supply-chain, sha-pinning, tdd]

requires:
  - phase: 00-repo-bootstrap-constitutional-ci
    provides: "Plan 01 workspace + Biome/lefthook/commitlint; Plan 02 Vitest 4 + Stryker 9; Plan 03 lint-english + lint-tdd + scripts/branch-protection.json"
provides:
  - "Primary PR workflow `.github/workflows/ci.yml` (lint, lint-english, commitlint, typecheck, test, mutation-quick, pr-checklist, lint-tdd advisory)"
  - "Security workflow `.github/workflows/security.yml` (gitleaks, trivy-fs, codeql v4, license-scan)"
  - "Nightly workflow `.github/workflows/nightly.yml` (full Stryker, dep-audit, k6 placeholder)"
  - "Release workflow `.github/workflows/release.yml` (workflow_dispatch placeholder for Phase 9)"
  - "Dependabot config (`npm` + `github-actions`, weekly grouped minor/patch)"
  - "PR template with TDD-01 + DOCS-09 + Risk checklists, enforced by mheap/require-checklist-action"
  - "Insertion marker `# === Plan 05: harness-self-check job appended below ===` in ci.yml"
affects:
  - "00-05 (CI self-tests + branch-protection invocation)"
  - "00-06 (constitutional-ci phase verification)"
  - "All future phases — every PR is now mechanically gated by the constitutional rules"

tech-stack:
  added:
    - "GitHub Actions: ubuntu-24.04 runners, pnpm/action-setup@v4, actions/setup-node@v5, github/codeql-action@v4"
    - "Third-party (SHA-pinned): gitleaks-action v2.3.9, aquasecurity/trivy-action v0.36.0, wagoid/commitlint-github-action v6.2.1, mheap/require-checklist-action v2.6.1, davelosert/vitest-coverage-report-action v2.11.2, step-security/harden-runner v2.19.1"
    - "license-checker-rseidelsohn (license allowlist enforcement)"
  patterns:
    - "Every third-party action pinned to 40-char commit SHA with trailing `# vX.Y.Z` comment for reviewer clarity"
    - "First-party `actions/*`, `pnpm/*`, `github/codeql-action/*` may use `@vN` major tags"
    - "`pnpm/action-setup` ALWAYS precedes `actions/setup-node` (Pitfall 2 — pnpm cache requires pnpm be installed first)"
    - "Workflow-level `concurrency` with `cancel-in-progress: true` on PR workflows"
    - "Workflow-level least-privilege `permissions: { contents: read }`; elevated permissions only on jobs that need them"
    - "step-security/harden-runner with `egress-policy: audit` on every job touching network/secrets"
    - "CI required-status-check job names exactly match `scripts/branch-protection.json` `contexts`"

key-files:
  created:
    - ".github/workflows/ci.yml"
    - ".github/workflows/security.yml"
    - ".github/workflows/nightly.yml"
    - ".github/workflows/release.yml"
    - ".github/dependabot.yml"
    - ".github/pull_request_template.md"
  modified: []

key-decisions:
  - "CodeQL pinned to v4 (NOT v3 — v3 deprecates Dec 2026; RESEARCH Open Question Q3)"
  - "Trivy action pinned to v0.36.0 SHA per the 2026-03-19 supply-chain incident response (RESEARCH Pitfall 3)"
  - "License allowlist includes MPL-2.0 (Apache-2.0 distribution-compatible per RESEARCH Assumption A7)"
  - "`lint-tdd` job is `continue-on-error: true` — advisory in v1 per Plan 03 / D-21"
  - "`mutation-quick` runs incremental Stryker on PR diff vs `origin/${{ github.base_ref }}`; full mutation runs nightly"
  - "Dependabot uses grouped minor/patch updates (10 PR limit npm, 5 PR limit actions) to reduce review thrash"
  - "`commitlint` and `pr-checklist` and `mutation-quick` and `lint-tdd` jobs gated `if: github.event_name == 'pull_request'` — they only make sense on PRs"
  - "Plan 05 insertion marker comment placed at end of ci.yml jobs section so harness-self-check can be appended without restructuring"

patterns-established:
  - "Pattern 1: SHA-pin every third-party action with version-tag comment — supply-chain hardening default"
  - "Pattern 2: pnpm-then-node ordering invariant — every workspace setup follows pnpm/action-setup → actions/setup-node@v5 with cache: pnpm"
  - "Pattern 3: PR-only jobs use `if: github.event_name == 'pull_request'` guard — reusable across future workflows"
  - "Pattern 4: branch-protection contexts are the source of truth for required job names — workflows mirror them, not vice-versa"

requirements-completed: [TDD-01, CI-01, CI-02]

duration: ~30min
completed: 2026-05-08
---

# Phase 00 Plan 04: Constitutional CI Workflows Summary

**GitHub Actions PR-blocking matrix wired: ci.yml + security.yml + nightly.yml + release.yml + dependabot.yml + PR template, with every third-party action SHA-pinned and CodeQL v4.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-08T22:45:00Z (per file mtimes)
- **Completed:** 2026-05-08T22:46:00Z
- **Tasks:** 2
- **Files modified:** 6 (all created)

## Accomplishments

- Primary PR workflow `ci.yml` with 8 jobs: lint, lint-english, commitlint, typecheck, test (with coverage upload), mutation-quick, pr-checklist, lint-tdd (advisory). Job names match `scripts/branch-protection.json` contexts exactly.
- Security workflow `security.yml` with gitleaks, trivy-fs (SARIF upload to Code Scanning), CodeQL v4 (javascript-typescript), and license-scan (license-checker-rseidelsohn allowlist).
- Nightly workflow `nightly.yml` with full Stryker mutation, k6 load-test placeholder (Phase 8), and pnpm audit (advisory; Dependabot is the blocking path).
- Release workflow `release.yml` as `workflow_dispatch`-only placeholder pointing to Phase 9.
- Dependabot config with weekly grouped minor/patch updates for both `npm` and `github-actions` ecosystems.
- PR template with the literal `## Tests First Checklist (TDD-01)`, `## Source Artifacts (DOCS-09)`, and `## Risk` headings (≥ 11 unchecked checkboxes for `mheap/require-checklist-action` to enforce).
- Plan 05 insertion marker `# === Plan 05: harness-self-check job appended below ===` placed at end of `ci.yml` jobs section.

## Task Commits

1. **Task 1: ci.yml + pull_request_template.md + commitlint PR check** — `800ffcc` (feat)
2. **Task 2: security.yml + nightly.yml + release.yml + dependabot.yml** — `1dfe56d` (feat)

## Files Created/Modified

- `.github/workflows/ci.yml` — Primary PR workflow; 8 jobs; concurrency + workflow-level least-privilege permissions; Plan 05 marker at end.
- `.github/workflows/security.yml` — Security workflow; weekly cron (Mon 06:00 UTC); CodeQL v4; Trivy v0.36.0 SHA; SARIF upload via `github/codeql-action/upload-sarif@v4`; license allowlist incl. MPL-2.0.
- `.github/workflows/nightly.yml` — Daily 03:00 UTC + workflow_dispatch; full Stryker; dep-audit advisory.
- `.github/workflows/release.yml` — workflow_dispatch placeholder.
- `.github/dependabot.yml` — npm + github-actions, weekly Monday, grouped minor/patch.
- `.github/pull_request_template.md` — TDD-01 + DOCS-09 + Risk sections (11 unchecked checkboxes).

## Decisions Made

All decisions follow the plan and RESEARCH directly — see `key-decisions` frontmatter. Highlights:

- CodeQL **v4** everywhere (init, analyze, upload-sarif). v3 is deprecated December 2026; we adopt v4 from PR #1.
- Trivy pinned to commit SHA whose tag is **v0.36.0** — the first post-2026-03-19 supply-chain-incident clean release.
- License allowlist matches RESEARCH Assumption A7: `MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;CC0-1.0;Unlicense;0BSD;MPL-2.0`.
- `lint-tdd` is `continue-on-error: true` (advisory in v1 per Plan 03 / D-21); will be promoted to required in a future phase once heuristics stabilize.

## Deviations from Plan

None — plan executed exactly as written. All third-party actions resolved to current stable SHAs with version-tag comments; pnpm-before-node ordering invariant verified by `awk` check; YAML-validity verified by `pnpm dlx js-yaml` on all five YAML files.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required for this plan. (Branch protection invocation lands in Plan 05 and requires a one-time `gh api` call by a repo admin.)

## Next Phase Readiness

**Ready for Plan 05 (CI self-tests + branch-protection invocation):**

- Job names align with `scripts/branch-protection.json` `contexts` — the Plan 05 self-test can grep both files and assert equality.
- `# === Plan 05: harness-self-check job appended below ===` marker is in place at the end of `ci.yml` jobs section.
- All third-party actions are SHA-pinned, so the Plan 05 self-test for "no floating refs on third-parties" will pass.
- CodeQL v4 already adopted, so the Plan 05 self-test for "no codeql-action @v3" will pass.

**No blockers.** Plan 05 can proceed.

## Self-Check: PASSED

- `.github/workflows/ci.yml` — FOUND
- `.github/workflows/security.yml` — FOUND
- `.github/workflows/nightly.yml` — FOUND
- `.github/workflows/release.yml` — FOUND
- `.github/dependabot.yml` — FOUND
- `.github/pull_request_template.md` — FOUND
- Commit `800ffcc` — FOUND (`feat(00-04): add CI workflow and PR template with TDD checklist`)
- Commit `1dfe56d` — FOUND (`feat(00-04): add security, nightly, release workflows and dependabot config`)
- All YAML files validate via `pnpm dlx js-yaml`
- Third-party action SHA-pin check (40-char hex) — PASS for all 6 actions across both workflows
- pnpm/action-setup precedes actions/setup-node in every job using both — PASS
- No Cyrillic in any created file — PASS

---
*Phase: 00-repo-bootstrap-constitutional-ci*
*Completed: 2026-05-08*
