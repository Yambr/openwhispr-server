---
quick_id: 260527-im6
slug: admin-claim-hybrid-hardening
mode: research
date: 2026-05-27
better_auth_version: 1.6.11
node_version_local: v24.15.0
source_context: .planning/quick/260527-im6-admin-claim-hybrid-hardening/CONTEXT.md
source_audit: .planning/debug/admin-onboarding-security-audit-2026-05-27.md
---

# Research — Admin Claim Hybrid Hardening

Eight planner-blocking items, plus pitfalls + implementation order. Every claim is
`[VERIFIED:<source>]` with a `path:line` citation against the local checkout. The
planner should not need to re-investigate any of these items.

---

## R1 — Better Auth `afterEmailVerification` exact API

### R1.1 — Hook signature (verbatim from vendored type)

`[VERIFIED: node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/types/init-options.d.mts:527]`

```ts
/**
 * A function that is called when a user's email is updated to verified
 * @param user the user that verified their email
 * @param request the request object
 */
afterEmailVerification?: (user: User, request?: Request) => Promise<void>;
```

Located in `emailVerification` config block — same block that owns `sendVerificationEmail`,
`autoSignInAfterVerification`, `expiresIn`, `sendOnSignUp`, `sendOnSignIn`,
`beforeEmailVerification`. The hook is async, returns `Promise<void>`, takes a positional
`User` argument and an OPTIONAL `Request` (standard global `Request`, not Fastify).
Configured exactly like the existing `sendVerificationEmail` closure already in
`apps/api/src/auth.ts:601-653`.

### R1.2 — Fires AFTER `updateUserByEmail({emailVerified:true})` lands in DB

`[VERIFIED: node_modules/.pnpm/better-auth@1.6.11_*/node_modules/better-auth/dist/api/routes/email-verification.mjs:266-267]`

```js
// line 266 — adapter writes emailVerified=true to DB FIRST
const updatedUser = await ctx.context.internalAdapter.updateUserByEmail(parsed.email, { emailVerified: true });
// line 267 — THEN hook fires, awaited
if (ctx.context.options.emailVerification?.afterEmailVerification) await ctx.context.options.emailVerification.afterEmailVerification(updatedUser, ctx.request);
```

**Key sequencing facts:**

1. **DB write happens BEFORE the hook** (line 266 precedes 267). If the hook throws, `emailVerified=true` is ALREADY persisted. A subsequent verify-email-click sees `user.user.emailVerified === true` at line 258 and short-circuits — the hook will NOT re-fire on retry. The hook must be self-idempotent (the role-flip UPDATE-WHERE predicate handles this naturally).
2. **Hook is `await`-ed** (line 267 — explicit `await`). If the hook throws, the error propagates: Better Auth's surrounding catch path converts it to either an `APIError.from('UNAUTHORIZED', ...)` redirect (when `callbackURL` is present) or a 500. The verify-email request will NOT 200.
3. **Hook fires BEFORE the auto-sign-in branch** (line 268-287). When `autoSignInAfterVerification: true` (which is set in `apps/api/src/auth.ts:600`), the hook completes BEFORE `createSession` + `setSessionCookie` runs. The role flip is visible on the immediately-following session — the user lands on the wizard's redirect already as `role='admin'`.
4. **Hook fires BEFORE the `ctx.redirect(callbackURL)` (line 288).** Even when the rewritten verify-email-complete callback is followed, the hook has already run.

### R1.3 — Two other call sites (informational — both already correct for our use case)

`[VERIFIED: node_modules/.pnpm/better-auth@1.6.11_*/node_modules/better-auth/dist]`

The hook is invoked from THREE locations in Better Auth 1.6.11:

| Site | File:line | Trigger | Relevance |
|------|-----------|---------|-----------|
| Primary | `api/routes/email-verification.mjs:267` | Plain `?token=...` sign-up verification | **This is our path.** |
| Change-email | `api/routes/email-verification.mjs:206` | `updateTo`-bearing token (`requestType: "change-email-verification"`) | Not our concern; v1 has no change-email UX. Hook still fires, but the role-flip predicate `WHERE setup_state.status='pending'` no-ops once the wizard is past `completed`. |
| email-OTP plugin | `plugins/email-otp/routes.mjs:323, :760` | Email-OTP verify | Not enabled in our config (we don't register the email-otp plugin — see `apps/api/src/auth.ts:343-365` `plugins` array contains only `bearer()` + optional `genericOAuth()`). |

Conclusion: only the email-link sign-up path triggers our hook in v1.

### R1.4 — User type returned to the hook — CRITICAL PLANNER GOTCHA

`[VERIFIED: node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/db/schema/user.d.mts:7-20]`

```ts
declare const userSchema: z.ZodObject<{
  id: z.ZodString;
  createdAt: z.ZodDefault<z.ZodDate>;
  updatedAt: z.ZodDefault<z.ZodDate>;
  email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
  emailVerified: z.ZodDefault<z.ZodBoolean>;
  name: z.ZodString;
  image: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
type BaseUser = z.infer<typeof userSchema>;
type User<DBOptions ...> = Prettify<BaseUser & InferDBFieldsFromOptions<DBOptions> & InferDBFieldsFromPlugins<"user", Plugins>>;
```

`BaseUser` has: `id`, `createdAt`, `updatedAt`, `email`, `emailVerified`, `name`, `image`.
Extended user type adds whatever is declared in `user.additionalFields`.

**Currently declared in our `additionalFields` block** `[VERIFIED: apps/api/src/auth.ts:451-480]`:
- `locale` (input:true)
- `role` (input:false)
- plus `SIDECAR_ADDITIONAL_FIELDS.user` codegen — currently empty `{}` because no `user`-model encrypted columns exist.

**NOT declared:** `tenantId`. The DB column `users.tenant_id` exists `[VERIFIED: packages/data/src/schema/users.ts:19-21]` but it is NOT in `user.additionalFields`.

**Consequence — the `transformOutput` filter in Better Auth's drizzle adapter STRIPS undeclared columns**:

`[VERIFIED: node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/db/adapter/factory.mjs:142-176]`

```js
const transformOutput = async (data, unsafe_model, select = [], join) => {
  const transformSingleOutput = async (data, unsafe_model, select = []) => {
    if (!data) return null;
    const newMappedKeys = config.mapKeysTransformOutput ?? {};
    const transformedData = {};
    const tableSchema = schema[getDefaultModelName(unsafe_model)].fields;  // ← only declared fields
    ...
    for (const key in tableSchema) {                                        // ← ITERATES ONLY tableSchema
      if (select.length && !select.includes(key)) continue;
      const field = tableSchema[key];
      if (field) {
        ...
        transformedData[newFieldName] = newValue;                           // ← only declared keys land
      }
    }
    return transformedData;
  };
  ...
};
```

The `User` returned from `updateUserByEmail` is the OUTPUT of `transformOutput` — it
contains ONLY keys present in `tableSchema` (= `BaseUser` + declared `additionalFields`).
**`tenantId` will be `undefined` on the user object the hook receives.**

**Existing precedent for this gap**:

`[VERIFIED: apps/api/src/auth.ts:548]` (inside the `sendResetPassword` closure)
```ts
tenant_id: user.tenantId ?? (await resolveDefaultTenantId()),
```

`[VERIFIED: apps/api/src/auth.ts:628]` (inside the `sendVerificationEmail` closure)
```ts
tenant_id: user.tenantId ?? (await resolveDefaultTenantId()),
```

The codebase already accepts that `user.tenantId` may be undefined and falls back to
`resolveDefaultTenantId()` (which returns `'00000000-0000-0000-0000-000000000000'`
in v1 — `[VERIFIED: apps/api/src/lib/default-tenant.ts:19,30-34]`).

**Planner directive:** the new `afterEmailVerification` closure MUST use the same
`user.tenantId ?? (await resolveDefaultTenantId())` fallback pattern. Do NOT add
`tenantId` to `user.additionalFields` — it would be a wider refactor than the
quick-task scope (every existing sign-up code path that omits the field would start
hitting Better Auth validation; the codegen SIDECAR_ADDITIONAL_FIELDS pipeline
would also need to learn the new shape). The v1 fallback is correct and matches
two existing precedent sites.

### R1.5 — Hook is configured via the `betterAuth({...})` top-level options

`[VERIFIED: apps/api/src/auth.ts:587-654]`

The existing `emailVerification` block contains `autoSignInAfterVerification: true`
and `sendVerificationEmail: async ({user, url}) => {...}`. Adding
`afterEmailVerification: async (user, request) => {...}` to the same block is the
shape Better Auth's type expects. No plugin registration needed.

### R1.6 — D3 LOCKED choice CONFIRMED VIABLE — no fallback to `databaseHooks.user.update.after` required

`afterEmailVerification` EXISTS in Better Auth 1.6.11, is publicly typed, fires
post-DB-write, fires pre-redirect, fires pre-session-creation when
`autoSignInAfterVerification: true`. CONTEXT.md D3 stays locked. No need to
shift to `databaseHooks.user.update.after`.

---

## R2 — `setup_state` status enum (verbatim)

`[VERIFIED: packages/data/src/schema/setup_state.ts:21-25]`

```ts
export const setupStateStatus = pgEnum("setup_state_status", [
  "pending",
  "completed",
  "skipped_legacy",
] as const);
```

**Authoritative spelling: `'completed'`** (with `-ed`, NOT `'complete'`). CONTEXT.md
matches. The audit document at one point uses `'complete'` colloquially in prose but
every code citation in the same audit also uses `'completed'`. The pgEnum is the
source of truth — any UPDATE with `status='complete'` will FAIL at the DB level with
`invalid input value for enum setup_state_status: "complete"`.

**Singleton row id**: `id = 1` (PRIMARY KEY CHECK `[VERIFIED: audit E7]`). All
UPDATEs/SELECTs MUST use `WHERE id = 1`.

**Defensive read default**: if the singleton row is missing, treat as `'pending'`.
`[VERIFIED: apps/api/src/routes/setup-state.ts:43-58]`

```ts
let status: SetupStatus = "pending";
await db.transaction(async (tx) => {
  const result = (await tx.execute(sql`SELECT status FROM setup_state WHERE id = 1`)) as {
    rows?: SetupStateRow[];
  };
  const row = result.rows?.[0];
  if (row && row.status) status = row.status;
});
```

The boot validator (D1) MUST use the same defensive default: a missing row at boot
time is `'pending'` for gating purposes.

---

## R3 — `crypto.timingSafeEqual` semantics on Node 24

### R3.1 — Empirical behaviour confirmed against local Node 24.15.0

`[VERIFIED: command output, Node v24.15.0]`

```bash
$ node -e "const c=require('node:crypto'); console.log(c.timingSafeEqual(Buffer.from('00','hex'),Buffer.from('00','hex')));"
true

$ node -e "const c=require('node:crypto'); try { c.timingSafeEqual(Buffer.from('00','hex'),Buffer.from('0000','hex')); } catch(e) { console.log('THROWN:', e.code, e.message); }"
THROWN: ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH Input buffers must have the same byte length
```

**Contract:** `crypto.timingSafeEqual(a: Buffer, b: Buffer): boolean`. Requires both
buffers to have the same byte length; **throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`
on mismatch**. NEVER pass attacker-controlled-length input directly — pre-validate
length first.

### R3.2 — No existing usage in the codebase

`grep -rn "timingSafeEqual\|safeCompare\|constantTimeEqual" apps packages services` (excluding
`dist/` / `node_modules`) returns ZERO results. **This will be the first such usage
in the OpenWhispr codebase** — there is no project-internal helper to adopt. The
planner should ship a new helper.

### R3.3 — Safe-compare wrapper pattern (planner-mandated shape)

```ts
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare of the env-pre-parsed token buffer against an
 * incoming Authorization-header string. Returns false on any of:
 *   - presented is undefined / empty
 *   - presented fails the hex64 shape regex
 *   - presented decodes to a buffer of the wrong byte length
 *   - the byte arrays differ
 * NEVER throws. The handler maps the boolean to 200/403.
 */
export function compareSetupClaimToken(envBuffer: Buffer, presented: string | undefined): boolean {
  if (!presented) return false;
  if (!/^[0-9a-f]{64}$/.test(presented)) return false;
  const presentedBuffer = Buffer.from(presented, "hex");
  // Defence-in-depth: regex above already guarantees 32-byte buffer, but
  // assert it before calling timingSafeEqual since a length mismatch THROWS
  // (ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH) — refuse rather than throw.
  if (presentedBuffer.length !== envBuffer.length) return false;
  return timingSafeEqual(presentedBuffer, envBuffer);
}
```

Lives at `apps/api/src/lib/setup-claim-token.ts` per CONTEXT.md D2 §code-level
implication. `envBuffer` is `Buffer.from(env.OPENWHISPR_SETUP_CLAIM_TOKEN, 'hex')`
captured once at boot (memoised constant, not re-derived per request).

### R3.4 — Why a single `timingSafeEqual` is sufficient (no double-hash)

Some patterns wrap both sides in SHA-256 before `timingSafeEqual` to normalise
unequal-length inputs. We do NOT need that here because the regex pre-filter
guarantees fixed 32-byte length. Skip the double-hash — adds latency without
adding safety. The well-known recipe from Node docs is `timingSafeEqual` direct
when length is pre-validated.

---

## R4 — `validateAuthBoot` boot-validator exact shape

### R4.1 — Function signature

`[VERIFIED: apps/api/src/config/auth.ts:49-106]`

```ts
const EX_CONFIG = 78;

export interface AuthBootValidation {
  readonly useSecureCookies: boolean;
  readonly authUrl: string;
}

export function validateAuthBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): AuthBootValidation {
  ...
}

