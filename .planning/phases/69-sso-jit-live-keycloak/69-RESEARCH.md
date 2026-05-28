<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# Phase 69: SSO JIT provisioning + live-Keycloak e2e — Research

**Researched:** 2026-05-29
**Domain:** OIDC JIT user provisioning (Better Auth `genericOAuth` + `databaseHooks`), Keycloak 26 realm fixtures, playwright-bdd live-IdP e2e, RLS single-tenant posture
**Confidence:** HIGH (every claim below is verified against the installed `better-auth@1.6.11` vendored source or the live codebase; file:line cited)

## Summary

Phase 69 implements the JIT-provisioning surface fully specified in `SPEC-ldap-keycloak.md`. The OIDC plumbing already exists on `main` (`genericOAuth` registered in `apps/api/src/auth.ts:370-381`; desktop bearer-mint at `routes/desktop-signin.ts` → `routes/auth-callback.ts` → `lib/mint-bearer.ts`). What's missing is the claim→tenant/role decision logic, the 7-var config loader, the 5 Better Auth hook bodies, the realm fixture + seed, and the real `@cjm-sso-1.*` step-defs.

There are **three load-bearing architectural facts** the planner MUST design around, each verified in vendored source:

1. **`mapProfileToUser(userInfo)` is the ONLY place raw claims are visible.** It receives the full userinfo/claims object and its return is **spread onto the user** (`...userMap`) — `generic-oauth/index.mjs:116-124`. `databaseHooks.user.create.before(data, context)` receives only the *already-projected* user fields plus the auth context — NOT raw claims (`db/with-hooks.mjs:6-17`). So the claim→{tenantId,role} resolver must run inside `mapProfileToUser`, projecting `tenantId`/`role` onto the user object; the `create.before` hook then reads those projected fields (and is the place to enforce rejection / the RLS-INSERT concern). The 7 rejection codes are thrown from `mapProfileToUser` (failure modes 1,2,3,7) or `create.before` (mode 6 tenant-mismatch).

2. **The desktop bearer-mint path BYPASSES `genericOAuth` entirely and `mapProfileToUser` never runs on it.** `lib/mint-bearer.ts:316-350` does its own `fetch(userinfo)` → `createOAuthUser(user, account)`. Its `OidcUserinfo` type captures only `sub/email/name/picture` (mint-bearer.ts:101-106) and its scope is hardcoded `"openid email profile"` (mint-bearer.ts:192, 346) — **no `groups`, no tenant claim**. `createOAuthUser` DOES fire `databaseHooks.user.create.before/after` (it routes through `createWithHooks(..., "user", ...)` — `internal-adapter.mjs:56-73`), but the projected user has no `tenantId`/`role` and the raw claims are discarded before the hook sees them. **This is the central seam: the desktop path needs its own claim projection in mint-bearer (call the same pure resolver), and its userinfo schema + requested scope must be widened to carry `groups` + the tenant claim.** Requirement 7 (end-to-end desktop bearer) cannot pass otherwise.

3. **`users.tenant_id` is a real NOT-NULL column, but the users table fails-OPEN to the default tenant (CLAUDE.md rule 16 / migration 0024).** A JIT `create.before` CAN return a non-default `tenantId` to override the column DEFAULT, but the RLS INSERT policy on `users` is bound to `current_setting('app.tenant_id')` (the GUC pre-bound to DEFAULT_TENANT for the app role). Writing a `tenantId` ≠ GUC will either be silently rewritten by the DEFAULT path or rejected by the WITH CHECK policy. **@cjm-sso-1.5's cross-tenant 403 cannot be proven against the Better Auth `users` table** — it must scope the assertion to one of the 12 fail-CLOSED application tables (the existing `@cjm-15.*` sibling at `steps/rls-cross-tenant.steps.ts` proves exactly this against `transcribe`). See Open Question 1 + the Security Domain section.

**Primary recommendation:** Build a pure `resolveJitDecision(claims, jitConfig)` resolver (Req 2) + `oidc-jit-config.ts` loader (Req 1) with exhaustive unit tests FIRST (TDD red). Wire it into BOTH `mapProfileToUser` (genericOAuth/web path) AND `mint-bearer.ts` (desktop path) so the two surfaces share one decision tree. For the realm-path-separation trick, ship the realm JSON **outside** the mounted `./compose/test/keycloak/` dir and import it at runtime via the Keycloak Admin REST API in `scripts/seed-keycloak-realm.sh` (Option B below) — this keeps the mounted import dir empty so @cjm-sso-1.6 stays honest. For @cjm-sso-1.5, scope the RLS assertion to a fail-closed application table, not `users`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Claim→{tenantId,role} resolution | API (pure lib) | — | Pure function, no I/O; testable at 100% branch (Req 2) |
| 7-var env validation + boot fail-fast | API (`config`/`lib`) | bootstrap | LOCKER-01 allows env reads only in config/bootstrap; mirror `oidc-providers.ts` |
| Claim projection (web OIDC) | Better Auth `genericOAuth.mapProfileToUser` | — | Only hook with raw-claim visibility (generic-oauth/index.mjs:116) |
| Claim projection (desktop bearer) | API `lib/mint-bearer.ts` | — | Desktop path bypasses genericOAuth; needs its own projection |
| tenant/role assignment on JIT create | Better Auth `databaseHooks.user.create.before` | — | Fires on BOTH web + desktop (createOAuthUser → createWithHooks) |
| role re-sync per sign-in | `databaseHooks.user.update.before` | — | Returning-user downgrade (failure mode 5) |
| audit emission | `databaseHooks.user.create.after` / `update.after` | API `lib/audit.ts` | after-hooks queue post-transaction; recordAudit needs a tx |
| Live IdP boundary | Keycloak 26 container (`compose/test/keycloak.yml`) | — | Real container, not a mock (constitutional) |
| Cross-tenant RLS proof | Postgres RLS on fail-CLOSED app table | — | users table fails-open; cannot prove 403 there (rule 16) |

