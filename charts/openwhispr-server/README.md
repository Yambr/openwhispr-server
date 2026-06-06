# openwhispr-server

OpenWhispr api / web / worker control plane — Helm chart. MVP scope.

> Bring your own Postgres, Redis/Valkey, S3, SMTP, LiteLLM, OAuth/OIDC
> providers, and ingress controller. The chart wires every credential
> via externally-managed Kubernetes Secrets — it never renders Secret
> material itself in the default install path.

---

## Install

```bash
helm install ow-srv oci://ghcr.io/yambr/charts/openwhispr-server \
  --version 1.0.0 \
  -f my-values.yaml
```

See [`examples/values-yambr.yaml`](./examples/values-yambr.yaml) for a
complete reference values file.

## Prerequisites

The operator MUST provide:

1. **Postgres 17 with `pg_partman` extension** (the companion
   `openwhispr-postgres` chart, a CNPG cluster you already run, or any
   managed Postgres). A `postgres://` URL for the runtime app role AND
   another for the owner role (migrations).

   **Hard requirements** for the Postgres cluster:
   - **PG 17.** Migration 0033 uses envelope-encryption columns introduced
     in PG 17. PG 16 is NOT supported — there is no in-script PG 16
     fallback path.
   - **`pg_partman` extension installed** in the image. Stock CNPG /
     Docker Hub `postgres:17` images do NOT include pg_partman.
     Migration 0014 calls `partman.create_parent(...)` and fails with
     `schema "partman" does not exist (SQLSTATE 3F000)` if it's missing.
     Use the published `ghcr.io/yambr/openwhispr-cnpg-postgres-17-pgpartman`
     image for CNPG, or apt-install `postgresql-17-partman` into your
     own image (Debian Trixie has the native package).
   - **`shared_preload_libraries` includes `pg_partman_bgw`.** The
     background worker drives partition maintenance. For CNPG:
     ```yaml
     spec:
       postgresql:
         shared_preload_libraries: [pg_partman_bgw]
         parameters:
           pg_partman_bgw.interval: "3600"
           pg_partman_bgw.role: openwhispr_owner
           pg_partman_bgw.dbname: openwhispr
     ```
   - **Owner role has `BYPASSRLS`** (see `openwhispr-database` Secret
     section below for full reasoning).

   **Dedicated vs shared cluster:** for production, run openwhispr on
   its own CNPG Cluster, NOT shared with other apps. openwhispr's
   `shared_preload_libraries`, BYPASSRLS owner, partman maintenance
   schedule, and backup policy diverge from typical web-app clusters.
   A shared cluster forces every coexisting app to accept openwhispr's
   tuning. For stage, dedicated also gives full prod-parity smoke.
2. **Redis or Valkey** (if `redis.enabled=true`, default). A `redis://`
   URL.
3. **LiteLLM proxy** (the companion `openwhispr-litellm` chart, your
   corporate LiteLLM instance, or any compatible upstream). A base URL
   plus a master key.
4. **S3-compatible object storage** (MinIO, AWS S3, GCS via S3 gateway,
   etc.). Endpoint, bucket, access key, secret key.
5. **SMTP relay** for transactional email. Host, port, user, password,
   from address.
6. **OAuth / OIDC client credentials** (only if you turn on social
   sign-in or OIDC SSO). Provider client ID and secret.
7. **Ingress controller** — either set `ingress.controller: traefik`
   (chart renders an `IngressRoute`) or wire your own
   `Ingress`/`HTTPRoute` against the rendered api/web Services.

## Secret keys reference

The chart expects six pre-created Secrets (names are operator-chosen
and wired through values; the table below shows the
`examples/values-yambr.yaml` defaults).

### `openwhispr-server-secrets` — chart-owned

`envFrom`-mounted into api / web / worker. Required keys:

