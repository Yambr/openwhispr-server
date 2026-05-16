---
phase: 31-constitutional-lockers
plan: 05
subsystem: tooling/lockers
tags: [LOCKER-05, ast-lint, secret-shape, warn-only, phase-37-debt]
requires: [31-02]
provides:
  - tools/lint-secret-shape-in-error.ts (AST locker, WARN-only)
  - tools/lint-secret-shape-in-error.allowlist.txt (3 entries, Phase-37 debt)
  - pnpm lint:secret-shape-in-error (script)
  - pnpm test:lint-secret-shape-in-error (90/90/90/90 coverage gate)
affects:
  - .planning/phases/31-constitutional-lockers/31-05-DECISIONS.md (new)
  - package.json (2 new scripts)
tech-stack-added: []
patterns:
  - Mirrors tools/lint-shell-credential-interpolation.ts shape (sibling Wave-2 locker)
  - Uses `import ts from "typescript"` (NOT ts-morph) for hermetic AST scan
  - WARN-only flag pattern (same convention as LOCKER-06)
key-files-created:
  - tools/lint-secret-shape-in-error.ts
  - tools/lint-secret-shape-in-error.test.ts
  - tools/lint-secret-shape-in-error.allowlist.txt
  - tools/lint-secret-shape-in-error/fixtures/leaks-bodyText.ts
  - tools/lint-secret-shape-in-error/fixtures/leaks-responseBody.ts
  - tools/lint-secret-shape-in-error/fixtures/truncates-ok.ts
  - tools/lint-secret-shape-in-error/fixtures/private-field-ok.ts
  - tools/lint-secret-shape-in-error/fixtures/non-error-class-ignored.ts
  - .planning/phases/31-constitutional-lockers/31-05-DECISIONS.md
key-files-modified:
  - package.json
