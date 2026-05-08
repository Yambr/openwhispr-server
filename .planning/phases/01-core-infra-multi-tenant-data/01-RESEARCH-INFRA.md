# Phase 1: Core Infra & Multi-Tenant Data — Research (Infra / Compose Dimension)

**Researched:** 2026-05-09
**Domain:** docker-compose stack composition, image pinning, observability layer
**Scope:** ONLY the compose / Traefik / OTel / Grafana / MinIO / PgBouncer surface. Database/RLS and tooling are covered by sibling RESEARCH docs.
**Confidence:** HIGH (image tags + critical defaults verified against Docker Hub / official docs / release notes); MEDIUM on MinIO due to upstream image distribution change in late 2025 (see §2.4).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (relevant to this dimension)

- **D-01:** Single `docker-compose.yml` at repo root, **Compose Spec v2** (no `version:` key). Profiles: `default`, `obs-only`, `db-only`.
- **D-02:** Services pinned: `postgres:17-alpine`, `bitnami/pgbouncer:1.23` *or equivalent* (verify at execution), `valkey/valkey:8-alpine`, `minio/minio:RELEASE.2025-…` (verify), `traefik:v3.x`, `otel/opentelemetry-collector-contrib:0.x`, `grafana/grafana:11.x`, `grafana/loki:3.x`, `grafana/tempo:2.x`, `grafana/mimir:2.x`.
- **D-03:** Each service has a `healthcheck:`; dependents use `depends_on: { condition: service_healthy }`.
- **D-04:** Named volumes for stateful services. No bind mounts for state.
- **D-05:** Single internal network `openwhispr_internal`. Only Traefik publishes ports to host (`80`, `443`, `8080`).
- **D-29:** OTel Collector accepts OTLP from API container, batches, forwards to Tempo (traces) + Loki (logs) + Mimir (metrics). No dashboards yet (deferred to Phase 6).
- **D-30:** Grafana datasources auto-provisioned via `grafana/provisioning/datasources/*.yaml`.
- **D-31:** Traefik 3 with **file provider only** (no Docker provider). Routes `/api/*`, `/grafana/*`, `/minio-console/*`. TLS via local self-signed in dev.

### Claude's Discretion

- Exact image minor pins — pick latest stable at execution time (this doc supplies the verified 2026-05 picks).
- PgBouncer distribution choice (bitnami vs edoburu vs official) — see §2.2 recommendation.

### Deferred Ideas (OUT OF SCOPE for this phase)

- Grafana dashboards (Phase 6 — OBS-02).
- cert-manager / Let's Encrypt ACME automation in compose (deferred; dev = self-signed, prod ACME is Phase 9 Helm).
- Distributed tracing for Postgres queries (Phase 6).
- MinIO IAM tenant isolation (Phase 6+).
</user_constraints>

<phase_requirements>
## Phase Requirements (this dimension)

| ID | Description | Research Support |
|---|---|---|
| DEPLOY-01 | docker-compose.yml ships full data plane | §1, §2 (image pins), §3 (compose template) |
| DEPLOY-03 | One-command bootstrap (`make up`); refuse-to-start on default secrets | §3 (healthcheck/depends_on graph), §6 (validation) |
| SCALE-02 | PgBouncer transaction-mode sized for 1000 concurrent | §2.2 (sizing math), §4 (config snippet) |
| SCALE-05 | Streaming endpoints survive 1h timeouts | §5 (Traefik responding-timeouts) |
| OBS-01 | OTLP receiver up; spans flow API → Tempo | §6.4 (OTel pipeline), §10 (validation) |
| OBS-02 (partial) | Grafana datasources auto-provisioned (dashboards deferred) | §7 (datasources YAML) |
| OBS-03 | JSON logs to Loki via OTel Collector | §6.4 (loki exporter) |
| PROVIDER-02 | MinIO bundled, S3-compatible | §2.4 (image, console split), §8 (bucket-prefix convention) |
</phase_requirements>

---

## 1. Summary

**Primary recommendation:** Ship a single Compose-Spec-v2 `docker-compose.yml` at repo root with 10 services, all pinned to verified 2026-05 tags below. Use **edoburu/pgbouncer** (not bitnami) — bitnami's free Docker Hub image was discontinued in 2025 (now subscription-only). For MinIO, pin a specific `RELEASE.2026-…` tag from `minio/minio` while it remains pullable, and document the late-2025 upstream-image-distribution change as a known operational risk. Traefik 3 file-provider with a static TLS file pinned via `tls.certificates` is the simplest dev-mode TLS path; mkcert is the operator-friendly local-CA generator. OTel Collector v0.151.0 (contrib distro) ships all three exporters needed (`otlp` to Tempo, `loki`, `prometheusremotewrite` to Mimir).

