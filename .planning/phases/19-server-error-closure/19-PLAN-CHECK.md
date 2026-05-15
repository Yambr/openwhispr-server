# Phase 19 — Plan Check

**Reviewer:** gsd-plan-checker
**Date:** 2026-05-15
**Commit at review:** 3457a9a
**Plans reviewed:** 19-01, 19-02, 19-03

**Verdict:** PASS-WITH-NOTES

---

## Coverage Matrix (10 truths)

ROADMAP Phase 19 defines 5 Requirements (SR-19.1..SR-19.5) and 5 Success Criteria (SC1..SC5). Mapped forward to plan/task.

| # | Truth (Roadmap source) | Plan | Task(s) | Status |
|---|---|---|---|---|
| SR-19.1 | Migration SQL schema-aware refactor (Option (i) strip `public.` prefixes) | 19-03 | 19-03-01 | COVERED |
| SR-19.2 | Fastify `FastifyRequest` types `declare module 'fastify'` | 19-01 | 19-01-01 RED, 19-01-02 GREEN | COVERED (D-22 NEW pair) |
| SR-19.3 | BYOK guard refactor `process.exit(1)` → `throw BYOKGuardError` | 19-02 | 19-02-01 RED, 19-02-02 GREEN | COVERED (D-22 NEW pair, atomic w/ D-12 revert) |
| SR-19.4 | otel-bootstrap export `onSignal` keyword | 19-01 | 19-01-03 | COVERED (single GREEN; pre-existing RED transitions) |
| SR-19.5 | docs/operations.md pg_partman prerequisite | 19-01 | 19-01-04 | COVERED (docs-only) |
| SC1 | SERVER-ERRORS Entries 1-5 Owner: Phase 19 + linked atomic commits + Status: CLOSED block | 19-03 | 19-03-02 | COVERED |
| SC2 | `pnpm typecheck` exit 0 (closes Phase 14-04 deferral) | 19-01, 19-03 | 19-01-02 (root cause); 19-03-03 (aggregate gate) | COVERED (D-08, D-24) |
| SC3 | `pnpm test` aggregate exit 0 (8 residual closed) | 19-03 | 19-03-01 (post-test), 19-03-03 (precondition) | COVERED (D-24) |
| SC4 | Phase 18.1.2 test workarounds reverted where production fix supersedes | 19-01, 19-02, 19-03 | 19-01-03 (otel), 19-02-02 (entrypoint-db-shape mock), 19-03-01 (shared-pg W-2) | COVERED (D-12, D-14, D-20) |
| SC5 | Phase 14-04 typecheck deferred-items entry CLOSED | 19-01 | 19-01-02 step 5 | COVERED (D-08; explicit `deferred-items.md §14-04` transition) |

Coverage: **10/10 truths mapped to concrete tasks.** No orphans.

---

## Findings

### BLOCKER
*(none)*

### WARNING

**W-1 — `must_haves.truths` overstates SR-19.1 strip count (Plan 03).**
- Plan 19-03 must_haves repeats CONTEXT D-02's "11 grep hits" framing but the artifact path simultaneously documents the carve-out. Live grep confirms:
  - `0014_audit_log_partition.down.sql:27` = `DELETE FROM partman.part_config WHERE parent_table = 'public.audit_log'` (partman METADATA literal, NOT FK).
  - `0014_audit_log_partition.down.sql:46` = `REFERENCES "public"."tenants"` (true FK).
- True FK-strip count is **8** (6 in 0000 + 1 in 0014.sql:77 + 1 in 0014.down.sql:46), not 11.
- Mitigation already in plan: rollback §4 documents "if 0014_audit_log_partition.down.sql lines 27/46 turn out to be metadata literals, the strip count is 9 not 11. Document the discovered classification in commit body; this is NOT a HALT." Done/verify also tolerant ("11 (or fewer if 0014.down lines were metadata)"). However the truths block reads as if 11 is the target count.
- Fix at execute-time: 19-03-01 step B5 already mandates Read-and-classify; ensure commit body states "8 stripped, 3 left intact (D-04 metadata exempts including new finding on 0014.down.sql:27)."

**W-2 — Plan 02 pre-check branch is now moot but harmless.**
- Plan 02 must_haves says "Phase 18.1.2-04-02 may have ALREADY landed this refactor (verify by Read of byok-guard/src/index.ts:242 before starting)."
- Live grep confirms: `packages/byok-guard/src/index.ts:242` STILL says `process.exit(1)`. No prior refactor landed. Reduced-scope branch will NOT trigger.
- Not a defect (the pre-check is the right discipline); flagged so executor doesn't over-document a non-finding.

**W-3 — Plan 01 task 19-01-03 "verify if already exported" branch is now answered.**
- Plan 01-03 conditionally proceeds if `export const onSignal` is already present. Live grep: `apps/api/src/otel-bootstrap.ts:144` says `const onSignal` (no export). Full refactor (export + test revert) is mandatory. No defect; same harmless pre-check discipline.

