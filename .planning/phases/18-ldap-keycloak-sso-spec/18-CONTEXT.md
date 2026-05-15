# Phase 18 — Context

**Phase:** 18 — LDAP / Keycloak SSO — SPEC + ADR Only (v2 — NO code; v3 implements)
**Date captured:** 2026-05-15
**Mode:** discuss (advisor-style research-backed; 4 parallel `gsd-advisor-researcher` agents)
**Locked requirements:** SSO-01..05 (5 reqs from REQUIREMENTS.md lines 505-509)

<domain>
Phase 18 closes v2 with a documented, reviewed path to enterprise SSO. ZERO production code lands in v2. Operators evaluating self-host see:
- A SPEC ≤200 lines comparing Keycloak/Authentik OIDC frontend (option a) vs direct LDAP plugin (option b)
- An ADR (0012) capturing the decision + operator-demand survey
- 6 RED Gherkin scenarios staying skipped pending v3 implementation
- A Keycloak fixture stub that v3 boots via `make e2e-cjm SSO=1`

Implementation surface (v3, deferred): ~355 LOC production + ~1060 LOC tests, NO Better Auth surgery (genericOAuth plugin already wired since Phase 02 ADR-0009).
</domain>

<roadmap_corrections>

**CRITICAL — Phase 18 ROADMAP has two gaps that 18-01 Wave 1 fixes:**

1. **Plans-list copy-paste error.** ROADMAP §Phase 18 "Plans:" list currently shows `17-01-PLAN.md / 17-02-PLAN.md / 17-03-PLAN.md` (verbatim from Phase 17). Phase 18 plan filename is `18-01-PLAN.md` (Option A single-plan split).

2. **ADR-0012 slot reserved.** SC #4 says `docs/adrs/0012-ldap-via-keycloak.md`, but ADR sequence on disk is `0011 → 0013` (Phase 15 FSL relicense took 0013). 0012 is free; Phase 18 occupies it. Wave 1 commit body notes this explicitly so future readers don't search for a non-existent 0012.

</roadmap_corrections>

<canonical_refs>

**MANDATORY reads for downstream agents:**

- `.planning/ROADMAP.md` — Phase 18 entry + 5 success criteria
- `.planning/REQUIREMENTS.md` lines 505-509 — SSO-01..05
- `.planning/PROJECT.md` — core value + enterprise constraints
- `.planning/STATE.md` — milestone state (Phase 17 closed 2026-05-15)
- `.planning/research/PITFALLS.md` §14 (operator-demand survey prerequisite) + §"Performance Traps" / §"Security" / §"Recovery Strategies" rows that flag option (b) as a trap
- `CLAUDE.md` — TDD, ≥90/90/90/90 coverage, English-only, atomic commits, "boring/well-staffed stack"
- `apps/api/src/auth.ts:39,209` — existing `genericOAuth` plugin wiring (proves option (a) "zero surgery" claim)
- `docs/adrs/0009-better-auth-email-password-and-oidc-plugin.md` — pre-existing OIDC commitment ("Keycloak / Authentik / Azure AD / Okta / Google" named by name)
- `packages/data/migrations/0000_initial.sql` + `0001_better_auth.sql` + `0017_setup_state.sql` — user/account/tenant schema that JIT spec references (no migration needed)
- `Makefile` lines 439-477 — `e2e-cjm` target + `--grep-invert "@expected-red"` filter (new `SSO=1` switch lands here in v3, NOT Phase 18)
- `tools/lint-cjm-doc.ts` Mode-3 `--check-expected-red` — enforces `@expected-red` + `@after-phase-N` pairing
- `tests/e2e-cjm/features/phase17-tls.feature` — most recent skeleton scenario shape (Phase 17)
- `tests/e2e-cjm/features/locale-switch.feature` — skip-tag precedent
- `tests/e2e-cjm/steps/locale.steps.ts` — pending-impl `throw new Error` precedent

</canonical_refs>

<code_context>

**Existing state (post-Phase-17 close):**

