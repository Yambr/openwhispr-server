---
phase: quick-260528-eqn
verified: 2026-05-28T10:55:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification: null
---

# Quick 260528-eqn: Pre-push gate validates tip commit only — Verification Report

**Task Goal:** Fix the pre-push test-evidence gate (`tools/lint-pre-push-test-evidence.ts`) to validate ONLY the tip commit (`localSha`) of a push instead of every commit in the rev-list range — (1) validate only the tip, (2) preserve the F13 already-on-remote → exit 0 optimization, (3) preserve F12/F18 deletion → no-op, (4) accept a multi-commit push where intermediate commits are red but the tip is green. TDD-compatibility fix.
**Verified:** 2026-05-28T10:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A push whose intermediate commits are red but whose tip is green is ACCEPTED (exit 0) — TDD red→green→refactor no longer deadlocks the gate | ✓ VERIFIED | `enumerateCommitsForRef` returns `[localSha]` (tip only), never the range (`tools/lint-pre-push-test-evidence.ts:192`). F19 test ran and passed: base→c1(`test: red`, failing fragment)→c2→tip(green), `stdin = main <tip> main <base>`, asserts exit 0. Verbose run confirms: `F19 ... accepts a push whose intermediate commits are red but whose tip is green` ✓ |
| 2 | A push whose TIP commit is missing/failing evidence is REFUSED (exit 1) — the gate still guards what lands | ✓ VERIFIED | F17 second `it()` ran and passed: evidence on non-tip `c` only, tip `d` missing → exit 1 with stderr matching tip `d` (`test:466-481`). Existing F1–F8 (missing/failing/skip/malformed/symlink on the SHA) all still green. |
| 3 | A tag push of a commit already on a remote (rev-list `--not --remotes` empty) still exits 0 (F13 preserved) | ✓ VERIFIED | Code: `if (probe.length === 0) return []` (`:186-188`). F13 test ran and passed: commit marked on `refs/remotes/origin/main` via `update-ref`, tag push → exit 0. |
| 4 | A deletion push (localSha = 0×40) still exits 0 with nothing validated (F12/F18) | ✓ VERIFIED | Code: `if (localSha === NULL_SHA) return []` (`:154-156`), unchanged. F12 and F18 tests both ran and passed (deletion line skipped → exit 0). |
| 5 | Multi-ref pushes still validate each ref independently, but only that ref's own tip | ✓ VERIFIED | `runMain` loops `for (const line of lines) { shas = enumerateCommitsForRef(line, ...) }` (`:407-410`), each line contributes exactly its `localSha`. F11 test ran and passed (2 refs, one missing → exit 1 naming the missing tip). |
| 6 | Per-file coverage on `tools/lint-pre-push-test-evidence.ts` stays ≥ 90/90/90/90 | ✓ VERIFIED | Ran `pnpm run test:lint-pre-push-test-evidence` myself: **Statements 100% (104/104), Branches 97.43% (38/39), Functions 100% (8/8), Lines 100% (101/101)** — all axes ≥ 90. Exit code 0. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `tools/lint-pre-push-test-evidence.ts` | `enumerateCommitsForRef` returns ONLY the tip (`[localSha]`) / `[]` for deletion / `[]` for already-on-remote; `rev-list` retained as emptiness probe | ✓ VERIFIED | Read `:150-193`. Range ternary removed; fixed argv `["rev-list", localSha, "--not", "--remotes"]`; empty probe → `[]`, else `[localSha]`. Dead per-sha validateSha loop + c8-ignore removed. `contains: "rev-list"` ✓ (`:169`). |
| `tools/__tests__/lint-pre-push-test-evidence.test.ts` | Flipped F14/F17 + new tip-only TDD-compat regression (F19) | ✓ VERIFIED | F14 = 3-commit chain, evidence on tip only (`:393-409`); F17 two blocks flipped (`:440-482`); F19 added (`:492-523`). `contains: "tip-only"` ✓ (F19 describe title + header). 29 `it()` blocks total. |
| `docs/test-evidence-gate.md` | tip-only contract + "Why tip-only (TDD compatibility)" subsection | ✓ VERIFIED | §1 prose + L2 table row reworded to "TIP commit of each pushed ref" (`:10,:17`); new subsection at `:22-26`. `contains: "tip"` ✓ (7 occurrences). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `runMain` | `enumerateCommitsForRef` | per-push-line SHA enumeration | ✓ WIRED | `runMain` calls `enumerateCommitsForRef(line, deps.repoRoot)` in the per-line loop (`:410`); result drives `validateOneCommit` per returned SHA (`:418-426`). |
| F19 regression test | `runMain` | 3-commit chain, evidence on tip only, asserts exit 0 | ✓ WIRED | F19 calls `runValidator(stdin)` → `runMain(...)` (`:519-521`, harness `:161-177`); 4-commit chain (base/c1/c2/tip), failing fragment on c1, clean on tip, asserts exit 0. Test executed and passed. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full F-case suite + coverage gate | `pnpm run test:lint-pre-push-test-evidence` | 29/29 passed; coverage 100/97.43/100/100; exit 0 | ✓ PASS |
| Tip-only / F13 / F12 / F18 / F19 names executed | `pnpm exec vitest run ... --reporter=verbose` | F13, F14, F17(×2), F18, F19 all named and ✓ | ✓ PASS |
| Diff scope = exactly 3 files | `git show --name-only 2645977e` | `docs/test-evidence-gate.md`, `tools/__tests__/lint-pre-push-test-evidence.test.ts`, `tools/lint-pre-push-test-evidence.ts` | ✓ PASS |
| No chart/appVersion/package.json/reporter/manifest delta | `git show --name-only ... | grep -iE chart\|appversion\|package.json\|reporter\|manifest` | NONE | ✓ PASS |
| Commit on HEAD | `git merge-base --is-ancestor 2645977e HEAD` | 2645977e IS ancestor (merged via b0ad9c54) | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none in the 3 changed files) | — | — | — | No TODO/FIXME/XXX/HACK/TBD/PLACEHOLDER debt markers introduced; no `as any`/`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` suppressions (LOCKER-02 clean). The single uncovered branch (line 279, path-escape) is a pre-existing defensive c8-ignored branch, not introduced by this change; branch coverage 97.43% remains above the 90 floor. |

