# Review: api-core

Scope: `apps/api/src/{bootstrap,auth,index,error-handler,errors,otel-bootstrap}.ts`,
`apps/api/src/{config,middleware,plugins,types,lib,i18n}/**`.
Out-of-scope (per workflow): all `apps/api/src/routes/**` and tests.
Branch: `main` @ 6e43588.

> Note: the prompt listed `apps/api/src/placeholder.ts` but no such file
> exists in HEAD. That entry is treated as nonexistent — not a finding.

## Summary

- Files reviewed: 33 source files (one ambient `.d.ts`).
- Findings: CRITICAL=1 HIGH=5 MEDIUM=11 LOW=8
- Top 3 production risks before public publication:
  1. **CR-01** — `OPENWHISPR_DISABLE_EMAIL_VERIFICATION=1` / `OPENWHISPR_DISABLE_RATE_LIMIT=1` /
     `OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE=1` / `MOCK_DIARIZATION=true` are unguarded by
     `NODE_ENV` — a single leaked env var in a public-facing deployment disables core
     anti-abuse / verification controls silently. The WARN banner is logged but the
     process keeps running. Loud-fail patterns already exist (`validateAuthBoot`,
     `validateLitellmBoot`, `validateBetterAuthSecretBoot`) — these env knobs should
     join them.
  2. **HI-01** — `apps/api/src/auth.ts:376` defaults `baseURL` to
     `http://localhost:3000` when `AUTH_URL` is unset. `validateAuthBoot()` only
     refuses non-HTTPS in `NODE_ENV=production`; any non-production deployment
     (staging, demo, or operator who forgets to set `NODE_ENV`) will sign cookies
     with no Secure flag against the literal `localhost:3000` baseURL.
  3. **HI-02** — `apps/api/src/index.ts:556` opens the `/__test/fetch` debug
     route on either `NODE_ENV==='test'` *or* `OPENWHISPR_TEST_ROUTES==='true'`.
     The route is an unauthenticated outbound-fetch helper gated only by the SSRF
     dispatcher's operator-chosen allowlist. A misconfigured corp deploy with
     `OPENWHISPR_TEST_ROUTES=true` survives in production.

## Findings

### [CRITICAL] CR-01: Production safety knobs gated only by env presence, no `NODE_ENV` refuse-on-prod

- Files: `apps/api/src/auth.ts:270-273`, `apps/api/src/auth.ts:430`,
  `apps/api/src/auth.ts:562-565`, `apps/api/src/plugins/rate-limit.ts:142-157`,
  `apps/api/src/index.ts:727` (`MOCK_DIARIZATION`).
- Category: security
- Evidence:
  ```ts
  // auth.ts:430
  requireEmailVerification: process.env.OPENWHISPR_DISABLE_EMAIL_VERIFICATION !== "1",
  // plugins/rate-limit.ts:142-157
  function rateLimitDisabled(): boolean {
    const raw = process.env.OPENWHISPR_DISABLE_RATE_LIMIT;
    return raw === "1" || raw === "true";
  }
  // ...if (rateLimitDisabled()) { fastify.log.warn(...); return; }
  // auth.ts:562-565
  cookieCache: process.env.OPENWHISPR_DISABLE_SESSION_COOKIE_CACHE === "1"
    ? { enabled: false } : { enabled: true, maxAge: 5 * 60 },
  // index.ts:727
  const mockDiarization = process.env.MOCK_DIARIZATION === "true";
  ```
- Why it matters: A single leaked `.env` line in a public deployment turns off
  Better Auth's anti-abuse limiter (sign-in brute force), email-verification
  gate, or replaces the diarization route with a fixture. The current
  WARN-log-then-continue policy was written for the docker-compose load-test
  profile; once the repo is public, dev-vs-prod confusion is a much more likely
  threat than misconfigured load-tests. The repository already has the loud-fail
  pattern (`validateAuthBoot`, `validateLitellmBoot`, `validateBetterAuthSecretBoot`,
  `validateEncryptionBoot`) — these knobs are the odd ones out.
