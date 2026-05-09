---
phase: 02-auth-wire-api-skeleton-conformance-harness
plan: 04
subsystem: wire
tags: [rate-limit, email, smtp, mailpit, traefik, https-redirect, trust-proxy, observability, build-app, wire-20, auth-06, provider-04]
dependency_graph:
  requires:
    - "Phase 2 Plan 01: Better Auth substrate (auth.ts buildAuth) — sendVerificationEmail placeholder replaced here"
    - "Phase 2 Plan 02: docker-compose api + mailpit dev profile + traefik with redirect block; .env fixture pattern (_helpers.ts fixtureSecrets)"
    - "Phase 2 Plan 03: routes/index.ts barrel buildAllRoutes(deps); error-handler.ts (envelope at 429); zod-type-provider, request-log, dual-auth, require-cookie-only, all 4 route plugins; FastifyContextConfig.auth augmentation"
  provides:
    - "apps/api/src/email.ts — EmailService interface + makeEmailService(log) factory; SMTP_HOST unset returns stub (logs event=email.smtp_not_configured); set returns nodemailer transport (secure auto-derived from port; auth only when both USER+PASSWORD); .send() RE-THROWS on transport error (Pitfall #4)"
    - "apps/api/src/plugins/rate-limit.ts — @fastify/rate-limit@10.3.0 plugin with envelope-conformant 429 (errorResponseBuilder returns Error{statusCode:429, message:'Too many requests'} so setErrorHandler emits exactly {error:'Too many requests'}); namespace 'owrl:'; skipOnError:true; redis backend optional (env-driven; tests inject undefined → in-process fallback)"
    - "apps/api/src/index.ts — finalized buildApp() with load-bearing plugin order (errorHandler → cookie → zodTypeProvider → requestLog → rateLimit → tenantPlugin → dualAuthHook → allRoutes); trustProxy:true; minimal-mode (health-only) when auth/db not provided"
    - "compose/traefik/traefik.yml — permanent:true on web→websecure redirect (308 status, WIRE-20)"
    - "tests/self-tests/traefik-https-only.test.ts — WIRE-20 self-test (skip-clean without docker/Compose<2.20; passes against real Traefik v3.6)"
  affects:
    - "auth.ts: BuildAuthOptions.email injectable; sendVerificationEmail wired through email.send() with subject 'Verify your OpenWhispr account'"
    - "Plan 06 CONTRACT-01: 11th-call /api/check-user assertion now has working rate-limit substrate; the 429 envelope shape is locked in"
    - "middleware/dual-auth.ts: dropped our FastifyContextConfig.rateLimit augmentation — @fastify/rate-limit owns the type now"
tech-stack:
  added:
    - "nodemailer@8.0.7 + @types/nodemailer (email transport)"
    - "@fastify/rate-limit@10.3.0 (sliding-window per-route limiter)"
    - "@redis/client@5 (optional Valkey backend for distributed rate limits)"
  patterns:
    - "errorResponseBuilder returns an Error with statusCode set (NOT a plain object) — @fastify/rate-limit v10 throws the result and setErrorHandler routes by err.statusCode === 429"
    - "Self-test pattern reuse — fixtureSecrets() + .env backup/restore from Plan 02 _helpers.ts"
    - "AUTH-06 log assertion via Fastify's built-in `logger:{stream}` config (no pino direct dep needed)"
key-files:
  created:
    - apps/api/src/email.ts
    - apps/api/src/email.test.ts
    - apps/api/src/__tests__/email-mailpit.test.ts
    - apps/api/src/plugins/rate-limit.ts
    - apps/api/src/__tests__/rate-limit-check-user.test.ts
    - apps/api/src/__tests__/rate-limit-verification-status.test.ts
    - apps/api/src/__tests__/rate-limit-health-exempt.test.ts
    - apps/api/src/__tests__/openwhispr-source-log.test.ts
    - tests/self-tests/traefik-https-only.test.ts
  modified:
    - apps/api/src/auth.ts (BuildAuthOptions.email; sendVerificationEmail wired via email.send())
    - apps/api/src/index.ts (finalized buildApp with full plugin chain — Plan 04 sole authorship)
    - apps/api/src/middleware/dual-auth.ts (drop our rateLimit FastifyContextConfig augmentation)
    - apps/api/src/health.test.ts (async buildApp + status:'ok' — was Phase 0 placeholder)
    - apps/api/package.json (nodemailer + @fastify/rate-limit + @redis/client + @types/nodemailer)
    - compose/traefik/traefik.yml (permanent:true on redirect — WIRE-20)
    - pnpm-lock.yaml
