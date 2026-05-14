---
phase: 14-slim-core-byok-profiles-v2
artifact: PLAN-CHECK
generated: 2026-05-14
checker: gsd-plan-checker (Opus 4.7)
verdict: PASS-WITH-WARNINGS
---

# Phase 14 Plan-Check

Goal-backward verification of the 7 PLAN.md files (`14-01..14-07`) against the
Phase 14 goal in `ROADMAP.md:734-752`, the 5 success criteria, the 7 locked
decisions in `14-CONTEXT.md`, the 12 critical RESEARCH findings flagged in the
plan-check prompt, and PROJECT.md constitutional discipline.

## Findings table

| ID | Severity | Dimension | Description |
|---|---|---|---|
| F-01 | WARNING | key_links_planned | `14-03` (Plan, must_haves.truths line 27) says ingress overlay does NOT remove `4000:3000` / `3000:3000` host ports. `14-PATTERNS.md` §2 (line 31) says it DOES remove them. Contradiction — needs explicit resolution before execution. |
| F-02 | WARNING | task_completeness | `14-04` Task 3 / `<implementation>` line 183 leaves the choice between (a) cross-app relative import `../../api/src/lib/byok-guard.js` and (b) hoisting to `packages/byok-guard/` to the executor based on tsconfig inspection. This is a real architectural fork affecting `files_modified` list — should be decided at plan time, not delegated to execute time. |
| F-03 | WARNING | scope_sanity | `14-06` declares 23 entries in `files_modified` (Helm chart templates + values + tests). Although task count = 3, file fan-out is high; coverage discipline depends on helm-unittest cases exercising every gated branch. |
| F-04 | WARNING | scope_sanity | `14-03` declares 11 entries in `files_modified` across 6 new overlays + Makefile + scripts/run.sh + compose-harness.ts + parity linter. Task count = 3, but the linter allowlist edit (Task 3 step 4) overlaps with `14-06` Task 3 which only "verifies" — slight risk of who-owns-the-edit ambiguity. Acceptable per VALIDATION.md audit E, but flag for executor attention. |
| F-05 | TIDY | task_completeness | `14-07` Task 2 step 4 reads "Fix any wire-up bugs uncovered (…if the api doesn't loud-fail in the storage-OFF case, it likely means the env wasn't truly unset)" — instructs cross-plan bug-fix as part of Wave-4 Gherkin authoring. That's fine for an end-to-end gate, but coverage budget for Wave-4 should explicitly include "back-fix into 14-04 if necessary". |
| F-06 | TIDY | requirement_coverage | `14-07.requirements` lists ALL 7 (SLIM-01..04, BYOK-01..03). That's fine as e2e re-claim, but `requirements:` frontmatter intent is "owning plan". The owning plans are 14-01, 14-02, 14-03, 14-04, 14-05, 14-06. 14-07 should perhaps tag itself differently (e.g. `verifies:` not `requirements:`). Not a blocker — `gsd-sdk query` will report exact-1 ownership only if it dedups. |
| F-07 | NIT | verification_derivation | `14-04` must_haves.truths line 22 — for `pgbouncer`/`BYOK_DATABASE_REQUIRED`, both CONTEXT.md decision 2 and PLAN 14-04 acknowledge `DATABASE_URL` is already required for all profiles. The "loud-fail" for this row is documentation-only, not a NEW gate. Truth statement is correct but possibly tautological in tests. |
| F-08 | NIT | claude_md_compliance | All artifacts in English ✓. No `--legacy` flags ✓. No internal-logic mocks ✓. No suggestion of bypassing CI ✓. No moralization/scope-stretches detected. |

No BLOCKERs.

## Per-axis verdict

### 1. Goal coverage — PASS

Phase 14 goal (ROADMAP.md:735): "Bare `docker compose up` brings up exactly
the 6 services a corporate operator needs ... observability / storage /
ingress / pgbouncer / dev-tools land only when the operator explicitly opts
in."

Clause-by-clause mapping:

| Goal clause | Owning plan(s) | must_haves.truths citation |
|---|---|---|
| "Bare `docker compose up` brings up exactly the 6 services" | 14-01 | `14-01-PLAN.md:14` ("brings up exactly 6 long-running services (api, web, worker, postgres, valkey, litellm) plus migrate as init-container") |
| "observability / storage / ingress / pgbouncer / dev-tools land only when … opt in" | 14-03 | `14-03-PLAN.md:24` ("Six new overlay files exist under `compose/`") |

5 success criteria → plan mapping:

