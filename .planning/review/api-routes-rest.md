# Adversarial review — apps/api routes (rest) + apps/api/scripts

**Reviewer scope:** the route handlers listed in the brief (excluding conversations / folders / notes / transcriptions / tokens / v1 / agent / diarization / realtime / transcribe / reason / streaming-usage, which other reviewers cover) plus `apps/api/scripts/**`.

**Branch:** `main` @ HEAD 6e43588 (review snapshot).

## Summary

One **CRITICAL** Host-header-injection bug landed in `better-auth-handler.ts`: the code claims to gate the request URL reconstruction on `AUTH_TRUSTED_ORIGINS_EXTRA` but the allowlist-fail branch returns the same attacker-controlled value as the allowlist-pass branch. This breaks Better Auth's CSRF / Origin / redirect-uri validation in any deploy where `INGRESS_BASE_URL` and `AUTH_URL` are unset.

Two **HIGH** issues sit in `test-only.ts`: `/api/_test/reset-setup` and `/api/_test/force-rotate` rely solely on the operator-controlled `OPENWHISPR_TEST_ROUTES` env flag for production safety. Unlike `/api/_test/seed-tenant` (which adds a defense-in-depth `NODE_ENV === 'production'` veto at the handler level), these two routes have no second layer. A single mis-set env in production exposes admin-claim re-opening and unauthenticated session-rotation-forcing.

Several **MEDIUM** issues: rate-limit gaps on `/api/auth/desktop-callback/:provider` and `/api/desktop-signin/:provider`, double-parse of zod schemas in `check-user.ts` and `verification-status.ts`, docstring/code drift on the `verification-status` rate-limit key, case-sensitive email lookup in `verification-status.ts` that disagrees with the rest of the codebase, and a PII-leak in the `setup-admin` race-loser response.

**LOW**: many in-scope routes have no `schema: { body|querystring|params }` declarations (LOCKER-04 obligation; CLAUDE.md notes BLOCKING flip deferred to Phase 41, but the deficit is real).

No type-suppressions in scope (`as any` / `@ts-ignore` / `@ts-nocheck` — none found).

---

## Findings

### CRITICAL

#### CR-01 — Host header injection in `buildRequestUrl` (better-auth-handler)

`apps/api/src/routes/better-auth-handler.ts:79-89`

The block comment at lines 50-59 promises:

> Request Host header — accepted only when it appears in the AUTH_TRUSTED_ORIGINS_EXTRA allowlist; otherwise we refuse to reconstruct an attacker-controlled origin. Fall back to AUTH_URL with a logged warning.

The implementation does the opposite. The `if (extra.includes(...))` branch (line 85) and the fallback (line 89) **return the same expression**: `` `${candidate}${req.url}` `` where `candidate = ${proto}://${host}`. The Host header is always trusted whether or not it's on the allowlist. When neither `INGRESS_BASE_URL` nor `AUTH_URL` is set (smoke / dev / mis-configured operator), a request with `Host: evil.example.com` makes Better Auth's universal handler validate Origin / redirect_uri against `evil.example.com`. The "Phase 51 / Plan 51-10 (HR-02)" fix referenced in the comment is null.

Defense-in-depth gap: `req.headers["x-forwarded-proto"] as string | undefined` at line 60 is a type lie (multi-value headers arrive as `string[]`); a hostile reverse-proxy that sends `X-Forwarded-Proto: http, https` would land `proto = ["http","https"]` and serialize into the URL.

Fix-shape: actually refuse + log + fall back to `AUTH_URL`, and treat `x-forwarded-proto` as `string | string[] | undefined` with explicit Array handling.

#### CR-02 — `/api/_test/reset-setup` re-opens admin claim under operator-controlled env

`apps/api/src/routes/test-only.ts:311-326`

The route is gated by the outer `enabled` check (line 173-178) which is satisfied by `NODE_ENV === 'test'` **OR** `OPENWHISPR_TEST_ROUTES === 'true'`. Unlike `/api/_test/seed-tenant` (lines 372-374) which adds a handler-level `if (process.env.NODE_ENV === "production") return reply.code(404)...` veto, this route has no such second layer. The handler:

