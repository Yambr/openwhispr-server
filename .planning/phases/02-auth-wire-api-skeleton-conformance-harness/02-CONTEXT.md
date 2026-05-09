# Phase 2: Auth + Wire-API Skeleton + Conformance Harness — Context

**Gathered:** 2026-05-09 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up the **complete auth surface** the desktop client expects, **the conformance test harness** that locks the wire contract for the rest of the project, and **only the four pre-auth/lifecycle wire endpoints** (`/api/check-user`, `/api/auth/verification-status`, `/api/auth/delete-account`, `/api/health`). All operational endpoints (transcribe / reason / agent stream / etc.) are Phase 3-5.

**In scope:**
- Better Auth server library wired to Drizzle + Postgres (uses Phase 1 schema)
- Email + password sign-in (built-in, no IdP required) and OIDC pluggable via Better Auth's OAuth-Provider plugin (one provider as v1 example: generic OIDC)
- OAuth shim `${AUTH_URL}/api/desktop-signin/{provider}` initiates IdP round-trip
- Custom-protocol redirect emitting `<scheme>://?bearer_token=<token>` with **scheme echoed from `callbackURL` query param** (multi-channel matrix tested)
- Allow-list of valid scheme prefixes + scheme-validation middleware that rejects `javascript:` / `file:` / unknown schemes with 400 (prevents open-redirect)
- Opaque bearer tokens ≥30 days; rotation via `set-auth-token` response header on Better-Auth-style endpoints; new+old overlap ≥5 minutes
- Token-rotation contract test: 100 concurrent requests issued mid-rotation never see a 401 cascade
- Dual auth: every authenticated endpoint accepts `Authorization: Bearer <opaque>` AND session cookies interchangeably
- Global error envelope `{ "error": "<human-readable>" }` for every non-2xx; HTTP 401 (not 200-with-error) on invalid/expired token; HTTPS-only enforced via Traefik
- 4 wire endpoints: `POST /api/check-user`, `GET /api/auth/verification-status?email=...`, `DELETE /api/auth/delete-account`, `GET /api/health`
- 5s polling carve-out from rate limiter for `/api/auth/verification-status`
- `x-openwhispr-source: desktop` preserved in request log + observable as a per-request tag
- SMTP email provider for verification + admin notifications (D-pluggable; no other provider in v1)
- **CONTRACT-01 conformance suite** in `packages/contract-tests/` — runnable via `make contract-test BACKEND_URL=...`; asserts byte-for-byte spec compliance for the 4 endpoints + global conventions + channel-scheme echo + token rotation; wired as required GHA check on every PR
- API container materializes (Dockerfile + `api` service in docker-compose.yml) — closes Phase 1 deferred D-08 (entrypoint defense-in-depth)

**Out of scope (later phases):**
- `/api/transcribe`, `/api/reason`, `/api/agent/stream`, `/api/agent/web-search` — Phase 3
- Streaming/realtime endpoints + tokens — Phase 4
- `/api/usage`, `/api/streaming-usage`, `/api/stt-config`, `/api/note-recording-config`, `cloud-api-request` — Phase 5
- LiteLLM integration — Phase 3
- Magic-link, SAML, SCIM — v2

</domain>

<decisions>
## Implementation Decisions

### Better Auth integration