### INFO

**I-1 — Drizzle-kit fallback for journal regen acknowledged but vague.**
Plan 03-01 step D7 says "if drizzle-kit refuses because schema source files haven't changed (only SQL edited), use `drizzle-kit generate --custom` shape OR manually recompute hash entries." This is one of the 4 architectural risks. The fallback is named, not specified. At execute-time if `drizzle-kit generate` is a no-op, the operator should be prepared to manually patch `_journal.json` (sha256 of SQL file content for the affected entries). Suggested explicit fallback recipe: `node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('packages/data/migrations/0000_initial.sql')).digest('hex'))"` and patch the corresponding entry in `_journal.json`. (Drizzle uses sha256 of file content per drizzle-kit/src/migrations.ts.)

**I-2 — Plan 03's SR-19.1 wave 3 single-GREEN bundle is large.**
Step A..G inside 19-03-01 is 17 sub-steps over 7 distinct files (3 migrations + 1 journal + 1 shared-pg + 2 cluster-#2 reverts, plus references to 15 more cluster files). This is a justified atomic-revert (D-20 mandate) — non-atomicity would be worse — but executor should brace for a long single-commit diff. Within D-18 ≤ 7 commits per plan; well-bounded.

**I-3 — D-23 coverage carve-out for `.d.ts` is correct and documented.**
fastify.d.ts is types-only; no Vitest instrumentation applies. Plan 01 explicitly documents this. No issue.

---

## Specific Validations

### TDD D-39 honor

| Surface | New code? | Plan pair | Verdict |
|---|---|---|---|
| `apps/api/src/types/fastify.d.ts` (SR-19.2) | NEW exported contract | 19-01-01 RED + 19-01-02 GREEN | CORRECT (D-22 NEW pair) |
| `class BYOKGuardError` + throw path (SR-19.3) | NEW exported class | 19-02-01 RED + 19-02-02 GREEN | CORRECT (D-22 NEW pair, atomic w/ D-12 revert per D-20) |
| `export onSignal` (SR-19.4) | NOT new code (export keyword on existing fn) | 19-01-03 single GREEN | CORRECT (pre-existing RED test transitions) |
| Migration `"public".` strip (SR-19.1) | NOT new exported API (DDL refactor) | 19-03-01 single GREEN | CORRECT (existing test-infra suite is the assertion surface) |
| Docs (SR-19.5) | docs-only | 19-01-04 single commit | CORRECT (no TDD per D-22 carve-out) |

D-39 doctrine **HONORED** per plan structure. 2-commit pairs for two NEW exported contracts; single-GREEN for three non-NEW transitions. No `--no-verify` declared; D-21 explicit.

### Sequential wave graph

`depends_on` frontmatter inspection:
- 19-01: `depends_on: []`, `wave: 1`
- 19-02: `depends_on: ["19-01"]`, `wave: 2`
- 19-03: `depends_on: ["19-02"]`, `wave: 3`

Graph: `19-01 → 19-02 → 19-03`. Acyclic, no forward refs. Matches D-15+D-17 strictly-sequential mandate (no parallel waves). 18.1.1 race-condition lesson honored.

### HALT recipes (4 architectural risks)

| Risk | HALT recipe location | 3-branch user choice? | Verdict |
|---|---|---|---|
| 1. Phase 18.1.2-04-02 BYOK lib refactor may have shipped | 19-02 rollback §1 + 19-02 must_haves truth | reduced-scope branch (not 3-branch — pre-check is non-destructive) | ACCEPTABLE (W-2 above: empirically didn't ship, branch unused but harmless) |
| 2. 0014.down.sql:27/46 classification ambiguity | 19-03-01 step B5 (Read-and-classify) + rollback §4 (count correction is not HALT) | NOT HALT — documentation correction | ACCEPTABLE (correctly framed; W-1 above flags overstated truth count) |
| 3. drizzle-kit refuses to regen journal | 19-03-01 step D7 (`--custom` shape OR manual recompute) | not 3-branch; fallback ladder | ACCEPTABLE; I-1 above suggests explicit sha256 recipe |
| 4. Production-DB hash mismatch on local boot | 19-03-01 step E9 (3-branch: regenerate / manual patch / defer to v3) | YES — explicit (a/b/c) | EXCELLENT |

All 4 risks have documented recovery paths. Risk 4 has the canonical 3-branch escalation pattern. Risks 1-3 are non-destructive (pre-check or fallback ladder) and don't warrant 3-branch.

Additional HALT recipe present:
- 19-03-01 step G16 (D-20 atomic-revert escape): if W-2 revert breaks routes suite, `git checkout -- .` whole commit + new doc commit `halt — W-2 revert blocked`. Honors D-20 "no 2-phase dance."
- 19-03-03 step 1 (D-24 precondition gate): if aggregate RED, do NOT commit milestone close. Honors D-26 + "milestone honesty" from user-memory `feedback_no_workarounds_enterprise.md`.

### SERVER-ERRORS Owner transition

D-25 protocol:
- Plan 19-03-02 dedicated to ledger close.
- Each Entry gets `## Status: CLOSED 2026-05-15` block with: Owner (Phase 19 + commit SHA), Closing plan (19-NN-PLAN.md), Linked atomic commit SHA, one-sentence closure note.
- Cross-reference table provided (Entry 1 → 19-03-01, Entry 2 → 19-01-02, Entry 3 → 19-01-04, Entry 4 → 19-02-02, Entry 5 → 19-01-03).
- Verify: `grep -c "Status: CLOSED 2026-05-15" .planning/phases/08-client-server-audit/SERVER-ERRORS.md` expected `5`.
- Format example supplied (Entry 1 markdown block in plan).

Owner transition mechanism **FULLY SPECIFIED**. No drift risk.

### W-2 revert atomic-commit pattern

D-20 mandate: SR-19.1 migration edits + W-2 shared-pg.ts revert MUST land in same commit. If revert breaks isolation, revert whole commit cleanly (no 2-phase dance).

- 19-03-01 lists ALL touched files in `files_modified` frontmatter together: 3 migrations + 1 journal + shared-pg.ts + 2 cluster-#2 test files (+ acknowledges 15 more cluster files via grep enumeration at step F13).
- Step F11 reconstructs pre-W-2 shape via git archaeology (`git show <pre-W-2-SHA>:apps/api/tests/support/shared-pg.ts`).
- Step G14 verifies routes test suite GREEN; step G15 verifies aggregate green; step G16 mandates `git checkout -- .` if step G fails.
- Single commit message: `refactor(19-03-01): green — strip "public." prefixes from migration FKs + regen journal + revert 18.1.2-03 W-2 to search_path (SR-19.1, D-01..D-06, D-20)`.

D-20 atomic-revert pattern **FULLY HONORED**. Bundle is large (I-2 above) but justified.

### Hard-rule production scope (CLAUDE.md Conventions #1)

CLAUDE.md root §Conventions Hard Rule #1: "never edit prod from test-debt phases." Phase 19 has **EXPLICIT user-approved scope** to edit production (per ROADMAP "production-fix phase" framing + CONTEXT canonical_refs "now THIS phase has explicit user scope to edit prod"):
- Production files touched: `apps/api/src/types/fastify.d.ts` (NEW), `apps/api/src/otel-bootstrap.ts`, `apps/api/src/index.ts`, `apps/worker/src/index.ts`, `packages/byok-guard/src/index.ts`, `packages/data/migrations/0000_initial.sql`, `packages/data/migrations/0014_audit_log_partition.sql`, `packages/data/migrations/0014_audit_log_partition.down.sql`, `packages/data/migrations/meta/_journal.json`.
- Every production edit traces to an SR (SR-19.1..SR-19.5) and a Decision (D-01..D-15).
- Test workaround reverts (otel test, entrypoint-db-shape, shared-pg W-2) are explicit per D-12, D-14, D-20.
- No incidental production drift; all edits are SR-anchored.

Hard Rule #1 **HONORED** within the explicit production-fix exception.

### D-18 ≤ 7 commits per plan

| Plan | Commit estimate | Within budget? |
|---|---|---|
| 19-01 | 4 (RED + GREEN .d.ts, single GREEN otel, docs) | YES |
| 19-02 | 2-3 (RED + GREEN BYOK; optional helper refactor) | YES |
| 19-03 | 3 (atomic SR-19.1+W-2, ledger close, ROADMAP/STATE close) | YES |
| **Total phase** | **~8-10** | **Matches D-18 estimate** |

---

## Recommendation

**PASS-WITH-NOTES.** Plans are execute-ready.

The three plans collectively map all 10 truths (5 SRs + 5 SCs) from ROADMAP Phase 19 to concrete tasks with TDD D-39 / D-22 doctrine honored, strictly sequential wave graph (D-15/D-17), atomic-revert discipline (D-20), aggregate green precondition gate (D-24/D-26), and ledger close protocol (D-25). All four flagged architectural risks have documented HALT/fallback recipes; Risk 4 (prod-DB hash mismatch) carries the canonical 3-branch escalation. Hard Rule #1 is honored within the explicit production-fix scope.

Two warnings (W-1 truth-count overstatement on SR-19.1; W-2 pre-check branches now answered empirically) are documentation polish — none block execution. One info item (I-1 drizzle-kit fallback specificity) is operator-helpful but not required.

Proceed to execute Plan 19-01.

---

*Generated by gsd-plan-checker at commit 3457a9a*
