# Phase 16 — Context

**Phase:** 16 — Phase-Tag Comment Audit (v2)
**Date captured:** 2026-05-15
**Mode:** discuss (advisor-style research-backed; 4 parallel `gsd-advisor-researcher` agents)
**Locked requirements:** COMMENT-01, COMMENT-02, COMMENT-03, COMMENT-04 (4 reqs from REQUIREMENTS.md lines 489-492)

<domain>
**751 stale `// Phase XX / Plan YY / D-ZZ` comments in `apps/` + `packages/` are swept against CLAUDE.md "no comments unless WHY non-obvious" rule, and the codebase stops carrying historic provenance that no longer earns its keep — without burying readers in 751 atomic commits.**

The mechanical sweep targets header-style phase-tag comments (file-top `// Phase NN / Plan NN-MM —` banners + bare trailing `// D-NN` refs + history-narrative close-out comments). Inline `// D-NN — <real WHY explanation>` comments are conservatively KEPT (heuristic defaults to KEEP on ambiguity).

This phase delivers HOW. The WHAT is locked by ROADMAP.md success criteria.
</domain>

<scope_correction>

**CRITICAL — surface in PLAN so reviewers don't repeat the mistake:**

Initial orchestrator grep used pattern `(// |/\* |\* )(Phase|Plan|D-)[0-9]` and found only 59 hits across 40 files in `apps/` + `packages/`. This was a **regex bug**: the pattern required `Phase` to be IMMEDIATELY followed by a digit, but real comments use `Phase NN[.M]` with a space. The correct pattern is `(// |/\* |\* )(Phase|Plan|D-)\s*[0-9]`.

Corrected live measurements (2026-05-15, after Phase 15 close):

| Pattern | Comments | Files |
|---|---|---|
| Header-style `// Phase NN[.M] / Plan NN[-MM] …` (anchored, allows space) | **754** | **515** |
| Inline `// D-NN` (anywhere in line) | 363 | — |
| Inline `// .*Phase [0-9]+` (anywhere) | 941 | — |
| Inline `// .*Plan [0-9]+` (anywhere) | 981 | — |
| Union of all inline + header forms | 1,494 | 532 |

ROADMAP's "771 comments" figure is essentially correct — the live 754 / 515 delta is ~17 files explained by Phase 15 deletions during structural reorg (target-of-scrub `speaches-audio.md`, removed orbit). **Phase 15 did NOT silently sweep phase-tag comments.**

</scope_correction>

<canonical_refs>
**MANDATORY reads for downstream agents:**

- `.planning/ROADMAP.md` — Phase 16 entry + success criteria + scope correction note
- `.planning/REQUIREMENTS.md` lines 489-492 — COMMENT-01..04
- `.planning/PROJECT.md` — core value + constraints
- `.planning/STATE.md` — milestone state (Phase 15 closed 2026-05-15)
- `CLAUDE.md` — "no comments unless WHY non-obvious" rule (constitutional)
- `tools/spdx-header.ts` — closest ts-morph codemod analog (audit/fix CLI shape, exit codes 0/1/2)
- `tools/lint-colocated-tests.ts` — Phase 15-01 standalone-tsx-CLI rule analog (wired into pnpm + lefthook + CI)
- `tools/lint-colocated-tests.legacy-allowlist.txt` — exemption-file precedent
- `.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-03-SUMMARY.md` — per-area atomic-commit pattern + W-3 split (>150 files)
- `.planning/phases/15-repo-refactor-fsl-relicense-history-scrub-v2/15-REVIEW.md` — ME-02 lefthook follow-up issue context
- `biome.json` — current lint stack (Biome only, no ESLint)
</canonical_refs>

<code_context>

**Phase 16 sweep target shape (after Phase 15 close):**

