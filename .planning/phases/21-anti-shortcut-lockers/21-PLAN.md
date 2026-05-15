# Phase 21 — PLAN

**Status:** EXECUTED inline (single-session linear delivery, 6 atomic commits).
**Branch:** `qa-phases-21-39` (worktree, merged into `main` at phase close).
**Author:** Claude (Opus 4.7).
**Date:** 2026-05-16.

## Goal-backward verification

What must be TRUE after Phase 21 closes?

1. 5 new linters exist under `tools/lint-*.ts` with sibling tests at ≥ 90/90/90/90.
2. `pnpm lint:gherkin-tags`, `pnpm lint:playwright-config`, `pnpm lint:steps-have-unit-tests`, `pnpm lint:prod-edit-guard`, `pnpm lint:coverage-floor` all exit 0 against the current tree.
3. Intentional-violation test: committing a `.skip` in a `.feature` file gets blocked at pre-commit.
4. `scripts/branch-protection.json` lists 21 required contexts (was 16).
5. CI workflow `.github/workflows/ci.yml` has 5 new jobs as required.

All five are met — see `21-SUMMARY.md`.

## Atomic commits (in landing order)

| # | SHA | Subject | Rationale |
|---|-----|---------|-----------|
| 1 | `69dedce` | `docs(qa-audit): land 2026-05-16 audit + tests/e2e-cjm/GAPS.md` | Foundation. CJM coverage + test-layering audit documents copied from the main session — these are the spec the lockers enforce. |
| 2 | `7676059` | `docs(roadmap): inject Phase 21..Phase 39 — QA discipline gates + CJM gap closure` | Add 19 new phases (21..39) under v2.1. Phase 21 has full SR-21.* requirements + success criteria; Phase 22..39 carry one-line goals (full CONTEXT.md authored when each phase is picked up). |
| 3 | `6e66aae` | `feat(21-01): lint-gherkin-tags — anti-shortcut linter SR-21.1` | RED→GREEN. 4 invariants over `*.feature` files. Coverage 99.29/91.3/100/99.21. |
| 4 | `ea5d025` | `feat(21-02): lint-playwright-config — anti-flake linter SR-21.2` | RED→GREEN. 3 invariants. Includes production fix to `apps/web/playwright.config.ts` (retries 0 — D-12 enforcement). Coverage 98/91.66/100/98.86. |
| 5 | `0b15156` | `feat(21-03): lint-steps-have-unit-tests — SR-21.3 enforces feedback_cjm_steps_need_unit_tests` | RED→GREEN. 2 invariants. Allowlist for 11 legacy step files (deferred to Phase 24..32). Coverage 98.85/94.11/100/100. |
| 6 | `4f9bcb3` | `feat(21-04): lint-no-prod-edit-with-test-only-pr — SR-21.4 Hard Rule §1 guard` | RED→GREEN. PR-only linter; `[test-fix]` PR cannot touch production source unless `[scope-expansion]` override. Coverage 100/92.85/100/100. |
| 7 | `59b52e9` | `feat(21-05): lint-coverage-floor-per-phase — SR-21.5 strict 90/90/90/90` | RED→GREEN. Diff-aware coverage gate against 7 strict packages. Coverage 100/94.11/100/100. |
| 8 | `be2bb07` | `feat(21-06): wire Phase 21 lockers into lefthook + CI + branch-protection` | Wiring commit: 10 pnpm scripts, 3 lefthook pre-commit hooks, 5 new CI jobs, 5 new branch-protection contexts, 17 CODEOWNERS pins, PR-template QA section. |
| 9 | `<this commit>` | `docs(21): GSD artefacts CONTEXT + PLAN + SUMMARY` | Phase artifacts for GSD audit trail. |

## Plan ↔ SR mapping

| SR | Plan slot | Commit |
|----|-----------|--------|
| SR-21.1 | 21-01 | `6e66aae` |
| SR-21.2 | 21-02 | `ea5d025` |
| SR-21.3 | 21-03 | `0b15156` |
| SR-21.4 | 21-04 | `4f9bcb3` |
| SR-21.5 | 21-05 | `59b52e9` |
| SR-21.6 (wiring) | 21-06 | `be2bb07` |

## TDD discipline trace

For each linter:
1. **RED** — colocated `*.test.ts` written first, importing symbols that did not yet exist. `pnpm exec vitest run tools/lint-X.test.ts` failed with "Cannot find module './lint-X'".
2. **GREEN** — `tools/lint-X.ts` written; tests pass; real-tree scan runs.
3. **REFACTOR / coverage closure** — additional edge-case tests added (comment carve-outs, parseArgs nullish defaults, exact-key matching) to push each linter to ≥ 90/90/90/90.

No production code was written before its tests on any of the 5 linters.

## Out-of-scope artifacts NOT produced

This phase deliberately did NOT produce:
- `21-RESEARCH.md` (no research needed; pattern lifted from `tools/lint-cjm-doc.ts`)
- `21-DISCUSSION-LOG.md` (no discuss session; the source plan was the spec)
- `21-PLAN-CHECK.md` (no plan-checker invocation; verification is the success criteria themselves, verified inline)
- `21-VERIFICATION.md` (sub-tasks 21-01..21-06 verify each SR; SUMMARY consolidates)
- `21-REVIEW.md` (no separate code-review pass; the linter test suites ARE the review of the linters)

This is acceptable because Phase 21 is a tooling phase — no user-visible routes, no wire-surface changes, no e2e implications. The GSD discipline matrix (PROJECT.md §10) requires PLAN.md + SUMMARY.md for every phase, but allows the others to be omitted when not warranted.

## Next phase

Phase 22 (Q-01 / SR-22.1) — smoke layer. Picks up via `/gsd-discuss-phase 22` or directly via `/gsd-execute-phase 22 --no-transition` since the plan is fully spelled out in the audit doc.
