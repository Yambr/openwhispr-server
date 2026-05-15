---
phase: 16-phase-tag-comment-audit-v2
reviewed: 2026-05-15T11:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - tools/phase-tag-sweep.ts
  - tools/lint-phase-tag-comments.ts
  - .github/workflows/ci.yml
  - lefthook.yml
  - package.json
  - .planning/ROADMAP.md
  - .planning/REQUIREMENTS.md
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
verdict: APPROVE-WITH-FOLLOWUP
fix_status: all_fixed
fix_commits:
  - cr-01-red: ba5d3f3
  - cr-01-green: 2d730d2
  - wr-01-red: b42fa19
  - wr-01-green: 17d95c2
  - wr-02-docs: 31ad6a6
  - cov-fix: 34a9c69
---

# Phase 16: Code Review Report

**Reviewed:** 2026-05-15
**Depth:** deep
**Files Reviewed:** 7 source artefacts + 11 commits in range `b7eda76..HEAD`
**Status:** issues_found
**Verdict:** APPROVE-WITH-FOLLOWUP

## Summary

The 16-01 tooling (codemod + lint CLI + wiring triad) is well-implemented, mirrors the
`spdx-header.ts` + `lint-colocated-tests.ts` precedents faithfully, and shares a single
`classifyLine` predicate between sweep and lint (single source of truth — solid). Tests
exist for both tools and the wiring triad landed atomically in `4771e3d` exactly as
the plan specified. ROADMAP + REQUIREMENTS wording fix in `ecd81c8` matches every
CONTEXT/PLAN-CHECK delta verbatim.

The phase has ONE substantive concern (BLOCKER-tier): the executor extended the
REMOVE-bucket classifier mid-execution with a new regex (`REMOVE_RULE_1_HEADER_WITH_BODY`)
that was NOT in the PLAN's must_haves and that materially widened the strip set. Six of
the 23 actual strips would NOT have been stripped under the four PLAN-sanctioned REMOVE
regexes alone, and at least three of those carried non-trivial WHY content. This is the
opposite failure mode CONTEXT Q2 was designed to prevent ("default-KEEP on ambiguity")
and constitutes an undocumented classifier-policy change relative to PLAN.

The other defects are smaller: a real bug in the closeout-rule precedence ordering
(KEEP-keyword pre-empts REMOVE_RULE_3 in a way that may silently prevent legitimate
close-out narrative comments from being swept), a sweep-commit body that admits 21
pre-existing test failures on the base (TDD-gate non-compliance signal worth surfacing),
and a few minor lint-CLI consistency nits.

## Critical Issues

### CR-01: Unauthorized REMOVE-rule widening (`REMOVE_RULE_1_HEADER_WITH_BODY`) struck 3-6 comments carrying load-bearing WHY — FIXED in 16-fix (RED ba5d3f3, GREEN 2d730d2)

**File:** `tools/phase-tag-sweep.ts:85-92`
**Severity:** BLOCKER (scope/policy drift; comment-strip correctness)

**Issue:** PLAN 16-01 `must_haves.truths` enumerated exactly four REMOVE rules
(must_have lines 31-34): bare-header (rule 1), trailing bare `// D-NN` (rule 2),
close-out (rule 3), and bare `// Phase N — implementation note` (rule 4). The executor
added a fifth regex, `REMOVE_RULE_1_HEADER_WITH_BODY` (lines 85-92), which matches
`// Phase NN[.M] [/ Plan NN-MM] [— body]` — i.e. single-line headers WITH prose body —
gated only by the KEEP rules running first.

That gating is not enough. CONTEXT Q2's REMOVE rule 1 was DELIBERATELY restricted to
`^//\s*Phase\s+\d+...[:\s\-—]*$` (anchored, no body) precisely because anything after the
em-dash is prose the reader CAN'T derive from surrounding code. The executor's extension
turns single-line `// Phase NN — <prose>` into REMOVE-by-default whenever the prose
doesn't trip a KEEP keyword.

Empirical impact (from `6d9fb6c` diff):

- `// Phase 02.12 — hashToken removed; recordPreviousToken now takes plain text.` — explains the mock shape's contract. WHY content.
- `// Phase 02.12 — column is now \`previous_token\` (text), not \`previous_token_hash\`.` — explains the assertion target post-migration. WHY content.
- `// Phase 02.12 — bearer text is bound directly; no SHA-256 hashing.` — explains the test invariant. WHY content.
- `// Phase 02.12 — bytea token_hash dropped; sessions.token is plain text.` — explains the test fixture's INSERT shape.
- `// Phase 02.12 — function signature is now (text), not (bytea).` — explains what the privilege check is asserting.
- `// Phase 6 / Plan 02 — migration 0014 requires pg_partman.` (×3) — explains why the `openwhispr/postgres:17.5-pgpartman` image (not stock postgres) is required for the testcontainer. **This is non-obvious WHY content the reader cannot derive from the code.**