Better Auth:
- `apps/api/src/auth.ts:39` imports `genericOAuth` from `better-auth/plugins/generic-oauth`
- `auth.ts:199-215` registers `genericOAuth({...})` when `readOidcProvidersForRegistration()` returns ≥1 provider
- Env triple: `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (auth.ts L11-13)
- `additionalFields.role` already exists (Phase 12 admin onboarding) with `input: false` — JIT writes server-side, never via OAuth body

Schema:
- `users.tenant_id NOT NULL` (Phase 1 multi-tenancy)
- `users.role` nullable text (Phase 12)
- `account.provider_id + account_id + tenant_id UNIQUE` (Phase 02 — JIT idempotency anchor)
- audit_log partitioned (Phase 14)

CJM harness:
- `tools/lint-cjm-doc.ts` Mode-3 enforces `@expected-red` pairs with `@after-phase-N`
- `Makefile:466` `make e2e-cjm` runs `playwright test --grep-invert "@expected-red"` (default lane skips red)

ADRs:
- `docs/adrs/` contains 0000-0011 + 0013 (Phase 15 FSL); 0012 slot reserved for Phase 18

</code_context>

<decisions>

### Q1 — Option (a) vs (b): **Option (a) Keycloak/Authentik OIDC frontend (LOCKED)**

The decision is essentially pre-committed:

- ADR-0009 (Phase 02) already names "Keycloak / Authentik / Azure AD / Okta / Google" as the upstream IdP set
- `apps/api/src/auth.ts:209` already wires `genericOAuth` — corporate operators set env triple, no code change
- PITFALLS.md flags option (b) in 4 separate sections:
  - §14 SPEC-bloat magnet
  - Integration Gotchas row: `ldapjs` bind blocks auth-pool
  - Performance Traps row: "p95 200ms → 2s at ~50 concurrent auth requests"
  - Security row: "LDAP creds in env file; Keycloak keeps them inside its connection pool"
  - Recovery Strategies row: "LDAP via in-request bind shipped → HIGH cost, deprecate over 2 releases"
- CLAUDE.md "boring/well-staffed stack" constraint: option (b) requires OpenWhispr to OWN a custom Better Auth plugin (no community upstream); option (a) is config + docs

**v3 implementation surface for option (a):**
- New optional `keycloak` service in `compose/sso.yml` behind `--profile sso` (~30 LOC)
- `docs/oidc-operator-config.md` extension with "Keycloak fronts your LDAP" recipe (~50 LOC)
- OIDC `groups` claim → `users.role` projection documentation (~20 LOC)
- One e2e test booting Keycloak + OpenLDAP federation + asserting JIT provisioning (~250 LOC test)
- **`apps/api/src/auth.ts` is not modified** — `genericOAuth` already covers the surface

Total: ~50-150 LOC compose + docs (vs ~400-800 LOC custom plugin + ldapts integration for option b).

**ADR-0012 ships a ready-to-commit decision section** (research output) that drops into the template.

### Q2 — JIT user provisioning spec (SSO-02): exact Better Auth extension points

**Better Auth extension points (named, not implemented):**

| Concern | Better Auth API |
|---|---|
| Claim → user-field projection | `genericOAuth({ config: [{ ..., mapProfileToUser: (profile) => ({...}) }] })` |
| Initial role + tenant assignment on JIT create | `databaseHooks.user.create.before(entity, ctx)` — returns `{ data: { ...entity, role, tenantId } }` |
| Per-sign-in role re-sync | `databaseHooks.user.update.before(entity, ctx)` |
| Audit emission | `databaseHooks.user.create.after` + `databaseHooks.user.update.after` |
| Multi-OAuth → single user linkage | Existing `account.user_id` foreign key (no new code) |

**Env-config surface (7 vars, loud-fail BYOK pattern):**

- `OIDC_TENANT_CLAIM` (required) — one of `email_domain` or claim name
- `OIDC_TENANT_MAPPING` (required when claim ≠ `email_domain`) — JSON map
- `OIDC_GROUP_CLAIM` (optional, default `groups`)
- `OIDC_ROLE_MAPPING` (optional) — JSON: `{"openwhispr-admins": "admin", ...}`
- `OIDC_ROLE_PRIORITY` (optional, default `admin > member > viewer`)
- `OIDC_DEFAULT_ROLE` (optional, default `null` = reject when no group matches)
- `OIDC_REVOCATION_MODE` (optional, default `downgrade_to_default`)

Boot-time loud-fail in `lib/oidc-jit-config.ts` (v3 file), mirroring existing `OIDC_ISSUER_URL` triplet validation in `lib/oidc-providers.ts`.

**Worked example (drops into SPEC):**

Keycloak id_token claims:
```
sub: f47ac10b-58cc-...
email: alice@acme.example
name: Alice Engineer
groups: ["openwhispr-engineering", "okta-everyone"]
iss: https://sso.acme.example/realms/acme
```

Env config:
```
OIDC_TENANT_CLAIM=email_domain
OIDC_TENANT_MAPPING={"acme.example":"acme"}
OIDC_GROUP_CLAIM=groups
OIDC_ROLE_MAPPING={"openwhispr-admin":"admin","openwhispr-engineering":"member"}
OIDC_DEFAULT_ROLE=null
```

Resolution: tenant `acme`, role `member`, audit event `sso.jit.user.created`.

**7 failure modes** (rejection codes documented in SPEC):
1. Tenant claim missing → `403 forbidden_missing_tenant_claim` (NOT auto-create)
2. Tenant claim unmapped → `403 forbidden_unknown_tenant` (operators onboard explicitly)
3. Group claim missing + no default role → `403 forbidden_no_role_mapping`
4. Multiple group matches → `OIDC_ROLE_PRIORITY` resolves deterministically
5. Returning user, admin group removed → `downgrade_to_default` rewrites + audit event
6. Returning user, tenant claim changed → `403 forbidden_tenant_mismatch` (RLS invariant)
7. `mapProfileToUser` throws → `400 invalid_oidc_profile` (claim shape diff logged, no PII)

**3 structured log events** (Phase 02 logger contract): `sso.jit.user.created` / `sso.jit.role.updated` / `sso.jit.rejected` — plus matching `audit_log` rows.

**v3 LOC estimate:** ~355 prod + ~1060 test (3:1 ratio matching Phase 02/12 precedent). NO schema migration required.

### Q3 — Red Cucumber scenarios + Keycloak fixture stub (SSO-03)

**File:** `tests/e2e-cjm/features/sso/keycloak-oidc.feature`

**Tag scheme:** `@phase-18 @sso @cjm-sso-N.M @expected-red @after-phase-19 @after-keycloak-up`

CRITICAL constraint surfaced by researcher: `tools/lint-cjm-doc.ts:198` Mode-3 enforces `@expected-red` paired with `@after-phase-N`. Phase 18 uses `@after-phase-19` (v3 closes them).

**6 scenarios (sketches in SPEC):**

1. `@cjm-sso-1.1` First-time JIT user creation from OIDC ID token
2. `@cjm-sso-1.2` Returning OIDC user has name/email re-synced from claims
3. `@cjm-sso-1.3` Group-to-role downgrade revokes admin on next sign-in
4. `@cjm-sso-1.4` Tenant assignment derived from email domain claim
5. `@cjm-sso-1.5` Cross-tenant isolation — RLS blocks tenant A user from tenant B rows
6. `@cjm-sso-1.6` Loud-fail when Keycloak provider config references missing realm

**Step defs file:** `tests/e2e-cjm/steps/sso.steps.ts` — all impls `throw new Error("keycloak SSO ships in Phase 19 — @cjm-sso-N.M stays @expected-red")` (mirrors `locale.steps.ts` pending-impl precedent). Prevents spurious GREEN if anyone strips `--grep-invert`.

**Fixture stub:** `compose/test/keycloak.yml` (ready-to-commit YAML, ~25 lines):
- Keycloak 26 image (`quay.io/keycloak/keycloak:26.0`)
- `KC_BOOTSTRAP_ADMIN_*` env (Keycloak 25+ canonical; `KEYCLOAK_ADMIN_*` deprecated in 26)
- `command: ["start-dev", "--import-realm"]`
- Healthcheck on `/health/ready` (port 9000)
- `./keycloak/` import directory empty in v2 (intentional — scenario 1.6 fails for the right reason)

**`SSO=1` switch is NOT authored in Phase 18.** Phase 18 ships the fixture stub + scenarios; v3 (Phase 19) authors the Makefile switch as part of `19-01-PLAN.md`. This keeps v2 phase boundary clean: Phase 18 = SPEC + scaffolding, Phase 19 = wiring.

**docs/cjm.md update:** 6 new rows for `@cjm-sso-N.M` with `@after-phase-19` annotation (else `lint-cjm-doc.ts --check-expected-red` fails). Lands in Wave 4 commit.

### Q4 — Plan split + commit strategy: **Option A (1 plan, 4 atomic waves)**

**Single plan `18-01-PLAN.md`. Four atomic waves (each = 1 commit cluster).**

| Wave | Concern | Files | Reqs closed |
|------|---------|-------|-------------|
| 1 | ROADMAP cleanup | `.planning/ROADMAP.md` (Phase 18 plans-list fix; ADR-0012 slot note) | (cleanup; not a SSO req) |
| 2 | SPEC artefact | `.planning/phases/18-ldap-keycloak-sso-spec/SPEC-ldap-keycloak.md` (≤200L: option matrix + JIT spec + Better Auth hook names) | SSO-01, SSO-02 |
| 3 | ADR + survey | `docs/adrs/0012-ldap-via-keycloak.md` (~120L: decision + operator-demand survey embedded) | SSO-04, SSO-05 |
| 4 | Gherkin + fixture | `tests/e2e-cjm/features/sso/keycloak-oidc.feature` + `tests/e2e-cjm/steps/sso.steps.ts` + `compose/test/keycloak.yml` + `docs/cjm.md` (6 new rows) | SSO-03 |

**Total:** 4 commits, 1 plan, ~5-6 artefacts.

**`--no-verify` policy: ZERO predicted.** Phase 18 touches only `.md`, `.feature`, and `.yml` — all outside biome glob. Phase 16 + 17 confirmed zero `--no-verify`. Prediction holds. HALT-and-escalate semantics if lefthook fires unexpectedly.

**No file-conflict risk between waves.** Strict sequential within the plan.

### Q5 (Claude's discretion — no user input requested)

- `SSO=1` Makefile switch DEFERRED to v3 (Phase 19) per researcher recommendation — keeps Phase 18 scope clean
- Operator-demand survey EMBEDDED in ADR-0012 (not separate `SURVEY.md`) — SC #4 wording supports this
- Keycloak 26 pin (not Authentik) — researcher noted Keycloak is de-facto OSS IdP; Authentik documented as alternative in SPEC but not fixture
- ROADMAP cleanup lands in Wave 1 (FIRST commit of the plan) — fixes the gap before downstream waves reference Phase 18 plan filename
- ADR-0012 "Open questions for v3 plan" section lists 5 items (Keycloak version pin, group→role exact format, JIT auto-create policy, LDAP server scope for fixture, Authentik documented option) — gives v3 planner a clear backlog

</decisions>

<deferred>

NOT in Phase 18 scope (v3 territory):

1. **v3 implementation phase (Phase 19)** — 4 PRs roll out the 6 RED scenarios:
   - 19-01: `@cjm-sso-1.1` + `@cjm-sso-1.4` (JIT user + tenant from domain) + Makefile `SSO=1` switch
   - 19-02: `@cjm-sso-1.2` + `@cjm-sso-1.3` (returning sync + role downgrade)
   - 19-03: `@cjm-sso-1.5` (RLS isolation)
   - 19-04: `@cjm-sso-1.6` (loud-fail bad realm)
2. **Authentik as second-class option** — documented in SPEC, fixture deferred until paying customer asks
3. **Direct LDAP via `ldapts`** — option (b) rejected; no v3 plans
4. **SAML / Kerberos / social-login** — inherited from Keycloak/Authentik via OIDC; out of scope for any OpenWhispr phase
5. **MFA** — inherited from upstream IdP; no OpenWhispr surface
6. **Tenant auto-provisioning** — explicitly rejected ("operators onboard explicitly")
7. **`compose/test/keycloak/realm-openwhispr-test.json`** + `scripts/seed-keycloak-realm.sh` — v3 (Phase 19) artefacts; Phase 18 fixture stub references them by name only
8. **AD vs 389DS support** — v3 fixture scope = OpenLDAP only

</deferred>

<scope_guardrail>

**Phase 18 boundary FIXED by ROADMAP.md:**
- IN scope: SSO-01..05 — exactly 5 requirements (SPEC + ADR + Gherkin stubs + fixture stub + survey)
- IN scope: ROADMAP Phase 18 plans-list cleanup (1-line block edit; in Wave 1 commit)
- IN scope: ADR-0012 slot occupation (numbering note in Wave 1 commit body)
- IN scope: `docs/cjm.md` rows for 6 new `@cjm-sso-N.M` scenarios (Wave 4 commit)
- OUT of scope: ZERO production code; ZERO Better Auth changes; ZERO Makefile changes; ZERO compose service additions beyond fixture stub; v3 (Phase 19) territory

This phase closes v2 milestone. After Phase 18 merges, v2 ROADMAP shows all phases complete (modulo any phase-level gaps that may surface).

</scope_guardrail>

<next_steps>

1. `/gsd-plan-phase 18` — gsd-planner reads CONTEXT + REQUIREMENTS + ROADMAP + research artefacts; produces `18-PATTERNS.md`, `18-01-PLAN.md` (single plan, 4 waves), `18-PLAN-CHECK.md`.
2. `/gsd-execute-phase 18` — Wave 1 → 2 → 3 → 4 (strict sequential within single plan; no parallelism). Predicted 0 `--no-verify`.
3. `/gsd-verify-phase 18` — verifier checks SSO-01..05 met, SPEC ≤200L, ADR-0012 exists, 6 RED scenarios authored with correct tags, fixture stub committable.
4. `/gsd-code-review` — review SPEC + ADR + Gherkin + fixture. (No code → narrower review surface than Phase 17.)

</next_steps>