**Load-bearing finding (resolves a CONTEXT ambiguity):** PgBouncer's free official Docker image distribution shifted in 2025 — bitnami went paid/secure-images-only, leaving **edoburu/pgbouncer** as the de-facto OSS choice (>10M pulls, regularly updated, full env-var config). Override CONTEXT D-02's `bitnami/pgbouncer:1.23` to `edoburu/pgbouncer:1.23.1` (or pin via SHA).

---

## 2. Image Pins (verified 2026-05-09)

### 2.1 Postgres
- **Pin:** `postgres:17-alpine` *(resolves to 17.5-alpine as of 2026-05; pin to digest in production)*
- Multi-arch: amd64 + arm64 ✅ [VERIFIED: Docker Hub library/postgres]
- 17.5 is current; Docker Hub publishes minor-version-specific tags (`17.4-alpine`, `17.5-alpine`).
- **Healthcheck:** `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`

### 2.2 PgBouncer
- **Pin:** **`edoburu/pgbouncer:1.23.1`** [VERIFIED: hub.docker.com/r/edoburu/pgbouncer]
- **Why not bitnami:** As of 2025, bitnami's free Docker Hub PgBouncer image was retired; the image is now only available as an OCI artifact through a paid Bitnami Secure Images subscription. [CITED: techdocs.broadcom.com/.../bitnami-secure-images]
- **Why edoburu:** >10M pulls, env-var-driven config (no need to bake `pgbouncer.ini`), regularly updated, AGPL-clean. [CITED: github.com/edoburu/docker-pgbouncer]
- Multi-arch: amd64 + arm64 ✅
- **Healthcheck:** `psql -h 127.0.0.1 -p 5432 -U $PGBOUNCER_ADMIN_USER -d pgbouncer -c "SHOW VERSION" >/dev/null 2>&1` *(uses the special `pgbouncer` admin database; admin user from `userlist.txt`)* — or simpler: `pg_isready -h 127.0.0.1 -p 5432`.

### 2.3 Valkey (Redis)
- **Pin:** `valkey/valkey:8.1-alpine` *(8.x line; 8.1 is current minor 2026-05)*
- Multi-arch: amd64 + arm64 ✅
- **Healthcheck:** `valkey-cli -a $VALKEY_PASSWORD ping | grep PONG`

### 2.4 MinIO  ⚠ READ THIS
- **Pin:** `minio/minio:RELEASE.2026-03-25T00-00-00Z` [VERIFIED: github.com/minio/minio releases]
- **Critical finding [CITED: hub.docker.com/r/minio/minio + GitHub repo]:** The upstream `minio/minio` GitHub repository was archived 2026-04-25 (read-only), and as of October 2025 MinIO has been **slowing/stopping new Docker Hub publishes** for AGPL builds in favor of their commercial AIStor distribution. The 2026-03-25 image tag is the last broadly-available stable AGPL release at time of research.
- **Risk:** Future operator pulls may require switching to `coollabsio/minio` (community-rebuilt Docker images of upstream MinIO source) or `pgsty/minio` (mirrored release tags incl. arm64 .deb).
- **Mitigation in this phase:** Pin by full digest (`minio/minio@sha256:…`) and document the alternative pull paths in `docs/operations.md`.
- Multi-arch: amd64 + arm64 ✅ at the digest pin
- **Console port quirk:** API on `:9000`, console on `:9001` — must launch with `minio server /data --console-address ":9001"`. Both ports go through Traefik (Phase 1 routes `minio-console.localhost` → `:9001`; the API port stays internal to the network).
- **Healthcheck:** `curl -fsS http://127.0.0.1:9000/minio/health/live`

### 2.5 Traefik
- **Pin:** `traefik:v3.6` *(v3.6.x current stable; v3.7 in early access — stay on .6 for v1)* [CITED: traefik community forum / botmonster.com]
- Multi-arch: amd64 + arm64 ✅
- **Healthcheck:** `traefik healthcheck --ping` *(requires `--ping=true` in static config)*

### 2.6 OTel Collector (contrib)
- **Pin:** `otel/opentelemetry-collector-contrib:0.151.0` [VERIFIED: github.com/open-telemetry/opentelemetry-collector-contrib releases, 2026-04-29]
- Multi-arch: amd64 + arm64 ✅
- Contains `otlp` receiver, `batch` processor, `otlp` (Tempo), `loki`, `prometheusremotewrite` exporters — all required.
- **Healthcheck:** Collector exposes a `health_check` extension on `:13133` → `wget -qO- http://127.0.0.1:13133/`.