- 754 header comments across 515 files in `apps/` + `packages/` (*.ts + *.tsx)
- `tools/` and root `tests/` are EXEMPT per ROADMAP scope correction (1 + 19 hits there; deliberate carve-out)
- Top-10 hot files: `apps/api/src/index.ts` (48), `apps/api/src/routes/index.ts` (47), `apps/api/src/auth.ts` (30), `apps/api/src/plugins/rate-limit.ts` (18), `packages/contract-tests/src/negative-matrix.ts` (15), `packages/contract-tests/src/schemas.ts` (13), `apps/api/tests/unit/__tests__/entrypoint-db-shape.test.ts` (13), `apps/worker/src/index.ts` (12), `packages/data/tests/unit/__tests__/rls-property.test.ts` (11), `apps/api/src/routes/v1/keys/create.ts` (11)

**Per-area distribution (estimated):**
- `apps/api/src/` — ~250-300 files (largest area)
- `apps/api/tests/` — ~80-100 files
- `apps/web/src/` — ~30-50 files
- `apps/web/tests/` — ~20-30 files
- `apps/worker/src/` + tests — ~20-30 files
- `packages/*/src/` + tests — ~80-100 files

Each area likely under 150 files → no W-3 trigger needed; per-area sweep aligns with Phase 15-03 precedent.

**Lefthook patch-reapply defect (ME-02 from Phase 15 review):**
Empirical trigger = `100+ files with overlapping staged/unstaged biome rewrites`. Phase 16 sweeps comment-only deletions — biome will not rewrite anything (no whitespace/format changes on comment removal), so `stage_fixed: true` has nothing to reapply. Predicted: lefthook will pass cleanly on Phase 16 commits without `--no-verify`. **Plan must verify this empirically on the first sweep commit; if defect triggers, escalate to ME-02 followup and document.**

**ESLint config state:** NONE exists. Lint stack is Biome 2.x + 10 standalone `tools/lint-*.ts` siblings established by Phase 15-01 pivot.

</code_context>

<decisions>

### Q1 — Scope: **Option B (live 754/515 header-anchored)**

- Sweep targets header-style phase-tag comments (~754 across 515 files in `apps/` + `packages/`)
- ROADMAP edit: rewrite §16 success-criterion #1 from "exactly 771" → "approximately 754 phase-tag header comments (originally cited as 771 pre-Phase-15; delta = file deletions during structural reorg)" — one-line correction, no semantic change
- `tools/` and root `tests/` EXEMPT (per ROADMAP carve-out)
- The 1,494-line union (Option C expansion to include inline `// D-NN — <prose>` annotations) is REJECTED for Phase 16 — high-value WHY anchors like `PITFALLS §` notes and multi-sentence `D-NN` explanations belong in KEEP bucket; mixing them with provenance balloons classify cost and exceeds the ≤50-file-per-commit budget. Defer inline rewrites to a follow-up cleanup phase if appetite remains after Phase 16 lands.

### Q2 — REMOVE/KEEP classifier: **Option 1 — Heuristic-only with conservative KEEP defaults**

- Single-pass deterministic ts-morph codemod, NOT human-in-the-loop two-pass
- Decision tree applied per phase-tag comment:
  - REMOVE bucket (mechanical, no false-positive risk):
    1. Single-line, ≤ 4 words, matches `^//\s*Phase\s+\d+[\.\d]*(\s*[\/\-]\s*Plan\s+\d+[-\d]*)?[:\s\-—]*$` (bare header, no prose)
    2. Trailing bare `// D-\d+` (or `// D-\d+\.\d+(-EX\d+)?`) with no body text after the ID
    3. History-narrative close-out: `// D-\d+\.\d+-EX\d+ close-out:` (refactor history; reader cannot act on it)
    4. Single-line `// Phase \d+ — implementation note` standalone at top of test fixture
  - KEEP bucket (conservative — anything ambiguous):
    1. Multi-line OR follows with prose explanation
    2. Contains "because"/"to avoid"/"workaround"/"fixes"/"NEVER"/"MUST"/"prevent"
    3. References `PITFALLS §`, `SUMMARY.md`, or any non-trivial domain term
    4. Inline `// D-NN — <real WHY explanation>` (e.g., `// D-19 — availableProviders is COMPUTED FRESH at every request from settings.json + CONFIG_DB — never cached client-side.`)
    5. FLAG/AMBIGUOUS heuristic match → default KEEP (never auto-REMOVE)
