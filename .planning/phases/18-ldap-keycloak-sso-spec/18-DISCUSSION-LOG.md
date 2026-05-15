# Phase 18 — Discussion Log

**Date:** 2026-05-15
**Mode:** discuss (advisor-style; 4 parallel `gsd-advisor-researcher` agents)
**User pacing:** yolo — full acceptance of all 4 research recommendations

## Gray areas selected

User selected ALL four researched gray areas:
1. Option (a) Keycloak/Authentik OIDC frontend vs (b) direct LDAP plugin
2. JIT user provisioning + Better Auth lifecycle hooks (SSO-02 spec content)
3. Red Cucumber scenarios + Keycloak fixture stub (SSO-03)
4. Plan split + ROADMAP cleanup

Plus Q0 corrections surfaced during orchestrator scout: ADR-0012 slot gap (sequence 0011 → 0013) + ROADMAP §Phase 18 "Plans:" list copy-paste error (shows 17-0X-PLAN.md filenames).

## Questions asked and decisions made

### Q1. Option (a) vs (b)

**Options presented:**
- (a) Keycloak/Authentik OIDC frontend over corporate LDAP (ROADMAP-recommended)
- (b) Direct LDAP via `ldapts 8.1.7` + custom Better Auth plugin

**User selected:** (a) Keycloak/Authentik OIDC frontend.

**Rationale recorded:** Decision is essentially pre-locked. `apps/api/src/auth.ts:39,209` already wires `genericOAuth` (Phase 02 ADR-0009 names "Keycloak / Authentik / Azure AD / Okta / Google" by name). PITFALLS.md flags option (b) in 4 separate sections (performance trap, security trap, recovery-HIGH cost, SPEC-bloat magnet). v3 LOC: ~50-150 (option a) vs 400-800 (option b). Option (a) inherits Keycloak's SAML/Kerberos/MFA/social-login surface for free; option (b) is LDAP-only. CLAUDE.md "boring/well-staffed stack" constraint: option (a) keeps the auth surface boring (config + docs); option (b) requires OpenWhispr to OWN a custom Better Auth plugin without community upstream.

Researcher delivered a ready-to-commit ADR-0012 "Decision" section (drops into the template verbatim).

### Q2. JIT user provisioning spec (SSO-02)

**Spec content locked:**

- 5 Better Auth extension points named by exact API path (genericOAuth.mapProfileToUser, databaseHooks.user.{create,update}.{before,after}, account.user_id existing)
- 7 env vars (loud-fail BYOK pattern): OIDC_TENANT_CLAIM, OIDC_TENANT_MAPPING, OIDC_GROUP_CLAIM, OIDC_ROLE_MAPPING, OIDC_ROLE_PRIORITY, OIDC_DEFAULT_ROLE, OIDC_REVOCATION_MODE
- 7 failure modes (rejection codes: forbidden_missing_tenant_claim, forbidden_unknown_tenant, forbidden_no_role_mapping, forbidden_tenant_mismatch, invalid_oidc_profile + 2 internal recovery flows)
- 3 structured log events (sso.jit.user.created, sso.jit.role.updated, sso.jit.rejected) + matching audit_log rows
- Worked example with Keycloak realm `acme` claims showing tenant=acme + role=member resolution

**v3 LOC estimate:** ~355 prod + ~1060 test (3:1 ratio matching Phase 02/12 precedent). NO schema migration required (users.tenant_id, users.role, account.provider_id+account_id+tenant_id UNIQUE all already in place).

**User selected:** accepted as-is.

### Q3. Red Cucumber scenarios + Keycloak fixture (SSO-03)

**Scenario suite locked: 6 scenarios** in `tests/e2e-cjm/features/sso/keycloak-oidc.feature`:
1. `@cjm-sso-1.1` First-time JIT user creation
2. `@cjm-sso-1.2` Returning user claim re-sync
3. `@cjm-sso-1.3` Group-to-role downgrade
4. `@cjm-sso-1.4` Tenant from email domain claim
5. `@cjm-sso-1.5` Cross-tenant RLS isolation
6. `@cjm-sso-1.6` Loud-fail on missing realm

**Tag scheme:** `@phase-18 @sso @cjm-sso-N.M @expected-red @after-phase-19 @after-keycloak-up`

**CRITICAL constraint surfaced:** `tools/lint-cjm-doc.ts:198` Mode-3 enforces `@expected-red` paired with `@after-phase-N`. Phase 18 must use `@after-phase-19`.

