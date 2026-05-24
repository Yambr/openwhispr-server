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
| `PYANNOTE_API_KEY`        | pyannote diarization (optional; soft-degrades)    |
| `TAVILY_API_KEY`          | Tavily web-search provider (optional)             |
| `YANDEX_SEARCH_API_KEY`   | Yandex Search provider (optional)                 |
| `YANDEX_FOLDER_ID`        | Yandex Cloud folder ID (optional)                 |

Create:

```bash
kubectl create secret generic openwhispr-server-secrets \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=MASTER_KEK="$(openssl rand -base64 32)" \
  --from-literal=PYANNOTE_API_KEY=... \
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

| Key          | Value                                  |
| ------------ | -------------------------------------- |
| `master-key` | The LiteLLM proxy master key (`sk-…`)  |

```bash
kubectl create secret generic openwhispr-litellm \
  --from-literal=master-key="sk-..."
```

(The `LITELLM_BASE_URL` is plain `.Values.litellm.baseUrl`, not a Secret.)

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
  --from-literal=OIDC_CLIENT_SECRET="..."
```

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
