# Phase 31 — Constitutional Lockers — Plan Index

**Phase:** 31-constitutional-lockers
**Milestone:** v2.2 (Pre-OSS Security & Hygiene) — Phase 31 ships FIRST as the gate Phases 32–41 are tested against.
**Created:** 2026-05-16
**Plans:** 8
**Total tasks across plans:** 24 (≈ 3 per plan; 31-04 has 4, 31-08 has 8; 31-07 has 3 tasks but only 1–2 commits per atomicity rule)

## Sub-plans + dependencies

```
Wave 1 (parallel — no deps between any of these):
  31-01  lint-no-env-branches                  LOCKER-01   BLOCKING-on-land
  31-02  lint-no-suppressions                  LOCKER-02   BLOCKING-on-land
  31-03  lint-no-hardcode                      LOCKER-03   BLOCKING-on-land
  31-06  lint-shell-credential-interpolation   LOCKER-06   WARN-on-land → BLOCKING in Phase 36.a

Wave 2 (depends on Wave 1 — AST lockers must not self-violate suppression/hardcode rules):
  31-04  lint-prod-readiness                   LOCKER-04   WARN-on-land → BLOCKING in 31-08 final commit
                                               (depends on 31-01, 31-02, 31-03)
  31-05  lint-secret-shape-in-error            LOCKER-05   WARN-on-land → BLOCKING in Phase 37
                                               (depends on 31-02)

Wave 3 (depends on all six lockers — wires them into discipline + lefthook + CI):
  31-07  DISCIPLINE 11–14 + CLAUDE mirror      LOCKER-07/08/09
         + lefthook + ci.yml + nightly.yml
         + Makefile + lint:lockers script
         + tests/e2e/lockers.spec.ts
         + tools/lockers-allowlist-diff.ts
                                               (depends on 31-01..06)
                                               SAME-COMMIT atomicity per LOCKER-07

Wave 4 (depends on 31-07 — bulk-fix needs the lockers wired up first to gate each commit):
  31-08  bulk-fix MEDIUM/LOW + LOCKER-04 flip  LOCKER-09 operational closure
                                               (depends on 31-07)
                                               ≤ 50 files per atomic commit
```

## One-line summaries

| Plan | Slug | LOCKER | Mode | Atomic-commit count (target) |
|---|---|---|---|---|
| 31-01 | `lint-no-env-branches` | LOCKER-01 | BLOCKING | 2 (RED + GREEN) |
| 31-02 | `lint-no-suppressions` | LOCKER-02 | BLOCKING | 2 (RED + GREEN) |
| 31-03 | `lint-no-hardcode` | LOCKER-03 | BLOCKING | 2 (RED + GREEN) |
| 31-04 | `lint-prod-readiness` | LOCKER-04 | WARN→BLOCKING (flipped in 31-08) | 3 (RED + GREEN route-shape + GREEN dead-export) |
| 31-05 | `lint-secret-shape-in-error` | LOCKER-05 | WARN→BLOCKING (flipped in Phase 37) | 2 (RED + GREEN) |
| 31-06 | `lint-shell-credential-interpolation` | LOCKER-06 | WARN→BLOCKING (flipped in Phase 36.a) | 2 (RED + GREEN) |
| 31-07 | DISCIPLINE 11–14 + integration + e2e + allowlist-diff | LOCKER-07/08/09 | SAME-COMMIT atomicity (Verifier rejects splits) | 1 atomic (optional separate refactor) |
| 31-08 | Bulk-fix MEDIUM/LOW + LOCKER-04 BLOCKING flip | LOCKER-09 operational | Multi-commit, ≤ 50 files each | ≤ 8 commits (1 triage + ≤ 6 area + 1 flip; areas may split a/b/c) |

## Critical cross-references

- **31-04 flip:** the LAST commit of 31-08 drops `--warn-only` from `package.json` `lint:prod-readiness` AND lefthook AND ci.yml AND nightly.yml AND Makefile in the SAME commit, clears `tools/lint-prod-readiness.allowlist.txt`, and updates DISCIPLINE Rule 14 prose.
- **31-05 flip:** lives in Phase 37's closing commit (NOT inside Phase 31). LOCKER-05's allowlist seed entry stays as `# issue-31-debt-LOCKER-05-cr-9-phase-37` until Phase 37 lands.
- **31-06 flip:** lives in Phase 36.a's closing commit (NOT inside Phase 31). LOCKER-06's allowlist seed entries stay as `# issue-31-debt-LOCKER-06-cr-5-phase-36a` until Phase 36.a lands.
- **DISCIPLINE.md + CLAUDE.md atomicity:** LOCKER-07 verifier rule — Rules 11–14 + ALL wiring ship in ONE commit. Splitting is rejected.
- **Bulk-fix scope:** 31-08 only closes MEDIUM/LOW violations. CRITICAL/HIGH per `.planning/review/REVIEW-INDEX.md` are owned by Phases 32–41 and live in `31-08-DEFERRED.md`.

## Phase exit criteria (from ROADMAP :1089-1094)

1. `pnpm lint:lockers` runs in CI BLOCKING on every PR; all six lockers exit non-zero on broken fixtures and exit 0 against `main` HEAD (after 31-08).
2. Per-locker vitest suites ≥ 90/90/90/90 per DISCIPLINE Rule 2. E2E `tests/e2e/lockers.spec.ts` runs real binaries with real exit codes (DISCIPLINE Rules 3 + 4).
3. A synthetic PR introducing any of the 6 violation classes is REFUSED by lefthook AND CI.
4. `tools/lint-*-allowlist.txt` allowlists seeded with current main inventory; each entry has a tracking-issue ID; CI fails on net additions (LOCKER-09).
5. `.planning/DISCIPLINE.md` Rules 11–14 land + mirrored to `CLAUDE.md` in SAME commit as the lockers — per LOCKER-07.

## Audit trail produced by this phase

- 8× PLAN.md (this index + 31-01..08)
- 31-CONTEXT.md (already exists)
- 31-RESEARCH.md (already exists)
- 8× SUMMARY.md (one per plan after execute-phase)
- 31-VERIFICATION.md (from verifier)
- 31-COVERAGE.md (per DISCIPLINE Rule 10)
- 31-08-DEFERRED.md (carryover ledger to Phases 32–41)
- per-plan DECISIONS.md (advisor-researcher verdicts during autonomous run)

## Quality gate (planner self-check before commit)

- [x] 8 PLAN.md files exist + 1 index.
- [x] Every plan has explicit RED/GREEN tasks (not prose).
- [x] 31-04 + 31-05 + 31-06 explicitly state WARN-only mode + identify the future phase that flips them to BLOCKING.
- [x] 31-07 explicitly bundles DISCIPLINE.md + CLAUDE.md + lockers wiring + e2e in SAME commit per verifier rule.
- [x] 31-08 groups bulk-fix per area with ≤ 50 file cap per commit.
- [x] Every plan references the specific LOCKER-XX it covers + source review file (CR-5 → 31-06 audit-archive:106; CR-9 → 31-05 errors.ts:31).
- [x] DISCIPLINE inheritance noted in every plan (Rules 1–10; plans amending 11–14 noted).