- Fix recommendation: In each `rateLimitDisabled()` / `OPENWHISPR_DISABLE_*` /
  `MOCK_DIARIZATION` branch, refuse to boot when `process.env.NODE_ENV === "production"`.
  Exit 78 (`EX_CONFIG`) consistent with `validateAuthBoot`. Document in
  `docs/security.md` that these are dev/load-test only.

---

### [HIGH] HI-01: `AUTH_URL` default `http://localhost:3000` permits unsecured cookies outside `NODE_ENV=production`

- File: `apps/api/src/auth.ts:376`
- Category: security
- Evidence:
  ```ts
  baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
  ```
  Combined with `apps/api/src/config/auth.ts:79`:
  ```ts
  if (isProduction && !isHttps) { onFail(...); }
  ```
- Why it matters: `validateAuthBoot()` only refuses non-HTTPS in production.
  Staging / `NODE_ENV=development` / unset `NODE_ENV` accepts `http://...` and
  `useSecureCookies` is then derived from `isHttps` → false → Better Auth emits
  session cookies *without* the `Secure` flag. The hardcoded `localhost:3000`
  default also masks operator misconfiguration in any non-production env.
  Related: `apps/api/src/otel-bootstrap.ts:42` (`http://localhost:4317`) and
  `apps/api/src/index.ts:738` (`http://litellm:4000`) — both should require
  explicit env or refuse boot in prod.
- Fix recommendation: Drop the default. `validateAuthBoot()` already returns the
  validated `authUrl`; consume it: `baseURL: validateAuthBoot().authUrl`. The
  test-mode branch in `config/auth.ts:65-70` keeps the harness working without
  the literal `localhost:3000` leaking into production code.
- **Status:** CLOSED (already-resolved) — Phase 57 Track E replaced the literal
  with `validateIngressBoot().ingressBaseUrl` (`auth.ts:430`); confirmed Phase 62
  (`verify-first.log`). No production change needed.

---

### [HIGH] HI-02: `/__test/fetch` debug route opens on `OPENWHISPR_TEST_ROUTES=true` regardless of NODE_ENV

- File: `apps/api/src/index.ts:550-558`
- Category: security
- Evidence:
  ```ts
  if (process.env.NODE_ENV === "test" || process.env.OPENWHISPR_TEST_ROUTES === "true") {
    await app.register(buildDebugFetchRoutes());
  }
  ```
- Why it matters: `OPENWHISPR_TEST_ROUTES=true` survives in production env if
  copied from a dev `.env` (a real risk for the OSS launch). The debug route is
  documented as an outbound-fetch helper; its only mitigation is the SSRF
  dispatcher allowlist. Although the SSRF gate is robust (`lib/ssrf-dispatcher.ts`
  is a defense-in-depth substrate), shipping a production-mounted unauthenticated
  arbitrary-URL fetcher gated only by an env var name is a public-launch hazard.
  Compare `auth.ts:264-273` which documents "MUST NOT be set in production" but
  does not enforce it.
- Fix recommendation: Refuse to register the debug route when
  `NODE_ENV === "production"`. Better: gate registration on a build-time symbol
  so the code is tree-shaken out of the dist bundle entirely.
- **Status:** CLOSED 2026-05-20 — Phase 62, commit `ca5132a9`. Both gate sites
  (`index.ts` registration + `routes/__test/fetch.ts` plugin self-gate) gained
  the `NODE_ENV !== "production"` veto; RED test asserts a 404 under
  `NODE_ENV=production` + `OPENWHISPR_TEST_ROUTES=true`.

---

### [HIGH] HI-03: `error-handler.ts` swallows `err.message` for APIError on 4xx, but echoes `err.message` for ZodError / RateLimitError / ServiceUnavailable / fastify-validation