Under the PLAN-sanctioned four-rule classifier these lines would all match the KEEP-default branch (single-line, no keep keyword, no PITFALLS/SUMMARY marker, no multi-line neighbour). The added rule effectively inverts the conservative-KEEP default for headers-with-body — a meaningful classifier policy change vs. PLAN/CONTEXT.

**Constitutional cross-ref:** CLAUDE.md «не упрощать, не обходить» applies inversely
here — executor widened scope beyond plan instead of escalating as a deviation. The
`6d9fb6c` commit body acknowledges Option α (commit-shape deviation) but says nothing
about the classifier-policy deviation that produced the 23-strip count in the first place.

**Fix:**
```ts
// Option A — revert the rule to match PLAN must_have line 31 exactly.
// (Remove REMOVE_RULE_1_HEADER_WITH_BODY and its invocation in classifyLine.)

// Option B — keep the rule but require it pass through an explicit "no
// WHY content" gate: e.g. body length ≤ 30 chars AND body doesn't contain
// any identifier-looking token. File a deviation in 16-SUMMARY.md.

// Option C — keep current behaviour but back-port the policy widening
// into CONTEXT/PLAN as an amendment with a one-paragraph rationale; then
// re-run audit on apps/api/src + apps/api/tests to surface what else gets
// stripped under the wider rule (CONTEXT estimated 30-50% strip rate; the
// current ~3% suggests the rule is BOTH widened from plan AND still
// dramatically under-strips, indicating the heuristic is now both
// off-policy AND ineffective).
```

Recommended path: **Option A** (revert rule 5; restore the 5 `Phase 02.12` and 3
`pg_partman` strips). The plan-sanctioned 4-rule classifier with empirical ~1% strip
rate (rather than 3%) is an acceptable Phase 16 outcome — the lint rule still prevents
regression, and CONTEXT Q2 explicitly accepts under-delivery as "acceptable risk".

## Warnings

### WR-01: KEEP-keyword precedence may swallow legitimate close-out matches — FIXED in 16-fix (RED b42fa19, GREEN 17d95c2)

**File:** `tools/phase-tag-sweep.ts:139-160`
**Severity:** WARNING (latent classifier bug; no current empirical hit but high-risk path)

**Issue:** `classifyLine` runs KEEP rules first (keywords → markers → inline-D-dash-body
→ multi-line neighbour), THEN REMOVE rules. REMOVE rule 3 is the close-out narrative
form `// D-NN.M-EXn close-out: <description>`. If a close-out narrative ever contains a
KEEP-keyword (`removed`/`fixed`/`MUST`/`NEVER`/`workaround`), the KEEP branch wins and the
narrative is retained even though CONTEXT Q2 explicitly classifies it REMOVE ("reader cannot
act on it"). E.g.:

```ts
// D-12.3-EX1 close-out: removed legacy adapter workaround.
//                                              ^^^^^^^^^^ matches KEEP rule 2 → KEPT
```

Tests in `phase-tag-sweep.test.ts` Test R4 use a benign body (`removed legacy adapter`) which
DOES contain neither `workaround` nor any KEEP keyword — but `workaround` is a frequent
real-world close-out term. **Currently no false-keep was observed in the 12-file sweep**,
but this is a sharp edge for any future close-out comments.

**Fix:** Make REMOVE rule 3 (close-out) precede the KEEP-keyword check, since CONTEXT
Q2 specifies close-out as REMOVE regardless of body:

```ts
export function classifyLine(line: string, neighbours: Neighbours): "REMOVE" | "KEEP" {
  // Close-out narrative is REMOVE per CONTEXT Q2 regardless of body keywords.
  if (REMOVE_RULE_3_CLOSEOUT.test(line)) return "REMOVE";
  if (containsKeepKeyword(line)) return "KEEP";
  // ... rest unchanged
}
```

### WR-02: Sweep commit landed atop 21 pre-existing failing tests; TDD gate signal lost — FIXED in 16-fix (forward-clarification commit 31ad6a6)

**File:** `6d9fb6c` commit body
**Severity:** WARNING (constitutional discipline)

**Issue:** Commit body says: *"Pre-existing test failures (21 failed tests across 50 files
on the base of HEAD~1 BEFORE this sweep) are out of scope per SCOPE BOUNDARY rule — sweep
does not touch apps/web or any failing test file. Post-sweep failure count (20/47) is
lower."*

