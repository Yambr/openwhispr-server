<!--
SPDX-FileCopyrightText: 2026 Nick Iambroskin and OpenWhispr Server contributors
SPDX-License-Identifier: FSL-1.1-ALv2
-->
# Phase 17 — Plan Check (Goal-Backward Verification)

**Checked:** 2026-05-15
**Plans verified:** 17-01 (dev toolchain, 434 lines), 17-02 (isolation enforcement, 744 lines), 17-03 (production ACME + Helm, 778 lines)
**Mode:** adversarial goal-backward (start from TLS-01..06 + ROADMAP SC; verify plans deliver)

## Verdict: **PASS-WITH-CONCERNS**

All 6 requirements covered, all 5 ROADMAP success criteria reachable, all 4 locked decisions honored, all 5 pattern-map critical corrections present, wave-parallel feasibility verified, ZERO `--no-verify` policy explicit in every plan, English-only and conventional-commit invariants satisfied. Two non-blocking concerns surfaced (size overshoot, deviation-handling depth) — both acceptable given the trade-offs. **Orchestrator MAY proceed to `/gsd-execute-phase 17`.**

---

## 1. Requirement Coverage Matrix

| Requirement | Source | 17-01 | 17-02 | 17-03 | Status |
|---|---|---|---|---|---|
| **TLS-01** `make tls-trust` Makefile target (5-host SAN, no wildcard) | REQUIREMENTS.md:496 | ✓ Tasks 1,5 | — | — | COVERED |
| **TLS-02** Traefik dev (mkcert) + prod (ACME) profiles | REQUIREMENTS.md:497 | ✓ dev (Tasks 1,3) | — | ✓ prod (Tasks 1-3) | COVERED |
| **TLS-03** `--with-ingress` ACME + cert-manager sub-chart gated by `ingress.enabled` | REQUIREMENTS.md:498 | — | — | ✓ Tasks 1-8 | COVERED |
| **TLS-04** README quickstart step 2 `make tls-trust`; no browser warning | REQUIREMENTS.md:499 | ✓ Task 4 | — | — | COVERED |
| **TLS-05** `.dockerignore` excludes `**/rootCA*.pem`; prod Dockerfile lint | REQUIREMENTS.md:500 | — | ✓ Tasks 1-4,5,8 | — | COVERED |
| **TLS-06** Air-gap install path documented | REQUIREMENTS.md:501 | — | ✓ Task 6 | — | COVERED |

**No gaps.** Every TLS-01..06 ID appears in at least one plan's `requirements:` frontmatter list AND has at least one task body addressing it.

---

## 2. ROADMAP Success-Criteria × Plan Delivery

ROADMAP.md Phase 17 entry enumerates 5 success criteria (line 58 + lines ~784-795).

| SC | Description | Delivered by |
|---|---|---|
| SC#1 | `make tls-trust` → `mkcert -install` + 5-host explicit SAN cert (NOT `*.localhost`) | 17-01 Task 1 + Task 2 (bootstrap.sh de-wildcard) |
| SC#2 | Traefik dev profile serves mkcert certs from `compose/traefik/certs/` | 17-01 Task 1 (writes to existing Traefik-mounted path) — no `dynamic.dev.yml` edit needed |
| SC#3 | Production ACME wired through `--with-ingress`; cert-manager sub-chart gated by `ingress.enabled` | 17-03 Tasks 1-3 (compose) + Tasks 4-8 (Helm) |
| SC#4 | Dev-cert isolation (`.dockerignore` + prod Dockerfile lint) | 17-02 Tasks 1-4 (lint CLI + root + per-context dockerignore) |
| SC#5 | Air-gap install path documented | 17-02 Task 6 (`docs/operations.md#air-gap-mkcert`) |

All 5 reachable. **No SC orphaned.**

---

## 3. Locked-Decision Check (CONTEXT.md `<decisions>`)