- File: `apps/api/src/error-handler.ts:132-191`
- Category: security
- Evidence:
  ```ts
  if (err instanceof ZodError) {
    status = 400;
    const first = err.issues[0];
    message = first?.message ?? "Invalid request";
  } ...
  else if (fv.validation !== undefined) {
    status = 400;
    message = errMessage || "Invalid request";   // Fastify validation
  } ...
  else if (err instanceof RateLimitError) {
    status = 429;
    message = errMessage || "Too many requests"; // err.message echo
  } ...
  else if (err instanceof ServiceUnavailable) {
    status = 503;
    message = errMessage || "Service temporarily unavailable"; // err.message echo
  }
  ```
- Why it matters: The header comment claims "the default path NEVER leaks the
  underlying message." That contract is violated for ZodError (first issue
  message often echoes input path), and three typed-error classes that callers
  MAY throw with interpolated strings. The APIError branch consciously hides
  the Better Auth message ("DO NOT include err.message"); but routes can throw
  `new ServiceUnavailable("postgres pool exhausted: <conn-str-suffix>")` and the
  envelope echoes it. The i18n layer narrowly localizes via `code` but the
  English fallback still leaks through.
- Fix recommendation: Document a per-class allowlist of safe-to-echo messages
  and lint-enforce that callers pass code+literal pairs
  (`new RateLimitError("RATE_LIMITED", "Too many requests")`). Or emit the class
  default literal everywhere except `ValidationError` where caller context is
  intentional. Audit every `throw new ServiceUnavailable(...)` / `throw new
  RateLimitError(...)` site in routes for incidental upstream-message leakage.
- **Status:** CLOSED 2026-05-20 — Phase 62, commit `128626ee`. error-handler
  now emits the class-default literal for ZodError / fastify-validation /
  RateLimitError / ServiceUnavailable (+ the `fv.statusCode===429/503` shims) —
  no `err.message` / `issues[0].message` echo. All 9 `new ServiceUnavailable(...)`
  route throw sites (transcribe / reason / diarization / web-search / assemblyai
  / deepgram / openai-realtime) converted to code+literal pairs; upstream detail
  logged server-side via `req.log.warn`. `ValidationError` keeps its intentional
  caller text. Coordinates with LOCKER-05 (strengthening — no allowlist change).

---

### [HIGH] HI-04: `mint-bearer.ts` OIDC discovery cache has no upper bound, no TTL, no schema validation

- File: `apps/api/src/lib/mint-bearer.ts:118-145`
- Category: security
- Evidence:
  ```ts
  const discoveryCache = new Map<string, OidcDiscoveryDoc>();
  ...
  async function discoverOidc(issuerUrl: string): Promise<OidcDiscoveryDoc> {
    const issuer = issuerUrl.replace(/\/+$/, "");
    const cached = discoveryCache.get(issuer);
    if (cached) return cached;
    ...
    const doc = (await res.json()) as OidcDiscoveryDoc;   // <— unchecked
    discoveryCache.set(issuer, doc);
    return doc;
  }
  ```
- Why it matters: `await res.json() as OidcDiscoveryDoc` is an unchecked cast.
  A compromised or hijacked discovery endpoint can plant
  `{ token_endpoint: "https://attacker.example/steal" }` and the process caches
  it for life. The follow-up `fetch(tokenEndpoint, ...)` then leaks
  `client_secret` and the auth `code` to the attacker. The SSRF dispatcher
  gives partial protection via the operator allowlist, but operators commonly
  allowlist the IdP root domain. Same hardening should cover token-response
  shape in `tokenRes.json() as OidcTokenResponse` (no validation of
  `access_token`).
- Fix recommendation: Validate the discovery doc with a zod schema.
  `token_endpoint` and `userinfo_endpoint` MUST be HTTPS URLs whose origin
  matches the issuer's origin (or an explicit allowlist of issuer-affiliated
  origins). Add a short positive TTL (e.g. 60 min) so a rotated/refreshed IdP
  recovers without a pod roll.