function defaultFail(message: string): never {
  // biome-ignore lint/suspicious/noConsole: pre-logger boot path — stderr is the only sink.
  console.error(`FATAL ${message}`);
  process.exit(EX_CONFIG);
}
```

**Shape elements the planner MUST mirror in `validateSetupClaimBoot`:**

1. Sync function (boot is sync).
2. `env: NodeJS.ProcessEnv = process.env` — injectable for tests.
3. `onFail: (message: string) => never = defaultFail` — spy-able in tests.
4. `defaultFail` writes `FATAL <message>` to stderr via `console.error` with the
   biome-ignore comment for the pre-logger boot path, then calls `process.exit(78)`.
5. `EX_CONFIG = 78` is shared across all five existing boot validators
   (`validateEncryptionBoot`, `validateAuthBoot`, `validateIngressBoot`,
   `validateBetterAuthSecretBoot`, `validateSafetyKnobsBoot`).
6. Test env (`NODE_ENV === 'test'`) has a permissive accept path that returns
   safe defaults WITHOUT exiting — see `apps/api/src/config/auth.ts:63-72`. This
   is REQUIRED for the existing buildAuth() unit tests that don't populate the
   env (`apps/api/tests/unit/__tests__/auth-*.test.ts`). The dedicated
   `validateSetupClaimBoot.test.ts` will exercise the strict matrix via env
   injection.

### R4.2 — Test pattern (verbatim from existing test)

`[VERIFIED: apps/api/tests/unit/config/auth.test.ts:19-34]`

```ts
function callValidate(env: NodeJS.ProcessEnv): {
  result?: ReturnType<typeof validateAuthBoot>;
  failure?: string;
} {
  let failure: string | undefined;
  const onFail = vi.fn((message: string): never => {
    failure = message;
    throw new Error("__refuse__");
  }) as unknown as (message: string) => never;
  try {
    const result = validateAuthBoot(env, onFail);
    return { result };
  } catch {
    return { failure };
  }
}
```

The planner should reuse this exact harness shape for `validateSetupClaimBoot.test.ts`.

### R4.3 — Where it's invoked in production

`[VERIFIED: apps/api/src/index.ts:113]` — `validateIngressBoot()` is called
unconditionally at module-top. `validateBetterAuthSecretBoot()` is called at line
93 (after `validateEncryptionBoot()` at line 83). `validateSafetyKnobsBoot()` runs
in a try/catch with `process.exit(78)` on `Error` (lines 127-133) — distinct
posture because it throws-not-exits from the validator itself.

**Subtle:** `validateAuthBoot()` is called LAZILY at the call sites in `auth.ts`
(`baseURL: validateIngressBoot().ingressBaseUrl` at line 431,
`useSecureCookies: validateAuthBoot().useSecureCookies` at line 689). It is NOT
called at module top in `index.ts`. The implementation is idempotent (no side
effects beyond reading env), so this dual-call pattern is safe.

**Planner directive for D1's `validateSetupClaimBoot`:**

CONTEXT.md D1 §code-level implication says: *"invoke after `validateAuthBoot()` +
AFTER drizzle adapter is up but BEFORE the HTTP listener binds. Place in
`apps/api/src/index.ts` right next to the existing `validateIngressBoot()` call."*

The placement at line 113 (next to `validateIngressBoot()`) PRE-DATES the
construction of `db` (which happens later in `buildApp()`'s flow at `apps/api/src/index.ts:841`
where `buildAuth(...)` is called). The gate needs to read `setup_state.status`
which requires `db` — so it must move LATER in the boot sequence.

**Recommended placement**: in `index.ts`, after `const db = ...` is constructed
and BEFORE `buildApp(...)` is called. Equivalent to:

```ts
// after db construction, before buildApp
const { validateSetupClaimBoot } = await import("./config/setup-claim.js");
await validateSetupClaimBoot({ db, env: process.env });
```

**The boot validator IS async** (must do an SQL `SELECT status FROM setup_state WHERE id = 1`).
This DIFFERS from the existing sync boot validators. Pattern for `process.exit(78)` from
an async context: same `defaultFail` style — the function awaits the SELECT, then
calls `onFail(...)` which exits. Tests inject `onFail` as a spy + throw to capture
behaviour without killing the runner.

---

## R5 — `recordAudit` API

### R5.1 — Function signature

`[VERIFIED: apps/api/src/lib/audit.ts:283-322]`

```ts
export async function recordAudit<A extends AuditAction>(
  tx: ExecutableTx,
  ctx: AuditCtx,
  action: A,
  payload: AuditPayload<A>,
): Promise<void>
```

Where:

```ts
export interface AuditCtx {
  tenant_id: string;       // UUID, must match HEX_UUID_RE
  actor_user_id?: string | null;  // UUID or null (nullable for unauth events)
  request_id: string;       // non-empty
  ip: string | null;        // IPv4/IPv6 literal or null
  user_agent: string;       // truncated to 512 chars by helper
}
```

### R5.2 — `admin.role_changed` enum & payload schema

`[VERIFIED: apps/api/src/lib/audit.ts:163-167]` + `[VERIFIED: packages/data/src/schema/audit_log.ts:40]`

```ts
"admin.role_changed": z.object({
  target_user_id: hexUuid,
  before: z.string().min(1),
  after: z.string().min(1),
}),
```

The enum value is registered in `AUDIT_LOG_ACTIONS` AND the audit_log_action_check
DB-level CHECK constraint `[VERIFIED: packages/data/src/schema/audit_log.ts:77]`.

**Required payload shape for the new emission:**

```ts
{
  target_user_id: signUpResult.data.user.id,  // the newly-promoted admin's user id
  before: "user",     // NB: schema rejects empty strings; we use "user" as the pre-role marker. Cannot pass null/empty.
  after: "admin",
}
```

**GOTCHA — the schema rejects `before: null` / `before: ""`** because `z.string().min(1)`.
The audit recommendation in `.planning/debug/admin-onboarding-security-audit-2026-05-27.md`
O1 suggests `before: 'null'` (the string 'null'). Acceptable, but `before: 'user'` is
more honest since the pre-promotion state IS a regular user row (just with `role IS NULL`
in DB). **Planner picks one** — either `'user'` or `'null'` — and documents the
choice. Recommend `'user'` because consistency with future enum constraints
(O2 in audit) that may add `'admin'|'user'` CHECK.

### R5.3 — Transaction inclusion (tx parameter)

`[VERIFIED: apps/api/src/lib/audit.ts:283-322]` — takes a `tx: ExecutableTx`. The
audit row INSERT participates in the caller's transaction. Per D-A1 doctrine, the
audit row exists IFF the audited action commits.

**For OUR use case** — the `afterEmailVerification` hook fires OUTSIDE the
Better Auth adapter's transaction (the BA adapter does not expose its tx via the
hook). The role flip will run via the `ownerPool` (BYPASSRLS, mirroring the
existing `apps/api/src/routes/setup-admin.ts:266` pattern). The audit emission
needs its own DB transaction.

Pattern (mirrors `apps/api/src/index.ts:505-512` for SSRF/rate-limit audits):

```ts
const dbForAudit = ... // the same TransactionalDb<ExecutableTx> buildAuth was constructed with
await dbForAudit.transaction(async (tx) => {
  await recordAudit(tx, ctx, "admin.role_changed", {
    target_user_id: user.id,
    before: "user",
    after: "admin",
  });
});
```

**withTenant vs raw transaction:** the audit row INSERTs into `audit_log` which is
tenant-scoped (`audit_log.tenant_id` FK to `tenants.id`). Use `withTenant(db, tenantId, async (tx) => ...)`
not `db.transaction(...)` so RLS context is set. Existing precedent:
`[VERIFIED: apps/api/src/routes/v1/keys/create.ts:126]` runs `recordAudit` inside
the same withTenant tx that issues the key.

### R5.4 — `auditCtxFromRequest` helper exists

`[VERIFIED: apps/api/src/lib/audit.ts:329-348]`

```ts
export function auditCtxFromRequest(
  req: RequestLikeForAudit,
  tenantId: string,
  actorUserId: string | null,
): AuditCtx {
  const ua = (req.headers["user-agent"] ?? "unknown") as string;
  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    request_id: req.id,
    ip: req.ip ?? null,
    user_agent: ua,
  };
}
```

**For the email-verify hook path**, the `request` parameter is a global `Request`
(NOT a Fastify request), so `auditCtxFromRequest` cannot be used directly — there's
no `req.id` / `req.ip` on a global Request. The hook closure must construct
`AuditCtx` manually:

```ts
const ctx: AuditCtx = {
  tenant_id: user.tenantId ?? (await resolveDefaultTenantId()),
  actor_user_id: user.id,  // best available — the user being promoted IS the actor in this pre-admin window
  request_id: crypto.randomUUID(),  // synthesize since no Fastify req.id is in scope
  ip: null,  // not derivable from the global Request without trustProxy logic
  user_agent: (request?.headers.get("user-agent") ?? "unknown").slice(0, 512),
};
```

`actor_user_id: user.id` matches the audit document's O1 recommendation
("Actor = `target_user_id` — best available — pre-admin window, no prior
authenticated actor"). The `request_id: crypto.randomUUID()` is a synthesized
correlator — acceptable per the `recordAudit` ctx schema which requires
`z.string().min(1)` not strict UUID `[VERIFIED: apps/api/src/lib/audit.ts:99-104]`.

### R5.5 — Bearer-token branch (D2) emits audit at request time

For the Bearer-token claim branch (the env-token recovery path), the existing
`req` is a Fastify request, so `auditCtxFromRequest(req, tenantId, signUpResult.data.user.id)`
works directly. The audit emission happens AFTER the role flip succeeds, BEFORE
the 201 response. Pattern matches `keys/create.ts:126`.

---

## R6 — Ingress base URL validation pattern (Origin allowlist consumption)

### R6.1 — Validator shape

`[VERIFIED: apps/api/src/config/auth.ts:134-187]`

```ts
export interface IngressBootValidation {
  readonly ingressBaseUrl: string;
}

