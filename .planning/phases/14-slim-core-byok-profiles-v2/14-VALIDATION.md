---
phase: 14-slim-core-byok-profiles-v2
artifact: VALIDATION
generated: 2026-05-14
---

# Phase 14 — Source-Item Coverage Audit + Goal-Backward Verification

## A. Requirement → Plan Map (every REQ must be covered)

| Requirement | Plan(s) | Verifying tests |
|---|---|---|
| **SLIM-01** Slim default = 6 services; bare `docker compose up` selects them | 14-01 | `tests/integration/slim-core-base.test.ts` (10 assertions); plan 14-07 `@cjm-byok-storage` scenario 3 (boot with default + storage overlay) |
| **SLIM-02** Opt-in compose overlays | 14-03 | `tests/integration/compose-overlays.test.ts`; plan 14-07 cjm scenarios across all 3 features (each scenario exercises 1+ overlays) |
| **SLIM-03** `.env.slim.example` ~5 keys | 14-02 | `tests/integration/env-slim-example.test.ts` (9 assertions); plan 14-07 cjm scenarios consume `.env.slim.example` defaults |
| **SLIM-04** BYOK env contracts in `docs/operations.md` | 14-02 | `tests/integration/docs-operations-byok-matrix.test.ts` (6 assertions) |
| **BYOK-01** Helm `*.enabled` 1:1 with overlays | 14-06 | `charts/openwhispr/tests/{observability,storage,tls,pooler,mailpit,ingress}_test.yaml` helm-unittest cases; `tools/lint-compose-chart-parity.test.ts` |
| **BYOK-02** Loud-fail BYOK | 14-04 | `apps/api/src/lib/byok-guard.test.ts` (15 cases); `apps/api/src/__tests__/boot-order.test.ts`; cjm `@cjm-byok-storage` + `@cjm-byok-observability` + `@cjm-loud-fail-misconfig` |
| **BYOK-03** Worker noopX audit | 14-05 | `tests/integration/virtual-key-rotation-removed.test.ts` (8 assertions); rewritten `tests/e2e/log-scrub-sentinel.test.ts` |

**Audit result:** all 7 requirements covered by at least one plan + at least one automated test. Zero gaps.

## B. Phase Success Criterion → Plan Map (goal-backward verification)

CONTEXT.md / ROADMAP success criteria (verbatim):