| Criterion | Plan(s) | Evidence line |
|---|---|---|
| SC1 — 6 services + profiles inversion closed | 14-01 | `14-01-PLAN.md:14-18` |
| SC2 — opt-in overlays + mailpit-only in dev-tools + 1:1 Helm toggles | 14-03 (compose) + 14-06 (Helm) | `14-03-PLAN.md:24,29` + `14-06-PLAN.md:37` |
| SC3 — BYOK env contracts documented + api refuses to start | 14-02 (docs) + 14-04 (refusal) | `14-02-PLAN.md:25` + `14-04-PLAN.md:21,23` |
| SC4 — All 3 noopX resolved | 14-05 | `14-05-PLAN.md:23-24` |
| SC5 — 3 Gherkin scenarios GREEN | 14-07 | `14-07-PLAN.md:25-27` |

All 5 success criteria have an owning plan + an explicit truth.

### 2. Requirement coverage — PASS

| REQ | Plan | Frontmatter line |
|---|---|---|
| SLIM-01 | 14-01 | `14-01-PLAN.md:11` |
| SLIM-02 | 14-03 | `14-03-PLAN.md:21` |
| SLIM-03 | 14-02 | `14-02-PLAN.md:16` |
| SLIM-04 | 14-02 | `14-02-PLAN.md:17` |
| BYOK-01 | 14-06 | `14-06-PLAN.md:34` |
| BYOK-02 | 14-04 | `14-04-PLAN.md:18` |
| BYOK-03 | 14-05 | `14-05-PLAN.md:20` |

14-07 re-claims all 7 as verifying plan (see F-06). No requirement is
double-claimed for ownership; no requirement is unclaimed.

### 3. CONTEXT.md compliance — PASS per decision

| Decision | Compliance | Evidence |
|---|---|---|
| **D1** — 6+migrate slim-core; 5 overlays + 6th contract-test overlay | PASS | `14-01-PLAN.md:14` declares 6 long-running + migrate; `14-03-PLAN.md:24` declares 6 overlay files INCLUDING `contract-test.yml` (the 6th, out of Helm) |
| **D2** — Pino fatal + exit 1 (not 78) | PASS | `14-04-PLAN.md:21` "`process.exit(1)`"; `<implementation>` line 165 explicitly rejects `sysexits.h` 78 |
| **D3** — DELETE virtual-key-rotation (not real adapters) | PASS | `14-05-PLAN.md:23` "deleted from the tree" + `git rm` in Task 2 |
| **D4** — `.env.slim.example` = 5 visible + commented overlay appendix | PASS | `14-02-PLAN.md:20-22` declares 5 visible keys + 4 bootstrap-invisible + OTEL sentinel + 5 commented overlay sections |
| **D5** — OTel `=disabled` sentinel in BOTH apps/api AND apps/worker | PASS | `14-04-PLAN.md:25` "`apps/api/src/otel-bootstrap.ts` AND `apps/worker/src/otel-bootstrap.ts` short-circuit" + Task 2 lists both files |
| **D6** — Helm: observability umbrella, pooler flip (not new), mailpit informational, tls rename from ingress.* | PASS | `14-06-PLAN.md:37` enumerates all 5 with correct status labels (NEW umbrella / FLIPPED / NEW informational / NEW rename) |
| **D7** — Phase 14 before Phase 15 | PASS (N/A) | No code change required; ROADMAP order is authoritative; VALIDATION.md §D documents this |

### 4. RESEARCH findings honored — PASS per finding

| Finding | Owner plan | Evidence |
|---|---|---|
| F1 — Author 3 Gherkin scenarios (not just flip) | 14-07 | All 3 feature files NEW (`14-07-PLAN.md:25-27`) |
| F2 — Profiles inversion deletion | 14-01 | Task 2 step 2 (`14-01-PLAN.md:106`) "DELETE every `profiles:` line on the 7 surviving services" |
| F3 — pooler.enabled FLIP default (not create) | 14-06 | `14-06-PLAN.md:37` "`pooler.enabled` (FLIPPED to default false)" |
| F4 — Observability sub-toggles preserved; umbrella AND-gates | 14-06 | `14-06-PLAN.md:39` "AND-gate the new umbrella with their existing sub-toggles" |
| F5 — storage.enabled = Bitnami minio sub-chart condition | 14-06 | `14-06-PLAN.md:38` Chart.yaml declares `condition: storage.enabled` |
| F6 — mailpit.enabled informational only | 14-06 | `14-06-PLAN.md:42` "NO `mailpit-deployment.yaml` is added" |
| F7 — bootstrap.sh line 39 env-overridable | 14-02 | Task 1 (`14-02-PLAN.md:96-103`) `BOOTSTRAP_ENV_TEMPLATE` |
| F8 — .env.slim.example includes invisible bootstrap keys | 14-02 | Task 2 Test 3 (`14-02-PLAN.md:121`) lists 4 invisible keys + sentinel |
| F9 — Virtual-key-rotation removal (8 files + log-scrub rewrite + BullMQ cleanup) | 14-05 | Tasks 2+3 cover all 8 files, log-scrub rewrite, transient Valkey cleanup |
| F10 — e2e-cjm compose-harness COMPOSE_FILES + bootStack opts | 14-03 (COMPOSE_FILES) + 14-07 (envOverrides/expectExit) | `14-03-PLAN.md:32` + `14-07-PLAN.md:100-103` |
| F11 — otel-bootstrap.ts changes in BOTH apps | 14-04 Task 2 | `14-04-PLAN.md:25,232-237` |
| F12 — Phase 06 testcontainer harness UNTOUCHED | (none — verified) | No plan lists Phase 06 testcontainer files in `files_modified`; VALIDATION.md §G confirms |