## Standard Stack

### Core (all already installed — verify versions, do NOT add new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-auth` | 1.6.11 | `genericOAuth` plugin, `mapProfileToUser`, `databaseHooks`, `internalAdapter` | Already the auth foundation; `[VERIFIED: apps/api/package.json]` |
| `quay.io/keycloak/keycloak` | 26.0 | Live OIDC IdP fixture | Pinned by `compose/test/keycloak.yml:16` + SPEC boundary; `[VERIFIED: fixture]` |
| `playwright-bdd` | 8.4.2 | Gherkin → playwright spec generation for `@cjm-sso-1.*` | Existing e2e-cjm harness; `[VERIFIED: playwright.config.ts]` |
| `undici` | (workspace) | `fetch` + self-signed-TLS dispatcher in step-defs | Pattern in every existing step file; `[VERIFIED: auth.steps.ts:9]` |
| `zod` | 4.x | JSON-config parse + fail-fast on malformed `OIDC_*_MAPPING` | Used throughout; `[VERIFIED: oidc-providers / audit.ts]` |

**No new packages required.** `ldapts` is explicitly OUT of scope (ADR-0012; LDAP federation lives behind Keycloak).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File-import realm into mounted dir | Admin-REST-API import at runtime (seed script) | REST keeps mounted dir empty → @cjm-sso-1.6 stays valid (RECOMMENDED — see Pitfall 1) |
| better-auth built-in `keycloak()` preset | Keep `genericOAuth` | `genericOAuth` is already wired via `oidc-providers.ts`; switching presets is needless churn and breaks the desktop mint-bearer custom path. `keycloak` preset is exported (`generic-oauth/index.mjs` export line) but NOT recommended. |

## Architecture Patterns

### System Data Flow

```
                    ┌──────────────── WEB / browser OIDC path ─────────────────┐
Keycloak 26 ──id_token+userinfo──► genericOAuth.getUserInfo
  (realm acme)                          │
                                        ▼
                            mapProfileToUser(userInfo)  ◄── RAW CLAIMS HERE
                                        │  calls resolveJitDecision(claims, jitConfig)
                                        │  → {tenantId, role} projected onto user  OR throw rejection
                                        ▼
                            databaseHooks.user.create.before(data, ctx)
                                        │  reads projected tenantId/role; enforce mode-6 tenant-mismatch
                                        ▼  (encryption lens wraps adapter — see below)
                            adapter.create → users row (RLS / default-tenant)
                                        ▼
                            databaseHooks.user.create.after → recordAudit('sso.jit.user.created')

                    ┌─────────────── DESKTOP bearer-mint path ─────────────────┐
Keycloak 26 ──code──► routes/desktop-signin (PKCE, oauth_state) ──► routes/auth-callback
                                        │
                                        ▼
                            lib/mint-bearer: fetch(token) → fetch(userinfo)   ◄── RAW CLAIMS HERE
                                        │  (TODAY: scope='openid email profile', no groups — MUST WIDEN)
                                        │  call resolveJitDecision(claims, jitConfig)  ← NEW
                                        ▼
                            internalAdapter.createOAuthUser(user{+tenantId,role}, account)
                                        │  → createWithHooks → SAME databaseHooks fire
                                        ▼
                            internalAdapter.createSession → raw bearer → <scheme>://?bearer_token=
```

### Pattern 1: Pure resolver (Req 2)
**What:** `resolveJitDecision(claims: Record<string,unknown>, cfg: JitConfig): JitDecision` where `JitDecision = {ok:true, tenantId, role} | {ok:false, code: RejectionCode}`.
**When to use:** Called by both `mapProfileToUser` and `mint-bearer`. No I/O — 100% branch coverage achievable.
**Decision tree (from SPEC failure-mode table, SPEC-ldap-keycloak.md:137-145):**
- tenant claim resolution: `email_domain` mode → split `email` on `@`; named-claim mode → read `claims[tenantClaim]`. Missing → `forbidden_missing_tenant_claim` (403).
- tenant-value not in `OIDC_TENANT_MAPPING` → `forbidden_unknown_tenant` (403).
- group→role: collect `claims[groupClaim]` (array), map each via `OIDC_ROLE_MAPPING`, tie-break by `OIDC_ROLE_PRIORITY` (default `admin > member > viewer`). No match AND `OIDC_DEFAULT_ROLE=null` → `forbidden_no_role_mapping` (403). Multiple matches → highest-priority (200).
- returning user, admin group revoked, `OIDC_REVOCATION_MODE=downgrade_to_default` → rewrite to default role (200, audit `sso.jit.role.updated`).
- returning user, tenant claim changed → `forbidden_tenant_mismatch` (403) — enforced in `create.before`/`update.before` by comparing existing row tenant.
- malformed claim shape (resolver throws) → `invalid_oidc_profile` (400).