| # | Success Criterion | Owning Plan(s) | must_haves.truths coverage |
|---|---|---|---|
| 1 | `docker compose up` (no flags) brings up exactly 6 services + migrate; `profiles:` inversion (TD-14.f / deferred #3a) closed | **14-01** | "Bare docker compose up brings up exactly 6 long-running services + migrate" + "No base service declares profiles:" |
| 2 | Opt-in overlays under `compose/` (5 named + new 6th contract-test); mailpit ONLY in dev-tools; each overlay has a 1:1 Helm `*.enabled` toggle | **14-03** (compose side) + **14-06** (Helm side) | 14-03 truth: "Six new overlay files exist… `dev-tools.yml` declares ONLY mailpit"; 14-06 truth: "5 top-level toggles matching 1:1" |
| 3 | BYOK envs documented in operations.md; api refuses to start when overlay OFF + env unset | **14-02** (docs) + **14-04** (refusal) | 14-02 truth: "BYOK Environment Matrix" section; 14-04 truth: "assertBYOKConfig() before installGlobalSSRF + OTel" |
| 4 | All three `noopX` adapters at `apps/worker/src/index.ts:68-92` resolved (noopSender already in Phase 13; noopLitellmKeyClient + noopUserKeyLookup either real or loud-fail) | **14-05** | "vkr files deleted; no internal mocks remain" |
| 5 | Phase 13 Gherkin `@cjm-byok-storage`, `@cjm-byok-observability`, `@cjm-loud-fail-misconfig` GREEN; verifier PASSED with ≥ 90/90/90/90 coverage + live e2e green | **14-07** (authoring + green) | "3 feature files exist; all scenarios GREEN; full cjm suite GREEN" |

**Audit result:** each of the 5 success criteria has a clear owning plan and at least one must_haves.truths line claiming it. Goal-backward gate passes.

## C. RESEARCH-driven critical findings → Plan Map (sanity check that the 12 prompt findings are addressed)

| # | Finding (from prompt) | Owning plan |
|---|---|---|
| 1 | 3 Gherkin scenarios MUST BE AUTHORED in Phase 14 (not just flipped) | **14-07** (explicit) |
| 2 | Profiles inversion — delete `profiles:` from every base service | **14-01** (Task 2 step 2) |
| 3 | `pooler.enabled` already exists in Helm — FLIP default to false | **14-06** (Task 2 step 1 / RESEARCH §B.2 finding) |
| 4 | observability serviceMonitor + collector toggles already exist — add umbrella, NOT a 3rd toggle | **14-06** (AND-gate pattern per RESEARCH §C.1) |
| 5 | `storage.enabled` genuinely new — wire as `condition: storage.enabled` on Bitnami minio sub-chart | **14-06** (Chart.yaml edit) |
| 6 | `mailpit.enabled` informational-only Helm toggle (no template) | **14-06** (Task 2 step 6) |
| 7 | `tools/bootstrap.sh:39` env-overridable | **14-02** (Task 1) |
| 8 | `.env.slim.example` includes ~6 bootstrap-invisible keys in addition to the 5 user-visible | **14-02** (Task 2 behavior list — POSTGRES_OWNER_PASSWORD + VALKEY_PASSWORD + MASTER_KEK + BACKUP_AGE_IDENTITY + OTEL_EXPORTER_OTLP_ENDPOINT sentinel) |
| 9 | Virtual-key-rotation removal: 8 files, 2 deletes; log-scrub-sentinel rewrite; BullMQ key-prefix cleanup | **14-05** (all 3 tasks) |
| 10 | cjm `compose-harness.ts:60-63` add overlays to `COMPOSE_FILES`; `bootStack()` accepts env-overrides | **14-03** (COMPOSE_FILES extend) + **14-07** (envOverrides) |
| 11 | `otel-bootstrap.ts` in BOTH apps/api and apps/worker — both need `=disabled` sentinel | **14-04** (Task 2 covers both) |
| 12 | Phase 06 testcontainers do NOT need compose changes | (no action — RESEARCH §B.3 verified; documented in PATTERNS.md §8 pitfall table) |

**Audit result:** all 12 critical findings have an owning plan or are explicitly N/A.

## D. CONTEXT decisions → Plan Map (D-XX traceability)

CONTEXT.md decisions are numbered #1-#7 (not D-XX). Mapping:

| CONTEXT decision | Plan(s) |
|---|---|
| #1 Slim-core service routing (19→6+overlays + 6th contract-test overlay) | 14-01 (slim base) + 14-03 (overlays) |
| #2 Loud-fail UX (Pino fatal shape, exit 1, before SSRF+OTel, BYOK matrix codes) | 14-04 (all 3 tasks) |
| #3 Worker noopX — DELETE virtual-key-rotation | 14-05 |
| #4 `.env.slim.example` 5 input keys, commented overlay appendix, `.env.example` → `.env.full.example` | 14-02 |
| #5 OTel `=disabled` sentinel | 14-04 (Task 2 specifically) |
| #6 Helm 5 toggles 1:1 | 14-06 |
| #7 Phase 14 first (14→15 order) | (no plan touches — order is set by ROADMAP; no code action needed) |

**Audit result:** all 7 CONTEXT decisions have an owning plan.

## E. Cross-plan file-overlap check (parallel-safety)

| Plan | Files touched | Wave | Conflicts with same-wave plan? |
|---|---|---|---|
| 14-01 | `docker-compose.yml`, 1 new test | 1 | — |
| 14-02 | `.env.{slim,full}.example`, `tools/bootstrap*.sh`, `docs/operations.md`, 3 new tests | 1 | NO overlap with 14-01 |
| 14-03 | 6 new overlay YAMLs, `Makefile`, `scripts/run.sh`, `compose-harness.ts`, parity linter, 1 new test | 2 | NO overlap with 14-04 (different files) |
| 14-04 | `apps/api/src/lib/byok-guard.{ts,test.ts}`, `apps/{api,worker}/src/{index,otel-bootstrap{,.test}}.ts` | 2 | NO overlap with 14-03 |
| 14-05 | `apps/worker/src/{index,queues,scheduler}.{ts,test.ts}`, 2 deletes, `tests/e2e/log-scrub-sentinel.test.ts`, `docs/{architecture,operations}.md` | 3 | NO overlap with 14-06 (Helm vs worker); minor: `docs/operations.md` touched by 14-02 (Wave 1) AND 14-05 (Wave 3) — 14-05 APPENDS a new subsection; 14-02 ADDED the BYOK Matrix section; no line collision; both edits use Edit tool with anchor strings, no overlap |
| 14-06 | `charts/openwhispr/**` (values + templates + tests) | 3 | NO overlap with 14-05 |
| 14-07 | `tests/e2e-cjm/features/*.feature` (new), `tests/e2e-cjm/support/{byok-steps.ts,compose-harness{,.test}.ts,world.ts}` | 4 | — last wave, single plan |

**`docs/operations.md` cross-wave touch:** 14-02 adds the BYOK Matrix section (Wave 1); 14-05 adds the "Upgrade from Phase 13 — virtual-key-rotation removal" subsection (Wave 3). These edits target DIFFERENT sections of the file and use anchor-based Edit calls. No semantic conflict. The Wave-3 plan depends on Wave-1's output (14-05 `depends_on: [01, 02, 03, 04]` — explicit).

**`tests/e2e-cjm/support/compose-harness.ts` cross-wave touch:** 14-03 extends `COMPOSE_FILES` (Wave 2); 14-07 extends `bootStack()` opts signature (Wave 4). 14-07 `depends_on: [03]` is explicit. Different lines / different code regions.

**Audit result:** No same-wave file conflicts. All cross-wave touches are explicit `depends_on` edges with non-overlapping line regions.

## F. Per-task winners/losers for the conformance audit pattern

Plans 14-01, 14-02, 14-03, 14-05, 14-06 use the conformance-test-first pattern (a static `tests/integration/<topic>-conformance.test.ts` that codifies the desired state, RED before edits, GREEN after). This is the same pattern Phase 12 established as the "validation strategy" oracle.

| Plan | Conformance oracle | Winners (assertions) | Loser cases (negative assertions) |
|---|---|---|---|
| 14-01 | `tests/integration/slim-core-base.test.ts` | services == 7 set; api/web ports; depends_on subsets | NO `profiles:` keys; NO `:-fallback` on OTEL env |
| 14-02 | `tests/integration/env-slim-example.test.ts` | exactly 10 KEY= lines; sentinel values match; `.env.full.example` exists | `.env.example` does NOT exist (renamed); OPENROUTER value empty (not placeholder) |
| 14-03 | `tests/integration/compose-overlays.test.ts` | 6 overlay files exist; merged config lints; Grafana datasource on postgres:5432; Makefile targets present | Grafana datasource does NOT include `pgbouncer`; dev-tools.yml does NOT include `fixture-idp` |
| 14-04 | `apps/api/src/lib/byok-guard.test.ts` + `boot-order.test.ts` | 15 fatal-shape cases; boot-order before SSRF+OTel | NO `secret` substring in redaction case; first-violation-only |
| 14-05 | `tests/integration/virtual-key-rotation-removed.test.ts` | 8 negative-existence assertions (files gone, identifiers gone, diagram cleaned) | Transient cleanup IS present in index.ts |
| 14-06 | `charts/openwhispr/tests/*_test.yaml` helm-unittest | enabled→render cases; disabled→empty cases; AND-gate cases | Default render does NOT include observability/storage/tls/pooler/mailpit content |
| 14-07 | Gherkin scenarios | 8 scenarios across 3 features (boot states, env states, exit codes, log records) | NO regression on Phase 13 cjm; full suite green |

## G. Coverage floor (PROJECT.md constitutional ≥ 90/90/90/90)

Each plan declares ≥ 90/90/90/90 on diff in its `<verification>` section. Plans 14-04 and 14-05 are the highest-risk for coverage gaps:
- 14-04 (byok-guard) — pure-function module, 15 cases, all branches exercised. Easy to reach 90+.
- 14-05 (vkr removal) — deletes code more than it adds; the only NEW code is the transient cleanup block (~5 LOC). Coverage measured on the cleanup block + the rewritten log-scrub-sentinel test. Plan task 2 verify gate enforces ≥ 90/90/90/90.

The phase-12 lesson (use real-PG testcontainer pattern, NOT internal fakes) is N/A for Phase 14: no plan touches DB-touching test code. Plan 14-05 only deletes a DB-touching test file (`virtual-key-rotation.test.ts`); the rewritten `log-scrub-sentinel.test.ts` uses the email-delivery queue path which has its own testcontainer harness already.

---

## H. Sign-off

- [x] Every REQUIREMENTS.md SLIM-/BYOK- entry has at least one plan (audit A).
- [x] Every CONTEXT.md decision has at least one plan (audit D).
- [x] Every phase success criterion has an owning plan + truths coverage (audit B).
- [x] All 12 RESEARCH-driven critical findings from the prompt have an owning plan (audit C).
- [x] No same-wave plan file conflicts; cross-wave touches use anchored edits + explicit `depends_on` (audit E).
- [x] Conformance-test-first pattern applied uniformly (audit F).
- [x] Coverage floor declared per plan; phase-12 lesson considered (audit G).

**No PHASE SPLIT recommended.** No source-item is unplanned. The 7-plan slicing fits the context budget per plan (each plan ≤ 3 tasks, all tasks 10-30% context per task per planner discipline).