- **Status:** CLOSED 2026-05-20 — Phase 62, commit `dfec2c59`. The discovery
  doc is zod-validated (`token_endpoint`/`userinfo_endpoint` required, `.url()`)
  before caching; both endpoints must be `https://` and issuer-origin-affiliated
  (cross-origin needs `OIDC_DISCOVERY_ALLOWED_ORIGINS`, default-deny). The bare
  `Map` is replaced with a 16-entry, 60-min-TTL cache (expired entries re-fetch,
  oldest evicted on overflow). The OIDC token response is zod-validated too.

---

### [HIGH] HI-05: `token-rotation.tryPreviousToken` follow-up email SELECT bypasses RLS without tenant binding

- File: `apps/api/src/lib/token-rotation.ts:121-170`
- Category: security
- Evidence:
  ```ts
  // First query — RLS-policed via sessions tenant_isolation
  SELECT user_id, tenant_id FROM sessions WHERE previous_token_fp = ${fp} ...
  // Follow-up — RLS-unscoped, runs as openwhispr_app
  SELECT email FROM users WHERE id = ${first.user_id}::uuid LIMIT 1
  ```
  The header advertises "SECURITY DEFINER" but the implementation no longer
  uses one — it's a direct SELECT as `openwhispr_app`.
- Why it matters: The follow-up users SELECT has no `tenant_id` predicate and
  no `withTenant()` GUC binding. The comment claims it is "gated by the
  tenant_id we already authenticated above" — but the SQL is not gated; it
  relies on the post-condition that `first.user_id` belongs to
  `first.tenant_id`. Race conditions during a user-move or admin-impersonation
  flow can desync these. The resulting email is funneled into `req.user.email`,
  audit-log payloads, and locale-aware emails.
- Fix recommendation: Wrap the email SELECT in
  `withTenant(db, first.tenant_id, async (tx) => …)` so RLS pins it, or add
  `AND tenant_id = ${first.tenant_id}::uuid` to the SELECT WHERE clause.
- **Status:** CLOSED 2026-05-20 — Phase 62, commit `aa28c391`. Fixed via
  Option B (`AND tenant_id = ${first.tenant_id}::uuid` predicate) — chosen over
  Option A (`withTenant()` wrap) because Option A requires widening the `db`
  param type, rippling to 5 minimal-shape unit-test fakes. Option B is the clean
  api-core-side fix: no migration, no caller ripple. NOT a HALT. (The separate
  `data:CR-04` AUTH-04-overlap wiring residual — `tryPreviousToken` on the
  RLS-subject app pool — remains tracked in `deferred-items.md`; HI-05's
  follow-up-SELECT scoping is independent and now closed.)

---

### [MEDIUM] MR-01: `findSSRFBlockedError` cycle-protection comment overstates the `===` self-check

- File: `apps/api/src/error-handler.ts:88-99`
- Category: workaround
- Evidence:
  ```ts
  const next = (current as { cause?: unknown }).cause;
  if (next === current || next === undefined) return null;
  current = next;
  ```
- Why it matters: The `next === current` check catches only single-step cycles.
  A 3-node cycle iterates 8× until the depth bound trips. Low actual risk
  (depth bound is correct); misleading comment.
- Fix recommendation: Replace with a `Set<unknown>` of visited nodes, OR rely
  solely on the depth bound and simplify the loop.

---

### [MEDIUM] MR-02: `dual-auth.ts` falls back to seeded default tenant on null `session.user.tenantId` with no telemetry

- Files: `apps/api/src/middleware/dual-auth.ts:164`,
  `apps/api/src/middleware/require-cookie-only.ts:40`,
  `apps/api/src/index.ts:392-401`
- Category: workaround / security
- Evidence:
  ```ts
  req.tenant = session.user.tenantId ?? (await resolveDefaultTenantId());
  ```
  `lib/default-tenant.ts:30-34` returns hardcoded
  `'00000000-0000-0000-0000-000000000000'`.
- Why it matters: If a Better Auth migration ever stops populating
  `users.tenant_id`, every authenticated user silently collapses into the
  default tenant — RLS becomes a single-bucket function. There is no warn log,
  no metric. The hardcoded UUID is explicitly LOCKER-03-allowlisted, so the
  lint layer cannot catch a regression here either.