### Pattern 2: Config loader mirroring `oidc-providers.ts` (Req 1)
**What:** `apps/api/src/lib/oidc-jit-config.ts` exports `readJitConfig(env = process.env): JitConfig | null`. Returns `null` (JIT disabled) when `OIDC_TENANT_CLAIM` unset. Throws (boot fail-fast, non-zero exit) on malformed `OIDC_TENANT_MAPPING`/`OIDC_ROLE_MAPPING` JSON.
**Source pattern:** `oidc-providers.ts:43-59` (`present()` guard + per-var read). Use `zod` `.safeParse(JSON.parse(...))` and on failure throw a typed error the bootstrap surfaces as exit 78 (`EX_CONFIG`, the same code the encryption boot gate uses — `[CITED: CLAUDE.md rule 15]`).
**LOCKER-01:** env reads belong in `config/*.ts`/`bootstrap.ts`/`*.config.ts`. `lib/oidc-jit-config.ts` reads `process.env` — confirm the LOCKER-01 allowlist admits `lib/oidc-*.ts` (the sibling `oidc-providers.ts` already reads `process.env` from `lib/`, so the pattern is precedented — `[VERIFIED: oidc-providers.ts:41]`). If LOCKER-01 flags it, the read must move to `config/`.

### Pattern 3: databaseHooks compose with the encryption lens
**What:** The drizzle adapter is wrapped by `wrapAdapter` (encryption lens) at `auth.ts:415-443`. `databaseHooks` run in `createWithHooks`/`updateWithHooks` (`db/with-hooks.mjs`), which call `getCurrentAdapter(adapter).create(...)` — i.e. the hook's returned `data` flows INTO the lens-wrapped adapter. **`tenantId`/`role` are plaintext non-credential fields — the lens only transforms columns in `ENCRYPTED_COLUMNS_MAP` (`auth.ts:173-193`), which does NOT include `tenantId`/`role`. So JIT assignment in `create.before` survives the lens untouched** (`[VERIFIED: lens.ts:429-440` — `encryptColumns` iterates only `columnMap[model]` entries]). No new encryption wiring needed. `tenantId`/`role` must be registered as `user.additionalFields` (role already is — `auth.ts:492-497`; `tenantId` is NOT yet declared as an additionalField and likely must be added so the adapter's `transformInput` whitelist forwards it — verify against `users` schema which already has the column).

### Anti-Patterns to Avoid
- **Putting claim resolution in `create.before`.** Raw claims are gone by then; only projected user fields + auth context survive (`with-hooks.mjs:6-17`). Resolve in `mapProfileToUser`.
- **Assuming the desktop path inherits `mapProfileToUser`.** It does not (mint-bearer.ts is a parallel custom flow). Forgetting this leaves Req 7 red.
- **Proving cross-tenant RLS against the `users` table.** Fails-open to default tenant (rule 16). Use a fail-closed app table.
- **File-importing the realm into the mounted dir.** Breaks @cjm-sso-1.6.
- **Adding a 19th audit action without the CHECK migration.** `audit_log_action_check` (audit_log.ts:70-80) only permits 18 actions — see Pitfall 3.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OIDC token exchange + userinfo | New fetch flow | Existing `lib/mint-bearer.ts` (desktop) + `genericOAuth` (web) | Both already battle-tested incl. discovery-doc SSRF guards (mint-bearer.ts:assertEndpointAffiliated) |
| Audit row write | Raw INSERT | `recordAudit(tx, ctx, action, payload)` (`lib/audit.ts:283`) | Forbidden-key sweep, Cyrillic guard, per-action zod schema, in-tx semantics |
| Tenant context for audit | Manual GUC | `withTenant(db, tenantId, async tx => ...)` | RLS-correct; recordAudit requires the tx from withTenant |
| Realm import | Hand-write Keycloak DB rows | Admin REST API `POST /admin/realms` (seed script) | Keycloak's documented import surface; keeps mounted dir empty |
| Cross-tenant 403 proof | New RLS test rig | Clone `steps/rls-cross-tenant.steps.ts` pattern | Already proves the exact 403 against a fail-closed table |

**Key insight:** Almost nothing here is greenfield — it's *wiring* two existing OIDC surfaces into one shared resolver and one shared config. The risk is the seam (desktop bypasses mapProfileToUser), not the components.

## Runtime State Inventory