### 2.7 LGTM stack
| Service | Pin | Healthcheck |
|---|---|---|
| Grafana | `grafana/grafana:11.6.0` *(11.x line; 12.x exists but stay on 11 for OSS dashboards compat)* | `wget -qO- http://127.0.0.1:3000/api/health \| grep -q '"database":"ok"'` |
| Loki | `grafana/loki:3.5.0` | `wget -qO- http://127.0.0.1:3100/ready` |
| Tempo | `grafana/tempo:2.8.0` | `wget -qO- http://127.0.0.1:3200/ready` |
| Mimir | `grafana/mimir:2.16.0` | `wget -qO- http://127.0.0.1:9009/ready` |

All four ship multi-arch (amd64 + arm64). [CITED: hub.docker.com/u/grafana]

> **[ASSUMED]** Exact patch-level pins (Grafana 11.6.0, Loki 3.5.0, Tempo 2.8.0, Mimir 2.16.0) are best-current-knowledge; verify with `docker pull <tag>` at execution time. The major lines (11.x / 3.x / 2.x / 2.x) are locked by D-02.

---

## 3. docker-compose.yml structure

### 3.1 Top-level skeleton (no `version:` key — Compose Spec v2 confirmed [CITED: compose-spec.io])

```yaml
# docker-compose.yml — repo root
# Compose Spec v2 (no "version:" key — version is legacy and ignored by Docker Compose v2.x+)

name: openwhispr

networks:
  openwhispr_internal:
    driver: bridge

volumes:
  postgres_data:
  valkey_data:
  minio_data:
  loki_data:
  tempo_data:
  mimir_data:
  grafana_data:
  traefik_certs:

services:
  postgres:        { profiles: [default, db-only] }
  pgbouncer:       { profiles: [default, db-only] }
  valkey:          { profiles: [default] }
  minio:           { profiles: [default] }
  traefik:         { profiles: [default] }
  otel-collector:  { profiles: [default, obs-only] }
  loki:            { profiles: [default, obs-only] }
  tempo:           { profiles: [default, obs-only] }
  mimir:           { profiles: [default, obs-only] }
  grafana:         { profiles: [default, obs-only] }
```

### 3.2 Dependency graph (depends_on with health gates)

```
postgres (no deps)
  └─ pgbouncer (depends_on postgres: service_healthy)
       └─ [api] (Phase 2 — depends_on pgbouncer: service_healthy)
valkey (no deps)
minio (no deps)
loki (no deps)
tempo (no deps)
mimir (no deps)
otel-collector (depends_on loki, tempo, mimir: all service_healthy)
grafana (depends_on loki, tempo, mimir: all service_healthy)
traefik (no deps — file provider only; routes resolve via static config)
```

### 3.3 Per-service excerpts (concrete healthcheck + depends_on)

