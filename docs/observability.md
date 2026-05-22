# Observability

OpenWhispr Server ships a complete OpenTelemetry pipeline and four
default Grafana dashboards out of the box. A fresh `docker compose up`
brings up the full LGTM stack (Loki + Grafana + Tempo + Mimir) plus
an OTel Collector that fans out traces, logs, and metrics from every
API replica and every BullMQ worker. This document is the operator
reference for what is shipped, what each surface shows, and how to
extend the defaults for a corporate deployment.

All source artifacts in this repository are English-only (DOCS-09).
Runtime localisation of user-visible copy (errors, emails) is handled
separately by the i18n layer; the operator console is English in v1.

## 1. Stack Overview

```
+---------+      +-----------------+      +---------+   +----------+
| apps/api| ---> | OTel Collector  | ---> | Tempo    |   | Grafana  |
+---------+      |  (otlp http/grpc)|     +---------+   |          |
| worker  | ---> |                 | ---> | Loki     |<--+          |
+---------+      |                 | ---> | Mimir    |<--+          |
                 +-----------------+      +---------+   +----------+
                       |                                     ^
                       | filelog receiver -> Loki            |
                       +-------------------------------------+
```

Phase 06.1 locked the filesystem-backed Tempo + Mimir + Loki configs
(D-01) -- no S3/GCS/MinIO bucket is required for a single-host install.
Operators graduating to multi-host or HA topologies override the
backend in `compose/{tempo,mimir,loki}/*.yaml` to point at object
storage; the OTel Collector pipeline (D-04) does not change.

The OTel SDK boots before any other application import
(`apps/api/src/otel-bootstrap.ts` is the literal first executable line
of `apps/api/src/index.ts`, asserted by a load-order self-test).
This ordering is load-bearing -- `@opentelemetry/instrumentation-pino`
patches `pino` at `require` time (D-T3); booting the SDK after pino
silently drops the `trace_id` / `span_id` injection into every log
record.

Auto-instrumentation covers: Fastify, undici, pg, ioredis, BullMQ
(D-T1). Drizzle sits on `pg` and is intentionally **not**
double-instrumented (single signal per call, per the "no duplication"
steering -- D-T6). `dns` and `fs` instrumentations are disabled
(span volume dwarfs useful signal).

Sampling is 100 % always-on in v1 (D-T2). At the scale of 1000
concurrent users measured in Phase 8, Tempo's filesystem backend
handles a few thousand spans per second comfortably. Tail-based
sampling is the upgrade path if storage pressure shows up.

## 2. Health Probes (D-P1, D-P2)

Three dedicated probes follow kubelet-canonical semantics. Each maps
to a distinct failure mode and a distinct operator action.

| Probe       | Path        | Checks                                               | When the load balancer reacts |
|-------------|-------------|------------------------------------------------------|-------------------------------|
| Liveness    | `/livez`    | Fastify event loop responsive. No deps.              | Pod restart on failure.       |
| Readiness   | `/readyz`   | Postgres + Valkey + LiteLLM round-trip, 5 s cache.   | Traffic stopped on failure.   |
| Startup     | `/startupz` | Migrations applied + pg pool warm + Valkey reachable.| Boot grace; longer timeout.   |

`/api/health` is a distinct first-class endpoint for the Electron
client (Phase 2 contract). Unlike `/livez` — which returns only
`{ "status": "ok" }` — `/api/health` returns `{ "status": "ok",
"migrations_completed": <bool> }`, adding the schema-readiness flag.
Both routes have no dependency checks and always return 200; kubelet
uses `/livez` for restart decisions and never consults `/api/health`.

`/livez` has **no dependency checks**. A Postgres or Valkey blip must
not cascade-restart every API pod -- recovery is a sub-second hiccup,
not a process failure. Operators reading the kubelet config from a
Helm chart should configure:

```yaml
livenessProbe:
  httpGet: { path: /livez, port: 3000 }
  initialDelaySeconds: 30
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 5
startupProbe:
  httpGet: { path: /startupz, port: 3000 }
  failureThreshold: 30
  periodSeconds: 2
```

The 5-second dep-check cache prevents kubelet thundering herd -- at
`periodSeconds=5` and 4 replicas, concurrent `/readyz` requests
share a single dependency lookup per dep per cache window.

## 3. Default Dashboards

The four dashboards live under
`compose/grafana/provisioning/dashboards/` and auto-load into the
"OpenWhispr" folder on Grafana startup
(`dashboards.yaml` provider manifest).

