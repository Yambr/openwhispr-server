---
artifact: PLAN-CHECK
quick_id: 260527-pj6
slug: pre-push-test-evidence-gate
date: 2026-05-27
iteration: 2
revision_under_check: 2
verdict: GREEN
checker: gsd-plan-checker
---

# PLAN-CHECK — Iteration 2/2

**Subject:** `.planning/quick/260527-pj6-pre-push-test-evidence-gate/PLAN.md` revision 2
**Verdict:** **GREEN** — execute.

## Summary

All 6 adjustments from iteration 1 are present, correctly scoped, and structurally locked into the wave plan. No iteration-1 regression detected on the previously-cleared dimensions.

---

## 1 — Adjustment audit (6/6 applied)

### 1.1 B1 BLOCKER fix — workspace reporter inheritance (PRIMARY FIX) — APPLIED

Evidence in PLAN rev-2:

- **Scope item 6** (lines 122-128) promotes Wave 1 mandatory edits to `vitest.config.ts` (root), `packages/contract-tests/vitest.config.ts:25` (`reporters: ["dot"]` → `["dot", resolve(ROOT_DIR, ...)]`), and `tests/e2e/vitest.config.ts:25` (`reporters: ["verbose"]` → `["verbose", resolve(ROOT_DIR, ...)]`). The `resolve(ROOT_DIR, "tools/vitest-evidence-reporter.ts")` pattern correctly anchors the path against the repo root, defeating the child-workspace relative-path re-anchor pitfall I flagged in iteration 1.
- **Scope item 7** (lines 130-139) introduces `tools/lint-vitest-reporter-inheritance.ts` walking ALL vitest configs via `fast-glob` + `ts-morph`, with three accepted shapes (absent / explicit-array-containing-reporter / refuse-spread-or-computed-or-string-form). Pre-commit wired in scope item 9 (lines 159-167) under `pre-commit.commands.vitest-reporter-inheritance` with explanatory `fail_text`.
- **Scope item 8** (lines 141-152) — 10 TDD F-cases (F1 all-present pass, F2 one-missing fail, F3 inheritance accepted, F4 root-missing fail, F5 string-form refused, F6 spread refused, F7 computed-variable refused, F8 relative path from root accepted, F9 absolute resolved path from child workspace accepted, F10 multiple inline `defineProject` partial-coverage fail-and-name). Coverage gate via `test:lint-vitest-reporter-inheritance` script (line 209) with `--coverage.thresholds.*=90`.
- **Files table** (lines 358-359, 367-368) — both new linter + test + the 2 workspace edits are explicitly enumerated with `(B1 BLOCKER fix)` annotations.
- **Wave plan** — W1.T2 (lines 407-411) edits all three workspace configs MANDATORY; W1.T3 (lines 412-414) lands the TDD pair. Both committed under Wave 1 alongside the reporter itself, so the structural gap is fixed at the same atomic-commit cadence as the reporter — no inter-wave stale-evidence window.
- **Risk register R12** (line 574) — new entry covering FUTURE workspace additions (different from R10's pre-existing-known-bad coverage). Two-layer defence (static lint + dynamic self-test) called out explicitly. R10 itself (line 572) is downgraded MEDIUM→LOW with `WAS MEDIUM → now LOW` annotation and rationale.

**Conclusion:** B1 fix is structural, not discovery-only — fixed at config-time + locked by pre-commit lint + verified at runtime by self-test. The previously-flagged hole (R10 originally relied on Wave 3 self-test to *discover* the gap rather than fix it) is closed.

### 1.2 W1 — `.planning/deferred-items.md` cross-reference + 4-column audit-backlog format — APPLIED

- **Scope item 18** (lines 311-329) — append ~10-line block to `.planning/deferred-items.md` documenting the SKIP-REASON audit backlog cross-reference. Body explicitly states `<file>:<line>` precise location enumeration + RESEARCH R4.4 taxonomy (requires-docker / topology-gated / setup-complete / deferred-fix) + WHY clause.
- **Scope item 13** (lines 225-230) — required 4-column audit-manifest format spelled out in PLAN body: `| file path | line number | current placeholder | suggested investigation steps |`. The "suggested investigation steps" column body is enumerated: `(a) git blame; (b) read PR description; (c) classify per taxonomy; (d) replace placeholder`.
- **Files table** (line 376) — `.planning/deferred-items.md` edit (~10 lines) annotated `(W1 fix)`. Audit-backlog file (line 377) annotated `~80 (54 rows in 4-column format + header)`.
- **Wave plan W4.T4** (line 450) explicitly lists this as a discrete task: "Append SKIP-AUDIT-BACKLOG cross-reference to `.planning/deferred-items.md` (scope item 18 / W1 fix)". Not relegated to a footnote.
- **§10 deferral** (line 586) — `7. **54 codemod-placeholder cleanups**` line ends with `**Cross-referenced in .planning/deferred-items.md (W4.T4 — W1 fix).**`
- **R3** (line 565) — risk register references "4-column format with investigation steps" + "`.planning/deferred-items.md` entry (W4.T4 — discrete task)".

### 1.3 W2 — `test:codemod-skip-annotations` script + coverage gate — APPLIED

- **Scope item 11** (line 210) — `"test:codemod-skip-annotations": "vitest run tools/codemod-skip-annotations.test.ts --coverage --coverage.include=tools/codemod-skip-annotations.ts --coverage.exclude= --coverage.all=false --coverage.thresholds.lines=90 --coverage.thresholds.branches=90 --coverage.thresholds.functions=90 --coverage.thresholds.statements=90"`. Verbatim 4-axis 90/90/90/90 threshold form matching RESEARCH R7.4 + parity with the other `test:lint-*` scripts.
- **Scope item 13** (line 231) — "Coverage ≥ 90/90/90/90 (constitutional floor; enforced by `test:codemod-skip-annotations` script in scope item 11)".
- **Wave plan W0.T3** (line 398) — "GREEN means `pnpm test:codemod-skip-annotations` passes with coverage ≥ 90/90/90/90 (W2 fix wires the explicit per-tool script)".
- **§6 coverage targets** (line 507) — codemod listed in the per-tool enumeration.
- **Verification checklist** (line 515) — `pnpm test:codemod-skip-annotations   # ≥ 90/90/90/90 (W2 fix: explicit per-tool script)`.
- **Appendix B constitutional alignment** (line 697) — coverage row explicitly cites "INCLUDING `test:codemod-skip-annotations` (W2 fix)".

### 1.4 W3 — scope-width note in §10 — APPLIED

- **§10** (line 589) — "**W3 — scope width acknowledgment:**" paragraph immediately after the 8 deferred items list. Rationale spans (a) co-location under `tools/`, (b) single-gate-landing not feature-creep, (c) tight coupling reporter↔validator↔linter↔workspace-edits forbids splitting without creating a stale-evidence inter-PR deadlock window. Identifies Wave 4 (docs+chart+deferred-items) as a natural split point if context budget tight, while clearly stating Wave 0→3 cannot be split. Honest envelope acknowledgment, not boilerplate.

### 1.5 W4 — F17 + F18 force-push semantics — APPLIED

- **Scope item 2** (line 76) — pre-push validator spec body now explicitly covers force-push reverse-range under R3.2/R3.3 edge handling, including "Force-push (reverse-range / `--force-with-lease`) where `localSha` does NOT contain `remoteSha` as ancestor: still enumerate via `git rev-list ${remoteSha}..${localSha}` (Git's standard behaviour returns the commits unique to `localSha`)" and "Force-push deletion semantics (`localSha === "0".repeat(40)`) handled by the deletion branch above".
- **F17 + F18** spelled out in scope item 15 unit tests (lines 278-279) and the test matrix table (lines 486-487):
  - F17: `git rev-list remoteSha..localSha` enumerates unique commits, evidence required for each; fixture creates divergent-history tmp repo with `git reset --hard` rewrite to simulate `--force-with-lease`. Missing → exit 1, clean → exit 0.
  - F18: `localSha === "0".repeat(40)` with non-zero `remoteSha` → identical deletion no-op behaviour as F12.
- **Wave plan W2.T1** (line 423) lists the test count as 18 F-cases "incl. F17 force-push reverse-range + F18 force-push deletion". Fixture authoring (line 426) explicit.
- **Files table** (line 355) — test file row updated to 18 F-cases. LOC bumped to ~580 reflecting the F17 fixture cost.
- **Verification checklist** (line 528) — `pnpm exec vitest run tools/lint-pre-push-test-evidence.test.ts --coverage  # ≥ 90/90/90/90 (incl. F17/F18 force-push)`.

### 1.6 W5 — `tools/test-evidence-projects-self-test.ts` scripted self-test + Wave 4 gate — APPLIED

- **Scope item 14** (lines 233-247) — NEW scripted self-test artefact. Replaces previously-prose Wave 3 self-test. Logic: spawn `pnpm test:all` via `spawnSync('pnpm', ['test:all'], { shell: false })`, glob `${EVIDENCE_DIR}/${HEAD_SHA}-*.json`, extract project-name suffixes, compute `delta = Set(manifest) − Set(found)`, exit 1 with structured stderr listing missing project + expected workspace `vitest.config.ts` path + diagnostic referencing `pnpm lint:vitest-reporter-inheritance`. Two failure modes (`pnpm test:all` non-zero with no delta vs delta non-empty) handled distinctly. Exit 0 prints `✅ 22/22 projects emitted evidence for ${HEAD_SHA}`.
- **Wave 4 commit-gate** explicit: "**Mandatory pre-commit step for Wave 4** (executor MUST run `pnpm test:evidence:projects-self-test` and confirm exit 0 BEFORE `git commit`). NOT wired into pre-push lefthook (would deadlock the gate it's validating)."
- **Script entry** (line 203) — `"test:evidence:projects-self-test": "tsx tools/test-evidence-projects-self-test.ts"`.
- **Files table** (line 360) — `tools/test-evidence-projects-self-test.ts | NEW (W5 mitigation) | ~120 (scripted self-test) | 3` — committed under Wave 3 explicitly.
- **Wave plan W3.T3** (line 433) lists it as a discrete task. W3.T4 (lines 434-443) consumes it as the BLOCKING self-test step. W4.T5 (lines 451-454) re-runs it as the final pre-commit gate.
- **Verification checklist** Wave 3 (lines 530-532) + Wave 4 (line 541) both invoke the script. Script's stderr-diagnostic mode replaces the previous "executor inspects fragments manually" prose.

---

## 2 — Iteration-1 regression spot-check (all clean)

| Iteration-1 check | Status in rev-2 |
|---|---|
| lefthook **command-level** `use_stdin: true` (NOT hook-level) | PASS — scope item 9 (line 181) places under `pre-push.commands.test-evidence`. Comment block (lines 173-179) cites lefthook docs `configuration/use_stdin/` + single-consumer hard-limit. R4 risk row + scope item 10 regression test assert exactly one `use_stdin: true` consumer under `pre-push.commands`. |
| `.skip` + `.todo` coverage in lint | PASS — scope item 5 callee-text regex `/^(it\|test\|describe\|xit\|xdescribe)\.(skip\|todo)$/` (line 107). F6 (annotated .todo no-violation) + F7 (unannotated .todo violation, parity with `.skip`) at lines 287. |
| Symlink + `realpathSync` defence | PASS — scope item 1 (line 60) atomic-write pipeline `mkdirSync({mode:0o700})` → `realpathSync` → `lstatSync` REFUSE-if-symlink → `writeFileSync({flag:'wx', mode:0o600})` → `renameSync`. Scope item 2 (lines 79, 81, 86) mirrors the same canonicalisation on the validator side. F7 reporter test + F8 validator test + F16 path-traversal test + R7 risk row. |
| Tag / multi-ref / deletion semantics | PASS — scope item 2 (lines 73-76) covers DELETION (`localRef === "(delete)" \|\| localSha === "0".repeat(40)`), NEW REF (`remoteSha === "0".repeat(40)` → `git rev-list ${localSha} --not --remotes`), normal range (`git rev-list ${remoteSha}..${localSha}`). F11 multi-ref + F12 deletion + F13 tag-of-already-validated-commit + F14 new-branch + F18 force-push deletion. R9 risk row. |
| LOCKER-05 truncation | PASS — scope item 1 fragment shape (line 56) embeds `error_message_truncated` field with `<≤1000 chars per LOCKER-05>` constraint. Appendix B (line 704) re-confirms. |
| `.gitignore` `.test-evidence/` entry | PASS — scope item 12 (lines 215-219) appends under new "# Test evidence" header block. Files table line 370. Wave 0 W0.T4. |
| CI bypass with stderr logging | PASS — scope item 2 (line 71) "**CI bypass FIRST**: if `process.env.GITHUB_ACTIONS === "true"` OR `process.env.CI === "true"` → log `[ci] skipping evidence gate (CI runs validator directly)` to stderr + exit 0. **Stderr log emitted regardless to surface the bypass** (RESEARCH R6 anti-abuse)." F9 + F10 tests. R8 risk row. |
| TDD ordering (RED → GREEN → REFACTOR, same-commit pairing) | PASS — Wave 0/1/2 each open with "TDD pair `tools/<tool>.{ts,test.ts}`" cadence. §4 preamble (line 384) reiterates "Each task's `.test.ts` is committed in the SAME atomic commit as the implementation (constitutional rule)." Appendix B row 1 confirms. |

No regression on any iteration-1 dimension.

---

## 3 — Dimension scoreboard

| Dimension | Status |
|---|---|
| 1 Requirement coverage | PASS — every `findings_closed: discipline-test-gate` requirement decomposed into Wave 0-4 tasks; phase goal (line 32) traced to scope items 1+2+5+9 (reporter+validator+lint+hook). |
| 2 Task completeness | PASS — every Wave task has Files (§3 table) + Action (scope item body) + Verify (§7 checklist) + Done (≥90/90/90/90 coverage gate). |
| 3 Dependency correctness | PASS — Wave 0 (manifest+lint+codemod+gitignore+scripts) → Wave 1 (reporter+workspace edits+codemod execution) → Wave 2 (validator) → Wave 3 (lefthook wiring+scripted self-test) → Wave 4 (docs+chart+deferred-items+self-push-test). No forward references; no cycles. |
| 4 Key links planned | PASS — reporter→fragment, fragment→validator, validator→lefthook, lefthook→`use_stdin: true`, lint→pre-commit, self-test→Wave 4 commit gate — every artefact paired with the consumer-side task. |
| 5 Scope sanity | YELLOW-ACKNOWLEDGED-AS-GREEN — 13 new TS/JSON+2 new MD+9 edits+54 codemod insertions explicitly acknowledged in §10 "W3 — scope width acknowledgment" (line 589) with operator pre-approval + coupling rationale. Wave 4 identified as natural split point if budget tight. |
| 6 must_haves derivation | PASS — `release_artifacts.chart_version 1.0.14→1.0.15` + `appVersion 1.0.11→1.0.12` in frontmatter; truths are user-observable (push refused / push allowed). |
| 7 CONTEXT compliance | PASS — D1/D2/D3/D4 frontmatter `locked_decisions` honoured throughout; no deferred ideas pulled in (CI L3, e2e fragments, cross-machine evidence, web-test deprecation all in §10 deferrals). |
| 7b Scope-reduction detection | PASS — no `v1`/`v2`/`static for now`/`placeholder for future` language used to dodge locked decisions. The "placeholder" string in the codemod is a deliberate audit-trail mechanism (R3 + W1 cross-reference), NOT a reduction of D3. |
| 7c Architectural tier compliance | N/A — no architectural-responsibility-map in RESEARCH.md for this quick. |
| 8 Nyquist | PASS — every implementation task carries `<verify>` automated (`pnpm test:lint-*` / `pnpm test:vitest-evidence-reporter` / `pnpm test:evidence:projects-self-test`); no watch-mode, no `--watchAll`; sampling continuity 100% (every Wave step has automated verify). |
| 9 Cross-plan data contracts | PASS — single PLAN.md; reporter→fragment→validator data shape locked in scope item 1 (lines 44-58) and re-asserted in scope item 2 step 4. |
| 10 CLAUDE.md compliance | PASS — hard-rule 4 extension (scope item 17) extends `--no-verify` ban to the new gate symmetrically with gitleaks. LOCKER-01..06 alignment (Appendix B) explicitly covered (LOCKER-05 truncation, LOCKER-06 argv-array `spawnSync('git', [...], {shell:false})`). |
| 11 Research resolution | PASS — RESEARCH.md `## Open Questions (RESOLVED)` per iteration-1 close. |
| 12 Pattern compliance | PASS — analogue patterns named throughout (`chart-api-env-parity.test.ts` for manifest parity, `lockers-allowlist-diff.test.ts` for stdin-config regression, `tools/global-vitest-teardown.ts` for SIGINT posture). |

---

## 4 — Findings

**None — no BLOCKERs, no WARNINGs.**

All 6 adjustments are present, structurally locked, and verifiable via the §7 checklist. The iteration-1 surface remains clean. The plan is internally consistent, dependency-acyclic, and aligned with constitutional discipline (TDD, ≥90/90/90/90 coverage floor, no mocks of internal logic, no `--no-verify`, English-only artefacts, LOCKER alignment).

---

## 5 — Verdict

**GREEN** — execute Wave 0 → Wave 4 in order per §4. No further plan revision required.