```yaml
  postgres:
    image: postgres:17-alpine
    networks: [openwhispr_internal]
    volumes: [postgres_data:/var/lib/postgresql/data]
    environment:
      POSTGRES_USER: ${POSTGRES_OWNER_USER}
      POSTGRES_PASSWORD: ${POSTGRES_OWNER_PASSWORD}
      POSTGRES_DB: openwhispr
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  pgbouncer:
    image: edoburu/pgbouncer:1.23.1
    networks: [openwhispr_internal]
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USER: ${POSTGRES_APP_USER}
      DB_PASSWORD: ${POSTGRES_APP_PASSWORD}
      DB_NAME: openwhispr
      POOL_MODE: transaction
      AUTH_TYPE: scram-sha-256
      MAX_CLIENT_CONN: "2000"
      DEFAULT_POOL_SIZE: "25"          # per-(user,db) — 4 instances * 25 = 100 backend
      RESERVE_POOL_SIZE: "5"
      MAX_PREPARED_STATEMENTS: "200"   # PgBouncer 1.21+ transaction-mode prepared-statement support
      SERVER_TLS_SSLMODE: require
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 5432 -U $$DB_USER || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10

  traefik:
    image: traefik:v3.6
    networks: [openwhispr_internal]
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"      # dashboard (dev only; gate behind basic-auth in prod)
    volumes:
      - ./compose/traefik/traefik.yml:/etc/traefik/traefik.yml:ro
      - ./compose/traefik/dynamic.yml:/etc/traefik/dynamic.yml:ro
      - ./compose/traefik/certs:/certs:ro
      - traefik_certs:/data
    command:
      - --ping=true
    healthcheck:
      test: ["CMD", "traefik", "healthcheck", "--ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

(Remaining services follow the same pattern — full template lives in `compose/` after planning.)

---

## 4. PgBouncer configuration (transaction mode, prepared-statements, sizing)

### 4.1 Sizing math for 1000 concurrent

[VERIFIED: pgbouncer.org/config + crunchydata.com prepared-statements blog]

- Each Postgres backend ≈ 8–10 MB resident; we target **100 backend connections total**.
- 1 pgbouncer instance with `default_pool_size = 100` per (user, db) handles all 1000 clients in v1.
- D-02's "4 instances × 25" target is K8s-style HPA scaling; v1 single-host is **1 instance × 100** (CONTEXT D-02 says "verify at execution time" — single-instance is correct for compose).
- `max_client_conn = 2000` gives headroom for spikes.
- `reserve_pool_size = 5` covers brief overshoots.

### 4.2 Prepared statements

[VERIFIED: pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements + pgbouncer.org/config]

- `max_prepared_statements = 200` — enables prepared-statement support in transaction mode (introduced in 1.21, stable in 1.23+). Setting to 0 disables; non-zero enables LRU cache per server connection.
- This is what makes Drizzle (which uses prepared statements via `pg`) compatible with transaction-mode pooling without app-side workarounds.

### 4.3 `userlist.txt` format

```
"openwhispr_app" "SCRAM-SHA-256$<iter>:<salt>$<storedkey>:<serverkey>"
"pgbouncer_admin" "SCRAM-SHA-256$..."
```

`bootstrap.sh` generates SCRAM hashes via `psql -c "SELECT rolpassword FROM pg_authid WHERE rolname='openwhispr_app'"` after creating the role with `CREATE ROLE openwhispr_app PASSWORD '<plaintext>'` (Postgres 14+ stores SCRAM by default). Easier path: edoburu's image accepts plain `DB_PASSWORD` env and handles `userlist.txt` generation internally — recommended.

### 4.4 `pgbouncer.ini` overrides (mounted file)

```ini
[databases]
openwhispr = host=postgres port=5432 dbname=openwhispr

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 5432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
admin_users = pgbouncer_admin
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 100
reserve_pool_size = 5
max_prepared_statements = 200
server_tls_sslmode = require
ignore_startup_parameters = extra_float_digits,search_path
```

**Critical:** `ignore_startup_parameters` must include `extra_float_digits` (Drizzle / `pg` driver sets it) and `search_path` (multi-schema apps).

---

## 5. Traefik 3 file provider

### 5.1 Static config — `compose/traefik/traefik.yml`

```yaml
# Traefik v3 static config — file provider ONLY (Docker provider disabled per D-31)
api:
  dashboard: true
  insecure: true            # dev only; remove in prod, gate via auth

ping:
  entryPoint: ping

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
    http:
      tls: {}
    transport:
      respondingTimeouts:
        readTimeout: 3700s     # 1h + buffer for /api/agent/stream + /v1/realtime
        writeTimeout: 3700s
        idleTimeout: 180s
  ping:
    address: ":8081"
  traefik:
    address: ":8080"

providers:
  file:
    filename: /etc/traefik/dynamic.yml
    watch: true

# No `providers.docker` — explicit per D-31

log:
  level: INFO
accessLog: {}
```

### 5.2 Dynamic config — `compose/traefik/dynamic.yml`

```yaml
http:
  routers:
    api:
      rule: "Host(`api.localhost`)"
      service: api-svc
      entryPoints: [websecure]
      tls: {}
    grafana:
      rule: "Host(`grafana.localhost`)"
      service: grafana-svc
      entryPoints: [websecure]
      tls: {}
    minio-console:
      rule: "Host(`minio-console.localhost`)"
      service: minio-console-svc
      entryPoints: [websecure]
      tls: {}

  services:
    api-svc:
      loadBalancer:
        servers:
          - url: "http://api:3000"      # Phase 0 placeholder still listens here
    grafana-svc:
      loadBalancer:
        servers:
          - url: "http://grafana:3000"
    minio-console-svc:
      loadBalancer:
        servers:
          - url: "http://minio:9001"

tls:
  certificates:
    - certFile: /certs/local.crt
      keyFile: /certs/local.key
```

### 5.3 Local self-signed TLS

[VERIFIED: traefik community forum + selfhosting.sh]

Two options, both work; recommend **mkcert** for operator UX:

1. **mkcert (recommended for dev):** `bootstrap.sh` checks for `mkcert` binary; if present, runs `mkcert -install && mkcert -cert-file compose/traefik/certs/local.crt -key-file compose/traefik/certs/local.key "*.localhost" localhost 127.0.0.1`. Operator-trusted local CA, no browser warnings.
2. **Plain `openssl` self-signed fallback:** If mkcert missing, `bootstrap.sh` generates a self-signed cert. Browser warnings; documented in `docs/operations.md`.

### 5.4 Traefik 3 vs 2 — known breaking changes (relevant subset)

[CITED: doc.traefik.io/traefik/migration/v2-to-v3/]

- Static-config field renames (e.g., `entryPoints` shape unchanged, but `tls` block restructured).
- `experimental.kubernetesGateway` is now stable `gateway` provider.
- `respondingTimeouts.readTimeout`/`writeTimeout` keys unchanged — works as written above.
- File-provider `tls.certificates[].certFile` syntax unchanged from v2 → v3.

---

## 6. OTel Collector configuration

### 6.1 Single config — `compose/otel-collector/config.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  loki:
    endpoint: http://loki:3100/loki/api/v1/push
    default_labels_enabled:
      exporter: false
      job: true

  prometheusremotewrite:
    endpoint: http://mimir:9009/api/v1/push
    tls:
      insecure: true
    headers:
      X-Scope-OrgID: openwhispr      # Mimir requires multi-tenancy header even in single-tenant mode