- Output: NO `Phase16-COMMENT-AUDIT.md` artifact, NO operator review pass
- Codemod runs deterministically; same input → same REMOVE set; reproducible across reruns
- Acceptable risk: smaller sweep than human-in-loop (likely ~30-50% of the 754 candidates strip vs 70%+ with human review); under-delivery vs phase intent is OK — ESLint rule prevents future regression, and a follow-up phase can deepen the sweep if appetite remains

### Q3 — Lint regression rule: **Option A — Standalone tsx CLI `tools/lint-phase-tag-comments.ts`**

- Mirrors Phase 15-01 pivot pattern (10 existing `tools/lint-*.ts` siblings)
- Wired into:
  - `pnpm lint:phase-tag-comments` script in root `package.json`
  - Lefthook pre-commit hook
  - `.github/workflows/ci.yml` lint job
- Rule shape: matches both header (`^//\s*(Phase|Plan|D-)`) AND trailing bare forms (`,\s*//\s*D-\d+\s*$`) in `*.ts/*.tsx/*.md/*.yml/*.sh` files
- Exemption file: `tools/lint-phase-tag-comments.allowlist.txt` for legitimate KEEPs (transitional allow-list during sweep, ratcheted-down post-sweep)
- Coverage ≥ 90/90/90/90 via Vitest sibling `tools/lint-phase-tag-comments.test.ts`
- **ROADMAP edit:** COMMENT-03 wording from "ESLint regression rule" → "lint regression rule (tsx CLI per Phase 15-01 pivot)"

### Q4 — Commit grouping: **Option 2' — Per-area grouped (revised from research rec)**

Note: original researcher rec was "ONE squashed sweep" based on the WRONG 59-file scope. With corrected 515-file scope, that would trigger the lefthook patch-reapply defect (~100+ file threshold). Revised:

- **Commit shape:**
  1. `test(16): red codemod for phase-tag comment sweep` — RED Vitest fixtures
  2. `feat(16): heuristic phase-tag comment classifier + sweep codemod` — GREEN codemod implementation + 90/90/90/90 coverage
  3. `test(16): red lint-phase-tag-comments rule` — RED Vitest fixtures
  4. `feat(16): green lint-phase-tag-comments tsx CLI + wire to pnpm/lefthook/CI` — GREEN rule + wiring
  5. **Per-area sweep commits** (atomic per area, all going through full lefthook pipeline; no `--no-verify`):
     - `refactor(16): sweep N phase-tag comments apps/api/src`
     - `refactor(16): sweep N phase-tag comments apps/api/tests`
     - `refactor(16): sweep N phase-tag comments apps/web` (src + tests if < 150)
     - `refactor(16): sweep N phase-tag comments apps/worker`
     - `refactor(16): sweep N phase-tag comments packages/`
  6. `docs(16): document lint-phase-tag-comments rule + allowlist semantics` — short conventions.md append
  7. `chore(16): file ME-02 lefthook upstream issue` — small commit; can be parallel/branch-pre-emption
- **0-diff coverage waiver** for sweep commits (comment-only deletions = no behavior change) — explicit waiver bullet in each sweep commit body, matching Phase 15-02/15-03 SUMMARY precedent
- **No `--no-verify`** — comment-only deletions don't trigger biome reformat, so lefthook's `stage_fixed: true` reapply step has nothing to do. Empirically verify on the FIRST sweep commit; if defect somehow fires, escalate as a separate ME-02 deviation and pause.
- **ME-02 lefthook upstream issue** filed in parallel with Phase 16 execution (15-minute task; does NOT block phase)

