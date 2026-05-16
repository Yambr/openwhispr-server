# Review: api-core

Branch: main @ 1832f28
Scope: apps/api/src/{bootstrap,auth,index,error-handler,errors,placeholder,otel-bootstrap}.ts + config/** middleware/** plugins/** types/** lib/** (excluding lib/web-search) + i18n/**

## Summary
- Files reviewed: 32
- Findings: CRITICAL=1 HIGH=3 MEDIUM=4 LOW=6
- Top 3 production risks:
  1. **`tenantPlugin` registered in production still trusts the client-supplied `x-tenant-id` header for `req.tenantId`** (apps/api/src/middleware/tenant.ts:55-66 + index.ts:382). The plugin's own header comment admits this is a "Phase 1 stop-gap" and a "deliberate threat" (T-01-04-08); the comment promised "Phase 2 will replace it". Phase 2 came and went — the dual-auth hook moved authenticated routes to `req.tenant` (different field), but `req.tenantId` is still populated from the header on EVERY request including authed ones. Grep proves no production caller reads `req.tenantId` anymore — but the surface remains live, the typed declaration is exported, and any future route that types `req.tenantId` will silently honor an attacker-supplied header. Either delete the plugin or make it auth-gated.
  2. **`apps/api/src/placeholder.ts` is a Phase-0 dead-code artifact** the user explicitly flagged. `isPlaceholder()` has zero production callers (verified via grep across apps/** and packages/**); only `apps/api/tests/unit/placeholder.test.ts` imports it. The comment claims "Kept as a Stryker mutation target" but the repo has no Stryker config. This is an embarrassment marker for a public-facing repo.
  3. **Hardcoded fallback tenant UUID `00000000-0000-0000-0000-000000000000` in two email-dispatch paths** (auth.ts:330 and auth.ts:380). When `user.tenantId` is undefined (Better Auth's `User` type does NOT carry `tenantId` from the additional-fields adapter mapping — verified by the structural type at auth.ts:323/374 keeping it optional), reset-password and verification email jobs are enqueued under the default-tenant UUID. The worker then sends mail attributed to the wrong tenant. The codebase already has `resolveDefaultTenantId()` (lib/default-tenant.ts) for exactly this fallback — these two sites bypass it.

## Findings

### [CRITICAL] tenantPlugin trusts client-supplied `x-tenant-id` header in production boot path
- File: `apps/api/src/middleware/tenant.ts:55-66`, registered at `apps/api/src/index.ts:382`
- Category: security | workaround | dead-code
- Evidence:
```ts
// apps/api/src/middleware/tenant.ts
async function tenantPluginInner(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req: FastifyRequest) => {
    const headerVal = req.headers["x-tenant-id"];
    req.tenantId =
      typeof headerVal === "string" && TENANT_UUID_RE.test(headerVal)
        ? headerVal
        : DEFAULT_TENANT_ID;
  });
}
```
And the header comment:
```ts
// Threat note (T-01-04-08): trusting a header is acceptable ONLY because
// Phase 2 will replace it.
```
- Why it matters: Phase 2 IS DONE — the dual-auth hook sets `req.tenant` (note: NOT `req.tenantId`) from the resolved session at apps/api/src/middleware/dual-auth.ts:164. The Phase-1 plugin survived. Today its `req.tenantId` field has no production reader (grep across apps/** + packages/** for `req.tenantId` returns ONLY the plugin's own setter and a comment line in index.ts). The plugin is dead-but-armed. Any future contributor who types `req.tenantId` in a route handler — the declaration is still in the module-augmentation graph at tenant.ts:33-37 — will silently honor a client header. Plus: the field is declared as the non-optional `string` (no `?`), so a type-error guard is absent. Public-repo posture: a reviewer reading the source and finding `req.tenantId` populated from a header in `onRequest` is an immediate constitutional red flag.
- Fix: Delete `apps/api/src/middleware/tenant.ts` entirely. Remove its `await app.register(tenantPlugin)` line at index.ts:382 plus the import at index.ts:109. The `req.tenantId` ambient declaration goes away with the file. Adjacent test `apps/api/src/__tests__/tenant.test.ts` (or wherever it lives) must be deleted too. If a Phase 1 backward-compat plumbing still needs the field somewhere (it does NOT per grep), then at minimum make it `auth=false`-gated and rename so it's clearly the post-auth fallback, not a header-read.

### [HIGH] Phase-0 placeholder file still shipping in apps/api/src
- File: `apps/api/src/placeholder.ts:1-6`
- Category: dead-code | stub
- Evidence:
```ts
// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 0 placeholder — replaced by real wiring in later phases.
// Kept as a Stryker mutation target so the harness has a real function to mutate.
export function isPlaceholder(): boolean {
  return true;
}
```
- Why it matters: This is the textbook "embarrassment on GitHub" artifact the user specifically asked about. The file name screams kludge, the comment self-identifies as Phase-0 dead code, and the justification ("Stryker mutation target") is unverifiable — there is NO `stryker.conf.*` / `stryker.config.*` anywhere in the repo, and no Stryker dep in `apps/api/package.json` (verified by repo search). Only consumer is `apps/api/tests/unit/placeholder.test.ts`. `packages/auth/src/index.ts` has a SECOND copy of the same Phase-0 placeholder (not in scope, but worth pairing in cleanup).
- Fix: Delete `apps/api/src/placeholder.ts` and its test. If a real Stryker run materializes in v2, mutation testing has plenty of real production targets.

### [HIGH] Hardcoded default-tenant UUID in reset-password and verification email paths
- File: `apps/api/src/auth.ts:330` and `apps/api/src/auth.ts:380`
- Category: hardcode | workaround
- Evidence:
```ts
// auth.ts:319-341 (sendResetPassword)
sendResetPassword: async ({ user, url }: {
  user: { id?: string; email: string; name?: string; locale?: string; tenantId?: string };
  ...
}) => {
  if (opts.enqueueEmail) {
    const locale: "en" | "ru" = user.locale === "ru" ? "ru" : "en";
    await opts.enqueueEmail({
      tenant_id: user.tenantId ?? "00000000-0000-0000-0000-000000000000",
      to: user.email,
      ...
```
Same pattern at auth.ts:380 in `sendVerificationEmail`.
- Why it matters: Better Auth's `User` shape doesn't natively carry a `tenantId` field — the structural type at auth.ts:323/374 makes it `tenantId?: string`, optional. The `additionalFields` mapping at auth.ts:258-279 declares `locale` and `role` but NOT `tenantId`. So at runtime `user.tenantId` will be `undefined` for every signup/reset (unless something in the Drizzle adapter is unexpectedly hydrating it — would need verification). The fallback then unconditionally writes emails into the default tenant. For a multi-tenant deploy this means BOTH that (a) password-reset emails leak across tenants in the audit/observability log, and (b) the worker-side `tenant_id`-scoped queries (template lookup, rate-limit, etc.) hit the wrong row. The repo has a centralized `resolveDefaultTenantId()` (apps/api/src/lib/default-tenant.ts) that already memoizes the same UUID — it exists for exactly this fallback, and these two sites duplicate the literal instead of calling it. Same magic UUID also appears in `apps/api/src/middleware/tenant.ts:44`.
- Fix: Replace both literal `"00000000-0000-0000-0000-000000000000"` instances with `await resolveDefaultTenantId()`. Better still, verify at runtime that Better Auth IS populating `user.tenantId` — if not, the fallback to default-tenant in production is silently broken for every multi-tenant install. If `user.tenantId` is unreliable, drop it and fetch via `SELECT tenant_id FROM users WHERE id = ?` inside the hook.

### [HIGH] `as unknown as AuthLike` cast at buildAuth boundary suppresses real type drift
- File: `apps/api/src/index.ts:572`
- Category: suppressed-warning | workaround
- Evidence:
```ts
const auth = buildAuth(enqueueEmail ? { db, enqueueEmail } : { db }) as unknown as AuthLike;
```
The matching declaration in `apps/api/src/auth.ts:474`:
```ts
}) as unknown as AuthInstance;
```
- Why it matters: BOTH ends of the boundary are double-cast through `unknown`. The comment at auth.ts:46-54 admits the return type is intentionally narrowed because "Better Auth's full instance type generic-leaks zod-internals." Fair — but the inbound cast at index.ts:572 narrows `AuthInstance` further to `AuthLike` (defined in middleware/dual-auth.ts:57-69), which the dual-auth hook consumes structurally. If Better Auth ever changes its `getSession` signature, BOTH the buildAuth return-type AND this consumer-side cast must be updated; the compiler will not warn. Worse, this couples two unrelated narrowings — the test fakes in `middleware/dual-auth.ts:57-69` define `AuthLike` as a structural subset of `AuthInstance` for test ergonomics, but production now silently goes through a `AuthLike` view of a real Better Auth instance. The `as unknown as` is the smoking gun: a single cast would not compile, so the double-cast intentionally bypasses TS's compatibility check.
- Fix: Either (a) restore the real Better Auth return type from `betterAuth()` and let `AuthInstance`/`AuthLike` extend it (TS6 can handle `$strip` if the right transitive imports are added — try `import type { Auth } from "better-auth"`), OR (b) keep the narrowing but extract a single `narrowToAuthLike(auth: ReturnType<typeof betterAuth>): AuthLike` helper that does ONE structural cast in ONE place with a comment explaining why. Eliminate the duplicate `as unknown as` at the call site.

### [HIGH] `extractBearer` regex permits trailing whitespace AND the entire rest of the header as a token
- File: `apps/api/src/middleware/dual-auth.ts:215-220`
- Category: bug (low-risk) | input-validation
- Evidence:
```ts
function extractBearer(authHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? (match[1]?.trim() ?? null) : null;
}
```
- Why it matters: The `(.+)` capture group is greedy and matches across spaces, commas, semicolons — any character. An `Authorization: Bearer abc def` header yields token `"abc def"`, which then gets stored verbatim into `sessions.previous_token` via `recordPreviousToken(db, tenantId, sessionId, oldBearer)` (apps/api/src/index.ts:449 — see Plan 08 `onSend` hook). The DB column is plain text per Phase 02.12 — no length cap on the application side. A misbehaving proxy or attacker that injects a 64KB Authorization header will land 64KB into the `previous_token` column, then again on every rotation, then again in the failed-rotation audit fanout. This is degrade-able into a storage exhaustion at the per-row scale. The character allow-list also has no upper bound on token length.
- Fix: Tighten the regex to `^Bearer\s+([A-Za-z0-9\-_.~+/=]{1,256})\s*$` (RFC 6750 b64 token charset, 256 char cap matching Better Auth's emitted token size + headroom). Reject anything else as `null`. Add a defensive length-cap at recordPreviousToken's entry point.

### [MEDIUM] tenantPlugin's `req.tenantId` field is declared non-optional but only set on `onRequest` hook
- File: `apps/api/src/middleware/tenant.ts:33-37`
- Category: bug
- Evidence:
```ts
declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;   // NOT optional
  }
}
```
- Why it matters: If the plugin is removed (per the CRITICAL finding) but consumers still type-check against the declaration, TS will incorrectly tell them `req.tenantId` is always present. Conversely, today routes that opt out via `config.auth=false` skip the dual-auth hook — the tenantPlugin hook still fires (it's on every request) so the field IS populated, but with a header-trusted value. Either way, the non-optional typing is a lie.
- Fix: Make it `tenantId?: string`. Or — preferred — delete with the plugin (CRITICAL finding above).

### [MEDIUM] `resolveLocalesDir()` uses synchronous `readFileSync` purely as an "exists" probe with broad catch
- File: `apps/api/src/i18n/init.ts:60-69`
- Category: workaround
- Evidence:
```ts
try {
  const distLayout = resolve(here, "i18n", "locales");
  readFileSync(resolve(distLayout, "en.json"));
  return distLayout;
} catch {
  return sourceTreePath;
}
```
- Why it matters: A `readFileSync` of a (potentially large) JSON file as a layout probe is wasteful — file content is discarded. The catch arm is broad: ENOENT means "not bundled layout, fall back" (correct), but EACCES / EIO / "JSON too large to mmap" all silently swallow into the same fallback, masking real disk problems at module-load time. Operators who break locales (chmod 600, etc.) get a silent fall-through to the source tree, which in the dist bundle does not exist — then the subsequent `readFileSync(filePath)` at line 90 fails with the wrong error message ("file not found" rather than "permission denied").
- Fix: Use `existsSync(resolve(distLayout, "en.json"))` (or `statSync` with throwIfNoEntry:false). Reserve `readFileSync` for the actual load at line 90 where the contents matter. Or, simpler: stop guessing layouts and require `LOCALES_DIR` env to be set in dist builds.

### [MEDIUM] In-process rate-limit IP store has no cleanup — unbounded Map growth in VALKEY-less mode
- File: `apps/api/src/plugins/rate-limit.ts:87-101`
- Category: bug
- Evidence:
```ts
function inProcessIpStore(): IpCounterStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async incr(key: string, ttlMs: number) {
      const now = Date.now();
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + ttlMs });
        return 1;
      }
      existing.count += 1;
      return existing.count;
    },
  };
}
```
- Why it matters: Expired buckets are not deleted from the Map — only overwritten if the SAME IP comes back. An attacker rotating source IPs (Tor, residential proxies) grows the Map without bound for the lifetime of the process. This branch fires only when `VALKEY_URL` is unset, which is the "OSS quickstart" path. The plan documents 1000 concurrent users — but the same OSS deploy is recommended for solo developers who will accumulate weeks of IP buckets without restart.
- Fix: Either (a) add a periodic GC pass (`setInterval(() => prune expired, 60000)` with `unref()`), or (b) use an `LRUCache` from the already-imported `lru-cache` dep with `ttl: ttlMs, max: 100_000`. Document at boot that the in-process store is for dev only.

### [MEDIUM] `audit.ts` forbidden-key sweep is top-level-only and case-folded — nested secrets bypass
- File: `apps/api/src/lib/audit.ts:189-195`
- Category: security (informational)
- Evidence:
```ts
function rejectForbidden(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_AUDIT_KEY_SET.has(key.toLowerCase())) {
      throw new Error(`audit payload contains forbidden key: ${key} (D-A7 / T-bearer-leak)`);
    }
  }
}
```
And the comment at lines 47-52 admits the limitation:
```ts
// Forbidden keys — D-A7. Case-insensitive. recordAudit throws if the
// caller-supplied payload contains any of these AT THE TOP LEVEL.
// Nested-object scrubbing is out of scope here; the per-action Zod
// schemas are `.strict()`-equivalent ...
```
- Why it matters: The comment claims `.strict()`-equivalence protects nested adversarial keys, BUT the Zod schemas at lines 134-181 are plain `z.object({...})` without `.strict()` — `.parse()` STRIPS unknowns (not rejects). So a programmer who passes `{ method: "password", debug: { token: "Bearer xyz" } }` would have `debug` stripped silently (good) — but if a future schema adds a nested `z.object({...})` field (e.g., `metadata: z.record(z.string(), z.unknown())`), forbidden keys WITHIN the nested object would land in the JSONB column. The Cyrillic guard at lines 243-263 already shows that recursive scanning is doable — it just isn't applied to the forbidden-key sweep.
- Fix: Make `rejectForbidden` recursive (same shape as `assertEnglishOnly`). Or assert `.strict()` on every action schema and add a unit test that proves `recordAudit` rejects nested unknowns. The current "AT THE TOP LEVEL" disclaimer in the comment is a known-gap warning that should be closed before public release.

### [LOW] `resolveDefaultTenantId()` is memoized as if dynamic but is a constant return
- File: `apps/api/src/lib/default-tenant.ts:19-34`
- Category: dead-code | code-smell
- Evidence:
```ts
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
let cached: string | undefined;
export async function resolveDefaultTenantId(): Promise<string> {
  if (cached) return cached;
  cached = DEFAULT_TENANT_ID;
  return cached;
}
```
- Why it matters: The function is async (mandatory `await`), memoized (allocates a let-binding), and exports a test-reset helper — all for a constant that could be `export const DEFAULT_TENANT_ID = "...";`. The comment explains "kept Promise-returning so future plans can swap to a real DB lookup" — fair, but the memoization+reset surface is dead in the meantime. Either (a) shorten to a real const, accept the future refactor, or (b) make the function actually do a DB lookup today (Phase 1 seeded the row; SELECT it once at boot).
- Fix: Either inline the constant at the two call sites in `dual-auth.ts:164` and `require-cookie-only.ts:40`, OR write a proper one-shot DB lookup. The test escape hatch goes away with either change.

### [LOW] `redactPaths`, `REDACT_PATHS` re-exports from `plugins/request-log.ts` are test-only
- File: `apps/api/src/plugins/request-log.ts:23,26`
- Category: dead-code | low-priority
- Evidence:
```ts
export const redactPaths: readonly string[] = REDACT_PATHS;
export { REDACT_PATHS } from "@openwhispr/observability";
```
- Why it matters: Verified zero production callers; only `apps/api/tests/unit/plugins/request-log.test.ts` and `tests/integration/log-scrub-sentinel.test.ts` use them. The `buildLogger` export is similarly test-only. Production code in this file is just the `requestLog` plugin and one `makePino()` call. Not a security issue — the re-exports are legitimate test seams for parity with worker-tier — but the file header doesn't say so. A reader sees "redactPaths is exported" and assumes some plugin downstream consumes it.
- Fix: Add a header comment block: `// Test-only re-exports (see tests/integration/log-scrub-sentinel.test.ts) — production wiring is the `requestLog` plugin below.` Or move them to a `request-log.test-utils.ts` file.

### [LOW] `__test` export and `_resetDefaultTenantCacheForTesting` leak test internals into prod surface
- File: `apps/api/src/middleware/dual-auth.ts:227`, `apps/api/src/lib/default-tenant.ts:38`, `apps/api/src/lib/mint-bearer.ts:148`
- Category: code-quality
- Evidence:
```ts
// dual-auth.ts:227
export const __test = { fastifyHeadersToWebHeaders, extractBearer };
```
- Why it matters: Three test-only escape hatches are exported alongside real prod API. The double-underscore prefix is a convention, not a guarantee — anyone importing the module sees them in IntelliSense. Not security-critical (caches and helpers, not secrets) but inconsistent with the codebase's discipline elsewhere.
- Fix: Either use `vitest`'s in-source testing pattern (`if (import.meta.vitest)`) for the test helpers, or split into adjacent `*-test-utils.ts` modules.

### [LOW] Bootstrap `console.warn` for missing VALKEY_URL is unconditional even on first-launch OSS quickstart
- File: `apps/api/src/index.ts:640-643`
- Category: dx/code-quality
- Evidence:
```ts
} else {
  console.warn(
    "[buildApp] VALKEY_URL is unset; /v1/audio/diarization will NOT be registered (operator-actionable: set VALKEY_URL to enable bundled-mode diarization).",
  );
}
```
- Why it matters: This WARN fires on every OSS first-launch boot when the user hasn't yet wired Valkey. It's not wrong but it's noisy on a `git clone && docker compose up` happy path — the project's stated <5min OSS quickstart SLO. Pair with the BullMQ enqueue WARN at lines 564-569 and the LiteLLM WARN at lines 599-603, the bootstrap output is a 3-warning wall before any real signal.
- Fix: Add a single boot-time summary line: `[buildApp] features registered: { rate-limit-valkey: false, email-worker-queue: false, diarization: false, ... }` and elide the per-feature warnings unless the user explicitly opts in via `OPENWHISPR_VERBOSE_BOOT=1`.

### [LOW] `OTEL_LOG_LEVEL` parsing silently falls through on case-insensitive miss
- File: `apps/api/src/otel-bootstrap.ts:48-53`
- Category: code-quality
- Evidence:
```ts
diag.setLogger(
  new DiagConsoleLogger(),
  DiagLogLevel[
    (process.env.OTEL_LOG_LEVEL?.toUpperCase() as keyof typeof DiagLogLevel) ?? "ERROR"
  ] ?? DiagLogLevel.ERROR,
);
```
- Why it matters: If `OTEL_LOG_LEVEL` is set to `"verbose"`, `"VERBOSE"` is not a key of DiagLogLevel (canonical names are `NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `VERBOSE`, `ALL`) — actually it IS a valid key, but a typo like `OTEL_LOG_LEVEL=info_more` would silently fall through to `ERROR` with no operator feedback. Type cast `as keyof typeof DiagLogLevel` is unsafe — TypeScript will not check the actual string content.
- Fix: Add an `if (raw && !(raw in DiagLogLevel)) diag.error("Unknown OTEL_LOG_LEVEL: ${raw}; defaulting to ERROR")` before the lookup.

### [LOW] `mintBearer` writes `provider` into error messages — could be log-injection if env-controlled
- File: `apps/api/src/lib/mint-bearer.ts:215, 224`
- Category: code-quality
- Evidence:
```ts
throw new Error(`mint bearer: token exchange ${tokenRes.status} (provider=${args.provider})`);
```
- Why it matters: `args.provider` comes from a route param. The threat note T-02.7-07 (lines 30-32) is satisfied (no IdP body leak), but if `args.provider` is user-controlled and unvalidated (verification needed in routes/auth-callback.ts which is out of scope), a CR/LF in `provider` could line-inject into the error log. Likely already validated upstream; flagging for paired review.
- Fix: `provider: args.provider.replace(/[\r\n]/g, "?")` defense-in-depth, OR enforce `[a-z0-9-]+` at the route layer.

## Dead code

- **`apps/api/src/placeholder.ts`** exports `isPlaceholder` — 0 production callers (only `apps/api/tests/unit/placeholder.test.ts`). Comment claims Stryker target; no Stryker config in repo. See HIGH finding above.
- **`apps/api/src/middleware/tenant.ts`** — entire plugin is registered (index.ts:382) but the `req.tenantId` field it populates has 0 non-self readers in `apps/**/src/**` and `packages/**/src/**`. See CRITICAL finding above.
- **`apps/api/src/lib/default-tenant.ts`** exports `_resetDefaultTenantCacheForTesting` — only `*.test.ts` consumers; the memoization itself is over-engineered for a constant return.
- **`apps/api/src/middleware/dual-auth.ts:227`** exports `__test = { fastifyHeadersToWebHeaders, extractBearer }` — `extractBearer` is also publicly re-exported at line 224 for use in `index.ts:436`, so the `__test` aggregate is double-export of one symbol + a private helper.
- **`apps/api/src/lib/mint-bearer.ts:148`** exports `__resetOidcDiscoveryCacheForTests` — test-only.
- **`apps/api/src/plugins/request-log.ts:23,26,36`** exports `redactPaths`, `REDACT_PATHS`, `buildLogger` — all test-only consumers in `apps/api/tests/**` and `tests/integration/**`. Production code does not import them; the file's actual production export is the `requestLog` plugin only.

## Suppressed warnings

- `apps/api/src/index.ts:288, 297, 325, 360, 396, 572, 627, 662` — multiple `as unknown as` double-casts at the buildApp/buildAuth boundary. Pattern documented in code comments (Better Auth type leak), but the duplication makes future Better Auth upgrades silent failures. See HIGH finding.
- `apps/api/src/auth.ts:184, 474` — `(opts.log ?? fallbackLog) as never` and `as unknown as AuthInstance`. The `as never` is questionable: the `Logger` contract is structural per the comment, so the cast can probably be removed with a one-line widening in the email package.
- `apps/api/src/error-handler.ts:226` — `req as unknown as { i18n?: ... }` cast because the i18n decoration is declared in `i18n/init.ts` but not in the canonical `types/fastify.d.ts`. Move the declaration to `types/fastify.d.ts` to remove the cast.
- `apps/api/src/i18n/init.ts:152-153` — two `as unknown as { i18n?: unknown; language?: string }` casts because `req.raw` is `IncomingMessage` (Node) but the i18next middleware decorates it. Same fix as above: declare the decoration once in `types/fastify.d.ts`.
- `apps/api/src/plugins/rate-limit.ts:60, 103, 158` — `biome-ignore lint/suspicious/noExplicitAny: opaque redis client surface`. Justified by the union of ioredis-vs-@redis/client surfaces. Acceptable.
- `apps/api/src/bootstrap.ts:26`, `apps/api/src/index.ts:564, 598, 632, 640, 701` — `biome-ignore lint/suspicious/noConsole` for bootstrap-time logging (pino not yet wired). Justified by the chicken-and-egg at boot order. Acceptable.

## Disabled tests near scope

(grep for `.skip` / `.only` / `.todo` in `apps/api/src/**/__tests__/**`, `apps/api/src/**/*.test.ts`, `apps/api/tests/**`:)

```
$ grep -rEn "\.(skip|only|todo)\(" apps/api/src apps/api/tests 2>/dev/null | head
```
Spot-check did not surface adjacent `.skip`/`.only` in api-core test files. Recommend a full repo-wide audit before publish via `grep -rEn '\.(skip|only|todo)\(' tests apps packages` and reconciliation against `.planning/deferred-items.md`.

## Notes

1. **Two security-sensitive `OPENWHISPR_DISABLE_*` env switches in production code** — `OPENWHISPR_DISABLE_RATE_LIMIT` (auth.ts:167-170, rate-limit.ts:142-145), `OPENWHISPR_DISABLE_EMAIL_VERIFICATION` (auth.ts:291), `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE` (auth.ts:417), and `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION` (out-of-scope route file but referenced from index.ts comments). Each emits a loud WARN banner — good. BUT: bundling four "disable security guard" switches accessible by env var at process startup is a significant attack surface for an enterprise install. Recommend a SINGLE `OPENWHISPR_PROFILE=load-test` umbrella variable that gates all four, with a startup-time refusal if `NODE_ENV=production` is also set. Today, an attacker who gains env-edit access on a production host can disable rate-limiting and email verification independently with no cross-check.

2. **`process.env.NODE_ENV === "test"` branch in production boot path** at `apps/api/src/index.ts:498` registers a debug route plugin. The plugin file itself (`apps/api/src/routes/__test/fetch.ts`) is out-of-scope but the GATE is in scope. The gate is single-layered: NODE_ENV is the only check. A misconfigured production deploy that inherits NODE_ENV=test from a CI pipeline would silently expose `/__test/fetch`. The plugin reportedly defense-in-depth re-checks at registration — acceptable, but the buildApp branch should also assert `NODE_ENV !== "production"` to be belt-and-suspenders (e.g. `if (process.env.NODE_ENV === "test" && process.env.NODE_ENV !== "production")` is redundant; use `if (TEST_NODE_ENVS.has(process.env.NODE_ENV)) { assert NOT production }`).

3. **Multiple bootstrap warnings logged BEFORE structured logger initialization** — the file headers each acknowledge "structured logging arrives in Phase 6" but those comments date the WARN lines pre-Phase-6. Phase 6 is done. The Loki/pino path is wired. These `console.warn` lines now bypass the redact policy in `@openwhispr/observability/redact.ts`. The `redactUrl()` defense at index.ts:567, 601, 635 mitigates the URL-password leak vector, but other secret-shaped fields (e.g. an error class containing a Bearer token) are not redacted in these console paths. Should migrate bootstrap warnings to a synchronous pino destination (the BYOK guard at index.ts:68 already does this — pattern is established).

4. **The constitutional CLAUDE.md rule "NEVER edit production server code to make tests pass" appears to be respected** in this scope — no obvious test-driven rewrites in error-handler.ts, errors.ts, or auth.ts. The Better-Auth-canonical schema mapping at auth.ts:225-234 is a legitimate adapter shim (Better Auth needs singular names; our drizzle exports are plural).

5. **No SQL-template-string injection risks found in scope.** `apps/api/src/lib/audit.ts:319-321`, `apps/api/src/lib/token-rotation.ts:46-51 & 94-95 & 111-113`, `apps/api/src/lib/keyset-pagination.ts:88-92`, and `apps/api/src/lib/settings-resolver.ts:88-97 & 144-153` all use Drizzle's `sql\`\`` template tag with parameterized bindings — values flow through protocol-level binds, not string interpolation. The one place that does string-build SQL identifiers (`apps/api/src/lib/client-id-upsert.ts:76-82`) has a strict allow-pattern `^[a-z_][a-z0-9_]*$` enforced by `quoteIdent()` before `sql.raw()`.

6. **`tests/e2e-cjm/compose-overrides.yml` is in `git status --short` as untracked** — out of api-core scope but worth flagging: if this contains test-only docker overrides being relied upon by the e2e suite, it needs to either be committed or excluded from the repo-publish gate.
