---
phase: quick-260528-eqn
plan: 01
subsystem: tooling / pre-push gate
tags: [tdd, test-evidence, pre-push, locker, dx]
requires: []
provides:
  - "enumerateCommitsForRef returns tip-only ([localSha]) — TDD-compatible pre-push gate"
affects:
  - tools/lint-pre-push-test-evidence.ts
  - tools/__tests__/lint-pre-push-test-evidence.test.ts
  - docs/test-evidence-gate.md
tech-stack:
  added: []
  patterns:
    - "rev-list <tip> --not --remotes emptiness probe as already-on-remote detector (F13 optimization, retained)"
key-files:
  created: []
  modified:
    - tools/lint-pre-push-test-evidence.ts
    - tools/__tests__/lint-pre-push-test-evidence.test.ts
    - docs/test-evidence-gate.md
decisions:
  - "Pre-push gate validates ONLY the tip commit of each pushed ref, not the full rev-list range — intermediate red commits are TDD process artifacts, the tip tree state is what deploys."
  - "Removed the dead per-sha validateSha loop + its c8-ignore block rather than orphaning it, since only localSha (already validated) is returned."
metrics:
  duration: ~5m
  completed: 2026-05-28
  tasks: 3
  files: 3
  commit: 2645977e
---

# Quick 260528-eqn: Pre-push gate validates tip commit only (TDD-compatible) Summary

Reworked the pre-push test-evidence gate so `enumerateCommitsForRef` returns ONLY the tip commit (`[localSha]`) of each pushed ref instead of the entire `remoteSha..localSha` rev-list range, making the gate structurally compatible with the project's constitutional RED→GREEN→REFACTOR discipline — a `test: red` commit fails by design and can never carry passing evidence, so a per-commit-range gate would deadlock every proper TDD history.

## What changed

- **`tools/lint-pre-push-test-evidence.ts` (production):** Rewrote `enumerateCommitsForRef`. Deletion (`localSha === NULL_SHA`) → `[]`; malformed `localSha` → throw (unchanged). Otherwise runs the single `git rev-list <localSha> --not --remotes` emptiness probe: if the output is empty the tip is already on a remote → `[]` (F13 already-validated optimization preserved); otherwise returns exactly `[localSha]` (the tip). Removed the `remoteSha === NULL_SHA ? ... : ["rev-list", "remoteSha..localSha"]` ternary and the now-dead per-sha `validateSha` loop (plus its orphaned c8-ignore block) — `localSha` is validated before the probe and is the only SHA returned. Updated the file header doc comment to describe tip-only + the TDD rationale.
- **`tools/__tests__/lint-pre-push-test-evidence.test.ts` (tests):** Flipped F14 to a 3-commit chain with evidence on the tip only (asserts exit 0); rewrote F17 first `it()` to "validates only the tip d (non-tip c needs no evidence)" (exit 0) and the second `it()` to the inverted "refuses when the TIP itself has no evidence" naming the tip `d` (exit 1); added the load-bearing F19 regression (red intermediate commit + green tip → exit 0); added a tip-only clarifying comment to F11. Header F-case index updated.
- **`docs/test-evidence-gate.md` (runbook):** §1 prose + L2 table row reworded to "TIP commit of each pushed ref"; added a "### Why tip-only (TDD compatibility)" subsection (red-by-design + tip-is-what-deploys, references Quick 260528-eqn); §2 developer-flow code comment de-ranged. Preserved the doc's existing `state !== "passed"` wording on line 10 (matched actual doc text, not the plan's paraphrase).

## TDD evidence (RED → GREEN, same commit)

- **RED:** Against the unchanged range-based production code, the test file produced exactly 3 failures (26 passed): F14 "validates only the tip commit", F17 first `it()` "validates only the tip d", and F19 "red intermediate, green tip → exit 0". The inverted F17 second `it()` already passed under the old impl (range also includes the missing tip d) and stayed green.
- **GREEN:** After the production rewrite, all 29 tests pass.

## Verification

- `pnpm run test:lint-pre-push-test-evidence` → 29/29 passed. Coverage on `tools/lint-pre-push-test-evidence.ts`: **Statements 100%, Branches 97.43% (38/39), Functions 100%, Lines 100%** — all axes ≥ 90 (branch coverage improved from the 95.12% baseline because the removed range ternary eliminated dead branches).
- `pnpm exec biome check` on both edited TS files → clean (one auto-detected format nit on the F19 fragment's `failures` array was fixed).
- `pnpm run lint:lockers` (full chain) → no new violations from this diff. LOCKER-02 (no-suppressions) clean. The only WARN findings are pre-existing dead-export debt in `packages/litellm-client/src/index.ts` and pre-existing allowlisted shell-credential findings in test files — both out of scope.
- Pre-commit hooks (gitleaks, biome, english, commitlint) all passed on commit `2645977e`.
- `git diff --name-only` = exactly the 3 intended files. No Chart.yaml / appVersion / package.json / reporter / manifest delta. No file deletions, no untracked debris.

## Deviations from Plan

None — plan executed exactly as written. The single non-plan judgment call was preserving the runbook's actual `state !== "passed"` wording on line 10 (the plan flagged this INFO note explicitly and instructed matching the doc's real text).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: tools/lint-pre-push-test-evidence.ts (modified)
- FOUND: tools/__tests__/lint-pre-push-test-evidence.test.ts (modified)
- FOUND: docs/test-evidence-gate.md (modified)
- FOUND: commit 2645977e on HEAD