| Key                       | Used for                                          |
| ------------------------- | ------------------------------------------------- |
| `BETTER_AUTH_SECRET`      | Better Auth session-cookie signing                |
| `MASTER_KEK`              | Envelope-encryption KEK for at-rest credentials   |
| `TAVILY_API_KEY`          | Tavily web-search provider (optional)             |
| `YANDEX_SEARCH_API_KEY`   | Yandex Search provider (optional)                 |
| `YANDEX_FOLDER_ID`        | Yandex Cloud folder ID (optional)                 |

Create:

```bash
kubectl create secret generic openwhispr-server-secrets \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=MASTER_KEK="$(openssl rand -base64 32)" \
  --from-literal=TAVILY_API_KEY=...
```

### `openwhispr-database`

Holds two keys:

| Key         | Format                                                              |
| ----------- | ------------------------------------------------------------------- |
| `app-url`   | `postgres://app_user:pwd@host:5432/db` — runtime connections        |
| `owner-url` | `postgres://owner:pwd@host:5432/db` — migration Job (bypasses pool) |

```bash
kubectl create secret generic openwhispr-database \
  --from-literal=app-url="postgres://openwhispr_app:...@pg:5432/openwhispr" \
  --from-literal=owner-url="postgres://openwhispr_owner:...@pg:5432/openwhispr"
```

**Required role privileges for `owner-url`:** the role MUST have
`BYPASSRLS` — `packages/data` is hard-coded to expect a BYPASSRLS owner
for DDL + row-backfill INSERT statements (see `packages/data/src/
client.ts:10-14` and `packages/data/src/encryption/backfill.ts:21`).
Without it, the first install fails the tenant-settings backfill with
`new row violates row-level security policy for table "tenant_settings"
(SQLSTATE 42501)`. Note that `SET LOCAL row_security = off` is a
no-op for non-BYPASSRLS roles — there is no in-script workaround.

**Single-role setup** (one DB role for everything): grant BYPASSRLS to
the single role and point both `app-url` and `owner-url` at it.
```sql
ALTER ROLE openwhispr BYPASSRLS;
```
RLS still applies to runtime app traffic because `app.tenant_id` is
unset in the bare app session — BYPASSRLS only matters when the role
explicitly opens a session without setting tenant context (which the
migration Job does and runtime code does not).

**Two-role setup** (defence-in-depth, recommended for prod): create a
separate `openwhispr_owner` role with BYPASSRLS used ONLY for the
migration Job, and a non-BYPASSRLS `openwhispr_app` role for runtime
pods. The runtime role cannot bypass RLS even if a future bug forgets
to set the tenant GUC.

For CNPG operators: add the BYPASSRLS grant to your Cluster's
`bootstrap.postInitSQL` so re-installs preserve it.

### `openwhispr-redis`

| Key   | Format                            |
| ----- | --------------------------------- |
| `url` | `redis://[:password@]host:6379/0` |

```bash
kubectl create secret generic openwhispr-redis \
  --from-literal=url="redis://valkey:6379"
```

### `openwhispr-litellm`

| Key          | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| `master-key` | The LiteLLM proxy master key (`sk-…`)                                          |
| `url`        | **(chart 1.0.6+, optional, worker-only)** `LITELLM_DATABASE_URL` direct conn  |

```bash
kubectl create secret generic openwhispr-litellm \
  --from-literal=master-key="sk-..."
```

(The `LITELLM_BASE_URL` is plain `.Values.litellm.baseUrl`, not a Secret.)

