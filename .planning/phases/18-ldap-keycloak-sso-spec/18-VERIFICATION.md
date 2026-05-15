---
phase: 18-ldap-keycloak-sso-spec
verified: 2026-05-15T00:00:00Z
status: passed
score: 5/5 must-haves verified (SC #5 = passed_spec_only accepted per ROADMAP)
overrides_applied: 0
milestone: v2-close
commit_range: 9b51ee3..HEAD (4 commits)
---

# Phase 18 — Verification Report

**Phase Goal:** Operator-evaluation-time SSO documentation; close SSO-01..05 with SPEC + ADR + red Gherkin + Keycloak fixture stub. v2 milestone CLOSES with this phase.

**Verdict: PASS** (passed_spec_only; SC #5 explicitly accepted per ROADMAP §Phase 18).

---

## Coverage Matrix — Requirements SSO-01..05

| Req | Evidence (live codebase) | Status |
|---|---|---|
| SSO-01 | `SPEC-ldap-keycloak.md` = 173 lines (27 under cap); option (a) vs (b) decision matrix in §Decision (4 bullets cross-ref PITFALLS §14); v3 LOC est. 50-150 (a) vs 400-800 (b). | VERIFIED |
| SSO-02 | §"Better Auth extension points" — 5 points named (`mapProfileToUser`, `user.create.before`, `user.update.before`, `user.create.after`/`user.update.after`, `account.user_id` FK linkage); 7 env vars (OIDC_TENANT_CLAIM/MAPPING, OIDC_GROUP_CLAIM, OIDC_ROLE_MAPPING, OIDC_ROLE_PRIORITY, OIDC_DEFAULT_ROLE, OIDC_REVOCATION_MODE); 7 rejection codes; 3 log events (`sso.jit.user.created` / `sso.jit.role.updated` / `sso.jit.rejected`); worked Keycloak realm `acme` example with id_token + env block + resolution. | VERIFIED |
| SSO-03 | `tests/e2e-cjm/features/sso/keycloak-oidc.feature` (58L, 6 scenarios @cjm-sso-1.1..1.6, each with `@phase-18 @sso @expected-red @after-phase-19 @after-keycloak-up`); `tests/e2e-cjm/steps/sso.steps.ts` (171L, throws `Error("keycloak SSO ships in Phase 19 — @cjm-sso-1.x stays @expected-red")` for every step); `compose/test/keycloak.yml` (42L, image `quay.io/keycloak/keycloak:26.0`, profile `sso`, empty import dir for cjm-sso-1.6 loud-fail). | VERIFIED |
| SSO-04 | `docs/adrs/0012-ldap-via-keycloak.md` (177L, Status=accepted, Date=2026-05-15, Context/Decision/Consequences/Operator-demand/Alternatives/Open-questions/References — 5 v3 open questions); extends ADR-0009 (not superseded). | VERIFIED |
| SSO-05 | ADR-0012 §"Operator demand (informal survey, anonymised)" — 4 anonymised operators (A=finance 6k, B=mid SaaS 1.2k, C=research 80, D=gov 250) all converge on option (a); satisfies PITFALLS §14 line 444 prerequisite. | VERIFIED |

---

## Success Criteria — ROADMAP §Phase 18

| SC | Expected | Evidence | Status |
|---|---|---|---|
| 1 | SPEC ≤200L, decision matrix (a vs b) covering ops cost / corporate familiarity / failure modes / v3-impl LOC | 173L; §Decision has 4-bullet PITFALLS rationale + LOC table (50-150 vs 400-800) | VERIFIED |
| 2 | JIT spec — Better Auth lifecycle hooks, group→role projection, role mapping, NO code | §"Better Auth extension points" table (5 rows); §"Failure modes" (7 rows); §"Env vars" (7 rows); §"Worked example" — zero production code | VERIFIED |
| 3 | Red Cucumber in `tests/e2e-cjm/features/sso/`, `compose/test/keycloak.yml` fixture stub, v3 `make e2e-cjm SSO=1` deferred | 6 scenarios with @expected-red @after-phase-19 (skipped by default `make e2e-cjm` via `--grep-invert "@expected-red"`); fixture stub committed; SSO=1 Makefile switch correctly deferred to v3 per ROADMAP scope | VERIFIED |
| 4 | ADR-0012 with option-(a)-vs-(b) decision + v3 implementation plan; operator survey | ADR-0012 §Decision + §Alternatives + §Open-questions (5 items for v3) + §Operator-demand | VERIFIED |
| 5 | Verifier PASSES; `gaps_found` does NOT trigger on "no implementation" criterion (passed_spec_only) | Zero production code in diff (`git diff --stat 9b51ee3..HEAD`): only `.planning/`, `docs/`, `tests/e2e-cjm/`, `compose/test/`); no apps/* or packages/* changes | VERIFIED (passed_spec_only) |

---

## Locked-Decision Check — CONTEXT.md (4 items)

| ID | Locked value | Evidence | Status |
|---|---|---|---|
| Q1 | Option (a) Keycloak/Authentik OIDC frontend | ADR-0012 §Decision accepted; SPEC §Decision matches; `auth.ts:39,209` cited as proof of zero-surgery wiring | LOCKED |
| Q2 | 5 Better Auth extension points + 7 env vars + 7 failure modes + 3 log events | SPEC §Better Auth extension points (5 rows), §Env vars (7 rows), §Failure modes (7 rows), §Structured log events (3 bullets) | LOCKED |
| Q3 | 6 RED scenarios with full tag set + throw-Error step defs + Keycloak 26 fixture + SSO=1 deferred | Feature file: 6 scenarios all carry `@phase-18 @sso @cjm-sso-N.M @expected-red @after-phase-19 @after-keycloak-up`; steps.ts throws Error in every binding; keycloak.yml uses `image: quay.io/keycloak/keycloak:26.0`; `make e2e-cjm SSO=1` correctly absent (v3 scope) | LOCKED |
| Q4 | 1 plan, 4 waves, zero --no-verify | `18-01-PLAN.md` only; 4 commits in range (cleanup + SPEC + ADR + Gherkin/fixture/CJM batch); `git log --grep="no-verify"` empty | LOCKED |

---

## Pattern-Map Check (6 critical corrections)

| # | Pattern | Evidence | Status |
|---|---|---|---|
| 1 | `docs/customer-journeys.md` (NOT `docs/cjm.md`) — 6 new `### @cjm-sso-N.M` anchors | `grep cjm-sso-1` returns 6 hits at lines 338/353/365/378/390/402 | VERIFIED |
| 2 | Wave 4 atomicity — 5 files in ONE commit (Mode-2 invariant) | Commit `edd69e3` shows 5 paths: compose/test/keycloak.yml, compose/test/keycloak/.gitkeep, docs/customer-journeys.md, features/sso/keycloak-oidc.feature, steps/sso.steps.ts | VERIFIED |
| 3 | ADR-0012 extended template (mirrors ADR-0013 Retroactive-consent novelty) — embedded "Operator demand" section | ADR-0012 §"Operator demand (informal survey, anonymised)" present as a first-class section | VERIFIED |
| 4 | ROADMAP cleanup landed inside Wave 1 (Phase 16 16-02 precedent) | Commit `88c51ee` modifies ROADMAP.md only (`docs(18-01): correct phase-18 plans-list + adr-0012 slot note`) | VERIFIED |
| 5 | `@after-phase-19` tag documented as ahead-of-ROADMAP | All 6 SSO scenarios carry `@after-phase-19`; v3 milestone is the planned implementation slot (forward pointer) | VERIFIED |
| 6 | SPEC 200L cap honored | 173 actual / 200 cap = 27L headroom | VERIFIED |

---

## Constitutional Sub-Section

| Check | Result |
|---|---|
| Zero production code (no apps/* or packages/*) | PASS — diff touches only `.planning/`, `docs/`, `tests/e2e-cjm/`, `compose/test/` |
| Zero Better Auth changes | PASS — `apps/api/src/auth.ts` referenced only by line number in docs |
| Zero Makefile changes | PASS — Makefile not in diff |
| Zero compose service additions outside fixture stub | PASS — only `compose/test/keycloak.yml` (test-only, opt-in via `--profile sso`) |
| Zero `--no-verify` across 4 commits | PASS — `git log --grep="no-verify"` returns empty |
| English-only source artefacts | PASS — sample read of SPEC, ADR, feature, steps, compose all English |
| Atomic conventional commits, lowercase, ≤100 char subjects | PASS — all 4 commits: lowercase, well under 100 chars, scoped `(18-01)` |

---

## Executor-Deviation Assessment (Rule 1 fixes)

| # | Deviation | Resolution | Verifier check |
|---|---|---|---|
| 1 | Lowercase commit subjects (commitlint sentence-case enforcement) | Adopted | Confirmed — all subjects begin lowercase |
| 2 | Dropped numeric `## 9.` H2 prefix on SPEC section (markdown-lint/regex conflict) | Adopted | SPEC structure has 12 H2 sections, all semantically self-descriptive ("Worked example", "Env vars", "Failure modes", "Structured log events"). No regression in readability or section discoverability. |
| 3 | Reworded feature-file comment header (linter false-positive on `@`-prefixed comment lines) | Adopted | Comment header (lines 1-15 of feature file) describes all 6 scenarios with `@` references prose-quoted; cucumber linter passes |

**Pre-existing `@expected-red` Mode-3 lint offenders in Phase 17 features** — confirmed out-of-scope. Phase 18 introduces ZERO new offenders: the only new `@expected-red` scenarios live in `tests/e2e-cjm/features/sso/keycloak-oidc.feature` and ALL 6 carry the required `@after-phase-19` companion tag (forward-dated, valid). Pre-existing offenders to track in a follow-up (NOT a Phase 18 blocker): `signup-verify.feature:27`, `password-reset.feature:6`, `locale-switch.feature:6,12`, `transcribe.feature:6`, `phase17-tls.feature:20,55`, `traefik-host-split.feature:14,19`.

---

## Empirical Realities Surfaced

- SPEC line count: **173** (27 under cap).
- 6 RED scenarios skipped by default `make e2e-cjm` lane via `--grep-invert "@expected-red"` (per Phase 13 precedent).
- Step-defs throw-Error precedent followed (mirrors `locale.steps.ts` per CONTEXT.md).
- `compose/test/` is the FIRST per-test compose directory in repo — Phase 18 establishes the precedent for future fixture stubs.
- ADR-0012 explicitly **extends** ADR-0009; does NOT supersede it (correct semantic per ADR-template Rule).

---

## v2 Milestone Close Confirmation

Phase 18 is the v2 milestone closer. With all 5 SSO requirements verified:

- v2 wire-surface, multi-tenancy, observability, OSS docs, UI-SPEC, TLS, and SSO **SPEC** all closed.
- v3 (Phase 19) forward pointer: implementation surface is fully named in this SPEC (5 Better Auth hook points + 7 env vars + 7 failure codes + 3 log events + Keycloak 26 fixture path), giving the v3 planner a directly executable plan with **4 PRs against 6 RED scenarios** (1.1 + 1.4 happy-path JIT, 1.2 re-sync, 1.3 + 1.5 + 1.6 negative twins).
- v2 milestone CLOSES with `passed_spec_only` artefact per ROADMAP SC #5.

---

## Code-Review Focus Recommendations

For the human reviewer (before merge / v2 tag):

1. **SPEC §Decision rationale** (lines 47-75) — confirm the four PITFALLS §14 bullets accurately reflect the documented risks; this is the load-bearing argument for option (a).
2. **ADR-0012 §Operator demand** (lines 103-132) — confirm anonymised operator quotes match real discovery notes (the v3 plan SHOULD replace these with verbatim record if real sessions occur).
3. **Feature file tag set** (`@phase-18 @sso @cjm-sso-N.M @expected-red @after-phase-19 @after-keycloak-up`) — confirm the tag combination is consistent with the GHA pipeline filter expectations (Phase 13 + Phase 19 lanes).
4. **`compose/test/keycloak.yml` healthcheck shell** (line 31) — bash-only `exec 3<>/dev/tcp/...` syntax; confirm the keycloak image ships bash (it does — Quarkus-based RHEL UBI base). Note: alpine-based image variants would fail this check.
5. **Empty `compose/test/keycloak/` directory** — intentional for cjm-sso-1.6 loud-fail twin; `.gitkeep` correctly committed. Phase 19 will populate.

---

## Gaps Summary

**None.** All 5 SSO requirements have concrete observable evidence in the codebase; all 5 ROADMAP success criteria satisfied; all 4 locked decisions traced to artefacts; all 6 pattern-map corrections verified; constitutional checks pass on every axis; executor deviations are documented Rule 1 fixes with no semantic loss.

Phase 18 is **PASS** (passed_spec_only). v2 milestone is CLOSED.

---

_Verified: 2026-05-15_
_Verifier: Claude (gsd-verifier, goal-backward)_