- **D-01:** Better Auth server v1.x latest (verify pin during research). Configured via single `apps/api/src/auth.ts` — exports `auth` instance and Fastify plugin. Drizzle adapter (`better-auth/adapters/drizzle`) bound to the Phase 1 `appDb` (`openwhispr_app` role via PgBouncer). Better Auth schema migrations integrated into Phase 1's drizzle migrations system (extend `0001_better_auth.sql`).
- **D-02:** Email + password is enabled by default. OIDC provider configured via env (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`); if any of these is absent, OIDC is silently disabled (email+password remains).
- **D-03:** Bearer tokens are opaque; format and signing internal. ≥30-day TTL. Rotation: every Better-Auth call may emit `set-auth-token` response header carrying a fresh token; old token remains valid for 5 minutes after rotation (overlap window covers 60s `withSessionRefresh` grace).
- **D-04:** Dual-auth via Fastify `onRequest` hook chain: try `Authorization: Bearer` first; if absent, try session cookie via Better Auth's cookie validator. Hook attaches `req.user` and `req.tenant` (via `withTenant` from Phase 1) before route handler runs. If both fail on an authenticated route → 401 with global envelope.

### OAuth shim + custom-protocol redirect

- **D-05:** `GET /api/desktop-signin/{provider}` lives at `apps/api/src/routes/desktop-signin.ts`. Reads `callbackURL` query param, extracts scheme + path, validates scheme against allow-list, persists state in `oauth_state` table (Phase 1 schema doesn't have it — Phase 2 adds via migration `0002_oauth_state.sql`), redirects browser to IdP authorize endpoint.
- **D-06:** Allow-list of valid scheme prefixes: `openwhispr://`, `openwhispr-dev://`, `openwhispr-staging://`, plus any scheme matching `OPENWHISPR_PROTOCOL` env (override). Pattern: `[a-z][a-z0-9+.-]*` per RFC 3986 scheme grammar; max 32 chars; reject if scheme contains `javascript`, `data`, `file`, or any control character.
- **D-07:** Final redirect URL: `${scheme}://?bearer_token=${token}`. Scheme is **echoed verbatim** from validated `callbackURL`; never hardcoded. Token is the freshly-issued Better Auth opaque bearer.
- **D-08:** OAuth callback handler `/api/auth/callback/{provider}` exchanges authorization code for IdP id_token, looks up or creates the user in `users` table under the **default tenant** (Phase 2 has no multi-tenant signup flow yet — that's Phase 5/6), issues bearer token, redirects to `<scheme>://?bearer_token=<token>`.

### Wire endpoints

- **D-09:** `POST /api/check-user` — pre-auth, no bearer required; reads `email` from body; SELECT against `users` (with default-tenant context); returns `{ exists: boolean }`. No rate-limit carve-out (regular limiter applies).
- **D-10:** `GET /api/auth/verification-status?email=...` — cookie-auth; checks if the user matching `email` (under their session's tenant) has `email_verified_at` set; returns `{ verified: boolean }`. **Polling rate-limit carve-out:** key the limiter on `(ip, email)` and allow 30 req/min (5s cadence + jitter headroom).
- **D-11:** `DELETE /api/auth/delete-account` — cookie-auth (per spec — does NOT use bearer); deletes the authenticated user + cascades sessions + audit-log entry; returns `{}` at 200.
- **D-12:** `GET /api/health` — no auth, no body; returns 200 with `{ status: "ok" }`. 3s timeout enforced via Traefik route timeout.
- **D-13:** Every endpoint's response is JSON; 2xx returns the documented body shape; non-2xx returns `{ "error": "<string>" }`. Centralized `setErrorHandler` in Fastify replaces default error response.
- **D-14:** Every authenticated route returns 401 (not 200-with-error) on missing/invalid bearer + cookie. Centralized 401 emitter; `withSessionRefresh` retry path on the desktop relies on this exit code.

### Conventions enforcement

- **D-15:** HTTPS-only at the ingress layer (Traefik `entrypoint.web` redirects HTTP→HTTPS; Phase 1 already routes through Traefik). Plaintext HTTP on the API container's internal `:3000` is fine within the docker-compose network — Traefik terminates TLS.
- **D-16:** `x-openwhispr-source` header preserved end-to-end. Logged as a structured field on every request. Not used for auth decisions in v1 — purely observability.

### CONTRACT-01 conformance suite

- **D-17:** `packages/contract-tests/src/` — Vitest test suite with one file per endpoint + global conventions. Reads `BACKEND_URL` from env (defaults to `http://api.localhost`); runs against any deployed instance. Tests assert: status code, JSON shape (via `zod`-defined contracts that mirror BACKEND_SPEC.md JSON examples byte-for-byte), required headers (`set-auth-token` on rotation, error envelope shape on non-2xx), and channel-scheme echo on the OAuth redirect.
- **D-18:** Multi-channel matrix test: hit `/api/desktop-signin/<provider>` with `callbackURL=<scheme>://callback&protocol=<scheme>` for each of `openwhispr`, `openwhispr-dev`, `openwhispr-staging`, `mycorp-whispr` (custom override case); follow the redirect chain; assert final `Location: <scheme>://?bearer_token=<...>` matches the requested scheme verbatim. Reject case: `callbackURL=javascript:alert(1)` returns 400.
- **D-19:** Token-rotation contract test: spin up app instance, sign in, fire 100 concurrent authenticated requests interleaved with a forced-rotation pulse (Better Auth admin endpoint or test-only hook), assert 0/100 receive 401 during the overlap window (≥5 min).
- **D-20:** Cookie-host matrix test: deploy fixture with `AUTH_URL=https://auth.example.test` ≠ `OPENWHISPR_API_URL=https://api.example.test`; sign in; immediately hit `/api/auth/verification-status` (cookie-only auth); assert 200 (not 401). Catches the cookie-host-scoping pitfall.
- **D-21:** Conformance suite entry point: `make contract-test BACKEND_URL=...` invokes `pnpm --filter @openwhispr/contract-tests test --run`. Wired as a required GHA check `contract-test` on every PR (runs against an ephemeral `docker-compose up` API).

### Migrations

- **D-22:** Phase 2 adds two migrations: `0001_better_auth.sql` (Better Auth's required tables: `account`, `verification`, `passkey` — generated by Better Auth's CLI, hand-augmented with FORCE RLS + tenant_id-scoped policies) and `0002_oauth_state.sql` (state token storage for OAuth shim, short TTL, cleaned up by BullMQ in Phase 6 — Phase 2 just creates the table).

### API container + Dockerfile (closes Phase 1 D-08 deferred)

- **D-23:** `apps/api/Dockerfile` — multi-stage (builder + runtime); builder runs `pnpm install --frozen-lockfile && pnpm build`; runtime is `node:24-alpine` minimal; ENTRYPOINT `["node", "/app/apps/api/scripts/check-default-secrets.cjs"]` BEFORE main entry. Server listens on `0.0.0.0:3000`.
- **D-24:** `docker-compose.yml` adds `api` service (build context `.`, dockerfile `apps/api/Dockerfile`, depends_on Postgres+Redis+SMTP service if added) on `openwhispr_internal` network. Traefik routes `api.localhost` → `api:3000`.
- **D-25:** Self-test extension: `tests/self-tests/api-entrypoint-default-secrets.test.ts` — uses Dockerode (or `docker compose run`) to spin up the api service with fixture `.env` containing `MASTER_KEK=changeme`; asserts container exits non-zero with `MASTER_KEK` in stderr. Closes the SC#1 partial from Phase 1.

### Email provider (SMTP only in v1)

- **D-26:** SMTP transport via `nodemailer` (or whatever Better Auth's email plugin recommends for 2026). Operator configures via env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. If `SMTP_HOST` is unset, email features are disabled and verification falls back to a no-op (account auto-verified) — this is the dev path so first-launch under 5 min works without an SMTP server.
- **D-27:** Self-host compose includes a `mailpit` service for local dev (catches outbound emails into a web UI at `mailpit.localhost`). Production operators replace with their own SMTP relay via env override.

### Rate limiting

- **D-28:** `@fastify/rate-limit` plugin backed by Redis (Phase 1 Valkey instance). Default: 60 req/min per IP. Per-route overrides:
  - `/api/auth/verification-status` — 30 req/min per `(ip, email)` (covers desktop's 5s polling)
  - `/api/check-user` — 10 req/min per IP (anti-enumeration)
  - `/api/auth/delete-account` — 5 req/min per user (anti-mistake)

### Claude's Discretion

- Exact Better Auth minor version + which adapter package name (verify at research time)
- Whether OAuth state goes in Postgres `oauth_state` table or Redis with TTL — recommend Postgres for auditability
- Exact zod schema vs JSON Schema for contract tests — recommend zod (TS-native)
- Whether `mailpit` ships as a default-profile service or a `dev` profile only — recommend `dev` profile
- Pin `nodemailer` minor or use `@better-auth/email` if it exists in 2026
- Whether to ship a sample Google Workspace OIDC config in `.env.example` or just the generic OIDC fields — recommend generic only (operator picks provider)
- File organization for routes: monolithic vs one-file-per-route — recommend one-file-per-route for grep clarity

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — constitutional rules
- `.planning/REQUIREMENTS.md` — WIRE-01..04, WIRE-17..20, AUTH-01..07, PROVIDER-03, PROVIDER-04, CONTRACT-01
- `.planning/ROADMAP.md` § Phase 2 — goal + 7 success criteria
- `.planning/research/STACK.md` — Fastify 5, Better Auth, Drizzle, Postgres 17 stack already locked

### Wire-contract authority (MUST be honored byte-for-byte)
- `/Users/dev/openwhispr/docs/SELF_HOSTING.md` — wire walkthrough; § Authentication Contract; § OAuth Flow Walkthrough; § Custom Protocol Channel Variants; § Edge Cases
- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` — per-endpoint contract; § Conventions; § Global Error Envelope; cards for the 4 endpoints in scope
- `/Users/dev/openwhispr/docs/OAUTH_SPEC.md` — § OpenWhispr Cloud Sign-In; § Custom Protocol Reference; § Conventions

### Phase 1 outputs (substrate now in place)
- `packages/data/src/client.ts` — `makeAppDb` (PgBouncer) and `makeOwnerDb` (direct, BYPASSRLS, DDL only)
- `packages/data/src/tenant-context.ts` — `withTenant<T>` middleware contract
- `packages/data/src/encryption/` — KEK/DEK envelope (used for token-at-rest encryption in Phase 2)
- `packages/data/src/schema/` — tenants/users/sessions tables (Better Auth extends; sessions table will need `token_hash` column added per D-22)
- `tools/lint-rls.ts` — every new tenant-scoped table from Phase 2 migrations must pass this lint
- `apps/api/src/index.ts` — Fastify placeholder; replaced/extended in Phase 2
- `apps/api/src/middleware/tenant.ts` — Fastify hook reading `x-tenant-id` header in Phase 1; Phase 2 wires real tenant resolution from bearer token
- `apps/api/scripts/check-default-secrets.ts` — entrypoint guard, finally invoked by the new Dockerfile (D-23)

### External standards
- Better Auth docs (server) — https://better-auth.com/docs
- Better Auth Bearer plugin — https://better-auth.com/docs/plugins/bearer
- Better Auth OAuth Provider plugin — https://better-auth.com/docs/plugins/oauth-provider
- @fastify/rate-limit — https://github.com/fastify/fastify-rate-limit
- nodemailer — https://nodemailer.com/
- Mailpit — https://mailpit.axllent.org/
- RFC 3986 § 3.1 (URI scheme grammar) — https://datatracker.ietf.org/doc/html/rfc3986#section-3.1

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1)
- `withTenant<T>` middleware contract — Phase 2 every authenticated handler runs inside it
- `makeAppDb` / `makeOwnerDb` — Better Auth uses `appDb`; migrations run via `makeOwnerDb`
- `EnvKeyProvider` — used to encrypt persisted refresh tokens / 2FA secrets at rest if Better Auth needs that storage
- `apps/api/src/index.ts` `buildApp()` — extend with Better Auth plugin, error handler, route registration
- `apps/api/scripts/check-default-secrets.ts` — finally invoked by Dockerfile ENTRYPOINT (closes Phase 1 D-08)
- `tests/self-tests/` pattern — extend with `api-entrypoint-default-secrets.test.ts`
- `packages/contract-tests/` workspace — Phase 0 ships shell; Phase 2 fills the actual conformance suite

### Established Patterns
- TDD red→green commit pairs (every plan in Phase 0+1 followed this)
- Conventional Commits enforced by lefthook + commitlint
- English-only via `tools/lint-english.ts`
- Coverage thresholds 85/80/80/85 (currently 100% — must not regress)
- `tools/lint-rls.ts` blocks any new tenant-scoped table without RLS+FORCE RLS+policy

### Integration Points
- `apps/api/src/index.ts` — Fastify root; register Better Auth, error handler, 4 wire routes, rate limiter, request logger with `x-openwhispr-source` field
- `packages/data/migrations/` — new files `0001_better_auth.sql` + `0002_oauth_state.sql`; both run through `tools/lint-rls.ts`
- `docker-compose.yml` — add `api` service, optional `mailpit` dev service
- `compose/traefik/dynamic.yml` — `api.localhost` route already exists from Phase 1; ensure it points at `api:3000`
- `.github/workflows/ci.yml` — add `contract-test` job (spin up `docker compose up api postgres pgbouncer`, run `pnpm --filter @openwhispr/contract-tests test`)
- `scripts/branch-protection.json` — add `contract-test` to required contexts (Phase 0 self-test catches drift)
- `.env.example` — add `BETTER_AUTH_SECRET` (already there from Phase 1 bootstrap), `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `OPENWHISPR_PROTOCOL`

</code_context>

<specifics>
## Specific Ideas

- **The 401-vs-200 pitfall (PITFALLS #6) is the load-bearing wire-contract gotcha.** A handler that returns 200 with an `error` field on auth failure breaks the desktop's `withSessionRefresh` retry path — every desktop client transparently locks out. The plan-checker MUST flag any handler that conditionally returns 200 with an `error` body.
- **Channel-scheme echo (PITFALLS #14) is the second highest-risk wire-contract gotcha.** A hardcoded `openwhispr://` redirect breaks every dev/staging build because they expect their own scheme. The conformance suite's multi-channel matrix is the structural defense.
- **Cookie-host scoping (PITFALLS #21) is the third gotcha.** When `AUTH_URL ≠ OPENWHISPR_API_URL`, the cookie jar must reach both hosts. Better Auth's default cookie config sets cookies on AUTH_URL only — Phase 2 must explicitly extend cookie scope to API_URL.
- **CONTRACT-01 is incremental.** Phase 2 ships the harness shell + conformance for the 4 in-scope endpoints + global conventions + auth + redirect. Phases 3, 4, 5 each extend with their endpoints. The harness is wired as a required GHA check from Phase 2 onward — every subsequent phase's PR must keep it green.
- **The Phase 1 SC#1 partial (Dockerfile + entrypoint defense-in-depth) is closed in Phase 2.** The deferred-items.md entry can be deleted by the Phase 2 verifier.

</specifics>

<deferred>
## Deferred Ideas

- **Magic-link / passwordless** — v2 (per PROJECT.md out-of-scope)
- **SAML 2.0 / SCIM** — v2
- **Per-tenant signup flow / invite system** — Phase 5 or 6 (tenant management UI / API)
- **Custom IdP UI / self-hosted SSO portal** — defer; bundled IdP (Authentik/Keycloak) addressed via OIDC plugin
- **2FA / TOTP / WebAuthn** — Phase 6 or v2
- **Real-IP / forwarded-header config for rate limiter behind Traefik** — recommend wire it now (small lift), but if too tangled, defer to Phase 6 ops hardening
- **Token-revocation list / blocklist** — v2 (Better Auth's session-invalidation suffices for v1)
- **Email template i18n** — Phase 10 (DOCS-09 covers source lang; runtime locale resources land with i18n phase)
- **Webhook for sign-up events** — v2
- **Rate-limit response shape standardization** — confirm Better Auth's default 429 body matches our global envelope; if not, override
- **Mailpit in production compose** — only dev profile; production operators bring their own SMTP

</deferred>

---

*Phase: 02-auth-wire-api-skeleton-conformance-harness*
*Context gathered: 2026-05-09 (auto mode — recommended defaults selected; cross-phase consistency with Phase 0+1 verified)*
