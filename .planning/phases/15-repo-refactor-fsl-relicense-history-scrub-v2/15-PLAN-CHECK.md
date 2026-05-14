# Phase 15 — Plan Check (goal-backward verification)

**Date:** 2026-05-15
**Plans verified:** 15-01, 15-02, 15-03, 15-04
**Stance:** adversarial (FORCE — assume flawed until evidence proves otherwise)

---

## Verdict: **PASS-WITH-CONCERNS**

The four plans collectively cover every STRUCT-01..07 + FSL-01..07 requirement, honor all four locked CONTEXT decisions, exhibit TDD discipline on every code-bearing task, and respect the constitutional constraints. Two **WARNINGs** and one **borderline finding** prevent an unqualified PASS but none rise to BLOCKER. Orchestrator MAY proceed to `/gsd-execute-phase 15`; planner SHOULD address the warnings inline during execution rather than re-bouncing.

### Reasons
- 14/14 requirements covered (no gaps in `requirements:` frontmatter union)
- 5/5 ROADMAP success criteria deliverable from plan output
- 4/4 locked decisions traceable to specific plan tasks
- TDD RED→GREEN cadence present on every `tdd="true"` task; each scope reduction language scan returned clean
- One-force-push discipline preserved (15-04 Task 5 is the SOLE force-push event)
- Pattern-map corrections all honored
- Warnings: scope of 15-03 (6 tasks / ~700 file touches), coverage-on-diff exemption for 15-04 needs explicit waiver

---

## 1. Requirement Coverage Matrix

Source: ROADMAP.md Phase 15 + REQUIREMENTS.md lines 472-485.

| Req ID | 15-01 | 15-02 | 15-03 | 15-04 | Status |
|---|---|---|---|---|---|
| STRUCT-01 (test-layout + MOVE-INVENTORY) | ✓ | ✓ | — | — | covered |
| STRUCT-02 (compose/ directory) | — | ✓ | — | — | covered (15-02 Task 3) |
| STRUCT-03 (Helm monorepo + chart-releaser) | — | — | ✓ | — | covered (15-03 Task 6) |
| STRUCT-04 (Traefik host split) | — | ✓ | — | — | covered (15-02 Tasks 1-2) |
| STRUCT-05 (trustedOrigins + Playwright baseURL) | — | ✓ | — | — | covered (15-02 Task 2) |
| STRUCT-06 (apps/web/public/.gitkeep) | — | ✓ | — | — | covered (15-02 Task 5) |
| STRUCT-07 (route-group naming) | — | ✓ | — | — | covered (15-02 Task 5) |
| FSL-01 (LICENSE swap + MIGRATING + pre-scrub tag) | — | — | ✓ | — | covered (15-03 Tasks 1-2) |
| FSL-02 (SPDX sweep + REUSE.toml + CI gate) | — | — | ✓ | — | covered (15-03 Tasks 3, 5) |
| FSL-03 (package.json + Docker LABEL + README badge) | — | — | ✓ | — | covered (15-03 Task 4) |
| FSL-04 (DCO + retroactive consent) | — | — | ✓ | — | covered (15-03 Task 5) |
| FSL-05 (ADR-0013) | — | — | ✓ | — | covered (15-03 Task 2) |
| FSL-06 (git filter-repo scrub) | — | — | — | ✓ | covered (15-04 Tasks 2, 5) |
| FSL-07 (lock/unlock runbook + cache invalidation) | — | — | — | ✓ | covered (15-04 Tasks 2-3, 6) |

**Result:** 14/14 covered. No gaps. Note: STRUCT-01 is split — convention codification + inventory + codemod authoring in 15-01; codemod application in 15-02. This split honors the ROADMAP success-criterion language "MOVE-INVENTORY exists BEFORE any move PR".

---

## 2. Success Criteria × Plan Delivery

ROADMAP.md Phase 15 §Success Criteria (5 items).