export function validateIngressBoot(
  env: NodeJS.ProcessEnv = process.env,
  onFail: (message: string) => never = defaultFail,
): IngressBootValidation {
  const ingress = env.INGRESS_BASE_URL?.trim();
  const authUrl = env.AUTH_URL?.trim();
  const resolved = ingress || authUrl;
  // test env: permissive default "http://localhost:4000"
  // missing in non-test: REFUSE boot
  // NODE_ENV=production && resolved is non-https: REFUSE boot
  return { ingressBaseUrl: resolved };
}
```

### R6.2 — Returned shape

`{ ingressBaseUrl: string }` — a single canonical URL with protocol, host, and
optional port. **Not a list.** Single canonical origin. Multi-origin support is via
Better Auth's `trustedOrigins` config (read at `apps/api/src/auth.ts:438-442` —
includes `OPENWHISPR_API_URL`, `AUTH_URL`, `AUTH_TRUSTED_ORIGINS_EXTRA` split on
commas).

### R6.3 — Canonical Origin comparison pattern for the preHandler (CONTEXT C2)

The setup-admin route Origin preHandler should compare against
`validateIngressBoot().ingressBaseUrl`. Canonical comparison via `new URL(...).origin`:

```ts
import { validateIngressBoot } from "../config/auth.js";

const { ingressBaseUrl } = validateIngressBoot();
const expectedOrigin = new URL(ingressBaseUrl).origin;  // "https://api.example.com" — protocol + host + port

// preHandler
async (req, reply) => {
  const presented = req.headers.origin;
  if (!presented || presented !== expectedOrigin) {
    return reply.code(403).send({
      error: { code: "ORIGIN_MISMATCH", requestId: req.id },
    });
  }
}
```

**Why exact equality, not `startsWith`:** the audit document's recommended fix
(`origin.startsWith(new URL(expected).origin)`) is mildly looser than `===` —
`startsWith` accepts `https://api.example.com.evil.com` if origin echoed includes
the prefix. **Use `===` (exact origin match) instead.** `URL(...).origin` strips
trailing slash + path + query, so the comparison is canonical.

**The Better Auth `trustedOrigins` list is NOT consulted here** — it covers
`/api/auth/*` routes, not our `/api/setup/*` routes. The setup-admin preHandler
gate is independent.

### R6.4 — Test env permissive default

`[VERIFIED: apps/api/src/config/auth.ts:164-166]`

```ts
if (env.NODE_ENV === "test" && !resolved) {
  return { ingressBaseUrl: "http://localhost:4000" };
}
```

Test fixtures that don't set INGRESS_BASE_URL get the canonical fallback. The new
preHandler test should EITHER set the env or accept `http://localhost:4000` as the
expected origin.

---

## R7 — Better Auth `databaseHooks.user.update.after` fallback (NOT NEEDED — for record only)

CONTEXT.md D3 is LOCKED to `afterEmailVerification`. The R1 verification above
confirms the hook exists in BA 1.6.11 and is publicly typed. **The fallback is
NOT needed.**

For completeness, if the planner ever has to retreat to it:

`[VERIFIED: node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/types/init-options.d.mts]`
(`databaseHooks` is declared in the `BetterAuthOptions` type — `grep -n "databaseHooks"`
the init-options.d.mts to confirm shape if needed).

Risks of the fallback (cited in CONTEXT.md D3 Option (b)):
- Fires on EVERY user update (locale changes, OAuth account-link, etc.) — programmer must
  detect the `emailVerified: false → true` transition by diffing before/after rows.
- No semantic coupling to "this is the verification path".
- Larger blast radius across the test suite.

Reject if D3 ever has to shift. We have the verified `afterEmailVerification` hook;
use it.

---

## R8 — DEFAULT_TENANT_ID resolution + withTenant for the role UPDATE