> This is an additive implementation phase, not a rename. The relevant "runtime state" is the Keycloak container + CI wiring that does not yet exist.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — JIT writes to existing `users`/`account` tables; no new schema, no migration (ADR-0012 confirms `account` UNIQUE is the idempotency anchor, `0001_better_auth.sql`) | None |
| Live service config | **`compose/test/keycloak.yml` is NOT wired into `make e2e-cjm`.** The Makefile target (Makefile:540-545) composes base + embedded-litellm + storage + ingress + overrides — NOT `compose/test/keycloak.yml`. The realm-import dir mount is `./compose/test/keycloak/` (keycloak.yml:29). | Plan MUST add keycloak.yml to the e2e-cjm compose stack (likely behind `--profile sso` or a SCENARIO-gated branch) AND the seed step. This is the single biggest wiring gap. |
| OS-registered state | None | None |
| Secrets/env vars | 7 new JIT env vars (SPEC-ldap-keycloak.md:108-116) read by `oidc-jit-config.ts`; OIDC triple already read by `oidc-providers.ts`. Keycloak fixture uses `KC_BOOTSTRAP_ADMIN_*` literals (test-only, in `compose/` — LOCKER-03 allows). | Add JIT vars to `.env.*.example` + CI workflow env |
| Build artifacts | `tests/e2e-cjm/.bdd-gen/` regenerated by `bddgen`; `sso-step-drift.test.ts` asserts step file is placeholder-only and WILL fail once real steps land. | Update `tests/self-tests/sso-step-drift.test.ts` (Req 6) — see Pitfall 4 |

## Common Pitfalls

### Pitfall 1: Realm import populates the mounted dir → breaks @cjm-sso-1.6
**What goes wrong:** Dropping `realm-openwhispr-test.json` into `./compose/test/keycloak/` makes Keycloak auto-import it (`--import-realm`), so the "empty realm dir → loud-fail" scenario @cjm-sso-1.6 can no longer observe an empty dir.
**Why it happens:** The mount `./compose/test/keycloak/:/opt/keycloak/data/import:ro` (keycloak.yml:29) + `start-dev --import-realm` auto-loads everything in that dir.
**How to avoid (RECOMMENDED — Option B):** Ship `realm-openwhispr-test.json` at `compose/test/keycloak-realms/realm-openwhispr-test.json` (a DIFFERENT dir, NOT mounted) and a `scripts/seed-keycloak-realm.sh` that, after the container is healthy, imports via the Admin REST API:
```bash
# acquire admin token, then POST the realm JSON
curl -s -d "client_id=admin-cli&username=$KC_ADMIN&password=$KC_PW&grant_type=password" \
  "$KC_URL/realms/master/protocol/openid-connect/token" | jq -r .access_token  # → $TOKEN
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data @compose/test/keycloak-realms/realm-openwhispr-test.json "$KC_URL/admin/realms"
```
The mounted `./compose/test/keycloak/` dir keeps ONLY `.gitkeep`; @cjm-sso-1.6 still sees it empty.
**Alternative (Option A):** A second compose override that mounts `keycloak-realms/` into the import dir ONLY for the positive scenarios, with @cjm-sso-1.6 run against the base (empty) mount. More compose surface; harder to reason about; **NOT recommended** vs the REST seed.
**LOCKER-06 warning:** the seed script MUST NOT interpolate `*_PASSWORD`/`*_TOKEN` into a `bash -c` string from Node. If the seed is invoked from TS via `spawn`, use argv-array form `spawn('bash', [scriptPath], {shell:false})` and pass secrets via env, never via template-literal command strings.

### Pitfall 2: Desktop path silently provisions with NULL tenant/role
**What goes wrong:** Req 7's desktop login lands a user, but with default tenant + null role, because mint-bearer never ran the resolver and never requested the `groups` scope.
**Why it happens:** mint-bearer.ts:316-350 has its own userinfo shape (only sub/email/name/picture) and hardcoded `scope: "openid email profile"` (lines 192, 346).
**How to avoid:** (a) widen the requested scope in `desktop-signin.ts:192` and the account scope in `mint-bearer.ts:346` to include the group scope Keycloak needs (typically `groups` or a client scope mapping `groups` into userinfo); (b) widen `OidcUserinfo` to carry `groups` + the tenant claim; (c) call `resolveJitDecision` and pass `tenantId`/`role` into `createOAuthUser`'s user arg. Verify the Keycloak realm's client has a `groups` protocol mapper that emits `groups` in userinfo (not just id_token) — the realm JSON must declare this.
**Warning sign:** @cjm-sso-1.1 GREEN via the web path but Req-7 desktop e2e provisions a default-tenant user.

