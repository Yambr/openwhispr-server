---
quick_id: 260524-u00
slug: chart-1-0-6-image-v1-0-4-eight-fixes
date: 2026-05-24
phase: discuss
---

# Context — Chart 1.0.6 + Image v1.0.4 (8-fix release)

## Goal
ONE atomic release: openwhispr-api/web/worker image v1.0.4 + openwhispr-server chart 1.0.6 + openwhispr-postgres chart bump, published to ghcr.io/yambr. All eight peer-reported tech-debt items resolved with test coverage + docs. Acceptance gate: peer can bump targetRevision on stage+prod ArgoCD Applications, do one smoke, and never touch kubectl exec for corrective SQL.

## Stakeholder constraints
- **User:** "Не торопись. Сделай аккуратно. Пиши план перед кодом. Качество > скорость." Single atomic release, no partial progress reports, no 1.0.6 → 1.0.7 minor cycles. Wait for fresh session if context runs out.
- **Peer (ykoolfs5, /Users/dev/Documents/yambr-k8s):** Prod runtime GREEN on chart 1.0.5; will bump to 1.0.6 once published. Prefers chart-side over runtime fixes where viable.
- **CLAUDE.md hard rules:** #1 never edit production to make tests pass, #3 orchestrator verifies sub-agent claims, #4 never bypass gitleaks. Plus all constitutional LOCKER-XX (schema+rateLimit on routes, no NODE_ENV in runtime, no `as any`, no plaintext credential cols).
- **Memory feedbacks:** [[feedback_no_workarounds_enterprise]] — no `--legacy`, no hacks, no `--no-verify`. [[feedback_characterization_test_real_surface]] — integration tests boot real buildApp() with real Postgres. [[feedback_advisor_for_grey_areas]] — DONE for #4 and #5.

## Ground-truth facts (from Explore research)

| # | Fact | Citation |
|---|------|----------|
| 1 | Worker bundle path: `/app/apps/worker/dist/index.cjs` (CJS); WORKDIR `/app` | apps/worker/Dockerfile:86,98; tsup.config.ts:31 |
| 2 | Worker REQUIRES `DATABASE_URL_OWNER` at startup (loud-fail) | apps/worker/src/index.ts:102; apps/worker/src/db/app-pool.ts:151-154 |
| 3 | `LITELLM_DATABASE_URL` consumed only by worker's litellm-pool.ts; api does NOT read it | apps/worker/src/db/litellm-pool.ts:15 |
| 4 | openwhispr-postgres chart exists with `postInitApplicationSQL` already; migration 0024 already has `DO $$ ALTER ROLE` for fresh DBs | charts/openwhispr-postgres/templates/postgres-cluster.yaml:73-84; packages/data/migrations/0024_*.sql:40-45 |
| 5a | Worker uses split env `VALKEY_HOST/PORT/PASSWORD` (NO URL fallback) | apps/worker/src/index.ts:130-136 |
| 5b | API uses `VALKEY_URL` (ioredis URL parsing) | apps/api/src/plugins/rate-limit.ts:191 |
| 5c | Compose worker block also uses split env (3 files: docker-compose.yml:472-474, docker-compose.external-litellm.yml:129-131, compose/docker-compose.embedded-litellm.yml:671-673) | (see) |
| 6a | `createEmailSender` lives in `packages/email/src/EmailSender.ts:97-110`; throws when `!host && NODE_ENV==="production"` | (see) |
| 6b | Both api (apps/api/src/auth.ts) AND worker (apps/worker/src/index.ts:113) call createEmailSender eagerly at boot | (see) |
| 6c | `@openwhispr/email` does NOT yet depend on `@openwhispr/byok-guard`; no cycle risk | packages/email/package.json; packages/byok-guard/package.json |
| 7 | `apps/worker/src/i18n/template-renderer.ts:72` uses bare `import.meta.url` — breaks in CJS bundle | (see); pattern in apps/api/scripts/check-default-secrets.ts:32-36 |
| 8a | GET /api/locale already exists at apps/api/src/routes/locale.ts:72-92; POST sibling needed | (see) |
| 8b | i18next cookie name is the default `i18next`; @fastify/cookie is registered in buildApp | apps/api/src/i18n/init.ts:155; apps/api/src/index.ts |
| 8c | `users.locale` column exists (`text NOT NULL DEFAULT 'en'`) | packages/data/src/schema/users.ts:34 |
| 8d | POST route template with LOCKER-04 schema+rateLimit: apps/api/src/routes/check-user.ts:35-45 | (see) |
| 9 | Integration test pattern: `PostgreSqlContainer("ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1")` + vitest. Reference: apps/api/tests/integration/better-auth-envelope-at-rest.test.ts:49-80 | (see) |
| 10 | Image release on `v*` tag, chart release on `chart-v*` tag — decoupled. `Chart.appVersion` is manual. | .github/workflows/release.yml:20-21; chart-release.yml:24-25; Chart.yaml:17-18 |

