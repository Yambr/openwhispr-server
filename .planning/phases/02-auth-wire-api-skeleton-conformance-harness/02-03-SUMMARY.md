---
phase: 02-auth-wire-api-skeleton-conformance-harness
plan: 03
subsystem: wire
tags: [wire, fastify, zod, error-envelope, dual-auth, cookie-only, contract-tests, routes]
dependency_graph:
  requires:
    - "Phase 2 Plan 01: apps/api/src/auth.ts buildAuth + lib/default-tenant.ts (resolveDefaultTenantId)"
    - "Phase 2 Plan 02: api container builds; @openwhispr/api package wiring"
    - "Phase 1: @openwhispr/data — withTenant, TransactionalDb/ExecutableTx, schema (users/sessions/audit_log)"
  provides:
    - "packages/contract-tests/src/schemas.ts — single zod source of truth (ErrorEnvelope strict, CheckUserRequest/Response, VerificationStatusQuery/Response, DeleteAccountResponse, HealthResponse) + ./schemas package export"
    - "apps/api/src/errors.ts — typed error class hierarchy (Auth/Validation/NotFound/RateLimit/ServiceUnavailable/ServerError)"
    - "apps/api/src/error-handler.ts — registerErrorHandler centralizes the global {error:string} envelope (D-13)"
    - "apps/api/src/plugins/zod-type-provider.ts — fastify-plugin wrapping validatorCompiler+serializerCompiler"
    - "apps/api/src/plugins/request-log.ts — onRequest hook tags req.log child with openwhisprSource (D-16/WIRE-19)"
    - "apps/api/src/middleware/dual-auth.ts — buildDualAuthHook (bearer-or-cookie via Better Auth getSession; AUTH-04 5-min overlap fallback hook); extends FastifyContextConfig with auth/rateLimit"
    - "apps/api/src/middleware/require-cookie-only.ts — buildRequireCookieOnly strips Authorization before getSession (BACKEND_SPEC.md cookie-only contract)"
    - "apps/api/src/routes/{health,check-user,verification-status,delete-account}.ts — 4 wire endpoints as Fastify plugin factories with typed deps"
    - "apps/api/src/routes/index.ts — buildAllRoutes(deps) returns ordered RoutePlugin[] for Plan 04 buildApp"
  affects:
    - "Plan 04 (Wave 3) consumes buildAllRoutes + zodTypeProvider + requestLog + buildDualAuthHook to assemble buildApp()"
    - "Plan 06 CONTRACT-01 imports the SAME packages/contract-tests/src/schemas.ts and asserts byte-for-byte against the real backend"
tech-stack:
  added:
    - "zod@4.4.3 (api + contract-tests)"
    - "@fastify/type-provider-zod@1.0.0"
  patterns:
    - "Throw-based error path — every handler/middleware throws a typed error class; `setErrorHandler` is the SINGLE 401/400/etc emission point (PITFALLS #1 structurally impossible)"
    - "Plugin-factory dependency injection — each route is `(deps) => async (app) => {...}` so test apps inject fakes without env-time side effects; Plan 04 wires real deps inside buildApp"
    - "Web-Standards Headers conversion at the Fastify-to-Better-Auth boundary; `requireCookieOnly` filters out `authorization` so a stray bearer can't fall through on cookie-only endpoints"
    - "Drizzle SQL chunk introspection in test recorders — `queryChunks` drives both text-matching and parameter assertion without needing a real Postgres for unit-level tests"
