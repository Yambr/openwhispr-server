<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# Phase 69: SSO JIT provisioning + live-Keycloak e2e — Specification

**Created:** 2026-05-29
**Ambiguity score:** 0.14 (gate: ≤ 0.20)
**Requirements:** 7 locked

## Goal

An operator who provisions a Keycloak realm and sets the OIDC env triple can have corporate users sign in via SSO and be **automatically provisioned** with the correct tenant + role derived from their id_token claims — proven by a GREEN end-to-end login against a **live Keycloak container** in CI, plus the six `@cjm-sso-1.*` scenarios flipping from `@expected-red` to GREEN.

## Background

Custom OIDC login is **already wired** on `main`: `apps/api/src/auth.ts:337,370-380` registers Better Auth's `genericOAuth` plugin conditionally on the `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` triple, and `apps/api/src/lib/oidc-providers.ts` is the env-reading source of truth (public `listConfiguredOidcProviders` + registration-config `readOidcProvidersForRegistration`). `GET /api/auth/providers` advertises the provider; the desktop bearer-mint path (`routes/desktop-signin.ts`, `lib/mint-bearer.ts`, `routes/auth-callback.ts`) is unit-tested.

What does **NOT** exist today (verified by grep — zero production hits for `mapProfileToUser|OIDC_TENANT_CLAIM|OIDC_ROLE_MAPPING|sso.jit|oidc-jit`):

1. **JIT provisioning code.** No claim→tenant or claim→role mapping. A first-time OIDC user has no deterministic tenant/role assignment logic.
2. **`apps/api/src/lib/oidc-jit-config.ts`** — the v3 call-site named by `SPEC-ldap-keycloak.md:121`. Does not exist.
3. **Real `@cjm-sso-1.*` step-defs.** `tests/e2e-cjm/steps/sso.steps.ts` is all stubs — every step throws `Error("keycloak SSO ships in Phase 19 — @cjm-sso-1.x stays @expected-red")`. The 6 scenarios in `tests/e2e-cjm/features/sso/keycloak-oidc.feature` carry `@expected-red @after-phase-19 @after-keycloak-up`.
4. **Realm-import + seed.** `compose/test/keycloak/` holds ONLY `.gitkeep` (intentionally empty so `@cjm-sso-1.6` loud-fail-on-empty-realm stays valid). No `realm-openwhispr-test.json`, no `scripts/seed-keycloak-realm.sh`. The `compose/test/keycloak.yml` fixture (Keycloak 26.0, `start-dev --import-realm`, `--profile sso`, ports 8089/9000) names these two files as the Phase 19 deliverable in its header comment.

The SPEC for the surface is fully written (`SPEC-ldap-keycloak.md`): 7 env vars, 5 Better Auth extension points, 7 rejection codes, 3 structured log events, a worked Keycloak `acme` example. Phase 69 implements that spec — it does not re-design it.

## Requirements

1. **JIT env-config module (SSO-IMPL-02)**: A new `apps/api/src/lib/oidc-jit-config.ts` reads + validates the 7 JIT env vars with loud-fail BYOK semantics, mirroring the triplet-validation shape of `lib/oidc-providers.ts`.
   - Current: file does not exist; no JIT env is read anywhere
   - Target: exports a `readJitConfig(env)` returning a validated config object (`tenantClaim`, `tenantMapping`, `groupClaim`, `roleMapping`, `rolePriority`, `defaultRole`, `revocationMode`); JIT silently disables when `OIDC_TENANT_CLAIM` is unset; boot-time fail-fast (non-zero exit) on malformed `OIDC_TENANT_MAPPING`/`OIDC_ROLE_MAPPING` JSON
   - Acceptance: unit tests cover all 7 vars × (present / absent / malformed) permutations; malformed JSON triggers a fail-fast exit path; coverage ≥ 90/90/90/90 on the new file

2. **Claim→tenant+role resolution (SSO-IMPL-01)**: A pure resolver maps id_token claims to a `{tenantId, role}` decision or a typed rejection, per the SPEC failure-mode table.
   - Current: no resolution logic exists
   - Target: a pure function takes (claims, jitConfig) → `{tenantId, role}` on success OR one of the 7 typed rejections; `email_domain` tenant-claim mode + named-claim mode both supported; `OIDC_ROLE_PRIORITY` tie-breaks multiple group matches; `OIDC_DEFAULT_ROLE=null` rejects when no group maps
   - Acceptance: unit tests assert the worked `acme` example (tenant `acme`, role `member`), all 7 rejection codes, multi-group tie-break, and the revocation downgrade; pure (no I/O), 100% branch on the decision tree

3. **Better Auth extension points wired (SSO-IMPL-03)**: The 5 Better Auth hooks named in the SPEC are registered in `auth.ts`, calling the resolver.
   - Current: `genericOAuth` is registered with `config: [...oidcProviders]` and NO `mapProfileToUser`, NO `databaseHooks` for JIT
   - Target: `mapProfileToUser` projects claims; `databaseHooks.user.create.before` assigns tenant+role on JIT create; `databaseHooks.user.update.before` re-syncs role per sign-in; `databaseHooks.user.create.after` + `user.update.after` emit audit; multi-OAuth linkage via existing `account.user_id` (no new code)
   - Acceptance: integration test against real Postgres + PgBouncer + Valkey (testcontainers, no internal mocks) drives a simulated OIDC profile through the hooks and asserts the `User` row's `tenantId`/`role`; existing auth tests stay GREEN