**`LITELLM_DATABASE_URL` (chart 1.0.6+ / worker-only).** When the
operator runs external LiteLLM with a dedicated database, set
`litellm.databaseUrlSecretRef.name` to project a direct-to-Postgres URL
(NOT through PgBouncer per Pitfall #9) into the worker Deployment.
Consumed by the `ingest-litellm-spend` + `reconciliation-daily-check`
jobs that query the LiteLLM database for usage ledgers and spend logs.
Leave the ref empty (`name: ""`) when running embedded LiteLLM
(single shared Postgres — `openwhispr` and `litellm` databases live in
the same Cluster, worker reuses the same owner pool).

**BYOK external LiteLLM (operator opt-out):** if your `litellm.baseUrl`
points at an *existing* LiteLLM instance (not the companion
`openwhispr-litellm` chart), set `SKIP_LITELLM_DB_AUTOCREATE=1` via
`extraEnv` so the migrate Job doesn't try to `CREATE DATABASE litellm`
on first install. Without this flag the migrate Job errors with
`permission denied to create database (SQLSTATE 42501)` because the
CNPG-managed owner role does not have `CREATEDB` privilege by default.

```yaml
extraEnv:
  - name: SKIP_LITELLM_DB_AUTOCREATE
    value: "1"
```

Operators running embedded LiteLLM (single shared Postgres) leave this
unset — the migrate Job creates the `litellm` database alongside
`openwhispr` on first install. See `packages/data/src/migrate.ts:142`
for the opt-out path.

### k8s deployment mode (`OPENWHISPR_DEPLOYMENT_MODE=k8s`)

**Chart 1.0.6+ / image v1.0.4+ — baked into the chart-owned ConfigMap;
operators no longer need to set this via `extraEnv`.** Prior chart
versions (1.0.3 through 1.0.5) required operators to add the env
explicitly via `extraEnv:` block.

The api container ENTRYPOINT (`apps/api/scripts/check-default-secrets.ts`),
the boot-time `byok-guard` (`packages/byok-guard/src/index.ts`), AND the
`@openwhispr/email` factory (`packages/email/src/EmailSender.ts`) default
to the compose-era contract: they refuse to start if any of
`POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD`,
`PGBOUNCER_ADMIN_PASSWORD`, `VALKEY_PASSWORD`, `MINIO_ROOT_PASSWORD`,
`TRAEFIK_ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `BACKUP_AGE_IDENTITY`,
`S3_ENDPOINT` (+ partner keys), `OTEL_EXPORTER_OTLP_ENDPOINT`,
`INGRESS_BASE_URL`, OR `SMTP_HOST` (in production) is unset — because
the default self-host profile stands up Postgres / Valkey / MinIO /
Traefik / Grafana / age-backup / Tempo / Loki / SMTP itself via docker
compose overlays.

In a k8s deployment **none of that applies**. Postgres comes from CNPG,
Valkey/Redis from your cluster operator, S3 from MinIO-as-a-service or
AWS S3, observability from your platform's `ServiceMonitor` →
Prometheus/Mimir stack, ingress from the operator-chosen Gateway/Ingress
controller, SMTP from an operator-rotated Kubernetes Secret bound at
chart deploy time (or absent — see below). The compose-era env contract
is not just irrelevant — it actively prevents the pod from starting.

`OPENWHISPR_DEPLOYMENT_MODE=k8s` (chart 1.0.6+ now bakes this into the
shared ConfigMap; api/web/worker pull it via `envFrom`) opts out of the
compose-era guards. The k8s gate:

- shrinks the entrypoint REQUIRED_KEYS list to just `MASTER_KEK` +
  `BETTER_AUTH_SECRET` (in-app crypto roots — deny-list enforcement
  preserved);
- bypasses the boot-time `byok-guard` matrix for
  storage/observability/ingress/pgbouncer/dev-tools rows;
- **(NEW chart 1.0.6 / image v1.0.4)** downgrades the email factory's
  production SMTP_HOST loud-fail to a warn-only no-op sender — sign-up
  + every non-email flow boots before the operator has rotated in the
  SMTP Secret. Once `auth.envFromSecret` projects `SMTP_HOST` and pods
  restart, email delivery resumes. Compose-mode keeps the throw.

The kill-switch is case-insensitive (`k8s`, `K8S`, `K8s`) and
whitespace-tolerant (` k8s `, `k8s\n`). Default (unset, `=compose`, or
any other value): compose-era behavior preserved — fully backward
compatible.

All three guards emit a one-line operator-visibility log on activation:

```
check-default-secrets: deployment mode = k8s
{"level":30,"event":"byok.bypassed","mode":"k8s","msg":"byok-guard bypassed: OPENWHISPR_DEPLOYMENT_MODE=k8s"}
{"level":40,"event":"email.smtp_not_configured_k8s_mode","msg":"SMTP not configured in k8s deployment mode; emails skipped until operator provisions SMTP Secret"}
```

See `apps/api/scripts/check-default-secrets.ts`,
`packages/byok-guard/src/index.ts`, and `packages/email/src/EmailSender.ts`
for the implementations; tests cover case-insensitive trim, the deny-list-
still-enforced contract, and the compose-mode regression guard (k8s bypass
NEVER applies when `OPENWHISPR_DEPLOYMENT_MODE` is unset or `=compose`).

### `openwhispr-s3`

`envFrom`-mounted. Keys: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY` (and any other `S3_*` keys you set).

```bash
kubectl create secret generic openwhispr-s3 \
  --from-literal=S3_ENDPOINT="https://s3.example.com" \
  --from-literal=S3_BUCKET="openwhispr" \
  --from-literal=S3_ACCESS_KEY="..." \
  --from-literal=S3_SECRET_KEY="..."
```

### `openwhispr-smtp`

`envFrom`-mounted. Keys: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM`.

```bash
kubectl create secret generic openwhispr-smtp \
  --from-literal=SMTP_HOST="smtp.example.com" \
  --from-literal=SMTP_PORT="587" \
  --from-literal=SMTP_USER="..." \
  --from-literal=SMTP_PASSWORD="..." \
  --from-literal=SMTP_FROM="noreply@example.com"
```

### `openwhispr-auth`

`envFrom`-mounted. Holds any `OAUTH_*` and `OIDC_*` keys for the
social-sign-in or OIDC SSO providers you've enabled.

```bash
kubectl create secret generic openwhispr-auth \
  --from-literal=OAUTH_GITHUB_CLIENT_ID="..." \
  --from-literal=OAUTH_GITHUB_CLIENT_SECRET="..." \
  --from-literal=OIDC_ISSUER_URL="https://idp.example.com" \
  --from-literal=OIDC_CLIENT_ID="..." \
  --from-literal=OIDC_CLIENT_SECRET="..." \
  --from-literal=OIDC_PROVIDER_NAME="Acme SSO"   # optional — sign-in button label; defaults to "OIDC"
```

`OIDC_PROVIDER_NAME` is optional: it sets the human-facing label on the
generic SSO button ("Continue with Acme SSO") rendered by the wizard, auth
screens, and desktop client. The provider id stays the frozen `oidc`; only
the display name changes. Unset → defaults to `"OIDC"`.

## Toggles

The chart has exactly two toggles.

### `secrets.mode`

- `external-managed` (default) — chart renders no Secret. Pre-create
  `openwhispr-server-secrets` (or whatever you set in
  `secrets.secretName`) yourself.
- `helm-values` — chart renders a Secret of the same name from
  `secrets.values`. Undocumented; use only for OSS quickstart. **Will**
  leak credentials into your release manifest and `helm get values`
  output.

### `ingress.controller`

- `none` (default) — chart renders no ingress resources. Wire your own
  `Ingress` / `HTTPRoute` / `IngressRoute` against the rendered
  `<release>-api` (port 3000) and `<release>-web` (port 3001) Services.
- `traefik` — chart renders a single Traefik `IngressRoute` splitting
  `Host(.Values.ingress.host)`:
  - `PathPrefix(/api)` → api Service
  - `PathPrefix(/v1/audio)` → api Service
  - catch-all → web Service

There is **no Gateway API mode** in this MVP.

## Chart 1.0.6 + image v1.0.4 — eight-fix atomic release

Chart 1.0.6 + image v1.0.4 bundle eight peer-reported fixes (see
`.planning/quick/20260524-chart-1-0-6-image-v1-0-4-eight-fixes`):

| # | Layer     | Fix                                                                                                  |
| - | --------- | ---------------------------------------------------------------------------------------------------- |
| 1 | chart     | Worker probe path corrected: `/app/apps/worker/dist/index.cjs` (was `/app/dist/index.js` → kubelet killed pods every 30s) |
| 2 | chart     | `DATABASE_URL_OWNER` wired into worker Deployment natively (worker loud-fails without it; was operator extraEnv workaround) |
| 3 | chart     | `LITELLM_DATABASE_URL` wired into worker conditionally (`litellm.databaseUrlSecretRef`)              |
| 3b| chart     | `OPENWHISPR_DEPLOYMENT_MODE=k8s` baked into ConfigMap (was operator extraEnv workaround)             |
| 4 | postgres  | `ALTER ROLE app SET app.tenant_id = '00…0'` in CNPG `postInitApplicationSQL` (Better Auth singleton fix; postgres-chart 1.1.0) |
| 5 | image     | Worker BullMQ connection: refactored from split `VALKEY_HOST/PORT/PASSWORD` to single `VALKEY_URL` (api parity) |
| 6 | image     | `createEmailSender` k8s-mode SMTP bypass — sign-up boots before operator provisions SMTP Secret      |
| 7 | image     | Worker `template-renderer.ts` CJS `import.meta.url` guard (bundle previously crashed on module init) |
| 8 | image     | New POST `/api/locale` endpoint (frontend lang-switcher was 404'ing on chart 1.0.5)                  |

**Upgrade flow for operators on chart 1.0.5 / image v1.0.3:**

1. Bump `targetRevision: 1.0.6` (Argo CD) or `helm upgrade --version 1.0.6`.
2. Delete the now-redundant `extraEnv` entries from your `values.yaml`:
   - `OPENWHISPR_DEPLOYMENT_MODE: k8s` (chart bakes via ConfigMap)
   - `DATABASE_URL_OWNER` (chart wires via `database.ownerUrlSecretRef`)
   - `VALKEY_HOST` / `VALKEY_PORT` / `VALKEY_PASSWORD` (worker reads
     `VALKEY_URL` now; chart already projects from `redis.urlSecretRef`)
3. If you have a separate LiteLLM database, set
   `litellm.databaseUrlSecretRef.name: openwhispr-litellm` +
   `litellm.databaseUrlSecretRef.key: url` and add `url` to the
   `openwhispr-litellm` Secret.
4. Apply. Worker probes will now succeed; sign-up works without manual
   `kubectl exec ALTER ROLE`; POST /api/locale returns 200.

**BYOK Postgres operators (NOT using openwhispr-postgres chart):** the
B4 `ALTER ROLE app SET app.tenant_id = '00…0'` rolconfig fix only fires
inside the openwhispr-postgres chart's CNPG bootstrap. Operators
running managed Postgres (RDS, Aurora, Cloud SQL, on-prem) must run
this one-liner themselves before first install — otherwise sign-up
fails with `users.tenant_id NULL constraint violation`:

```sql
ALTER ROLE openwhispr SET app.tenant_id = '00000000-0000-0000-0000-000000000000';
```

Substitute `openwhispr` with your application role name (whatever you
configured for `DATABASE_URL` in `openwhispr-database` Secret). See
CLAUDE.md Constraint 16 (RLS posture ledger) for the v1 single-tenant
debt rationale; v2 (request-scoped Better Auth adapter) removes this
requirement entirely.

## Rendered kinds

With `ingress.controller=none` (default):

| Kind             | Count | Notes                                  |
| ---------------- | ----- | -------------------------------------- |
| Deployment       | 3     | api, web, worker                       |
| Service          | 2     | api, web                               |
| Job              | 1     | migrate (pre-install/pre-upgrade hook) |
| ConfigMap        | 1     | non-secret env (NODE_ENV, LOG_LEVEL)   |
| ServiceAccount   | 1     | gated on `serviceAccount.create`       |
| Secret           | 0     | external-managed                       |
| IngressRoute     | 0     | controller=none                        |
| ServiceMonitor   | 0     | gated on `observability.serviceMonitor.enabled` |
| HPA / PDB        | 0     | not in MVP (replicas pinned to 1)      |

## License

FSL-1.1-ALv2 (Functional Source License — Apache 2.0 future grant).
See repository root for the full text.