- carries `config: { rateLimit: false, auth: false }` (line 311),
- accepts any unauthenticated POST,
- runs `UPDATE setup_state SET status='pending', completed_at=NULL`.

After re-opening, an unauthenticated attacker hits `POST /api/setup/admin` and becomes the new admin. The only thing standing between a hostile operator (or a misread env var) and full takeover is the documentation note at `routes/index.ts:471`: "PRODUCTION OPERATORS MUST NOT set this var to 'true'".

Required: add the same `NODE_ENV === 'production'` defense-in-depth veto used by seed-tenant.

#### CR-03 — `/api/_test/force-rotate` allows hostile rotation under operator-controlled env

`apps/api/src/routes/test-only.ts:202-255`

Same gate fragility as CR-02. The route does NOT carry `config.auth = false`, so it relies on dualAuthHook stamping `req.user` from the bearer the attacker presents. An attacker holding any stolen bearer can:

1. Send `POST /api/_test/force-rotate` with that bearer.
2. The handler rotates the session — emits a `set-auth-token` header with a fresh bearer (the attacker now controls the rotated session).
3. The legitimate user's session is invalidated (previous_token overlap 5 min, then dead).

This converts a transient bearer leak into a permanent account takeover. Same fix-shape as CR-02: add the `NODE_ENV === 'production'` veto, OR require additional headers like `X-Test-Auth: ${OPENWHISPR_TEST_ROUTES_SECRET}` from the contract test.

---

### HIGH

#### HR-01 — `/api/auth/desktop-callback/:provider` has no rate-limit

`apps/api/src/routes/auth-callback.ts:124`

Route config is `{ auth: false }` only. Every other public route in scope declares a `rateLimit` budget; this one falls to the global default. The handler does a UUID lookup + CAS UPDATE per request; an attacker can brute oauth_state IDs (vanishingly small landing probability, but the cost of trying is sub-millisecond) or simply DoS the endpoint. Each successful CAS BURNS the legitimate state row → exploitable race for an attacker who knows a victim is mid-flight. Add `rateLimit: { max: 60, timeWindow: '1 minute' }`.

#### HR-02 — `/api/desktop-signin/:provider` has no rate-limit and writes to DB on every call

`apps/api/src/routes/desktop-signin.ts:97`

Route config is `{ auth: false }` only. Each request INSERTs an `oauth_state` row + does encryption sidecars + 302s to the IdP. Unauthenticated attackers can:

- Inflate `oauth_state` (write amplification, table bloat — TTL is 10 min but burst-write at 10k req/s amplifies fast).
- Send unsolicited 302s to crafted IdP URLs to weaponise the server as a redirect-launcher (the IdP URL itself is operator-configured, but the user-visible redirect is to the IdP, which then bounces to whatever scheme the desktop encoded — the scheme allowlist DOES protect, but only after the DB write completes).

Add a rate-limit budget.

#### HR-03 — `verification-status` rate-limit drifted from documented contract

`apps/api/src/routes/verification-status.ts:21,44-49`

Docstring says: `30/min keyed on (ip, email) — the desktop polls during onboarding; busy fixtures must not DoS each other`. Actual config:

```ts
rateLimit: { max: 30, timeWindow: "1 minute" }
```

No `keyGenerator`. Falls back to the default IP bucket. Multiple desktops onboarding behind one corporate NAT (the exact deployment the docstring calls out) collide on the same bucket and DoS each other. Either implement the `keyGenerator` per the doc, or correct the doc.

---

### MEDIUM

#### MR-01 — Setup-admin race-loser response leaks admin email to unauthenticated callers

`apps/api/src/routes/setup-admin.ts:197-202`

