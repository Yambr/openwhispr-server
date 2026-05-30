# squawk-gate CI flake — REAL root cause (cold-fetch hypothesis DISPROVEN)

**Date:** 2026-05-30
**Check:** `lint-migrations` / `squawk-gate` job → `pnpm test:lint-migrations`
**Symptom:** 3 `main()` integration tests fail on CI only — bad-blocking-index,
bad-drop-column, bad-add-not-null — each `expected +0 to be 1` (squawk
returned empty diagnostics → exit 0 where the test expects 1). GREEN locally.

## Cold-fetch hypothesis: DISPROVEN

PR #45 added a "Pre-warm squawk-cli binary" workflow step (`npx --yes
squawk-cli@<ver> --version` before the vitest step). On CI the step RAN and
warmed the binary — yet the 3 tests STILL failed identically. Decisive
evidence in the same job's log:
- the **standalone driver** invocation (`lint-migrations.ts` stdout) printed
  `✓/✗ <fixture>` lines correctly — squawk downloaded + emitted diagnostics;
- the **vitest-forked `main()`** invocation of the SAME fixture got empty
  output → `all=[]` → exit 0.

Same binary, same warm cache, same fixture, same job — only the
vitest-forked spawn fails. So the cause is **vitest-forked-worker specific**,
NOT cold-fetch. PR #45 closed (a fix its own gate disproves must not merge).

## Real root cause (high-confidence hypothesis, to confirm via /gsd-debug)

The `tests-lint-migrations` vitest project runs `pool: forks`. Inside a
forked worker, `runSquawkOnFile` does `execFileSync("npx", ["--yes",
"squawk-cli@<ver>", ...])`. On a CI runner the forked worker's `npx`
re-resolves and, on first use in that process tree, npm writes a notice
(e.g. `added N packages in Ns`) to **stdout** BEFORE squawk's JSON array.
The driver then does `JSON.parse(stdout.trim())` on banner+JSON → throws →
caught → `all=[]` → no blocking rule found → exit 0. Locally the cache/notice
state differs so stdout is clean JSON → passes.

(Alternative/additional: the forked worker inherits a different
HOME/npm_config_cache than the job shell, so the job-level pre-warm doesn't
reach it — but the banner-contamination theory explains the empty-parse
exactly and is provider-independent.)

## Real fix (production robustness — needs user awareness, hard-rule 1)

`runSquawkOnFile` parses `npx` stdout naively. The robust fix is to make the
parser resilient to leading non-JSON noise: locate the first `[` (or last
balanced JSON array) in stdout and parse THAT, instead of `JSON.parse` on the
whole buffer. This is a genuine production-robustness defect (parsing a
third-party tool's stdout without stripping wrapper-tool banners), not a
test-only patch — so it is a legitimate production fix, but should land with
its own RED test that reproduces banner-prefixed stdout and a note to the
user. Secondary hardening: invoke squawk via a pinned local devDependency
binary instead of `npx --yes` at all (removes the wrapper entirely), or set
`--silent`/`npm_config_loglevel=silent` in the runner env.

## Status

#15 returned to pending with this corrected root cause. NON-REQUIRED check
(required = lint + typecheck only), pre-existing — never blocked a merge.
Proper fix = a focused /gsd-debug + TDD production-robustness change, NOT a
workflow tweak. Do NOT re-attempt a pre-warm-style workflow-only fix.
