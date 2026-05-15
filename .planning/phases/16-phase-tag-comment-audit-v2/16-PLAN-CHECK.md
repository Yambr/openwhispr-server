# Phase 16 — Plan Check

**Date:** 2026-05-15
**Plans verified:** `16-01-PLAN.md`, `16-02-PLAN.md`
**Mode:** Goal-backward (start from COMMENT-01..04 + ROADMAP §16 success criteria; verify plans deliver)

## Verdict: PASS-WITH-CONCERNS

Two non-blocking concerns surfaced (one wording inconsistency in 16-02 must_haves vs body; one ambiguity in lint-CLI argv shape vs CONTEXT). Both are WARNING-level — they will not prevent goal achievement but should be tightened pre-execute to avoid drift. No BLOCKER. Orchestrator MAY proceed to `/gsd-execute-phase 16`; planner should fold the two fixes in if convenient.

---

## 1. Requirement Coverage Matrix (COMMENT-01..04 × plan)

| Req | Wording (REQUIREMENTS.md L489-492) | 16-01 frontmatter `requirements:` | 16-02 frontmatter `requirements:` | Covering tasks | Status |
|---|---|---|---|---|---|
| COMMENT-01 | ts-morph codemod audits 754 (was 771) header comments in apps/+packages/ | ✓ listed | ✓ listed | 16-01 T1-T2 (codemod), 16-02 T2-T6 (audit per area) | COVERED |
| COMMENT-02 | Two-bucket REMOVE/KEEP classification; CLAUDE.md policy | ✓ listed | ✓ listed | 16-01 T1-T2 (classifyLine predicate, 4 REMOVE + 5 KEEP rules), 16-01 T6 (conventions.md ratifies) | COVERED |
| COMMENT-03 | Lint regression rule (tsx CLI per Q3 wording flip) | ✓ listed | — (correctly not claimed; 16-02 doesn't add rule logic) | 16-01 T3-T5 (lint CLI + wiring triad) | COVERED |
| COMMENT-04 | ONE squashed OR ≤ 50 files-per-commit (never 754 atomic) | — (no sweep in 16-01) | ✓ listed | 16-02 T2-T6 (5 per-area atomic commits, each < 150 files per CONTEXT estimate) | COVERED |

**No uncovered requirement IDs.** Every COMMENT-NN appears in at least one plan's `requirements:` field and has covering task(s).

Concern (informational): the literal "ts-morph AST codemod" wording in COMMENT-01 / ROADMAP §16-SC#1 is **intentionally being walked back** to "regex-on-text codemod" per PATTERNS §critical-correction #3 and CONTEXT Q3. The 16-02 T1 ROADMAP edit covers the `exactly 771 → ~754` and `ESLint → lint` rewrites but does **NOT** rewrite the `ts-morph AST codemod (NOT regex)` phrasing. This is a non-blocker — the codemod ships as regex-on-text per PATTERNS, and the verifier should be told (via 16-02 SUMMARY) that the ts-morph wording in ROADMAP §16 is now stale technical detail rather than a contract. Recommend folding a third ROADMAP rewrite into 16-02 T1: `ts-morph AST codemod (NOT regex)` → `regex-on-text codemod (ts-morph dep reserved for deferred inline-comment phase)`.

## 2. ROADMAP §16 Success Criterion × Plan Delivery

| SC | Wording (current) | Delivered by | Status |
|---|---|---|---|
| SC1 | `exactly 771` audited | 16-02 T1 edits to `approximately 754`; 16-02 T2-T6 sweep proves count empirically | COVERED (post-edit) |
| SC2 | 50-file sample before bulk run | 16-01 T2 codemod ships with `audit` verb that runs against whole tree; first per-area sweep (16-02 T2 = `apps/worker`, ~20-30 files) IS the empirical canary | COVERED (per-area canary substitutes for arbitrary 50-file sample; CONTEXT Q5 + PATTERNS §1 explicitly endorse this) |
| SC3 | ESLint regression rule | 16-02 T1 rewrites SC3 to "lint regression rule (tsx CLI)"; 16-01 T3-T5 ship `tools/lint-phase-tag-comments.ts` | COVERED (post-edit) |
| SC4 | ONE squashed OR ≤ 50 files; never 771 atomic | 16-02 T2-T6 = 5 per-area atomic commits; each area sized per CONTEXT estimate as < 150 files (largest `apps/api/src` ~ 250-300 — *see concern below*) | COVERED with concern |
| SC5 | Verifier PASSED ≥ 90/90/90/90; e2e green; no Phase 13 regression | 16-01 T1-T4 explicitly gate ≥ 90/90/90/90 on both new tools; 16-02 sweep commits each include 0-diff waiver per PATTERNS §"Reusable conventions"; 16-02 T2-T6 each run per-workspace `pnpm test` | COVERED |

**SC4 concern (WARNING):** CONTEXT estimates `apps/api/src` at ~250-300 files. ROADMAP SC4 says "≤ 50 files OR ONE squashed". Phase 15-03 precedent for per-area sweep > 150 files split with W-3 (PATTERNS §1). 16-02 T6 keeps `apps/api/src` as ONE commit on the rationale that comment-only-delete churn ≠ widespread file rewrite — this is reasonable, but the ROADMAP literal `≤ 50 files` will be technically violated by 250-300 files in one commit. Two options:
- (a) Land the 16-02 T1 ROADMAP edit with an additional rewrite of SC4: `≤ 50 file commits` → `per-area atomic commits (each < 300 files for comment-only deletions per Phase 15-03 precedent)`.
- (b) Pre-split T6 with a deterministic sub-split (e.g., `apps/api/src/routes` + `apps/api/src/{plugins,services,lib,...}`).

Recommend (a) — wording fix is the cheaper, lower-risk change, and CONTEXT Q4 already endorses the per-area model.

## 3. Locked Decisions (CONTEXT Q1-Q4) × Plan Honor

| # | Locked decision | Honored in plans? | Evidence | Status |
|---|---|---|---|---|
| Q1 | Option B (754/515 header scope, ROADMAP `771 → ~754` edit) | YES | 16-01 frontmatter truths line "scoped to `apps/` + `packages/`"; 16-02 T1 ROADMAP/REQUIREMENTS edit `exactly 771 → approximately 754`; 16-02 T1 verify grep gate `! grep -q 'exactly 771'` | HONORED |
| Q2 | Option 1 (heuristic-only, conservative KEEP, NO audit MD, NO operator review) | YES | 16-01 T1-T2 single-predicate `classifyLine` with 4 REMOVE + 5 KEEP rules; 16-01 T2 GREEN action explicitly orders KEEP rules first (default-KEEP precedence); no `Phase16-COMMENT-AUDIT.md` in either plan's files_modified | HONORED |
| Q3 | Option A (standalone tsx CLI, wiring triad atomic, no new CI job, COMMENT-03 wording flip) | YES | 16-01 T3-T5 ship `tools/lint-phase-tag-comments.ts` mirroring `lint-colocated-tests.ts`; T5 action explicitly says "wiring triad lands in ONE commit"; T5 explicit "NO new job. NO new runner config" + ci.yml line-append to existing `lint-english` job at L39; 16-02 T1 rewrites `ESLint regression rule → lint regression rule (tsx CLI)` | HONORED |
| Q4 | Option 2' (per-area smallest-first, no `--no-verify`, ME-02 inline body) | YES | 16-02 T2-T6 explicit order worker → packages → web → api/tests → api/src; T2 action explicit "Commit WITHOUT `--no-verify`" + halt-and-escalate if hook fails (no silent fallback); deviation_handling section L373-389 carries the 10-line ME-02 issue body | HONORED |

**All 4 locked decisions honored.** No contradiction or silent scope reduction detected.

## 4. PATTERNS Critical-Corrections × Plan Honor

| # | Pattern correction | Honored? | Evidence |
|---|---|---|---|
| 1 | `audit`/`fix` subcommands (NOT `--dry-run`/`--apply` flags) | YES | 16-01 T2 GREEN action L205: "`async function main(argv: string[]): Promise<number>` accepting `[\"audit\"\|\"fix\", rootDir?]`" — bare positional verbs, no flag dashes |
| 2 | `node:fs/promises` `glob` (NOT fast-glob/globby/tinyglobby) | YES | 16-01 T2 GREEN action L203 explicit "uses `node:fs/promises` `glob` (copy `spdx-header.ts:285-297`)"; deviation_handling L365 explicit "Do NOT introduce `fast-glob` or `tinyglobby`" |
| 3 | Regex-on-text (NOT AST traversal); ts-morph reserved | YES | 16-01 frontmatter truth L27 explicit: "Codemod uses regex-on-text line-by-line approach (NOT AST traversal); ts-morph dep remains unused-by-Phase-16" |
| 4 | `findViolations(root)` exported for direct-import tests | YES | 16-01 T3 RED test L228-230 calls `findViolations(root)` directly; T4 GREEN action L266 exports `findViolations(root: string): Promise<Violation[]>` |
| 5 | Wiring triad as ONE atomic commit | YES | 16-01 T5 name "Wire lint rule into pnpm + lefthook + CI (ONE atomic commit)"; T5 action L302 explicit "wiring triad lands as ONE commit, not three"; commit message `feat(16-01): wire lint-phase-tag-comments into pnpm + lefthook + CI` |
| 6 | No new CI job (append to `lint-english`) | YES | 16-01 T5 action L315 explicit "append a single line ... to the EXISTING `lint-english` job ... NO new job. NO new runner config"; T5 done L326 explicit "verifier checks job count is unchanged from prior state" |

**All 6 critical corrections honored.** No deviation detected.

## 5. TDD Discipline

| Plan | Task | Type | RED-before-GREEN? | Notes |
|---|---|---|---|---|
| 16-01 | T1 | RED test | n/a | Writes test suite first; commit `test(16-01): RED phase-tag-sweep classifier + codemod`; expected module-not-found |
| 16-01 | T2 | GREEN impl | YES (depends on T1) | Implementation lands AFTER T1's tests are RED; commit `feat(16-01): heuristic phase-tag-sweep codemod` |
| 16-01 | T3 | RED test | n/a | Lint CLI test suite written first; commit `test(16-01): RED lint-phase-tag-comments rule` |
| 16-01 | T4 | GREEN impl | YES (depends on T3) | Lint CLI implementation after RED; commit `feat(16-01): lint-phase-tag-comments tsx CLI + transitional allowlist` |
| 16-01 | T5 | wiring | n/a (no new logic, only config edits) | Triad commit; verify via end-to-end smoke |
| 16-01 | T6 | docs | n/a | conventions.md append |
| 16-02 | T1-T7 | refactor/docs | n/a (no new production code; 0-diff waiver per commit) | Sweep is pure mechanical codemod output; no new behavior, no new tests needed (CONTEXT-acceptable) |

**TDD discipline RESPECTED.** Every new logic-bearing file (`tools/phase-tag-sweep.ts`, `tools/lint-phase-tag-comments.ts`) has its RED test commit precede the GREEN implementation commit. 16-02 is pure mechanical refactor → 0-diff coverage waiver is correctly applied per PATTERNS §"Reusable conventions".

## 6. Coverage Gate

| Plan | New code file | Coverage gate stated | Where |
|---|---|---|---|
| 16-01 | `tools/phase-tag-sweep.ts` | ≥ 90/90/90/90 | T1 frontmatter truth L40; T2 behavior L194; T2 verify `--coverage`; T2 done L219; success_criteria #1 |
| 16-01 | `tools/lint-phase-tag-comments.ts` | ≥ 90/90/90/90 | T3 frontmatter truth L46; T4 behavior L257-258; T4 verify `--coverage`; T4 done L289; success_criteria #2 |
| 16-02 | 5 sweep commits | 0-diff waiver | Each sweep commit body explicitly carries `0-diff coverage waiver: comment-only deletions, no behavior change.` (16-02 T2 commit body L181, T3 L227, T4 L260, etc.); frontmatter truth L27 |

**Coverage discipline RESPECTED.** New tooling gated at ≥ 90/90/90/90; sweep commits explicitly waivered per Phase 15-02/15-03 precedent.

## 7. Atomicity & Constitutional Checks

| Check | Status | Evidence |
|---|---|---|
| English-only artifacts | PASS | Both PLAN.md files, CONTEXT.md, PATTERNS.md fully English; no Russian; only Russian content in this whole phase chain lives in user's global ~/.claude/CLAUDE.md which is constitutional advice, NOT artifact content |
| No mocks of internal logic | PASS | 16-01 tests use real-FS tmpdir (`mkdtempSync`); no mocked file system or mocked classifier; CONTEXT Q5 + PATTERNS explicitly endorse real-FS fixture style |
| No `--no-verify` planned | PASS | 16-02 T2 action L173 explicit "Commit WITHOUT `--no-verify`"; T2 action L189-194 explicit halt-and-escalate on lefthook fail (NO silent `--no-verify` fallback); success_criteria #4-#5 mandate explicit recording of hook outcome; deviation_handling carries the "ME-02 EMPIRICALLY FIRED → only THEN consider `--no-verify` with explicit justification" escape hatch matching CONTEXT Q4 |
| Atomic per-task commits | PASS | Every 16-01 task has explicit `Commit as: <type>(16-01): <message>` line; every 16-02 sweep task has explicit conventional-commit template in action body |
| Conventional commits | PASS | All commit messages follow `type(scope): summary` template (test/feat/refactor/docs/chore × 16/16-01/16-02 scopes) |

## 8. Specific Gap Items from the Goal-Backward Trace

### Smallest-first sweep ordering (CONTEXT Q5 + Prompt #8)

VERIFIED. 16-02 task order: T2 `apps/worker` → T3 `packages/` → T4 `apps/web` → T5 `apps/api/tests` → T6 `apps/api/src`. Matches the prompt-supplied ordering verbatim.

### ME-02 inline issue body (CONTEXT Q4 + PATTERNS §3 + Prompt #9)

VERIFIED. `16-02-PLAN.md` `<deviation_handling>` section (L371-401) contains a 10-line markdown body (L377-390) matching PATTERNS §ME-02 draft (L199-212) with one Phase-16-specific enrichment paragraph (the "Phase 16 empirical update" line). Operator can copy-paste verbatim into https://github.com/evilmartians/lefthook/issues/new.

## 9. Plan-Internal Concerns (NON-BLOCKING)

### CONCERN-1 (WARNING) — Lint CLI argv shape literal differs between truth and test

`16-01-PLAN.md` frontmatter truth L41: lint CLI argv shape is `"tsx tools/lint-phase-tag-comments.ts [rootDir]"` (positional `[rootDir]` only, no subcommands — mirrors `lint-colocated-tests.ts`).

`16-01-PLAN.md` Task 3 (RED test) L233 Test L6: `main(["", root])` — passes an EMPTY-STRING positional before `root`. This is inconsistent: if argv shape is `[rootDir]`, the test should be `main([root])`. The `[""", root]` form looks like a copy-paste from spdx-header (where argv is `[verb, rootDir]`).

**Impact:** Test L6 will likely fail GREEN even after T4 implementation lands, because `main([""])` will treat `""` as rootDir and `root` as ignored — or vice versa, depending on implementation. RED will pass trivially (module not found), but the GREEN gate at T4 will require fixing either the test or the impl.

**Fix:** Edit 16-01 Task 3 RED Test L6 (line ~233) from `main(["", root])` to `main([root])`. One-line correction.

### CONCERN-2 (WARNING) — ROADMAP edit scope incomplete

16-02 T1 ROADMAP edit covers `exactly 771 → approximately 754` and `ESLint → lint`, but leaves the ROADMAP §16 SC1 phrase `ts-morph AST codemod (NOT regex)` and SC4 phrase `≤ 50 file commits` untouched. Both are now technically stale per PATTERNS critical-correction #3 and the 250-300-file `apps/api/src` sweep size, respectively.

**Impact:** Verifier reading ROADMAP literally will see "ts-morph AST codemod (NOT regex)" but the shipped codemod is regex-on-text; will see "≤ 50 file commits" but `apps/api/src` ships as ~300 file commit. Both should pass on intent (CONTEXT + PATTERNS authoritative), but the literal ROADMAP wording mismatch invites verifier nitpick.

**Fix:** Extend 16-02 T1 action with two more surgical Edit calls:
1. ROADMAP §16 SC1: `ts-morph AST codemod (NOT regex` → `regex-on-text codemod (ts-morph dep reserved for deferred inline-comment phase`
2. ROADMAP §16 SC4: `grouped into ≤ 50 file commits` → `grouped per-area (each area atomic; max area size ~300 files for comment-only deletions per Phase 15-03 precedent)`

Both edits one-line, same atomic commit as the existing T1 edits.

## 10. Summary

- **Coverage:** 4/4 requirements claimed and covered, 5/5 SCs delivered.
- **Locked decisions:** 4/4 honored.
- **PATTERNS critical-corrections:** 6/6 honored.
- **TDD/coverage/atomicity/constitutional:** all green.
- **Scope reduction:** none detected. Heuristic-only ~30-50% strip rate is **explicit CONTEXT-acceptable** per CONTEXT Q2 acceptable-risk note + PATTERNS §"Heuristic-only under-delivery", NOT silent scope reduction.
- **Concerns:** 2 wording-level WARNINGs (CONCERN-1, CONCERN-2) — both one-line fixes, both improve clarity without changing intent.

**Recommendation:** Orchestrator MAY proceed to `/gsd-execute-phase 16`. Planner may optionally fold CONCERN-1 + CONCERN-2 fixes in before execute (1-2 minute edits) to avoid verifier nitpick at phase close.