- Fix recommendation: Emit a structured WARN log
  (`event: "auth.default_tenant_fallback"`, with `user_id`) on the fall-through
  branch, OR enforce `users.tenant_id NOT NULL` and treat null as
  `throw new AuthError("session lost tenant binding")`.

---

### [MEDIUM] MR-03: `recordPreviousToken` UPDATE does not enforce tenant binding in WHERE

- File: `apps/api/src/lib/token-rotation.ts:77-84`,
  `apps/api/src/index.ts:475-507`
- Category: security (defense in depth)
- Evidence: `UPDATE sessions SET previous_token_fp = ${fp}, previous_token_expires_at = ... WHERE id = ${sessionId}::uuid`
  inside `withTenant(db, tenantId, ...)` — relies entirely on
  `sessions.tenant_isolation` RLS policy. The onSend hook in `index.ts:502`
  passes `req.tenant`/`req.sessionId` unconditionally.
- Why it matters: Today only `dualAuthHook` writes `req.sessionId`, so it is
  safe. The contract is implicit; if a future code path sets `req.sessionId`
  from a client-controlled value, the previous-token fingerprint of that
  session can be overwritten — a session-fixation primitive.
- Fix recommendation: Add `AND tenant_id = ${tenantId}::uuid` belt-and-braces
  to the UPDATE.

---

### [MEDIUM] MR-04: `idempotency-cache.ts` corrupted-JSON branch silently issues a fresh reservation

- File: `apps/api/src/lib/idempotency-cache.ts:96-105`
- Category: workaround
- Evidence:
  ```ts
  try { existing = JSON.parse(raw) as CacheEntry; }
  catch {
    // Corrupted entry ... Treat as fresh — safe regression to "submit" path
    return { state: "reserved", jobId: null };
  }
  ```
- Why it matters: An attacker (or buggy collateral writer) who can mutate a
  `diar:idem:<key>` value to invalid JSON forces a fresh pyannote job on every
  retry. Comment cites "pyannote billing-on-success-only" as mitigation —
  vendor-policy assumption, not an OpenWhispr-side guarantee.
- Fix recommendation: On parse failure, log WARN with the cache key, return
  `{state: "conflict"}` (409 to the caller — operator-actionable).

---

### [MEDIUM] MR-05: `client-id-upsert.ts` uses `sql.raw` extensively; safety relies on caller passing literals + identifier regex

- File: `apps/api/src/lib/client-id-upsert.ts:75-81, 118, 133-136, 146-149`
- Category: security (defense in depth)
- Evidence: `sql.raw(\`INSERT INTO ${tbl} ...\`)` for table/column identifiers.
  `quoteIdent` + `SAFE_IDENT_RE` defend against injection; scalar values bind
  via drizzle parametrization.
- Why it matters: Today the route handlers only pass literal strings for
  `table`/`clientIdColumn`, and the identifier regex would reject injection
  attempts. Future contributors copying the helper may not preserve the
  `quoteIdent` chokepoint.
- Fix recommendation: Doc-comment on `sql.raw` usage. Better: replace with
  drizzle's `sql.identifier(...)` if available.

---

### [MEDIUM] MR-06: `i18n/init.ts` reads JSON synchronously at module load and throws ENOENT through Fastify if locale files are missing

- File: `apps/api/src/i18n/init.ts:47-70, 86-92`
- Category: workaround
- Evidence: `readFileSync` for each locale at module-import time; no
  try/catch with structured-log fallback. The `${distLayout}/en.json` probe
  on line 65 catches missing-file but the inner per-locale reads do not.
- Why it matters: Failing closed is correct, but the error path emits Node's
  default `ENOENT: no such file or directory` to whichever caller imports
  `init.ts` first — opaque crash in production. No structured
  `error.locales.missing` event.
- Fix recommendation: Wrap each `readFileSync` in try/catch emitting a
  pino-stderr `event: "i18n.locale_missing", locale: lng, path: filePath`
  then rethrow.

