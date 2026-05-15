<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
<!-- REUSE-IgnoreStart -->
# Phase 16 — Pattern Map

**Mapped:** 2026-05-15
**Plans:** 16-01 (codemod + lint rule), 16-02 (per-area sweep + ME-02 followup)
**Mode:** advisor; no source edits in this artifact.

## File Classification (cross-plan)

| File (new or modified) | Plan | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|---|
| `tools/audit-phase-tag-comments.ts` (codemod CLI) | 16-01 | tooling/codemod | filesystem | `tools/spdx-header.ts` (audit/fix CLI, exit 0/1/2, glob+rewrite) | exact (shape) |
| `tools/audit-phase-tag-comments.test.ts` | 16-01 | test | unit (vitest + tmpdir) | `tools/lint-colocated-tests.test.ts` + `tools/migrate-tests.test.ts` | exact |
| `tools/lint-phase-tag-comments.ts` (lint CLI) | 16-01 | lint rule | static text scan | `tools/lint-colocated-tests.ts` (allowlist file + exit 0/1/2) | exact |
| `tools/lint-phase-tag-comments.test.ts` | 16-01 | test | unit | `tools/lint-colocated-tests.test.ts` | exact |
| `tools/lint-phase-tag-comments.allowlist.txt` | 16-01 | config | static list | `tools/lint-colocated-tests.legacy-allowlist.txt` (referenced; file currently absent post-15-02 delete — shape spec lives in `lint-colocated-tests.ts:46`) | role-match |
| `package.json` (root) — add `lint:phase-tag-comments` script | 16-01 | metadata | static | `package.json` lines 16-23 (`lint:colocated-tests`, `lint:tdd`, …) | exact |
| `lefthook.yml` — add `phase-tag-comments` block | 16-01 | hook config | static | `lefthook.yml` lines 17-19 (`colocated-tests` block) | exact |
| `.github/workflows/ci.yml` — add `pnpm lint:phase-tag-comments` step | 16-01 | CI | static | `ci.yml:38-39` (`pnpm lint:english` + `pnpm lint:colocated-tests` co-located in `lint-english` job) | exact |
| `docs/conventions.md` — append `## Phase-tag comments` section | 16-01 | doc | static | `docs/conventions.md` "Test layout" section (cross-ref idiom) | exact |
| Per-area sweep commits (5 commits) | 16-02 | refactor (codemod output) | filesystem | Phase 15-03 commits `aca506e / 0fa4f9a / fe80f80 / a9c21e0 / 7d759db / 7aeea9b / 2e0eba0` | exact |
| `ROADMAP.md` — fix §16 wording (771 → ~754; ESLint → lint) | 16-02 | doc | static | `docs(roadmap):` commits e.g. `bee1961`, `12559ed`, `6def3a9` | role-match |
| `.github/ISSUE_TEMPLATE/lefthook-patch-reapply.md` (ME-02) | 16-02 | issue template | static | `.github/ISSUE_TEMPLATE/fsl-history-scrub-cutover.md` (md-frontmatter shape) | exact |

---

## Plan 16-01 — Codemod + Lint Rule + Tests

### Closest analogs

#### 1. ts-morph / file-rewrite codemod CLI — `tools/spdx-header.ts` (425 lines)

- **Argv parsing** — `spdx-header.ts:369-406` `main(argv)`: bare positional verbs `audit | fix | audit-hash | fix-hash` plus optional `[rootDir]` defaulting to `process.cwd()`. No `commander` / `yargs` dep; raw `argv[2]` / `argv[3]`. Apply same shape to `audit-phase-tag-comments.ts`:
  - `audit [rootDir]` → dry-run, exit 0 clean / 1 candidates / 2 error
  - `fix [rootDir]` → in-place delete, stdout prints `N comment(s) removed`, exit 0
  - (16-01 does NOT add `--dry-run` / `--apply` flags — verb is the mode, matches spdx-header precedent exactly)
- **Exit-code semantics** (`spdx-header.ts:19-24`, `:372-405`):
  - audit clean → 0
  - audit dirty → 1 (one-line summary + per-file list to stderr)
  - fix → 0 with count to stdout
  - usage error / internal throw → 2 (caught at `:417-420`)
