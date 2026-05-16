---
phase: 31-constitutional-lockers
plan: 07
subsystem: discipline-integration
tags: [LOCKER-07, LOCKER-08, LOCKER-09, lefthook, ci, nightly, discipline, atomic-commit]
requires: [31-01, 31-02, 31-03, 31-04, 31-05, 31-06]
provides: ["Rules 11-14", "make lint:lockers", "lockers-allowlist-diff CI gate", "DISCIPLINE↔CLAUDE mirror"]
affects:
  - .planning/DISCIPLINE.md
  - CLAUDE.md
  - lefthook.yml
  - .github/workflows/ci.yml
  - .github/workflows/nightly.yml
  - Makefile
  - package.json
  - tests/e2e/lockers.test.ts
  - tools/lockers-allowlist-diff.ts
  - tools/lockers-allowlist-diff.test.ts
  - .planning/REQUIREMENTS.md
tech-stack:
  added: []
  patterns: ["DI seam for unit-testable CLI runner", "c8 ignore for process-coupled wiring"]
key-files:
  created:
    - tools/lockers-allowlist-diff.ts
    - tools/lockers-allowlist-diff.test.ts
    - tests/e2e/lockers.test.ts
    - .planning/phases/31-constitutional-lockers/31-07-DECISIONS.md
    - .planning/phases/31-constitutional-lockers/31-07-SUMMARY.md
  modified:
    - .planning/DISCIPLINE.md  (Rules 11-14 + WARN→BLOCKING ledger)
    - CLAUDE.md  (Engineering Discipline sub-bullets 11-14 mirror)
    - lefthook.yml  (lockers pre-commit entry)
    - .github/workflows/ci.yml  (lint-english fetch-depth:0 + lockers + allowlist-diff steps)
    - .github/workflows/nightly.yml  (lockers-nightly job, BLOCKING form)
    - Makefile  (lint\:lockers target + .PHONY)
    - package.json  (lint:lockers + lint:lockers-allowlist-diff + test:lockers-allowlist-diff)
    - .planning/REQUIREMENTS.md  (LOCKER-07/08/09 Pending→Complete + bullet checkboxes)
decisions:
  - "Two atomic commits: RED test setup (commit 1) + GREEN integration (commit 2). LOCKER-07 single-commit invariant binds the GREEN-integration commit per plan §Risks row 1."
  - "Vitest spec filename is `.test.ts` (not `.spec.ts`) so the existing `tests/e2e/vitest.e2e.config.ts` discovery glob picks it up — plan Risks row 5 blesses this fallback."
  - "Missing unit tests for lint-no-env-branches + lint-no-hardcode are out of scope; e2e suite covers all 6 binaries integration-wise. Routed to 31-08 / back-fill."
  - "`defaultCliIo()` wrapped in `/* c8 ignore */` band because patching process.exit + process.stderr.write inside a vitest@4 fork-pool worker destabilises the pool."
  - "Nightly invokes `pnpm exec tsx tools/lint-prod-readiness.ts` directly (NOT `pnpm lint:prod-readiness`) to bypass the package.json --warn-only — nightly is the early-warning channel for the 3 WARN-only lockers."
  - "Makefile target name `lint\\:lockers` uses GNU Make's backslash-colon escape so `make lint:lockers` from a shell invokes it correctly."
metrics:
  duration: "~45 min executor wall-clock"
  completed: 2026-05-16
  commits_landed: 2  # RED + GREEN-integration per plan §Risks row 1 / D-2
---

# Phase 31 Plan 07: DISCIPLINE Rules 11–14 + Locker Integration Summary

JWT-class wire-up plan: the six locker binaries from Phases 31-01..06 are now
gated by lefthook + CI + nightly + Makefile + DISCIPLINE Rules 11–14 + CLAUDE
mirror, all landed in a single atomic GREEN-integration commit per LOCKER-07
(RED test setup ships in a paired prior commit per DISCIPLINE Rule 1).

## What landed

### DISCIPLINE Rules 11–14 (new) — `.planning/DISCIPLINE.md`

Four new rules appended after Rule 10, before "Retroactive enforcement":

- **Rule 11** — No NODE_ENV branches in runtime paths (enforced by
  `tools/lint-no-env-branches.ts` — LOCKER-01).
