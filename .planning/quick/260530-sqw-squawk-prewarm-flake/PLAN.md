---
quick_id: 260530-sqw
slug: squawk-prewarm-flake
date: 2026-05-30
status: complete
---

# Quick Task: lint-migrations squawk-gate CI flake

## Goal

Make the `lint-migrations` / `squawk-gate` job deterministically green by
fixing the intermittent CI failure where the `main()` integration tests
(bad-blocking-index / bad-drop-column / bad-add-not-null) get empty squawk
diagnostics → exit 0 where exit 1 is expected.

## Corrected diagnosis

Initial hypothesis was cold-fetch (binary not warm in the npx cache); a
pre-warm workflow step (PR #45) DISPROVED it — the step warmed the binary
yet the vitest-forked tests still failed. Real cause: the `npx --yes`
wrapper prepends a package notice to **stdout** before squawk's JSON array
on a CI runner, and the driver's naive `JSON.parse(stdout.trim())` throws on
that noise → empty diagnostics → blocking rule missed → exit 0.

## Fix

Robust JSON extraction in `tools/lint-migrations.ts` (`extractDiagnostics`):
slice the first `[` to the last `]` and parse that, tolerating wrapper
banner/notice noise on either side. RED→GREEN via 3 new `runSquawkOnFile`
unit cases. Production-robustness fix (third-party stdout parsing), not a
test-only patch.

## Surface

- `tools/lint-migrations.ts` — `extractDiagnostics` helper + use in
  `runSquawkOnFile`.
- `tools/lint-migrations.test.ts` — 3 banner/trailing-notice/non-JSON cases.
- `.planning/debug/squawk-gate-vitest-fork-empty-output-2026-05-30.md` —
  disproof + root cause.

## Verification

- 39/39 lint-migrations tests; coverage gate ≥90/90/90/90.
- biome / prod-readiness / english clean.
- REAL proof = squawk-gate GREEN on the PR (runs the gate on a CI runner).
- `pnpm test:all` green for the pre-push evidence gate (never --no-verify).
