# Phase 20 — Plan-Check Verdict

**Checked:** 2026-05-16
**Plans verified:** 4 (20-01, 20-02a, 20-02b, 20-03)
**Checker:** gsd-plan-checker (goal-backward verification, adversarial stance)
**Verdict:** **CONCERNS** — substantively well-planned, but 3 blockers and 4 warnings must be addressed before `/gsd-execute-phase 20`.

---

## TL;DR

The four plans collectively cover SR-20.1..SR-20.7 and audit findings A1/A2/A5/A6/A7 + B1/B2/B3 + C1 with strong analog reuse from Phase 19b (lint pattern) and Phase 09 (helm-unittest pattern). The split into 20-01 / 20-02a / 20-02b / 20-03 cleanly isolates the only real risk surface (readOnlyRootFilesystem + uid mismatch in 20-02b). TDD discipline (RED → GREEN) is visible in commit-message templates on every plan.

**However, three issues block clean execution as currently written:**

1. **BLOCKER — Dimension 11 (Research Resolution):** `20-RESEARCH.md` `## Open Questions` section is NOT marked `(RESOLVED)`. Questions 1 (e2e overlay path), 2 (acme overlay), 3 (LiteLLM fork deferral) need explicit `RESOLVED:` markers OR a section-level `(RESOLVED)` suffix before this phase can execute per the constitutional research-gate.
2. **BLOCKER — SC7 has no observation surface:** ROADMAP Success Criterion 7 demands a `docker kill` smoke proving auto-restart within 5 s on pgbouncer / traefik / minio / loki / grafana. No plan owns this verification. The planner's flagged divergence ("covered implicitly by SR-20.2 edits") is INSUFFICIENT — implicit ≠ verified. Restart policy YAML can be present and still misbehave (e.g. wrong syntax `restart: 'unless-stopped'` quoted, or compose-spec version interaction).
3. **BLOCKER — `20-02b` Task 2 Dockerfile change risks producing a broken image:** Task 2 prescribes `USER 1000` numeric, plus chown of `/app/apps/web/.next/cache`. The action body says "Update any subsequent `chown -R nextjs:nodejs /app` to use uid 1000 (or `nextjs:nodejs` if name resolution works)" — this is non-atomic and ambiguous. If the rebuild flips `adduser -u 1001` → `-u 1000` but the existing `chown -R nextjs:nodejs /app/.next` predates the new uid, the runtime owner is 1000 while build-time chown ran against the old name. Image needs an end-to-end `ls -la /app/apps/web/.next/cache` check captured in the verify block.

**Warnings (should fix, not blocking):**

- WARN — SC3 wording mismatch with plan (SC3 says "5 topologySpread assertions"; 20-02a delivers 4 because DaemonSet exempted per RESEARCH §5).
- WARN — 20-01 Task 2 has 10 files modified in a single GREEN commit (above the 5-8 target, at the 10 warning line in scope-sanity).
- WARN — 20-03's "RED" is a draft-PR CI URL, not a git commit (TDD discipline is preserved but not in the canonical RED→GREEN commit pair shape).
- WARN — 20-02b memory floor for web is documented as 384M in CONTEXT but 512M in the 20-01 interfaces block (mismatch).

---

## Dimension-by-Dimension Verdict

### Dimension 1 — Requirement Coverage: PASS

| Requirement | Plans | Tasks | Status |
|---|---|---|---|
| SR-20.1 (compose limits) | 20-01 | T1 (RED lint), T2 (GREEN YAML across 10 files) | COVERED |
| SR-20.2 (compose restart) | 20-01 | T2 (Traefik/PgBouncer/MinIO/5×LGTM) | COVERED |
| SR-20.3 (Helm startupProbe) | 20-02a | T1 (RED), T2 (GREEN, 4 Deployments) | COVERED |
| SR-20.4 (Helm topologySpread) | 20-02a | T1 (RED), T3 (GREEN, 4 Deployments; DaemonSet exempt per RESEARCH §5) | COVERED-WITH-DIVERGENCE |
| SR-20.5 (Helm securityContext) | 20-02b | T1 (RED), T2 (Dockerfiles), T3 (api/web/worker hardening), T4 (LiteLLM relaxed), T5 (OTel completion) | COVERED |
| SR-20.6 (CI compose-lint) | 20-03 | T1 (8-cell matrix + vitest + CLI) | COVERED |
| SR-20.7 (TDD RED before GREEN) | ALL | every plan's commits | COVERED |

Plans `requirements:` frontmatter all align with the SR-20.X line — no missing IDs.

### Dimension 2 — Task Completeness: PASS (with one note)

All `<task type="auto">` blocks have files/action/verify/done. The `<task type="checkpoint:human-verify">` in 20-02b T7 has what-built/how-to-verify/resume-signal — correct shape.

**Note:** 20-03's single task collapses RED + GREEN into a "single atomic commit" while documenting RED-evidence as a CI run URL. This is acceptable for pure-CI work (the gate's RED proof is the failing-CI URL, not a code revert) but should be explicitly marked as a Dimension-7-divergence-by-design in the SUMMARY.