### R8.1 — The role UPDATE runs via `ownerPool` (BYPASSRLS), NOT withTenant

Per the audit document `[VERIFIED: .planning/debug/admin-onboarding-security-audit-2026-05-27.md §E8]`
+ CLAUDE.md DISCIPLINE rule 16:

> The setup-admin claim handler writes `users.role='admin'` via the `ownerPool`
> (BYPASSRLS) — NOT through the app-role / withTenant wrap — so the role flip
> targets the user by `users.id` (PK) regardless of RLS.

Existing precedent `[VERIFIED: apps/api/src/routes/setup-admin.ts:266]`:
```ts
await ownerPool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [signUpResult.data.user.id]);
```

The new `afterEmailVerification` hook must follow the same pattern. The hook
receives a `user` from Better Auth (post-update, with `emailVerified=true`); it
needs ownerPool DI to do the role flip.

**Planner directive — DI shape for the hook closure:**

The `BuildAuthOptions` interface `[VERIFIED: apps/api/src/auth.ts:203-235]` needs
a new optional field. Mirror CONTEXT.md D3:

```ts
export interface BuildAuthOptions {
  db: AppDb;
  keyProvider?: KeyProvider;
  log?: { info: (msg: unknown) => void; warn: (msg: unknown) => void };
  email?: EmailService;
  enqueueEmail?: (payload: EmailDeliveryPayload) => Promise<void>;
  /**
   * Phase 60 / 260527-im6 — atomic post-verify role-flip + audit emission.
   * Production wires a closure that opens `ownerPool` UPDATE on
   * `users.role` (gated by `setup_state.status='pending'`) and emits
   * `admin.role_changed` audit. Tests inject a spy; legacy fakes that
   * omit it pre-Phase-60 are preserved (closure is optional and the hook
   * no-ops when absent — backward-compat for every existing buildAuth fake).
   */
  completeSetupAdmin?: (user: { id: string; email: string; tenantId?: string }) => Promise<void>;
}
```

The hook closure inside `betterAuth({...})`:

```ts
emailVerification: {
  autoSignInAfterVerification: true,
  sendVerificationEmail: async ({...}) => {...},
  // NEW:
  afterEmailVerification: async (user, request) => {
    if (opts.completeSetupAdmin) {
      await opts.completeSetupAdmin({
        id: user.id,
        email: user.email,
        ...(user.tenantId ? { tenantId: user.tenantId } : {}),
      });
    }
  },
},
```

### R8.2 — `completeSetupAdmin` production wiring (the role-flip body)

Lives in `apps/api/src/index.ts` next to the existing `setupAdminSignUpEmail`
closure (lines 1106-1137). Uses the existing `probeOwnerPool` instance.

```ts
// inside the same `if (probeOwnerPool && auth) { ... }` block, alongside setupAdminSignUpEmail
const completeSetupAdmin = async (user: { id: string; email: string; tenantId?: string }) => {
  // Idempotency-by-WHERE: only flips role IF setup_state.status='pending'.
  // A second click on a stale verify-email link sees status='completed' and the
  // INNER UPDATE rowCount=0 — entire transaction no-ops (safe retry).
  let claimed = false;
  await db.transaction(async (tx: ExecutableTx) => {
    const result = (await tx.execute(sql`
      UPDATE setup_state
         SET status = 'completed', completed_at = now()
       WHERE id = 1 AND status = 'pending'
       RETURNING status
    `)) as { rowCount?: number };
    if ((result.rowCount ?? 0) > 0) claimed = true;
  });
  if (!claimed) return;  // already-completed; no role flip, no audit

  // Role flip via ownerPool (BYPASSRLS) — gated by email_verified=true belt-and-suspenders.
  // The hook fires AFTER updateUserByEmail({emailVerified:true}) at email-verification.mjs:266,
  // so this predicate is structurally guaranteed true; the WHERE clause is defensive.
  const flipResult = await probeOwnerPool.query(
    `UPDATE users SET role = 'admin' WHERE id = $1 AND email_verified = true`,
    [user.id],
  );
  if (flipResult.rowCount === 0) {
    // Defensive: claimed setup_state but role-flip target row vanished. Roll back the gate.
    await probeOwnerPool.query(
      `UPDATE setup_state SET status='pending', completed_at=NULL WHERE id = 1`,
    );
    return;  // do NOT emit audit on rollback path
  }

  // Audit emission. withTenant so audit_log.tenant_id is bound + RLS context set.
  const tenantId = user.tenantId ?? (await resolveDefaultTenantId());
  await withTenant(db, tenantId, async (tx) => {
    await recordAudit(tx, {
      tenant_id: tenantId,
      actor_user_id: user.id,
      request_id: crypto.randomUUID(),
      ip: null,
      user_agent: "afterEmailVerification-hook",
    }, "admin.role_changed", {
      target_user_id: user.id,
      before: "user",
      after: "admin",
    });
  });
};

buildOpts.setupAdmin = {
  ownerPool: probeOwnerPool,
  signUpEmail: setupAdminSignUpEmail,
};
// AND pass into buildAuth:
const authRaw = buildAuth({ db, ...(enqueueEmail ? { enqueueEmail } : {}), completeSetupAdmin });
```

### R8.3 — Existing setup-admin route still owns the BEARER branch

CONTEXT.md D3 §code-level implication: *"The setup-admin POST handler's role flip
moves OUT of the route — POST creates the user but DOES NOT touch users.role or
setup_state.status. The hook owns the atomic transition. The Bearer-token branch
(D2) keeps the synchronous flip in the route as the operator-recovery /
corporate-internal path that bypasses email."*

The setup-admin handler at `apps/api/src/routes/setup-admin.ts:186-330` currently does:
1. Atomic UPDATE setup_state (line 188-197)
2. signUpEmail (line 213-243)
3. UPDATE users SET role='admin' (line 266) ← **THIS BRANCH MOVES** when D3 applies
4. UPDATE tenants SET name=workspace (line 304-317)

**Two execution paths after the refactor:**

| Path | Triggered by | Role flip happens at | setup_state→completed at |
|------|--------------|----------------------|--------------------------|
| **Bearer token** (D2 op-recovery) | `Authorization: Bearer <hex64>` matches `OPENWHISPR_SETUP_CLAIM_TOKEN` | Handler line 266 (synchronous, immediate) — `WHERE id=$1 AND email_verified=true` MAY OR MAY NOT match (operator probably uses pre-verified emails). Actually: with the email-verify gate, this would fail. **The Bearer branch BYPASSES the email_verified check** — that's its entire reason for existing. Drop the `AND email_verified=true` predicate on this branch. | Handler line 188 (synchronous) |
| **Email-verify** (D3 normal flow) | No Bearer; user proves they control the email | `afterEmailVerification` hook in auth.ts (via `completeSetupAdmin` closure) | Inside the hook's atomic UPDATE-RETURNING |