### 3.1 RED + Saturation (`openwhispr-red-saturation`)

Rate / Errors / Duration plus BullMQ saturation. Sourced from OTel
auto-instrumentation metrics via Mimir.

- Request rate by route (req/s).
- 5xx rate by route (req/s).
- p50 / p95 / p99 latency by route (seconds).
- BullMQ queue saturation per of the 7 Phase 6 queues
  (`bullmq_queue_active + _wait + _delayed`).
- BullMQ job duration p95 by queue.
- HTTP 429/sec total.
- Replica count via `x-served-by` hostname cardinality (SCALE-01).

### 3.2 Per-Tenant Usage (`openwhispr-per-tenant-usage`)

Postgres datasource over `usage_ledger`. Shows operators the same
numbers `/api/usage` returns to the desktop client, aggregated across
the tenant.

- Top-20 tenants by 24 h spend (table).
- Hourly transcribe-minutes per tenant.
- Hourly reason-tokens per tenant.
- Hourly streaming-minutes per tenant.
- Active-tenant count (24 h).

### 3.3 LiteLLM Spend (`openwhispr-litellm-spend`)

USD spend attributed to LiteLLM upstream calls. Hydrated by the
D-R1 layer-1 (sync) and layer-2 (60 s ingest) write paths from
`LiteLLM_SpendLogs` into `usage_ledger.spend_cents`.

- 24 h and 7 d total spend (USD, stat).
- Hourly spend timeseries.
- Spend by model (table, 24 h).
- Spend by tenant + model (table, 24 h).

### 3.4 Reconciliation Drift (`openwhispr-reconciliation-drift`)

The OBS-04 surface. Two Mimir gauges emitted by the
`reconciliation-daily-check` BullMQ job (D-R2):

- `litellm_reconciliation_drift_pct{tenant_id}` -- row drift between
  LiteLLM's spend log and our ledger, in percent.
- `litellm_reconciliation_drift_usd_cents{tenant_id}` -- spend drift
  in USD cents.

Threshold lines are drawn at the D-R3 defaults (0.5 %, $0.01); alert
rules fire on breach (section 5).

## 4. Log Correlation (Loki <-> Tempo)

Every pino JSON log record emitted from inside an active OTel span
includes `trace_id`, `span_id`, `trace_flags` keys
(`@opentelemetry/instrumentation-pino`, D-T3). The Loki datasource
provisioning (`compose/grafana/provisioning/datasources/loki.yaml`)
adds a derived field that turns the `trace_id` JSON value into a
clickable link to the matching Tempo trace:

```yaml
jsonData:
  derivedFields:
    - name: TraceID
      matcherRegex: '"trace_id":"([a-f0-9]+)"'
      url: '${__value.raw}'
      datasourceUid: tempo
```

In Grafana Explore on the Loki datasource, every log line with a
`trace_id` renders a "TraceID" button beside the message. Clicking
the button opens the matching span in the Tempo tab, exposing the
full request waterfall (Fastify -> pg -> undici -> LiteLLM upstream).
Tempo's own `tracesToLogsV2` config links back from a span to the
matching Loki log range so operators can pivot in either direction.

## 5. LiteLLM Reconciliation (D-R1, D-R2, D-R3)

Three layers of usage-ledger writes guard against silent drift.

**Layer 1 -- sync in handler.** `/api/transcribe`, `/api/reason`,
`/api/agent/stream` and friends write to `usage_ledger` immediately
on the LiteLLM response. Fresh data in `/api/usage` instantly.

**Layer 2 -- async ingest.** The recurring `ingest-litellm-spend`
BullMQ job reads `LiteLLM_SpendLogs` every 60 s and inserts any rows
the handler missed (handler crash between LiteLLM response and
ledger write). The insert is idempotent via
`ON CONFLICT (request_id) DO NOTHING`.

**Layer 3 -- daily reconciliation.** The
`reconciliation-daily-check` BullMQ job (System mode -- reads across
all tenants) computes for each tenant active in the last 24 h:

```
drift_pct       = |litellm_rows - ledger_rows| / max(litellm_rows, 1) * 100
drift_usd_cents = |litellm_spend_cents - ledger_spend_cents|
```

Both numbers are emitted as Mimir gauges and surfaced on the
Reconciliation Drift dashboard.

The Grafana alert rules in
`compose/grafana/provisioning/alerting/reconciliation-alerts.yaml`
fire when either axis exceeds the default thresholds for at least
one hour:

| Rule UID                          | Expression                                        | Threshold (default) | Env override                            |
|-----------------------------------|---------------------------------------------------|---------------------|-----------------------------------------|
| `reconciliation_drift_pct_high`   | `max(litellm_reconciliation_drift_pct)`           | 0.5 (percent)       | `RECONCILIATION_DRIFT_PCT_THRESHOLD`    |
| `reconciliation_drift_usd_high`   | `max(litellm_reconciliation_drift_usd_cents)`     | 1 (cent)            | `RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD` |

On alert fire, the operator runs the `reconciliation-discrepancy`
BullMQ job for the affected tenant; the job calls
`ingest-litellm-spend` with explicit `since` / `until` arguments over
the gap window, idempotent on `request_id`.

## 6. Audit Log (D-A1 .. D-A7)

The `audit_log` table is the canonical security trail. Writes are
synchronous, in-band with the audited transaction (D-A1) -- the row
exists if and only if the audited action committed. No async fanout
queue, no lost-event window.

The 18 canonical `action` values are locked at the DB layer via a
CHECK constraint:

- `auth.{signin, signin_failed, signout, password_change, oauth_link}`
- `account.{delete, delete_requested}`
- `key.{issued, revoked}`
- `settings.{tenant_changed, user_changed}`
- `admin.{tenant_created, tenant_suspended, user_impersonated, role_changed}`
- `security.{cross_tenant_attempt, rate_limit_exceeded, ssrf_blocked}`

The table is partitioned monthly via `pg_partman` (D-A2). The
`partman-maintenance` BullMQ job runs daily to materialise next
month's partition and detach old ones per retention policy. The
`audit-archive` job runs monthly to export detached partitions to
S3-compatible object storage; operators on MinIO / GCS override the
export step via env.

Retention defaults: 13 months hot (1 year + 1 month buffer for
monthly reports); archived forever in object storage.

There is no public read API in v1 (D-A5). Operators query the table
directly via `psql` or the Grafana Postgres datasource:

```sql
SELECT created_at, actor_user_id, action, payload
FROM audit_log
WHERE tenant_id = :tenant
  AND created_at > now() - interval '7 days'
ORDER BY created_at DESC;
```

Payload conventions are locked (D-A7). Every payload includes
`request_id` for trace correlation, `ip` (or `null` if
`AUDIT_REDACT_IP=true`), and a `user_agent` truncated to 512 chars.
Per-action required keys are documented in `06-CONTEXT.md` section D-A7.

Raw secrets (passwords, bearer tokens, virtual keys, OAuth codes /
state, full `Authorization` headers) are forbidden in payloads and
are caught at write time by the pino `redact` configuration in
`@openwhispr/observability` -- the sentinel-sweep test asserts no
known secret pattern ever reaches captured stdout.

## 7. Rate Limits (D-RL1 .. D-RL3)

`@fastify/rate-limit` v10 is registered twice in
`apps/api/src/plugins/rate-limit.ts`:

- **Global IP-tier** -- `keyGenerator: req => req.ip`,
  ceiling ~600/min/IP (DoS shield).
- **Per-route user-tier** -- overrides on each route;
  `keyGenerator: req => req.session?.userId ?? req.ip` (auto-degrades
  to IP for unauthenticated callers).

A 429 fires when either counter is exhausted. Two Valkey GETs per
request adds ~0.4 ms.

The 429 envelope preserves the Phase 2 shape:

```json
{ "error": "Too many requests" }
```

with `Retry-After` plus the IETF standard headers
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
The headers report the user-tier limit (more actionable for clients);
the IP-tier remains internal-only.

The per-route rpm matrix is in `apps/api/src/config/rate-limits.ts`.
All numbers are env-overridable so Phase 8 k6 tuning is a config
change, not a code change. Key entries:

- `/api/transcribe` -- 20/min/user, 60/min/IP (expensive multipart).
- `/api/reason` -- 30/min/user, 90/min/IP.
- `/api/agent/stream` -- 10/min/user, 30/min/IP (long-lived NDJSON).
- `/api/v1/keys/create` -- 5/min/user, 20/min/IP (sensitive minting).
- `/api/auth/{signin,signup,forgot-password}` -- 10/min/IP (pre-auth
  abuse target).
- `/api/auth/verification-status` -- 30/min/(IP,email) composite
  carve-out for the desktop client's 5 s poll (Phase 2 D-* preserved).

A 429 trip emits an `audit_log` row with
`action: security.rate_limit_exceeded` plus `payload.rule` and
`payload.route` (D-A7).

## 8. SSRF Defense (D-S1 .. D-S6)