### Requirements Coverage

No formal requirement IDs declared (`requirements: []` in PLAN frontmatter — autonomous quick task). N/A.

### Human Verification Required

None. Every must-have is programmatically verifiable: the code logic is read directly, the behavior is asserted by the 29-test suite (including the load-bearing F19 TDD-compat regression and the F17 tip-missing-refusal proof), and the coverage gate ran with exit 0.

### Gaps Summary

No gaps. All 4 goal sub-requirements are satisfied and proven:

1. **Tip-only** — `enumerateCommitsForRef` returns `[localSha]`, never the `remoteSha..localSha` range (the range ternary was deleted; the diff confirms it).
2. **F13 preserved** — empty `rev-list <tip> --not --remotes` probe → `[]` (early return at `:186-188`); F13 test green.
3. **F12/F18 deletion** — `localSha === NULL_SHA → []` early return unchanged; both tests green.
4. **Multi-commit red-intermediate / green-tip accepted** — F19 regression executes a real TDD-shaped history (red c1, green tip) and exits 0.

Coverage holds at 100/97.43/100/100 (branches improved from the 95.12% baseline because the removed range branch eliminated dead branches). The commit is atomic, on HEAD, and touched only the 3 intended files. SUMMARY.md claims independently corroborated by reading the code, running the tests, and inspecting the diff.

---

_Verified: 2026-05-28T10:55:00Z_
_Verifier: Claude (gsd-verifier)_