decisions:
  - "errorResponseBuilder returns Error, not plain object — @fastify/rate-limit v10's defaultErrorResponse template emits `new Error()` with statusCode attached; the plugin THROWS the return value, so setErrorHandler sees an Error with statusCode 429 and message 'Too many requests'. The plan said 'returns {error: ...}' but that produced 500s in our diag — Error+statusCode is the correct shape. The wire body is still EXACTLY {error: 'Too many requests'} because setErrorHandler maps statusCode 429 → envelope using err.message."
  - "buildApp now async — every plugin register is await'd (fastify-plugin async loading). Phase 0's `const app = buildApp()` callsite needed updating in health.test.ts. Future entry-point bootstrap (`if (import.meta.url === ...)`) uses top-level await (Node 24 supports this in ESM)."
  - "compose/traefik/static.yml is named traefik.yml in this repo — Plan called for a file named static.yml but Phase 1 already established traefik.yml. Edited the existing file (added permanent:true) rather than rename; the Phase 1 file structure is consistent across the codebase."
  - "Mailpit integration test uses `await mailpitReachable()` at TOP-LEVEL await (vitest supports this) and `describe.skipIf(!REACHABLE)`. CI without mailpit cleanly skips. CI with `docker compose --profile dev up -d mailpit` runs the test against real SMTP transport."
  - "Rate-limit tests use the IN-PROCESS fallback (no Valkey) because @fastify/rate-limit's local LRUCache backend is sufficient for assertion of the envelope + bucketing; testcontainers Redis would add ~5s startup with no semantic gain. Production wires Valkey via VALKEY_URL."
metrics:
  duration: ~22 min
  tasks: 3
  files_created: 9
  files_modified: 7
  tests_added: 16 (7 email + 1 mailpit-integration[skipped] + 3 rate-limit-check-user + 2 rate-limit-verification-status + 1 rate-limit-health-exempt + 2 openwhispr-source-log + 1 traefik-self-test[passing-with-docker])
  tests_passing_total: 120 apps/api (excluding 4 pre-existing deferred check-default-secrets failures + 1 mailpit-skipped)
  completed_date: 2026-05-09
---

# Phase 2 Plan 04: Rate-Limit + SMTP + Traefik HTTPS-Only Summary