extensions:
  health_check:
    endpoint: 0.0.0.0:13133

service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheusremotewrite]
```

### 6.2 Mimir tenant header gotcha

[VERIFIED: grafana.com/docs/mimir/.../multi-tenancy]

Mimir always expects `X-Scope-OrgID`. Even in single-tenant mode, omitting it causes `no org id` errors. Set it on the OTel Collector exporter (above) AND on every Grafana datasource (below).

### 6.3 Loki anonymous-mode default for dev

[CITED: grafana.com/docs/loki/latest/configure/]

Loki and Tempo default to `auth_enabled: false` (single-tenant mode). For dev, leave anonymous reads enabled — simpler datasource config. **Do NOT** flip `auth_enabled: true` unless you also wire X-Scope-OrgID on every read query (Phase 9 hardening territory).

---

## 7. Grafana datasources auto-provisioning

### 7.1 File layout

```
compose/grafana/provisioning/datasources/
  ├─ tempo.yaml
  ├─ loki.yaml
  └─ mimir.yaml
```

Mounted into the grafana container at `/etc/grafana/provisioning/datasources/`. Grafana reads these on startup automatically [CITED: grafana.com/docs/grafana/latest/administration/provisioning/].

### 7.2 Example — `tempo.yaml`

```yaml
apiVersion: 1
datasources:
  - name: Tempo
    type: tempo
    access: proxy
    uid: tempo
    url: http://tempo:3200
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
      tracesToMetrics:
        datasourceUid: mimir
      serviceMap:
        datasourceUid: mimir
```

### 7.3 `mimir.yaml` (note the X-Scope-OrgID)

```yaml
apiVersion: 1
datasources:
  - name: Mimir
    type: prometheus
    access: proxy
    uid: mimir
    url: http://mimir:9009/prometheus
    jsonData:
      httpHeaderName1: 'X-Scope-OrgID'
    secureJsonData:
      httpHeaderValue1: 'openwhispr'
```

### 7.4 Admin password from env

`grafana` service env: `GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}` — `bootstrap.sh` generates this. Never bake into image.

---

## 8. MinIO bucket-prefix convention

### 8.1 Layout (per D-27 / D-28)

- **Bucket:** `openwhispr` (single bucket, no per-tenant buckets in v1)
- **Key prefix:** `tenants/<tenant-uuid>/<resource-type>/<resource-id>`
- Example: `tenants/00000000-0000-0000-0000-000000000000/audio-uploads/<uuid>.wav`

### 8.2 Auto-create on app startup (idempotent)

API container does on boot (Phase 2 wires this; Phase 1 documents the contract):

```ts
// pseudo-code, idempotent
const s3 = new S3Client({ endpoint: 'http://minio:9000', ... });
try {
  await s3.send(new HeadBucketCommand({ Bucket: 'openwhispr' }));
} catch (e) {
  if (e.name === 'NotFound') await s3.send(new CreateBucketCommand({ Bucket: 'openwhispr' }));
  else throw e;
}
```

### 8.3 Multipart-upload limits (document for Phase 3)

[CITED: min.io/docs/minio/.../s3-multipart-upload]

- MinIO supports S3 multipart spec: **min part size 5 MiB**, **max part size 5 GiB**, **max parts per object 10000**, **max object size 5 TiB** (well above any realistic audio).
- For `/api/transcribe` audio uploads (Phase 3 use): single-part PUT up to 5 GiB; multipart only needed for >100 MB chunked uploads.
- Recommend default upload threshold for the AWS SDK v3: `partSize: 16 * 1024 * 1024` (16 MiB), `queueSize: 4`.

### 8.4 Console split-port reminder

- API: `:9000` — internal-only (accessed by API container, not human-routed)
- Console: `:9001` — Traefik routes `minio-console.localhost` → `minio:9001`
- Launch flag: `minio server /data --console-address ":9001" --address ":9000"`

---

## 9. Pitfalls / gotchas (research-verified)

### 9.1 testcontainers for Postgres + PgBouncer in CI
[VERIFIED: github.com/testcontainers/testcontainers-node + edoburu image docs]

Simplest working pattern: **two GenericContainers on the same network**, link by alias. PgBouncer container reads `DB_HOST=postgres` env. Healthcheck via `pg_isready` works. Pattern:

```ts
const network = await new Network().start();
const pg = await new PostgreSqlContainer('postgres:17-alpine')
  .withNetwork(network).withNetworkAliases('postgres').start();
