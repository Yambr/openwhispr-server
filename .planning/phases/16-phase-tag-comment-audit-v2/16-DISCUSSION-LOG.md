# Phase 16 — Discussion Log

**Date:** 2026-05-15
**Mode:** discuss (advisor-style; 4 parallel `gsd-advisor-researcher` agents)
**User pacing:** yolo with one revision on Q2 (heuristic-only vs two-pass)

## Gray areas selected

User selected ALL four researched gray areas:
1. Live comment-count audit + scope (post-Phase-15 reality vs ROADMAP figure)
2. REMOVE/KEEP classifier UX
3. Lint regression rule shape (given Biome-only repo)
4. Commit grouping strategy

## Crucial mid-discussion correction

**Q0 finding:** initial orchestrator grep used pattern `(// |/\* |\* )(Phase|Plan|D-)[0-9]` — required `Phase` IMMEDIATELY followed by a digit. Real comments are `// Phase NN[.M] / Plan NN-MM —` with spaces. Initial grep found 59 hits / 40 files; corrected grep finds **754 hits / 515 files** in `apps/` + `packages/`. ROADMAP's 771 figure is essentially correct (~17-file delta = Phase 15 deletions). This finding INVALIDATED the original commit-strategy researcher's "ONE squashed sweep" recommendation (49 files was wrong scope).

## Questions asked and decisions made

### Q1. Scope after Phase 15

**Options presented (after research):**
- A. ROADMAP figure 771 verbatim
- B. Live 754/515 files header-anchored (research recommendation)
- C. Expanded 1494-line union including inline `D-NN`/`Phase NN`/`Plan NN-MM` body refs

**User selected:** B.

**Rationale recorded:** ROADMAP's 771 is approximately correct; one-line edit ("approximately 754") preserves intent. Option C mixes provenance with high-value WHY anchors (PITFALLS §, multi-sentence D-NN explanations) whose KEEP-with-rewrite costs exceed Phase 16's ≤50-file-per-commit budget. Defer inline rewrites to followup phase.

### Q2. REMOVE/KEEP classifier design

**Options presented (after research):**
- 1. Heuristic-only deterministic (false positive risk on borderline)
- 2. Human-in-the-loop two-pass + heuristic pre-fill emitting `Phase16-COMMENT-AUDIT.md` (research recommendation)
- 3. LLM-assisted classification (non-determinism, eval gap)
- 4. Default-REMOVE narrow whitelist (under-delivery)

**User selected:** 1 — heuristic-only with conservative KEEP defaults (deviating from research rec).

**Rationale recorded:** User chose Option 1 because Option 2's ~754-row review artifact is too long for a yolo cycle. Conservative KEEP defaults (ambiguity → KEEP, only obvious REMOVE-bucket patterns strip) bound the false-positive risk. Accepts smaller sweep coverage (~30-50% of 754 vs 70%+ with human review) in exchange for reproducibility + speed. ESLint rule + future cleanup phase compensate for under-delivery.

### Q3. Lint regression rule shape

**Options presented (after research):**
- A. Standalone tsx CLI mirroring Phase 15-01 pivot (research recommendation)
- B. Biome GritQL plugin (diagnostic-only, JS/CSS only, undocumented comment-trivia matching)
- C. Adopt minimal ESLint (reintroduces stack Phase 15-01 rejected)
- D. Lefthook regex + commitlint (cheapest; loses AST precision; not "lint rule" per criterion)

**User selected:** A.

**Rationale recorded:** Phase 15-01 already resolved the architectural question by establishing the standalone-tsx-CLI pattern; 10 siblings prove the shape. Biome custom rules (Option B) are JS/CSS-only and cannot scan `.md`/`.yaml`/`.sh` where phase-tag comments may also leak. Option C explicitly contradicts Phase 15-01 pivot. Option D loses AST precision. ROADMAP COMMENT-03 wording update from "ESLint" to "lint" reflects the Biome-pivot reality.

### Q4. Commit grouping strategy

**Options presented (after research):**
- 1. ONE squashed sweep (research rec — but based on wrong 59-file scope)
- 2'. Per-area grouped (revised given 515-file corrected scope) — matches Phase 15-03 precedent
- 3. Fix lefthook ME-02 first as Plan 0 (upstream wait blocks phase)

**User selected:** 2' (revised).

**Rationale recorded:** Original researcher recommended Option 1 based on wrong 59-file figure. With corrected 515-file scope, that exceeds lefthook patch-reapply defect threshold (~100+ files). Per-area grouping matches Phase 15-03 atomic-commit precedent — each area likely < 150 files (no W-3 trigger needed). Comment-only deletions don't trigger biome reformat, so `--no-verify` is predicted unnecessary. Verify empirically on first sweep commit; if defect fires, escalate as ME-02 deviation. File ME-02 upstream issue IN PARALLEL — does not block phase.

## Deferred ideas

1. Inline `// D-NN — <prose>` rewrite pass (~363 + ~750 candidates)
2. `PITFALLS §` xref linter
3. `// T-NN-NN` ticket-ref sweep (~75 hits)
4. Lefthook upstream fix tracking (ME-02; orthogonal hygiene)
5. `Phase16-COMMENT-AUDIT.md` artifact authoring (rejected for Q2)
6. Per-language linter expansion (`.py`, `.sql`)

## Research artifacts

All 4 advisors returned findings inline (didn't write `/tmp/` files due to a "do not write summary md" instruction). Their key findings are embedded in CONTEXT.md `<decisions>` section.

- Scope researcher: 754/515 corrected scope (regex bug in initial probe), Option B
- Classifier researcher: Option 2 recommended; user chose Option 1 with conservative KEEP defaults
- Lint rule researcher: Option A (standalone tsx CLI), update COMMENT-03 wording
- Commit strategy researcher: Option 1 (one squashed) — invalidated by Q0 correction; user chose revised Option 2' per-area

## Claude's discretion items (no user input requested)

- Per-area commit ordering: smallest area first (worker → packages → web → api/tests → api/src) — surfaces lefthook issues on small commits first
- Allowlist file: `tools/lint-phase-tag-comments.allowlist.txt`
- Sweep commit body format with 0-diff waiver bullet
- ROADMAP edits done in same atomic commit as Phase 16 PLAN authoring (not a separate scope-creep PR)
- TWO plans (16-01 codemod + lint rule; 16-02 per-area sweep + ME-02 followup) — not four

## Open question — Phase 17/18 scheduling

Phase 18 (LDAP/Keycloak SSO SPEC) is orthogonal and schedulable anytime ≥ Phase 13. Phase 17 (Trusted Local TLS + Production ACME) depends on Phase 15 host split — already complete. Phase 16 + 17 + 18 can proceed in declared work-order; no new gating.