When `claimRowCount === 0` (race-loser / already-completed branch), the handler responds with `{ admin: { email: existingEmail }, alreadyCompleted: true }`. The route is `auth: false` + 5/min/IP. An unauthenticated attacker who knows the deployment URL discovers the admin's email by sending one POST. This is a single-bit recon primitive but a real PII disclosure for a self-hosted box exposed at the public edge. The P1 mandate forces 200 / `alreadyCompleted:true`, but does NOT mandate echoing the email. Strip the field on the race-loser branch (return `{ alreadyCompleted: true }` only), or gate the email on a successful Better Auth session.

#### MR-02 — Case-sensitive email lookup in verification-status disagrees with rest of codebase

`apps/api/src/routes/verification-status.ts:73-75`

Query: `SELECT email_verified_at FROM users WHERE email = ${sessionEmail} LIMIT 1`.

`check-user.ts:60` and `better-auth-handler.ts:148` both use `lower(email) = lower(...)`. Phase 02.7 added the functional unique index `users_tenant_email_lower_unique` (migration 0004). If Better Auth ever stores email mixed-case (e.g. `Alice@example.com`), the verification-status lookup returns zero rows and the desktop sees `verified: false` indefinitely. Use `lower(email) = lower(${sessionEmail})`.

#### MR-03 — Double-parse of Zod schema after Fastify validator

`apps/api/src/routes/check-user.ts:43-47`
`apps/api/src/routes/verification-status.ts:50-60`

Both routes register `schema: { body: ... }` / `schema: { querystring: ... }` AND call `.parse(req.body|query)` inside the handler. Fastify already validated via the zod type-provider. Two failure paths now exist (Fastify pre-handler error vs handler ZodError) which route through different points in the centralized error handler. Pick one. The duplicate work is minor; the divergent error paths are the actual bug.

#### MR-04 — `auth-callback.ts` unreachable branch + misleading kind label on race

`apps/api/src/routes/auth-callback.ts:188-204`

Line 186: `if (probe.rows.length === 0) return { kind: "missing" }`. Line 190: `if (!row) return { kind: "missing" }` — unreachable given the preceding length check.

Line 204: the final `return { kind: "expired" }` is the "neither expired-by-time nor consumed_at-set" fall-through. In theory unreachable (the row matched neither CAS condition above), but if reached due to clock skew or a concurrent INSERT, the response is mislabelled `expired`. Either assert-unreachable or split the branch with a distinct kind.

#### MR-05 — `__Host-` prefixed cookie variant not cleared on delete-account

`apps/api/src/routes/delete-account.ts:72-77`

`COOKIES_TO_CLEAR_ON_DELETE` covers `openwhispr.session_token`, `openwhispr.session_data`, and the `__Secure-` prefix variants. Better Auth's universal handler may emit `__Host-`-prefixed cookies in some deploys (RFC 6265bis, when `domain` is omitted + path=/ + Secure). Verify Better Auth's config in `auth.ts` does NOT emit `__Host-` variants for this project; if it might, add the 2 additional names to the clear list.

#### MR-06 — `test-only.ts` seed-tenant tenantId default-empty-string from header

`apps/api/src/routes/test-only.ts:475`

`req.headers["x-test-tenant-id"]?.toString() ?? ""`. The empty-string fallback is written into the in-process sessions Map. Downstream RLS expects a UUID; an empty string serialised into `app.tenant_id` GUC is undefined behaviour and may surface as a confusing 500 from inside RLS-bound queries. Bound only to test runs (production omits the `sessions` sink), but the fixture brittleness is real. Either require the header (400 on miss) or default to `resolveDefaultTenantId()`.

#### MR-07 — Owner-pool query in setup-admin bypasses tenant context

`apps/api/src/routes/setup-admin.ts:197-200,260-262,271`

Direct `ownerPool.query(...)` for SELECT email FROM users / UPDATE users / DELETE FROM users. The owner pool is BYPASSRLS by design (the route writes `users.role` which is a migration-only column). Correct posture for the role flip + tenant-rename. But the race-loser admin email lookup at 197-199 also bypasses RLS — fine today (single tenant), structurally fragile in a future multi-tenant world. Add a `WHERE tenant_id = '00000000-0000-0000-0000-000000000000'` filter to make the assumption explicit.

