---
quick_id: 260524-u00
slug: chart-1-0-6-image-v1-0-4-eight-fixes
date: 2026-05-24
phase: plan
status: ready
---

# PLAN — Chart 1.0.6 + Image v1.0.4 (8-fix atomic release)

ONE drop: openwhispr-api/web/worker image v1.0.4 + openwhispr-server chart 1.0.6 + openwhispr-postgres chart bump (if needed). 8 atomic commits, full test coverage, README updated, published to ghcr.io/yambr.

See [CONTEXT.md](./CONTEXT.md) for decisions (D1–D6), ground-truth facts, risk register.

## Task ordering — TDD discipline

Per CLAUDE.md TDD-RED-GREEN-REFACTOR: each commit contains test FIRST then production change (or both atomically per LOCKER-04). Each fix is one logical commit.

## Phase A — Code fixes (image v1.0.4 source)

### Task A1 — Export `isK8sDeploymentMode` from `@openwhispr/byok-guard`
**Why:** Fix #6 needs it imported from `packages/email`.

**Test (RED):** `packages/byok-guard/src/__tests__/k8s-mode.test.ts` — new file. Assert `isK8sDeploymentMode({ OPENWHISPR_DEPLOYMENT_MODE: 'k8s' }) === true`; `'K8S' === true`; `' k8s ' === true`; `undefined === false`; `'compose' === false`.

**Code (GREEN):** `packages/byok-guard/src/index.ts:337` — add `export` keyword to function (currently private).

**Commit:** `refactor(byok-guard): export isK8sDeploymentMode for consumers`

### Task A2 — Fix #6: `createEmailSender` k8s-mode bypass in `packages/email`
**Why:** Worker + api both call createEmailSender eagerly at boot; both must tolerate missing SMTP_HOST when operator hasn't provisioned SMTP yet.

**Test (RED):** `packages/email/src/__tests__/k8s-mode.test.ts` — new file. Three cases:
1. `createEmailSender({ env: { NODE_ENV: 'production', OPENWHISPR_DEPLOYMENT_MODE: 'k8s' } })` → does NOT throw; returns sender whose `.send()` logs warn + resolves successfully (no-op).
2. `createEmailSender({ env: { NODE_ENV: 'production', OPENWHISPR_DEPLOYMENT_MODE: 'k8s', SMTP_HOST: 'mail.example.com' } })` → real SMTP transport (k8s mode with SMTP configured = normal behavior).
3. **Regression guard:** `createEmailSender({ env: { NODE_ENV: 'production' /* no OPENWHISPR_DEPLOYMENT_MODE */ } })` → STILL throws (compose mode default).

**Code (GREEN):**
- `packages/email/package.json` — add `"@openwhispr/byok-guard": "workspace:*"` to deps.
- `packages/email/src/EmailSender.ts:97-110` — add early return when `!host && isK8sDeploymentMode(env)` returning a no-op sender that logs `event:email.smtp_not_configured_k8s_mode` on `.send()`. Existing throw path preserved otherwise.

**Commit:** `fix(email): tolerate missing SMTP_HOST in k8s deployment mode`

### Task A3 — Fix #7: CJS guard in `apps/worker/src/i18n/template-renderer.ts`
**Why:** Worker bundle is CJS (tsup format:["cjs"]); `import.meta.url` is undefined at runtime → TypeError before any job runs.

**Test (RED):** `apps/worker/tests/unit/i18n-resolve-locales-dir.test.ts` — new file. Two cases:
1. ESM context (`import.meta.url` defined) → resolveLocalesDir() returns path containing `i18n/locales` or falls back to `locales`.
2. CJS context (mocked `import.meta` undefined) → does NOT throw; returns sensible default path.

Test uses vi.mock or import-meta stub to simulate the CJS bundle environment.

**Bundle smoke (post-build, in CI release.yml or local Makefile target):** After `pnpm -F worker build`, run `node -e "require('./apps/worker/dist/index.cjs')"` in a subshell — process must NOT exit with `TypeError: Cannot read properties of undefined (reading 'url')`. Either it loads and stays running (good — kill after 3s) or it exits with a different error (acceptable — different code path). This proves the CJS bundle actually starts.