4. **Rejection codes + structured logs + audit (SSO-IMPL-04)**: All 7 rejection codes return the correct HTTP status, and the 3 structured log events each write a matching `audit_log` row.
   - Current: none exist
   - Target: `403 forbidden_missing_tenant_claim` / `403 forbidden_unknown_tenant` / `403 forbidden_no_role_mapping` / `403 forbidden_tenant_mismatch` / `400 invalid_oidc_profile` returned on the matching trigger; `sso.jit.user.created` / `sso.jit.role.updated` / `sso.jit.rejected` emitted with NO PII; each writes an `audit_log` row (Phase 14 partitioned table)
   - Acceptance: tests assert each code on its trigger, each log event fires with no PII leak, and an `audit_log` row is written per event

5. **Live-Keycloak realm-import + seed (SSO-IMPL-05a)**: `compose/test/keycloak` gains a realm-import JSON + seed script in a path SEPARATE from the empty `.gitkeep` dir.
   - Current: `compose/test/keycloak/` holds only `.gitkeep`; `@cjm-sso-1.6` depends on that emptiness
   - Target: `realm-openwhispr-test.json` (realm `acme`, client `openwhispr-backend`, a test user with `groups` + `email` claims) + `scripts/seed-keycloak-realm.sh` live in a path that does NOT populate the empty import dir `@cjm-sso-1.6` checks; the fixture mounts the realm only for the positive scenarios
   - Acceptance: `docker compose -f docker-compose.yml -f compose/test/keycloak.yml --profile sso up -d keycloak` boots healthy AND the realm `acme` is importable; `@cjm-sso-1.6` (empty-realm loud-fail) still resolves correctly

6. **Six `@cjm-sso-1.*` scenarios GREEN (SSO-IMPL-05b)**: The stub step-defs are replaced with real wire-level implementations and all 6 scenarios pass against the live Keycloak.
   - Current: every step in `sso.steps.ts` throws the PENDING error; 6 scenarios are `@expected-red`
   - Target: `sso.steps.ts` drives real OIDC sign-in (JIT create, name re-sync, role downgrade, email-domain tenant, cross-tenant RLS 403, missing-realm loud-fail); `@expected-red @after-phase-19` tags removed
   - Acceptance: `make e2e-cjm SCENARIO="@sso"` → 6/6 GREEN against the live Keycloak container; `tests/self-tests/sso-step-drift.test.ts` updated (it currently asserts the file is still placeholder-only)

7. **End-to-end OIDC login + desktop bearer (SSO-IMPL-05c)**: A full login flow — authorize → callback → bearer mint → desktop deep-link — completes against the live Keycloak.
   - Current: only unit coverage of callback/mint; no live-IdP login proof
   - Target: an e2e test performs the OIDC authorize redirect to live Keycloak, logs in the seeded user, lands the callback, mints an opaque bearer, and echoes the desktop channel-scheme deep-link
   - Acceptance: e2e (gated by `E2E=1`/`make e2e-cjm`) drives the browser through Keycloak login and asserts a valid bearer + correct deep-link redirect; reading the exit code + summary line confirms GREEN

## Boundaries

**In scope:**
- `apps/api/src/lib/oidc-jit-config.ts` — 7-var loud-fail env validation
- Claim→tenant+role resolver (pure) + 7 rejection codes
- 5 Better Auth extension points in `auth.ts` (`mapProfileToUser` + 4 `databaseHooks`)
- 3 structured log events + matching `audit_log` rows
- `compose/test/keycloak/realm-openwhispr-test.json` + `scripts/seed-keycloak-realm.sh` (separate path)
- Real `sso.steps.ts` implementations; 6 `@cjm-sso-1.*` un-redded; `sso-step-drift.test.ts` updated
- Live-Keycloak end-to-end login + desktop bearer-mint proof
- Keycloak pinned at `26.0` (matches existing fixture)
- `OIDC_ROLE_MAPPING` exact-match JSON `{group-name: role}`