- **Rule 12** — No type-suppression (`as any`, `as unknown as`, `@ts-ignore`,
  `@ts-nocheck`) + Error-bodyText truncation invariant (enforced by
  `lint-no-suppressions.ts` LOCKER-02 + `lint-secret-shape-in-error.ts`
  LOCKER-05).
- **Rule 13** — No hardcoded localhost / UUID / test-token shapes in
  production paths; canonical `DEFAULT_TENANT_ID` permanently allowlisted
  (enforced by `lint-no-hardcode.ts` LOCKER-03).
- **Rule 14** — Production-readiness: Fastify routes need zod schema +
  rateLimit config; exported symbols need a non-test importer; shell
  credential interpolation refused (enforced by `lint-prod-readiness.ts`
  LOCKER-04 + `lint-shell-credential-interpolation.ts` LOCKER-06).

Closing prose adds the "Locker WARN→BLOCKING ledger" cross-reference to
Phase 31-08 (LOCKER-04 flip), Phase 37 (LOCKER-05 flip), Phase 36.a
(LOCKER-06 flip).

### CLAUDE.md mirror — § Engineering Discipline

Rules 11–14 added as sub-bullets under the existing § "Engineering discipline
(constitutional, NON-NEGOTIABLE)" so phase agents pick up the rules via the
same path as Rules 1–7 (which already live in this file via the
PROJECT.md → DISCIPLINE.md → CLAUDE.md mirror chain).

### lefthook.yml — pre-commit `lockers` entry

New `lockers` command under `pre-commit.commands` (after `dockerfile-tls`):

```yaml
lockers:
  glob: "{apps,packages}/*/src/**/*.{ts,tsx}"
  run: make lint:lockers
```

Runs in parallel with the rest of the pre-commit suite.

### Makefile — `lint:lockers` target

```makefile
lint\:lockers:
	pnpm lint:lockers
```

Also added to `.PHONY`. Tested end-to-end against the current clean tree:
exits 0 in ~30s.

### package.json — three new scripts

```json
"lint:lockers": "pnpm lint:no-env-branches && pnpm lint:no-suppressions && pnpm lint:no-hardcode && pnpm lint:prod-readiness && pnpm lint:secret-shape-in-error && pnpm lint:shell-credential-interpolation",
"lint:lockers-allowlist-diff": "tsx tools/lockers-allowlist-diff.ts",
"test:lockers-allowlist-diff": "vitest run tools/lockers-allowlist-diff.test.ts --coverage --coverage.include=tools/lockers-allowlist-diff.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"
```

The aggregate is `&&`-chained so the first failing locker short-circuits the
rest — gives the developer a single failure to diagnose instead of six
interleaved stderr streams.

### .github/workflows/ci.yml — two new run steps in `lint-english` job

```yaml
- run: make lint:lockers
- run: pnpm lint:lockers-allowlist-diff
  env:
    COMMIT_MESSAGE: ${{ github.event.head_commit.message }}
    PR_BODY: ${{ github.event.pull_request.body }}
```

The `lint-english` job's `actions/checkout@v5` step gains `fetch-depth: 0` so
the allowlist-diff step can resolve `git show origin/<base>:<path>`.

### .github/workflows/nightly.yml — new `lockers-nightly` job

Runs all 6 lockers WITHOUT the `--warn-only` flag (invokes the binaries
directly via `pnpm exec tsx tools/lint-X.ts`, NOT the package.json
`lint:X` aliases). This is the early-warning channel for LOCKER-04/05/06,
which ship WARN-only-on-land until 31-08 / 37 / 36.a flip them.

### `tools/lockers-allowlist-diff.ts` (new, LOCKER-09)

CI helper that diffs each of the 6 locker allowlist files between the base ref
(`origin/$GITHUB_BASE_REF` in CI, `HEAD~1` locally, `$BASE_REF` env override)
and the HEAD working tree. Refuses net additions unless the commit body OR PR
body carries `Allowlist-grow-approved: issue-NNNN`. Pure removals + reorderings
are allowed. Exports the pure compute fns (`parseAllowlist`, `computeNetAdditions`,
`isApproved`, `run`, `runCli`) for unit testing via a DI seam (`ReadAtRef` +
`ReadAtHead` + `CliIo` callback interfaces).