**Code (GREEN):** `apps/worker/src/i18n/template-renderer.ts:72` — replace bare `dirname(fileURLToPath(import.meta.url))` with the dual-mode pattern from `apps/api/scripts/check-default-secrets.ts:32-36`:
```typescript
const here =
  typeof import.meta?.url === "string"
    ? dirname(fileURLToPath(import.meta.url))
    : (typeof __dirname !== "undefined" ? __dirname : "");
```

**Commit:** `fix(worker): guard import.meta.url for CJS bundle in template-renderer`

### Task A4 — Fix #5: Refactor worker to parse `VALKEY_URL`
**Why:** D2 decision. Eliminate api/worker split. Remove peer's `extraEnv` workaround. Match BullMQ documented pattern.

**Test (RED):** `apps/worker/tests/unit/queue-connection.test.ts` — new file. Cases:
1. `buildRedisConnection({ VALKEY_URL: 'redis://:password@host:6379/0' })` → IORedis instance with parsed host/port/password.
2. `buildRedisConnection({ VALKEY_URL: 'rediss://host:6380' })` → IORedis with TLS.
3. `buildRedisConnection({})` → throws `Error: VALKEY_URL is required`.
4. **Backwards compat / migration:** if `VALKEY_HOST` is set but `VALKEY_URL` is not → throw with helpful message ("set VALKEY_URL=redis://...").

**Code (GREEN):**
- Extract new helper file `apps/worker/src/queue/connection.ts` exporting `buildRedisConnection(env: NodeJS.ProcessEnv): IORedis`.
- Refactor `apps/worker/src/index.ts:130-136` to call `buildRedisConnection(process.env)` instead of inline split-env construction.
- Update `compose/docker-compose.embedded-litellm.yml:671-673`, `docker-compose.yml:472-474`, `docker-compose.external-litellm.yml:129-131` — flip worker env from `VALKEY_HOST/PORT/PASSWORD` to `VALKEY_URL`.

**Commit:** `fix(worker): parse VALKEY_URL for BullMQ connection (api parity)`

### Task A5 — Fix #8: POST `/api/locale` route
**Why:** Frontend lang-switcher posts to `/api/locale` and gets 404; cookie + (if session) users.locale UPDATE.

**Ground-truth (verified):**
- `apps/api/src/routes/locale.ts` uses factory pattern: `buildLocaleRoutes(deps: LocaleDeps) => async (app) => { app.route({...GET...}) }`. POST goes inside same registrar.
- `LocaleDeps` is currently `Record<string, never>` — extend to `{ db: TransactionalDb<ExecutableTx> }` mirroring `CheckUserDeps` at apps/api/src/routes/check-user.ts:28-30.
- Pattern reference: apps/api/src/routes/check-user.ts:32-67 (POST + zod schema from @openwhispr/wire-schemas + withTenant + tx.execute SQL).
- Wire schemas live in `packages/wire-schemas/src/` — add `LocaleSetRequest` + `LocaleSetResponse` zod shapes.
- Drizzle handle: passed in as `deps.db`, NOT `app.db` or `app.pg` (no such decorator). Wired in apps/api/src/routes/index.ts where `localeDeps = { db }` joins the existing `checkUserDeps = { db }` registration.
- Tenant resolution: `await resolveDefaultTenantId()` from `../lib/default-tenant.js` for anonymous; for authenticated, use `withTenant(db, tenantId, async (tx) => ...)` per Phase-1 D-17.
- trustProxy is on (apps/api/src/index.ts:439) — `req.protocol` honors `x-forwarded-proto`.

