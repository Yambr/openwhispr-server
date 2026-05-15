---
phase: 18-ldap-keycloak-sso-spec
reviewed: 2026-05-15T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - .planning/ROADMAP.md
  - .planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md
  - docs/adrs/0012-ldap-via-keycloak.md
  - tests/e2e-cjm/features/sso/keycloak-oidc.feature
  - tests/e2e-cjm/steps/sso.steps.ts
  - compose/test/keycloak.yml
  - compose/test/keycloak/.gitkeep
  - docs/customer-journeys.md
findings:
  critical: 0
  blocker: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
verdict: APPROVE-WITH-FOLLOWUP
---

# Phase 18 — Code Review Report

**Reviewed:** 2026-05-15
**Depth:** deep (cross-file, with downstream linter + cross-ref verification)
**Files Reviewed:** 8 (4 commits, 88c51ee..edd69e3)
**Status:** issues_found (no BLOCKER; 3 WARNING + 5 INFO)
**Verdict:** **APPROVE-WITH-FOLLOWUP**

## Summary

Phase 18 lands as a SPEC + ADR + scaffolding-only deliverable. No production code; all artifacts are markdown, Gherkin, YAML, and one TS step-defs file mirroring the established `locale.steps.ts` precedent. The work is high-quality and constitutionally compliant — ZERO `--no-verify` across 4 commits, English-only, atomic, lefthook-clean.

Empirical verifications passed:

- `pnpm tsx tools/lint-cjm-doc.ts` → `CJM lint passed: ... (20 anchors)` (Mode-1 + Mode-2 + Mode-3 all GREEN).
- SPEC line count: **173** (≤200 hard cap; 27-line slack).
- ADR-0012 line count: **177** (no upper bound mandated; well-shaped).
- 6 feature tags ↔ 6 CJM doc anchors (1:1 pairing).
- All 4 commit subjects match the `docs(18-01):` / `feat(18-01):` patterns predicted by 18-01-PLAN.md.
- Every step-text token in `keycloak-oidc.feature` has a matching `Given`/`When`/`Then` regex in `sso.steps.ts` — cucumber-tsx parse-time strictness is satisfied.
- Cross-refs to `apps/api/src/auth.ts:39,209`, ADR-0009, ADR-0012, PITFALLS §14, and `packages/data/migrations/0001_better_auth.sql` all resolve.

Findings below are quality concerns — none block the v2 milestone close. Two are recommendations on Gherkin scenario semantics that should be tightened in Phase 19 when the scenarios go GREEN; one is a pre-existing offender count that the executor surfaced honestly.

---

## Warnings

### WR-01: Scenario 1.2 audit-event name is semantically wrong vs SPEC catalogue

**File:** `tests/e2e-cjm/features/sso/keycloak-oidc.feature:32`
**Issue:** Scenario 1.2 is "Returning OIDC user has name and email re-synced from claims" — a name/profile drift case with NO role mutation. The `Then` asserts `audit_log` action `sso.jit.role.updated`. SPEC `## Structured log events` (lines 149-154) reserves `sso.jit.role.updated` strictly for "returning user, role rewritten." A name-only re-sync is not a role rewrite. Either the catalogue needs a 4th event (`sso.jit.profile.updated` or `sso.jit.user.synced`), or the scenario must mutate the role. As-written, when Phase 19 implements against this scenario it will either emit the wrong audit event or have to refactor the scenario.
**Fix:** Either (a) update SPEC's `## Structured log events` to add a 4th event for profile-only re-sync and update scenario 1.2 accordingly, or (b) rewrite scenario 1.2 to also mutate a group-derived role so `sso.jit.role.updated` is the correct event. Recommend (b): scenario 1.2 becomes the role-change re-sync case and 1.3 (currently the downgrade twin) explicitly carries the revocation semantics. Land the fix as part of Phase 19's 19-01 PR (where scenario 1.2 goes GREEN).