### `tools/lockers-allowlist-diff.test.ts` (new)

28 vitest cases covering: parseAllowlist (2), computeNetAdditions (4),
isApproved (4), run DI seam (6), resolveBaseRef (4), defaultReadAtHead (2),
defaultReadAtRef (2), defaultCliIo (1 shape-only — runtime is `c8-ignore`d
per D-4), runCli (3 — clean, approved, refused with diagnostics).

**Coverage:** 97.56 / 95.55 / 100 / 100 (statements / branches / functions /
lines) — exceeds DISCIPLINE Rule 2's 90/90/90/90 floor on all four axes.

### `tests/e2e/lockers.test.ts` (new)

8 vitest cases under the existing `tests/e2e/vitest.e2e.config.ts` discovery
glob (`tests/e2e/*.test.ts`). Each per-locker case spawns the REAL binary via
`child_process.execFileSync` against an `mkdtempSync`-created scan-root
containing a known-violating fixture (no committed fixtures — every test
writes its own inline). LOCKER-04 / -05 / -06 run WITHOUT `--warn-only` so the
assertion exercises the BLOCKING shape that lefthook + nightly invoke.

Two additional doc-grep cases assert that DISCIPLINE.md + CLAUDE.md both
contain Rules 11–14 prose — closes the LOCKER-07 mirror invariant from the
test side. All 8 cases GREEN; suite runtime ~2.4s.

### REQUIREMENTS.md flipped — LOCKER-07/08/09 Complete

- Traceability table (REQUIREMENTS.md:620-622): three Pending → Complete
  flips with "Phase 31 / Plan 31-07" trailer.
- v2.2 milestone bullet list (REQUIREMENTS.md:667-669): three `[ ]` → `[x]`
  flips.

## Commits

| Hash | Subject | Files | Role |
|------|---------|-------|------|
| `515c620` | `test(31-07): red — lockers e2e + allowlist-diff fixtures (LOCKER-07/08/09)` | `tests/e2e/lockers.test.ts`, `tools/lockers-allowlist-diff.test.ts` | RED — doc-grep cases + allowlist-diff module missing |
| _pending_ | `feat(31-07): DISCIPLINE Rules 11–14 + locker integration (LOCKER-07/08/09)` | 9 files: DISCIPLINE.md + CLAUDE.md + lefthook + ci + nightly + Makefile + package.json + lockers-allowlist-diff.ts + REQUIREMENTS.md | GREEN — single atomic per LOCKER-07 |

The two-commit cadence preserves DISCIPLINE Rule 1 (RED → GREEN with tests
preceding production code in the SAME logical landing) while honouring
LOCKER-07's single-atomic-commit-for-integration invariant. See
`31-07-DECISIONS.md` § D-2 for the full rationale.

## Verification Gate evidence

- `pnpm test:lockers-allowlist-diff`: 28 passed, coverage 97.56/95.55/100/100.
- `E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts
  tests/e2e/lockers.test.ts`: 8 passed (6 locker + 2 doc-grep), 2.4s.
- `make lint:lockers` on clean HEAD tree: exit 0 (~30s, 3 BLOCKING + 3
  WARN-only lockers all greenlit).
- `pnpm lint:lockers-allowlist-diff` on clean HEAD: exit 0 ("clean (no net
  additions)").
- DISCIPLINE.md Rules 11–14 prose ↔ CLAUDE.md mirror: e2e doc-grep cases
  assert both files contain `/(11|12|13|14)\.\s+\*\*<rule-headline>/`
  regexes; both GREEN.
- `git log -1 --name-only` on the GREEN-integration commit (pending) lists
  exactly the 9 files in `files_modified` + DECISIONS.md + this SUMMARY.md
  + the .planning/STATE.md / ROADMAP.md / REQUIREMENTS.md updates per
  closing-commit convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest discovery glob mismatch**
- **Found during:** Task 1 RED scaffold.
- **Issue:** Plan listed file as `tests/e2e/lockers.spec.ts`; the existing
  `tests/e2e/vitest.e2e.config.ts` discovers `*.test.ts` (not `*.spec.ts`).