The three convention-and-infrastructure layers Plan 03 routes depend on: HTTPS-only enforcement at Traefik (WIRE-20, 308 permanent), per-route rate limiting with envelope-conformant 429 body (D-28 / Pitfall #1), and SMTP email transport with dev fallback (D-26 / PROVIDER-04). Plan 04 also finalizes `buildApp()` with the full load-bearing plugin chain, wires Better Auth's `sendVerificationEmail` to the email service, and lands the AUTH-06 x-openwhispr-source log-emission assertion.

## Objective Status

- WIRE-20: HTTP -> 308 HTTPS at Traefik — added `permanent:true` to entrypoints.web.redirections; self-test passes against real Traefik v3.6
- D-28: per-route rate limits with envelope-conformant 429 body — `{error:"Too many requests"}` EXACTLY (single-key strict assertion via `Object.keys(body).length === 1`)
- D-26 + PROVIDER-04: SMTP via nodemailer with dev fallback — `SMTP_HOST` unset returns stub; mailpit integration test runs when reachable, skips cleanly otherwise; `.send()` re-throws on transport error (Pitfall #4)
- AUTH-06: x-openwhispr-source preserved in structured logs — 2 unit tests assert `openwhisprSource:"desktop"` on header set, `openwhisprSource:null` when absent
- Plan 04 sole authorship of `apps/api/src/index.ts` — load-bearing register order: errorHandler -> cookie -> zodTypeProvider -> requestLog -> rateLimit -> tenantPlugin (Phase 1 backwards-compat) -> dualAuthHook -> allRoutes from `routes/index.ts`
- trustProxy:true — Pitfall #2; X-Forwarded-For bucketing verified in rate-limit-check-user.test.ts

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | Email service (nodemailer + dev fallback) + Better Auth wiring + mailpit integration test | 1bbfc66 |
| 2 | Rate-limit plugin (envelope-conformant 429) + 3 integration tests + buildApp finalization + trustProxy | e821b2c |
| 3 | WIRE-20 HTTPS-only redirect + AUTH-06 log emission test + traefik-https-only self-test | 86aec83 |

## Verification Results

- `pnpm --filter @openwhispr/api typecheck` — clean
- `pnpm --filter @openwhispr/api test --run` — **120 tests pass + 1 skipped (mailpit gated)**, 4 pre-existing failures in `apps/api/scripts/check-default-secrets.test.ts` (deferred per Plan 02-01 / 02-02 SUMMARY)
- `pnpm exec vitest run tests/self-tests/traefik-https-only.test.ts` — passes against real Traefik v3.6 (single test, ~16s)
- Email test trio (mocked nodemailer): 7/7 green; mailpit-reachability gated test cleanly skipped on executor host
- Rate-limit tests: 6/6 green; envelope strict-shape verified via `expect(body).toEqual({error:"Too many requests"})` AND `expect(Object.keys(body).length).toBe(1)`
- AUTH-06 log emission: 2/2 green; both header-set and header-absent branches asserted
- Traefik self-test verified: HTTP request to `http://127.0.0.1:80/api/health` with `Host: api.localhost` returns 308 with `Location: https://...`; clean teardown via `docker compose down -v` and .env restore

## Key Decisions

1. **errorResponseBuilder returns Error, not plain object** — @fastify/rate-limit v10's `defaultErrorResponse` template emits `new Error()` with `statusCode` attached; the plugin THROWS the return value. The plan pseudocode `errorResponseBuilder: () => ({error:"Too many requests"})` produced 500s in our diagnostic harness because `setErrorHandler` couldn't map a plain-object throwable to a status code. We now return `Error("Too many requests")` with `statusCode = 429` and a sentinel `__rateLimited` flag; `setErrorHandler` already had `fv.statusCode === 429 → 429 + envelope` branch from Plan 03, so the wire body is EXACTLY `{error:"Too many requests"}` as specified.
2. **buildApp() now async** — every plugin register is `await`'d. Phase 0's `const app = buildApp()` callsite in `health.test.ts` was updated. The entry-point bootstrap uses top-level await (Node 24 ESM).
3. **Existing file is `traefik.yml`, not `static.yml`** — the plan referred to `compose/traefik/static.yml`; Phase 1 established `traefik.yml` as the static-config filename. Augmented the existing file (added `permanent:true`) rather than rename.
4. **Rate-limit tests use in-process fallback** — @fastify/rate-limit's local LRUCache backend is sufficient for envelope + bucketing assertions; testcontainers Redis would add ~5s startup with zero semantic gain. Production wires Valkey via `VALKEY_URL`.
5. **Mailpit integration test uses TOP-LEVEL await** for the reachability probe; `describe.skipIf(!REACHABLE)` cleanly skips when mailpit isn't up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] errorResponseBuilder return shape — plan pseudocode produced 500s**
- **Found during:** Task 2 first GREEN run — all 11th calls returned 500 with body `{}` instead of 429 with body `{error:"Too many requests"}`.
- **Issue:** @fastify/rate-limit v10 throws the value returned from errorResponseBuilder. A plain object lacks `statusCode`/`message`, so `setErrorHandler`'s default branch fires (500 + "Internal server error").
- **Fix:** Return `new Error("Too many requests")` with `statusCode = 429` set. The existing setErrorHandler branch (`fv.statusCode === 429 → reply.status(429).send({error: errMessage || "Too many requests"})`) then emits the correct envelope.
- **Files modified:** `apps/api/src/plugins/rate-limit.ts`
- **Commit:** rate-limit task commit

**2. [Rule 3 - Blocking] Phase 0 buildApp signature changed sync→async**
- **Found during:** Task 2 typecheck after rewriting index.ts
- **Issue:** `health.test.ts` (Phase 0 leftover) called `const app = buildApp()` and immediately `await app.inject(...)`; the new async buildApp returns `Promise<FastifyInstance>` which has no `.inject` method.
- **Fix:** Updated `health.test.ts` to `const app = await buildApp()`. Also updated the response-shape expectation from `{status:"phase-0-placeholder"}` to `{status:"ok"}` (Plan 03's HealthResponse).
- **Files modified:** `apps/api/src/health.test.ts`
- **Commit:** rate-limit task commit

**3. [Rule 3 - Blocking] FastifyContextConfig.rateLimit duplicate declaration**
- **Found during:** Task 2 typecheck after registering @fastify/rate-limit
- **Issue:** Plan 03's `dual-auth.ts` declared `rateLimit?:false|{max,timeWindow,keyGenerator}` as a forward-compat shim. Once @fastify/rate-limit is registered, its own module augmentation declares `rateLimit?:false|RateLimitOptions`. TS error TS2717 (subsequent property declarations must have the same type).
- **Fix:** Removed our shim from `dual-auth.ts` (commented as "now owned by @fastify/rate-limit"); kept only `auth?:boolean`.
- **Files modified:** `apps/api/src/middleware/dual-auth.ts`
- **Commit:** rate-limit task commit

**4. [Rule 3 - Blocking] @redis/client v5 strict-types vs `password?: string | undefined`**
- **Found during:** Task 2 typecheck
- **Issue:** With `exactOptionalPropertyTypes: true`, `password: process.env.VALKEY_PASSWORD` (string|undefined) doesn't assign to `RedisClientOptions.password: string`.
- **Fix:** Conditionally attach `password` only when truthy; use `clientOpts: { url: string; password?: string }` typed builder.
- **Files modified:** `apps/api/src/plugins/rate-limit.ts`
- **Commit:** rate-limit task commit

**5. [Rule 3 - Blocking] pino direct import unavailable for AUTH-06 log capture**
- **Found during:** Task 3 first run — `Cannot find package 'pino'`.
- **Issue:** pino is a transitive dep of fastify but not a direct dep of @openwhispr/api; importing it directly fails module resolution.
- **Fix:** Use Fastify's built-in `logger: {level, stream}` config — Fastify constructs the pino logger internally with our custom write-stream.
- **Files modified:** `apps/api/src/__tests__/openwhispr-source-log.test.ts`
- **Commit:** WIRE-20 task commit

## Authentication Gates

None — no human-action checkpoints reached.

## Deferred Items

- **Mailpit integration test execution in CI** — the test is gated on mailpit reachability (probe of `http://mailpit:8025/api/v1/info`). To execute it in CI, a workflow must run `docker compose --profile dev up -d mailpit` before invoking vitest with `MAILPIT_HTTP_URL=http://mailpit:8025`. Out of scope for this plan; CI integration is a Plan 06 / CI-02 concern.
- **`apps/api/scripts/check-default-secrets.test.ts` (4 failures)** — pre-existing, documented in Plan 02-01 and 02-02 SUMMARY Deferred Items. Resolves SCRIPT via `process.cwd()`. Out of scope.
- **AUTH-04 token-rotation overlap helper (`tryPreviousToken`)** — `dualAuthHook` accepts the helper as injected dep; DB-touching impl lands in a later plan.
- **CONTAINER-A2 mailpit /livez resolution** — Plan 02 already settled this via OR-fallback (`/livez || /api/v1/info`); no further action.

## Threat Model — Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-02-04-01 (HTTP downgrade attack) | Mitigated: traefik.yml entrypoints.web is redirect-only with permanent:true (308); dynamic.yml routers all on websecure (verified Plan 02); self-test passes against real Traefik v3.6 |
| T-02-04-02 (Default 429 body leaks framework details) | Mitigated: errorResponseBuilder returns Error{statusCode:429, message:"Too many requests"}; setErrorHandler emits {error:"Too many requests"} EXACTLY; tests assert single-key body via `Object.keys(body).length === 1` |
| T-02-04-03 (X-Forwarded-For spoofing) | Accepted (v1): trustProxy:true acceptable inside closed Docker network; Phase 6 ops hardening reduces to CIDR allowlist |
| T-02-04-04 (Email-relay abuse via misconfigured SMTP) | Mitigated: nodemailer no auto-retry on 4xx; .send() RE-THROWS on transport error; operator sees logs |
| T-02-04-05 (Better Auth swallows email errors) | Mitigated: email.send() RE-THROWS (Pitfall #4); Better Auth keeps account unverified; verification-status returns false until SMTP fixed; unit test asserts re-throw branch |
| T-02-04-06 (mailpit accessible in production) | Mitigated: profiles:[dev] gates mailpit; never instantiated by `docker compose up` default (Plan 02) |

## Threat Flags

(none)

## Self-Check: PASSED

Verified files exist:
- FOUND: apps/api/src/email.ts
- FOUND: apps/api/src/email.test.ts
- FOUND: apps/api/src/__tests__/email-mailpit.test.ts
- FOUND: apps/api/src/plugins/rate-limit.ts
- FOUND: apps/api/src/__tests__/rate-limit-check-user.test.ts
- FOUND: apps/api/src/__tests__/rate-limit-verification-status.test.ts
- FOUND: apps/api/src/__tests__/rate-limit-health-exempt.test.ts
- FOUND: apps/api/src/__tests__/openwhispr-source-log.test.ts
- FOUND: tests/self-tests/traefik-https-only.test.ts

Verified commits exist (`git log --oneline`):
- FOUND: 1bbfc66 feat(02-04): email service (nodemailer + dev fallback) + Better Auth wiring + mailpit integration test
- FOUND: e821b2c feat(02-04): rate-limit plugin (envelope-conformant 429) + buildApp finalization + trustProxy
- FOUND: 86aec83 feat(02-04): WIRE-20 HTTPS-only redirect (308 permanent) + AUTH-06 log emission test + traefik self-test