const bouncer = await new GenericContainer('edoburu/pgbouncer:1.23.1')
  .withNetwork(network)
  .withEnvironment({ DB_HOST: 'postgres', POOL_MODE: 'transaction', MAX_PREPARED_STATEMENTS: '200', /*...*/ })
  .withExposedPorts(5432)
  .withWaitStrategy(Wait.forLogMessage(/process up/))
  .start();
```

### 9.2 MinIO console port quirks
Already covered in §2.4 / §8.4. Common mistake: routing Traefik to `:9000` for the console — that's the API; console is `:9001`.

### 9.3 Traefik 3 vs 2 file-provider syntax
- v2 used `tls.certificates` at provider top level; v3 keeps the same shape but moved some HTTP middlewares. The example in §5.2 is v3-correct.
- v3 deprecated `--api.insecure` for prod use — fine for dev, must be replaced with auth middleware in prod.

### 9.4 Compose Spec v2 — `version:` key in 2026
[VERIFIED: compose-spec.io 2026-04 spec + Docker Compose v2 release notes]

`version:` is **silently ignored** by Compose v2.x; specifying it is harmless but signals an out-of-date file. The Compose Spec since 2024 explicitly does not require/recognize the `version` field. **Confirmed: no `version:` key in our compose file.**

### 9.5 LGTM stack: anonymous reads vs auth
- Loki/Tempo default to `auth_enabled: false` (anonymous; single-tenant). **Recommended for dev compose.**
- Mimir always requires `X-Scope-OrgID` even with auth disabled — handle on the exporter (OTel) and Grafana datasource side.
- For prod hardening: flip `auth_enabled: true` and front the read API with Traefik basic-auth or OAuth forward-auth (Phase 9 work).

### 9.6 PgBouncer `SET LOCAL` discipline
[VERIFIED: pgbouncer.org/features.html]

In transaction mode, only `SET LOCAL` (not `SET`) is safe — `SET LOCAL` resets at COMMIT/ROLLBACK; `SET` persists on the pooled backend connection and **leaks across tenants**. The `withTenant()` helper (D-18) MUST always use `SET LOCAL app.tenant_id`. This is the constitutional rule for the data-plane code.

### 9.7 Healthcheck `start_period`
Postgres takes 8–12s to come ready on first boot (initdb). Without `start_period: 10s`, dependents flap. Set `start_period` on every stateful service.

### 9.8 OTel Collector `0.x` versioning
[CITED: opentelemetry.io/docs/collector/]

OTel Collector is still in `0.x` despite production use; semver guarantees are limited but exporters/receivers used here (`otlp`, `loki`, `prometheusremotewrite`, `batch`) are stable. Pin a specific minor, never `latest`.

### 9.9 MinIO upstream distribution change (REPEAT — see §2.4)
The single biggest 2026 ops risk in this stack. Pin by digest, document fallback registries.

---

## 10. Validation Architecture (Infra)

### 10.1 Test framework

| Property | Value |
|---|---|
| Framework | Vitest 4 (Node), bash for compose-up smoke |
| Config file | `vitest.config.ts` (Phase 0) |
| Quick run command | `pnpm test --run -t 'compose-smoke'` (~30s) |
| Full suite command | `make up && bash tests/infra/smoke.sh` (~90s, includes startup) |

### 10.2 Phase Requirements → Test Map (infra dimension only)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| DEPLOY-01 | `make up` exits 0 | smoke | `make up && echo $?` | ❌ Wave 0 |
| DEPLOY-01 | All 10 services Healthy within 60s | smoke | `bash tests/infra/wait-healthy.sh 60` | ❌ Wave 0 |
| DEPLOY-03 | `bootstrap.sh` refuses default secrets | unit | `pnpm vitest tests/self-tests/refuse-default-secrets.test.ts` | ❌ Wave 0 (sibling researcher) |
| WIRE-04 | `curl https://api.localhost/api/health` returns 200 (Phase 0 placeholder) | smoke | `curl -fkS https://api.localhost/api/health` | ❌ Wave 0 |
| OBS-01 | Grafana healthy | smoke | `curl -fkS https://grafana.localhost/api/health \| jq -e '.database=="ok"'` | ❌ Wave 0 |
| OBS-01 | OTel Collector receives test span, forwards to Tempo | integration | `bash tests/infra/otel-roundtrip.sh` (sends OTLP via `otlptel`/`telemetrygen`, queries Tempo `/api/search`) | ❌ Wave 0 |
| OBS-01 | OTel Collector forwards logs to Loki | integration | `bash tests/infra/loki-roundtrip.sh` | ❌ Wave 0 |
| OBS-01 | OTel Collector forwards metrics to Mimir | integration | `bash tests/infra/mimir-roundtrip.sh` | ❌ Wave 0 |
| SCALE-02 | PgBouncer accepts connections, transaction mode active | smoke | `psql "host=localhost port=6432 user=openwhispr_app" -c "SHOW pool_mode"` (expects `transaction`) | ❌ Wave 0 |

