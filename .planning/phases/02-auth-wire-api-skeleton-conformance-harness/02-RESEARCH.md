# Phase 02 Research — Hub

> Phase 2 research split into three parallel dimensions. This file is the orchestrator/index.

## Dimension files

- **[02-RESEARCH-AUTH.md](./02-RESEARCH-AUTH.md)** — Better Auth 1.6.9 wiring, Drizzle adapter, Bearer + genericOAuth plugins, OAuth shim implementation, channel-scheme allow-list (`^[a-z][a-z0-9+\-.]*$`, 32-char cap, dangerous-scheme deny-list), token rotation overlap (custom `previous_token_hash` machinery — Better Auth stock invalidates immediately), cookie host scoping (eTLD+1 for split-host topology)
- **[02-RESEARCH-WIRE.md](./02-RESEARCH-WIRE.md)** — 4 wire endpoints (check-user / verification-status / delete-account / health), centralized error envelope via `setErrorHandler`, single zod schemas source of truth via `@fastify/type-provider-zod@1.0.0`, CONTRACT-01 conformance suite design (8 test files, runs against real deployed backend, not in-process), polling rate-limit carve-out keyGenerator
- **[02-RESEARCH-CONTAINER.md](./02-RESEARCH-CONTAINER.md)** — Multi-stage Dockerfile (node:24-alpine multi-arch), entrypoint.sh with `exec "$@"` so SIGTERM reaches Node, docker-compose `api` service + one-shot `migrate` service with `restart: no` + `service_completed_successfully`, nodemailer 8.0.7 + mailpit dev profile, @fastify/rate-limit 10.3.0 with custom `errorResponseBuilder` (default 429 body doesn't match `{error}` envelope)

## Cross-dimension load-bearing findings

### From AUTH
- **Pin: `better-auth@1.6.9`** verified npm 2026-05-09. Drizzle adapter / Bearer / genericOAuth all in-tree (no separate packages).
- **AUTH-04 ≥5-min overlap is NOT Better Auth default.** Stock rotation invalidates old token immediately. Phase 2 must add `previous_token_hash` + `previous_token_expires_at` columns to sessions, plus a `SECURITY DEFINER` lookup function (RLS-context cannot apply to the overlap fallback because tenant is unknown until lookup completes).
- **Cookie host scoping:** `domain` set to shared eTLD+1 when AUTH_URL ≠ OPENWHISPR_API_URL; omitted single-host; throw at boot for unrelated hosts.
- **Scheme allow-list:** `^[a-z][a-z0-9+\-.]*$`, 32-char cap, deny `javascript|data|file|vbscript|about|chrome|chrome-extension|ms-*`. Reject = 400 with `{error:"invalid callback scheme"}`, never 302.

### From WIRE
- **Single zod source of truth** in `packages/contract-tests/src/schemas.ts` — both API handlers and contract tests import from same file via `@fastify/type-provider-zod@1.0.0`. Structural defense against spec/handler/test triangle drift.
- **`setErrorHandler` is mandatory.** Inline `reply.send({error:...})` in handlers is the lint-flag pattern.
- **Cookie-auth-only on two endpoints** (verification-status + delete-account) — they get a `requireSessionCookie` preHandler, NOT the dual-auth chain.
- **Conformance tests hit real deploys, never in-process.** CI brings up `docker compose up api postgres pgbouncer redis traefik`, waits on /api/health, runs suite.

### From CONTAINER
- **`@fastify/rate-limit` default 429 body breaks our envelope.** `{statusCode, error, message}` ≠ `{error}`. `errorResponseBuilder: () => ({error:"Too many requests"})` is mandatory globally + per-route.
- **One-shot `migrate` service** (`restart: "no"` + `condition: service_completed_successfully`) over in-process migrate-on-startup. Habit-forming for Phase 9 Helm.
- **`entrypoint.sh` MUST `exec "$@"`** — otherwise SIGTERM doesn't reach Node and `docker stop` waits the full 10s grace.
- **PgBouncer bypass for migrate** — DDL needs owner role + transaction-mode breaks `CREATE INDEX CONCURRENTLY`. Add startup assertion in migrate.js rejecting URLs pointing at pgbouncer.
- **Pin: `nodemailer@8.0.7`, `@fastify/rate-limit@10.3.0`, `axllent/mailpit:latest` (1.29.7).**

## Pitfalls inventory (cross-dimension)

| # | Pitfall | Source | Mitigation |
|---|---------|--------|------------|
| 1 | 200-with-error on auth failure (PITFALLS #6) | WIRE | `setErrorHandler` always uses 401 for AuthError; conventions test asserts every endpoint with `Authorization: Bearer invalid` returns 401 |
| 2 | Hardcoded `openwhispr://` scheme (PITFALLS #14) | AUTH | Allow-list validator + multi-channel matrix conformance test (4 schemes + 1 reject case) |
| 3 | Cookie host-scoping breaks when AUTH ≠ API host (PITFALLS #21) | AUTH | eTLD+1 cookie domain config; `cookie-host.test.ts` conformance |
| 4 | Token rotation race during overlap | AUTH | Custom `previous_token_hash` machinery + 100-concurrent rotation contract test |
| 5 | Rate-limit 429 body breaks envelope contract | CONTAINER | `errorResponseBuilder` override globally |
| 6 | spec/handler/test schema drift | WIRE | Single zod file imported by both sides |
| 7 | docker stop waits full grace | CONTAINER | `exec "$@"` in entrypoint.sh |
| 8 | DDL through PgBouncer transaction-mode | CONTAINER | Migrate service connects directly via DATABASE_URL_OWNER, asserts non-pgbouncer URL at startup |
| 9 | Better Auth genericOAuth.onSuccess can't rewrite redirectTo | AUTH (A1) | Plan task: post-callback Fastify handler reads BA cookie + re-emits `<scheme>://?bearer_token=...` if needed |
| 10 | Mailpit healthcheck endpoint instability | CONTAINER (A2) | Plan task: probe `/livez` then fall back to `/api/v1/info` |

## Open questions for plan-time resolution

1. **AUTH-A1**: Better Auth `genericOAuth.onSuccess` per-request `redirectTo` rewriting — verify in 1.6.9 source during Wave 1
2. **AUTH-A3**: Re-verify `previous_token_hash` machinery vs stock rotation in 1.6.9 — Wave 1 source dive in `node_modules/better-auth/dist/plugins/bearer/*`
3. **WIRE-Q1**: Can `withTenant` wrap a Fastify `preHandler` hook, or only route handler body? (verify against `packages/data/src/tenant-context.ts`)
4. **WIRE-Q2**: `seed:conformance` fixture pre-seed — Phase 1 ships or Phase 2 Wave 0 creates? (likely Wave 0)
5. **WIRE-Q3**: `email_verified_at` schema location — extend Phase 1 `users` vs Better Auth's `verification` table? Confirmed: extend `users` (RLS-protected; Phase 1 schema migration adds via `ALTER TABLE users ADD COLUMN email_verified_at`)
6. **CONTAINER-A1**: `pnpm --prod deploy` mechanic for production node_modules pruning
7. **CONTAINER-A2**: mailpit `/livez` endpoint in v1.29.x — fall back to `/api/v1/info`

## Validation Architecture (rolled up)

### Auth dimension
- Sign-in with email+password → bearer ≥30 days TTL
- OAuth callback → `<scheme>://?bearer_token=<...>` for 4 schemes
- Reject `javascript:` → 400 with global error envelope
- Auth fail → 401 (not 200)
- Token rotation mid-flight → 100/100 concurrent succeed during overlap
- Cookie scoped to shared parent → reaches both AUTH_URL and OPENWHISPR_API_URL

### Wire dimension
- 4 endpoints conform byte-for-byte to BACKEND_SPEC.md
- Every non-2xx body matches `{error:string}` shape
- 401 on missing/invalid bearer to authenticated routes
- Polling-rate-limit carve-out for verification-status (30/min per ip+email)
- /api/check-user 11th in 60s → 429 with envelope shape

### Container/Email/Rate-limit dimension
- `docker compose up api` healthy in 60s
- `MASTER_KEK=changeme docker compose up api` → exit non-zero with key in stderr (closes Phase 1 D-08)
- Sign-up email arrives in mailpit dev UI
- migrate service runs to completion before api service starts
- Rate-limit 429 body matches `{error}` envelope (not default {statusCode, error, message})
