# Re-Review: api-core (v2.2 milestone close)

Branch: main @ b830cc4
Scope: apps/api/src/{bootstrap,auth,index,error-handler,errors,otel-bootstrap}.ts + config/** middleware/** plugins/** types/** lib/** (excluding lib/web-search) + i18n/**
Note: `placeholder.ts` deleted (CR-1 in original review) — no longer in scope.

## Summary
- Files reviewed: 27 (5 fewer than original — `placeholder.ts`, `middleware/tenant.ts` deleted; `__tests__/no-tenant-plugin-regression.test.ts` confirms deletion)
- Findings: CRITICAL=0 HIGH=2 MEDIUM=4 LOW=5
- Top closures since original:
  1. **CR-1 closed** — `middleware/tenant.ts` deleted; `index.ts:386-390` carries a tombstone comment; `req.tenantId` ambient declaration gone. Regression guarded by `apps/api/tests/unit/__tests__/no-tenant-plugin-regression.test.ts`.
  2. **HI-01 closed** — `apps/api/src/placeholder.ts` + its test deleted. `grep -r "placeholder" apps/api/src` returns zero hits.
  3. **HI-03 closed** — both `auth.ts:425` (`sendResetPassword`) and `auth.ts:476` (`sendVerificationEmail`) now route the fallback through `await resolveDefaultTenantId()` (Phase 41.a / HI-03 comments cite the closure).
- Top open / new risks:
  1. **HI-05 (extractBearer greedy regex) NOT closed** — `middleware/dual-auth.ts:218` still uses `/^Bearer\s+(.+)$/i`. Storage-exhaustion impact mitigated by Phase 33's fingerprint-only `previous_token_fp` (32-byte SHA-256, no longer raw text), but the input-validation gap remains: a 64KB Authorization header still flows verbatim into `recordPreviousToken` (hashed before persist) AND into Better Auth's `getSession({headers})` web-headers map.
  2. **NEW WR — `tryPreviousToken` follow-up email SELECT runs without `withTenant()`** — `lib/token-rotation.ts:144-147` issues `SELECT email FROM users WHERE id = $1` directly on the appDb without binding `app.current_tenant_id`. The `users` table has tenant-isolation RLS. Either (a) the RLS GUC inherited from a prior request leaks across pool checkout and returns the wrong tenant's row, or (b) the query returns zero rows in production (unbound GUC → RLS deny). The catch arm hides this as `email = null`. Either outcome is silently wrong.

## Findings

### [HIGH] `extractBearer` regex still permits trailing whitespace and unbounded token length
- File: `apps/api/src/middleware/dual-auth.ts:215-220`
- Category: bug | input-validation
- Evidence:
```ts
function extractBearer(authHeader: string | string[] | undefined): string | null {
  const value = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? (match[1]?.trim() ?? null) : null;
}
```
- Status: Reported as HI-05 in original review; not closed.
- Why it still matters in v2.2: Phase 33 moved `sessions.previous_token` to a 32-byte SHA-256 fingerprint (`token-rotation.ts:59 createHash('sha256').update(oldToken, 'utf8')`), so the original storage-exhaustion impact is now bounded at 32 bytes per row. BUT: (a) the SHA-256 computation still hashes the full attacker-controlled input — at 64KB inputs that is N×64KB CPU work per spoofed-rotation request, a usable DoS amplifier; (b) Better Auth's `getSession({ headers })` accepts the same unbounded value through `fastifyHeadersToWebHeaders` (line 138) and constructs a Web `Headers` object; the `Headers` API has its own implementation-defined size caps and may either throw (uncaught → 500) or quietly accept; (c) the explicit cap is a one-line discipline that prevents downstream code paths from re-introducing the original bug.
- Fix: `^Bearer\s+([A-Za-z0-9\-_.~+/=]{1,512})\s*$` (RFC 6750 b64 token charset, 512-char cap to comfortably exceed Better Auth's 32-char opaque tokens + any future signed-cookie growth).

### [HIGH] `tryPreviousToken`'s follow-up email SELECT runs without `withTenant()` (RLS GUC unbound)
- File: `apps/api/src/lib/token-rotation.ts:142-152` (introduced by WR-05 fix)
- Category: security | RLS-violation
- Evidence:
```ts
let email: string | null = null;
try {
  const er = (await db.execute(
    sql`SELECT email FROM users WHERE id = ${first.user_id}::uuid LIMIT 1`,
  )) as { rows: Array<{ email: string }> };
  email = er.rows[0]?.email ?? null;
} catch {
  email = null;
}
```
- Why it matters: `users` is RLS-policed by `app.current_tenant_id`. The PRIOR `lookup_session_by_previous_token` SECURITY DEFINER function deliberately bypassed RLS (line 86-90 of original review comment). The new follow-up SELECT runs on the same `db` handle on the next pool checkout, with NO `withTenant(db, tenantId, ...)` wrapper. Two failure modes:
  1. **Stale GUC** — PgBouncer transaction-mode pool checkout: if the prior request set `app.current_tenant_id` and connection is reused, the SELECT runs under THAT tenant's RLS scope, returns wrong-tenant email (or 0 rows). Since `withTenant()` is normally how the GUC is set/reset, leakage is a real concern when this helper is called outside an existing `withTenant` block.
  2. **Empty GUC** — Fresh connection with `app.current_tenant_id` unset: RLS policy denies all rows; `er.rows[0]` is undefined; `email = null` silently. The new WR-05 fail-loud sentinel `'<previous-token-no-email>'` (index.ts:418) never sees a real email, defeating the WR-05 fix.
  
  The bare `catch { email = null }` makes BOTH failure modes invisible. Audit logs and downstream consumers will see the sentinel string in production with no signal.
- Fix: Wrap the email lookup in `withTenant(db as TransactionalDb<ExecutableTx>, first.tenant_id, async tx => tx.execute(...))`. The `tenant_id` is already resolved at line 130; thread it through. Alternatively: extend the SECURITY DEFINER lookup function to return `(user_id, tenant_id, email)` in one round-trip so the API never needs the cross-table read.

### [MEDIUM] `resolveLocalesDir()` still uses `readFileSync` as a layout probe with broad catch
- File: `apps/api/src/i18n/init.ts:60-69`
- Category: workaround
- Status: Reported as MED-2 in original review; unchanged.
- Why still matters: ENOENT vs EACCES vs JSON-parse failures all collapse into the same fallback. Operators who restrict locale-file permissions get the wrong error at the subsequent `readFileSync(filePath)` at line 90 ("file not found" instead of "permission denied").
- Fix: Use `existsSync()` or `statSync(..., {throwIfNoEntry:false})` for the layout probe; reserve `readFileSync` for the actual content load at line 90.

### [MEDIUM] In-process rate-limit IP store has no GC — Map grows without bound in OSS-mode boot
- File: `apps/api/src/plugins/rate-limit.ts:87-101`
- Category: bug
- Status: Reported as MED-3 in original review; unchanged.
- Why still matters: Phase 33 + 41 work did not touch this branch. Production OSS quickstart (`docker compose up` without `VALKEY_URL`) accumulates buckets for every distinct source IP across the process lifetime. An IP-rotating attacker grows the Map without bound. Documented in the comment at line 41-43 ("if VALKEY_URL is absent, fall back to in-process counters") but no operational safeguard ships.
- Fix: Either `LRUCache` from `lru-cache` (already a transitive dep) with `ttl: ttlMs, max: 100_000`, or `setInterval(..., 60_000).unref()` prune pass.

### [MEDIUM] `audit.ts` forbidden-key sweep still top-level only despite recursive Cyrillic walker existing in the same module
- File: `apps/api/src/lib/audit.ts:189-195` + comment at 46-51
- Category: security (defense-in-depth)
- Status: Reported as MED-4 in original review; unchanged — `assertEnglishOnly` (lines 243-263) shows the recursive walker pattern was added for T-10-01 in Phase 10-01d but `rejectForbidden` was NOT updated to use it.
- Why still matters: The comment at lines 47-51 claims `.strict()`-equivalence as the nested-key defense but the schemas at 134-181 are plain `z.object({...})` (strip on unknowns, NOT reject). Any future schema adding a nested `z.record(...)` or `z.object({...}).passthrough()` field would land a forbidden key in JSONB. The two walkers (`assertEnglishOnly` and `rejectForbidden`) should share one implementation.
- Fix: Make `rejectForbidden` recursive — copy the structure of `assertEnglishOnly`. One-screen change, eliminates a known-gap comment.

### [MEDIUM] Multiple `as unknown as` double-casts at the buildApp/buildAuth boundary
- File: `apps/api/src/index.ts:296, 305, 333, 368, 404, 580, 635, 670`; `apps/api/src/auth.ts:323, 570`
- Category: suppressed-warning | workaround
- Status: Reported as HI-04 in original review; unchanged.
- Why still matters: The auth.ts:323 cast (`as unknown as ReturnType<typeof drizzleAdapter>`) is new in Phase 33 (envelope-encryption lens wrapping) and inherits the same "Better Auth type leak" justification. The buildApp call site at index.ts:580 narrows further to `AuthLike`. Both ends remain double-cast, future Better Auth upgrades will silently pass tsc. Severity dropped to MEDIUM because Plan 33-04 added structural validation tests (`__tests__/auth-schema-mapping.test.ts`) that catch the most likely drift modes.
- Fix: Extract one `narrowToAuthLike(buildAuth(...))` helper with the cast in one place + a comment. Eliminate the duplicate at the call site. Alternatively wait for Better Auth 2.x's typegen.

### [LOW] `resolveDefaultTenantId()` still memoizes a constant return
- File: `apps/api/src/lib/default-tenant.ts:19-34`
- Category: dead-code | code-smell
- Status: Reported as LOW-1 in original review; unchanged.
- Why still matters: Function is async, memoized, exports a test-reset helper — all for a literal constant return. Now reachable from 4 call sites (`dual-auth.ts:164`, `require-cookie-only.ts:40`, `auth.ts:425`, `auth.ts:476`, `index.ts:357`); the post-HI-03 fan-out makes the test-reset helper escape hatch more brittle, not less.
- Fix: Inline the constant and delete the helper, OR write a real one-shot DB lookup. As-is: low harm, persistent code smell.

### [LOW] Test-only re-exports in `plugins/request-log.ts` still unlabelled
- File: `apps/api/src/plugins/request-log.ts:23, 26, 36`
- Category: dead-code | doc gap
- Status: Reported as LOW-2 in original review; unchanged.
- Fix: One-line header comment marking `redactPaths`, `REDACT_PATHS`, `buildLogger` as test-only re-exports.

### [LOW] `__test` and test-only escape hatches still leak into production module surface
- File: `apps/api/src/middleware/dual-auth.ts:227`, `apps/api/src/lib/default-tenant.ts:38`, `apps/api/src/lib/mint-bearer.ts:148`
- Category: code-quality
- Status: Reported as LOW-3 in original review; unchanged.

### [LOW] Bootstrap `console.warn` walls fire on every OSS first-launch boot
- File: `apps/api/src/index.ts:564-578, 600-612, 640-651`
- Category: dx
- Status: Reported as LOW-4 in original review; unchanged.

### [LOW] `OTEL_LOG_LEVEL` parsing silently falls through on typo
- File: `apps/api/src/otel-bootstrap.ts:48-53`
- Category: code-quality
- Status: Reported as LOW-5 in original review; unchanged.

## Dead code

- **`apps/api/src/lib/default-tenant.ts:38`** — `_resetDefaultTenantCacheForTesting`: test-only consumer.
- **`apps/api/src/middleware/dual-auth.ts:227`** — `__test = { fastifyHeadersToWebHeaders, extractBearer }`: `extractBearer` is also publicly re-exported at line 224.
- **`apps/api/src/lib/mint-bearer.ts:148`** — `__resetOidcDiscoveryCacheForTests`: test-only.
- **`apps/api/src/plugins/request-log.ts:23, 26, 36`** — `redactPaths`, `REDACT_PATHS`, `buildLogger`: test-only consumers; production uses only the `requestLog` plugin.
- `placeholder.ts` and `middleware/tenant.ts` previously listed as dead code are DELETED. ✓

## Suppressed warnings

- **`as unknown as` double-casts**: index.ts (8 sites), auth.ts (2 sites). See MEDIUM finding. The auth.ts:323 cast is new in Phase 33 (lens wrap), same justification as the historical buildAuth return-type narrowing.
- **`biome-ignore noConsole` for bootstrap warnings**: 6 sites in index.ts + 1 in bootstrap.ts. Justified by boot-order chicken-and-egg before pino — acceptable, but pair with the LOW-4 finding (consider migrating to a sync pino-stderr at boot like `apps/api/src/index.ts:69`).
- **`biome-ignore noExplicitAny` for redis client**: 3 sites in `plugins/rate-limit.ts`. Justified by ioredis-vs-@redis/client union surface. Acceptable.
- **`lib/api-error-status.ts:52`** `as unknown as { status?: unknown }` — narrow defensive cast around Better Auth APIError's untyped `status` property. Acceptable.
- **`i18n/init.ts:152-153`** two `as unknown as { i18n?: unknown; language?: string }` — i18next middleware decorates `req.raw` which has no module-augmentation declaration in `types/fastify.d.ts`. Closure available: extend types/fastify.d.ts (single-line declaration) and drop both casts. Same comment applies to `error-handler.ts:226`.

## Disabled tests near scope

`grep -rEn '\.(skip|only|todo)\(' apps/api/src apps/api/tests` returned NO results in the api-core test surface. ✓

## NODE_ENV branches outside boundary files (LOCKER-01)

Grep surfaces 4 sites:
- `apps/api/src/index.ts:506` (test-only route gate) — fires only when `NODE_ENV === "test"`; documented + defense-in-depth at registration site.
- `apps/api/src/auth.ts:520` (`useSecureCookies: NODE_ENV === "production"`) — allowlisted in `tools/lint-no-env-branches.allowlist.txt` (issue-31-boundary-better-auth-cookies).
- `apps/api/src/lib/ssrf-dispatcher.ts:59, 163` — allowlisted (issue-31-DI-fallback / DI-fallback-jsdoc).

LOCKER-01 lint passes; surfacing here for review-completeness.

## Hardcode / secrets

- `apps/api/src/auth.ts:326` — `baseURL: process.env.AUTH_URL ?? "http://localhost:3000"`. The literal `http://localhost:3000` exists in source. LOCKER-03 should refuse this in `apps/api/src/**`; either the rule has an allowlist entry for boot-time-config defaults or the fallback should be removed (production deploys MUST set AUTH_URL; absent it the right move is a loud-fail at boot, not a localhost-bound silent default).
- `apps/api/src/index.ts:664` — `process.env.LITELLM_BASE_URL ?? "http://litellm:4000"` — same pattern; `litellm` is a docker-compose service name (private-host allowlist territory), but the literal still falls under LOCKER-03 unless allowlisted.
- `apps/api/src/lib/default-tenant.ts:19` — `DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000"` is the canonical permanently-allowlisted constant per LOCKER-03; acceptable.

Recommend re-running `pnpm exec tsx tools/lint-no-hardcode.ts` to confirm the two URL fallbacks above are on the documented allowlist; otherwise either remove the fallback or document the entry.

## Security observations (unchanged from original Notes 1-2)

1. **`OPENWHISPR_DISABLE_*` switches in production code path** (auth.ts:235, 380, 513; plugins/rate-limit.ts:143). Each emits a loud WARN — good. Aggregate attack surface unchanged from original review: an env-edit attacker can disable rate-limit + email-verification + cookie-cache independently with no cross-check. Recommend a single `OPENWHISPR_PROFILE=load-test` umbrella that refuses to apply when `NODE_ENV=production` — but Note: LOCKER-01 forbids the cross-check. Either the umbrella lives in `config/*.ts` (the only file allowed to read NODE_ENV) or it stays a documentation discipline.

2. **NODE_ENV=test debug-route gate at index.ts:506**. Single-layer gate. The plugin file allegedly defense-in-depth re-checks at registration. Acceptable; surface for awareness.

3. **No SQL-template-string injection risks found in api-core scope.** All `sql\`\`` template tags use parameterized bindings.

## CLAUDE.md hard-rule compliance

- **HR-1 (no edits to production code to pass tests)**: spot-check across `auth.ts`, `index.ts`, `error-handler.ts`, `token-rotation.ts` shows changes since the original review (CR-1 deletion of `middleware/tenant.ts`; HI-03 fan-out through `resolveDefaultTenantId`; WR-05 email fan-out in `token-rotation.ts`) all align with their cited phase plans and ship adjacent tests. No suspicious test-driven rewrites of production SQL/migrations spotted.
- **HR-2 (deferred-items discipline)**: HI-05's open-status here SHOULD land in `.planning/deferred-items.md` if it isn't being closed in v2.2 — the original review surfaced it under Phase 19a/41 work but the regex remains untouched.

## Closure delta from original review

| Original ID | Severity | Status | Notes |
|---|---|---|---|
| CR-1 — `tenantPlugin` trusts `x-tenant-id` header | CRITICAL | **CLOSED** | `middleware/tenant.ts` deleted; tombstone comment at `index.ts:386-390`; regression test `apps/api/tests/unit/__tests__/no-tenant-plugin-regression.test.ts` |
| HI-01 — `placeholder.ts` Phase-0 dead code | HIGH | **CLOSED** | File + test deleted |
| HI-02 — Hardcoded default-tenant UUID in two email-dispatch paths | HIGH | **CLOSED** | Both `auth.ts:425` and `auth.ts:476` now `await resolveDefaultTenantId()`; comments cite Phase 41.a / HI-03 closure |
| HI-03 — `as unknown as AuthLike` double-cast at buildAuth boundary | HIGH | **OPEN (downgraded to MEDIUM)** | Pattern unchanged; severity dropped because Phase 33 schema-mapping tests catch the most-likely drift modes |
| HI-04 — `extractBearer` greedy regex / unbounded token | HIGH | **OPEN (downgraded to HIGH but de-prioritised)** | Regex unchanged. Storage-exhaustion vector mitigated by Phase 33 fingerprint-only `previous_token_fp` (32 bytes), but CPU-amplifier on hash + Web Headers indirection remain |
| MED-1 — `req.tenantId` non-optional but only header-set | MEDIUM | **CLOSED** | Field deleted with the plugin |
| MED-2 — `resolveLocalesDir()` uses readFileSync as probe | MEDIUM | **OPEN** | Unchanged |
| MED-3 — In-process IP rate-limit Map unbounded | MEDIUM | **OPEN** | Unchanged |
| MED-4 — `audit.ts` forbidden-key sweep top-level only | MEDIUM | **OPEN** | Cyrillic walker pattern exists (lines 243-263) but `rejectForbidden` not retrofitted |
| LOW-1 — `resolveDefaultTenantId()` memoizes constant | LOW | **OPEN** | Unchanged; fan-out from HI-03 closure makes 4 call sites |
| LOW-2 — Test-only re-exports unlabelled in `request-log.ts` | LOW | **OPEN** | Unchanged |
| LOW-3 — `__test` escape hatches in prod surface | LOW | **OPEN** | Unchanged |
| LOW-4 — Bootstrap warn wall on OSS first-launch | LOW | **OPEN** | Unchanged |
| LOW-5 — `OTEL_LOG_LEVEL` typo silent fallthrough | LOW | **OPEN** | Unchanged |
| LOW-6 — `mintBearer` writes `provider` into error message | LOW | **OPEN (verification deferred)** | Out-of-scope upstream validation in `routes/auth-callback.ts`; flagged for paired review |

### New findings since original review

| New ID | Severity | Summary |
|---|---|---|
| NEW-WR — `tryPreviousToken` email SELECT runs without `withTenant()` | HIGH | RLS GUC unbound; either stale-from-pool or empty-deny → silent `email = null` via bare catch; defeats WR-05 fail-loud sentinel |

### Net delta
- Original: CRITICAL=1, HIGH=3, MEDIUM=4, LOW=6
- v2.2 close: CRITICAL=0, HIGH=2, MEDIUM=4, LOW=5
- Closed: 1 CRITICAL, 2 HIGH, 1 MEDIUM
- Downgraded: 1 HIGH → MEDIUM (HI-03 / boundary casts)
- Newly surfaced: 1 HIGH (NEW-WR)

The publishable posture is materially improved: the embarrassment marker (`placeholder.ts`) is gone, the header-trust CRITICAL is closed with a regression test, and the silent-tenant-leak vectors in email dispatch are routed through the central helper. The remaining HIGH-tier risk (`NEW-WR`) is a self-introduced regression from the WR-05 fix and should ship a fix in the same milestone as the WR-05 change or roll back to the SECURITY DEFINER lookup.