### Pitfall 3: audit_log CHECK constraint rejects new sso.jit.* actions
**What goes wrong:** `recordAudit('sso.jit.user.created', ...)` throws a CHECK violation; the tx rolls back; the user is never created.
**Why it happens:** `AUDIT_LOG_ACTIONS` (audit_log.ts:25-44) is a locked 18-action enum, enforced by the `audit_log_action_check` DB CHECK (audit_log.ts:70-80) AND the per-action zod schema map in `audit.ts:134-181` (the `satisfies Record<AuditAction,...>` cast fails compile if an action lacks a schema). The 3 SPEC events (`sso.jit.user.created`/`sso.jit.role.updated`/`sso.jit.rejected`) are NOT in the enum.
**How to avoid — decision the planner MUST make (see Open Question 2):** Either (a) add the 3 actions to `AUDIT_LOG_ACTIONS` + a new migration extending the CHECK + 3 zod payload schemas (the "make it 21 actions" path — clean but touches the locked D-A6 enum and needs a migration), OR (b) reuse existing actions — but none fit (`auth.oauth_link` is the closest but semantically wrong). **Recommendation: option (a)** — the SPEC explicitly names these 3 actions and @cjm-sso-1.1 asserts `action "sso.jit.user.created"` verbatim (keycloak-oidc.feature:25). This requires a new migration `00NN_audit_log_sso_actions.sql` extending the CHECK; coordinate the enum edit + zod schema edit + migration as ONE atomic change (CLAUDE.md "fix lands with its tests in the SAME commit"). **CLAUDE.md hard-rule 1 caveat:** do NOT edit the migration only to make a test pass — the enum extension is a genuine production requirement driven by the SPEC, so it is legitimate, but document it as such.

### Pitfall 4: sso-step-drift.test.ts trips when real steps land
**What goes wrong:** `tests/self-tests/sso-step-drift.test.ts:95-106` asserts the step file is placeholder-only (`expect(src).not.toMatch(/\bfetch\b\s*\(/)` and `not.toMatch(/\bundici\b/)`). Real step-defs WILL use `undici`/`fetch` → this self-test fails.
**Why it happens:** The drift sentinel was deliberately built to fail loudly when Phase 19/69 lands, forcing the implementer to update it (a tripwire, not a bug).
**How to avoid:** Req 6 explicitly requires updating this test. Replace the "placeholder-only" assertions with the real drift check: keep the Given/When/Then-text-vs-feature-text equivalence assertions (the genuinely useful part) and drop the `throw`/`no-fetch` heuristics. Land this edit in the SAME commit as the real step-defs.

### Pitfall 5: after-hooks run post-transaction → audit tx context
**What goes wrong:** `create.after`/`update.after` are queued via `queueAfterTransactionHook` (with-hooks.mjs:31-38) — they run AFTER the create commits. `recordAudit` needs a `tx` from `withTenant`. If the after-hook tries to reuse the create's (now-committed) tx, the INSERT fails or audit-loss occurs.
**How to avoid:** In the after-hook, open a FRESH `withTenant(db, tenantId, async tx => recordAudit(tx, ctx, 'sso.jit.user.created', {...}))`. Note this means the user-create and its audit row are in SEPARATE transactions (the after-hook is post-commit by design). The SPEC's "each writes an audit_log row" (Req 4) is satisfied, but the strict D-A1 "audit row exists iff action commits" atomicity does NOT hold for these after-hook events — flag this to the planner as an intentional deviation from D-A1, justified by Better Auth's hook lifecycle. For the `sso.jit.rejected` event (thrown from `mapProfileToUser`/`create.before`), there is no committed user row, so emit it from the rejection path directly (also its own withTenant tx, scoped to the resolved-or-default tenant — but a rejected sign-in may have NO valid tenant, so use the default tenant for the audit row, matching `auth.signin_failed` precedent).

## Code Examples

### mapProfileToUser projecting tenant/role (web path) — Req 3
```typescript
// Source pattern: better-auth generic-oauth/index.mjs:113-127 (mapProfileToUser
// return is spread onto user). resolveJitDecision is the Req-2 pure resolver.
genericOAuth({
  config: oidcProviders.map((p) => ({
    ...p,
    // jitConfig from readJitConfig(); null → omit mapProfileToUser (JIT disabled)
    ...(jitConfig
      ? {
          mapProfileToUser: (profile: Record<string, unknown>) => {
            const decision = resolveJitDecision(profile, jitConfig);
            if (!decision.ok) {
              // throws → genericOAuth surfaces failure; map code→status in error handler
              throw new JitRejectionError(decision.code);
            }
            return { tenantId: decision.tenantId, role: decision.role };
          },
        }
      : {}),
  })),
})
```

### databaseHooks wiring — Req 3
```typescript
// Source: better-auth context/helpers.mjs:43-46 (options.databaseHooks → dbHooks).
// Top-level betterAuth({ databaseHooks: { user: { create: {...}, update: {...} } } }).
databaseHooks: {
  user: {
    create: {
      before: async (data, _ctx) => {
        // data.tenantId/role already projected by mapProfileToUser (web) or
        // createOAuthUser arg (desktop). Enforce mode-6 tenant-mismatch here if
        // this is secretly an update (Better Auth dedups by email upstream).
        return { data };
      },
      after: async (user, _ctx) => {
        await withTenant(db, user.tenantId, async (tx) =>
          recordAudit(tx, auditCtx, "sso.jit.user.created", { /* no PII */ }),
        );
      },
    },
    update: {
      before: async (data, _ctx) => { /* role re-sync / downgrade */ return { data }; },
      after: async (user, _ctx) => {
        await withTenant(db, user.tenantId, async (tx) =>
          recordAudit(tx, auditCtx, "sso.jit.role.updated", { /* no PII */ }),
        );
      },
    },
  },
}
```

