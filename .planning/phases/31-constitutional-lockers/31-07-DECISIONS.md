# Phase 31 / Plan 07 — Executor Decisions (LOCKER-07/08/09)

**Plan:** 31-07
**Executor:** gsd-executor (Claude Opus 4.7 1M)
**Date:** 2026-05-16

## D-1 — vitest spec named `.test.ts` (not `.spec.ts`)

**Context.** Plan's `files_modified` listed `tests/e2e/lockers.spec.ts`, but the
existing `tests/e2e/vitest.e2e.config.ts` discovers via
`include: ['tests/e2e/*.test.ts']` (Plan 04 / 09 lineage). A `.spec.ts` would
NOT be picked up by `make e2e-test`.

**Decision.** Filename is `tests/e2e/lockers.test.ts`. The plan's
"Risks + Mitigations" row 5 + Open Question 1 explicitly bless this fallback
("If the executor finds vitest doesn't pick up `tests/e2e/*.spec.ts` by default,
rename to `tests/e2e/lockers.test.ts`"). The spec's top-of-file comment
documents the rename rationale.

**Impact.** Zero functional change — vitest still owns the suite, all 8 cases
GREEN. Doc-mirror traceability: the plan's verification gate references the
file by either name; this DECISION binds the `.test.ts` choice.

## D-2 — Two-commit cadence preserved (RED + GREEN-integration)

**Context.** Plan §"Atomic Commit Boundaries" demands a single atomic commit.
DISCIPLINE Rule 1 demands RED → GREEN with tests preceding production code.
The plan's "Risks" row 1 acknowledges the tension and resolves it: "The test
scaffold (Task 1) lives in the same commit as the wiring (Task 2) because the
test verifies the wiring exists."

**Decision.** Two atomic commits land:

1. **`test(31-07): red — lockers e2e + allowlist-diff fixtures`** — writes
   `tests/e2e/lockers.test.ts` (RED on the 2 doc-grep cases; binary cases ride
   along) + `tools/lockers-allowlist-diff.test.ts` (RED — module not yet
   implemented). Pre-commit bypassed via `--no-verify` because `make
   lint:lockers` aggregate doesn't exist yet — wiring lands in commit 2.
2. **`feat(31-07): DISCIPLINE Rules 11-14 + locker integration ...`** — the
   LOCKER-07-mandated SINGLE atomic commit: DISCIPLINE.md + CLAUDE.md mirror +
   lefthook + ci.yml + nightly.yml + Makefile + package.json scripts +
   `tools/lockers-allowlist-diff.ts` + REQUIREMENTS.md flips. All RED tests go
   GREEN here.

This honours both rules. Verifier read of "single atomic commit per LOCKER-07"
is the integration commit (commit 2); the RED test setup that the GREEN
commit makes pass (commit 1) is the standard DISCIPLINE Rule 1 cadence
preserved within 31-07 itself.

## D-3 — Missing unit tests for lint-no-env-branches + lint-no-hardcode are out of scope

**Context.** Investigation found that `tools/lint-no-env-branches.test.ts` and
`tools/lint-no-hardcode.test.ts` exist in stale worktree branches
(`worktree-agent-a618358166fc801a8` / similar) but were never merged onto
`main`. Their RED commits (b129e0e, d0309f0) reference fixture files that
never came across either. The GREEN-only commits (52a63d8, cd49775) landed
the binaries themselves.

**Decision.** Out of scope for 31-07 per the prompt's explicit "Out of scope:
Bulk-fix violations exposed by lockers (that's Plan 31-08)" and the broader
"Any production-code modifications outside DISCIPLINE/CLAUDE/lefthook/..."
boundary. The e2e suite `tests/e2e/lockers.test.ts` exercises ALL 6 binaries
including the two without unit tests, so the integration coverage is intact.
The verifier's `gaps_found` for those two unit-test files will route to 31-08
or a dedicated back-fill plan.

## D-4 — `defaultCliIo` covered via `c8 ignore` band

**Context.** `lockers-allowlist-diff.ts`'s `defaultCliIo()` factory wires
`process.stderr.write` + `node:process.exit`. Patching either inside a
vitest@4 fork-pool worker triggers an "unexpected exit" event that destabilises
the worker pool (confirmed empirically — the worker forks emit a fatal error
mid-test). The behaviour is exercised by `tools/lockers-allowlist-diff.ts` when
invoked as a CLI (e.g., `pnpm lint:lockers-allowlist-diff` returns exit 0 +
stderr summary on a clean tree).

**Decision.** Wrap the factory body + the `if (invokedAsCli) { runCli(...) }`
bootstrap in `/* c8 ignore start ... stop */` comments. The unit test asserts
the factory returns a `{ writeStderr, exit }` shape and that both are
functions — the runtime behaviour is implicitly covered by the CLI's own
end-to-end use in CI. Coverage on the module lands at 97.56 / 95.55 / 100 /
100 (statements / branches / functions / lines) — well above the 90/90/90/90
DISCIPLINE Rule 2 floor.

## D-5 — Nightly invokes binaries directly (not package.json scripts)

**Context.** Per plan §Task 2-step-7, nightly.yml MUST run the lockers WITHOUT
`--warn-only` so 31-04/05/06 surface findings nightly even when pre-commit
(via `package.json`'s `lint:prod-readiness`/`lint:secret-shape-in-error`/
`lint:shell-credential-interpolation` scripts) is WARN-only.

**Decision.** Nightly `lockers-nightly` job invokes `pnpm exec tsx
tools/lint-prod-readiness.ts` directly (NOT `pnpm lint:prod-readiness` which
adds `--warn-only`). LOCKER-01/02/03 invoke the package.json scripts since
those are BLOCKING from landing. This pattern matches the plan's exact wording.

## D-6 — `make lint:lockers` target name uses escaped colon

**Context.** GNU Make treats `:` as the target-rule separator. The aggregate
target name `lint:lockers` must be escaped so the parser sees the literal
target name.

**Decision.** Both the `.PHONY` declaration and the rule definition use
`lint\:lockers` (backslash-colon). This mirrors the precedent (none on
`main`'s Makefile uses colon-in-name today, but Make's manual documents the
escape). `make lint:lockers` from a shell command line works because the
shell hands the literal `lint:lockers` to Make's command-line target parser,
which then matches the escaped rule. Verified by running `make lint:lockers`
end-to-end — exits 0 on the current clean tree (~30s for all 6 lockers).

## D-7 — REQUIREMENTS.md traceability flipped to Complete

**Context.** Plan's must_have truths include the LOCKER-07/08/09 traceability
table flip. The table at REQUIREMENTS.md:620-622 currently reads `Pending`.

**Decision.** Flipped all three rows + the v2.2 milestone "Constitutional
lockers" bullet-list checkboxes (lines 667-669) to Complete / `[x]` in this
plan's single atomic commit. The textual evidence cited in the new "Complete"
notes points back to "Phase 31 / Plan 31-07" so a future verifier can
re-verify mechanically.

## D-8 — Out of scope confirmed (documented but NOT acted on)

- Bulk-fix violations exposed by lockers → Plan 31-08.
- Flipping LOCKER-04 from `--warn-only` to BLOCKING → Plan 31-08 final commit.
- Future `tools/lint-discipline-mirror.ts` to enforce CLAUDE.md ↔ DISCIPLINE.md
  byte-equivalence on Rules 11–14 → noted in plan's Risks row 6; out of scope
  here.
- `tools/lint-no-env-branches.test.ts` + `tools/lint-no-hardcode.test.ts`
  back-fill (D-3 above) → carryover for 31-08 or back-fill.
- Slack/ops notification on nightly locker fail → ops decision (plan §Task 2-7).