---

### [MEDIUM] MR-07: `audit.ts` Cyrillic guard runs only inside `recordAudit()` — no DB-level CHECK constraint

- File: `apps/api/src/lib/audit.ts:225-263`
- Category: workaround
- Evidence: `assertEnglishOnly()` only runs inside `recordAudit`. A future
  route inserting directly via drizzle `sql` bypasses the guard.
- Why it matters: CLAUDE.md "English only" rule relies on this helper being
  the single chokepoint. No DB-level CHECK forbidding Cyrillic.
- Fix recommendation: Add CI lint that greps for `INSERT INTO audit_log` in
  `apps/api/src/` outside `lib/audit.ts`.

---

### [MEDIUM] MR-08: `ssrf-dispatcher.checkBlocklist` returns rule `"unparseable"` without distinguishing legitimate operator-side malformed DNS responses

- File: `apps/api/src/lib/ssrf-dispatcher.ts:166-172`
- Category: workaround
- Evidence:
  ```ts
  try { parsed = ipaddr.parse(ip); }
  catch { return "unparseable"; }
  ```
- Why it matters: Audit row payload contains `rule: "unparseable"` — low signal
  for triaging abuse vs. transient malformed-DNS responses. Combined with
  MR-04 noise, alerts dilute.
- Fix recommendation: Emit a separate WARN
  (`event: "ssrf.unparseable_resolution"`) so operators can disambiguate.

---

### [MEDIUM] MR-09: `rate-limit.ts` `__rateLimited` sentinel is set but never read

- Files: `apps/api/src/plugins/rate-limit.ts:230, 307`,
  `apps/api/src/error-handler.ts:178-184`
- Category: dead-code
- Evidence: Both IP-tier and user-tier 429 paths stamp `__rateLimited: true` on
  the error. The handler maps via `err instanceof RateLimitError` or
  `fv.statusCode === 429`. No branch consumes `__rateLimited`.
- Why it matters: Mild surprise — comment claims the sentinel "short-circuits
  envelope mapping" but no branch reads it. Future maintainer may remove the
  sentinel without consequence (no test catches it).
- Fix recommendation: Delete the stamp, or have `error-handler.ts` actually
  short-circuit via `__rateLimited` as fast-path.

---

### [MEDIUM] MR-10: 5-minute Better Auth cookie cache yields a session-revocation lag undocumented in any security doc

- File: `apps/api/src/auth.ts:562-565`
- Category: documentation / security
- Evidence: Production-default `{ enabled: true, maxAge: 5 * 60 }` — sign-out
  leaves a valid signed cookie pointing at a deleted DB row for up to 5
  minutes.
- Why it matters: Correct posture for low-latency RSC, but it is a real
  revocation lag worth surfacing to SOC-2 / threat-model reviewers reading the
  OSS code for the first time.
- Fix recommendation: Add `docs/security.md §session-cache` paragraph.

---

### [MEDIUM] MR-11: `errors.pickCodeAndMessage` ambiguous when caller passes a single all-caps string

- File: `apps/api/src/errors.ts:45-54`
- Category: workaround
- Evidence: `new ValidationError("VALIDATION_ERROR")` is interpreted as
  `message="VALIDATION_ERROR"` (treated as a user-visible string), not as a
  bare code.
- Why it matters: Low impact (message still localizes via i18n if a matching
  key exists); the disambiguation is implicit and unchecked.
- Fix recommendation: Runtime assert: if `arg2 === undefined` and `arg1`
  matches `/^[A-Z][A-Z_]+$/`, log a dev-time warning. Or split into a
  `ValidationError.withCode(code, message)` static factory.

---

### [LOW] LO-01: `bootstrap.defaultOnBlock` logs at `warn` regardless of `mode` (enforce vs warn)

- File: `apps/api/src/bootstrap.ts:32-43`
- Category: style
- Evidence: Both modes emit identical log shape. Operators cannot distinguish
  "would have blocked" from "did block" by log level.
