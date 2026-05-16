---
phase: 31-constitutional-lockers
plan: 06
subsystem: constitutional-locker
tags: [LOCKER-06, shell-credential-interpolation, lint, security, STRIDE-T, STRIDE-EoP, warn-only]
requires: []
provides:
  - tools/lint-shell-credential-interpolation.ts
  - tools/lint-shell-credential-interpolation.allowlist.txt
  - tools/lint-shell-credential-interpolation.test.ts
  - package.json scripts: lint:shell-credential-interpolation, test:lint-shell-credential-interpolation
affects:
  - apps/worker/src/jobs/audit-archive.ts (passive — 3 sites allowlisted, awaiting Phase 36.a rewrite)
tech-stack:
  added: []
  patterns: [typescript-compiler-api-ast, two-pass-context-aware-detection, file-line-allowlist, --warn-only-graduation]
key-files:
  created:
    - tools/lint-shell-credential-interpolation.ts
    - tools/lint-shell-credential-interpolation.test.ts
    - tools/lint-shell-credential-interpolation.allowlist.txt
    - tools/lint-shell-credential-interpolation/fixtures/violates-spawn-bash.ts
    - tools/lint-shell-credential-interpolation/fixtures/violates-exec-sync.ts
    - tools/lint-shell-credential-interpolation/fixtures/clean-regex-exec.ts
    - tools/lint-shell-credential-interpolation/fixtures/clean-argv-array.ts
    - .planning/phases/31-constitutional-lockers/31-06-DECISIONS.md
    - .planning/phases/31-constitutional-lockers/31-06-SUMMARY.md
  modified:
    - package.json
decisions:
  - "AST (TypeScript Compiler API) over regex two-pass — natural false-positive guard for regex .exec() method"
  - "File-level shell-context widening — catches the audit-archive script-builder shape (lines 106 + 115 + 127 all flagged)"
  - "Allowlist file:line granularity (not file-level) — gives Phase 36.a closing commit a precise 3-of-3 verification"
  - "WARN-only on initial landing — flips to BLOCKING in Phase 36.a closing commit"
metrics:
  duration_min: 14
  completed: 2026-05-16
  commits: 2
  tasks_completed: 2
  files_created: 9
  files_modified: 1
  coverage: { stmts: 98.94, branches: 92.10, funcs: 100.00, lines: 100.00 }
  tests: 26
---

# Phase 31 Plan 06: LOCKER-06 lint-shell-credential-interpolation Summary

**One-liner:** Constitutional locker (WARN-only) that refuses credential-suffix template literals inside child_process shell-execution contexts; TS Compiler API + file-line allowlist seeded with the 3 audit-archive CR-5 sites.

## Goal

Ship `tools/lint-shell-credential-interpolation.ts` that refuses shell command-string template literals interpolating identifiers/env-reads matching `(_URL|_KEY|_PASSWORD|_SECRET|_TOKEN)$` (UPPER_SNAKE) or `[a-z](Url|Key|Password|Secret|Token)$` (camelCase). Used as a regression guard for the CR-5 source pattern in `apps/worker/src/jobs/audit-archive.ts`. WARN-only on initial landing — Phase 36.a rewrites the production code AND flips this locker to BLOCKING in its closing commit.

## Commits

| SHA       | Type | Message                                                                          |
|-----------|------|----------------------------------------------------------------------------------|
| `20f0b7b` | test | `test(31-06): red — lint-shell-credential-interpolation fixtures + failing import` |
| `731e921` | feat | `feat(31-06): green — lint-shell-credential-interpolation + --warn-only (LOCKER-06)` |

Worktree branch: `worktree-agent-a582fdaa0639911c7` (Wave-1 isolation per spawn prompt).

## Detection Algorithm

Two-pass AST walk per file:

1. **Pass 1 — has any shell-execution context?**
   - CallExpression with bare-Identifier callee in `{spawn, exec, execSync, execFileSync}`, OR
   - ArrayLiteralExpression whose first element is the string `"-c"` (the `args: ["-c", ...]` shape).
   
   `re.exec(value)` is NOT a shell context — its callee is a PropertyAccessExpression, not an Identifier. This is the structural false-positive guard against regex-method `.exec()`.