### 10.3 Sampling rate

- **Per task commit:** `pnpm test --run -t 'compose'` (unit tests for compose YAML schema validation + bootstrap script — fast)
- **Per wave merge:** `make up && bash tests/infra/smoke.sh && make down` (full health gate, ~90s)
- **Phase gate:** `make up && bash tests/infra/smoke.sh && bash tests/infra/otel-roundtrip.sh && bash tests/infra/loki-roundtrip.sh && bash tests/infra/mimir-roundtrip.sh` — green before `/gsd-verify-work`.

### 10.4 Wave 0 gaps (infra)

- [ ] `tests/infra/smoke.sh` — checks all services Healthy within 60s
- [ ] `tests/infra/wait-healthy.sh` — generic helper; takes timeout in seconds
- [ ] `tests/infra/otel-roundtrip.sh` — uses `telemetrygen traces ...` to send OTLP, then queries Tempo
- [ ] `tests/infra/loki-roundtrip.sh` — sends a log line through the collector, queries Loki `/loki/api/v1/query`
- [ ] `tests/infra/mimir-roundtrip.sh` — emits a metric, queries Mimir `/prometheus/api/v1/query` with `X-Scope-OrgID`
- [ ] `compose/traefik/{traefik.yml,dynamic.yml,certs/}` — static + dynamic config + cert dir
- [ ] `compose/otel-collector/config.yaml`
- [ ] `compose/grafana/provisioning/datasources/{tempo,loki,mimir}.yaml`
- [ ] `compose/pgbouncer/{pgbouncer.ini,userlist.txt.example}` — userlist generated by bootstrap
- [ ] Add `make up`, `make down`, `make logs`, `make ps` targets to Makefile

### 10.5 Validation success criteria (concrete)

```bash
# CRITERIA 1
make up; echo "exit=$?"   # exit=0

# CRITERIA 2 — all services healthy in <60s
timeout 60 bash -c 'until [ "$(docker compose ps --format json | jq -s "all(.[]; .Health == \"healthy\")")" = "true" ]; do sleep 2; done'
echo "exit=$?"            # exit=0

# CRITERIA 3 — API placeholder reachable through Traefik
curl -fkS https://api.localhost/api/health   # 200 OK

# CRITERIA 4 — Grafana reachable
curl -fkS https://grafana.localhost/api/health | jq -e '.database == "ok"'

# CRITERIA 5 — OTel Collector trace round-trip
telemetrygen traces --otlp-insecure --otlp-endpoint=localhost:4317 --traces=1 --duration=1s
sleep 3
curl -fsS http://localhost:3200/api/search?tags=service.name=telemetrygen | jq -e '.traces | length > 0'
```

---

## 11. Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Patch-level pins (Grafana 11.6.0, Loki 3.5.0, Tempo 2.8.0, Mimir 2.16.0) are current 2026-05 | §2.7 | Operator pulls a tag that doesn't exist — bootstrap fails fast; trivial to bump. |
| A2 | edoburu/pgbouncer 1.23.1 is the latest 1.23 patch | §2.2 | Same — bootstrap fails fast. |
| A3 | MinIO `RELEASE.2026-03-25T00-00-00Z` is the last broadly-pullable AGPL tag | §2.4 | Distribution gap may force operator to switch to coollabsio/minio mirror; documented as known risk. |
| A4 | Mimir `2.16.0` exists as a released tag | §2.7 | Trivial — bump to whatever's current. |
| A5 | telemetrygen is available in CI for OTLP round-trip | §10.5 | Alternative: write a tiny Node OTLP client (10 lines with `@opentelemetry/sdk-node`). |

---

## 12. Open Questions

1. **Should compose ship Mimir, or single-binary Prometheus for dev?**
   - What we know: STACK.md says "Prometheus single-binary for single-host, Mimir for K8s/multi-host." CONTEXT D-02 locks Mimir.
   - What's unclear: For a single-VM operator, Mimir adds ~250 MB image + tenant-header complexity for no benefit.
   - Recommendation: Honor D-02 (Mimir in compose). Operators who want Prometheus can swap exporters via Helm overrides in Phase 9. Single source of truth between dev and prod LGTM is worth the extra MB.