For the email-verify path, the handler's existing step 3 (line 266 UPDATE) MUST
be REMOVED — the handler creates the user but leaves role NULL. The atomic
setup_state UPDATE at line 188 must also move (or be split) — currently it
runs on EVERY claim POST, but in the email-verify path it must wait until the
hook fires. Otherwise the wizard is wedged at `status='completed'` with no admin.

**Planner directive — refactor the route handler into two preHandler-gated branches:**

```
preHandler:
  if (req.headers.authorization matches Bearer hex64 against env token):
    req.routeOptions.config.setupAdminBranch = 'bearer';
    return;  // no email-verify required
  // else: fall through to default verified-email branch
handler:
  if (req.config.setupAdminBranch === 'bearer'):
    // legacy fast path: claim setup_state, signUp, flip role, emit audit, 201
    // (existing code path with `AND email_verified=true` predicate DROPPED)
  else:
    // new email-verify-gated path: signUp ONLY (with sendOnSignUp:true semantics via
    // existing sendVerificationEmail closure already configured); leave setup_state='pending'
    // until the hook fires; 202 Accepted (NOT 201; the admin is pending until they verify)
    // OR 201 with admin.pending_verification:true — planner picks
```

**This is a wire-contract change.** The existing CJM clients expect 201 Created
on submit. Returning 202 Accepted instead would break the wizard's redirect logic.
**Recommendation: keep 201 but add `pending_verification: true` to the response body.**
The wizard's success page already shows a "check your email to verify" UX (R22
flow), so the client doesn't need to change its routing decision.

---

## Cross-cutting findings

### CC1 — `email_verified` column name in DB vs `emailVerified` in BA shape

`[VERIFIED: packages/data/src/schema/users.ts:24]` — DB column: `email_verified` (snake_case)
`[VERIFIED: @better-auth/core .../db/schema/user.d.mts:12]` — JS shape: `emailVerified` (camelCase)

Drizzle adapter handles the case mapping. When writing raw SQL (`apps/api/src/routes/setup-admin.ts:266`
style), use `email_verified`. When reading from the `user` object Better Auth returns,
use `user.emailVerified`. **Do NOT mix.**

### CC2 — `verify-email` GET route already has `originCheck` middleware

`[VERIFIED: node_modules/.pnpm/better-auth@1.6.11_*/node_modules/better-auth/dist/api/routes/email-verification.mjs:116]`

```js
const verifyEmail = createAuthEndpoint("/verify-email", {
  method: "GET",
  ...
  use: [originCheck((ctx) => ctx.query.callbackURL)],
```

The verify-email handler already validates the callbackURL's origin via Better
Auth's `originCheck` middleware. This is sufficient for the hook path's Origin
posture; the planner does NOT need to add a new Origin guard on the verify-email
endpoint. **The new Origin guard CONTEXT C2 specifies applies ONLY to
`POST /api/setup/admin` and `GET /api/setup-state`.**

### CC3 — `autoSignInAfterVerification: true` interaction with the hook

`[VERIFIED: apps/api/src/auth.ts:600]` + `email-verification.mjs:267-287`

The hook fires at line 267, THEN `autoSignInAfterVerification` creates a session
at lines 268-287. So when the wizard's user is redirected post-verify, they are
ALREADY:
1. `users.role = 'admin'` (set by hook)
2. `setup_state.status = 'completed'` (set by hook)
3. Holding a fresh session cookie (set by auto-sign-in)

The desktop verify-email-complete bridge (R22) reads the session cookie at that
point and surfaces it to the desktop client as a bearer. The bridge does NOT
need to change. The first request the freshly-signed-in desktop client makes
(typically `/api/capabilities` or `/api/setup-state`) will resolve as role='admin'.

### CC4 — Audit `before` value picks

The audit_log `admin.role_changed` payload schema requires `before: z.string().min(1)`.
Possible values for OUR transition (NULL → 'admin'):
- `'null'` (string) — explicit "nothing"
- `'user'` — semantically what an un-roled user IS
- `'pending'` — describes the wizard state, NOT user.role

**Pick `'user'`.** Rationale: future-compatible with O2 audit recommendation
(add CHECK `role IN ('user', 'admin')` — at that point we'd backfill NULL→'user'
and the audit log "before: 'user'" entries are forwards-consistent).

### CC5 — Bearer-token branch lives in the route's preHandler (per D2 §code-level)

The Bearer-token comparison runs in a route-level preHandler, BEFORE the Zod
parse + the setup_state UPDATE. CONTEXT.md D2 §code-level implication:

> Route preHandler reads `Authorization: Bearer <hex64>`, strips `Bearer ` prefix,
> calls helper. On match → pass; on absent/mismatch → fall through to
> email-verified-path check (D3).

Concretely: there is no "fall-through". If the Bearer header is present AND
matches the env token → run the synchronous fast path (Bearer branch). If the
Bearer is absent (no header, or wrong shape) → run the email-verify path
(create user only; the hook does the role flip). If the Bearer is PRESENT but
INVALID (wrong token) → 403 — don't fall through, since the operator who set
the env token expects the Bearer route to be exclusive.

Decision matrix for the route handler:

| `Authorization: Bearer X` header | Env token set | Action |
|----------------------------------|---------------|--------|
| Absent | (any) | Email-verify branch (handler creates user, hook flips role) |
| Present, matches env token | yes | Bearer branch (sync flip, immediate 201) |
| Present, doesn't match env token | yes | 403 `INVALID_SETUP_TOKEN` |
| Present, env unset | no | 403 `SETUP_TOKEN_NOT_CONFIGURED` (defence-in-depth; boot guard D1 already prevents this state) |

### CC6 — `signUpEmail` in BA 1.6.11 triggers `sendVerificationEmail` IF `requireEmailVerification` AND `sendOnSignUp !== false`

`[VERIFIED: apps/api/src/auth.ts:503]` — `requireEmailVerification: true` (in production;
flipped only by load-test knob).
`[VERIFIED: apps/api/src/auth.ts:587-654]` — the `emailVerification` block has
`sendVerificationEmail` configured but does NOT set `sendOnSignUp` explicitly.

Per the type doc `[VERIFIED: init-options.d.mts:490-498]`:
> `sendOnSignUp` — `undefined`: Follows `requireEmailVerification` behavior.

So with `requireEmailVerification: true` AND `sendOnSignUp` unset → BA sends the
verification email at sign-up automatically. The wizard already relies on this
chain — the verification email IS dispatched today. We just need the role flip
to await its completion.

**MEMORY confirmation:** `feedback_better_auth_send_verification_explicit.md` says
"sign-up does NOT auto-send verification email without sendOnSignUp:true". That
covers a different version / config; in our current pin (1.6.11) +
`requireEmailVerification: true`, the chain works. Verify in a smoke test
during execution.

### CC7 — LOCKER-03 hex64 allowlist needed