2. **Pass 2 — flag every credential template literal in the file.**
   - TemplateExpression nodes whose interpolated spans contain an Identifier or PropertyAccessExpression name matching `CREDENTIAL_SUFFIX`.
   - File-level widening (rather than scoping to inside the shell-call) catches the `audit-archive.ts` pattern: `const script = [\`...${cred}...\`].join(' | '); return { args: ['-c', script] };` — interpolation site is on the array-element template literal, not at the `args: [..., script]` reference.

Files without any Pass-1 context are skipped entirely (zero false-positive cost for credential-named locals in HTTP-header builders, log lines, regex .exec callers, etc.).

## Allowlist Seed

```
apps/worker/src/jobs/audit-archive.ts:106  # CR-5 — fixed in Phase 36.a; remove when locker flips to BLOCKING
apps/worker/src/jobs/audit-archive.ts:115  # CR-5 — fixed in Phase 36.a; remove when locker flips to BLOCKING
apps/worker/src/jobs/audit-archive.ts:127  # CR-5 — fixed in Phase 36.a; remove when locker flips to BLOCKING
```

Verified by `pnpm exec tsx tools/lint-shell-credential-interpolation.ts` (no `--warn-only`) on `main@2d77437`: all 3 are reported as `WARN  apps/worker/src/jobs/audit-archive.ts:{106,115,127}  [dbUrl]` and absorbed by the allowlist. Exit code: 0 (because `:127` is no longer the only flagged line — `:106` and `:115` are now correctly detected per Decision 2's file-level widening — but the additional 11 file findings outside audit-archive shift exit to 1 unless `--warn-only` is used; see "Threat Flags" below).

## Verification

| Gate                                                              | Result                                                |
|-------------------------------------------------------------------|-------------------------------------------------------|
| `pnpm test:lint-shell-credential-interpolation` ≥ 90/90/90/90    | **PASS** — stmts 98.94 / branches 92.10 / funcs 100 / lines 100 |
| 26 tests pass                                                     | **PASS**                                              |
| `pnpm lint:shell-credential-interpolation` (uses --warn-only)    | **PASS** — exit 0                                     |
| Allowlist absorbs all 3 audit-archive lines                       | **PASS** — `:106 + :115 + :127` all marked WARN       |
| `clean-regex-exec.ts` fixture NOT flagged                         | **PASS** — file has no shell context, returns []      |
| `clean-argv-array.ts` fixture NOT flagged                         | **PASS** — no template literal in spawn call          |
| `violates-spawn-bash.ts` fixture flagged                          | **PASS** — 1 finding                                  |
| `violates-exec-sync.ts` fixture flagged                           | **PASS** — 1 finding                                  |

## Deviations from Plan

**1. [Decision] AST detection instead of regex two-pass**

- **Plan said:** Mirror `lint-dockerfile-tls.ts` regex two-pass shape.
- **Spawn prompt said:** Use TS Compiler API directly, mirror `lint-tenant-context.ts`.
- **Chosen:** AST (spawn-prompt authoritative for runtime directives).
- **Documented in:** `31-06-DECISIONS.md` Decision 1.

**2. [Rule 2 — Auto-add missing critical functionality] File-level shell-context widening**

- **Found during:** Task 2 GREEN, after first lint run on `main` flagged only 1 of 3 seeded lines.
- **Issue:** A strict "template inside shell-call-arg" detector flags ONLY `audit-archive.ts:127` (which is directly inside `args: ['-c', \`...\${dbUrl}...\`]`). Lines 106 and 115 build the script string in a separate `const script = [\`...${dbUrl}...\`].join(' | ')` array; the variable is then passed by reference into `args: ['-c', script]`. The interpolation risk is identical, the detector must catch it.
- **Fix:** Widen second-pass scope to the entire file when ANY shell-execution context is present.
- **Side effect (Threat Flags below):** Surfaces 11 additional credential-template-shell findings in test/e2e infrastructure. These are legit risk under the same threat model; WARN-only mode absorbs them for now.
- **Documented in:** `31-06-DECISIONS.md` Decision 2.

## Threat Flags

The widened detector surfaces 11 additional shell-credential-interpolation sites beyond the plan's seed-of-3. All are in test/e2e infrastructure, NOT production code (which is why Phase 31 research counted only 1 production hit). They remain visible as WARN findings in CI logs (via `--warn-only`); Phase 36.a's closing commit should triage them (rewrite to argv-array form OR add to allowlist with per-line rationale).

| Threat surface                                            | File:Line                                              | Binding         |
|-----------------------------------------------------------|--------------------------------------------------------|-----------------|
| threat_flag: test-infra-shell-cred-interp                | packages/data/migrations/__tests__/0017-setup-state.test.ts:81 | ownerPassword  |
| threat_flag: test-infra-shell-cred-interp                | packages/data/migrations/__tests__/0017-setup-state.test.ts:84 | appPassword    |
| threat_flag: test-infra-shell-cred-interp                | packages/data/migrations/__tests__/0017-setup-state.test.ts:95 | ownerPassword  |
| threat_flag: e2e-helper-shell-cred-interp                | tests/e2e/compose-helper.ts:139                        | BACKEND_URL    |
| threat_flag: e2e-helper-shell-cred-interp                | tests/e2e/compose-helper.ts:150                        | BACKEND_URL    |
| threat_flag: e2e-helper-shell-cred-interp                | tests/e2e/helpers/phase6-compose.ts:316                | BACKEND_URL    |
| threat_flag: e2e-helper-shell-cred-interp                | tests/e2e/helpers/phase6-compose.ts:782                | BACKEND_URL    |
| threat_flag: e2e-helper-shell-cred-interp                | tests/e2e/helpers/phase6-compose.ts:801                | BACKEND_URL    |
| threat_flag: self-test-shell-cred-interp                 | tests/self-tests/rls-introspection.test.ts:40          | ownerPassword  |
| threat_flag: self-test-shell-cred-interp                 | tests/self-tests/rls-introspection.test.ts:58          | ownerPassword  |
| threat_flag: lint-test-shell-cred-interp                 | tools/lint-rls.test.ts:67                              | ownerPassword  |

These do not block this plan's landing — `pnpm lint:shell-credential-interpolation` (the lefthook-invoked script) uses `--warn-only` and exits 0. Phase 36.a triage required.

## WARN→BLOCKING Flip (Phase 36.a closing commit)

When Phase 36.a rewrites `audit-archive.ts:106,115,127` to argv-array form (CRIT-FIX-05), the SAME commit must:

1. Clear all 3 entries from `tools/lint-shell-credential-interpolation.allowlist.txt`.
2. Triage the 11 "Threat Flags" entries above — rewrite OR allowlist with rationale.
3. Drop `--warn-only` from `package.json` script `lint:shell-credential-interpolation`.
4. (When 31-07 lands lefthook/CI wiring) drop `--warn-only` from those invocations too.
5. Verify exit code 0 on a clean run.

## Out of Scope (this plan)

- Lefthook / CI / Makefile / DISCIPLINE / CLAUDE wiring — those land in 31-07.
- Fixing `audit-archive.ts:106,115,127` — those land in Phase 36.a (CRIT-FIX-05).
- The WARN→BLOCKING flip itself — Phase 36.a closing commit.
- Triaging the 11 additional threat-flagged findings — Phase 36.a or follow-on hygiene plan.

## Self-Check: PASSED

- [x] `tools/lint-shell-credential-interpolation.ts` exists, AST-based, --warn-only flag honored.
- [x] `tools/lint-shell-credential-interpolation.test.ts` exists, 26 tests pass.
- [x] `tools/lint-shell-credential-interpolation.allowlist.txt` exists, 3 entries (audit-archive:106,115,127).
- [x] 4 fixtures under `tools/lint-shell-credential-interpolation/fixtures/`.
- [x] `package.json` scripts: `lint:shell-credential-interpolation` (--warn-only) and `test:lint-shell-credential-interpolation` (--coverage 90/90/90/90).
- [x] Commit `20f0b7b` (RED) on HEAD.
- [x] Commit `731e921` (GREEN) on HEAD.
- [x] Working tree clean.
- [x] Coverage gate: stmts 98.94 / branches 92.10 / funcs 100 / lines 100 — all ≥ 90.
- [x] `31-06-DECISIONS.md` records all decisions.