## Decisions (from advisor reports — record + rationale)

### D1 — Fix #4 placement: **Option A (CNPG `postInitApplicationSQL`)**
- Append one line to `charts/openwhispr-postgres/templates/postgres-cluster.yaml` `postInitApplicationSQL` list: `ALTER ROLE {{ .Values.postgres.appRole }} SET app.tenant_id = '00000000-0000-0000-0000-000000000000';`
- Compose users already covered by migration 0024's `DO $$ IF EXISTS` block.
- BYOK Postgres operators covered by README "Prerequisites" section update.
- v2 cleanup (D3 — request-scoped Better Auth adapter) requires removing one chart line + migration 0024 → minimal churn.
- **Verification gate:** `helm install pg charts/openwhispr-postgres --wait` then `kubectl exec pg-cluster-1 -- psql -c "SELECT unnest(rolconfig) FROM pg_roles WHERE rolname = '<app-role>'"` must show `app.tenant_id=00000000-0000-0000-0000-000000000000`.

### D2 — Fix #5 placement: **Option A (refactor worker to parse `VALKEY_URL`)**
- Image rebuild already required for #6/#7/#8 → incremental cost is one source edit + tests + 3 compose-file diffs.
- Eliminates api/worker code divergence; deletes peer's `extraEnv: [VALKEY_HOST/PORT/PASSWORD]` workaround.
- Matches BullMQ documented pattern (`new Worker(name, fn, { connection: new IORedis(url) })`).
- Adds `rediss://` TLS support transparently (ioredis URL parsing).
- **Scope addition:** 3 compose-file worker blocks need `VALKEY_HOST/PORT/PASSWORD` → `VALKEY_URL` flip for symmetry with api.
- **Verification gate:** unit test for URL parsing (happy, missing-env, rediss) + helm template asserts no split env on worker + compose smoke up shows worker BullMQ connect via URL.

### D3 — Fix #6 placement: import `isK8sDeploymentMode` from `@openwhispr/byok-guard` into `packages/email/src/EmailSender.ts`
- Currently `isK8sDeploymentMode` is private (line 337). Export it from `packages/byok-guard/src/index.ts`.
- Add `@openwhispr/byok-guard: workspace:*` to `packages/email/package.json`.
- In createEmailSender: when `!host && NODE_ENV==='production'` AND `isK8sDeploymentMode(env)` → warn-only + return no-op sender. When NOT k8s mode → existing throw preserved (regression guard).
- Worker AND api both benefit — same code path.
- **Note:** This makes SMTP truly operator-optional in k8s mode. Better Auth's email-verification flow degrades gracefully (verification email never sent — sign-up still completes; user re-requests; once operator provisions SMTP secret, restart pods, flow works).