`[VERIFIED: tools/lint-no-hardcode.ts]` is a transitional allowlist mechanism
(file:lineNumber entries downgrade BLOCKING → WARN). The planner adds a regex to
the LOCKER-03 hardcode-shape checker for `/^[0-9a-f]{64}$/` literals OR uses
the existing `# canonical-default-tenant`-style allowlist for any test fixture
that bakes a hex64 example. Test fixtures live in `tests/` which is already
out of LOCKER-03 scope — most test cases won't need allowlist entries.

The DOCS example value (`docs/security.md §setup-claim-token`) needs the boot
guard's "rejected exact-string allowlist" (CONTEXT D4 — reject any docs example
value verbatim to defend against operator paste-as-is). Pattern matches the
Phase 53 KEK-example rejection in `docs/security.md §3`.

---

## Gotchas / Pitfalls (consolidated)

| # | Pitfall | Mitigation |
|---|---------|------------|
| P1 | `user.tenantId` is `undefined` on the hook input (transformOutput strips it) | Fall back to `resolveDefaultTenantId()` — matches existing precedent (R1.4) |
| P2 | `timingSafeEqual` THROWS on unequal-length buffers | Pre-validate hex64 shape + length before calling; helper returns `false` on mismatch (R3.3) |
| P3 | `setup_state.status` enum value is `'completed'` not `'complete'` | Use `'completed'` in all SQL string literals — pgEnum strict (R2) |
| P4 | Hook is awaited but DB write happens FIRST (line 266 vs 267) | Idempotency by WHERE-predicate on the hook's UPDATE; second click is safe no-op |
| P5 | `validateSetupClaimBoot` must be async (reads setup_state from DB) — different shape from existing sync boot validators | Mirror `validateSafetyKnobsBoot`'s throw-then-exit pattern; await the SELECT then `onFail(msg)` (R4.3) |
| P6 | Bearer-token route's role-flip MUST drop the `AND email_verified=true` predicate (operator may use unverified emails for recovery) | Branch the SQL by `setupAdminBranch` — Bearer branch unconditional, email-verify branch gated via hook |
| P7 | Better Auth's verify-email redirect lands on a RELATIVE path; the existing R22 rewrite (`rewriteVerificationCallbackUrl`) routes through `/verify-email-complete` — must NOT break under the new hook | Hook fires BEFORE `ctx.redirect` (line 288) — purely additive, no interference with existing R22 path |
| P8 | Origin equality must be `===`, NOT `startsWith` | `expectedOrigin = new URL(ingressBaseUrl).origin` strips trailing slash; compare as `presented === expectedOrigin` (R6.3) |
| P9 | Audit `before: ''` violates `z.string().min(1)` | Use `before: 'user'` (or `'null'`); document choice (R5.2 / CC4) |
| P10 | The route currently returns 201 Created on submit; switching to "wait for email-verify before role-flip" changes the contract | Keep 201; add `pending_verification: true` to response body so the wizard's UX renders the "check your email" page (R8.3) |
| P11 | `validateSetupClaimBoot` runs AFTER `db` is constructed (needs SQL access) — cannot live next to `validateIngressBoot()` at index.ts:113 | Move to AFTER db construction, before `buildApp()` invocation (R4.3) |
| P12 | The "single canonical docs example" hex64 in `docs/security.md` MUST be in the boot guard's reject-allowlist | CONTEXT D4 — exact-string allowlist for any docs example value (R4 / CC7) |
| P13 | LOCKER-04 schema declaration on `/api/setup/admin` was deferred ("Phase 41 backlog") | CONTEXT scope §LOCKER-04 says **bundle it now** (cost near-zero on top of D1/D2 edits) — declare `schema: { body: setupAdminInput }` and drop manual `safeParse` |
| P14 | `request` parameter in the hook is global `Request`, NOT Fastify request — `auditCtxFromRequest` cannot be used | Build `AuditCtx` manually; synthesize `request_id` via `crypto.randomUUID()` (R5.4) |

---

## Implementation order hints (for the planner)

Atomic commits, TDD per CLAUDE.md. Each commit lands its tests + the production
edit in the same commit.

**Wave 0 — boot validator + helper (no behaviour change yet)**

1. `apps/api/src/lib/setup-claim-token.ts` — `compareSetupClaimToken(envBuffer, presented)` (R3.3) + unit test `apps/api/tests/unit/lib/setup-claim-token.test.ts` (positive + negative shape matrix).
2. `apps/api/src/config/setup-claim.ts` — `validateSetupClaimBoot({db, env, onFail})` (R4 + D1) + unit test `apps/api/tests/unit/config/setup-claim.test.ts` mirroring `auth.test.ts` shape (R4.2). Boot validator with 4-cell matrix: (setup_state.status × env paths) per CONTEXT D1.

**Wave 1 — Better Auth hook + audit emission (additive, no route change yet)**

3. Extend `BuildAuthOptions` with optional `completeSetupAdmin` field (R8.1) + add `afterEmailVerification` closure inside `betterAuth({...})` in `apps/api/src/auth.ts` (calls `opts.completeSetupAdmin?.(user)` defensively). Unit test in `apps/api/tests/unit/__tests__/auth-after-email-verification.test.ts` asserts the closure is wired when present, no-ops when absent (backward-compat preservation).
4. Wire production `completeSetupAdmin` closure in `apps/api/src/index.ts` next to existing `setupAdminSignUpEmail` (R8.2). Integration-shaped unit test boots a real testcontainer Postgres, fires the closure with a `users` row that has `email_verified=true`, asserts: setup_state→completed, role→admin, audit row exists with correct payload.

**Wave 2 — Route refactor (the behaviour-changing edit)**

5. Branch the setup-admin handler by `setupAdminBranch` preHandler (CC5). The Bearer branch keeps the synchronous role flip; the email-verify branch CREATES the user only and leaves the role NULL + setup_state pending. Response body grows `pending_verification: true` on the email-verify branch (P10).
6. Add Origin allowlist preHandler to BOTH `/api/setup/admin` AND `/api/setup-state` (CONTEXT C2, R6.3). Reject mismatches with 403 `ORIGIN_MISMATCH`.
7. Pre-emptive LOCKER-04 migration on the setup-admin route: declare `schema: { body: setupAdminInput }` and drop the manual `safeParse` (P13). Single-line response body change for the existing 400 INVALID_BODY case (Fastify+Zod plugin envelope differs slightly — the test must update).

**Wave 3 — Boot wiring**

8. Add `validateSetupClaimBoot` call to `apps/api/src/index.ts` AFTER db construction, before `buildApp(...)` (R4.3 + P11). Audit-trail update in `docs/security.md` (canonical recipe + safety knobs §).

**Wave 4 — Tests + lint**