**Step defs:** `tests/e2e-cjm/steps/sso.steps.ts` — all impls `throw new Error("...")` (pending-impl precedent from `locale.steps.ts`). Prevents spurious GREEN.

**Fixture stub:** `compose/test/keycloak.yml` — Keycloak 26 (`quay.io/keycloak/keycloak:26.0`), `KC_BOOTSTRAP_ADMIN_*` env (26+ canonical; 25's `KEYCLOAK_ADMIN_*` deprecated), healthcheck on management port 9000, empty `./keycloak/` import dir (intentional — scenario 1.6 fails correctly).

**`SSO=1` Makefile switch DEFERRED to v3 (Phase 19)** — keeps Phase 18 scope clean. v3's 19-01 PR adds the switch alongside the realm import JSON.

**docs/cjm.md update:** 6 new rows for the scenarios with `@after-phase-19` annotation (lint-cjm-doc mode-3 requirement). Lands in Wave 4.

**User selected:** accepted as-is.

### Q4. Plan split + ROADMAP cleanup

**Options presented:**
- Option A — 1 plan (everything in `18-01-PLAN.md`)
- Option B — 2 plans (SPEC+ADR / Gherkin+fixture)
- Option C — 3 plans (SPEC / ADR+survey / Gherkin+fixture)

**User selected:** Option A.

**Rationale recorded:** Phase 18 is the smallest phase in v2 (5 reqs, all documentation). Phase 16 used 2 plans for code; Phase 17 used 3 plans for code; Phase 18 has no production code. Decomposing 5 artefacts across 2-3 plans creates orchestration overhead exceeding the work itself. ROADMAP cleanup lands inside Wave 1 per Phase 16 16-02 precedent (ROADMAP wording fixes absorbed inside a plan, not as scope-creep PR).

**Commit shape: 4 atomic waves:**
- Wave 1: ROADMAP cleanup (`Plans:` list fix + ADR-0012 slot note)
- Wave 2: SPEC-ldap-keycloak.md (≤200L) — option matrix + JIT spec
- Wave 3: ADR-0012 + operator-demand survey embedded
- Wave 4: Gherkin scenarios + Keycloak fixture stub + docs/cjm.md rows

**`--no-verify` prediction: 0** — only `.md`/`.feature`/`.yml` touched (outside biome glob). Phase 16+17 confirmed pattern.

## Deferred ideas

1. v3 implementation phase (Phase 19) — 4 PRs roll out 6 RED scenarios + Makefile `SSO=1` switch
2. Authentik as second-class option — documented in SPEC, fixture deferred until paying customer asks
3. Direct LDAP via `ldapts` — option (b) rejected; no v3 plans
4. SAML / Kerberos / social-login / MFA — inherited from Keycloak/Authentik; out of scope for OpenWhispr
5. Tenant auto-provisioning — explicitly rejected
6. `compose/test/keycloak/realm-openwhispr-test.json` + `scripts/seed-keycloak-realm.sh` — v3 (Phase 19)
7. AD vs 389DS support — v3 fixture scope = OpenLDAP only

## Research artifacts

All 4 advisor researchers returned findings inline (per "do not write summary md" instruction). Key findings embedded in CONTEXT.md `<decisions>`.

- Option (a) vs (b) researcher: Option (a) pre-locked; ready-to-commit ADR-0012 Decision section authored inline
- JIT spec researcher: Exact Better Auth API paths + 7 env vars + 7 failure modes + 3 audit events + worked example + v3 LOC estimate (355 prod + 1060 test)
- Red scenarios researcher: 6 scenario sketches + Keycloak 26 fixture YAML (ready-to-commit) + Makefile `SSO=1` switch deferred to v3 + docs/cjm.md row requirements
- Plan split researcher: Option A (1 plan, 4 waves) + ROADMAP cleanup task list + zero `--no-verify` prediction

## Claude's discretion items (no user input requested)

- `SSO=1` Makefile switch DEFERRED to v3 — keeps Phase 18 boundary clean (Phase 19 PR 19-01 owns it)
- Operator-demand survey EMBEDDED in ADR-0012 (not separate `SURVEY.md`) — SC #4 wording supports this
- Keycloak 26 pin (Authentik documented as alternative; fixture deferred)
- ROADMAP cleanup in Wave 1 (FIRST commit) — fixes gap before downstream waves reference Phase 18 plan filename
- ADR-0012 "Open questions for v3 plan" section (5 items) gives Phase 19 planner a clear backlog
- v3 = Phase 19 (ROADMAP doesn't yet have Phase 19 entry; v3 milestone planning is post-Phase-18 work)
