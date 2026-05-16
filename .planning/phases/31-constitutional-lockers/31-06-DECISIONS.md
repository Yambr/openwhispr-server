# Phase 31 / Plan 06 — Decisions Log

## Decision 1 — TS Compiler API instead of two-pass regex

**Plan said:** Mirror `lint-dockerfile-tls.ts` regex two-pass shape (Task 2.1).
**Spawn prompt said:** "Use TypeScript compiler API directly (mirror `tools/lint-tenant-context.ts` pattern)."
**Chosen:** TS Compiler API (spawn-prompt authoritative for runtime directives).

**Rationale:**
- AST natively distinguishes `re.exec(value)` (PropertyAccessExpression callee) from bare child_process `exec(...)` (Identifier callee) — no negative-lookbehind regex acrobatics required.
- Pattern matches the existing sibling `tools/lint-tenant-context.ts` (D-W4 layer 1) using `import ts from "typescript"` directly. No new dependency added.
- Coverage on the AST visitor's small surface is naturally above 90/90/90/90 with focused tests; the regex variant would need extra fixtures for the lookbehind boundary cases.

**Reverts:** None. Plan's risk-table "two-pass regex hurts coverage on edge paths" risk is dismissed by the AST approach.

## Decision 2 — File-level "shell-context-bearing" widening

**Problem:** The plan's allowlist seed names lines `:106 + :115 + :127` in `apps/worker/src/jobs/audit-archive.ts`. Lines 106 and 115 are template literals inside a `const script = [...].join(' | ')` array, NOT inside an `args: ['-c', ...]` array directly. A strict "template inside shell-call-or-bash-c-array" detector flags ONLY line 127 (which IS inside `args: ['-c', \`...\${dbUrl}...\`]`).

**Chosen detector:**
1. First pass — does the source file contain ANY shell-execution context (bare `spawn`/`exec`/`execSync`/`execFileSync` Identifier-callee CallExpression OR `['-c', ...]` ArrayLiteralExpression)?
2. If yes, second pass — flag every credential-interpolating TemplateExpression in the whole file.

**Rationale:**
- The audit-archive shape is the canonical "build a script string with credential interpolations, then pass it to `args: ['-c', script]`". The forensic interest is the interpolation line, not the variable-reference line. Lines 106 and 115 are the actual risk.
- Files with NO shell context (e.g., `apps/api/src/middleware/dual-auth.ts` which has only a regex `.exec`, OR pure HTTP-header builders) are skipped entirely — the credential-named variables there have no shell exposure.
- False-positive cost is bounded: the fixture `clean-regex-exec.ts` is preserved (no shell context → not flagged).

**Side effect (Rule 2 — Auto-add missing critical functionality):** The widened detector surfaces 11 additional findings beyond the 3 seeded by the plan:
- `packages/data/migrations/__tests__/0017-setup-state.test.ts:81,84,95` — `ownerPassword` / `appPassword` interpolated inside `psql -c "${pw}"` shell scripts (test infra).
- `tests/e2e/compose-helper.ts:139,150` — `${BACKEND_URL}` inside `docker compose exec` shell strings.
- `tests/e2e/helpers/phase6-compose.ts:316,782,801` — same `BACKEND_URL` pattern.
- `tests/self-tests/rls-introspection.test.ts:40,58` + `tools/lint-rls.test.ts:67` — `ownerPassword` interpolated in `psql -c` scripts.

These are legit shell-cred-interpolation sites under the same security threat model as CR-5 (credentials reach the shell via template literal). They appear in test/e2e infrastructure (not production code), which is why the Phase 31 research inventory pegged only 1 real call-site for the **production** worker. The locker correctly catches them.

**Disposition:** WARN-only mode absorbs them. Phase 36.a's closing commit can either (a) rewrite them to argv-array form OR (b) extend the allowlist with rationale per finding. Tracking: surface in 31-06-SUMMARY.md "Threat Flags" section.

## Decision 3 — Allowlist file:line granularity

**Plan said:** `apps/worker/src/jobs/audit-archive.ts:106 + :115 + :127` with comment.
**Sibling pattern (`lint-dockerfile-tls.allowlist.txt`):** file-only (no line).
**Chosen:** `file:line` per plan spec.

**Rationale:** Three hits in one file; per-line allowlist gives the Phase 36.a rewrite commit a precise "did I clear all three?" verification — clearing the file by name would lose that signal.