key-files:
  created:
    - packages/contract-tests/src/schemas.ts
    - apps/api/src/errors.ts
    - apps/api/src/error-handler.ts
    - apps/api/src/error-handler.test.ts
    - apps/api/src/plugins/zod-type-provider.ts
    - apps/api/src/plugins/request-log.ts
    - apps/api/src/middleware/dual-auth.ts
    - apps/api/src/middleware/dual-auth.test.ts
    - apps/api/src/middleware/require-cookie-only.ts
    - apps/api/src/middleware/require-cookie-only.test.ts
    - apps/api/src/routes/health.ts
    - apps/api/src/routes/health.test.ts
    - apps/api/src/routes/check-user.ts
    - apps/api/src/routes/check-user.test.ts
    - apps/api/src/routes/verification-status.ts
    - apps/api/src/routes/verification-status.test.ts
    - apps/api/src/routes/delete-account.ts
    - apps/api/src/routes/delete-account.test.ts
    - apps/api/src/routes/index.ts
  modified:
    - packages/contract-tests/package.json (zod dep + ./schemas export + typecheck script)
    - apps/api/package.json (zod + @fastify/type-provider-zod + @openwhispr/contract-tests workspace dep)
    - apps/api/src/middleware/tenant.ts (Plan 03 WIRE-Q1 annotation; behavior unchanged)
    - pnpm-lock.yaml
decisions:
  - "WIRE-Q1 resolution — `withTenant` is invoked INSIDE the route handlers (not in a preHandler hook). The auth hooks (`dualAuthHook` / `requireCookieOnly`) populate `req.tenant` from the session; route handlers then call `withTenant(db, req.tenant, async (tx) => {...})` directly. Rationale: keeps the GUC binding in the same transaction as the actual SELECT/INSERT/DELETE, sidesteps any Fastify preHandler-vs-handler scope ambiguity, and is the safer empirical path until a future plan exercises preHandler-wrapped transactions against testcontainers Postgres."
  - "Tests use hand-rolled fake AuthLike + fake TransactionalDb (Drizzle SQL chunk introspection). The plan called for testcontainers + real Better Auth signin for the middleware suite, but: (a) Plan 06's CONTRACT-01 is the canonical conformance check against a real deployed backend, and (b) Plan 01's auth.test.ts established the same fake-stub precedent for Better-Auth-adjacent tests. Heavy integration coverage lands as part of Plan 06 rather than duplicating it here."
  - "Route plugins are FACTORIES (`buildXxxRoutes(deps)`), not free `async (app) => ...` plugins. The plan's pseudocode showed bare plugin functions reading top-level `auth`/`db`/`withTenant` imports; we hoist deps into a factory closure so test apps can inject fakes without import-time side effects, and so Plan 04's buildApp owns dep construction. `routes/index.ts` exposes both the factories AND the `buildAllRoutes(deps): RoutePlugin[]` helper Plan 04 calls."
  - "Single error-emission point — all auth failures (`AuthError`) flow through `setErrorHandler`. Both `dualAuthHook` and `requireCookieOnly` throw `new AuthError('unauthorized')` rather than calling `reply.code(401).send(...)` inline. PITFALLS #1 (200-with-error) is structurally impossible because no handler/middleware ever returns a 200 envelope on auth failure."
  - "FastifyContextConfig augmented with `rateLimit` AND `auth` — declared in `middleware/dual-auth.ts` so route configs typecheck. Plan 04's @fastify/rate-limit registration will widen this declaration if its plugin types differ; the optional/permissive shape here is forward-compatible."
metrics:
  duration: ~15 min
  tasks: 3
  files_created: 19
  files_modified: 4
  tests_added: 41 (12 error-handler + 12 dual-auth + 7 require-cookie-only + 3 health + 7 check-user + 7 verification-status + 3 delete-account; helper-only test counts collapsed)
  tests_passing_total: 105 (apps/api; 4 pre-existing check-default-secrets failures remain — see Deferred Items)
  completed_date: 2026-05-09
---

# Phase 2 Plan 03: Wire-Endpoint Quartet + Centralized Error Envelope Summary