- **Working-dir traversal** — `spdx-header.ts:285-297` uses **Node 24 built-in `node:fs/promises` `glob`** with PATTERNS + IGNORE arrays (NOT `fast-glob` / `globby` / `tinyglobby`). Copy verbatim. EXTENSIONS for Phase 16 codemod = `[".ts", ".tsx"]` only (CONTEXT scope = `apps/` + `packages/` TS/TSX); SKIP_DIRS identical to `:82-91`.
- **CLI entry guard** — `spdx-header.ts:411-414` `invokedDirect` check; Vitest does NOT trigger this branch (its `argv[1]` does not match the file name). Copy verbatim — this is the pattern that lets the codemod be both `pnpm exec tsx tools/...` runnable AND import-friendly for unit tests.
- **ts-morph availability** — root `package.json:66` already pins `"ts-morph": "^28.0.0"` (added Phase 15-01 for `tools/migrate-tests.ts`). Plan 16-01 can `import { Project } from "ts-morph"` with zero new deps. **However** for header-style comment deletion the regex-on-text approach used by `spdx-header.ts` (line-by-line rewrite) is simpler and more reproducible than AST traversal — recommend the regex path with ts-morph reserved for FUTURE inline-comment phase (deferred).
- **Sibling test shape** — `tools/migrate-tests.test.ts` (310 lines) is the closer fixture-style precedent (vs the shorter `spdx-header.test.ts` under `tools/__tests__/`). It uses `mkdtempSync(join(tmpdir(), "..."))` + `beforeEach/afterEach`, runs the function programmatically (not via `execFileSync`), asserts via `findViolations`-style return values. Mirror in `audit-phase-tag-comments.test.ts`:
  - tmpdir per `it`
  - `touch(rel, content)` helper writing fixture files
  - call exported `auditDir(root)` / `fixDir(root)` directly
  - assert per-bucket: REMOVE bucket cases 1-4 (CONTEXT Q2) each get 1 test; KEEP bucket cases 1-5 each get 1 test → 9 RED tests minimum + edge cases for ≥90/90/90/90.

#### 2. Standalone tsx lint CLI — `tools/lint-colocated-tests.ts` (161 lines)