#### MR-08 — `oauth_state` INSERT binds tenant_id without `::uuid` cast

`apps/api/src/routes/desktop-signin.ts:143-156`

The SQL template passes `${tenantId}` without an `::uuid` cast, unlike auth-callback.ts:163-171 which uses `${stateId}::uuid`. Drizzle's `sql` tag binds the value as text and PG implicit-casts to UUID at runtime — works today but is inconsistent with the rest of the file's casting convention. Add `::uuid` for clarity + to surface bad inputs as 400s earlier.

---

### LOW

#### LR-01 — Missing `schema: { body|querystring|params }` on multiple in-scope routes (LOCKER-04)

Routes lacking the required Zod schema declaration:

- `setup-admin.ts:146-160` — has `setupAdminInput` zod schema in module scope, but it's `.safeParse`'d inside the handler instead of being attached as `schema: { body: setupAdminInput }`. Fastify can't pre-validate / pre-serialize and the OpenAPI surface is empty.
- `setup-state.ts:62-81` — no schema declaration.
- `locale.ts:71-93` — no schema declaration.
- `usage.ts:36-71` — no schema declaration.
- `note-recording-config.ts:30-47` — no schema declaration.
- `stt-config.ts:41-58` — no schema declaration.
- `capabilities.ts:147-189` — no schema declaration.
- `auth-providers.ts:73-110` — no schema declaration.
- `auth-callback.ts:121-261` — `Params` and `Querystring` declared in TS generics but not as Zod runtime schemas.
- `desktop-signin.ts:94-184` — same pattern as auth-callback.
- `test-only.ts:202,257,279,311` (force-rotate / health-authed / route-list / reset-setup) — no schemas.
- `better-auth-handler.ts:210` — intentional pass-through, but LOCKER-04 still demands a schema (a `z.any()` or `z.unknown()` placeholder satisfies the linter).

CLAUDE.md ledger notes LOCKER-04's BLOCKING flip is operationally deferred to Phase 41; flagged here so the backlog reflects the truth.

#### LR-02 — Hardcoded localhost / port literals in `test-only.ts` (LOCKER-03 surface)

`apps/api/src/routes/test-only.ts:227` — `process.env.AUTH_URL ?? "http://localhost:3000"`. Test-only file; verify it is on the LOCKER-03 path-exemption allowlist (it appears not to be — `tools/` and `tests/` are, this file lives under `apps/api/src/routes/`).

#### LR-03 — `index.ts` type assertion on test-only signUpEmail bridge

`apps/api/src/routes/index.ts:492-497`

```ts
signUpEmail: (call: ...) =>
  deps.setupAdmin?.signUpEmail({ body: call.body }) as Promise<{...}>,
```

`as Promise<{...}>` widens (lies about) the return type vs `TestOnlySignUpResult`. Not LOCKER-02 forbidden (`as` is allowed, only `as any` / `as unknown as` / `@ts-ignore` are not), but the assertion is unnecessary — the two shapes are structurally identical. Drop the cast.

#### LR-04 — `verification-status.ts` returns `verified: false` for sessions missing `email`

`apps/api/src/routes/verification-status.ts:65-71`

When the cookie-only auth path resolved a session but `req.user.email` is empty, the route returns `{ verified: false }` rather than 401. Doc calls this defense-in-depth; in practice the bit "your session has no email" is indistinguishable from "your email is not verified". Narrow surface (cookie-only auth already gates the route) but inconsistent with the "fail closed" posture elsewhere.

#### LR-05 — `check-default-secrets.ts` ENOENT path on resolution failure

`apps/api/scripts/check-default-secrets.ts:32-36,52-54`

If both `import.meta.url` and `__dirname` resolve to empty (extreme corner: bundled to an unusual loader), `here = ""` and `monorepoDenyPath` resolves to `/tools/bootstrap/default-secrets.txt` (filesystem root). `readFileSync` then throws ENOENT and the process exits with a stack trace, not the documented "refusing to start: ..." stderr line + exit 1. Defense: throw a clean `Error("cannot resolve script dir")` if `here === ""`.