Per CLAUDE.md constitutional rules: **`pnpm test` must be GREEN before commit**. Phase 16
shipped commits onto an already-RED `main` and the executor self-validated by counting
failures (`21 → 20`, "lower, confirming the sweep does not introduce regression"). That is
NOT how the verification gate works — the gate is **green/red**, not **lower/higher**. If
`main` is RED, every Phase 16 sweep commit inherits and propagates that RED state, which
defeats the purpose of running lefthook on each commit.

**Fix:** File a follow-up issue: "Audit pre-existing 20-failing-test base on main; either
fix or quarantine before next phase ships." This is NOT a Phase 16 blocker (the failures
predate the phase per the commit body claim — needs independent verification), but the
verification-gate methodology used here («количество упало» rather than «всё зелёное»)
should not become precedent.

### WR-03: `lint-phase-tag-comments.ts` does not match CI-job-count must_have verbatim

**File:** `.github/workflows/ci.yml:40`
**Severity:** WARNING (low; spec match)

**Issue:** PLAN must_have line 48: *"CI's `lint-english` job count is unchanged (no new
job — line append only per PATTERNS critical-correction #6)."* The single-line append at
`ci.yml:40` is correct. However the `pnpm exec biome ci` check claimed in `6d9fb6c` body
and `pnpm test` cross-workspace verification are NOT re-run in CI for this PR's diff
because the wiring commit only added a step to `lint-english`, NOT to a unit-test job.
This is plan-compliant but worth surfacing — the sweep commit's "tests pass" claim is
self-attested, not CI-attested for this branch.

**Fix:** None required for Phase 16 close. Verify in 16-VERIFICATION that GitHub Actions CI
on `main` is green post-sweep.

## Info

### IN-01: `IGNORE` glob array duplicated between sweep + lint CLIs

**File:** `tools/phase-tag-sweep.ts:53-65`, `tools/lint-phase-tag-comments.ts:40-52`
**Issue:** The 12-entry IGNORE array and 4-entry PATTERNS array are byte-identical between
the two files. The single-source-of-truth discipline applied beautifully to `classifyLine`
was not extended to the glob configuration — silent drift risk if one file is edited.
**Fix:** Export `PATTERNS` and `IGNORE` from `phase-tag-sweep.ts` and import in the lint
CLI. Five-line cleanup; defer to followup.

### IN-02: `c8 ignore` comments hide reachable defensive branches

**File:** `tools/phase-tag-sweep.ts:169, 172, 176, 179, 198`
**Issue:** Several `/* c8 ignore */` markers are placed on branches that are actually
reachable (e.g. the `shouldSkip` early-return paths if a non-`.ts/.tsx` file slips through).
The 90/90/90/90 coverage gate was met by suppressing rather than testing these branches.
Not a correctness bug — just a coverage-discipline concern. **Fix:** Add fixture tests
exercising at least the `INCLUDE_ROOTS` rejection path (`tools/foo.ts` in tmpdir tree).

### IN-03: Allowlist reader uses sync `readFileSync` despite `readAllowlist` being typed `Promise<Set<string>>` in PLAN

**File:** `tools/lint-phase-tag-comments.ts:64-74`
**Issue:** PLAN must_have line 43 declares `readAllowlist(rootDir: string): Promise<Set<string>>`.
Implementation is `Set<string>` (synchronous). Functionally equivalent and arguably better,
but PLAN expected a Promise signature. **Fix:** None — current sync signature is correct.
Annotate the PLAN as adapted, or update PLAN. Cosmetic.

### IN-04: ME-02 inline issue body is filing-ready but unsigned/unscoped

**File:** `.planning/phases/16-phase-tag-comment-audit-v2/16-02-PLAN.md` deviation_handling
section, paragraphs added in `bafdab2`.
**Issue:** The 10-line draft is well-structured, gives a clean repro shape, includes the
empirical Phase 16 contrast (zero biome rewrite ↔ ME-02 quiet), and references concrete
commit SHAs from Phase 15-03. Suitable for upstream filing. Two small refinements:
1. Add lefthook minor version (currently `1.13.x`) and Node/pnpm versions for repro env.
2. The "cross-ref repo" link points to an internal `.planning/` path the upstream
   maintainer can't access. Either inline the relevant 15-REVIEW.md excerpt OR drop
   the cross-ref.
**Fix:** Operator-side edit at filing time; non-blocking for Phase 16 close.

## TDD Compliance Audit