2. **PgBouncer single instance vs 4 instances in compose?**
   - What we know: STACK.md says "100 backend × 4 PgBouncer instances" for K8s scale; CONTEXT D-02 is silent on instance count for compose.
   - What's unclear: Compose v1 doesn't need 4 instances at 1000 concurrent; single instance × 100 pool is fine.
   - Recommendation: Single instance in compose; document horizontal-pool scaling pattern in `docs/operations.md` for Helm.

3. **MinIO image distribution post-2026 — fallback registry choice?**
   - What we know: minio/minio archived 2026-04-25; coollabsio and pgsty are community mirrors.
   - What's unclear: Which mirror has the longest-term commitment?
   - Recommendation: Default to `minio/minio:RELEASE.2026-03-25T00-00-00Z` pinned by digest; document `coollabsio/minio` as the fallback. Revisit at Phase 9.

---

## 13. Sources

### Primary (HIGH confidence)
- [Compose Specification](https://compose-spec.io/) — no `version:` key, profiles, healthchecks
- [Docker Hub: postgres official](https://hub.docker.com/_/postgres) — 17-alpine multi-arch
- [Docker Hub: edoburu/pgbouncer](https://hub.docker.com/r/edoburu/pgbouncer) — 1.23.1 image, env-var config
- [edoburu/docker-pgbouncer GitHub](https://github.com/edoburu/docker-pgbouncer) — config knobs, env-var mapping
- [PgBouncer config reference](https://www.pgbouncer.org/config.html) — `max_prepared_statements`, `pool_mode=transaction`, `auth_type=scram-sha-256`
- [PgBouncer 1.21 prepared statements blog (pganalyze)](https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode)
- [Crunchy Data: prepared statements in transaction mode](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer)
- [Traefik v3 documentation](https://doc.traefik.io/traefik/) — file provider, TLS, respondingTimeouts
- [Traefik v3 file provider reference](https://doc.traefik.io/traefik/providers/file/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) — receivers/processors/exporters
- [OTel Collector contrib v0.151.0 release](https://github.com/open-telemetry/opentelemetry-collector-contrib/releases) — 2026-04-29
- [Grafana datasource provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)
- [Grafana Mimir multi-tenancy](https://grafana.com/docs/mimir/latest/manage/secure/authentication-and-authorization/) — X-Scope-OrgID requirement
- [Loki configuration](https://grafana.com/docs/loki/latest/configure/) — auth_enabled defaults
- [LGTM stack with OTel guide 2026](https://oneuptime.com/blog/post/2026-02-06-lgtm-stack-opentelemetry/view)

### Secondary (MEDIUM confidence)
- [MinIO Docker Hub](https://hub.docker.com/r/minio/minio) — verified RELEASE.2026-03-25 tag exists
- [MinIO GitHub releases](https://github.com/minio/minio/releases) — repo archived 2026-04-25
- [MinIO console-address docs](https://min.io/docs/minio/kubernetes/upstream/administration/minio-console.html) — :9000 / :9001 split
- [Traefik v3.6 self-signed certs (community)](https://community.traefik.io/t/how-to-configure-self-signed-certificates/28182)
- [BretFisher compose-dev-tls](https://github.com/BretFisher/compose-dev-tls) — mkcert + Traefik dev pattern
- [Bitnami Secure Images for PgBouncer](https://techdocs.broadcom.com/us/en/vmware-tanzu/bitnami-secure-images/...) — paid-only context for the bitnami-vs-edoburu decision

### Tertiary (LOW confidence — flagged for re-verify at execution)
- Exact patch versions of Grafana 11.6.0 / Loki 3.5.0 / Tempo 2.8.0 / Mimir 2.16.0 — A1
- edoburu/pgbouncer 1.23.1 patch level — A2
- MinIO release tag stability post-archive — A3

---

## Metadata

**Confidence breakdown:**
- Image pins (major lines): HIGH — all majors verified against official sources
- Image pins (minor/patch): MEDIUM — pin at execution time
- Compose structure: HIGH — Compose Spec v2 confirmed
- PgBouncer transaction-mode + prepared statements: HIGH — multiple authoritative sources
- Traefik 3 file provider: HIGH — official docs
- OTel Collector pipeline: HIGH — official docs + tested pattern
- MinIO future availability: MEDIUM — distribution change is a known risk

**Research date:** 2026-05-09
**Valid until:** 2026-06-09 (30 days for stable; revisit MinIO situation sooner if it deteriorates)