- **Argv shape** — `lint-colocated-tests.ts:120-143`: bare `tsx tools/lint-X.ts [rootDir]`, no subcommands. Copy verbatim for `lint-phase-tag-comments.ts`.
- **Exit codes 0/1/2** — `:27-30`. Same triad as spdx-header.
- **Allowlist file format + reader** — `:46` declares `LEGACY_ALLOWLIST_FILE` constant; `:76-86` `readLegacyAllowlist(rootDir)` reads one POSIX path per line, skips `#` comments + blank lines, returns `Set<string>`. **The allowlist file is currently absent from the repo** (deleted as final commit of Phase 15-02 once migrate-tests.ts moved everything). Phase 16-01 allowlist `tools/lint-phase-tag-comments.allowlist.txt` re-establishes this file shape — recommend identical reader logic, copy-pasted with renamed constant.
- **Allowlist semantics** — for Phase 16 the allowlist holds *legitimate KEEP* paths (e.g., files with `// D-NN — <real WHY>` inline anchors the heuristic can't safely classify). Ratchet-down post-sweep: every sweep commit can delete its corresponding allowlist entries.
- **Wiring (3 sites — all required by CONTEXT Q3):**
  1. `package.json:23` — add `"lint:phase-tag-comments": "tsx tools/lint-phase-tag-comments.ts"` next to `lint:colocated-tests`.
  2. `lefthook.yml:17-19` — add a sibling block immediately after `colocated-tests:`:
     ```yaml
     phase-tag-comments:
       glob: "{apps,packages}/**/*.{ts,tsx,md,yml,sh}"
       run: pnpm lint:phase-tag-comments
     ```
  3. `.github/workflows/ci.yml:39` — append `- run: pnpm lint:phase-tag-comments` to the existing `lint-english` job (lines 29-39) which already chains `lint:english` + `lint:colocated-tests`. Adding a 4th line keeps job count flat (no new runner provision cost).
- **Test shape** — `tools/lint-colocated-tests.test.ts` (125 lines): tmpdir + `touch` + direct `findViolations(root)` call. Per-rule positive + negative cases. Copy verbatim for `lint-phase-tag-comments.test.ts`.

#### 3. Heuristic-classifier precedent (multi-rule decision tree)

- **`tools/lint-docs-headings.ts` (222 lines)** is the closest in-repo precedent for a deterministic content-classification rule with multiple shape checks (`:6-13` enumerates 4 distinct rules: H2 presence, fenced-block per H2, source-line citation, named-subsection presence). Phase 16's REMOVE-bucket decision tree (CONTEXT Q2: 4 REMOVE rules + 5 KEEP rules) maps cleanly onto the same shape. Mirror:
  - One exported predicate per rule (`isBareHeader(line)`, `isTrailingBareDNN(line)`, `isCloseOutNarrative(line)`, …)
  - Each predicate gets its own `it("classifies …")` test
  - Top-level `classify(line, file, neighbourLines): "REMOVE" | "KEEP"` glues them; default branch → `KEEP` (CONTEXT Q2: "default KEEP on ambiguity")
- **`tools/lint-tdd.ts` (129 lines)** — useful for the `execFileSync("git", ...)` pattern if the codemod ever needs to scope to staged/diff'd files, but for Phase 16 the codemod runs over the full tree, so this analog is informational only.
- **`tools/lint-rls.ts` / `tools/lint-cjm-doc.ts`** — same Biome-pivot shape; no additional pattern to extract beyond what `lint-docs-headings.ts` already provides.

### Reusable conventions

- SPDX line-1 header on `.ts` (FSL-1.1-ALv2 — confirmed by Phase 15-03 sweep; `spdx:check` job in CI enforces).
- `#!/usr/bin/env -S pnpm exec tsx` shebang line 1, SPDX line 2 (see `lint-colocated-tests.ts:1-2`).
- Module-level `export function` shape so tests import-and-call rather than fork+exec.
- All glob patterns POSIX; normalize via `replace(/\\/g, "/")` (`spdx-header.ts:110`).
- Coverage floor ≥ 90/90/90/90 enforced by per-workspace `vitest.config.ts` `thresholds`; `tools/` inherits root `vitest.config.ts` config.

### Files to create vs modify

| Action | File |
|---|---|
| Create | `tools/audit-phase-tag-comments.ts` (codemod CLI; verbs `audit` + `fix`) |
| Create | `tools/audit-phase-tag-comments.test.ts` (RED→GREEN per bucket rule) |
| Create | `tools/lint-phase-tag-comments.ts` (regression-guard CLI) |
| Create | `tools/lint-phase-tag-comments.test.ts` |
| Create | `tools/lint-phase-tag-comments.allowlist.txt` (transitional; pruned across 16-02 sweep commits) |
| Modify | `package.json` — add `lint:phase-tag-comments` + `audit:phase-tag-comments` scripts |
| Modify | `lefthook.yml` — add `phase-tag-comments` pre-commit command (after `colocated-tests:`) |
| Modify | `.github/workflows/ci.yml` — append `- run: pnpm lint:phase-tag-comments` to `lint-english` job (line 39) |
| Modify | `docs/conventions.md` — append `## Phase-tag comments` section linking rule + allowlist + REMOVE/KEEP heuristics |

### Risk callouts

- **Heuristic classifier rule-table — limited in-repo precedent.** `lint-docs-headings.ts` checks 4 named structural rules but does NOT use a "REMOVE vs KEEP bucket with default-fallback" branching. The exact decision-tree shape (CONTEXT Q2: 4 REMOVE rules with explicit anchoring regex, 5 KEEP rules including KEYWORD-presence checks for "because"/"workaround"/"NEVER"/"prevent"…) is novel. Mitigation: encode each rule as a separately-tested predicate; classifier returns `KEEP` for any non-matched comment; emit per-comment trace in `audit` mode for human spot-check on the first sweep commit.
- **Multi-language lint scope.** CONTEXT Q3 specifies the lint scans `.ts/.tsx/.md/.yml/.sh`. The codemod (16-01) operates on `.ts/.tsx` only (CONTEXT live-count scope: 754 across 515 files in `apps/`+`packages/` for TS/TSX). The LINT is broader because future docs/YAML drift must be guarded. `spdx-header.ts` already has the `HASH_PATTERNS = ["**/*.yml", "**/*.yaml", "**/*.sh"]` + `HASH_HEADER` precedent at lines 224/53 — copy that bifurcation pattern: one scan loop for `// (Phase|Plan|D-)\s*\d+` (TS/TSX/JS), a second for `# (Phase|Plan|D-)\s*\d+` (YAML/SH), a third for inline-markdown `<!-- Phase NN … -->` (MD). All three call the same `classify()` predicate.
- **Regex correctness vs CONTEXT scope-correction.** CONTEXT `<scope_correction>` flagged that the orchestrator's initial regex `(// |/\* |\* )(Phase|Plan|D-)[0-9]` missed `Phase NN` with a space. The lint rule MUST use `\s*\d+` after the keyword, not bare `[0-9]`. Test fixture: `// Phase 14 / Plan 04 / Task 3 …` (real example from `apps/api/src/index.ts:47`) must be detected as a match.
- **ts-morph version pin.** Root `package.json:66` `"ts-morph": "^28.0.0"`. If 16-01 chooses the regex-on-text path (recommended), ts-morph is NOT imported and the dep stays unused-by-Phase-16. Document the choice in PLAN.md so a future inline-comment phase can pick AST traversal without changing the dep.

---

## Plan 16-02 — Per-Area Sweep + ME-02 Followup

### Closest analogs

#### 1. Per-area atomic commit shape — Phase 15-03 sweep commits

Seven commits between `aca506e` (oldest sweep) and `2e0eba0` (newest sweep). Pattern verified against `git log --oneline aca506e^..2e0eba0`:

| Commit | Area | Files | Body (key extract) |
|---|---|---|---|
| `aca506e` | `apps/api` (src + scripts + configs) | 114 | "line-1 (or line 2 after shebang) SPDX header flipped from Apache-2.0 to FSL-1.1-ALv2 via 'pnpm spdx:fix'" |
| `0fa4f9a` | `apps/api/tests` | (sweep) | identical preamble |
| `fe80f80` | `apps/web` (src + configs) | (sweep) | identical preamble |
| `a9c21e0` | `apps/web/tests` | (sweep) | identical preamble |
| `7d759db` | `apps/worker` | 40 | "line-1 SPDX header flipped from Apache-2.0 to FSL-1.1-ALv2 via 'pnpm spdx:fix'" |
| `7aeea9b` | `packages/` | 136 | identical preamble; **landed with `--no-verify`** (root cause = ME-02) |
| `2e0eba0` | `tools/` | 66 | identical preamble |

**Commit-message shape to mirror for 16-02 sweeps** (CONTEXT Q5):
```
refactor(16): sweep N phase-tag comments <area>

<N> source files in <area> — header-style phase-tag comments
(// Phase NN[.M] / Plan NN[-MM] …, trailing bare // D-NN, history
close-out comments) removed via 'pnpm exec tsx tools/audit-phase-tag-comments.ts fix <area>'.
Inline `// D-NN — <prose>` anchors and KEEP-bucket matches untouched.

0-diff coverage waiver: comment-only deletions, no behavior change.
```

**Per-area ordering (CONTEXT Q5 — smallest first):** `apps/worker` → `packages/` → `apps/web` → `apps/api/tests` → `apps/api/src`. CONTEXT estimates each area under 150 files → no W-3 trigger.

#### 2. Lefthook patch-reapply defect (ME-02) — risk vs. expected behavior

- `lefthook.yml:5-9`:
  ```yaml
  biome:
    glob: "*.{ts,tsx,js,jsx,json}"
    run: pnpm exec biome check --write {staged_files}
    stage_fixed: true
  ```
- Phase 15-REVIEW §ME-02 (`15-REVIEW.md:139-147`): defect surfaces when `100+ files with overlapping staged/unstaged biome rewrites`. Phase 16 deletes comment lines only — biome doesn't reformat anything else on comment-only deletes. **CONTEXT predicts lefthook will pass cleanly without `--no-verify`** on all five sweep commits. PLAN must:
  - Run the first sweep (smallest, `apps/worker`) WITHOUT `--no-verify`.
  - If hook fails: pause, file the ME-02 issue immediately, escalate as a deviation, and only THEN consider `--no-verify` with a documented justification in the commit body (matching `7aeea9b` precedent).
  - If hook passes: proceed through remaining 4 sweeps without `--no-verify`. Document the success in 16-SUMMARY.md as empirical confirmation that comment-only edits don't trigger the defect.

#### 3. ME-02 lefthook upstream issue body — closest in-repo template

`.github/ISSUE_TEMPLATE/` contains 6 files. The two `.md` files (`fsl-history-scrub-advance.md`, `fsl-history-scrub-cutover.md`) use markdown-frontmatter `name: / about: / title: / labels: / assignees:` shape. The `.yml` files (`bug.yml`, `feature.yml`, `question.yml`) use GitHub issue-form schema. **The ME-02 followup is an operator-filed bug report against the lefthook UPSTREAM project — it is NOT a repo issue template** (it's a one-shot issue body the operator pastes when filing at https://github.com/evilmartians/lefthook/issues/new).

Recommended path:
- Author the issue body INLINE in 16-02 PLAN.md (no template file added to repo).
- OR add `.github/ISSUE_TEMPLATE/lefthook-patch-reapply-followup.md` if the project wants to track the local-side mitigation tasks (the biome.json overrides, the `formatWithErrors: true` knob from REVIEW §ME-03). This is a value judgement — recommend INLINE to avoid template-file proliferation.

#### 4. ROADMAP edit precedent

Searched `git log --oneline --all | grep -iE "roadmap|wording"`. Hits: `bee1961` ("roadmap close 08.5"), `12559ed` ("insert phases 08.4 / 08.5"), `6def3a9` ("insert Phase 08.2"), `2c53ddb` ("wire sub-phase into ROADMAP/STATE"). Pattern: `docs(roadmap): <one-line summary>` OR `docs(<phase>): <…> + roadmap + state`. ROADMAP edits typically co-land with phase wave commits (NOT separate scope PRs). CONTEXT Q5 mandates: "ROADMAP edits done in same atomic commit as Phase 16 PLAN authoring". Mirror precedent: the ROADMAP §16 wording fix (771 → ~754; ESLint → lint) lands in the SAME commit as the first 16-01 wave commit (test or feat — author's choice; recommend the `test(16): red codemod …` commit since that's the earliest 16-01 wave that touches the planning artifact set).

### Files to create vs modify

| Action | File |
|---|---|
| Modify | `.planning/ROADMAP.md` — §16 success-criterion #1 ("exactly 771" → "approximately 754") + COMMENT-03 ("ESLint regression rule" → "lint regression rule (tsx CLI per Phase 15-01 pivot)") |
| Modify (sweep) | ~250-300 files under `apps/api/src/**` (comment-only deletes) |
| Modify (sweep) | ~80-100 files under `apps/api/tests/**` |
| Modify (sweep) | ~50-80 files under `apps/web/{src,tests}/**` |
| Modify (sweep) | ~20-30 files under `apps/worker/**` |
| Modify (sweep) | ~80-100 files under `packages/*/**` |
| Modify (sweep) | `tools/lint-phase-tag-comments.allowlist.txt` (ratchet-down: each sweep commit removes its area's now-handled entries) |
| Author (inline in PLAN.md) | ME-02 lefthook upstream issue body draft (see below) |
| Optional create | `.github/ISSUE_TEMPLATE/lefthook-patch-reapply-followup.md` (NOT recommended — keep inline) |

### Reusable conventions

- Commit-msg trailer: `refactor(16): sweep N phase-tag comments <area>` (matches Phase 15-03 `refactor(15-03): sweep spdx headers <area>` exactly).
- 0-diff coverage waiver wording: `0-diff coverage waiver: comment-only deletions, no behavior change.` (matches Phase 15-02/15-03 SUMMARY precedent).
- No `--no-verify` unless lefthook empirically fails AND root cause is documented as ME-02 deviation in commit body.
- Sweep area ordering smallest → largest (defect-canary discipline).
- ROADMAP wording edit co-lands with first 16-02 commit, not a separate PR.

### Risk callouts

- **Comment-only delete might NOT cleanly avoid the lefthook defect.** CONTEXT predicts it will, but the threshold ("100+ files with overlapping staged/unstaged biome rewrites") was characterised empirically. If a future biome version starts reformatting comment-adjacent whitespace, the assumption breaks. Mitigation: PLAN explicitly logs the post-commit state of each sweep (file count, hook outcome) so 16-SUMMARY.md can document the result and inform a future ratchet-down (drop `formatWithErrors: true` per REVIEW ME-03).
- **Allowlist drift between codemod and lint rule.** If `audit-phase-tag-comments.ts fix` removes a comment that `lint-phase-tag-comments.ts` would NOT have flagged (or vice versa), the post-sweep tree fails CI. Mitigation: factor the regex / classification predicate into ONE module (`tools/phase-tag-comments-classifier.ts`) imported by both CLIs — single source of truth for "what counts as a phase-tag comment". Add explicit cross-import test (`tools/phase-tag-comments-classifier.test.ts` asserts both CLIs use the same predicate exports).
- **Heuristic-only under-delivery.** CONTEXT Q2 accepts ~30-50% strip rate vs 70%+ if a human-in-loop pass were used. PLAN must explicitly state this expected-under-delivery in 16-SUMMARY.md so the verifier doesn't fail COMMENT-01 on "we only deleted 30% of the 754 candidates". The verifier checks the lint rule prevents future regression, NOT a target removal count.
- **ME-02 follow-up severity-vs-blocking.** REVIEW §ME-02 marked the issue MEDIUM (process discipline, not correctness). CONTEXT Q4 explicitly mandates "ME-02 followup filed in parallel — does NOT block phase". Mitigation: the `chore(16): file ME-02 lefthook upstream issue` commit can land on a side branch and merge AFTER the sweep commits; verifier checks only that the issue body is committed to the repo under `.planning/phases/16-…/` (or filed externally — operator's choice).

### ME-02 lefthook upstream issue body draft (≤ 10 lines)

```markdown
# `stage_fixed: true` re-add step skips files when ≥100 staged files have overlapping unstaged biome rewrites

**lefthook version:** 1.13.x (installed via `tools/install-hooks.cjs`)
**Repro shape:** stage 100+ files where biome's `--write` produces an in-place rewrite AND the user's working tree has an unrelated unstaged edit in the same file. After `pnpm exec biome check --write {staged_files}` runs and exits 0, `stage_fixed: true` adds back only a subset of the rewritten files; the remainder are committed pre-fix.

**Workaround (six-commit history in our repo, all annotated):** `git commit --no-verify` with the rewritten files manually `git add`-ed.

**Expected:** every rewritten file in `{staged_files}` is re-staged before the pre-commit phase returns.

**Cross-ref repo:** openwhispr-server/.planning/phases/15-…/15-REVIEW.md §ME-02 — affected commits: `d442deb`, `41f6628`, `57145b1`, `2e0eba0`, `7aeea9b`, `dcebdcd`.
```

---

## Shared / cross-cutting

### SPDX header style (applied to all new `.ts/.tsx/.yml/.sh` files in this phase)

```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
```

Hash variant for `.yml` and `.sh`:
```yaml
# SPDX-License-Identifier: FSL-1.1-ALv2
```
(Both enforced by `tools/spdx-header.ts` `audit` / `audit-hash` runs in CI.)

### Plan-ordering invariant (strict sequential)

`16-01 → 16-02`. The sweep depends on the codemod existing. Verifier asserts the codemod + lint rule + wiring (pnpm script, lefthook hook, CI step) are present and green before 16-02 sweep commits land.

### "No precedent" gaps to surface in PLAN.md

1. **Heuristic-based "remove this comment vs keep" classifier** — `lint-docs-headings.ts` is the closest in-repo precedent for a multi-rule deterministic classifier but does NOT use a REMOVE/KEEP bucket with default-fallback shape. 16-01 establishes this.
2. **Multi-language lint scope (TS + MD + YAML + SH) in a single CLI** — `spdx-header.ts` has the closest precedent (TS+JS via `glob` + hash variants for YML+SH), but no single CLI currently scans `.md`. 16-01 establishes this for `lint-phase-tag-comments.ts`.
3. **Shared classifier module imported by two CLIs** — current pattern is one-CLI-one-rule with no shared module. 16-01 introduces `tools/phase-tag-comments-classifier.ts` (or equivalent name).
4. **Comment-only-delete sweep landing without `--no-verify`** — Phase 15-03 sweeps all triggered the lefthook defect (6 of 7 used `--no-verify`). 16-02 will empirically establish whether comment-only deletes avoid the defect.

### Metadata

- **Pattern extraction date:** 2026-05-15
- **Files scanned (read-only):** 12 (CONTEXT.md, 15-PATTERNS.md, spdx-header.ts, lint-colocated-tests.ts, lint-colocated-tests.test.ts, lint-tdd.ts, lint-docs-headings.ts head, lefthook.yml, ci.yml excerpts, package.json scripts excerpt, fsl-history-scrub-cutover.md head, 15-REVIEW.md §ME-02)
- **Search scope:** `tools/`, `.github/{workflows,ISSUE_TEMPLATE}/`, root configs, `apps/api/src/{index,auth}.ts` (for comment-shape sampling), Phase 15 sweep commits via `git log`
- **Analogs found:** 11 / 12 file rows (92%); 1 has no in-repo precedent (`lint-phase-tag-comments.allowlist.txt` — file currently absent post-15-02; semantic precedent in `lint-colocated-tests.ts:46-86` reader code is sufficient)
<!-- REUSE-IgnoreEnd -->