**Test (RED):** `apps/api/tests/integration/locale-route.test.ts` — new integration test using the existing `PostgreSqlContainer` + buildApp() pattern from `better-auth-envelope-at-rest.test.ts`. Cases:
1. POST /api/locale `{locale:'ru'}` (anonymous) → 200, `Set-Cookie: i18next=ru; ...` header present, `body: { locale: 'ru' }`.
2. POST /api/locale `{locale:'en'}` (anonymous) → 200, `Set-Cookie: i18next=en; ...`.
3. POST /api/locale `{locale:'xx'}` (invalid) → 400 with Zod error.
4. POST /api/locale (no body) → 400.
5. **Auth path:** sign-in a user, POST /api/locale `{locale:'ru'}` → 200 + Set-Cookie + verify `SELECT locale FROM users WHERE id = $1` returns `'ru'`.
6. **Rate limit:** 11 rapid POSTs from same IP → 11th gets 429.
7. **Secure flag:** request with `x-forwarded-proto: https` (Fastify honors via trustProxy) → cookie includes `Secure`; without → no `Secure`.

**Code (GREEN):**
- `packages/wire-schemas/src/locale.ts` (new): export `LocaleSetRequest = z.object({ locale: z.enum(['en', 'ru']) }).strict()` and `LocaleSetResponse = z.object({ locale: z.enum(['en', 'ru']) })`.
- `apps/api/src/routes/locale.ts`:
  - Extend `LocaleDeps` to `{ db: TransactionalDb<ExecutableTx> }`.
  - Inside `buildLocaleRoutes` registrar (after the existing GET `app.route`), add POST `app.route`:
    ```ts
    app.route({
      method: "POST",
      url: "/api/locale",
      config: { auth: false, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: LocaleSetRequest, response: { 200: LocaleSetResponse } },
      handler: async (req, reply) => {
        const body = LocaleSetRequest.parse(req.body);
        const userId = req.session?.user?.id ?? null;  // verify session decorator name
        if (userId) {
          const tenantId = await resolveDefaultTenantId();
          await withTenant(db, tenantId, async (tx) => {
            await tx.execute(sql`UPDATE users SET locale = ${body.locale} WHERE id = ${userId}`);
          });
        }
        return reply
          .setCookie("i18next", body.locale, {
            httpOnly: true, sameSite: "lax", path: "/",
            maxAge: 60 * 60 * 24 * 365,
            secure: req.protocol === "https",
          })
          .code(200)
          .send({ locale: body.locale });
      },
    });
    ```
- `apps/api/src/routes/index.ts`: `buildLocaleRoutes()` → `buildLocaleRoutes(localeDeps)` where `localeDeps = { db }` joins existing `checkUserDeps` registration site.
- Session decorator: verify `req.session` shape against Better Auth integration in `apps/api/src/plugins/auth.ts` (or equivalent) — exact key may be `req.user` or `req.session?.user` depending on Better Auth's Fastify plugin output.

**Commit:** `feat(api): POST /api/locale endpoint for language switcher`

## Phase B — Chart fixes (chart 1.0.6 source)

### Task B1 — Fix #1: Worker probe path correction
**Why:** Current `pgrep -f 'node /app/dist/index.js'` always returns 1 → kubelet kills worker every 30s. Real path is `/app/apps/worker/dist/index.cjs`.

**Test (RED):** `charts/openwhispr-server/tests/test-worker-probes.sh` — new shell test (or add to existing `tools/test-chart-render.sh`). Renders chart, greps for `pgrep -f '/app/apps/worker/dist/index.cjs'` in worker-deployment probes — fails currently, passes after fix. **Negative assertion (anti-regression):** `! grep -q "node /app/dist/index.js" <rendered-yaml>` — fails the test if old broken pattern reintroduced via copy-paste.

**Code (GREEN):** `charts/openwhispr-server/templates/worker-deployment.yaml:92,100,108` — replace `node /app/dist/index.js` with `/app/apps/worker/dist/index.cjs` in all 3 probe exec commands.

**Commit:** `fix(server-chart): correct worker probe path to /app/apps/worker/dist/index.cjs`

### Task B2 — Fix #2: Wire `DATABASE_URL_OWNER` into worker Deployment
**Why:** worker/src/index.ts:102 loud-fails if `DATABASE_URL_OWNER` unset. Peer's `extraEnv` workaround was essential. Chart must wire natively.

**Test (RED):** Same chart-render test asserts worker Deployment env contains `DATABASE_URL_OWNER` with secretKeyRef pointing at `Values.database.ownerUrlSecretRef`.