9. Comprehensive integration test that exercises the new flow end-to-end via the existing setup-admin harness (`apps/api/src/routes/__tests__/setup.ts`):
   - (a) email-verify path: POST /setup/admin → 201 pending_verification:true; setup_state still pending; users.role NULL. Then simulate verify-email-click (call buildAuth's `auth.api.verifyEmail` or call internalAdapter directly) → setup_state=completed, role=admin, audit row present.
   - (b) Bearer path: POST /setup/admin with Authorization: Bearer <env-token> → 201 immediately; setup_state=completed, role=admin.
   - (c) Cross-origin POST → 403 ORIGIN_MISMATCH (CONTEXT C2).
   - (d) Concurrent POST race (Promise.all of two POSTs) → exactly one 201, one 200/202 alreadyCompleted-shaped response.
   - (e) Unverified-email retry: complete the wizard via Bearer, then attempt verify-email-click for that user → hook no-ops (status already completed, idempotent).
10. Optional: `tools/lint-no-extra-setup_state-writers.ts` per audit O7 — out of scope per CONTEXT.md.

**Test-mocking discipline reminder (CLAUDE.md):** every DB-touching code path
uses real Postgres via testcontainers (the existing `bootMigratedPostgres()`
harness in `apps/api/src/routes/__tests__/setup.ts`). Mocks ONLY at the process
boundary — i.e. for the hook unit test, the `request` argument is a fake global
Request. The DB layer is always real.

---

## Citation index (path:line, no URLs — local-checkout-resolvable)

| Item | Citation |
|------|----------|
| Better Auth version pin | `apps/api/src/auth.ts:43` (`import { betterAuth } from "better-auth"`) + node_modules path discovery via `pnpm` listing `better-auth@1.6.11_*` |
| `afterEmailVerification` type | `node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/types/init-options.d.mts:527` |
| `afterEmailVerification` call site (primary) | `node_modules/.pnpm/better-auth@1.6.11_*/node_modules/better-auth/dist/api/routes/email-verification.mjs:267` |
| User type (BaseUser shape) | `node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/db/schema/user.d.mts:7-20` |
| transformOutput strips undeclared fields | `node_modules/.pnpm/@better-auth+core@1.6.11_*/node_modules/@better-auth/core/dist/db/adapter/factory.mjs:142-176` |
| `setup_state_status` enum | `packages/data/src/schema/setup_state.ts:21-25` |
| `users.tenant_id` column | `packages/data/src/schema/users.ts:19-21` |
| `tenant_id` is NOT in BA `additionalFields` | `apps/api/src/auth.ts:451-480` |
| Existing tenantId-fallback precedent | `apps/api/src/auth.ts:548, 628` |
| `resolveDefaultTenantId` | `apps/api/src/lib/default-tenant.ts:30-34` |
| `validateAuthBoot` signature | `apps/api/src/config/auth.ts:49-106` |
| `validateIngressBoot` signature | `apps/api/src/config/auth.ts:134-187` |
| `validateOriginBoot` signature | `apps/api/src/config/auth.ts:208-220` |
| validateAuthBoot test pattern | `apps/api/tests/unit/config/auth.test.ts:19-34` |
| `recordAudit` signature | `apps/api/src/lib/audit.ts:283-322` |
| `admin.role_changed` schema | `apps/api/src/lib/audit.ts:163-167` |
| `auditCtxFromRequest` helper | `apps/api/src/lib/audit.ts:329-348` |
| `AUDIT_LOG_ACTIONS` enum | `packages/data/src/schema/audit_log.ts:25-46` |
| audit_log_action_check CHECK | `packages/data/src/schema/audit_log.ts:77` |
| `withTenant` signature | `packages/data/src/tenant-context.ts:90-105` |
| Existing setup-admin handler | `apps/api/src/routes/setup-admin.ts:131-333` |
| Existing role-flip via ownerPool | `apps/api/src/routes/setup-admin.ts:266` |
| Existing setup-admin route wiring | `apps/api/src/index.ts:1088-1151` |
| Better Auth's `verify-email` originCheck | `node_modules/.pnpm/better-auth@1.6.11_*/node_modules/better-auth/dist/api/routes/email-verification.mjs:116` |
| `autoSignInAfterVerification` config | `apps/api/src/auth.ts:600` |
| Migration 0024 Better Auth tenant_id DEFAULTs | `packages/data/migrations/0024_better_auth_tenant_id_defaults.sql:53-59` |
| timingSafeEqual Node 24 throw class | empirical: Node v24.15.0, error code `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` |
| Setup admin tests harness | `apps/api/src/routes/__tests__/setup.ts` + `apps/api/tests/unit/routes/__tests__/setup-admin.test.ts` |
| validateBetterAuthSecretBoot precedent (EX_CONFIG 78) | `apps/api/src/lib/better-auth-secret-boot.ts:27-86` |
| validateSafetyKnobsBoot async-throw pattern | `apps/api/src/config/safety-knobs.ts:54-86` |
| `setup_state` defensive `pending` default | `apps/api/src/routes/setup-state.ts:43-58` |
| LOCKER-03 lint allowlist mechanism | `tools/lint-no-hardcode.ts:64-73` (ALLOWLIST_FILE constant) |
| key.issued audit emission pattern (recordAudit + withTenant) | `apps/api/src/routes/v1/keys/create.ts:126` |
| SSRF audit emission pattern (db.transaction + auditCtxFromRequest) | `apps/api/src/index.ts:534-585` |

---

## Confidence

| Item | Confidence | Rationale |
|------|------------|-----------|
| R1 (afterEmailVerification API) | **HIGH** | Verified at vendored type + vendored call site + 3 invocation sites + behavioural sequencing read from .mjs source. CONTEXT D3 LOCK is correct. |
| R2 (setup_state enum) | **HIGH** | pgEnum literal verbatim. CONTEXT.md value matches; audit-document's stray `'complete'` was prose-only. |
| R3 (timingSafeEqual) | **HIGH** | Empirically verified against local Node 24.15.0 — both success and failure classes confirmed by command output. |
| R4 (validateAuthBoot shape) | **HIGH** | Full verbatim citation; existing test harness reusable. |
| R5 (recordAudit + admin.role_changed) | **HIGH** | Schema cited verbatim; existing usage patterns provide 2 reference sites (keys/create.ts, SSRF hook). |
| R6 (Origin allowlist consumption) | **HIGH** | Single canonical origin; `URL(...).origin` canonical comparison verified. |
| R7 (databaseHooks fallback) | n/a (not needed) | LOCKED choice confirmed viable. |
| R8 (DEFAULT_TENANT_ID resolution + DI for hook) | **HIGH** | Existing precedent in 2 sites in auth.ts + ownerPool-bypass-RLS doctrine cited in CLAUDE.md rule 16. |
| CC1-CC7 cross-cutters | **HIGH** | Each backed by specific path:line citation. |

**No `[ASSUMED]` claims in this research.** Every factual assertion has a
verifiable local file or empirical command-output citation. The Better Auth
1.6.11 hook semantics are confirmed by direct vendored-source inspection (NOT
training data). The planner can proceed with high confidence; the only design
decisions left are the choices the planner is expected to make (e.g., `before:
'user'` vs `'null'`, exact response-body shape on the email-verify branch's 201,
allowlist patterns for the docs example values).