- Fix recommendation: `warn` in enforce mode, `info` in warn mode, OR
  separate `severity` field.

---

### [LOW] LO-02: `lib/api-error-status.ts:52` — unnecessary `as unknown as` cast (LOCKER-02 spirit)

- File: `apps/api/src/lib/api-error-status.ts:52`
- Category: suppressed-warning
- Evidence: `const raw = (err as unknown as { status?: unknown }).status;`
- Fix recommendation: Source is already `APIError`. Single-step cast suffices:
  `const raw: unknown = (err as { status?: unknown }).status;`.

---

### [LOW] LO-03: `auth.ts:373, 626` — two `as unknown as` casts (LOCKER-02 allowlist presumed)

- File: `apps/api/src/auth.ts:368-373, 626`
- Category: suppressed-warning
- Evidence: drizzleAdapter return-type cast + AuthInstance cast. Both
  documented inline.
- Fix recommendation: Verify LOCKER-02 allowlist has both entries.

---

### [LOW] LO-04: `index.ts` has 8 `as unknown as` casts in production code

- File: `apps/api/src/index.ts:335, 344, 372, 407, 443, 643, 707, 744`
- Category: suppressed-warning
- Evidence: All eight document an opaque boundary (db, req, redis). The
  comment at line 639-641 explicitly notes the LOCKER-02 cap.
- Fix recommendation: Audit the LOCKER-02 allowlist for each site. Consider
  lifting the structural types into `types/fastify.d.ts` so the casts
  collapse.

---

### [LOW] LO-05: Dead exports

- Files / symbols (0 production callers):
  - `apps/api/src/lib/argon2-keys.ts:101` — `parsePakPrefix`
  - `apps/api/src/lib/soft-delete.ts:39` — `softDeletePredicate`
  - `apps/api/src/lib/audit.ts:42` — `AUDIT_ACTIONS` value re-export (type re-export is used)
  - `apps/api/src/plugins/request-log.ts:23` — `redactPaths` legacy alias
  - `apps/api/src/plugins/rate-limit.ts:230, 307` — `__rateLimited` sentinel (set but never read)
- Category: dead-code
- Fix recommendation: Delete unless a near-term consumer is queued.

---

### [LOW] LO-06: `otel-bootstrap.ts:62, 79` exports `disabledInstrumentations` / `registeredInstrumentations` only for tests

- File: `apps/api/src/otel-bootstrap.ts:62-88`
- Category: dead-code
- Evidence: Comment explicitly says "Introspection surface for the unit test".
- Fix recommendation: Accepted as test-only seam, but inconsistent with the
  dead-export rule. Consider moving introspection to a separate module.

---

### [LOW] LO-07: `plugins/request-log.ts:23` `redactPaths` legacy alias unused in production

- File: `apps/api/src/plugins/request-log.ts:23`
- Category: dead-code
- Fix recommendation: Drop the `redactPaths` legacy alias; keep the
  `REDACT_PATHS` re-export.

---

### [LOW] LO-08: `audit.ts:225` CYRILLIC_RE relies on `\u` escapes to evade `tools/lint-english.ts`

- File: `apps/api/src/lib/audit.ts:225`
- Category: style
- Evidence: Comment explicitly documents the workaround.
- Fix recommendation: No action; documented well. Listed because the
  defensive double-encoding signals tight coupling between lint tools and
  production code — worth flagging during public review.

---

## Dead code

- `apps/api/src/lib/argon2-keys.ts:101` — `parsePakPrefix`: 0 production callers.
- `apps/api/src/lib/soft-delete.ts:39` — `softDeletePredicate`: 0 production callers.
- `apps/api/src/lib/audit.ts:42` — `AUDIT_ACTIONS` value re-export: 0 production callers.
- `apps/api/src/plugins/request-log.ts:23` — `redactPaths` legacy alias: 0 production callers (only comments mention it).
- `apps/api/src/otel-bootstrap.ts:62, 79` — `disabledInstrumentations`, `registeredInstrumentations`: test-only callers.
- `apps/api/src/plugins/rate-limit.ts:230, 307` — `__rateLimited` sentinel: stamped but never read.
- `apps/api/src/lib/default-tenant.ts:38` — `_resetDefaultTenantCacheForTesting`: test-only escape hatch (named).
- `apps/api/src/lib/mint-bearer.ts:148` — `__resetOidcDiscoveryCacheForTests`: test-only escape hatch (named).

