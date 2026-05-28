<!-- SPDX-License-Identifier: FSL-1.1-ALv2 -->
# Phase 69: SSO JIT provisioning + live-Keycloak e2e — Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 9 (5 CREATE, 4 MODIFY)
**Analogs found:** 9 / 9 (8 in-repo strong analogs + 1 cross-file dual-emit composite)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/api/src/lib/oidc-jit-config.ts` (CREATE) | config | transform (env→validated config) | `apps/api/src/lib/oidc-providers.ts` | exact (named by SPEC) |
| claim→tenant+role resolver, pure fn (CREATE — likely `apps/api/src/lib/oidc-jit-resolver.ts`) | utility | transform (claims→decision\|rejection) | `apps/api/src/lib/settings-resolver.ts` | role-match (pure resolver chain) |
| `apps/api/src/auth.ts` (MODIFY) | provider/factory | event-driven (Better Auth hooks) | self — existing `genericOAuth` block + `afterEmailVerification`/`sendResetPassword` hook precedent | exact (in-file precedent) |
| audit emission (sso.jit.* → `audit_log`) (MODIFY/CREATE call sites) | utility | CRUD (in-tx INSERT) | `apps/api/src/lib/audit.ts` `recordAudit()` + call site `routes/setup-admin.ts:441` | exact |
| structured log events `sso.jit.*` (CREATE in hook code) | utility | event-driven (pino) | dual-emit: `error-handler.ts:218,252` (`req.log.warn` + `security.ssrf_blocked` audit) | role-match |
| `tests/e2e-cjm/steps/sso.steps.ts` (MODIFY — replace stubs) | test | request-response (wire/DOM) | `tests/e2e-cjm/steps/signin.steps.ts` (API) + `tests/e2e-cjm/steps/oidc.steps.ts` (DOM) | exact |
| `tests/self-tests/sso-step-drift.test.ts` (MODIFY — invert assertions) | test | file-I/O (source assertions) | self (current assertions, lines 95–106) | exact |
| `compose/test/keycloak/realm-openwhispr-test.json` (CREATE) | config | file-I/O (realm import) | `compose/test/keycloak.yml` (fixture header names the deliverable) | role-match |
| `scripts/seed-keycloak-realm.sh` (CREATE) | config | batch (shell seeder) | `scripts/verify-images.sh` (bash-3.2 disciplined CLI script) | role-match |

---

## Pattern Assignments

### `apps/api/src/lib/oidc-jit-config.ts` (config, transform)

**Analog:** `apps/api/src/lib/oidc-providers.ts` (entire file, 112 lines — exact shape to mirror per SPEC req 1 + SPEC-18:121).

**Source-of-truth + `present()` guard pattern** (`oidc-providers.ts:41-59`):
```typescript
const DEFAULT_ENV: NodeJS.ProcessEnv = process.env;

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function oidcConfigured(env: NodeJS.ProcessEnv): boolean {
  return (
    present(env.OIDC_ISSUER_URL) && present(env.OIDC_CLIENT_ID) && present(env.OIDC_CLIENT_SECRET)
  );
}
```

**Env-reader signature pattern** (`oidc-providers.ts:98-111`) — `readJitConfig(env = DEFAULT_ENV)` must mirror this exact `env`-defaulted shape so unit tests inject a stub env without mutating the global:
```typescript
export function readOidcProvidersForRegistration(
  env: NodeJS.ProcessEnv = DEFAULT_ENV,
): readonly OidcProviderRegistration[] {
  if (!oidcConfigured(env)) return [];
  const issuer = env.OIDC_ISSUER_URL!;
  return [ /* ... */ ];
}
```

**SPEC delta (NEW, no analog):** JIT silently disables when `OIDC_TENANT_CLAIM` is unset (mirror the `if (!oidcConfigured(env)) return []` early-return → return a disabled marker). Boot-time **fail-fast on malformed `OIDC_TENANT_MAPPING`/`OIDC_ROLE_MAPPING` JSON** has NO analog in `oidc-providers.ts` (which never `JSON.parse`s). For the fail-fast exit-code convention copy the `validateEncryptionBoot()` / `validateAuthBoot()` posture — boot guards live in `config/*.ts` and exit `78` (`EX_CONFIG`); see `auth.ts:50` import of `validateAuthBoot, validateIngressBoot, validateOriginBoot` and `auth.ts:450` usage `validateIngressBoot().ingressBaseUrl`. The JSON-parse + exit-78 belongs in a `config/`-located boot validator (LOCKER-01: env reads outside `config/`/`bootstrap.ts` are refused), with `oidc-jit-config.ts` reading the already-validated values.

**7 env vars to read** (SPEC-18:108-116): `OIDC_TENANT_CLAIM`, `OIDC_TENANT_MAPPING`, `OIDC_GROUP_CLAIM` (default `groups`), `OIDC_ROLE_MAPPING`, `OIDC_ROLE_PRIORITY` (default `admin > member > viewer`), `OIDC_DEFAULT_ROLE` (default `null`/reject), `OIDC_REVOCATION_MODE` (default `downgrade_to_default`).

---

### claim→tenant+role resolver — pure fn (utility, transform)

**Analog:** `apps/api/src/lib/settings-resolver.ts` (pure precedence-chain resolver, 0 I/O, `asRecord`/`asStringArray` coercion helpers at lines 41-53).

**Coercion-helper pattern** (`settings-resolver.ts:41-53`) — mirror for safely reading untyped id_token claim values:
```typescript
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
function asStringArray(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value as readonly string[];
  }
  return undefined;
}
```

**SPEC contract (req 2 + SPEC-18 failure-mode table:137-145):** pure `(claims, jitConfig) → { tenantId, role } | TypedRejection`. The 7 rejection codes are the decision-tree leaves:
- `403 forbidden_missing_tenant_claim` (tenant claim absent)
- `403 forbidden_unknown_tenant` (claim value not in `OIDC_TENANT_MAPPING`)
- `403 forbidden_no_role_mapping` (no group match AND `OIDC_DEFAULT_ROLE=null`)
- (200) multi-group tie-break via `OIDC_ROLE_PRIORITY`
- (200, downgraded) revocation `downgrade_to_default`
- `403 forbidden_tenant_mismatch` (returning user, tenant claim changed — RLS invariant)
- `400 invalid_oidc_profile` (`mapProfileToUser` claim-shape diff)

`email_domain` mode = derive tenant key from the email's domain; named-claim mode = read the named claim then map through `OIDC_TENANT_MAPPING`. Worked `acme` example → tenant `acme`, role `member` (SPEC-18:78-104). Pure (no DB, no env read — env arrives via the `jitConfig` arg from `oidc-jit-config.ts`); 100% branch on the decision tree per acceptance.

**Rejection-type modelling:** prefer a discriminated-union return (`{ ok: true; tenantId; role } | { ok: false; code: RejectionCode }`) over throwing, mirroring `oidc-providers.ts` returning arrays not exceptions — the audit/log emission layer in `auth.ts` then branches on the union.

---

### `apps/api/src/auth.ts` (provider/factory, event-driven) — MODIFY

**Analog:** self. The `genericOAuth` registration already exists; the 4 `databaseHooks` + `mapProfileToUser` are NEW but the file already establishes the hook-closure idiom.

**Current `genericOAuth` registration block to extend** (`auth.ts:370-383`):
```typescript
...(oidcProviders.length > 0
  ? [
      genericOAuth({
        config: [...oidcProviders],
      }),
    ]
  : []),
```
SPEC req 3 target: add `mapProfileToUser: (profile) => ({...})` INSIDE the `config[]` entry (per-provider, SPEC-18:129), not on the plugin root. Since `config` is built from `readOidcProvidersForRegistration()`, either thread `mapProfileToUser` through that helper's returned shape OR map over `oidcProviders` here adding the closure.

**Existing hook-closure idiom to mirror for the 4 `databaseHooks`** — `auth.ts` already wires closures that read `opts`, branch defensively, and stay backward-compatible when an `opts.*` injection is absent. See `afterEmailVerification` (`auth.ts:691-702`):
```typescript
afterEmailVerification: async (
  user: { id: string; email: string; emailVerified?: boolean; tenantId?: string },
  _request?: Request,
) => {
  if (!user.emailVerified) return;
  if (!opts.completeSetupAdmin) return;
  await opts.completeSetupAdmin({ id: user.id, email: user.email, ... });
},
```
This is the template for the JIT hooks: typed `user` shape, early-return guards, delegate to an injected closure so legacy `buildAuth()` test fixtures that omit the new option keep passing. The 4 hooks (SPEC-18:130-132):
- `databaseHooks.user.create.before(entity, ctx)` → returns `{ data: { ...entity, role, tenantId } }` (calls the resolver; rejection → throw/abort create)
- `databaseHooks.user.update.before(entity, ctx)` → per-sign-in role re-sync (revocation downgrade)
- `databaseHooks.user.create.after` → emit `sso.jit.user.created` log + audit row
- `databaseHooks.user.update.after` → emit `sso.jit.role.updated` log + audit row

**`user.additionalFields` precedent** for the `role`/`tenantId` projection — note `auth.ts:484-497` already declares a `role` additionalField with `input: false` (security: never read role from the public body). The JIT path sets role SERVER-SIDE in `create.before`, exactly like the wizard sets it post-verify. Do NOT flip `input` to true.

**Boot-validator wiring** mirrors `auth.ts:53` (`import { readOidcProvidersForRegistration } from "./lib/oidc-providers.js"`) — add `import { readJitConfig } from "./lib/oidc-jit-config.js"` and call it once near `auth.ts:337` (`const oidcProviders = readOidcProvidersForRegistration();`).

---

### audit emission `sso.jit.*` → `audit_log` (utility, CRUD) — call sites

**Analog:** `apps/api/src/lib/audit.ts` `recordAudit()` (write signature, lines 283-322) + call site `apps/api/src/routes/setup-admin.ts:438-449`.

**Write signature** (`audit.ts:283-288`):
```typescript
export async function recordAudit<A extends AuditAction>(
  tx: ExecutableTx,
  ctx: AuditCtx,
  action: A,
  payload: AuditPayload<A>,
): Promise<void>
```

**In-transaction call-site pattern** (`setup-admin.ts:438-449`) — copy the `withTenant`/`db.transaction` + best-effort try/catch idiom:
```typescript
const tenantIdForAudit = await resolveDefaultTenantId();
try {
  const ctx: AuditCtx = auditCtxFromRequest(req, tenantIdForAudit, newAdminUserId);
  await db.transaction(async (tx) => {
    await recordAudit(tx, ctx, "admin.role_changed", {
      target_user_id: newAdminUserId,
      before: "user",
      after: "admin",
    });
  });
} catch (err) {
  req.log.warn({ err }, "admin_role_changed_audit_emit_failed");
}
```

**SPEC-CRITICAL DELTA — NEW audit actions required.** `audit.ts:134-181` `auditPayloadSchemas` is a closed `satisfies Record<AuditAction, …>` union sourced from `AUDIT_LOG_ACTIONS` in `packages/data/src/schema/audit_log.ts`. The 3 SPEC events (`sso.jit.user.created`, `sso.jit.role.updated`, `sso.jit.rejected`) are NOT in the current 18-action enum. Two options for the planner:
1. **Add 3 actions** to `AUDIT_LOG_ACTIONS` (+ migration to the `audit_log_action_check` CHECK constraint) + 3 per-action Zod schemas in `auditPayloadSchemas`. This is the constitutionally-correct path (single chokepoint, D-A6/D-A7).
2. Map onto an existing action — NOT recommended (loses event fidelity SPEC req 4 demands).
**NO-PII constraint (SPEC + audit.ts):** payloads must avoid `FORBIDDEN_AUDIT_KEYS` (`audit.ts:52-63`: password/token/bearer/access_token/refresh_token/code/state/...) and the Cyrillic guard (`audit.ts:225`) — so `email`/`name`/`sub` claim values must NOT be stuffed into the payload; use `tenant_id`, `role`, derived non-PII fields only. Tie-break: SPEC says "no PII", and `recordAudit` already runs `rejectForbidden` + `assertEnglishOnly` at runtime, so a leak fails loud in tests.

The hook context lacks a Fastify `req`; build `AuditCtx` directly (the `AuditCtx` interface, `audit.ts:72-78`: `tenant_id`, `actor_user_id`, `request_id`, `ip`, `user_agent`) rather than via `auditCtxFromRequest`.

---

### structured log events `sso.jit.*` (utility, event-driven)

**Analog:** dual-emit composite — `apps/api/src/error-handler.ts:218` (audit action `security.ssrf_blocked`) + `error-handler.ts:252` (`req.log.warn({ err, status }, "request error")`). SPEC-18:156 mandates "each structured-log line also writes a matching `audit_log` row" — the ssrf path is the canonical dual-emit precedent in-repo.

**pino structured-log call shape** (route precedent, `transcribe.ts:238`, `setup-admin.ts:448`):
```typescript
req.log.warn({ err }, "missing provider key on /api/transcribe");
req.log.warn({ err }, "admin_role_changed_audit_emit_failed");
```
Convention: `log.<level>({ structuredFields }, "short_snake_or_message")`. For `sso.jit.*` emit the dotted event as a field (e.g. `log.info({ event: "sso.jit.user.created", tenant_id, role }, "sso jit user provisioned")`) — NO PII in the object (mirror the audit no-PII rule). In `databaseHooks` there is no `req.log`; thread a logger via `opts.log` (the `BuildAuthOptions.log` handle already exists, `auth.ts:212`) or the `fallbackLog` (`auth.ts:309`).

---

### `tests/e2e-cjm/steps/sso.steps.ts` (test, request-response) — MODIFY (replace stubs)

**Analogs:** `tests/e2e-cjm/steps/signin.steps.ts` (API-driven wire steps via undici) + `tests/e2e-cjm/steps/oidc.steps.ts` (real Playwright DOM, `@cjm-7.1` GREEN).

**World/support import + state-map idiom** (shared by both analogs; `oidc.steps.ts:13-28`, `signin.steps.ts:7-29`):
```typescript
import { expect, Given, Then, When } from "../support/world";
// (signin adds:) import { Agent, fetch as undiciFetch } from "undici";
// (signin adds:) import { freshTenant, postJsonRaw } from "../support/fixtures";

interface ScenarioState { /* per-scenario */ }
const state = new Map<string, ScenarioState>();
function stateFor(tenantId: string): ScenarioState { /* lazy init */ }
```

**Real DOM Given/When/Then** (`oidc.steps.ts:36-50`) — drive the OIDC sign-in redirect to live Keycloak through the browser `page` fixture:
```typescript
When("the sign-in page is loaded", async ({ page, apiBaseURL, tenantId }) => {
  await page.goto(`${apiBaseURL}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  // locate + assert DOM
});
```

**Real wire Given/When/Then** (`signin.steps.ts:119-152`) — for the bearer-mint + 403 RLS-mismatch assertions, use the undici + `postJsonRaw` + `getSetCookie()` idiom:
```typescript
When("the user signs in with the correct password", async ({ apiBaseURL, tenantId }) => {
  const res = await postJsonRaw(`${apiBaseURL}/api/auth/sign-in/email`, { email, password });
  s.lastStatus = res.status;
  s.lastSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
});
Then("the API returns 200 and a session cookie is set", async ({ tenantId }) => {
  expect(s.lastStatus).toBe(200);
  expect((s.lastSetCookie ?? []).length).toBeGreaterThanOrEqual(1);
});
```

**Bearer / cookie helpers** for the desktop bearer-mint step (req 7): `tests/e2e-cjm/support/fixtures.ts` exports `signedInAs()` (returns `cookieHeader`) and `fetchWithCookie()` — reuse rather than re-implement the localhost dispatcher.

**localhost TLS dispatcher** (`signin.steps.ts:49-59`) — Keycloak/api over `*.localhost` need `new Agent({ connect: { rejectUnauthorized: false } })`. NOTE LOCKER-03: `localhost`/`127.0.0.1` literals are allowed inside `tests/`, so the dispatcher pattern is compliant here.

**Tag removal:** strip `@expected-red @after-phase-19 @after-keycloak-up` from `tests/e2e-cjm/features/sso/keycloak-oidc.feature` (6 scenarios) per req 6.

---

### `tests/self-tests/sso-step-drift.test.ts` (test, file-I/O) — MODIFY (invert assertions)

**Analog:** self. Current assertions (lines 95-106) assert the file is STILL placeholder-only:
```typescript
it("step file is still placeholder-only (each body throws or no-ops)", () => {
  const src = readSteps();
  expect(src).not.toMatch(/\bundici\b/);
  expect(src).not.toMatch(/\bfetch\b\s*\(/);
});
```
Once `sso.steps.ts` ships real implementations (req 6), these two `.not.toMatch` assertions INVERT — the real steps WILL import `undici`/`fetch` (per the signin.steps analog). Replace the "placeholder-only" `it` with a real drift sentinel: keep the `extractStepBindings`/`extractFeatureSteps` helpers (lines 39-68) and the `it` at line 79, but raise the coverage floor (currently `0.3`, line 92) toward strict equality now that the steps are normalized. Update the file header comment (lines 1-15, currently says "ships in Phase 19" / placeholder rationale).

---

### `compose/test/keycloak/realm-openwhispr-test.json` (config, file-I/O) — CREATE

**Analog:** `compose/test/keycloak.yml` (the fixture whose header comment, lines 5-7, names this exact deliverable).

**CRITICAL constraint (SPEC req 5 + Constraints):** the realm JSON MUST NOT live in `./compose/test/keycloak/` — that dir holds only `.gitkeep` and its emptiness is what `@cjm-sso-1.6` (empty-realm loud-fail) asserts. The current fixture mounts `./compose/test/keycloak/:/opt/keycloak/data/import:ro` (`keycloak.yml:29`). Put the realm in a SEPARATE path (e.g. `compose/test/keycloak-import/realm-openwhispr-test.json`) and add a positive-scenario compose override that mounts THAT path; the negative `@cjm-sso-1.6` fixture keeps mounting the empty dir.

**Realm contents** (SPEC-18:78-104 worked example): realm `acme`, client `openwhispr-backend`, a seeded test user carrying `groups` (e.g. `["openwhispr-engineering"]`) + `email` (`alice@acme.example`) claims so the resolver yields tenant `acme` / role `member`.

**Image pin:** Keycloak `quay.io/keycloak/keycloak:26.0` (already pinned `keycloak.yml:16`; matches SPEC Constraints).

---

### `scripts/seed-keycloak-realm.sh` (config, batch) — CREATE

**Analog:** `scripts/verify-images.sh` (the disciplined bash CLI script in `scripts/`).

**Header + safety conventions to mirror** (`verify-images.sh:1-37`):
```bash
#!/usr/bin/env bash
# scripts/seed-keycloak-realm.sh — <one-line purpose>.
set -uo pipefail   # NOT set -e (accumulate failures); bash-3.2 compatible (macOS): no declare -A, no mapfile
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
if ! command -v docker >/dev/null 2>&1; then echo "...docker CLI not found" >&2; exit 127; fi
```

**Input-safety guard** (`verify-images.sh:99-108`) — if the seed script takes a realm/client argument, regex-validate before passing to docker (T-01.1-01 defence-in-depth).

**LOCKER-06 (shell credential interpolation):** if the seed script touches the Keycloak admin password or any `*_KEY`/`*_SECRET`/`*_PASSWORD` env, it MUST use argv-array form `spawn(cmd, [arg, ...], { shell: false })` semantics — never `bash -c` with interpolated template-literal credentials. In bash this means: do NOT build a `kcadm.sh ... --secret "$OIDC_CLIENT_SECRET"` string for `eval`; pass args directly. Scripts live in `scripts/` which is LOCKER-03/06 allowlisted, but the credential-interpolation invariant still applies.

---

## Shared Patterns

### Audit (in-tx, single-chokepoint, no-PII)
**Source:** `apps/api/src/lib/audit.ts` (`recordAudit` 283-322, `FORBIDDEN_AUDIT_KEYS` 52-63, Cyrillic guard 225)
**Apply to:** all 3 `sso.jit.*` events (req 4). Requires adding 3 actions to `AUDIT_LOG_ACTIONS` + 3 Zod payload schemas; payloads carry NO claim PII (email/name/sub).

### Structured logging (dotted-event + dual audit emit)
**Source:** `error-handler.ts:218,252` (ssrf_blocked log+audit dual emit), `transcribe.ts:238` log shape
**Apply to:** the 3 hook emission sites in `auth.ts`; thread logger via `opts.log` / `fallbackLog` (no `req.log` in `databaseHooks`).

### env-reading source-of-truth (`present()` + `env = DEFAULT_ENV` arg)
**Source:** `oidc-providers.ts:41-111`
**Apply to:** `oidc-jit-config.ts`; tests inject stub env, never mutate global.

### Boot fail-fast (exit 78 / EX_CONFIG, config-boundary)
**Source:** `auth.ts:50,450` (`validateAuthBoot`/`validateIngressBoot` from `config/auth.ts`); pattern of `validateEncryptionBoot()` (CLAUDE.md LOCKER-08 note)
**Apply to:** malformed `OIDC_TENANT_MAPPING`/`OIDC_ROLE_MAPPING` JSON parse — the parse MUST live in a `config/`-located validator (LOCKER-01: no env reads in `lib/**`/`src/**` outside `config/`/`bootstrap.ts`).

### Better Auth hook-closure (typed user, early-return guards, optional-injection backward-compat)
**Source:** `auth.ts:691-702` (`afterEmailVerification`), `auth.ts:550-588` (`sendResetPassword`)
**Apply to:** the 4 JIT `databaseHooks` + `mapProfileToUser`.

### CJM step idiom (world import, state Map, undici + fixtures helpers)
**Source:** `signin.steps.ts` (API wire) + `oidc.steps.ts` (DOM) + `support/fixtures.ts` (`signedInAs`, `fetchWithCookie`, `postJsonRaw`, `freshTenant`)
**Apply to:** `sso.steps.ts` 6 real scenarios.

---

## No Analog Found

| Concern | Reason | Planner guidance |
|---------|--------|------------------|
| Malformed-JSON boot fail-fast in JIT config | `oidc-providers.ts` never `JSON.parse`s env | Mirror `config/auth.ts` `validateAuthBoot` exit-78 posture; place JSON.parse in a `config/` validator (LOCKER-01) |
| 3 new `audit_log` actions (`sso.jit.*`) | `AUDIT_LOG_ACTIONS` is a closed 18-action enum + CHECK constraint | Extend `packages/data/src/schema/audit_log.ts` + migration to `audit_log_action_check`; add Zod schemas in `audit.ts:134` |
| Live-IdP browser login e2e (authorize→KC login→callback→bearer→deep-link) | No existing test drives a live external IdP through the browser | Compose `oidc.steps.ts` `page.goto` redirect + Keycloak login-form fill + `signin.steps.ts` cookie/bearer assertions + the existing `routes/auth-callback.ts`/`lib/mint-bearer.ts` deep-link contract |

## Metadata

**Analog search scope:** `apps/api/src/lib`, `apps/api/src/routes`, `apps/api/src/auth.ts`, `apps/api/src/error-handler.ts`, `tests/e2e-cjm/steps`, `tests/e2e-cjm/support`, `tests/self-tests`, `compose/test`, `scripts`
**Files scanned:** ~14 read in full/targeted; grep across routes/lib/error-handler for audit + log call sites
**Pattern extraction date:** 2026-05-29
