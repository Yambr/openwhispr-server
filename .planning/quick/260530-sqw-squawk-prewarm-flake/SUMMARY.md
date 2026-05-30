---
quick_id: 260530-sqw
slug: squawk-prewarm-flake
date: 2026-05-30
status: complete
---

# Summary: lint-migrations squawk-gate CI flake — robust JSON parse

## The flake (and the corrected diagnosis)

`lint-migrations` / `squawk-gate` → `pnpm test:lint-migrations`: 3 `main()`
integration tests (bad-blocking-index, bad-drop-column, bad-add-not-null)
intermittently fail on CI with `expected +0 to be 1` — squawk returned empty
diagnostics → exit 0 where exit 1 (blocking rule) is expected. GREEN locally.

## First hypothesis (cold-fetch) — DISPROVEN

A pre-warm workflow step (PR #45) warmed the squawk binary before the vitest
step. On CI the step ran and warmed the cache, **yet the 3 tests still
failed identically**. The same job's log was decisive: the standalone driver
invocation emitted diagnostics fine (binary warm + working), but the
**vitest-forked** `main()` spawn got empty output. Same binary, same cache,
same fixture — only the forked spawn failed. PR #45 was **closed without
merging** (a fix its own gate disproves must not land).

## Real root cause

`runSquawkOnFile` ran `npx --yes squawk-cli@<ver>` and did
`JSON.parse(stdout.trim())`. On a CI runner the `npx --yes` wrapper can
prepend a package notice ("npm warn exec …" / "added 1 package in 1s") to
**stdout** before squawk's JSON array (and/or append a trailing notice). The
naive parse throws on that noise → `all=[]` → no blocking rule → exit 0. The
vitest-forked worker's env triggered the notice where the job shell did not.

## Fix (production robustness, TDD)

`tools/lint-migrations.ts` — extract the JSON array from possibly-
contaminated stdout: slice from the first `[` to the last `]` and parse
that (`extractDiagnostics`, in-module helper). Resilient to leading/trailing
wrapper noise; returns `[]` when no balanced array is present (genuine crash
→ `status` drives the exit decision, unchanged).

This is a genuine production-robustness defect (parsing a third-party tool's
stdout without stripping the `npx` wrapper's banner), not a test-only patch.

## Tests (TDD, RED→GREEN)

`tools/lint-migrations.test.ts` — 3 new `runSquawkOnFile` cases:
- JSON array parsed when npx prepends an install banner (RED→GREEN);
- JSON array parsed when a trailing notice follows it (RED→GREEN);
- still empty on genuinely non-JSON output (no regression).
Full file 39/39; the real `main()` integration tests still GREEN locally;
coverage gate 98.94/95.91/100/98.85 (≥90/90/90/90).

## Verification

- `pnpm test:lint-migrations` coverage gate GREEN.
- biome / prod-readiness / english: clean.
- The REAL proof is the `squawk-gate` check going GREEN on THIS PR (it runs
  the gate against the patched parser on a CI runner).
- `pnpm test:all` GREEN for the pre-push evidence gate (never --no-verify).

## Debug trail

`.planning/debug/squawk-gate-vitest-fork-empty-output-2026-05-30.md` —
full disproof of the cold-fetch hypothesis + the real root cause.