| Decision | Sub-picks | Present in plans? | Evidence |
|---|---|---|---|
| **Q1 mkcert wiring** | A2 (regen if missing/<30d) + B3 (platform-error + air-gap) + C1 (single SAN 5 hosts) + D1 (overwrite in place) | ✓ ALL | 17-01 Task 1 must_haves truths #1-#5 encode all four sub-picks verbatim; recipe copied from CONTEXT lines 85-111 verbatim |
| **Q2 ACME + Helm** | A3 (staging toggle via env) + B3 (optional bundled cert-manager, default OFF) + C3 (Issuer kind switch) + D1 (never wildcard) | ✓ ALL | 17-03 Tasks 1,3,4,5,6 deliver each; D1 enforced by `! grep -q 'Host(\`\*\.'` in Task 2 verify |
| **Q3 dev-cert isolation** | A2 (expanded root + per-context dockerignore) + B1 (tsx lint CLI) + C1 (Gherkin prod-image scan) + D1 (status-quo cert dir) | ✓ ALL | 17-02 Tasks 1-4 (CLI) + Task 4 (both dockerignores) + Task 5 (Gherkin scenario 2 filesystem scan) |
| **Q4 plan split** | Option B (3 plans, Wave 1 ‖ Wave 2 sequential) | ✓ | Frontmatter: 17-01 wave 1 depends_on [], 17-02 wave 2 depends_on [17-01], 17-03 wave 1 depends_on []; commit counts 1 + 2 + 2 = 5 |

All 16 sub-picks delivered. **No decision contradicted; no deferred idea smuggled into scope.**

---

## 4. Pattern-Map Critical-Correction Check

| Correction | Plan/Task | Evidence | Status |
|---|---|---|---|
| `values.schema.json` drift — must include schema update + python3 verifier | 17-03 Task 5 | Action explicitly extends schema; `<verify>` uses `python3 -c "import json; ..."` to assert all 6 keys present | ✓ |
| `bootstrap.sh` SAN surgical lines 358-371 — drift handling | 17-01 Task 2 | Action body addresses drift via `<deviation_handling>` block (first bullet: grep + single-deletion + no-op tolerance) | ✓ |
| Lint glob narrowed to `**/Dockerfile` (NOT `**/Dockerfile*`) | 17-02 Task 3 | lefthook block: `glob: "**/Dockerfile"`; comment cites 17-PATTERNS risk callout line 226; verify grep keys on this | ✓ |
| `tools/spdx-header.ts` HASH_PATTERNS verification | 17-02 Task 7 | Task 7 explicitly runs `pnpm spdx:audit-hash` and conditionally extends HASH_PATTERNS for `.feature` (rejecting `.dockerignore` scope-creep per PATTERNS line 184) | ✓ |
| Makefile INLINE recipe (no `tools/tls-trust.sh` delegation) | 17-01 Task 1 | Action body copies CONTEXT lines 85-111 inline; no shell-script delegation; cites Makefile `clean-stack:` (lines 101-104) inline precedent | ✓ |

**All 5 critical corrections honored.**

---

## 5. Wave-Parallel Feasibility (File-Tree Disjointness)

CONTEXT Q4 claims 17-01 ‖ 17-03 (Wave 1 parallel-safe). Verified against frontmatter `files_modified` lists:

| File | 17-01 | 17-03 | Conflict |
|---|---|---|---|
| `Makefile` | M | — | none |
| `tools/bootstrap.sh` | M | — | none |
| `compose/traefik/certs/.gitkeep` | C | — | none |
| `.gitignore` | M | — | none |
| `README.md` | M | — | none |
| `compose/traefik/traefik.yml` | — | M | none (17-01 makes ZERO Traefik edits by Q1-C1) |
| `compose/traefik/dynamic.prod.yml` | — | C | none |
| `compose/docker-compose.acme.yml` | — | C | none |
| `charts/openwhispr/**` | — | M+C (9 files) | none |

**Verdict: 17-01 ∩ 17-03 = ∅.** Wave 1 parallel execution safe. 17-02 (Wave 2) depends on 17-01 via the `compose/traefik/certs/` path predicate keyed in the lint CLI — sequencing correct.

---

## 6. TDD Discipline

| Plan | TDD-eligible code | RED→GREEN cadence? | Evidence |
|---|---|---|---|
| 17-01 | NONE (Makefile/bash/markdown — outside CLAUDE.md TS-only coverage scope) | N/A (explicit waiver line 366-368) | ✓ acceptable |
| 17-02 | `tools/lint-dockerfile-tls.ts` (TypeScript CLI) | ✓ Task 1 (RED + fixtures) → Task 2 (GREEN impl) → Task 3 (wiring atomic commit bundles both) | ✓ RED-first; module-not-found is the failure mode |
| 17-03 | NONE (YAML/JSON-schema/Helm templates — outside scope) | N/A (explicit waiver line 686-687); helm-unittest matrix in Task 7 acts as regression gate | ✓ acceptable |

