---
phase: 31-constitutional-lockers
plan: 01
subsystem: tools/lockers
tags: [locker, lint, NODE_ENV, DISCIPLINE-Rule-11, LOCKER-01]
requires: []
provides:
  - tools/lint-no-env-branches.ts
  - tools/lint-no-env-branches.allowlist.txt
  - pnpm script lint:no-env-branches
  - pnpm script test:lint-no-env-branches
affects:
  - package.json (script additions only — no behavior change)
tech-stack:
  added: []
  patterns:
    - regex-line-scan locker (mirrors lint-dockerfile-tls.ts shape)
    - per-line allowlist `file:line` keys with `# issue-NNNN` rationale tokens
key-files:
  created:
    - tools/lint-no-env-branches.ts
    - tools/lint-no-env-branches.test.ts
    - tools/lint-no-env-branches.allowlist.txt
    - tools/lint-no-env-branches/fixtures/violates.ts
    - tools/lint-no-env-branches/fixtures/clean.ts
    - tools/lint-no-env-branches/fixtures/allowlisted/bootstrap.ts
  modified:
    - package.json
decisions:
  - per-line allowlist `<posix-path>:<lineNumber>` granularity (deviation from plan's reference to per-file pattern in lint-dockerfile-tls.ts) — required because the seed itself encodes line numbers and the same file legitimately has multiple distinct hits across non-contiguous lines
  - allowlist seed extended from 11 plan-stated entries to 14 actual current-main hits (added ssrf-dispatcher.ts:59 jsdoc, test-only.ts:18 jsdoc header, test-only.ts:122 jsdoc) — plan's count was undercounted by 3 jsdoc-comment matches surfaced by live `grep -rnE`
metrics:
  duration_minutes: ~15
  completed_at: 2026-05-16
  commits: 2
  tests_added: 18
  coverage:
    statements: 100
    branches: 100
    functions: 100
    lines: 100
---

# Phase 31 Plan 01: LOCKER-01 (`lint-no-env-branches.ts`) Summary

Ships the first constitutional locker: a tsx CLI that refuses any
`process.env.NODE_ENV` read or `NODE_ENV ===/!==` comparison inside
`apps/*/src/**` or `packages/*/src/**` (boundary files exempt by IGNORE,
documented legacy hits exempt by `file:line` allowlist). Closes
LOCKER-01 from `.planning/REQUIREMENTS.md` and prepares the constitutional
floor that DISCIPLINE Rule 11 will codify when 31-07 lands.

## What Shipped

| Artifact | Purpose |
|---|---|
| `tools/lint-no-env-branches.ts` | Regex line-scan locker; `Violation` interface, `readAllowlist`, `findViolations`, `main`; exit codes 0/1/2; SPDX header; auto-run guard with `import.meta`-style argv-suffix check |
| `tools/lint-no-env-branches.test.ts` | 18-test vitest suite covering glob scope, IGNORE exemptions (bootstrap, config, otel-bootstrap, *.config), per-line allowlist, CLI dispatch, error paths |
| `tools/lint-no-env-branches.allowlist.txt` | 14-entry seed of current-main NODE_ENV hits, each tagged with `issue-31-*` tracking token |
| `tools/lint-no-env-branches/fixtures/` | Reference fixture files (`violates.ts`, `clean.ts`, `allowlisted/bootstrap.ts`) |
| `package.json` scripts | `lint:no-env-branches` (CLI invocation) and `test:lint-no-env-branches` (vitest with 90/90/90/90 thresholds, single-file coverage include) |

## Commits

| Hash | Subject |
|---|---|
| `b129e0e` | `test(31-01): red — lint-no-env-branches fixtures + failing import` |
| `7d2b469` | `feat(31-01): green — lint-no-env-branches.ts + seeded allowlist (LOCKER-01)` |

No REFACTOR commit was required: GREEN landed with 100/100/100/100
coverage and no duplication against sibling lockers (cross-locker shared
util is explicitly deferred to 31-07 per plan §"Out of Scope").

## Verification Gate (per plan §Verification)

- `pnpm test:lint-no-env-branches` → exit 0; 18/18 tests passed.
- Coverage: **100 % statements (52/52), 100 % branches (18/18), 100 %
  functions (5/5), 100 % lines (47/47)** on `tools/lint-no-env-branches.ts`.
  All four axes well above the 90 % DISCIPLINE Rule 2 floor.
- `pnpm lint:no-env-branches` → exit 0 on current main; output:
  `lint-no-env-branches: clean (<worktree-root>)`.
- Synthetic-violation smoke: dropping
  `apps/api/src/routes/__synthetic_check.ts` with
  `if (process.env.NODE_ENV === "test") { ... }` produced
  `exit 1` with stderr formatted as
  `apps/api/src/routes/__synthetic_check.ts:1  NODE_ENV-compare  compare NODE_ENV only at the boundary; thread the resolved mode through opts`
  + a parallel `NODE_ENV-read` finding on the same line, then the
  remediation pointer to the allowlist + issue-NNNN convention.

## Deviations from Plan

### Auto-fixed (Rule 1 — Bug: plan's seed inventory was undercounted)

**1. [Rule 1 - Bug] Allowlist seed extended from 11 → 14 entries**

- **Found during:** Task 2 verification (`pnpm lint:no-env-branches`
  exited 1 after the initial 11-entry seed; a second pass exited 1 for
  one further hit).
- **Issue:** Plan §Task-2 step 5 listed 11 current-main hits, but a
  live regex scan against current main turned up 14 unique
  `<posix-path>:<line>` matches across non-test source files in
  `apps/**/src/**` + `packages/**/src/**`. The extra three were
  jsdoc/comment lines that the `NODE_ENV-compare` regex
  (`\bNODE_ENV\s*[!=]==/`) legitimately matches because the comparison
  appears verbatim in the surrounding doc-comment prose:
  - `apps/api/src/lib/ssrf-dispatcher.ts:59` (jsdoc
    `Defaults to \`process.env.NODE_ENV\`.` — flags as NODE_ENV-read)
  - `apps/api/src/routes/test-only.ts:18` (jsdoc header
    `NODE_ENV === 'test'` — flags as NODE_ENV-compare)
  - `apps/api/src/routes/test-only.ts:122` (jsdoc
    `When NODE_ENV !== 'test'` — flags as NODE_ENV-compare)
- **Fix:** Added all three lines to the allowlist seed, each tagged
  with a distinct `# issue-31-debt-...-jsdoc` or
  `# issue-31-DI-fallback-jsdoc` token. The plan's verification gate
  ("`pnpm lint:no-env-branches` exit 0 on current main") would have
  failed without them.
- **Files modified:** `tools/lint-no-env-branches.allowlist.txt`
- **Commit:** folded into `7d2b469` (single GREEN commit per plan
  §Atomic Commit Boundaries — the allowlist seed is part of the GREEN
  artefact, not a separate concern).

### Architectural adaptation (per-line allowlist key)

**2. [In-scope decision] readAllowlist returns `Set<file:line>` keys, not `Set<file>` keys**

- The plan's §Task-2 step 3 said "copy `lint-dockerfile-tls.ts:104-198`
  structure 1:1" — but the dockerfile-tls allowlist suppresses ALL
  violations in a path (per-file granularity), whereas the seed format
  in plan §Task-2 step 5 explicitly uses `<file>:<line>` keys (some
  files appear multiple times with different line numbers,
  e.g. `apps/api/src/index.ts:494` and `apps/api/src/index.ts:498`).
- Resolved by adapting `readAllowlist` to (a) trim inline
  `# rationale` comments after the file:line key and (b) return the
  full key as the suppression set. The lookup in `findViolations`
  uses `${posix}:${i+1}` as the key. This matches the seed format
  verbatim and lets future entries be added at single-line resolution
  (so accidental bulk-coverage of unrelated hits in the same file
  becomes impossible).
- **No user blocker required** — the plan's seed format unambiguously
  encodes per-line keys; the "1:1 copy of dockerfile-tls" phrasing was
  about the function-shape (signatures, exit codes, c8-ignore
  conventions, glob root, exit-2 EISDIR handling), not the lookup
  granularity. Documented here for the 31-07 wiring author who may
  reuse the canonical pattern when extracting `tools/lib/allowlist.ts`.

## Known Stubs / Deferred Items

- **14 NODE_ENV violations remain in current main** — every entry in
  `tools/lint-no-env-branches.allowlist.txt` is a placeholder for a
  future targeted fix phase. Per plan §"Out of Scope": "Fixing the
  pre-existing hits (LOCKER-01 enforcement only; the four CR-grade
  entries belong to a future targeted phase, NOT 31-08 — they require
  production refactor and are tracked outside this phase)." No
  production fixes were applied.
- **Wiring to lefthook / `.github/workflows/ci.yml` / Makefile /
  `lint:lockers` aggregate** — explicitly out-of-scope here per plan
  §"Out of Scope"; lands in Plan 31-07.
- **`tools/lib/allowlist.ts` cross-locker helper** — explicitly
  deferred per plan §Task-3 trigger ("only if duplicate logic emerges
  between this locker and future 31-02..06"); no duplication exists yet
  with a single locker shipped.

## Threat Flags

None. The locker is itself a security-defense tool (closes the
"NODE_ENV-gated production short-circuit" CR-class identified in
REVIEW-INDEX); it introduces no new wire surface, no DB access, no
file-system writes outside the user-provided rootDir, and runs only
read-only file globs scoped to the current working tree.

## Self-Check: PASSED

- File presence — verified with `ls`:
  - `tools/lint-no-env-branches.ts` ✓
  - `tools/lint-no-env-branches.test.ts` ✓
  - `tools/lint-no-env-branches.allowlist.txt` ✓
  - `tools/lint-no-env-branches/fixtures/violates.ts` ✓
  - `tools/lint-no-env-branches/fixtures/clean.ts` ✓
  - `tools/lint-no-env-branches/fixtures/allowlisted/bootstrap.ts` ✓
- Commits exist on HEAD — `git log --oneline -3` shows `7d2b469` and
  `b129e0e` ✓
- Tests GREEN — `pnpm test:lint-no-env-branches` 18/18 passed ✓
- Coverage ≥ 90/90/90/90 — actual 100/100/100/100 ✓
- Linter clean on current main — `pnpm lint:no-env-branches` exit 0 ✓
- Synthetic violation correctly refused — exit 1 with structured
  stderr ✓

## TDD Gate Compliance

- RED commit `b129e0e` (`test(31-01): red — …`) → tests fail with
  `Cannot find module './lint-no-env-branches'` import error.
- GREEN commit `7d2b469` (`feat(31-01): green — …`) → tests pass at
  100/100/100/100 coverage.
- REFACTOR — not required (no duplication, coverage already 100). Plan
  §Task 3 explicitly states "only if a real duplication exists".

Sequence verified in `git log --oneline -3` against the worktree branch.