### 5. Constitutional discipline — PASS

- **Strict TDD** — every implementation plan has explicit RED → GREEN sequence with separate test commits before impl commits. 14-04 declares `type: tdd` and uses RED→GREEN→REFACTOR. ✓
- **No internal-logic mocks** — 14-04 explicitly forbids them (`<objective>` line 60 "internal-logic mocks are forbidden and not needed"); 14-04 uses `process.exit` spy + in-memory pino destination = process boundaries only. ✓
- **No internal mocks in production code** — 14-05's entire purpose is to remove the only existing internal-mock-in-production violation (`noopLitellmKeyClient`, `noopUserKeyLookup`). ✓
- **Coverage floor ≥ 90/90/90/90 on diff** — each `<verification>` block declares it. ✓
- **E2E mandatory** — 14-07 provides 8 Gherkin scenarios; 14-05 rewrites `tests/e2e/log-scrub-sentinel.test.ts` to retain e2e coverage. ✓
- **English-only artifacts** — every plan in English. ✓
- **No `--legacy` flags / no scope workarounds** — none detected. 14-05 explicitly says "do not add a 'loop with retry' workaround" (`14-05-PLAN.md:167`). ✓
- **Same atomic commit for fix + tests** — TDD commit cadence per plan respects this. ✓

### 6. Dependency / wave safety — PASS

DAG:
```
Wave 1: 14-01 (deps: [])           14-02 (deps: [])
Wave 2: 14-03 (deps: [01])         14-04 (deps: [01])
Wave 3: 14-05 (deps: [01,02,03,04])  14-06 (deps: [01,03])
Wave 4: 14-07 (deps: [01..06])
```