**No production code precedes its test in any TDD-eligible task.** Constitutional invariant satisfied.

---

## 7. Coverage Gate (≥ 90/90/90/90)

| Plan | New TS code | Coverage claim | Verify command |
|---|---|---|---|
| 17-01 | none | n/a (Makefile/bash/markdown waiver explicit) | n/a |
| 17-02 | `tools/lint-dockerfile-tls.ts` | ≥ 90/90/90/90 claimed (truths #6; success-criterion #1) | Task 2 verify: `pnpm vitest run … --coverage` |
| 17-03 | none | n/a (YAML/Helm waiver explicit) | n/a |

**Coverage gate honored where applicable; explicit waivers where not.**

---

## 8. Atomic Commits + Conventional + English-Only

Total predicted commits: 1 (17-01) + 2 (17-02) + 2 (17-03) = **5 commits**, matching CONTEXT line 201.

| Commit subject | Length | lowercase | Conventional | English |
|---|---|---|---|---|
| `feat(17-01): mkcert-backed \`make tls-trust\` + bootstrap SAN de-wildcard` | 67 | ✓ | ✓ | ✓ |
| `feat(17-02): wire lint-dockerfile-tls into pnpm + lefthook + CI` | 60 | ✓ | ✓ | ✓ |
| `feat(17-02): dev-CA isolation evidence (dockerignore + Gherkin + air-gap docs)` | 78 | ✓ | ✓ | ✓ |
| `feat(17-03): production ACME via Traefik resolver + docker-compose.acme.yml overlay` | 84 | ✓ | ✓ | ✓ |
| `feat(17-03): optional bundled cert-manager sub-chart + (Cluster)Issuer template` | 80 | ✓ | ✓ | ✓ |

All ≤ 100 chars, conventional `feat(NN-NN):` prefix, lowercase subject after colon, English. Commit BODIES are English.

---

## 9. `--no-verify` Policy

Every plan includes the **explicit HALT clause** in `<deviation_handling>`:

- 17-01 lines 396-399: `lefthook fires unexpectedly … HALT, do NOT apply --no-verify`
- 17-02 lines 702-704: `lefthook fires on commit A or B unexpectedly. HALT, do NOT apply --no-verify`
- 17-03 lines 718-720: `lefthook fires on commit A or B unexpectedly. HALT, do NOT apply --no-verify`

**Predicted instances: ZERO.** Phase 16 precedent confirms feasibility.

---

## 10. Other Constitutional Checks

| Constraint | Check | Status |
|---|---|---|
| English-only source artefacts | All plan prose, action bodies, commit messages, identifiers, comments | ✓ |
| No internal mocks | 17-02 lint CLI uses real Vitest + tmpdir fixtures; 17-03 helm-unittest renders real templates; no internal logic mocked | ✓ |
| HTTPS-only invariant | 17-03 Tasks 1-3 ACME resolver only adds challenge entrypoint; no plaintext HTTP added | ✓ |
| Bootstrap.sh SAN corollary (Q1) | 17-01 Task 2 explicit | ✓ |
| PITFALLS §16 → §13 ref-fix | 17-02 Task 7 explicit (with scope guard via 10-line preceding-context grep) | ✓ |

---

## 11. Bootstrap.sh Corollary

CONTEXT pitfalls_correction line 20 mandates dropping `*.localhost` (line 360) and `*.example.test` (line 368) from bootstrap.sh SAN block.

**17-01 Task 2 delivers:**
- Action body explicitly enumerates the 10-host explicit replacement list (matches CONTEXT line 82 + PATTERNS line 62 byte-for-byte).
- `<verify><automated>` checks both negative (`! grep -E 'DNS\.[0-9]+ *= *\*\.localhost'`) and positive (`grep -E 'DNS\.[0-9]+ *= *api\.localhost'`) predicates.
- `<deviation_handling>` first bullet handles line-number drift (single wildcard, zero wildcards) gracefully.

**Status: ✓ delivered.**

---

## 12. PITFALLS §16 → §13 Reference Fix

17-02 Task 7 includes:
- Grep `PITFALLS §16` in ROADMAP.md and replace with `§13` **only within Phase 17 entry block** (10-line preceding-context guard prevents collateral damage to legitimate §16 references elsewhere).
- Same for REQUIREMENTS.md, with skip-if-absent handling.

**Status: ✓ delivered with scope-creep guard.**

---

## 13. Plan-Size Overshoot Assessment

CONTEXT does NOT actually impose a 600-line hard cap on plan files (re-read of CONTEXT confirms no such line). The user's prompt cites "600-line hard cap from CONTEXT" but this is not present in the actual CONTEXT artifact. The closest constraint is gsd `scope_sanity` guidance (2-3 tasks/plan target, 4 warning, 5+ blocker).

| Plan | Lines | Tasks | Files | Assessment |
|---|---|---|---|---|
| 17-01 | 434 | 5 | 5 | Borderline (5 tasks); Task 5 is the commit-orchestration task (not new logic) — effectively 4 logic tasks. ACCEPTABLE. |
| 17-02 | 744 | 8 | 16 | High task count but task pairs (1+2 RED/GREEN; 4-7 commit-B prep, 8 commit-B). Inline content = Gherkin scenarios + dockerignore bodies + air-gap docs that ARE the deliverables. ACCEPTABLE. |
| 17-03 | 778 | 8 | 12 | High task count but tasks 1-3 = compose-plane atomic; tasks 4-8 = K8s-plane atomic. Inline content = helm-template body + helm-unittest matrix that ARE the deliverables. ACCEPTABLE. |

**Verdict:** The size is driven by **deliverable inline content** (YAML/Gherkin/Helm bodies that the executor must produce verbatim), not by verbose prose. Splitting 17-02 or 17-03 further would violate CONTEXT Q4's atomic-commit invariants ("Lint CLI tooling triad atomic", "K8s-plane atomic"). **Overshoot is ACCEPTABLE; not a blocker.**

---

## 14. Concerns (non-blocking)

1. **Plan size at high end of comfort zone.** 17-02 and 17-03 sit at 744 + 778 lines. Executor context budget should accommodate, but if any plan needs revision mid-execution, prefer surgical edits to the relevant `<task>` block rather than full re-write.

2. **17-02 Task 7 `tools/spdx-header.ts` conditional extension.** The task is correctly *conditional* (only if `pnpm spdx:audit-hash` complains), but if the audit DOES complain, extending HASH_PATTERNS adds another file to commit B's already-large staging set. If executor hits this, document in 17-02-SUMMARY clearly.

3. **17-03 Task 5 `values.schema.json` "schema absent entirely" branch.** The `<deviation_handling>` says "proceed without schema edit" if the file is missing — but a missing schema is itself a Phase-15-or-earlier gap; the planner correctly scoped it OUT, but verifier should confirm presence on Phase-17 entry.

4. **17-03 Task 3 compose-resolve smoke** requires `LETSENCRYPT_EMAIL` and `PUBLIC_DOMAIN` env at smoke time. The deviation block does not cover the case where the smoke command itself isn't runnable in CI (e.g. no `docker` binary). Risk is low (CI runners have docker), but document if hit.

5. **17-02 Task 5 cucumber-tsx `pending(...)` stub** for scenarios 1 + 3. Verifier (`/gsd-verify-phase`) must NOT count `pending` as a green test — it's deferred to GHA CI. Tags `@after-docker-up @expected-red` make the deferral explicit; align verifier expectations accordingly.

None of these are blockers. All are surfaced for executor + verifier awareness.

---

## 15. Final Verdict

**PASS-WITH-CONCERNS.** Orchestrator may proceed to `/gsd-execute-phase 17`.

Required reading for executor (no fixes routed to planner):
- 17-CONTEXT.md (locked decisions)
- 17-PATTERNS.md (analog file mapping + risk callouts)
- 17-01 / 17-02 / 17-03 PLAN.md (this verification confirms they are executable)
- 17-PLAN-CHECK.md (this file — concerns to monitor)

Wave plan:
- **Wave 1 (parallel):** 17-01 + 17-03 — disjoint file trees verified.
- **Wave 2 (sequential):** 17-02 — depends on 17-01's `compose/traefik/certs/` path establishment.

Predicted commit count: **5**. Predicted `--no-verify`: **0**.