decisions:
  - D-31-05-01 — Allowlist two additional pyannote-client.ts sibling leaks (3 entries vs plan's predicted 1); Phase 37 will close all three.
  - D-31-05-02 — `private` modifier exempts (per plan §Task 1.4).
  - D-31-05-03 — `string | undefined` treated identically to `string`.
metrics:
  red_commit: 43fe6dd
  green_commit: 621acf4
  tasks_completed: 2
  files_created: 9
  files_modified: 1
  duration_minutes: ~25
  completed_date: 2026-05-16
coverage:
  statements: 97.69
  branches: 93.75
  functions: 100
  lines: 100
  threshold: 90/90/90/90
  result: PASS
---

# Phase 31 Plan 05: LOCKER-05 (`lint-secret-shape-in-error.ts`) Summary

**One-liner.** Ships an AST-based pre-commit locker that refuses any class extending `*Error` from exposing one of the dangerous field names (`bodyText | responseBody | upstreamPayload | response | body`) as a publicly-visible `string` field unless the constructor truncates it — running in WARN-only mode until Phase 37 lands the production fix for CR-9.

## What landed

Two atomic commits on `worktree-agent-a624babeb3972edb9`:

| # | SHA       | Type | Message |
|---|-----------|------|---------|
| 1 | `43fe6dd` | RED  | `test(31-05): RED — lint-secret-shape-in-error fixtures + failing import` |
| 2 | `621acf4` | GREEN| `feat(31-05): GREEN — lint-secret-shape-in-error AST + --warn-only (LOCKER-05)` |

Files created:

- `tools/lint-secret-shape-in-error.ts` (471 lines, hermetic TypeScript Compiler API walk; mirrors `lint-shell-credential-interpolation.ts` shape).
- `tools/lint-secret-shape-in-error.test.ts` (38 tests; covers per-fixture detection, additional structural shapes, `findViolations` + allowlist, `runMain` CLI entry, CLI subprocess smoke).
- `tools/lint-secret-shape-in-error.allowlist.txt` (3 seed entries — see Deviations §).
- 5 fixture files under `tools/lint-secret-shape-in-error/fixtures/` (canonical leak / truncated / private-exempt / non-Error-DTO shapes).
- `.planning/phases/31-constitutional-lockers/31-05-DECISIONS.md` (advisor-fallback record; no advisor invoked — Hard Rule #1 was unambiguous).

Files modified:

- `package.json` (+2 scripts: `lint:secret-shape-in-error`, `test:lint-secret-shape-in-error`).

## Detection logic

```
ClassDeclaration
  └── heritageClauses: extends <Identifier ending in "Error">
        └── for each PropertyDeclaration:
              if name in {bodyText, responseBody, upstreamPayload, response, body}
              AND not private
              AND type is `string` or `string | undefined`
              AND constructor (if any) does NOT contain
                  `this.<field> = <expr>.slice|.substring|.substr|truncate(...)`
              → FLAG with label LOCKER-05-LEAK
```

- `--warn-only` flag forces exit 0 even when failing violations exist (stderr still prints `WARN`).
- Allowlist `tools/lint-secret-shape-in-error.allowlist.txt` (one `file:line` per line, `#`-comments stripped). Allowlisted hits become WARN (non-blocking) regardless of `--warn-only`.

## Verification gate

| Gate | Command | Result |
|------|---------|--------|
| RED → GREEN transition | `pnpm exec vitest run tools/lint-secret-shape-in-error.test.ts` | 31 → 38 tests, all green |
| Coverage ≥ 90/90/90/90 | `pnpm run test:lint-secret-shape-in-error` | 97.69 / 93.75 / 100 / 100 — **PASS** |
| `--warn-only` exit 0 with allowlisted hits | `pnpm exec tsx tools/lint-secret-shape-in-error.ts --warn-only` | exit 0, 3 WARNs printed |
| Without `--warn-only`, allowlisted-only → exit 0 | `pnpm exec tsx tools/lint-secret-shape-in-error.ts` | exit 0, 3 WARNs printed |
| Real-repo CR-9 hit detected | `scanFile("packages/litellm-client/src/errors.ts")` (in test) | 1 finding @ line 31, field `bodyText` |

## Deviations from Plan

### [Rule 2 — critical correctness discovery] Allowlist seed grew from 1 to 3 entries

**Found during:** Task 2 (GREEN run against current main).

**Plan prediction.** §"Task 2 step 5": *"Run locker once against current main → exactly one finding at `packages/litellm-client/src/errors.ts:31`."*

**Reality at HEAD `a2a470d`.** The locker found **three** real CR-9-class violations:

```
WARN  packages/litellm-client/src/errors.ts:31    [LitellmUpstreamError.bodyText]
WARN  apps/api/src/lib/pyannote-client.ts:68      [PyannoteBadRequestError.bodyText]
WARN  apps/api/src/lib/pyannote-client.ts:80      [PyannoteUpstreamError.bodyText]
```

The two `pyannote-client.ts` classes follow the IDENTICAL leak shape — `public readonly bodyText: string` on an `extends Error` class with the constructor storing the field un-truncated.

**Resolution path.** Hard Rule #1 (`CLAUDE.md` Conventions) + plan's explicit "Out of Scope: Fixing CR-9 (Phase 37)" clause. Production code is NOT touched in Plan 31-05. Both sibling leaks are allowlisted under the Phase-37 umbrella tracking marker. Full rationale in `31-05-DECISIONS.md` §D-31-05-01.

**Impact on Phase 37.** The closing commit must now truncate **three** classes (not one) and clear **three** allowlist entries. All sites are documented in the allowlist file's header comment for trivial discovery.

**Files modified:** `tools/lint-secret-shape-in-error.allowlist.txt` only.

### No other deviations

- No production code touched (Hard Rule #1 honored).
- No advisor invocation (Hard Rule #1 is unambiguous; the plan's Out-of-Scope clause is explicit).
- Worktree boundary held: only `tools/lint-secret-shape-in-error.{ts,test.ts,allowlist.txt}` + fixtures + `package.json` + `31-05-DECISIONS.md`.
- `packages/litellm-client/src/errors.ts` UNTOUCHED.
- `lefthook.yml`, `.github/workflows/*.yml`, `Makefile`, `.planning/DISCIPLINE.md`, `CLAUDE.md` UNTOUCHED (those are 31-07 territory).

## Authentication gates

None — fully autonomous execution.

## Known Stubs

None.

## Threat Flags

None new. The locker itself is defence-in-depth on STRIDE-Info-Disclosure (V7); the underlying violations (pino-serialized Error fields leaking upstream payloads to Loki) are tracked under Phase 37 (CRIT-FIX-09) and the expanded sibling set in `31-05-DECISIONS.md` §D-31-05-01.

## Self-Check: PASSED

- `tools/lint-secret-shape-in-error.ts` → FOUND
- `tools/lint-secret-shape-in-error.test.ts` → FOUND
- `tools/lint-secret-shape-in-error.allowlist.txt` → FOUND (3 entries)
- 5 fixture files under `tools/lint-secret-shape-in-error/fixtures/` → FOUND
- `.planning/phases/31-constitutional-lockers/31-05-DECISIONS.md` → FOUND
- `package.json` scripts `lint:secret-shape-in-error` + `test:lint-secret-shape-in-error` → FOUND
- Commits `43fe6dd` + `621acf4` on `HEAD` → FOUND (`git log --oneline -3` confirms)
- Coverage 97.69 / 93.75 / 100 / 100 ≥ 90/90/90/90 → PASS
- `pnpm exec tsx tools/lint-secret-shape-in-error.ts --warn-only` exit 0 → CONFIRMED
- `packages/litellm-client/src/errors.ts` content unchanged → CONFIRMED (line 31 still reads `public readonly bodyText: string;`)