| Criterion (paraphrased) | Delivered by | Status |
|---|---|---|
| 1. Test-layout codified + MOVE-INVENTORY + compose/ + route-group + .gitkeep | 15-01 (codify+inventory) + 15-02 (apply+route-group+compose-move+.gitkeep) | ✓ |
| 2. Traefik host split + trustedOrigins + Playwright baseURL + canonical mkcert host list | 15-02 (Tasks 1-2, 5); mkcert host list itself is consumed by Phase 17 — Phase 15 only LOCKS the canonical list via dynamic.dev.yml hosts | ✓ |
| 3. FSL surface migration (LICENSE, MIGRATING, 7-day notice, pre-scrub tag, reuse codemod, package.json, Docker LABEL, README badge, REUSE.toml + CI, DCO, ADR-0013, retroactive consent) | 15-03 (Tasks 1-6) | ✓ |
| 4. `git filter-repo --path speaches-audio.md --invert-paths` bundled as ONE force-push; lock→scrub→unlock→push→re-lock runbook; cache invalidation; signed-tag re-sign documented | 15-04 (Tasks 1-3 + Task 5 operator action) | ✓ |
| 5. Phase 13 Gherkin GREEN against new hosts + verifier ≥ 90/90/90/90 + e2e green | 15-02 Task 2 (Gherkin against new hosts) + 15-04 Task 6 (post-scrub verifier rerun) | ✓ |

**Result:** All 5 deliverable. Note on criterion 2: the explicit mkcert host list `(api.localhost, web.localhost, app.localhost, grafana.localhost, mailpit.localhost)` is referenced in ROADMAP success criterion text but Phase 17's responsibility — Phase 15 only needs to ensure the host-split lands compatibly. 15-02 establishes `web.localhost` + `api.localhost`; the other three hosts remain implicit. **WARNING-1:** consider adding a one-line note in `docs/conventions.md` or `compose/traefik/dynamic.dev.yml` header comment listing the full canonical 5-host list as a forward-pointer to Phase 17. Not a blocker (Phase 17 owns mkcert).

---

## 3. Locked Decisions (CONTEXT.md `<decisions>`)

| Decision | Required form | Plan evidence | Status |
|---|---|---|---|
| Q1: Option B (4 plans, strict sequential) | 15-01 → 15-02 → 15-03 → 15-04 chain | 15-01 `depends_on: []`; 15-02 `depends_on: [15-01]`; 15-03 `depends_on: [15-02]`; 15-04 `depends_on: [15-03]` | ✓ exact |
| Q2: Option 3 (Helm monorepo + chart-releaser-action; charts_dir: charts/; tag prefix chart-v*) | 15-03 must implement chart-releaser-action with those exact knobs | 15-03 Task 6: `charts_dir: charts/`, `on.push.tags: ['chart-v*']`, `helm/chart-releaser-action@v1.6.0` pinned by SHA, ArtifactHub metadata | ✓ exact |
| Q3: Combined 10-step scrub runbook | 15-04 implements all 10 steps from RESEARCH-history-scrub | 15-04 Task 2 enumerates 10 stages 1:1 with CONTEXT enumeration (pre-tag → advisory → lock → filter-repo → sanity → force-push → tags → cache flush → re-lock → post-advisory + placeholders fill) | ✓ exact |
| Q4: Option A test-layout (big-bang codemod, ts-morph) + Vitest 3.2 `projects` | 15-01 builds codemod, 15-02 applies + migrates to `projects` | 15-01 Tasks 1-2, 5 (codemod + inventory); 15-02 Task 4 (`--apply` + `projects` migration) | ✓ exact |

**Result:** 4/4 locked decisions honored verbatim. No contradictions or silent scope reductions.

---

## 4. TDD Discipline

Every code-bearing task carries explicit RED→GREEN labeling or pairs a test commit with the implementation commit:

- 15-01 Task 1: `test(15-01): RED migrate-tests codemod suite` → Task 2: `feat(15-01): migrate-tests ts-morph codemod` ✓
- 15-01 Task 3: explicit RED→GREEN commit-pair language ✓
- 15-02 Task 1: `test(15-02): RED traefik host-split gherkin` → Task 2: `feat(15-02): traefik host split` ✓
- 15-02 Task 4: codemod application — tests exist from 15-01; suite re-run is the GREEN signal ✓
- 15-03 Task 3: extends `tools/__tests__/spdx-header.test.ts` with RED FSL header test → GREEN flip ✓
- 15-04 Task 1: `test(15-04): RED history-scrub harness` → Task 2: `feat(15-04): history-scrub.sh runbook driver` ✓

**Non-TDD tasks** (legitimately content-only or operational, not subject to TDD):
- 15-01 Task 0 (read-only scouting), Task 4 (docs), Task 5 (artifact generation by already-tested codemod)
- 15-02 Task 3 (file moves — verified by `docker compose config -q`), Task 5 (route audit + gitkeep)
- 15-03 Tasks 1, 2, 4, 5, 6 (LICENSE/ADR/dependency-config/CI-workflow authoring — TDD-inapplicable; coverage on the spdx-header.ts EXTENSION is gated)
- 15-04 Tasks 3, 4 (docs/runbook + issue templates), Task 5 (checkpoint), Task 6 (placeholder fill)

**Result:** No task adds production code without a preceding test commit. PASS.

---

## 5. Coverage Gate (≥ 90/90/90/90 on diff)