A process-wide undici Dispatcher with an SSRF interceptor sits at
`apps/api/src/lib/ssrf-dispatcher.ts`. `setGlobalDispatcher(...)` is
called in `apps/api/src/bootstrap.ts` before any route registers,
so every transitive `fetch()` is gated -- Better Auth OIDC redirects,
LiteLLM, Tavily, Yandex, pyannote, future user-URL-fetching features.

The flow per outbound request:

1. Parse target URL; extract hostname.
2. Reject early if hostname is not in `OUTBOUND_ALLOWED_HOSTS`.
3. Single DNS resolve via `dns.promises.lookup(host, {all: true})`.
4. Reject if any resolved IP is in the block-list (D-S3) AND the
   host is not in `OUTBOUND_PRIVATE_HOST_ALLOWLIST`.
5. Connect by **resolved IP** (no re-resolve), with the original
   `Host:` header preserved for TLS SNI + virtual hosting.

Steps 3-5 close the DNS-rebinding TOCTOU. The block-list covers all
RFC1918 + loopback + link-local + AWS IMDS (v4 + v6) + multicast +
CGNAT ranges (D-S3) -- `169.254.169.254` is mandatory for the
AWS-ready posture.

Env knobs:

```bash
OUTBOUND_ALLOWED_HOSTS=openrouter.ai,api.tavily.com,api.pyannote.ai,litellm,*.amazonaws.com
OUTBOUND_PRIVATE_HOST_ALLOWLIST=litellm,speaches,mailpit,valkey,postgres,pgbouncer
OUTBOUND_ALLOW_LOOPBACK=0
OUTBOUND_SSRF_MODE=enforce   # enforce | warn
```

A block returns HTTP 502 to the client with
`{ "error": "Upstream blocked by SSRF policy", "request_id": "..." }`
plus a structured WARN log and an `audit_log` row with
`action: security.ssrf_blocked` (D-A6 #18). `warn` mode logs and
audits but does not 502 -- useful for one-shot rollout to discover
unknown legitimate hosts before enforcement.

## 9. Troubleshooting

**Probe is failing.**

- `/livez` returns 503 -- process is wedged. Restart the pod.
- `/readyz` returns 503 -- inspect the response body; the failing
  dep name is in `payload.deps`. Common causes: Valkey OOM,
  Postgres connection-pool exhaustion (check
  `pg_stat_activity`), LiteLLM upstream timeout.
- `/startupz` stuck at 503 -- migrations are still applying. Tail
  `apps/api` logs and look for `[migrate] applying NNNN_*.sql`.

**No spans in Tempo.**

- Inspect `apps/api` startup logs for the `[otel] sdk started`
  line. If absent, the SDK failed to initialise -- usually a
  Collector unreachable issue.
- `curl http://otel-collector:4318/v1/traces` from any compose
  service should respond with HTTP 405 (Method Not Allowed) -- that
  is the live OTLP/HTTP endpoint.
- `tempo` and `mimir` services run as distroless and have no shell;
  inspect their container logs via `docker compose logs tempo`.

**Loki shows no logs.**

- The OTel Collector ships logs via the `filelog` receiver scraping
  container stdout. Confirm Docker is configured to write JSON
  log driver (default).
- Inspect the Collector's own logs for `loki: bad response`. A
  schema mismatch between Loki versions trips the
  `otlphttp/loki` exporter.

**Grafana Postgres datasource error.**

- The `grafana_reader` role must exist before the
  `per-tenant-usage` and `litellm-spend` dashboards query
  successfully. See the header comment in
  `compose/grafana/provisioning/datasources/postgres.yaml` for the
  CREATE ROLE + GRANT statements. A follow-up migration to
  automate this is tracked in the Phase 6 deferred backlog.

**Reconciliation alert is firing but no rows are missing.**

- Confirm the LiteLLM master DB connection string
  (`LITELLM_DATABASE_URL`) points at the same Postgres cluster the
  `LiteLLM_SpendLogs` table actually lives in; a stale env from a
  prior deployment will read an empty table and flag every active
  tenant as 100 % drift.
- Inspect the `reconciliation-discrepancy` job output for the
  affected tenant; it logs the exact `request_id` set on each side.

---

For decisions, see `.planning/phases/06-observability-ops-hardening-workers/06-CONTEXT.md`.
For the dashboard JSONs themselves, see
`compose/grafana/provisioning/dashboards/`.
For the alert rule definitions, see
`compose/grafana/provisioning/alerting/reconciliation-alerts.yaml`.