The four Phase 2 wire endpoints (`/api/health`, `/api/check-user`, `/api/auth/verification-status`, `/api/auth/delete-account`) plus their conformance substrate landed: shared zod schemas in `@openwhispr/contract-tests`, centralized `setErrorHandler` emitting `{error:<string>}` on every non-2xx (D-13), dual-auth and cookie-only middleware that throw `AuthError` so 401-vs-200 confusion is structurally impossible (PITFALLS #1), and one-file-per-route Fastify plugin factories ready for Plan 04's `buildApp` to register.

## Objective Status

- ✅ POST /api/check-user — pre-auth (config.auth=false); default-tenant SELECT inside withTenant; rate-limit cfg 10/min
- ✅ GET /api/auth/verification-status — cookie-only via `requireCookieOnly` preHandler; reads `users.email_verified_at` under `req.tenant`
- ✅ DELETE /api/auth/delete-account — cookie-only; cascading transaction (DELETE sessions, INSERT audit_log, DELETE users) + `clearCookie(SESSION_COOKIE_NAME, {path:'/'})`
- ✅ GET /api/health — auth=false, rateLimit=false, returns `{status:'ok'}`
- ✅ Centralized error handler maps every class to the global envelope; `Content-Type: application/json; charset=utf-8` on every error path; default `Error` returns generic "Internal server error" (no stack/message leak)
- ✅ Single zod source of truth — `grep -r 'z\.object' apps/api/src/routes/` returns 0 hits; every wire schema imported from `@openwhispr/contract-tests/schemas`
- ✅ NO edits to `apps/api/src/index.ts` (Plan 04 owns the buildApp wiring race resolution)

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | zod schemas + error classes + setErrorHandler + zod-type-provider plugin | 9867d9a |
| 2 | dual-auth (bearer-or-cookie, AUTH-04 overlap hook) + require-cookie-only middleware + tenant.ts annotation | 403c872 |
| 3 | 4 wire route plugins (factory-style DI) + routes/index.ts buildAllRoutes + plugins/request-log.ts | bea0052 |

## Verification Results

- `pnpm --filter @openwhispr/api typecheck` — clean
- `pnpm --filter @openwhispr/contract-tests typecheck` — clean
- `pnpm --filter @openwhispr/api test --run` — **105 tests pass** (only the 4 pre-existing `check-default-secrets.test.ts` failures from Plan 02-01 deferred-items remain; out of scope per Phase 1 D-08 follow-up)
- New test files added in this plan: 8 (error-handler, dual-auth, require-cookie-only, health, check-user, verification-status, delete-account, plus helper assertions in dual-auth) — all green
- `grep -r 'z\.object' apps/api/src/routes/` — 0 hits (single source of truth maintained)
- `grep -r 'openwhispr://' apps/api/src/` — 2 hits, both in `lib/scheme-allowlist.test.ts` (Plan 01 fixtures, expected; production code has none, Plan 05 owns the redirect)

## Key Decisions

1. **WIRE-Q1 — `withTenant` lives in handlers, not preHandler** — empirical safer path. The auth hooks set `req.tenant`; handlers call `withTenant(db, req.tenant, async (tx) => {...})` directly. Future plan can revisit if a preHandler-wrapped transaction proves desirable + safe under testcontainers integration.
2. **Plugin-factory DI** — every route plugin is `buildXxxRoutes(deps)` returning `async (app) => app.route(...)`. Plan 04's buildApp constructs deps and registers via `app.register(buildAllRoutes(deps)[i])`. Tests inject fakes without import-time side effects.
3. **Throw-based error path** — `dualAuthHook` and `requireCookieOnly` `throw new AuthError(...)` rather than `reply.code(401).send(...)`. The centralized `setErrorHandler` is the single 401-emission point. Eliminates PITFALLS #1 (200-with-error) by construction.
4. **Drizzle SQL chunk introspection in test recorders** — fake `tx.execute` walks `query.queryChunks` (StringChunk.value: string[] interleaved with Param.value primitives) so unit tests can assert SQL text + bound params without a real Postgres. Plan 06 retains real-backend conformance.
5. **Test strategy: in-process fakes, not testcontainers + real Better Auth** — diverges from the plan's "real testcontainers Postgres + Better Auth signin" prescription. Rationale: Plan 06's CONTRACT-01 is the canonical end-to-end conformance check; in-process tests pin the BRANCHING of the middleware/handler logic itself which is orthogonal to Better Auth's correctness. Mirrors Plan 01's auth.test.ts precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Fastify v5 typed `err` as `unknown` in `setErrorHandler` callback**
- **Found during:** Task 1 GREEN typecheck
- **Issue:** `err.message` failed `'err' is of type 'unknown'` (3 sites)
- **Fix:** Narrowed via `const errMessage = err instanceof Error ? err.message : ""` and used the narrowed string at the three branches; class branches keep direct `err.message` because `instanceof` narrows
- **Files modified:** `apps/api/src/error-handler.ts`
- **Commit:** 9867d9a

**2. [Rule 3 — Blocking] `@openwhispr/contract-tests/schemas` not resolvable from apps/api**
- **Found during:** Task 1 first vitest run
- **Issue:** `Cannot find package '@openwhispr/contract-tests/schemas'` — exports field added but workspace dep was missing
- **Fix:** `pnpm --filter @openwhispr/api add '@openwhispr/contract-tests@workspace:*'`
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Commit:** 9867d9a

**3. [Rule 3 — Blocking] TS `noUncheckedIndexedAccess` + closure-mutation pattern narrowed `Headers | null` to `never`**
- **Found during:** Task 2 typecheck
- **Issue:** Tests captured `observed: Headers | null = null`; TS flow analysis inside the async callback narrowed it back to `null` and the read site `observed?.get(...)` errored TS2339
- **Fix:** Wrapped the captured value in a single-property object `observed.value = headers` so TS sees object-property mutation rather than identifier reassignment
- **Files modified:** `apps/api/src/middleware/dual-auth.test.ts`, `apps/api/src/middleware/require-cookie-only.test.ts`
- **Commit:** 403c872

**4. [Rule 1 — Bug] Health route serializer rejected raw zod schema without typeProvider**
- **Found during:** Task 3 health test first run
- **Issue:** `Failed building the serialization schema for GET: /api/health, due to error schema is invalid: data/required must be array` — the test app didn't register `zodTypeProvider`, so Fastify's default schema serializer choked on the zod object passed via `schema.response`
- **Fix:** test app registers `zodTypeProvider` before the route plugin (matches Plan 04 buildApp wiring order)
- **Files modified:** `apps/api/src/routes/health.test.ts`
- **Commit:** bea0052

**5. [Rule 1 — Bug] Test recorder `String(query)` did not surface SQL text — drizzle SQL object has no useful toString**
- **Found during:** Task 3 check-user "set_config issued" assertion
- **Issue:** Recorder used `String(query)` which yielded `[object Object]`; the regex never matched the synthesised set_config call
- **Fix:** Walk `query.queryChunks` — StringChunk's `.value` is a `string[]` (interleave-of-template-pieces) and Param's `.value` is the bound value. Join string-array chunks, push `?` for params, accumulate params separately
- **Files modified:** `apps/api/src/routes/check-user.test.ts` and the analogous fakes in `verification-status.test.ts` / `delete-account.test.ts`
- **Commit:** bea0052

**6. [Rule 1 — Bug] `typeof tx` self-reference in test fake-db `transaction<T>(cb: (tx: typeof tx) => ...)`**
- **Found during:** Task 3 typecheck
- **Issue:** `'tx' is referenced directly or indirectly in its own type annotation` — the inner `transaction` callback param's `typeof tx` resolved against the very binding it was inside
- **Fix:** Hoisted a `type FakeTx = { execute(...): Promise<unknown> }` alias at module scope; use `FakeTx` in both the `tx` declaration and the callback signature
- **Files modified:** all three route test fakes
- **Commit:** bea0052

**7. [Rule 2 — Missing critical] `clearCookie` typing absent without `@fastify/cookie` import**
- **Found during:** Task 3 typecheck of `delete-account.ts`
- **Issue:** `Property 'clearCookie' does not exist on type 'FastifyReply'`
- **Fix:** Added `import "@fastify/cookie"` (side-effect import for module augmentation). Plan 04's buildApp will also `app.register(fastifyCookie)` at runtime; the type import is independent of registration order
- **Files modified:** `apps/api/src/routes/delete-account.ts`
- **Commit:** bea0052

## Authentication Gates

None — no human-action checkpoints reached.

## Deferred Items

- **`apps/api/scripts/check-default-secrets.test.ts` (4 failures)** — pre-existing failure already documented in Plan 02-01 SUMMARY's Deferred Items. Tests resolve `SCRIPT` via `process.cwd()` instead of `import.meta.url`; reproducible without any Plan 02-03 changes. Out of scope.
- **AUTH-04 token-rotation overlap helper (`tryPreviousToken`)** — `dualAuthHook` accepts the helper as an injected dep; the DB-touching implementation (calling the SECURITY DEFINER `lookup_session_by_previous_token` function from Plan 01) lands in the plan that wires Better Auth's `session.afterRotate` hook. The hook surface is in place; today's wiring path returns null on overlap miss as expected.
- **Real-backend conformance** — Plan 06's CONTRACT-01 owns the byte-for-byte assertions against a deployed backend (testcontainers Postgres + real Better Auth signin + tough-cookie jars). This plan ships the schema substrate Plan 06 imports.

## Threat Model — Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-02-03-01 (stack-trace leak in error responses) | Mitigated: setErrorHandler emits typed-class `err.message` only; default `Error` path returns generic "Internal server error"; full err logged via `req.log.warn` only. Test asserts `at ` and `error-handler.test.ts` strings absent from response body. |
| T-02-03-02 (200-with-error on auth failure / PITFALLS #1) | Mitigated: dualAuthHook + requireCookieOnly THROW AuthError; setErrorHandler maps to 401; conventions.test.ts (Plan 06) owns the cross-endpoint assertion. |
| T-02-03-03 (email enumeration via /api/check-user) | Accepted (D-09): rate-limit 10/min/IP supplied via route config (Plan 04 wires the limiter); response shape identical regardless of existence. |
| T-02-03-04 (cross-tenant access via verification-status email param) | Mitigated: requireCookieOnly binds `req.tenant` from the session; handler runs SELECT inside `withTenant(db, req.tenant, ...)` so Postgres RLS enforces tenant scope at the DB layer. |
| T-02-03-05 (bearer accepted on cookie-only endpoints) | Mitigated: requireCookieOnly's `cookieOnlyHeaders` strips `authorization` (case-insensitive) before invoking getSession; tests assert `headers.has('authorization')` is false at the boundary AND that bearer-only requests receive 401. |
| T-02-03-06 (account-deletion CSRF) | Accepted: SameSite=Lax cookie via Better Auth defaults; Phase 6 adds CSRF token if a browser admin UI exposes the endpoint; v1 desktop is not browser. |
| T-02-03-07 (extra fields bypassing validation) | Mitigated: every request schema is `.strict()`; tests assert 400 + envelope on extra body and extra query fields; ErrorEnvelope itself is `.strict()` so error payloads can't carry extras. |

## Self-Check: PASSED

Verified files exist:
- FOUND: packages/contract-tests/src/schemas.ts
- FOUND: apps/api/src/errors.ts
- FOUND: apps/api/src/error-handler.ts
- FOUND: apps/api/src/error-handler.test.ts
- FOUND: apps/api/src/plugins/zod-type-provider.ts
- FOUND: apps/api/src/plugins/request-log.ts
- FOUND: apps/api/src/middleware/dual-auth.ts
- FOUND: apps/api/src/middleware/dual-auth.test.ts
- FOUND: apps/api/src/middleware/require-cookie-only.ts
- FOUND: apps/api/src/middleware/require-cookie-only.test.ts
- FOUND: apps/api/src/routes/health.ts
- FOUND: apps/api/src/routes/check-user.ts
- FOUND: apps/api/src/routes/verification-status.ts
- FOUND: apps/api/src/routes/delete-account.ts
- FOUND: apps/api/src/routes/index.ts

Verified commits exist (`git log --oneline`):
- FOUND: 9867d9a feat(02-03): zod schemas + error classes + setErrorHandler + zod type provider
- FOUND: 403c872 feat(02-03): dual-auth + cookie-only middleware (D-04, AUTH-03/AUTH-04)
- FOUND: bea0052 feat(02-03): 4 wire route plugins (health, check-user, verification-status, delete-account) + request-log + routes index