**Out of scope:**
- Direct LDAP via `ldapts` / custom Better Auth plugin — rejected by ADR-0012/PITFALLS §14 (in-request bind blocks the auth pool; LDAP federation lives BEHIND Keycloak, configured by the operator, not in our e2e)
- Authentik fixture — docs-only per ADR-0012 open-question #5; no fixture this phase
- Admin pre-provisioning profile flag (require existing `User` row before first sign-in) — ADR-0012 open-question #3; reject-on-no-mapping is the locked v3 behavior
- Regex/DN role mapping — ADR-0012 open-question #2; exact-match only this phase
- 389DS / AD fixtures — ADR-0012 open-question #4; explicit non-goals
- Keycloak 27 upgrade — revisit when 27 ships (ADR-0012 open-question #1)
- D3 per-request Better Auth adapter (multi-tenant RLS fail-closed for BA tables) — separate v2-blocker in `deferred-items.md`; this phase accepts the documented single-tenant-default posture

## Constraints

- **Strict TDD** — RED → GREEN → REFACTOR; tests precede production code; each fix lands with its tests in the SAME atomic commit
- **Coverage ≥ 90/90/90/90** on lines/branches/functions/statements for all new/modified code
- **No mocks of internal logic** — DB-touching hooks use real Postgres + PgBouncer + Valkey via testcontainers; only the live Keycloak IdP boundary is a real container (not a mock)
- **E2E mandatory** — lives in `tests/e2e-cjm/`, gated by `E2E=1`, run via `make e2e-cjm`
- **LOCKER compliance** — no `as any`/`@ts-ignore` (LOCKER-02), no hardcoded localhost/UUID/secret shapes outside allowed dirs (LOCKER-03), every route carries `schema:` + `config: { rateLimit }` (LOCKER-04), error subclasses truncate secret-shape fields (LOCKER-05), no shell credential interpolation (LOCKER-06)
- **English-only** source artifacts; structured logs carry NO PII
- Keycloak pinned `quay.io/keycloak/keycloak:26.0`; `OIDC_ROLE_MAPPING` exact-match JSON only
- The realm-import MUST NOT populate the empty `compose/test/keycloak/` dir that `@cjm-sso-1.6` depends on

## Acceptance Criteria

- [ ] `apps/api/src/lib/oidc-jit-config.ts` exists; validates 7 env vars; fail-fast on malformed JSON; ≥ 90/90/90/90 coverage
- [ ] Claim→tenant+role resolver passes the worked `acme` example + all 7 rejection codes + tie-break + revocation downgrade
- [ ] `auth.ts` registers `mapProfileToUser` + 4 `databaseHooks`; integration test (real PG/PgBouncer/Valkey) asserts JIT `tenantId`/`role`
- [ ] 5 `403`/`400` rejection codes returned on their triggers; 3 log events fire with no PII; each writes an `audit_log` row
- [ ] `docker compose --profile sso up -d keycloak` boots healthy AND realm `acme` is importable from the separate path
- [ ] `@cjm-sso-1.6` (empty-realm loud-fail) still resolves correctly after the realm-import lands
- [ ] `make e2e-cjm SCENARIO="@sso"` → 6/6 GREEN against live Keycloak; `@expected-red` tags removed; `sso-step-drift.test.ts` updated
- [ ] Full OIDC login e2e (authorize → live-Keycloak login → callback → bearer mint → desktop deep-link) is GREEN
- [ ] All pre-existing auth/OIDC tests stay GREEN; working tree clean; commits atomic with tests

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                        |
|--------------------|-------|------|--------|--------------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Surface fully named by SPEC-18 (files, hooks, env, codes)    |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | 5 ADR open-questions resolved to explicit out-of-scope       |
| Constraint Clarity | 0.80  | 0.65 | ✓      | TDD 90/90, KC 26, exact-match, separate realm path, no-PII   |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 9 pass/fail checkboxes incl. live-KC e2e                     |
| **Ambiguity**      | 0.14  | ≤0.20| ✓      | 1−(.35×.90+.25×.85+.20×.80+.20×.85)=0.1425                    |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

`--auto` mode (user granted full autonomy: "делай автономно без меня"). Decisions auto-selected from the already-detailed `SPEC-ldap-keycloak.md` + `ADR-0012`, resolving the 5 ADR v3 open questions:

| Round | Perspective     | Question summary                                  | Decision locked (auto)                                              |
|-------|-----------------|---------------------------------------------------|--------------------------------------------------------------------|
| 1     | Researcher      | What OIDC exists today vs JIT gap?                | genericOAuth wired; JIT code/config/steps/realm ALL absent         |
| 2     | Simplifier      | Irreducible core to guarantee "Keycloak works"?   | Live-KC login + JIT tenant/role + 6 cjm-sso GREEN                  |
| 3     | Boundary Keeper | ADR-0012 open Q1 (KC version)?                    | Pin 26.0 (matches fixture); 27 deferred                            |
| 3     | Boundary Keeper | ADR-0012 open Q2 (role-mapping schema)?           | Exact-match JSON only; regex/DN out of scope                       |
| 3     | Boundary Keeper | ADR-0012 open Q3 (JIT auto-create policy)?        | Reject-on-no-mapping (SPEC failure modes 1-3); no admin pre-provision |
| 3     | Boundary Keeper | ADR-0012 open Q4 (LDAP fixture scope)?            | No LDAP fixture — federation is behind Keycloak (operator); OpenLDAP/389DS/AD out |
| 3     | Boundary Keeper | ADR-0012 open Q5 (Authentik)?                     | Docs-only; no Authentik fixture this phase                         |
| 4     | Failure Analyst | What would make a verifier reject?                | Realm-import populating the empty dir → breaks cjm-sso-1.6; PII in logs; mocked IdP |

---

*Phase: 69-sso-jit-live-keycloak*
*Spec created: 2026-05-29*
*Next step: /gsd-discuss-phase 69 — implementation decisions (how to build what's specified above)*