### Dimension 3 — Dependency Correctness: PASS

```
20-01      depends_on: []        wave A   (lint script + compose YAML)
20-02a     depends_on: []        wave A   (helm-unittest + 4 Deployments)
20-02b     depends_on: [02a]     wave B   (securityContext, builds on 02a's helm-unittest)
20-03      depends_on: [01]      wave C   (CI invokes tools/lint-compose-resources.ts from 20-01)
```

No cycles. Wave assignment matches RESEARCH §12 graph. **Verified zero shared files between 20-01 and 20-02a** (compose YAML vs helm templates — disjoint). 20-02a and 20-02b share `api/web/worker/litellm-deployment.yaml` + `values.yaml` + `values.schema.json` + 4 helm-unittest files — but the `depends_on: [02a]` serialization plus the constitutional "no two plans modify the same file in the same atomic commit" rule is honored because 20-02a edits commit before 20-02b reads them.

### Dimension 4 — Key Links Planned: PASS

20-01 wires `tools/lint-compose-resources.ts` ↔ `Makefile` ↔ `package.json` ↔ 10 compose files (all via key_links). 20-02a wires templates ↔ values.yaml ↔ helpers.tpl ↔ helm-unittest. 20-02b wires templates ↔ Dockerfiles ↔ deferred-items.md. 20-03 wires `.github/workflows/ci.yml` ↔ `tools/lint-compose-resources.ts` from 20-01. All key links explicit.

### Dimension 5 — Scope Sanity: WARN

| Plan | Tasks | files_modified | Verdict |
|---|---|---|---|
| 20-01 | 3 | 16 | **WARN** — 16 files (10 compose + 4 lint/fixture + Makefile + package.json) exceeds the 10-file warning line; Task 2 alone touches 10 files in one GREEN commit |
| 20-02a | 3 | 10 | borderline (10 files; 4 templates + 2 values + 4 helm-unittest) |
| 20-02b | 7 | 15 | **WARN** — 15 files is at the 15+ blocker line; 7 tasks exceeds the 4 warning line; checkpoint task is intentional |
| 20-03 | 1 | 1 | PASS |

20-01 and 20-02b carry the bulk; they ARE inherently large (mechanical YAML sweeps + multi-image hardening with kind smoke). The split into 20-02a/20-02b already mitigated risk. **Recommendation:** accept as-is given the constitutional "one phase, one atomic guardrail contract" framing — but flag for orchestrator to watch context budget on 20-02b execution (build/load/smoke kind cluster may eat 30-40% of budget alone).

### Dimension 6 — Verification Derivation: PASS

`must_haves.truths` on every plan are user/operator-observable (runtime behavior, file presence, `kubectl exec id -u` output, CI run color) rather than implementation incidentals. Strong example: 20-02b T7 truth "`kubectl exec deploy/ow-api -- touch /forbidden` → expect Read-only file system error" is concrete and reproducible.

### Dimension 7 — Context Compliance: PASS

CONTEXT.md locked decisions all map to plan tasks. Cross-check:

| CONTEXT.md decision | Plan covering it |
|---|---|
| Memory floors (postgres 2G, etc.) | 20-01 `<interfaces>` block + lint defaults |
| 5 LGTM `restart: unless-stopped` | 20-01 T2 |
| 4 Deployment startupProbe shape | 20-02a T2 |
| topologySpread maxSkew 1 / hostname / ScheduleAnyway | 20-02a T3 |
| Pod-level + container-level securityContext (api/web/worker/litellm) | 20-02b T3+T4 |
| OTel `runAsUser: 0` retained + new allowPrivEsc + seccomp | 20-02b T5 |
| Image-runtime audit if uid 1000 unavailable | 20-02b T2 (image rebuild) + T7 (live verify) |
| 8 compose-profile matrix | 20-03 T1 |
| TDD discipline | every plan's commit-message template |

No deferred ideas (audit P1/P2) appear in plans. No scope creep.

### Dimension 7b — Scope Reduction Detection: PASS

Scanned all 4 plans for `"v1"`, `"simplified"`, `"static for now"`, `"placeholder"`, `"future enhancement"`, `"not wired to"`, `"too complex"`. ONE hit on `"future"` — 20-02b T6 (deferred-items.md entry) — but this is a LEGITIMATE deferral of LiteLLM fork (Option B in RESEARCH §6 Problem 2), explicitly endorsed by RESEARCH and CONTEXT as an in-phase decision to take Option A. No silent reduction.

### Dimension 7c — Architectural Tier Compliance: SKIPPED (responsibility map exists but Phase 20 is pure infra-tier; no application logic placement)

### Dimension 8 — Nyquist Compliance: PASS

8a (automated verify presence): every task has `<verify><automated>...</automated></verify>` except the human-verify checkpoint (correctly excluded).
8b (feedback latency): no watch-mode flags; longest cell is the kind cluster smoke (~5 min, documented in human checkpoint); short tasks use `pnpm test:lint-compose-resources` (~5-10s) and `helm unittest` (~10s) — both fast.
8c (sampling continuity): wave A has 3 implementation tasks in 20-01 + 3 in 20-02a, all with automated verify.
8d (Wave 0 completeness): no `MISSING` placeholders found.
8e (VALIDATION.md): not strictly required since RESEARCH.md `## Validation Architecture` is present at lines 1063+. SKIPPED with rationale.