### Q5 (Claude's discretion — no user input requested)

- Per-area commit ordering: smallest area first (worker → packages → web → api/tests → api/src) — surfaces lefthook issues on small commits first; if a small sweep triggers the defect, larger sweeps get a heads-up
- Allowlist file name: `tools/lint-phase-tag-comments.allowlist.txt` (matches `tools/lint-colocated-tests.legacy-allowlist.txt` shape)
- Sweep commit body format: `Removes N phase-tag comments matching heuristic REMOVE bucket (bare header, trailing bare D-NN, close-out history). KEEPs untouched. 0-diff coverage waiver: comment-only deletions, no behavior change.`
- ROADMAP edits done in same atomic commit as Phase 16 PLAN authoring (not a separate scope-creep PR)
- Plan structure: TWO plans, not four — codemod is small enough that 16-01 (codemod + lint rule + tests) + 16-02 (per-area sweep + ME-02 followup) is the right granularity

</decisions>

<deferred>

Captured during discussion; NOT in Phase 16 scope:

1. **Inline `// D-NN — <prose>` rewrite pass** — strip ID prefix, keep body (e.g., `// D-03: ≥30-day TTL.` → `// ≥30-day TTL per session-cookie policy.`). Defer to a follow-up cleanup phase (Phase 19+) if appetite remains. ~363 inline D-NN hits + ~750 inline `Phase NN`/`Plan NN-MM` hits in body text.
2. **`PITFALLS §` cross-reference linter** — verify every `// PITFALLS §N` comment points to an actual section in a doc file. Orthogonal hygiene improvement.
3. **`// T-NN-NN` ticket-ref sweep** — 75 such hits across the repo. Many are stale post-Phase-15. Defer to followup.
4. **Lefthook upstream fix tracking** — filed as ME-02 followup issue in parallel; if upstream lands a fix during Phase 16, optionally drop `biome.json formatWithErrors: true` as a small companion commit.
5. **`Phase16-COMMENT-AUDIT.md` artifact authoring** — explicitly rejected for Q2 (heuristic-only chosen); if a future phase wants per-decision evidence, the two-pass pattern is available.
6. **Per-language linting** — current rule is JS/TS/MD/YAML/SH; expand to `.py`, `.sql` if those files accrue phase-tag comments in future.

</deferred>

<scope_guardrail>

**Phase 16 boundary is FIXED by ROADMAP.md:**
- IN scope: COMMENT-01..04 — exactly 4 requirements
- IN scope: ROADMAP one-line edit for §16 success-criterion #1 (correct 771 → ~754) + COMMENT-03 wording (ESLint → lint)
- OUT of scope: Phase 17 TLS/ACME, Phase 18 SSO SPEC, inline D-NN body rewrites, T-NN-NN ticket sweeps, PITFALLS xref linter

</scope_guardrail>

<next_steps>

1. `/gsd-plan-phase 16` — gsd-planner reads this CONTEXT.md + REQUIREMENTS.md + Phase 15 SUMMARY/REVIEW (for ME-02 context + Phase 15-01 lint-CLI precedent) + ROADMAP, produces 2 PLAN.md files (16-01 + 16-02), PATTERNS.md, PLAN-CHECK.md.
2. `/gsd-execute-phase 16` — orchestrates plan execution with strict sequential ordering (16-01 → 16-02; sweep depends on codemod existing). Wave 2's per-area sweep commits can be authored sequentially in one executor session.
3. `/gsd-verify-phase 16` — verifier checks COMMENT-01..04 met, codemod coverage ≥ 90/90/90/90, lint rule wired, lefthook ran on every sweep commit without `--no-verify`, ROADMAP edits in place.
4. `/gsd-code-review` — review codemod heuristics + lint rule shape + allowlist semantics + sweep commit hygiene.

</next_steps>