## Suppressed warnings

- `apps/api/src/auth.ts:373` — `as unknown as ReturnType<typeof drizzleAdapter>` (LOCKER-02; documented inline).
- `apps/api/src/auth.ts:626` — `as unknown as AuthInstance` (LOCKER-02; documented inline).
- `apps/api/src/index.ts:335, 344, 372, 407, 443, 643, 707, 744` — 8× `as unknown as` (LOCKER-02; documented inline).
- `apps/api/src/lib/api-error-status.ts:52` — `as unknown as { status?: unknown }` (could collapse to a single-step cast).
- `apps/api/src/i18n/init.ts:155` — `as unknown as { i18n?: ...; language?: string }` (connect-middleware boundary).
- `apps/api/src/plugins/rate-limit.ts:60, 103, 158` — 3× `biome-ignore lint/suspicious/noExplicitAny` (redis client surface).
- `apps/api/src/config/auth.ts:103`, `apps/api/src/config/litellm.ts:71` — 2× `biome-ignore lint/suspicious/noConsole` for pre-logger stderr boots (accepted).

No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or `eslint-disable`
occurrences in scope.

## Hardcoded URLs / ports in scope

- `apps/api/src/auth.ts:376` — `"http://localhost:3000"` (HI-01).
- `apps/api/src/config/auth.ts:68` — `"http://localhost:4000"` (test-mode fallback; accepted).
- `apps/api/src/index.ts:738` — `"http://litellm:4000"` (compose service name; should require explicit env in prod).
- `apps/api/src/otel-bootstrap.ts:42` — `"http://localhost:4317"` (comment-only reference to the OTel default, not code).

## NODE_ENV reads outside the LOCKER-01 allowlist

None. All `NODE_ENV` reads in scope live in `config/auth.ts`, `config/litellm.ts`,
`otel-bootstrap.ts`, `bootstrap.ts`, `index.ts` (entrypoint), and
`lib/ssrf-dispatcher.ts` (the dispatcher's `opts.nodeEnv` fallback at line 163 —
borderline; this is in `lib/`, not `config/` — flagged for review but the file
header documents it as injectable for tests).

## CLAUDE.md cross-check

No evidence of production code edited to make tests pass in the in-scope files.
The `tools/lint-english.ts` reference at `audit.ts:225` reads as defensive
lint-tool coupling rather than a test-pacification hack.

## Top recurring themes (for the public-launch checklist)

1. **Loud-fail vs. WARN-and-continue inconsistency.** New code
   (`validateAuthBoot`, `validateLitellmBoot`, `validateBetterAuthSecretBoot`,
   `validateEncryptionBoot`) refuses to boot in misconfigured production.
   Older code (`OPENWHISPR_DISABLE_*`, `OPENWHISPR_TEST_ROUTES`,
   `MOCK_DIARIZATION`) only WARN-logs. Align them.
2. **`localhost:*` hardcodes in scope.** `auth.ts:376`, `index.ts:738`,
   `config/auth.ts:68` — one production default, one compose-service default,
   one test-mode default. Three subtle differences.
3. **`as unknown as` saturation in `index.ts`.** Eight casts in one file is
   concentration risk for LOCKER-02 allowlist drift. Refactor structural
   request/db types into `types/fastify.d.ts`.
4. **Cross-tenant follow-up SELECT** in `token-rotation.ts:161-163` — closest
   thing to a true bug in scope; warrants `withTenant()` wrap.
5. **OIDC discovery doc trust** in `mint-bearer.ts` — unvalidated cast of a
   network response that drives `client_secret` flow. Add zod schema +
   same-origin check.