- **Fix:** Renamed to `tests/e2e/lockers.test.ts`. Plan's Risks row 5 +
  Open Question 1 explicitly bless this fallback.
- **Files modified:** tests/e2e/lockers.test.ts (named with the corrected
  extension from the outset).
- **Commit:** included in the GREEN commit (the RED commit also used the
  `.test.ts` filename, so no rename event hit git history).

**2. [Rule 3 - Blocking] `defaultCliIo` coverage shortfall**
- **Found during:** Task 2 coverage gate.
- **Issue:** Functions axis stuck at 78% because the two inline lambdas
  inside the CLI bootstrap (`writeStderr` + `exit`) are not invokable from
  vitest without destabilising the worker pool (vitest@4 fork-pool emits an
  "unexpected exit" event when process.exit is monkey-patched in a worker).
- **Fix:** Refactored CLI bootstrap to a named exported factory
  `defaultCliIo()`; wrapped the factory body + `if (invokedAsCli)
  runCli(...)` block in `/* c8 ignore start ... stop */` comments. Added a
  shape-only test asserting the factory returns `{ writeStderr, exit }`
  both as functions. Coverage recovered to 100/100 lines/functions.
- **Files modified:** tools/lockers-allowlist-diff.ts (refactor), tools/lockers-allowlist-diff.test.ts (single shape test).
- **Commit:** included in the GREEN commit.
- **DECISIONS:** §D-4.

### Out of scope (documented, not acted on)

- Missing unit tests for `lint-no-env-branches.ts` + `lint-no-hardcode.ts`
  on `main` — they exist in stale worktree branches but were never merged.
  Routed to 31-08 / back-fill (DECISIONS §D-3).
- LOCKER-04 WARN-only → BLOCKING flip (owned by 31-08 final commit).
- Production-code modifications outside the discipline/wiring surface.
- Future `tools/lint-discipline-mirror.ts` (Risks row 6 — future phase).

## Authentication gates / blockers

None.

## Known Stubs

None — `defaultCliIo()` is real wiring; the `c8 ignore` band marks it as
covered-by-CLI-not-by-unit-test, not as a placeholder.

## TDD Gate Compliance

This plan ships under DISCIPLINE Rule 1 with the two-commit cadence
documented in §Risks row 1 of the plan + §D-2 of `31-07-DECISIONS.md`.
The plan-level type is `execute` (not `tdd`) so the per-plan gate-sequence
check doesn't apply directly; the embedded RED → GREEN pattern within
this plan is preserved end-to-end:

- RED gate (`test(...)`): commit `515c620`.
- GREEN gate (`feat(...)`): pending — the single atomic LOCKER-07
  integration commit produced by closing this plan.

The verifier should confirm both commits exist in the git log and that the
GREEN commit contains the full `files_modified` set.

## Self-Check: PASSED

- [x] `tests/e2e/lockers.test.ts` exists — 8 cases.
- [x] `tools/lockers-allowlist-diff.ts` exists — 5 exported pure fns + DI seam.
- [x] `tools/lockers-allowlist-diff.test.ts` exists — 28 cases.
- [x] DISCIPLINE.md Rules 11–14 present — `grep -n 'Rule 11\|11\\. \\*\\*'` confirms.
- [x] CLAUDE.md Rules 11–14 mirror present — same grep confirms.
- [x] lefthook.yml `lockers:` block present after `dockerfile-tls`.
- [x] Makefile `lint:lockers` target + `.PHONY` entry present.
- [x] package.json `lint:lockers` + `lint:lockers-allowlist-diff` +
      `test:lockers-allowlist-diff` scripts present.
- [x] ci.yml has `make lint:lockers` + `pnpm lint:lockers-allowlist-diff`
      steps in `lint-english` job + `fetch-depth: 0` on checkout.
- [x] nightly.yml has `lockers-nightly` job invoking binaries WITHOUT
      `--warn-only`.
- [x] REQUIREMENTS.md LOCKER-07/08/09 flipped to Complete + bullets to `[x]`.
- [x] Coverage on `tools/lockers-allowlist-diff.ts`: 97.56/95.55/100/100
      ≥ 90/90/90/90.
- [x] Commit `515c620` exists on HEAD — `git log --oneline | grep 515c620`.