### D4 — Fix #8 design: POST `/api/locale` writes both cookie + (if session) users.locale UPDATE
- Sibling to existing GET handler in `apps/api/src/routes/locale.ts`.
- Schema: `z.object({ locale: z.enum(['en', 'ru']) })` per LOCKER-04.
- rateLimit: `{ max: 10, timeWindow: '1 minute' }` per LOCKER-04 (matches check-user.ts pattern).
- Cookie: name `i18next` (matches what i18next-http-middleware reads by default), `HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` (1 year). `Secure` flag set when request protocol is https (via `req.protocol`).
- If `req.session?.user?.id`: `UPDATE users SET locale = $1 WHERE id = $2` (RLS handled via withTenantContext from existing auth plugin).
- If anonymous: cookie-only (works for unauth /sign-in /sign-up pages, which is the exact bug the peer reported).
- **Auth posture:** `config: { auth: false }` — both anonymous and authenticated users may call (matches GET sibling).

### D5 — Worker DDL guard for `DATABASE_URL_OWNER` already exists; chart fix is correct
- Worker's `app-pool.ts:151-154` already loud-fails if missing — peer's `extraEnv` workaround was essential.
- Chart wires `DATABASE_URL_OWNER` from `Values.database.ownerUrlSecretRef` (already populated for migrate Job) into worker Deployment env.
- No code change for #2.

### D6 — `LITELLM_DATABASE_URL` is worker-only
- Add `Values.litellm.databaseUrlSecretRef` (optional, `{ name: "", key: "url" }`).
- Wire into worker-deployment.yaml conditionally — `{{- if .Values.litellm.databaseUrlSecretRef.name }}`.
- Do NOT add to api or web (they don't read it).
- migrate Job uses `DATABASE_URL_OWNER` to auto-create the litellm DB (only when `SKIP_LITELLM_DB_AUTOCREATE` is unset).

## Out of scope
- Anything not in the 8-item list.
- v2 D3 fix (request-scoped Better Auth adapter).
- TLS posture e2e for `rediss://` worker connections (deferred-item if needed).
- LiteLLM client robustness (separate phase, separate concern).
- New features.
- Refactoring "while we're at it".

## Test discipline
- Per fix:
  - **#1, #2, #3 (chart):** helm template assertions via `helm template ... | yq`. Add to existing `charts/openwhispr-server/tests/` or `tools/test-chart-render.sh`.
  - **#4 (chart bootstrap):** Manual verification gate via kind cluster + helm install (script in `tools/`).
  - **#5 (worker code):** vitest unit test for new `connectionFromUrl()` helper.
  - **#6 (email code):** vitest unit test on `createEmailSender` k8s-mode branch (happy + regression guard).
  - **#7 (template-renderer code):** vitest unit test for CJS/ESM dual-mode `resolveLocalesDir()`.
  - **#8 (api route):** integration test via real Postgres testcontainer + real buildApp() per [[feedback_characterization_test_real_surface]].

## Risk register
| Risk | Mitigation |
|------|------------|
| GitHub Actions release pipeline failure mid-release | Push tag, observe; if image build fails, delete tag, fix, re-push (idempotent via gh release delete) |
| Postgres testcontainer leaks (history: api vitest leaks) | Per [[feedback_testcontainers_cleanup_audit]] — explicit `await container.stop()` in afterAll; audit after run |
| Chart-side ALTER ROLE on existing prod cluster (peer already did manual ALTER) — idempotency | ALTER ROLE SET is overwrite-not-append; postInitApplicationSQL fires only on Cluster init, so existing clusters are NOT touched. Peer's manual ALTER stands; new chart installs get it free. |
| BYOK operator on managed Postgres (RDS) hits same incident peer hit | README explicit "BYOK Postgres prerequisites" section enumerates the one-liner. |
| Compose users break on VALKEY_URL refactor | All 3 compose files already supply `VALKEY_URL` env via `.env.*.example`; only worker block needs to read it instead of split — backwards-compatible if both are provided. |
| Image v1.0.4 multi-arch (amd64+arm64) build time + cache | Existing release.yml uses buildx + GHA cache — well-trodden path. Allow up to 30min per arch. |