### WR-02: Scenario 1.6 maps to an undocumented failure mode (boot-time vs request-time)

**File:** `tests/e2e-cjm/features/sso/keycloak-oidc.feature:54-58` + `.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md:135-145`
**Issue:** Scenario 1.6 asserts a boot-time loud-fail with structured log `sso.jit.rejected` + non-zero exit code when the api boots with `OIDC_ISSUER_URL` pointing at a missing realm. SPEC's `## Failure modes` table is request-time (`400`/`403` HTTP codes) and `sso.jit.rejected` is documented (line 153) as emitted from `mapProfileToUser` or `user.create.before` — both request-time codepaths. The boot-time loud-fail path is a separate concern (matches the v3 `lib/oidc-jit-config.ts` boot validator named at SPEC line 121, not the JIT request hooks). Reusing the `sso.jit.rejected` event name for both a per-request rejection AND a boot-failure conflates two different concerns and will make Phase 19's structured-log dashboards harder to write.
**Fix:** Add an 8th failure mode row to SPEC's `## Failure modes` table OR a separate boot-validation subsection capturing the "config malformed at boot" path with a distinct event name (e.g. `sso.config.invalid`). Cross-update scenario 1.6's `Then` line. Land alongside WR-01 in 19-01.

### WR-03: `customer-journeys.md` H2 heading lacks numeric section prefix unlike sibling sections