### Dimension 9 — Cross-Plan Data Contracts: PASS

No shared data pipelines. 20-01 (compose YAML) and 20-02a (helm YAML) are disjoint surfaces. 20-02b extends 20-02a but no data is transformed; it only adds keys.

### Dimension 10 — CLAUDE.md Compliance: PASS

- Strict TDD: visible in every plan's commit-message templates.
- Per-phase coverage ≥ 90/90/90/90: 20-01 explicitly enforces via `package.json` script; 20-02a/02b use helm-unittest assertions (not TS code, so coverage gate doesn't apply directly to YAML).
- English-only: confirmed across plan prose and inline comments.
- No `--no-verify`: not mentioned in any plan.
- Hard Rule #1 (never edit production to make tests pass): 20-01 Task 2 action explicitly invokes the constitutional carveout — "these production-YAML edits exist to satisfy a NEW guardrail, not to silence a fail in pre-existing production code" — correct framing per CLAUDE.md.
- Hard Rule #3 (orchestrator verifies independently): each plan's `<verification>` block lists explicit commands the orchestrator must run.
- GitHub Actions: 20-03 wires there.
- Image pinning: no plan touches image tags.

### Dimension 11 — Research Resolution: **FAIL (BLOCKER #1)**

`20-RESEARCH.md` line 1145 has `## Open Questions` — NOT `## Open Questions (RESOLVED)`. Three questions listed:

1. E2E overlay file path — 20-03's plan **does in-line resolution** ("CONFIRM exact filename via `ls compose/e2e/` during plan execution"). Per the gate, this needs explicit `RESOLVED:` in RESEARCH.md.
2. `compose/docker-compose.acme.yml` lint coverage — recommendation given but NOT marked `RESOLVED:`.
3. LiteLLM fork decision deferral — 20-02b T6 closes this, but RESEARCH.md must mark `RESOLVED:`.

**Remediation:** edit `20-RESEARCH.md` to:
- Change heading to `## Open Questions (RESOLVED)`, OR
- Prefix each item with `**RESOLVED:**` and the chosen path.

Verified during this check via `ls compose/e2e/` → exactly one file `docker-compose.e2e.yml` (matches the 20-03 plan's assumption). Q1 has no real ambiguity remaining; it's a documentation gate.

### Dimension 12 — Pattern Compliance: PASS

20-PATTERNS.md mappings are honored:
- 20-01 references `tools/lint-traefik-routes.ts` analog (PATTERNS §2.1) ✓
- 20-02a references `charts/openwhispr/tests/api_test.yaml` (PATTERNS §2.4) ✓
- 20-02b references `apps/web/Dockerfile:117-118` (PATTERNS §2.11) ✓
- 20-03 references `.github/workflows/ci.yml:18,164,224` for harden-runner SHA pin (PATTERNS §3.6) ✓

---

## Success-Criterion → Plan-Task Trace (ROADMAP SC1..SC8)

| SC | Plan.Task | Truth that observes it | Status |
|---|---|---|---|
| SC1 (lint script ≥90/90/90/90 + non-zero on broken fixture + CI on compose PRs) | 20-01.T1 (creates + tests) + 20-01.T2 (clean against tree) + 20-03.T1 (CI gate) | "Vitest coverage on tools/lint-compose-resources.ts >= 90/90/90/90"; "make lint-compose-resources exits 0 against live tree and exits 1 against BAD fixture" | PASS |
| SC2 (live tree → 0 violations) | 20-01.T2 | "Running auditComposeResources against the live repo tree returns []" | PASS |
| SC3 (helm-unittest: 4 startupProbe + 5 topologySpread + 8 securityContext, all 109+ tests PASS) | 20-02a.T1+T2+T3 (4+4) + 20-02b.T1+T3+T4+T5 (8) | helm-unittest asserts on all 4 Deployments + LiteLLM relaxed + OTel | **CONCERN — SC3 wording demands 5 topologySpread assertions; plan delivers 4 because DaemonSet is exempted per RESEARCH §5. Orchestrator must update ROADMAP SC3 wording to "4 topologySpread (4 Deployments; OTel DaemonSet exempted)" OR re-include OTel DaemonSet for nominal compliance.** |
| SC4 (helm template `yq` shows runAsNonRoot + 3 container keys on every api/web/worker/litellm) | 20-02b.T3+T4 | "rendered template ... does NOT contain readOnlyRootFilesystem or runAsUser on litellm" | **CONCERN — SC4 says "every api/web/worker/litellm pod spec carries runAsNonRoot: true"; 20-02b explicitly does NOT set runAsNonRoot on LiteLLM (Option A relaxed-hardening). Either update ROADMAP SC4 wording to "api/web/worker (LiteLLM exception)" OR re-derive SC4 from RESEARCH §6.** |
| SC5 (CI compose-lint green on main, red on broken PR) | 20-03.T1 | "test PR that deliberately deletes a `deploy.resources.limits.memory` turns the job red" | PASS (RED + GREEN run URLs captured in SUMMARY) |
| SC6 (kind smoke: helm install green within 90 s) | 20-02b.T7 (human-verify checkpoint) | "all 4 Deployments reach Ready within 90 s" | PASS |
| SC7 (compose `docker kill` shows auto-restart within 5 s on pgbouncer/traefik/minio/loki/grafana) | — | NO COVERING TASK | **BLOCKER #2 — orphaned SC** |
| SC8 (A1–A7 + B1–B3 + C1 flip from open to resolved) | 20-01 closes A1/A2/A5/A6/A7; 20-02a closes B1/B2; 20-02b closes B3; 20-03 closes C1 | each plan's commit message names the audit ID | PASS |

---

## Audit-Finding → Plan-Task Trace (per SC8)

| Audit | Plan.Task | Status |
|---|---|---|
| A1 (no compose limits) | 20-01.T1+T2 | PASS |
| A2 (Traefik no restart) | 20-01.T2 | PASS |
| A5 (PgBouncer no restart) | 20-01.T2 | PASS |
| A6 (MinIO no restart) | 20-01.T2 | PASS |
| A7 (LGTM no restart) | 20-01.T2 | PASS |
| B1 (no startupProbe) | 20-02a.T2 | PASS |
| B2 (no topologySpread) | 20-02a.T3 | PASS |
| B3 (no securityContext) | 20-02b.T3+T4+T5 | PASS |
| C1 (no compose-lint CI) | 20-03.T1 | PASS |

---

## Planner-Flagged Divergence Adjudication

### Divergence 1 — OTel DaemonSet dropped from SR-20.4 topologySpread scope

**Verdict: ACCEPTABLE-WITH-ROADMAP-EDIT.** RESEARCH §5 is technically correct: a DaemonSet controller already enforces 1-pod-per-node, so `topologySpreadConstraints` is operationally a no-op on it. The plan correctly cites this in 20-02a Task 3 action.

**However:** ROADMAP SR-20.4 wording ("every Deployment + the OTel Collector DaemonSet") and SC3 wording ("5 new topologySpread assertions") both explicitly include the DaemonSet. The plan delivers 4. Two paths:

- **Path A (recommended):** Edit ROADMAP SR-20.4 + SC3 to scope to 4 Deployments with rationale "DaemonSet controller enforces 1/node; topologySpread is a no-op per RESEARCH §5". Orchestrator approves and edits ROADMAP BEFORE execute.
- **Path B (cheap-but-noisy):** Add a no-op topologySpread block to the OTel DaemonSet to keep nominal SR-20.4 compliance. Cost: one extra helm-unittest assertion + ~5 lines of values.yaml. Defensible if "every Deployment + DaemonSet" wording is treated as load-bearing for audit-replay purposes.

Current plan implicitly chooses Path A. **Orchestrator MUST decide and edit ROADMAP before execute.**

### Divergence 2 — LiteLLM relaxed hardening + deferred-items.md entry

**Verdict: ACCEPTABLE.** Option A (relaxed hardening + documented exception + deferred fork) is the right call. Plan 20-02b T4 + T6 correctly:
- adds `allowPrivilegeEscalation: false` + `seccompProfile: RuntimeDefault` + `drop: [ALL]` to LiteLLM container
- explicitly omits runAsNonRoot / runAsUser / readOnlyRootFilesystem
- files deferred-items.md entry
- helm-unittest asserts `notExists` on the omitted keys (per RESEARCH §9)

Shape is distinguishable from api/web/worker full hardening via helm-unittest. **However, SC4 wording conflict (above) remains — orchestrator must reconcile.**

### Divergence 3 — SC7 (docker kill auto-restart smoke) is not a discrete checkpoint

**Verdict: NOT ACCEPTABLE AS-IS — BLOCKER #2.**

The planner's stance ("covered implicitly by SR-20.2 restart-policy edits") fails the goal-backward test. SC7's literal wording is operational: "manual `docker kill` of pgbouncer/traefik/minio/loki/grafana shows container auto-restart within 5 s." The YAML edit declares the policy; the smoke proves the policy is wired to the runtime. These are different observations.

Three failure modes the YAML-only plan misses:
1. `restart:` syntax typo (e.g., `'unless-stopped'` quoted in some YAML dialects can be parsed as string-typed)
2. Compose-spec version interaction: top-level `restart:` vs `deploy.restart_policy.condition` precedence on `docker compose` v2.x is well-documented to occasionally surprise
3. Service may be marked `restart: unless-stopped` but a healthcheck failure loop short-circuits restart

**Recommendation:** Add a `checkpoint:human-verify` task to 20-01 (after Task 2 GREEN) that flips `autonomous: true` → `false`. The checkpoint:

```
1. docker compose --profile default up -d --wait
2. for svc in pgbouncer traefik minio loki grafana; do
     docker kill ow-$svc
     sleep 6
     docker inspect ow-$svc --format='{{.State.Status}}' | grep -q running || FAIL
   done
3. Resume-signal: "approved — all 5 services auto-restarted within 5 s"
```

This is the canonical observation for SC7. Without it, SC7 ships unverified.

### Divergence 4 — apps/web/Dockerfile uid 1000 (user-prompt override of RESEARCH §6 Option-2)

**Verdict: ACCEPTABLE WITH PARTIAL CONCERN — see BLOCKER #3.**

The plan correctly reflects the user-prompt directive (uid 1000 across all three Dockerfiles + chown of /app/.next/cache + /tmp). RESEARCH §6 Problem 1 had recommended Option-2 (parameterize chart to 1001 for web), but user-prompt overrode. 20-02b T2 plus 20-PATTERNS §2.11 reflect Option-1 (rebuild web Dockerfile).

**BLOCKER #3 concern:** 20-02b Task 2 action body says "Update any subsequent `chown -R nextjs:nodejs /app` to use uid 1000 (or `nextjs:nodejs` if name resolution works)." This is non-atomic — the planner must choose ONE of:

- (a) Rewrite all chown invocations to `chown -R 1000:1000 /app/...` (numeric uid/gid) — definitive, no name-resolution dependency.
- (b) Keep `nextjs:nodejs` names but ensure the user creation (with new uid 1000) happens BEFORE every chown step in the Dockerfile.

The planned verify block only checks `id -u` returns 1000 and `/app/apps/web/.next/cache` exists. It does NOT verify the **ownership** of that directory matches uid 1000 at runtime, which is the exact failure mode where readOnlyRootFilesystem will surface as "permission denied on ISR write to a 1001-owned dir mounted under 1000-running container".

**Remediation:** strengthen 20-02b T2 `<verify>` automated check:
```bash
docker run --rm openwhispr-web:test sh -c 'stat -c %u:%g /app/apps/web/.next/cache' | grep -q '^1000:'
```

---

## Cross-Plan Coherence

| Check | Result |
|---|---|
| Wave A {20-01, 20-02a} truly independent (zero shared files)? | **PASS** — disjoint (compose YAML vs helm YAML) |
| Wave B {20-02b} depends only on 20-02a's helm-unittest scaffolding? | **PASS** — `depends_on: [02a]`; 20-02b APPENDS to 4 helm-unittest files 20-02a authored, no rewrites |
| Wave C {20-03} depends only on 20-01's lint script? | **PASS** — `depends_on: [01]`; 20-03 invokes `pnpm exec tsx tools/lint-compose-resources.ts` |
| No plan creates a file another plan also creates? | **PASS** |
| Atomicity preserved (no two plans modify same file in same atomic commit)? | **PASS** — serialization via waves enforces this; 20-02a commits land before 20-02b begins |
| Memory floor for web consistent across plans? | **FAIL** — 20-CONTEXT.md says "web ≥ 384M"; 20-01 plan's `<interfaces>` block says `web → memory: 512M`. Either is ≥ floor; pick one and document in SUMMARY. (WARNING, not blocker.) |

---

## Remediation Required Before Execute

### BLOCKERS

1. **Mark `20-RESEARCH.md` Open Questions as RESOLVED** — change `## Open Questions` to `## Open Questions (RESOLVED)` and prefix each item with `**RESOLVED:**` + chosen path. (Dimension 11 gate.)
2. **Add `checkpoint:human-verify` task to 20-01 for SC7** — `docker kill pgbouncer/traefik/minio/loki/grafana` + 5-second observation. Flip `20-01` frontmatter to `autonomous: false`. Update SC7 trace cell in this PLAN-CHECK from BLOCKER to PASS upon insertion.
3. **Strengthen 20-02b Task 2 verify block** — add ownership check `docker run --rm <web-image> stat -c %u:%g /app/apps/web/.next/cache | grep -q '^1000:'` and tighten the action body to specify either numeric-uid chown OR ordered name-then-uid sequence (not "or" ambiguity).

### WARNINGS (recommended but not blocking)

4. **Reconcile ROADMAP SC3 wording** — either edit ROADMAP to say "4 topologySpread assertions (DaemonSet exempted)" with RESEARCH §5 rationale, or add no-op topologySpread to OTel DaemonSet for nominal compliance.
5. **Reconcile ROADMAP SC4 wording** — edit ROADMAP to scope "runAsNonRoot + 3 container-level hardening keys" to api/web/worker only, with LiteLLM exception per RESEARCH §6 Problem 2.
6. **Reconcile web memory floor** — pick 384M (CONTEXT) or 512M (20-01 plan) and align both documents.
7. **20-03 RED-evidence shape** — explicitly mark in 20-03 plan that the RED→GREEN pair lives in CI run URLs (not git commits) per SR-20.7 carve-out for pure-CI changes, so SUMMARY.md captures both URLs.

---

## Recommendation to Orchestrator

**Hold execution.** The plans are substantively correct and well-researched, but three gates are unmet:

1. Constitutional research-resolution gate (Dimension 11)
2. SC7 has no observation surface (goal-backward gap)
3. 20-02b Task 2 has a known image-runtime risk that the verify block does not catch

Once the planner:
- marks RESEARCH §"Open Questions" as RESOLVED,
- adds the SC7 docker-kill checkpoint to 20-01,
- tightens 20-02b T2 (chown specificity + ownership verify),
- and (recommended) reconciles ROADMAP SC3/SC4 wording with the divergences,

re-spawn `gsd-plan-checker` for re-verification. Expect PASS on the re-check.

**Loop count: 1/3.** Two more revision cycles available before escalation to user per Revision-Gate pattern.

---

## Loop 2 (2026-05-16)

**Verdict:** **PASS-WITH-NOTES** — All 3 loop-1 blockers and all 4 loop-1 warnings closed correctly. Phase 20 is ready for `/gsd-execute-phase 20`. One residual procedural note on 20-03 frontmatter, downgraded from a blocker because the procedural dependency is enforced by the orchestrator's per-plan `autonomous: false` gate on 20-01, not by graph topology.

**Checked:** 2026-05-16
**Checker:** gsd-plan-checker (loop 2/3, re-verification after planner-applied fixes)
**Files re-read:** 20-RESEARCH.md §"Open Questions", 20-01-PLAN.md, 20-02a-PLAN.md, 20-02b-PLAN.md, 20-03-PLAN.md, 20-CONTEXT.md, ROADMAP.md Phase 20.

---

### Fix Verification (each loop-1 finding re-checked against committed text)

| # | Loop-1 finding | Expected fix shape | Verified shape | Verdict |
|---|---|---|---|---|
| **B1** | Dimension 11 — RESEARCH §Open Questions not RESOLVED | Section heading `## Open Questions (RESOLVED 2026-05-16)`; each Q1/Q2/Q3 prefixed `**RESOLVED:**` with chosen path | `20-RESEARCH.md:1145` exact heading match; Q1 (compose/e2e/docker-compose.e2e.yml confirmed), Q2 (acme.yml covered by static lint pass, no 9th matrix cell), Q3 (LiteLLM fork → 20-02b T6 deferred-items entry) all carry `**RESOLVED:**` prefix | **PASS** |
| **B2** | SC7 has no covering task | 20-01 `autonomous: false` + new Task 4 `checkpoint:human-verify` with `docker kill` recipe on 5 services + `## SC7 Verification` block in SUMMARY.md + operator sign-off gating Wave C | `20-01-PLAN.md:24` `autonomous: false  # Task 4 is a human-verify checkpoint...`; Task 4 body (lines 227-273) includes the exact `for svc in pgbouncer traefik minio loki grafana; do docker kill ...; sleep 5; ...` recipe, names `## SC7 Verification` section in `20-01-SUMMARY.md` for evidence paste, explicitly states "operator records the output ... then signs off (`[x]` checkbox) to unblock Wave C (20-03)" | **PASS** |
| **B3** | 20-02b T2 chown ambiguity + missing ownership-verify | (a) Numeric `chown -R 1000:1000` MANDATORY (no name-form); (b) `mkdir -p /app/apps/web/.next/cache` BEFORE chown; (c) automated verify includes `stat -c "%u:%g" .../.next/cache` returning `1000:1000` AND touch+rm probe as uid 1000 | (a) `20-02b-PLAN.md:208` "Replace every existing `chown` invocation in apps/web/Dockerfile with **numeric-uid form**: `chown -R 1000:1000 <path>` (NOT `chown -R nextjs:nodejs <path>` — name resolution depends on /etc/passwd which may diverge between build stages; numeric form is authoritative)"; (b) `:208` "create the dir with `mkdir -p /app/apps/web/.next/cache` BEFORE the chown"; (c) `:218-223` verify block contains `stat -c "%u:%g" /app/apps/web/.next/cache` + `[ "$own" = "1000:1000" ]` guard + `touch /app/apps/web/.next/cache/.probe && rm /app/apps/web/.next/cache/.probe` write-through probe | **PASS** |
| **W4** | ROADMAP SC3 wording mismatch (DaemonSet exemption rationale) | "4 new topologySpread assertions (api/web/worker/litellm Deployments only; OTel Collector DaemonSet is exempt because the DaemonSet controller already enforces one-pod-per-node — spread would be a no-op, see `20-RESEARCH.md §5`)" | `ROADMAP.md:1073` matches verbatim — "4 new topologySpread assertions (api/web/worker/litellm Deployments only; OTel Collector DaemonSet is exempt because the DaemonSet controller already enforces one-pod-per-node — spread would be a no-op, see `20-RESEARCH.md §5`)" | **PASS** |
| **W5** | ROADMAP SC4 wording mismatch (LiteLLM relaxed-hardening Option A) | runAsNonRoot scoped to api/web/worker only + LiteLLM relaxed Option-A subset called out (allowPrivEsc + seccompProfile + drop ALL only) | `ROADMAP.md:1074` "every api/web/worker pod spec carries runAsNonRoot: true and all three container-level hardening keys ... LiteLLM is held to a **relaxed hardening shape** (`allowPrivilegeEscalation: false` + `seccompProfile: RuntimeDefault` + `capabilities.drop: [ALL]` only) per the documented Option-A exception — upstream ... runs as uid 0 ... rebuilding as non-root is filed as deferred-item 'LiteLLM non-root image fork'." Exact Option-A subset enumerated. | **PASS** |
| **W6** | CONTEXT vs 20-01 web memory floor mismatch | CONTEXT describes "≥ 512M (chart-defaults floor of 384M is the lower bound; 512M is the recommended compose-side value)" | `20-CONTEXT.md:23` "worker/web ≥ 512M (web's chart-defaults floor of 384M is the lower bound; 512M is the recommended compose-side value per 20-01 PLAN + 20-RESEARCH §3 — adopting 512M to give Next.js standalone build headroom)" — matches | **PASS** |
| **W7** | 20-03 RED→GREEN is CI-URL not git-commit | `<objective>` contains "Divergence-by-design" paragraph acknowledging SR-20.7 narrow exception + justification (single-file CI scope; SR-20.7 invariant preserved via CI-URL pair) | `20-03-PLAN.md:49` paragraph beginning "**Divergence-by-design (acknowledged in 20-PLAN-CHECK.md warning 7):** ... This is an explicit, narrow exception to the SR-20.7 git-commit RED→GREEN pattern, justified by the single-file scope and the unavailability of a meaningful 'RED then GREEN' git-commit shape for pure CI YAML. SR-20.7's underlying invariant — *evidence of the failing-then-passing state precedes the merge* — is preserved via the CI URL pair." Exact divergence framing per loop-1 W7 ask. | **PASS** |

**All 7 fixes landed with the exact shape loop-1 demanded.** No partial fixes, no scope-reduction, no silent rewording.

---

### Regression Sweep — All Loop-1 PASS Dimensions Re-verified

| Dim | Loop-1 verdict | Loop-2 re-check | Notes |
|---|---|---|---|
| D1 Requirement Coverage | PASS | **PASS** | SC7 now has covering task (20-01 T4); requirements frontmatter on all 4 plans unchanged otherwise. |
| D2 Task Completeness | PASS-with-note | **PASS** | New 20-01 T4 `checkpoint:human-verify` has the correct shape — `<what-built>`-equivalent in `<behavior>`+`<action>`, `<verify><human>` block, `<done>` with operator checkbox + Wave C gating. Note: T4 uses `<behavior>`/`<action>`/`<verify>`/`<done>` (auto-task shape) rather than the `checkpoint:human-verify`-canonical `<what-built>`/`<how-to-verify>`/`<resume-signal>` shape used by 20-02b T7. Both shapes are accepted by gsd-executor; cosmetic inconsistency only, NOT a blocker. |
| D3 Dependency Correctness | PASS | **PASS-WITH-NOTE** | Wave graph unchanged at the frontmatter level (20-03 `depends_on: [01]`). The new procedural dep "Wave C waits for 20-01 SC7 sign-off" is enforced by 20-01's `autonomous: false` flag — the orchestrator cannot mark 20-01 complete (and therefore cannot unblock anything declaring `depends_on: [01]`) until T4 operator sign-off lands. This is structurally correct but implicit; see Residual Note 1 below for an optional explicitness pass. |
| D4 Key Links Planned | PASS | **PASS** | Unchanged. |
| D5 Scope Sanity | WARN | **WARN (unchanged)** | 20-01 now has 4 tasks (was 3) — Task 4 is a 0-file checkpoint, no incremental context cost. Still at 16 files modified (same as loop 1). 20-02b still 7 tasks / 15 files. Loop-1 acceptance ("inherent to the guardrail-contract framing") stands; no new scope creep introduced by the fixes. |
| D6 Verification Derivation | PASS | **PASS** | T4's truth-shape (`operator observes Up status within 5 s after docker kill`) is user-observable, runtime-grounded, exactly what SC7 demanded. |
| D7 Context Compliance | PASS | **PASS** | CONTEXT.md update on web memory floor (W6 fix) realigns the only loop-1 mismatch. All locked decisions still map 1:1 to plan tasks. |
| D7b Scope-Reduction Detection | PASS | **PASS** | Re-scanned all 4 plans + CONTEXT + ROADMAP for `"v1"`, `"simplified"`, `"static for now"`, `"placeholder"`, `"future enhancement"`, `"not wired to"`. Two hits: (1) 20-02b T6 "future fork-image phase remediates" — legitimate, this IS the deferred-items entry being filed in-phase; (2) ROADMAP SC4 "filed as deferred-item 'LiteLLM non-root image fork'" — legitimate, parallel mention of same Option-A documented exception. No silent reduction of any locked decision. |
| D7c Architectural Tier Compliance | SKIPPED | **SKIPPED** | Pure-infra phase. |
| D8 Nyquist Compliance | PASS | **PASS** | New T4 has `<verify><human>` (correct for human-verify checkpoint per Dimension 8 carve-out — automated check inapplicable to runtime-observability tasks). Sampling continuity preserved on Wave A (20-01 T1+T2+T3 all carry automated verify; T4 is correctly excluded). |
| D9 Cross-Plan Data Contracts | PASS | **PASS** | No new shared-pipeline surfaces introduced. |
| D10 CLAUDE.md Compliance | PASS | **PASS** | T4's manual-observation gate IS the canonical Hard-Rule-#3 verification surface for a runtime invariant; matches CLAUDE.md "orchestrator verifies independently". |
| D11 Research Resolution | **FAIL (loop 1 B1)** | **PASS** | `## Open Questions (RESOLVED 2026-05-16)` with per-item `**RESOLVED:**` markers — gate cleared. |
| D12 Pattern Compliance | PASS | **PASS** | No new file types introduced; existing pattern mappings unchanged. |

**No regressions detected.** The 7 fixes are surgical — they close the gaps without disturbing surrounding plan content.

---

### Updated SC → Plan-Task Trace

| SC | Plan.Task | Status (loop 2) |
|---|---|---|
| SC1 (lint script ≥90/90/90/90 + non-zero on broken fixture + CI on compose PRs) | 20-01 T1+T2 + 20-03 T1 | **PASS** |
| SC2 (live tree → 0 violations) | 20-01 T2 | **PASS** |
| SC3 (4 startupProbe + 4 topologySpread + ≥8 securityContext, DaemonSet exempt) | 20-02a T1+T2+T3 + 20-02b T1+T3+T4+T5 | **PASS** (ROADMAP wording now matches plan scope) |
| SC4 (api/web/worker full hardening; LiteLLM Option-A relaxed) | 20-02b T3+T4 | **PASS** (ROADMAP wording now matches plan scope) |
| SC5 (CI compose-lint red→green on broken→fixed PR) | 20-03 T1 | **PASS** (RED + GREEN run URLs captured in SUMMARY per Divergence-by-design framing) |
| SC6 (kind smoke: helm install green within 90 s) | 20-02b T7 | **PASS** |
| SC7 (compose `docker kill` shows auto-restart within 5 s on pgbouncer/traefik/minio/loki/grafana) | **20-01 T4 (new)** | **PASS** — explicit operator-observed runtime check, evidence pasted into 20-01-SUMMARY.md `## SC7 Verification` |
| SC8 (A1–A7 + B1–B3 + C1 audit findings flip to resolved) | 20-01 + 20-02a + 20-02b + 20-03 | **PASS** |

All 8 ROADMAP success criteria now have a discrete covering task with an observable truth.

---

### Residual Notes (NOT blockers — recommended quality-of-life improvements only)

1. **20-03 frontmatter could optionally make the SC7 dependency explicit.** Current `depends_on: [01]` correctly serializes Wave C behind 20-01, and 20-01's `autonomous: false` ensures 20-03 cannot start until the SC7 operator sign-off lands. Procedurally airtight. Optional explicit form: add a one-line `# SC7 sign-off (20-01 T4) must land before this plan starts — enforced by 20-01.autonomous=false + checkpoint:human-verify gating` comment in 20-03 frontmatter. Cosmetic only — does not change executor behavior. NOT a fix request.

2. **20-01 T4 checkpoint-task shape uses `<behavior>`/`<action>`/`<verify>`/`<done>` rather than the canonical `<what-built>`/`<how-to-verify>`/`<resume-signal>` shape** used by 20-02b T7. Both shapes are accepted by gsd-executor. NOT a fix request — flagged for future template consistency only.

3. **No 9th matrix cell for `compose/docker-compose.acme.yml` in 20-03** (per RESEARCH §"Open Questions" #2 resolution). Acme overlay is covered by the static lint pass on every `compose/*.yml` file, not by an extra `docker compose config` matrix cell. This is correct and intentional. NOT a fix request.

---

### Verdict & Next Step

**PASS-WITH-NOTES.** All three loop-1 blockers (B1 RESEARCH resolution, B2 SC7 observation surface, B3 20-02b T2 chown ambiguity + ownership verify) and all four loop-1 warnings (W4 SC3 wording, W5 SC4 wording, W6 web memory floor, W7 20-03 Divergence-by-design framing) are closed with the exact shape loop-1 demanded. No regressions on any of the previously-passing dimensions (D1, D2, D4–D10, D12). Dimension 11 flips from FAIL → PASS.

The phase is ready for `/gsd-execute-phase 20`. Expected wave-order at execute time:

```
Wave A: { 20-01 (incl. T4 SC7 human-verify), 20-02a }     # parallel
        ↓ (20-01 T4 sign-off unblocks Wave C; 20-02a unblocks Wave B)
Wave B: { 20-02b (incl. T7 kind-smoke human-verify) }
Wave C: { 20-03 }                                          # only after 20-01 fully complete
```

Two plans require human-in-the-loop sign-off (20-01 T4, 20-02b T7) — orchestrator must wire these to the operator-prompt surface; no agent should attempt to auto-complete a `checkpoint:human-verify` task per CLAUDE.md Hard Rule #3.

**Loop count: 2/3.** One revision cycle remains in budget before escalation. Not needed — re-spawn unnecessary.