**Code (GREEN):** `charts/openwhispr-server/templates/worker-deployment.yaml` — add `DATABASE_URL_OWNER` env block under existing `DATABASE_URL` (mirroring the migrate-job pattern).

**Commit:** `fix(server-chart): wire DATABASE_URL_OWNER into worker Deployment`

### Task B3 — Fix #3: `LITELLM_DATABASE_URL` secretRef wiring for worker
**Why:** worker litellm-pool.ts reads it for spend ingestion. Currently has no chart binding; operators must extraEnv.

**Test (RED):** Chart-render test asserts: when `Values.litellm.databaseUrlSecretRef.name` is set, worker has `LITELLM_DATABASE_URL` env from that secretRef; when unset, no env var emitted.

**Code (GREEN):**
- `charts/openwhispr-server/values.yaml` — add `litellm.databaseUrlSecretRef: { name: "", key: "url" }` with comment that it's worker-only / optional.
- `charts/openwhispr-server/templates/worker-deployment.yaml` — conditional env block: `{{- if .Values.litellm.databaseUrlSecretRef.name }}` projecting `LITELLM_DATABASE_URL`.
- Update `charts/openwhispr-server/examples/values-yambr.yaml` with the new ref (peer's setup uses this).

**Commit:** `feat(server-chart): wire LITELLM_DATABASE_URL secretRef into worker`

### Task B3b — Bake `OPENWHISPR_DEPLOYMENT_MODE=k8s` into chart-owned ConfigMap
**Why (BLOCKER from plan-checker):** Fix #6 (Task A2) short-circuits SMTP only when `isK8sDeploymentMode(env)` returns true. Currently `OPENWHISPR_DEPLOYMENT_MODE=k8s` is set ONLY by operator via `extraEnv` in their values.yaml (see charts/openwhispr-server/examples/values-yambr.yaml:80). After upgrade, peer will REMOVE that extraEnv (per acceptance criteria #2 in spawn brief) — chart MUST set it natively or fix #6 is a no-op.

**Test (RED):** Chart-render test asserts: rendered ConfigMap contains `OPENWHISPR_DEPLOYMENT_MODE: k8s`; all three Deployment envFrom pull it via configMapRef (already in template).

**Code (GREEN):** `charts/openwhispr-server/templates/configmap.yaml` (find existing) — add `OPENWHISPR_DEPLOYMENT_MODE: k8s` to the ConfigMap data block alongside `NODE_ENV` / `LOG_LEVEL`. ConfigMap is already pulled via `envFrom: configMapRef` in api/web/worker Deployments. Also: `charts/openwhispr-server/values.yaml` `env:` block — add `OPENWHISPR_DEPLOYMENT_MODE: k8s` so it appears in the rendered ConfigMap (since ConfigMap data is `.Values.env` toYaml).

Update `charts/openwhispr-server/examples/values-yambr.yaml` — REMOVE the now-redundant `OPENWHISPR_DEPLOYMENT_MODE: k8s` entry from peer's `extraEnv` (chart now provides it). Leave `SKIP_LITELLM_DB_AUTOCREATE: "1"` since that's BYOK-specific.

**Commit:** `feat(server-chart): bake OPENWHISPR_DEPLOYMENT_MODE=k8s into ConfigMap`

### Task B4 — Fix #4: openwhispr-postgres postInitApplicationSQL ALTER ROLE
**Why:** D1 decision. Better Auth's drizzleAdapter is a module singleton; needs role default GUC for the 4 identity tables.

**Test (RED):** `charts/openwhispr-postgres/tests/test-rolconfig.sh` — new test or extension. Renders chart, greps postInitApplicationSQL for `ALTER ROLE .* SET app.tenant_id =`. Plus manual kind-cluster verification gate (per D1 verification gate in CONTEXT.md).

**Code (GREEN):** `charts/openwhispr-postgres/templates/postgres-cluster.yaml:73-84` — append to `postInitApplicationSQL` list:
```yaml
- |
    ALTER ROLE {{ .Values.postgres.appRole }} SET app.tenant_id = '00000000-0000-0000-0000-000000000000';
```

**Commit:** `fix(postgres-chart): bind default app.tenant_id GUC on app role`

## Phase C — Chart version + docs

### Task C1 — Bump openwhispr-server chart to 1.0.6, appVersion to 1.0.4
**Why:** Image v1.0.4 ships code fixes (#5, #6, #7, #8); chart 1.0.6 wires all chart fixes (#1, #2, #3) and pins to v1.0.4 image tag default.

**Code:**
- `charts/openwhispr-server/Chart.yaml` — `version: 1.0.6`, `appVersion: "1.0.4"`
- `charts/openwhispr-server/values.yaml` — `image.tag: "1.0.4"`
- `.chart-versions/previous` — bump to `1.0.5` (the prior released chart)

**Commit:** `chore(server-chart): bump to 1.0.6 with image v1.0.4 default`

### Task C2 — Bump openwhispr-postgres chart minor (D4 GUC change)
**Why:** Adding postInitApplicationSQL line is a schema-affecting change → minor bump.

**Code:** `charts/openwhispr-postgres/Chart.yaml` — bump `version` by one minor.

**Commit:** **FOLDED into Task B4 commit** — one chart, one bump, one commit (per plan-checker recommendation; eliminates ambiguity).

### Task C3 — README updates
**Why:** Acceptance gate requires docs updated for: k8s deployment mode notes, rolconfig requirement, /api/locale contract, VALKEY_URL parsing, SMTP k8s-mode behavior.

**Code:** Update sections in:
- `charts/openwhispr-server/README.md` — k8s mode behavior with SMTP, VALKEY_URL requirement, /api/locale, BYOK Postgres rolconfig prerequisite.
- `charts/openwhispr-postgres/README.md` — postInitApplicationSQL ALTER ROLE explained + BYOK operator one-liner.
- `apps/api/README.md` (if exists) — /api/locale POST contract.
- `apps/worker/README.md` (if exists) — VALKEY_URL only.
- `compose/.env.slim.example` and `.env.example` — note that worker reads VALKEY_URL not split.
- Top-level `CHANGELOG.md` (if exists) — chart 1.0.6 entry with 8 fixes summary.

**Commit:** `docs: update README for chart 1.0.6 + image v1.0.4 changes`

## Phase D — Release

### Task D1 — Local verification gate (per Hard Rule #3)
Run all green BEFORE pushing tag:
1. `pnpm install` (if package.json changed)
2. `pnpm -F @openwhispr/byok-guard test` GREEN
3. `pnpm -F @openwhispr/email test` GREEN
4. `pnpm -F worker test` GREEN
5. `pnpm -F api test` GREEN (integration tests use testcontainers — local docker required)
6. `pnpm -F api build && pnpm -F worker build && pnpm -F web build` GREEN
7. `make ci` (lint + LOCKER-XX) GREEN
8. `helm lint charts/openwhispr-server` GREEN
9. `helm lint charts/openwhispr-postgres` GREEN
10. `helm template ow charts/openwhispr-server -f charts/openwhispr-server/examples/values-yambr.yaml` renders without error
11. **REQUIRED end-to-end smoke** (per plan-checker — proves goal #3 "fresh sign-up without manual ALTER ROLE"): scripted in `tools/test-chart-1-0-6-e2e.sh`:
    - `kind create cluster --name ow-1-0-6-smoke`
    - Install CNPG operator
    - `helm install pg charts/openwhispr-postgres --wait`
    - `kubectl exec pg-cluster-1 -- psql -c "SELECT unnest(rolconfig) FROM pg_roles WHERE rolname = 'openwhispr_app'" | grep "app.tenant_id=00000000"` (rolconfig set)
    - Create operator secrets (MASTER_KEK, BETTER_AUTH_SECRET, app-url, owner-url, valkey url, smtp dummy, s3 dummy)
    - `helm install ow charts/openwhispr-server --set image.tag=1.0.4 ...` (use locally-built image OR wait for GHCR publish)
    - Wait for api/web/worker pods Ready (worker probe must not flap)
    - `kubectl port-forward svc/ow-api 3000 &` then `curl POST http://localhost:3000/api/locale -d '{"locale":"ru"}'` → 200
    - `curl POST http://localhost:3000/api/auth/sign-up/email -d '{...}'` → 200 (no manual ALTER ROLE)
    - `kind delete cluster --name ow-1-0-6-smoke`
12. Compose smoke (post Task A4 VALKEY_URL refactor): `docker compose -f compose/docker-compose.embedded-litellm.yml config` syntax-valid; `docker compose up worker` logs show BullMQ connect to Valkey via URL.
13. `git status --short` clean; `git log --oneline -15` shows expected commits

### Task D2 — Push image v1.0.4 tag (BLOCKING GATE for D3)
`git tag v1.0.4 && git push origin v1.0.4`
- GHA `.github/workflows/release.yml` builds multi-arch images, pushes to ghcr.io/yambr/openwhispr-{api,web,worker}:1.0.4
- **Blocking wait loop** (orchestrator must verify per Hard Rule #3):
  ```bash
  until crane manifest ghcr.io/yambr/openwhispr-api:1.0.4 >/dev/null 2>&1; do sleep 30; done
  until crane manifest ghcr.io/yambr/openwhispr-web:1.0.4 >/dev/null 2>&1; do sleep 30; done
  until crane manifest ghcr.io/yambr/openwhispr-worker:1.0.4 >/dev/null 2>&1; do sleep 30; done
  ```
  with 30-minute timeout (GHA multi-arch builds historically 12-20min).
- D3 MUST NOT fire until all three manifests resolve.

### Task D3 — Push chart 1.0.6 tag (openwhispr-server)
**Pre-flight:** D2 image manifests confirmed present at ghcr.io/yambr (above).

`git tag chart-v1.0.6 && git push origin chart-v1.0.6`
- GHA `.github/workflows/chart-release.yml` packages + publishes
- Blocking wait: `until helm pull oci://ghcr.io/yambr/charts/openwhispr-server --version 1.0.6 --destination /tmp 2>/dev/null; do sleep 30; done` with 15-minute timeout.
- Cleanup tmp tarball.

### Task D4 — Push openwhispr-postgres chart bump tag (if separate release workflow)
Verify workflow trigger pattern; tag as needed.

### Task D5 — Draft peer confirmation message
Format to send to peer ykoolfs5:
```
✅ chart 1.0.6 + image v1.0.4 published
- chart: oci://ghcr.io/yambr/charts/openwhispr-server:1.0.6
- images: ghcr.io/yambr/openwhispr-{api,web,worker}:1.0.4
- postgres chart bump: <version>

Bump targetRevision to 1.0.6, then delete from values:
- worker.extraEnv: VALKEY_HOST/PORT/PASSWORD/DATABASE_URL_OWNER/LITELLM_DATABASE_URL
- extraEnv: SMTP_HOST

After upgrade, /api/locale 200s, sign-up works on fresh deployment without kubectl exec.

Test coverage: <summary>
README: <summary>
```

## Acceptance gates (verify EACH independently per Hard Rule #3)

- [ ] 8 commits (logical groupings ok — may merge A1+A2 / B1+B2) on main with conventional commit messages
- [ ] `pnpm test` GREEN across @openwhispr/byok-guard, @openwhispr/email, api, worker, data packages
- [ ] `pnpm -F api build && pnpm -F worker build && pnpm -F web build` GREEN
- [ ] `make ci` GREEN (zero LOCKER-XX violations)
- [ ] `helm lint charts/openwhispr-server` + `helm lint charts/openwhispr-postgres` GREEN
- [ ] `helm template ow charts/openwhispr-server -f charts/openwhispr-server/examples/values-yambr.yaml` renders + matches expected (probe path, env vars present)
- [ ] GitHub Actions release workflow publishes v1.0.4 images to GHCR (visible via `crane ls`)
- [ ] GitHub Actions chart-release publishes chart 1.0.6 to OCI registry (visible via `helm pull --version 1.0.6`)
- [ ] README updates merged in same commit chain
- [ ] Peer confirmation message drafted in SUMMARY.md
- [ ] STATE.md "Quick Tasks Completed" table updated