- RED→GREEN→commit pattern observed in 16-01: `5b959d2` (RED codemod) → `6a87cc8` (GREEN
  codemod) → `0c0c0a2` (RED lint) → `30a7b30` (GREEN lint). **PASS** for 16-01.
- 16-02 sweep is comment-only deletion; explicit 0-diff coverage waiver in commit body
  matches Phase 15-02/15-03 precedent. **PASS** structurally, but see WR-02 re. RED-base
  signal.
- Atomic commit discipline: wiring triad `4771e3d` lands package.json + lefthook.yml + ci.yml
  in one commit per PLAN must_have line 47. **PASS**.

## Coverage Audit

Per PLAN success-criteria #1-2: ≥ 90/90/90/90 on both `tools/phase-tag-sweep.ts` and
`tools/lint-phase-tag-comments.ts`. Tests exist (249 + 125 lines respectively). I did not
re-run `pnpm vitest --coverage` (review is read-only); see IN-02 re. `c8 ignore` markers
that may inflate observed coverage.

## Constitutional Audit

- **No `--no-verify`**: Sweep commit body explicitly confirms pre-commit pipeline ran
  without `--no-verify`. **PASS**.
- **English-only**: All comments, commit messages, code identifiers in English. **PASS**.
- **Atomic commits**: Wiring triad atomic; sweep atomic; ROADMAP+REQUIREMENTS atomic. **PASS**.
- **No workarounds**: See CR-01 — REMOVE_RULE_1_HEADER_WITH_BODY widening is the inverse —
  scope expansion, not workaround. Still violates spirit of "plan as the contract".
- **FSL SPDX header**: Both new tools have `// SPDX-License-Identifier: FSL-1.1-ALv2`. **PASS**.

## Heuristic Strip-Rate Finding

CONTEXT predicted 30-50% strip rate (226-377 of 754 candidates). Empirical: 23 / 754 ≈ 3%.

Even under the (off-plan, widened) `REMOVE_RULE_1_HEADER_WITH_BODY` regex, strip rate
collapsed by 10× vs CONTEXT estimate. Two non-exclusive hypotheses:

1. **CONTEXT estimate was wrong, heuristic is correct.** Most real `// Phase NN ...`
   comments in this repo carry MUST/NEVER/PITFALLS/multi-line prose context that legitimately
   matches KEEP. The 754 baseline counted all header-shape comments but never measured what
   fraction were bare-header vs prose-bearing. Plausible — and supported by the deviation
   log in `bafdab2`.

2. **Heuristic is too conservative AND the widening rule was an attempt to compensate
   that the executor never escalated as a CONTEXT deviation.** The fact that the rule
   was added during execution (not planning) and bumped strip rate from a hypothetical
   ~1% to 3% suggests the executor was reaching for more strips but didn't escalate the
   shortfall as a deviation.

Both can be true. The right resolution: **revert REMOVE_RULE_1_HEADER_WITH_BODY (CR-01),
accept the ~1% strip rate, ship 16-02 as is, file a deferred follow-up (`Phase 19+
inline-comment rewrite pass` already exists in deferred items) for a deeper sweep.**
The lint rule prevents future regression — this is exactly the "acceptable under-delivery"
CONTEXT Q2 sanctioned.

## Follow-up Issue Stubs

1. **F-16.a — Revert `REMOVE_RULE_1_HEADER_WITH_BODY` (CR-01).** Restore 6 stripped
   comments via single revert commit on `packages/data/tests/**/migration-0006-backfill`,
   `pgbouncer-interleave`, `rls-property`, `settings-rls`, and `apps/api/tests/unit/lib/token-rotation`
   + `apps/api/tests/unit/__tests__/entrypoint-db-shape`. Re-author classifier per PLAN's
   4-rule contract.

2. **F-16.b — Close-out precedence fix (WR-01).** Move `REMOVE_RULE_3_CLOSEOUT` check
   above `containsKeepKeyword` in `classifyLine`. Add Vitest fixture
   `// D-1.0-EX1 close-out: removed workaround.` asserting REMOVE.

3. **F-16.c — Pre-existing test-base audit (WR-02).** Determine whether the 20 failing tests
   on `main` predate Phase 16 (per commit-body claim) or were introduced inside the
   `b7eda76..HEAD` range. If pre-Phase 16, file a separate stabilization issue.

4. **F-16.d — De-dup `PATTERNS` + `IGNORE` glob config (IN-01).** Re-export from
   `phase-tag-sweep.ts`, import in lint CLI.

5. **F-16.e — Operator chore: file ME-02 issue upstream** with environment/version
   metadata added per IN-04.

---

_Reviewed: 2026-05-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