| Plan | Coverage commitment | Status |
|---|---|---|
| 15-01 | "coverage ≥ 90/90/90/90 on the codemod surface" (must_haves truth #3) + "coverage ≥ 90/90/90/90 on diff (tools/migrate-tests.ts + lint rule)" (success-criterion 6) | explicit ✓ |
| 15-02 | Pure path-moves; vitest suite re-run as GREEN signal. Per CONTEXT Q4 "Coverage gate operates on diff — pure path moves should be 0-diff". Plan body does not echo this explicitly but does require `pnpm vitest run` GREEN. | **WARNING-2:** add an explicit "0-diff coverage waiver (path moves only)" must_have truth or success-criterion bullet for verifier clarity |
| 15-03 | "coverage ≥ 90/90/90/90 on the spdx-header.ts extension" (success-criterion 11; must_haves truth #15) | explicit ✓ |
| 15-04 | Test strategy notes "reachability-based (~200 LOC reachable via dry-run + precondition paths)"; success-criterion does not name the 90/90/90/90 floor | **BORDERLINE:** plan should declare either an explicit reachability-coverage floor for `tools/history-scrub.sh` OR an explicit constitutional waiver (operator-runbook executable, full-coverage not feasible due to live `gh api` writes). Recommend the latter, mirroring `tools/bootstrap.sh` precedent. |

**Result:** 15-01 and 15-03 PASS explicitly. 15-02 and 15-04 pass implicitly but the verifier surface would benefit from explicit waiver/0-diff bullets. Not blockers.

---

## 6. Pattern-Map Corrections

PATTERNS.md flagged seven specific corrections; the plan-checker prompt called out five. Trace:

| Correction | Plan task | Status |
|---|---|---|
| 15-03 EXTENDS `tools/spdx-header.ts` (not parallel tool) | 15-03 Task 3 action step: "Flip `HEADER` constant in `tools/spdx-header.ts`... extend `applyHeader`"; deviation handling: "use `reuse lint` only for verification, NOT writes" | ✓ explicit |
| 15-01 Task 0 discovers ESLint config location and pivots if absent | 15-01 Task 0 exists and prescribes the pivot to `tools/lint-colocated-tests.ts` standalone CLI; Task 3 branches on Task 0 outcome | ✓ explicit |
| 15-02 reuses env-driven `trustedOrigins` chain (apps/api/src/auth.ts:244-248) | 15-02 Task 2 action step 2: "NO code change required. Update `.env.example` and `.env.slim.example`: set `AUTH_TRUSTED_ORIGINS_EXTRA=…`"; deviation handling guards against accidental inline literals | ✓ explicit |
| 15-03 ESTABLISHES (not flips) package.json `license` field baseline | 15-03 Task 4 action step 1: "This is BASELINE establishment — field was absent." must_haves truth #8 echoes "(BASELINE — previously absent everywhere)" | ✓ explicit |
| 15-04 CREATES `docs/runbooks/` (no precedent) + authors `gh api` branch-protection pattern | 15-04 Task 3 (creates dir + README.md index); Task 2 action step 6.ii ("Branch protection lock via `gh api -X PUT /repos/$OWNER/$REPO/branches/main/protection`"); must_haves truth #5 ("`gh api -X PUT`... NOT PATCH"); deviation handling for ruleset-API fallback | ✓ explicit |

Additional PATTERNS.md corrections beyond the prompt list:
- `REUSE.toml` (no precedent) — 15-03 Task 3 creates it with `version = 1` + `[[annotations]]` ✓
- `charts/openwhispr/artifacthub-repo.yml` (no precedent) — 15-03 Task 6 creates it with required metadata ✓

**Result:** 5/5 prompt-named corrections + 2/2 additional PATTERNS.md gaps honored. PASS.

---

## 7. Atomic-Commit + Force-Push Discipline

| Concern | Plan evidence | Status |
|---|---|---|
| 15-04 produces ONE force-push event | Task 2 action step 6.v: "`git push --force-with-lease origin main` (ONE force-push; `--force-with-lease` to fail if drift detected mid-window)"; must_haves truths assert the bundling-with-FSL-as-one-event invariant | ✓ |
| Reviewable artifacts (scripts + runbook + advisory templates) live in 15-04 plan PR | Tasks 1-4 are reviewable (script, test, runbook, templates); Task 5 is a `checkpoint:human-action`; Task 6 is the post-execution ops commit | ✓ |
| Force-push execution is a follow-up ops commit | Task 6 commit message: `ops(15-04): execute Phase 15-04 history scrub — fill MIGRATING + dco cutoff` — separate from the plan PR | ✓ |
| Per-area atomic commits within 15-03 SPDX sweep | Task 3 enumerates "ONE commit per area (apps/, packages/, tools/, scripts/, compose/, .github/, tests/, root)" — must_haves truth #16 | ✓ |
| Conventional commit format | All plans use `feat(15-NN):`, `test(15-NN):`, `refactor(15-NN):`, `docs(15-NN):`, `chore(15-NN):`, `ops(15-NN):` — lowercase subjects, headers under 100 chars by inspection | ✓ |

**Result:** PASS. One force-push (15-04 Task 5); reviewable code lands as normal PRs; placeholder fills land as a separate ops commit.

---

## 8. Constitutional Checks

| Constraint | Evidence | Status |
|---|---|---|
| English-only | grep for Cyrillic across all 4 plans returned ZERO matches | ✓ |
| No mocks of internal logic | 15-04 mocks `git` and `gh` at PATH-override (process-boundary mocks — allowed); 15-01 uses ts-morph in-memory FS (in-process fixture, not "mock of internal logic") | ✓ |
| No `--legacy` flags or warning suppressions | grep for "legacy" returned 4 hits — all referencing "legacy paths" or "legacy branch protection API" as contextual descriptors, NOT flags or suppressions | ✓ |
| Atomic per-task conventional commits, ≤100 char header, lowercase subject | All 24 commit-message exemplars in the plans match the convention | ✓ |
| CLAUDE.md "no workarounds" | 15-04 Task 5 explicitly cites this rule to justify operator-checkpoint over stored-token automation; 15-01 deviation-handling cites it for ts-morph peer warnings | ✓ |
| Per-phase coverage floor ≥ 90% | See §5 above — 15-01, 15-03 explicit; 15-02 implicit (0-diff); 15-04 implicit (operator runbook) — WARNING-2 + BORDERLINE noted | ⚠ |
| E2E mandatory on user-visible routes | 15-02 Task 1 authors `@cjm-traefik-host-split` Gherkin scenarios; 15-04 Task 6 re-runs Phase 13 suite against new HEAD | ✓ |

**Result:** PASS on constitutional surface. The two coverage caveats (§5) are not constitutional violations — they are documentation-clarity gaps for the verifier.

---

## 9. Scope Reduction Scan (Dimension 7b)

Scanned all 4 plans for: `"v1"`, `"v2"`, `"simplified"`, `"static for now"`, `"hardcoded"`, `"future enhancement"`, `"placeholder"`, `"basic version"`, `"minimal"`, `"will be wired later"`, `"stub"`, `"not wired to"`, time-as-scope justification.

Findings:
- `"placeholder"` appears 6× in 15-03 + 15-04, ALL in the context of the `POST-SCRUB-HEAD-SHA` and `cutoff_sha` placeholders that 15-04 Task 6 EXPLICITLY fills with real values — this is sequencing, not scope reduction.
- No `"v1"/"v2"` scope-reduction language.
- No deferred-ideas leakage into plans (signed-tag re-sign + load-test layout migration both correctly referenced as deferred-items, NOT implemented).

**Result:** No scope reductions detected. PASS.

---

## 10. Cross-Plan Data Contracts

Single shared-data path: `Phase15-MOVE-INVENTORY.md` (produced by 15-01 Task 5, consumed by 15-02 Task 4). Both plans use the file in compatible read-once format (markdown table; consumed by `tsx tools/migrate-tests.ts --apply` which re-derives moves at runtime — inventory is documentation, not the wire format). Contract intact.

Second shared path: `MIGRATING.md` POST-SCRUB-HEAD-SHA placeholder (15-03 Task 2 writes placeholder, 15-04 Task 6 fills). 15-04 Task 6 verify clause asserts `! grep -q 'POST-SCRUB-HEAD-SHA: filled by 15-04' MIGRATING.md` — contract intact.

Third shared path: `.github/dco.yml` cutoff_sha placeholder (15-03 Task 5 writes, 15-04 Task 6 fills). 15-04 Task 6 verify asserts `grep -qE 'cutoff_sha: [0-9a-f]{40}' .github/dco.yml` — contract intact.

**Result:** PASS.

---

## 11. CLAUDE.md Compliance (project skills + conventions)

- ts-morph as root devDep introduces a new package — CLAUDE.md does not forbid; STACK.md (`packages/contract-tests` already uses TypeScript-AST tooling) supports the choice.
- Vitest 3.2+ `projects` migration aligns with CLAUDE.md "current versions only" posture.
- Better Auth env-driven trustedOrigins preserves the pattern established in Phases 12-14 (memory references confirm).
- `--force-with-lease` chosen over `--force` per "no workarounds" — defensive default.
- No `--no-verify`, no `--legacy-peer-deps`, no `--force` (npm), no suppressed warnings.

**Result:** PASS.

---

## 12. Scope Sanity

| Plan | Tasks | Files touched (planned) | Verdict |
|---|---|---|---|
| 15-01 | 6 (Tasks 0-5) | 7 files | borderline-high task count for a pre-flight plan, but Task 0 is read-only scouting and Task 5 is a one-line invocation; effective implementation = 4 tasks. Acceptable. |
| 15-02 | 5 | ~120 files (3 compose moves + ~100 test moves + 14 vitest configs + several config files) | high but justified — atomic codemod application is intrinsically single-plan per CONTEXT Q4 |
| 15-03 | 6 | ~700+ files (LICENSE/NOTICE/ADR + REUSE.toml + 675 SPDX rewrites + 12 package.json + 12 Dockerfiles + 4 workflows + Chart.yaml + artifacthub-repo + CONTRIBUTING + dco.yml + README) | **WARNING-3:** at 6 tasks and 700 file touches, this exceeds the 5-tasks-per-plan threshold from the rubric. Mitigated by: (a) Task 3 is a single codemod sweep that lands as 7 per-area commits (so the diff is reviewable in stripes); (b) Tasks 4-6 are mechanical metadata sweeps; (c) splitting would force a second tag/PR ordering problem with REUSE.toml that doesn't currently exist. Recommend EXECUTOR uses Task 3's per-area commit cadence aggressively and considers a Task 3a/3b split if the SPDX sweep proves unreviewable. |
| 15-04 | 6 (5 implementation + 1 checkpoint) | 8 files + the live force-push event | task count high but Task 5 is operator-only (no Claude context spend) and Task 6 is two placeholder fills. Acceptable. |

**Result:** WARNING-3 on 15-03 scope; otherwise within budget given the unique single-codemod-event nature of FSL relicense.

---

## 13. Gap List & Required Fixes

### WARNINGs (planner SHOULD address inline during execution; do NOT re-bounce)

**WARNING-1** — 15-02: add a one-line forward-pointer (in `docs/conventions.md` `## Route groups` section OR `compose/traefik/dynamic.dev.yml` header comment) listing the full canonical 5-host mkcert list (`api.localhost`, `web.localhost`, `app.localhost`, `grafana.localhost`, `mailpit.localhost`) as the surface Phase 17 will trust. Cost: 1 line. Benefit: closes a small gap in ROADMAP success-criterion #2 traceability.

**WARNING-2** — 15-02: add an explicit "0-diff coverage waiver for pure path moves" bullet to either `must_haves.truths` or `<success_criteria>`. Mirrors CONTEXT Q4 prose. Cost: 1 line. Benefit: verifier (gsd-verifier) has an explicit waiver clause to honor.

**WARNING-3** — 15-03: confirm the per-area atomic-commit cadence in Task 3 is sufficient to keep diffs reviewable for the ~675-file SPDX sweep. If the executor finds any single area >150 files, recommend splitting (e.g., `apps/api/` separate from `apps/web/` separate from `apps/worker/`). Add this conditional split rule to `<deviation_handling>` in Task 3.

### BORDERLINE (planner MAY address; not blocking)

**BORDERLINE-1** — 15-04: declare either a reachability-coverage floor for `tools/history-scrub.sh` OR an explicit constitutional waiver (operator-runbook executable with live `gh api` writes not feasible to fully cover in CI). Recommend the latter, mirroring `tools/bootstrap.sh` precedent. Add to `<success_criteria>` as a numbered bullet.

### BLOCKERs

**None.** No requirement is uncovered; no locked decision is contradicted; no deferred idea has leaked into scope; no constitutional rule is violated; no scope reduction language is present.

---

## 14. Verifier Recommendation

**Proceed to `/gsd-execute-phase 15`** with the three WARNINGs surfaced to the executor as inline polish items. The executor (gsd-executor) should:

1. While in 15-02 Task 5: add WARNING-1 forward-pointer + WARNING-2 0-diff bullet (≤5 minutes).
2. While in 15-03 Task 3: re-evaluate the per-area split granularity if any area exceeds 150 files (WARNING-3).
3. While in 15-04 Task 1 RED commit: add BORDERLINE-1 reachability/waiver bullet to `<success_criteria>` of 15-04 (≤2 minutes).

No re-bounce to gsd-planner is required.

---

## Metadata

- **Verified by:** gsd-plan-checker
- **Adversarial stance:** FORCE
- **Plans read:** 15-01-PLAN.md, 15-02-PLAN.md, 15-03-PLAN.md, 15-04-PLAN.md, 15-CONTEXT.md, 15-PATTERNS.md
- **References consulted:** ROADMAP.md (lines 56, 755-767), REQUIREMENTS.md (lines 472-485), CLAUDE.md
- **Coverage:** 14/14 requirements; 5/5 success criteria; 4/4 locked decisions; 5/5 prompt-named pattern corrections + 2/2 PATTERNS.md additional corrections