#### LR-06 — `auth-callback.ts` 500-on-missing-KeyProvider vs 503 elsewhere

`apps/api/src/routes/auth-callback.ts:96,120`

`deps.keyProvider ?? selectProvider()`. If neither is configured, `selectProvider()` throws at boot or first request — surfaces as 500 via the centralized error handler. The unconfigured-OIDC sister path returns a clean 503 with envelope (line 244). Unify: probe key provider availability at registration time and emit 503 if missing.

#### LR-07 — `desktop-signin.ts:115` empty-string protocol fall-through

When neither `req.query.protocol` nor `extractEmbeddedProtocol(rawCb)` resolves, `proto = ""`. `validateScheme("")` will reject (good). But the log line at 121-124 emits `scheme: ""` which is uninformative. Surface the original `rawCb` in the log to aid operator debugging.

---

## Dead code

- `auth-callback.ts:188-191` — `if (!row) return { kind: "missing" }` after `probe.rows.length === 0` early-return — unreachable.
- `setup-admin.ts:335-339` — `pickLocale` accepts `string|string[]|undefined` but Fastify normalises `accept-language` to a string. The array branch is permanently unreachable; kept under `/* v8 ignore */` — defensible but flagging.
- `setup-admin.ts:189,232,336,338` — multiple `/* v8 ignore next */` on defensive branches (claimRowCount fallback, signUpEmail error-message fallback, Accept-Language Array branch, split-and-trim tail). Not bugs; flagging for review-coverage clarity. None of these are LOCKER-02 type suppressions.

## Suppressed warnings

None observed in this scope:

- No `as any`, no `as unknown as`, no `@ts-ignore`, no `@ts-nocheck` in any reviewed file.
- `as` casts in `index.ts:492-497` and `auth-callback.ts:172,185` widen types but are permitted by LOCKER-02.
- `/* v8 ignore next */` blocks are coverage suppressions, not type suppressions — allowed.
- No `biome-ignore` suppressions in scope.

## CLAUDE.md hard rule 1 (no production edits to make tests pass)

No evidence of production-code mutation driven by test fixtures within this scope. The `/api/_test/*` surface is correctly isolated to `test-only.ts`. Hard rule 4 (gitleaks bypass) — no `--no-verify` traces in the reviewed files (this is a code review, not a commit review, so the surface is narrow).

## Architectural workarounds

- `setup-admin.ts:25-28` — explicit "why no transaction wrap" justification for an unwrapped multi-statement claim. Documented limitation of Better-Auth's drizzle adapter (#1841). Compensating-rollback pattern lands at lines 218-296 — adequate. NOT a workaround per the CLAUDE.md definition.
- `setup-admin.ts:140` — owner-pool raw SQL for `users.role` because the column is migration-only and not in the drizzle schema. Documented; the right place to put the seam.
- `better-auth-handler.ts:121-154` — env-gated `OPENWHISPR_DISABLE_EMAIL_ENUMERATION_PROTECTION` preHandler. Comment justifies bypassing Better Auth's intentional anti-enumeration synthetic response. The env knob is operator-controlled and the production default preserves anti-enumeration. Acceptable seam, NOT a workaround.

## RLS / tenant-context audit

- Every DB-touching authed route in scope wraps writes in `withTenant(db, tenantId, ...)` (delete-account, check-user, usage, note-recording-config, stt-config, verification-status, setup-state, capabilities). Good.
- `setup-admin.ts` uses the BYPASSRLS owner pool for `users.role` flip + tenant rename — correct, but the admin-email lookup at line 198 is structurally fragile in a future multi-tenant world (see MR-07).
- `test-only.ts:472-476` writes a session into an in-process Map with `tenantId: req.headers["x-test-tenant-id"]?.toString() ?? ""` — see MR-06.
- `better-auth-handler.ts:144-153` — duplicate-email probe wraps in `withTenant(db, tenantId, ...)`. Good.