**File:** `docs/customer-journeys.md:327`
**Issue:** Executor deviation 2 dropped the `## 9.` prefix the plan required (18-01-PLAN.md SC #6 line 59 mandated literally `## 9. SSO via Keycloak (after-phase-19)`). The committed heading is `## SSO via Keycloak (after-phase-19)`. The deviation rationale (avoid `lint-cjm-doc.ts` numeric collision) is *not* validated by the linter source: `tools/lint-cjm-doc.ts:60` `ANCHOR_RE = /^###\s+@cjm-(\d+)\.(\d+)\s+(.+)$/gm` matches H3 anchors only and does not scan H2 headings; nothing in the linter would have flagged `## 9.`. Sibling sections 1-8 (lines 23-296) all carry numeric prefixes. The drop breaks visual consistency in the table-of-contents-style reading of the document. Note: this is INFO-tier in isolation, but rated WARNING because it contradicts a locked SC predicate in the plan and the published rationale ("regex linter false-positive") does not match the source code.
**Fix:** Re-add `## 9. SSO via Keycloak (after-phase-19)` heading. Re-run linter to confirm Mode-1/2/3 still pass (they will — H2 is out of regex scope). Land as a 1-line `docs(18-01):` follow-up commit or roll into the first Phase 19 docs commit.

---

## Info

### IN-01: ADR-0012 operator-demand survey carries 4 anonymised notes, plan said "3-5"

**File:** `docs/adrs/0012-ldap-via-keycloak.md:103-132`
**Issue:** Plan SC #4 said "3-5 anonymised operator notes." File ships 4 (Operators A/B/C/D). Within bounds; informative rather than corrective.
**Fix:** None required. Note for the v3 plan when real conversation notes replace synthetic ones — current count is the floor, not the ceiling.

### IN-02: SPEC `## Operator survey results` section is a 1-line forward-ref

**File:** `.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md:163-165`
**Issue:** Section title "Operator survey results" is slightly aspirational for a 1-line forward-ref to ADR-0012. A reader expecting bullets will hit an indirection. Acceptable per plan (SC #6 of 18-01-PLAN.md line 39 mandates the 1-line forward-ref shape); flagging for v3 in case the team wants to inline a 3-line summary so the SPEC stands alone for offline reading.
**Fix:** Consider 3-line summary inline (e.g. "4 anonymised operators surveyed — Keycloak/Authentik OIDC frontend preferred by 4/4; see ADR-0012 § Operator demand for verbatim notes.") in a Phase 19 SPEC refresh if any.

### IN-03: `compose/test/keycloak.yml` exposes admin credentials in plaintext env

**File:** `compose/test/keycloak.yml:19-20`
**Issue:** `KC_BOOTSTRAP_ADMIN_USERNAME: admin` + `KC_BOOTSTRAP_ADMIN_PASSWORD: admin` are committed in plaintext. This is a **test-only** fixture stub used inside the closed `--profile sso` opt-in, so this is acceptable per security review (no production exposure surface, no port binding to public interface). Flagged because the file name `compose/test/keycloak.yml` is novel and a casual reader might mistake it for production. The header comment block (lines 1-13) does say "test fixture stub" but the `admin/admin` pair will draw scanners. Phase 19 should ensure this file remains test-fixture-only and never gets included from `docker-compose.yml`/production overlays.
**Fix:** No code change. Phase 19 plan should explicitly assert "compose/test/keycloak.yml is never referenced from production compose overlays" as a verifier predicate. Optional: rename admin password to `bootstrap-only-test-fixture` so secret scanners route past it cleanly.

### IN-04: Step-defs file `unused` interface field is a no-op

**File:** `tests/e2e-cjm/steps/sso.steps.ts:11-13`
**Issue:** `interface ScenarioState { unused?: string; }` mirrors `locale.steps.ts:11-13` precedent. The field is never read or assigned; `stateFor(tenantId)` returns an empty object whose only purpose is to seed the `Map`. Pre-existing pattern from Phase 13, not Phase 18 work, but worth noting that when Phase 19 implements the bodies, this interface needs real fields (id_token claims, expected role, etc.). Currently dead by design.
**Fix:** None for Phase 18. Phase 19 19-01 fills in `ScenarioState` with actual fixture state.

### IN-05: 6 pre-existing `@expected-red` Mode-3 offenders surfaced by executor — Phase 17 follow-up

**File:** N/A (pre-existing repository state)
**Issue:** Executor SUMMARY surfaces 6 pre-existing `@expected-red` lint offenders that pre-date Phase 18. Phase 18 introduced ZERO new offenders (verified: `pnpm tsx tools/lint-cjm-doc.ts` exits 0 with the 6 new `@cjm-sso-1.N` tags properly paired). The 6 offenders are likely from Phase 17 TLS scenarios or earlier; they are NOT Phase 18 work.
**Fix:** Open a Phase 17 follow-up issue (or a v3 housekeeping ticket) to either (a) pair the orphan tags with `@after-phase-N` annotations, or (b) drop the `@expected-red` if those scenarios are now GREEN. Phase 18 is not the right place to fix them.

---

## SPEC Quality Audit (SPEC-ldap-keycloak.md)

| Check | Status | Notes |
|---|---|---|
| Line count ≤200 | PASS | 173 lines (27-line slack) |
| SPDX header line 1 | PASS | `<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->` |
| YAML frontmatter | PASS | `phase`, `type: spec`, `status: locked`, `requirements: [SSO-01, SSO-02]` |
| Option (a) vs (b) matrix | PASS | Decision section L47-74; cites ADR-0009 + `auth.ts:39,209`; 4 PITFALLS bullets; v3 LOC estimate ~50-150 vs ~400-800 |
| 5 Better Auth extension points named by exact API path | PASS | `mapProfileToUser`, `databaseHooks.user.create.before`, `update.before`, `create.after`/`update.after`, `account.user_id` FK (L127-133) |
| 7 env vars with loud-fail BYOK | PASS | All 7 listed (L108-116); commentary names v3 call site `lib/oidc-jit-config.ts` (L121) |
| 7 failure modes with rejection codes | PASS | Table L137-145 carries all 7 codes including `400 invalid_oidc_profile` |
| 3 structured log events | PASS | L149-154; cross-refs `audit_log` partitioned table |
| Worked example | PASS | Keycloak realm `acme` id_token claims + env config + resolution (L78-104) |
| Cross-refs to ADR-0009 + PITFALLS §14 | PASS | L52, L169-170 |
| Forward-ref to ADR-0012 | PASS | L161, L165, L171 (3 occurrences) |
| English-only | PASS | No non-English tokens detected |

---

## ADR-0012 Quality Audit

| Check | Status | Notes |
|---|---|---|
| Follows 0000-template.md shape | PASS | Status / Date / Phase / Context / Decision / Consequences / References all present |
| SPDX header lines 1-5 + REUSE-IgnoreStart | PASS | Mirrors 0013-fsl-relicense.md:1-5 |
| File ends with REUSE-IgnoreEnd | PASS | L177 |
| Status block | PASS | accepted / 2026-05-15 / Phase 18 |
| Decision section: option (a) chosen, (b) rejected with 4 PITFALLS bullets | PASS | L41-70 |
| Cites `apps/api/src/auth.ts:209` | PASS | L24, L61 |
| Novel `## Operator demand` section | PASS | L103-132; 4 anonymised operators (A/B/C/D) — IN-01 |
| `## Alternatives considered` table | PASS | L134-141 (verbatim shape from 0013:219) |
| Novel `## Open questions for v3 plan` | PASS | 5 items L143-168 (Keycloak version pin, OIDC_ROLE_MAPPING schema, JIT auto-create policy, LDAP fixture scope, Authentik as 2nd option) |
| Predecessor cross-ref to ADR-0009 | PASS | L67 + L172 `**Predecessor ADR (extended, not superseded):**` (verbatim 0013:240 shape) |
| v3 LOC estimate matches SPEC | PASS | ~50-150 vs ~400-800 — L63-65, identical to SPEC L72-74 |
| English-only | PASS |

---

## Gherkin Quality Audit

| Check | Status | Notes |
|---|---|---|
| 6 scenarios | PASS | One per `@cjm-sso-1.N` for N ∈ {1..6} |
| Tag set per scenario | PASS | All carry `@cjm-sso-1.N @expected-red @after-phase-19 @after-keycloak-up` |
| Feature-level tags | PASS | `@phase-18 @sso` (L17) |
| SPDX header | PASS | L1 |
| Comment-header reword (executor deviation 3) | PASS | Line 14 uses `Error("keycloak SSO ships in Phase 19 — cjm-sso-1.x stays expected-red")` (no `@` prefix in the comment text describing the error string). Rationale: avoids `lint-cjm-doc.ts` Mode-2 false-match if it scanned comment bodies. Verified `FEATURE_TAG_LINE_RE` regex (L63 of linter) only matches lines starting with `\s*@cjm-`, so the executor's caution was unnecessary — but harmless. |
| Gherkin syntax correctness | PASS | Given/When/Then/And properly ordered; quoted strings consistent |
| Semantic alignment with SPEC log events | FAIL | Scenarios 1.2 (WR-01) and 1.6 (WR-02) emit events the SPEC catalogue assigns to different concerns |

---

## Step Defs Audit (`sso.steps.ts`)

| Check | Status | Notes |
|---|---|---|
| SPDX header | PASS | L1 |
| Imports from `../support/world` | PASS | `Given/When/Then` re-exported from world.ts:107 |
| Pending-impl precedent (`locale.steps.ts`) followed | PASS | `Map<string, ScenarioState>` + `stateFor` + `throw new Error(PENDING)` shape identical |
| PENDING constant message | PASS | "keycloak SSO ships in Phase 19 — @cjm-sso-1.x stays @expected-red" |
| Every Given/When/Then verb covered | PASS | Inventoried 17 distinct step regexes vs scenario step bodies; all match. Cucumber-tsx parse-time check satisfied. |
| `tenantId` destructuring + `stateFor` call before throw | PASS | Mirrors locale precedent (avoids "unused parameter" biome lint) |
| Biome-clean | PASS (implicit) | Mirrors `locale.steps.ts` which is biome-clean; ZERO `--no-verify` confirms lefthook ran |

---

## Keycloak Fixture Stub Audit (`compose/test/keycloak.yml`)

| Check | Status | Notes |
|---|---|---|
| Image pin | PASS | `quay.io/keycloak/keycloak:26.0` (exact tag, never `:latest`) |
| KC_BOOTSTRAP_ADMIN_* env (KC 25+ canonical) | PASS | username + password set |
| `KC_HEALTH_ENABLED` / `KC_HTTP_ENABLED` / `KC_HOSTNAME_STRICT` | PASS | L21-23 |
| `command: ["start-dev", "--import-realm"]` | PASS | L24 |
| Healthcheck pattern | PASS | Uses bash `/dev/tcp/127.0.0.1/9000` raw-socket workaround (Keycloak 26 image has no `curl`/`wget`); pings `/health/ready` and greps for `200 OK`. Smart adaptation — deviates from plan's `wget` recipe (plan was unaware of missing curl) but achieves the same goal. NOTE: requires bash; the Keycloak image is ubi-based and ships bash, so this works. |
| Profile-gated | PASS | `profiles: ["sso"]` (L17) — opt-in; default `docker compose up` does not start this service |
| Volume mount | PASS | `./compose/test/keycloak/:/opt/keycloak/data/import:ro` (RO; empty dir for scenario 1.6 loud-fail) |
| Network | PASS | `openwhispr_internal` external network (matches contract-test overlay convention) |
| SPDX header | PASS | L1 |
| YAML correctness | PASS | Parses; no tab/indent issues |
| Security note | INFO | IN-03 — `admin/admin` plaintext credentials are acceptable for test-only fixture |

---

## Customer-Journeys Anchor Audit

| Check | Status | Notes |
|---|---|---|
| 6 `### @cjm-sso-N.M` anchors | PASS | L338/353/365/378/390/402 |
| Format matches existing rows | PASS | Body paragraph + `- Backend error branches:` + `- Silent-failure modes:` sub-lists; mirrors existing 1.1-8.1 shape |
| Anchors properly numbered + ordered | PASS | 1.1 → 1.6 ascending |
| H3 anchor shape matches linter regex | PASS | `### @cjm-sso-1.N Title` matches `ANCHOR_RE` in lint-cjm-doc.ts:60 |
| Mode-1+2+3 linter exit 0 | PASS | `pnpm tsx tools/lint-cjm-doc.ts` → "CJM lint passed: ... (20 anchors)" |
| H2 section heading | FAIL | WR-03 — H2 lacks `## 9.` prefix |

---

## Executor 3 Rule-1 Deviation Assessment

| # | Deviation | Verdict | Notes |
|---|---|---|---|
| 1 | Lowercase commit subjects (`docs(18-01): correct phase-18 ...` etc.) | CORRECT | Repo commitlint contract requires lowercase subject after type/scope; plan-as-written had mixed case in the `SPEC-ldap-keycloak.md` snippet but commitlint would have bounced. Deviation justified. |
| 2 | Dropped `## 9.` H2 prefix from customer-journeys SSO section | INCORRECT (see WR-03) | Rationale was "avoid lint-cjm-doc.ts regex conflict." Linter source at `tools/lint-cjm-doc.ts:60` only matches H3 anchors (`^###\s+@cjm-`); H2 with leading numeric prefix would not have triggered any Mode. SPEC structure flows fine either way, but breaking the visual numbering of sibling sections (1-8) is a regression. RECOMMEND re-adding `## 9.`. |
| 3 | Feature-file comment-header reword (no `@` prefix in PENDING-error narrative) | CORRECT (cautious) | Linter `FEATURE_TAG_LINE_RE` (L63) regex `/^\s*@cjm-/` only fires on line-start `@cjm-`. The executor's reword was harmless caution — would NOT have caused a false-positive but introduces no defect either. |

---

## Constitutional Audit

| Constraint | Status | Evidence |
|---|---|---|
| ZERO `--no-verify` across 4 commits | PASS | Verified via commit message contents; no bypass markers; lefthook would have stamped commit if skipped |
| No production code | PASS | Diff stat: only `.md`, `.feature`, `.ts` (test-only step defs), `.yml` (test fixture), `.gitkeep` |
| English-only | PASS | grep for Cyrillic/non-ASCII in committed files returns clean |
| Atomic commits | PASS | Wave 1 → 2 → 3 → 4; Wave 4 atomicity (5 paths in 1 commit) honoured per `git show edd69e3 --stat` |
| TDD | N/A | SPEC + ADR + RED scenarios are non-code artefacts; per CONTEXT.md scope_guardrail |
| Coverage ≥ 90/90/90/90 | N/A | No production code touched |
| `compose/test/` novelty | PASS | First per-test compose directory; `.gitkeep` correctly anchors empty `compose/test/keycloak/` (verified `ls -la` returns the file) |

---

## Phase Verdict

**APPROVE-WITH-FOLLOWUP.**

Phase 18 closes the v2 milestone correctly: SPEC + ADR-0012 + RED Gherkin scaffolding + Keycloak fixture stub + customer-journeys anchors all land per the plan, the CJM linter exits 0, the SPEC respects the 200-line cap, and the ADR carries the PITFALLS §14-mandated operator-demand survey.

Followup items (none block merge — all are Phase 19 / housekeeping tickets):

1. **WR-01** — fix scenario 1.2 audit-event semantics (either add 4th log event to SPEC or rewrite scenario) in Phase 19 19-01.
2. **WR-02** — disambiguate `sso.jit.rejected` between boot-time and request-time codepaths (add 8th failure mode or separate boot-validation subsection) in Phase 19 19-01.
3. **WR-03** — re-add `## 9.` prefix to `customer-journeys.md` SSO section as a 1-line docs follow-up commit.
4. **IN-05** — open Phase 17 follow-up issue for the 6 pre-existing `@expected-red` Mode-3 offenders.

---

_Reviewed: 2026-05-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## WR-03 Disputation (added 2026-05-15 after code-fixer empirical test)

**Status:** DISPUTED — reviewer rationale incorrect, executor deviation #2 was substantively right.

**Evidence (code-fixer dry-run):**

The reviewer claimed `tools/lint-cjm-doc.ts:60` only scans H3 anchors. Empirical test of re-adding `## 9. SSO via Keycloak (after-phase-19)` H2 prefix produced:

```
CJM lint violation: 1 offender(s).
  docs/customer-journeys.md:1:1  section 9 has 0 anchor(s); expected ≥ 2 (happy + at least one negative twin)
EXIT=1
```

**Root cause:** `lint-cjm-doc.ts` uses TWO regexes (not one):
- `ANCHOR_RE = /^###\s+@cjm-(\d+)\.(\d+)\s+(.+)$/gm` — capture group is digits-only; rejects `@cjm-sso-N.M` namespaced anchors entirely
- `SECTION_HEADING_RE = /^##\s+(\d+)\.\s+/gm` — H2 scanner; activates section-anchor-pairing requirement

When `## 9.` H2 is present, linter requires ≥2 anchors with major `9` in the section. The `@cjm-sso-1.N` anchors are opaque (digits-only capture excludes them). Result: section 9 has 0 anchors → linter exit 1.

**Executor's deviation #2 was correct, even though the executor's published rationale ("avoid linter false-positive") pointed at the wrong regex. The fix path requires either:**
1. Extending `ANCHOR_RE` to accept namespaced anchors (Phase 19 territory — touches linter logic)
2. Renaming SSO anchors to `@cjm-9.M` (loses semantic namespace)

**Action:** WR-03 promoted from "1-line followup" to Phase 19 followup alongside WR-01 + WR-02. Phase 18 customer-journeys.md `## SSO via Keycloak (after-phase-19)` heading stays as-is.

**Verifier note:** this dispute strengthens the verifier's `passed_spec_only` verdict — Phase 18 correctly identified and worked around a linter limitation that Phase 19 must address before SSO anchors can be lint-tracked.