### Cross-tenant RLS 403 (Req 6, @cjm-sso-1.5) — clone existing pattern
```typescript
// Source: tests/e2e-cjm/steps/rls-cross-tenant.steps.ts:168-182.
// Scope the assertion to a fail-CLOSED app table (transcribe), NOT users.
// Two JIT-provisioned tenants; tenant-A session requests tenant-B's transcribe
// job by id → 404 not_found (RLS hides existence). NOTE the feature text says
// "403 forbidden_tenant_mismatch" but the proven RLS behavior is 404 not_found
// for resource-scoped reads — see Open Question 1.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `mapProfileToUser` not wired | Wire it for claim projection | Phase 69 | Only raw-claim seam on web path |
| Desktop mint-bearer userinfo = sub/email/name | Widen to carry groups + tenant claim | Phase 69 | Req 7 desktop JIT |
| 18 locked audit actions | +3 sso.jit.* (pending decision) | Phase 69 | Migration + enum + zod edit |
| keycloak.yml not in e2e-cjm stack | Add to compose + seed | Phase 69 | Live-IdP e2e wiring |

**Deprecated/outdated:** Better Auth `genericOAuth` has NO per-request `onSuccess({redirectTo})` hook (auth-callback.ts:5-14 documents this empirically for 1.6.9; unchanged in 1.6.11). The desktop redirect-rewrite must stay in the custom `auth-callback.ts` route.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Keycloak realm client can emit `groups` in **userinfo** (not just id_token) via a protocol mapper, so the desktop userinfo fetch sees groups | Pitfall 2 | If groups only land in id_token, desktop path must decode id_token JWT instead of/in addition to userinfo. The realm JSON must be authored to include the userinfo group mapper. MEDIUM risk — verify when authoring realm JSON. |
| A2 | LOCKER-01 allowlist admits `lib/oidc-jit-config.ts` reading `process.env` (sibling `oidc-providers.ts` does so from `lib/`) | Pattern 2 | If LOCKER-01 refuses, the read moves to `config/`. LOW risk — precedented. |
| A3 | `tenantId` can be added as a `user.additionalFields` entry so the adapter forwards it on create | Pattern 3 | If Better Auth rejects a tenantId additionalField (column already exists), assignment may need the ownerDb/direct-SQL path. MEDIUM — verify against migration 0024 + additionalFields. |
| A4 | Extending `AUDIT_LOG_ACTIONS` to 21 + new CHECK migration is acceptable (vs the locked D-A6 18-action enum) | Pitfall 3 | If D-A6 is immovable, the 3 SPEC events can't write audit rows → Req 4 blocked. Needs a discuss-phase decision. MEDIUM-HIGH. |
| A5 | @cjm-sso-1.5's "403 forbidden_tenant_mismatch" is satisfiable as a 404 not_found against a fail-closed table (matching the proven `@cjm-15.*` behavior) OR the feature text must be reconciled | Open Q1 | If a literal 403 is required, the cross-tenant primitive must be a tenant-scoped WRITE (not a read) that the RLS WITH CHECK rejects with 403. MEDIUM. |

## Open Questions

1. **@cjm-sso-1.5 expects `403 forbidden_tenant_mismatch` but RLS-on-reads yields `404 not_found`.**
   - What we know: The sibling `@cjm-15.*` proves cross-tenant isolation as 404 (existence-hiding) against `transcribe` — `rls-cross-tenant.steps.ts:206-216`. The `users` table fails-open to default tenant (rule 16), so it can't host this test at all.
   - What's unclear: Whether the SPEC's `403 forbidden_tenant_mismatch` (failure mode 6) refers to the *sign-in-time* tenant-claim-changed rejection (which IS a 403, thrown from the JIT resolver) rather than a *data-access* RLS 403. Re-reading SPEC-ldap-keycloak.md:144, mode 6 is "Returning user, tenant claim changed → Reject (RLS invariant)" — this is a SIGN-IN rejection, not a data read. The feature scenario (keycloak-oidc.feature:48-52) describes a data-access cross-tenant request, which is a different thing.
   - Recommendation: Reconcile at discuss/plan time. Most likely the step should assert the **sign-in-time 403** (tenant claim changed for a returning user) which the resolver genuinely produces, OR scope a data-access test to a fail-closed table and accept 404. Do NOT attempt to prove a 403 against `users`.

2. **Extend the locked 18-action audit enum, or remap?** (see Pitfall 3 / A4). Needs an explicit decision — recommend extending (the SPEC names the 3 actions and a feature asserts one verbatim).

3. **Group scope name in Keycloak.** Keycloak emits group membership via a "Group Membership" protocol mapper; the claim name is operator-configured (SPEC default `OIDC_GROUP_CLAIM=groups`). The realm JSON must declare this mapper and target userinfo. Confirm the exact mapper config when authoring the realm.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + compose | live Keycloak e2e | ✓ (assumed — whole e2e-cjm harness depends on it) | — | none — blocking for Req 5/7 |
| Keycloak image `26.0` | realm fixture | pulls at compose-up | 26.0 | none |
| `jq` (for seed script REST import) | Pitfall-1 Option B seed | likely ✓ on dev/CI | — | parse token with `grep`/`sed` (LOCKER-06: no credential interpolation) |
| playwright chromium | @cjm-sso browser login | ✓ (existing harness) | — | none |

**Missing/blocking:** `compose/test/keycloak.yml` is not yet wired into the e2e-cjm compose stack (Makefile:540-545) — the plan MUST add it. This is config, not a missing tool.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (unit/integration) | `vitest` (workspace) |
| Framework (e2e-cjm) | `playwright-bdd` 8.4.2 + `@playwright/test` |
| Config file | `tests/e2e-cjm/playwright.config.ts`; per-package `vitest.config.ts` |
| Quick run command | `pnpm test <pattern>` (unit/integration, < 30s) |
| Full e2e command | `E2E_CJM=1 make e2e-cjm` (boots hermetic stack) |
| Scenario-filtered e2e | `E2E_CJM=1 SCENARIO="@sso" make e2e-cjm` (Makefile:557-558 — `--grep "$SCENARIO"`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SSO-IMPL-02 | 7-var env validation, fail-fast | unit | `pnpm test oidc-jit-config` | ❌ Wave 0 — `apps/api/tests/unit/.../oidc-jit-config.test.ts` |
| SSO-IMPL-01 | claim→{tenant,role}, 7 rejections, tie-break | unit | `pnpm test jit-resolver` | ❌ Wave 0 — new resolver test (100% branch) |
| SSO-IMPL-03 | 5 hooks assign tenant/role on real PG | integration (testcontainers) | `pnpm test auth-jit-hooks` | ❌ Wave 0 — new integration test, real PG/PgBouncer/Valkey |
| SSO-IMPL-04 | 5 codes + 3 log events + audit rows | integration | `pnpm test jit-rejections` | ❌ Wave 0 |
| SSO-IMPL-05a | realm import healthy, dir stays empty | e2e/smoke | seed script + `@cjm-sso-1.6` | ❌ Wave 0 |
| SSO-IMPL-05b | 6 scenarios GREEN | e2e | `E2E_CJM=1 SCENARIO="@sso" make e2e-cjm` | ⚠️ stubs exist; real steps Wave 0 |
| SSO-IMPL-05c | desktop bearer e2e | e2e | within `@sso` run (browser authorize→callback→bearer→deep-link) | ❌ Wave 0 |
| (drift) | step-drift sentinel updated | unit | `pnpm test sso-step-drift` | ⚠️ exists, MUST update (Pitfall 4) |
| (regression) | sibling step unit tests | unit | `pnpm test rls-cross-tenant.steps` | ✓ exists — clone for sso.steps |

### Sampling Rate
- **Per task commit:** `pnpm test <new-unit-pattern>` (resolver + config — fast, TDD red→green)
- **Per wave merge:** `pnpm test` for `apps/api` + `tests/self-tests/sso-step-drift`
- **Phase gate:** `E2E_CJM=1 SCENARIO="@sso" make e2e-cjm` → 6/6 GREEN, then full `make e2e-cjm` (grep-invert @expected-red) green with tags removed.

### Wave 0 Gaps
- [ ] `apps/api/tests/unit/__tests__/oidc-jit-config.test.ts` — REQ SSO-IMPL-02 (7 vars × present/absent/malformed)
- [ ] `apps/api/.../jit-resolver.test.ts` — REQ SSO-IMPL-01 (acme example, 7 rejections, tie-break, downgrade; 100% branch)
- [ ] `apps/api/.../auth-jit-hooks.test.ts` — REQ SSO-IMPL-03 (testcontainers PG/PgBouncer/Valkey)
- [ ] `compose/test/keycloak-realms/realm-openwhispr-test.json` + `scripts/seed-keycloak-realm.sh` — REQ SSO-IMPL-05a (SEPARATE path; A1 groups-in-userinfo mapper)
- [ ] Real `tests/e2e-cjm/steps/sso.steps.ts` + sibling `__tests__/sso.steps.test.ts` (per `feedback_cjm_steps_need_unit_tests`) — REQ SSO-IMPL-05b
- [ ] Update `tests/self-tests/sso-step-drift.test.ts` (Pitfall 4)
- [ ] Wire `compose/test/keycloak.yml` (+ `--profile sso`) into `make e2e-cjm` compose stack + readiness wait — REQ SSO-IMPL-05
- [ ] New migration `00NN_audit_log_sso_actions.sql` + `AUDIT_LOG_ACTIONS` + zod schemas (pending Open Q2 decision) — REQ SSO-IMPL-04

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth OIDC; PKCE on desktop (`lib/pkce.ts`); discovery-doc SSRF guard (`mint-bearer.ts:assertEndpointAffiliated`) |
| V3 Session Management | yes | Better Auth bearer plugin + session token (envelope-encrypted at rest, `auth.ts:180-189`) |
| V4 Access Control | yes | RLS multi-tenancy; **caveat: `users` table fails-open to default tenant (rule 16)** — do not rely on it for tenant isolation proofs |
| V5 Input Validation | yes | `zod` parse of `OIDC_*_MAPPING` JSON + OIDC token/discovery responses (mint-bearer.ts) |
| V6 Cryptography | yes (indirect) | Envelope lens already wraps account tokens; JIT adds no new crypto |
| V7 Errors & Logging | yes | 3 structured log events MUST carry NO PII (CLAUDE.md); `recordAudit` enforces forbidden-key + Cyrillic guards |

### Known Threat Patterns for OIDC JIT
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tenant claim spoofing (user forges `groups`/tenant claim) | Spoofing/Elevation | Claims are signed by Keycloak; trust boundary is the verified id_token/userinfo. Map only via operator `OIDC_TENANT_MAPPING` (no implicit tenant creation — failure mode 2) |
| Self-elevation to admin via group claim | Elevation | `OIDC_ROLE_MAPPING` exact-match only (no regex); `OIDC_DEFAULT_ROLE=null` rejects unmapped groups; `role` is `input:false` on the user model (auth.ts:495) so it can't be set from a request body |
| PII leak in audit/logs | Information disclosure | `recordAudit` forbidden-key sweep (audit.ts:52-63) + no-PII rule; emit only opaque ids/codes in the 3 sso.jit.* events |
| Cross-tenant data access by JIT user | Elevation | RLS on fail-closed app tables; @cjm-sso-1.5 proves it (scoped to a fail-closed table — NOT users) |
| Poisoned OIDC discovery → secret exfil | Tampering | `mint-bearer.ts` zod-validates discovery doc + pins endpoints to issuer origin |
| Open redirect on desktop callback | Tampering | `scheme-allowlist.ts` validation; server-fixed relative callbackURL |

## Sources

### Primary (HIGH confidence — vendored source + live codebase, file:line cited)
- `node_modules/.pnpm/better-auth@1.6.11/.../dist/plugins/generic-oauth/index.mjs:113-127` — mapProfileToUser receives claims, return spread onto user
- `.../dist/db/with-hooks.mjs:6-40` — createWithHooks/updateWithHooks run databaseHooks; before gets projected data + context; after queued post-tx
- `.../dist/db/internal-adapter.mjs:56-95,495-520` — createOAuthUser/createUser/updateUser route through *WithHooks
- `.../dist/context/helpers.mjs:22-46` — databaseHooks registration
- `apps/api/src/auth.ts:173-193,370-381,415-443,470-499` — encryption map, genericOAuth registration, lens wrap, additionalFields
- `apps/api/src/lib/oidc-providers.ts:43-111` — config-loader pattern to mirror
- `apps/api/src/lib/mint-bearer.ts:101-106,316-350` — desktop userinfo shape + createOAuthUser (the bypass seam)
- `apps/api/src/lib/audit.ts:52-63,134-181,283-322` — recordAudit + forbidden-key + per-action zod
- `packages/data/src/schema/audit_log.ts:25-80` — locked 18-action enum + CHECK
- `packages/data/src/encryption/lens.ts:416-603` — wrapAdapter scope (only columnMap models transformed)
- `packages/data/src/schema/users.ts:19-59` — tenant_id NOT-NULL column + (tenant_id,lower(email)) unique
- `compose/test/keycloak.yml:14-43` — fixture, mounted empty import dir
- `Makefile:520-561` — e2e-cjm target (does NOT include keycloak.yml), SCENARIO grep, @expected-red grep-invert
- `tests/e2e-cjm/steps/rls-cross-tenant.steps.ts` — cross-tenant 404 proof pattern (@cjm-15.*)
- `tests/e2e-cjm/steps/auth.steps.ts` — undici + self-signed-TLS step pattern
- `tests/self-tests/sso-step-drift.test.ts:95-106` — placeholder-only sentinel to update

### Secondary (MEDIUM — project docs / SPEC)
- `SPEC-ldap-keycloak.md` — 7 env vars, 5 hooks, 7 codes, 3 events, acme example
- `docs/adrs/0012-ldap-via-keycloak.md` — 5 open questions resolved in 69-SPEC boundaries
- `CLAUDE.md` rules 1, 11-16; D-A1/D-A6/D-A7 (audit); rule-16 RLS posture

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps installed; versions verified against package.json + vendored source
- Architecture (hook seams): HIGH — read directly from better-auth@1.6.11 vendored .mjs
- Desktop-bypass seam: HIGH — confirmed mint-bearer calls createOAuthUser, not genericOAuth
- Audit-enum extension: MEDIUM — requires a discuss-phase decision (Open Q2)
- @cjm-sso-1.5 403-vs-404 reconciliation: MEDIUM — feature text vs SPEC failure-mode 6 ambiguity (Open Q1)
- Keycloak groups-in-userinfo mapper: MEDIUM — realm-authoring detail (A1)

**Research date:** 2026-05-29
**Valid until:** 2026-06-28 (stable — pins won't move; better-auth 1.6.11 + Keycloak 26 locked by SPEC)