No cycles. No forward references. Wave numbers correctly derive from
max(deps)+1 (with 14-05's wave 3 being `max(01,02,03,04)+1 = 3` ✓).

**Same-wave file-overlap analysis:**

- Wave 1 (14-01 ∩ 14-02): `docker-compose.yml` vs `.env.slim.example` / `bootstrap.sh` / `docs/operations.md` — DISJOINT ✓
- Wave 2 (14-03 ∩ 14-04): compose YAMLs / Makefile / harness vs apps/api/src/lib / otel-bootstrap — DISJOINT ✓
- Wave 3 (14-05 ∩ 14-06): apps/worker / docs vs charts/openwhispr — DISJOINT ✓ (with one caveat: `tools/lint-compose-chart-parity.test.ts` is touched by 14-03 in Wave 2 and verified by 14-06 in Wave 3; depends_on edge is explicit)

**Cross-wave touches** to `docs/operations.md` (14-02 Wave 1 adds BYOK matrix; 14-05 Wave 3 adds upgrade subsection) — different sections, anchor-based edits, explicit `depends_on` edge. ✓

### 7. Atomicity — PASS per plan (with WARNINGS)

| Plan | Tasks | Files | Verdict |
|---|---|---|---|
| 14-01 | 3 | 1 source + 1 test | PASS (clean) |
| 14-02 | 3 | 6 | PASS |
| 14-03 | 3 | 11 | WARNING (F-04 — file fan-out) |
| 14-04 | 3 | 8 | PASS |
| 14-05 | 3 | 9 | PASS |
| 14-06 | 3 | 23 | WARNING (F-03 — Helm template fan-out) |
| 14-07 | 3 | 6 | PASS |

All plans ≤ 3 tasks. No plan tries to do unrelated things. WARNINGS on
14-03 and 14-06 are scope/fan-out flags, not coherence violations — both
plans are one cohesive scope (compose overlays / Helm toggles respectively)
with high but unavoidable file count.

### 8. Interface specificity — PASS per shipping plan

| Plan | Specificity verdict | Note |
|---|---|---|
| 14-03 (overlays) | PASS | RESEARCH §A.1/§A.3/§G.2 referenced for exact service definitions; each overlay's required `services:` / `depends_on:` / `environment:` deltas enumerated in Task 2 |
| 14-04 (byok-guard) | PASS (BEST) | Explicit `<interfaces>` block with TypeScript types: `BYOKOverlay`, `BYOKErrorCode`, `BYOKFatalRecord`, `assertBYOKConfig` signature. RED test can be written first cleanly. |
| 14-06 (Helm templates) | PASS | RESEARCH §C.1 referenced for each template's gate wrapper; values.yaml additions enumerated line-by-line in Task 2 step 1 |

Plans 14-01, 14-02, 14-05, 14-07 do not ship new module surfaces requiring
interface blocks (they edit YAML / .env / docs / Gherkin), so the
specificity bar is met by RESEARCH citations alone.

## Final verdict

**PASS-WITH-WARNINGS — plans ready for execute after the planner acknowledges
the 2 warnings below.**

### Warnings (fix-inline before execution; not blocking)

1. **F-01 (key_links_planned, WARNING):** `14-03-PLAN.md:27` says the ingress
   overlay does NOT remove the slim-core host ports (`4000:3000` / `3000:3000`).
   `14-PATTERNS.md:31` says the ingress overlay DOES remove them.
   **Planner action:** pick one. Recommend keeping ports (per plan text — gives
   ops belt-and-braces direct access for healthchecks AND Traefik) and update
   PATTERNS.md §2 to match. OR pick removal and update PLAN 14-03 truth.

2. **F-02 (task_completeness, WARNING):** `14-04-PLAN.md:183` defers the
   "cross-app import vs new `packages/byok-guard/` package" decision to the
   executor. This is an architectural fork that changes `files_modified`,
   tsconfig edits, and the test layout.
   **Planner action:** inspect the existing tsconfig project boundaries NOW and
   pick the path. If a new package is needed, add it to `files_modified` and
   author a `packages/byok-guard/package.json` task. If cross-app relative
   import is OK, state so explicitly and drop the conditional.

### Tidy items (non-blocking; address opportunistically)

- F-04, F-05, F-06, F-07 — minor frontmatter / cross-plan-edit-ownership
  clarifications; can be addressed during execution.

### Goal-backward final audit

Every clause of the Phase 14 goal has an owning plan with a covering must_haves
truth. Every requirement (SLIM-01..04, BYOK-01..03) has exactly one owning
plan. Every CONTEXT.md decision (D1-D7) is honored. Every RESEARCH critical
finding (F1-F12) is addressed by name. No scope reduction detected (no "v1",
"simplified", "static for now", "future enhancement", "minimal" language used
as scope-cut justification anywhere across the 7 plans). The DAG is acyclic
with explicit waves. TDD discipline declared per plan with coverage floor.

**Once F-01 and F-02 are resolved, `/gsd-execute-phase 14` may proceed.**

## Resolutions Applied

Both WARNING findings resolved inline by the planner on 2026-05-14 before execution.

- **F-01 (ingress overlay host-port behavior) — RESOLVED.** Ingress overlay strips slim-core base host ports via compose 2.20+ `ports: !reset []` under both `api` and `web` service blocks. Without the overlay, slim-core base keeps `localhost:3000` / `:4000` for the OSS quickstart. Phase 13 e2e harness already addresses services via Traefik front URL (`compose-harness.ts:71` → `https://api.localhost/api/health`), so harness scenarios are unaffected. Confirmed Docker Compose v2.23.0-desktop.1 supports `!reset`. Commit `docs(14-03): align ingress overlay host-port behavior with patterns (plan-check F-01)`. Updated `14-03-PLAN.md` (must_haves truth + artifact description + new `ports:\s*!reset\s*\[\]` key_link + Task 1 assertion + Task 2 action + Task 3 harness note + verification step 5) and `14-PATTERNS.md:31`.
- **F-02 (byok-guard module location) — RESOLVED.** Hoisted to `packages/byok-guard/` workspace package (option b), mirroring the `packages/email/` analog. Both `apps/api/src/index.ts` and `apps/worker/src/index.ts` import via `@openwhispr/byok-guard`. Cross-app relative imports are forbidden. `redact-url.ts` vendored into the package (< 30 LoC) to keep it self-contained. `files_modified` updated to: `packages/byok-guard/{package.json, tsconfig.json, vitest.config.ts, src/index.ts, src/redact-url.ts, src/__tests__/byok-guard.test.ts}` + `apps/api/package.json` + `apps/worker/package.json` (workspace dep) + the api/worker `index.ts` + `otel-bootstrap.ts` + `otel-bootstrap.test.ts` edits + the new `apps/api/src/__tests__/boot-order.test.ts`. Commit `docs(14-04): hoist byok-guard to packages/byok-guard (plan-check F-02)`. Updated `14-04-PLAN.md` (frontmatter `files_modified`, must_haves truths/artifacts/key_links, objective, `<feature>` files list, `<implementation>` import-specifier change, Task 1 retitle + steps, Task 3 workspace-dep step + test) and `14-PATTERNS.md:19-20`.
