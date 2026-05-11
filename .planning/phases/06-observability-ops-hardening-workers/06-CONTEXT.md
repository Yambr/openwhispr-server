# Phase 6: Observability + Ops Hardening + Workers - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning
**Mode:** advisor-assisted discussion (3 parallel research agents on the 4 gray-area clusters)

<domain>
## Phase Boundary

Phase 6 delivers the production-readiness layer that lets an operator open the shipped Grafana dashboards and immediately see end-to-end traces (API → LiteLLM as opaque upstream → ledger), per-tenant usage, LiteLLM spend reconciliation, RED + saturation, and audit-log activity; bearer tokens never appear in logs; background jobs always carry full tenant context; per-user AND per-IP anti-abuse rate limiting is live across the surface; every server-side outbound HTTP call is SSRF-gated against private IPs (including AWS metadata 169.254.169.254) and DNS-rebinding.

Phase 6 maps to requirements **OBS-01..05, DATA-04, SCALE-01, SCALE-03, SCALE-04**.

**In scope:**

1. **OTel auto-instrumentation** for Fastify, undici, pg, ioredis, BullMQ, plus manual spans around Better Auth handlers. Always-on 100% sampling in v1.
2. **pino ↔ OTel log correlation** via `@opentelemetry/instrumentation-pino` (auto-inject `trace_id`/`span_id` into JSON log records). Single metrics path OTel SDK → Collector → `prometheusremotewrite` → Mimir (NO `/metrics` Prom-pull endpoint on API — preserves "no duplication" steering).
3. **Log scrubbing** at the source via pino `redact` paths + sentinel-token sweep test that proves nothing leaks across the captured stdout.
4. **Audit log** — synchronous in-band INSERT into `audit_log`, 18 canonical `action` values locked, pg_partman monthly RANGE partitions, S3-archive maintenance job, locked payload conventions. NO async fanout queue. NO public read API in v1.
5. **LiteLLM spend reconciliation** — daily BullMQ job emits dual-axis Mimir gauges (`litellm_reconciliation_drift_pct{tenant_id}` + `litellm_reconciliation_drift_usd_cents{tenant_id}`), tolerance ≤ 0.5% rows AND ≤ $0.01 USD spend over 24h, Grafana alert rule on threshold breach, backfill via existing idempotent `ingest-litellm-spend` over the gap window.
6. **Three health probes** `/livez` + `/readyz` + `/startupz` with kubelet-canonical semantics. `/livez` has NO dep checks (a Postgres blip MUST NOT cascade-restart pods); `/readyz` checks Postgres + Valkey + LiteLLM with 2-5s cached result; `/startupz` covers migrations + pool warm. `/api/health` retained as alias.
7. **Horizontal-scale verification** e2e test: `docker compose --scale api=2` + Traefik round-robin + `x-served-by` response header (from `os.hostname()`) — proves Postgres-stored sessions + Valkey cache work cross-replica with zero session loss.
8. **BullMQ tenant-context middleware** — `withTenantContext(handler)` HOF + Zod-validated job-data schema + 3-layer CI gate (Biome lint rule + runtime pg-pool guard + RLS property test). Cross-tenant system jobs (`ingest-litellm-spend`) use explicit `withSystemContext()` escape hatch.
9. **Phase 6 BullMQ queue inventory** — 1 existing (`ingest-litellm-spend`, refactored to System mode) + 5 new (`email-delivery`, `usage-rollup-daily`, `virtual-key-rotation`, `reconciliation-discrepancy`, `reconciliation-daily-check`).
10. **Anti-abuse rate-limit policy matrix** — layered IP + user via `@fastify/rate-limit` v10 (two counters in Valkey), per-route rpm budgets locked, 429 envelope unchanged + `X-RateLimit-Limit/Remaining/Reset` headers added. Polling carve-out for `/api/auth/verification-status` preserved from Phase 2.
11. **SSRF defense** — global undici Dispatcher with SSRF interceptor (default-on, covers every transitive `fetch()` including Better Auth OIDC redirects), single-resolve-then-connect-by-IP closes DNS-rebinding TOCTOU, env-driven allow-list with `*.wildcard` support, RFC1918 + link-local + loopback + IPv6-ULA + AWS metadata 169.254.169.254 block-listed by default. Violation → HTTP 502 + audit_log `security.ssrf_blocked` entry.

**Carrying forward from earlier phases:**

- OTel/Tempo/Mimir/Loki/Grafana stack wired in compose (Phase 1 + 06.1).
- `audit_log` table schema locked (Phase 1) — `{id uuid PK, tenant_id uuid FK NOT NULL, actor_user_id uuid NULL, action text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz}`. Phase 6 adds CHECK constraint on `action` enum + monthly partitioning.
- `apps/worker` BullMQ skeleton operational (Phase 3) with `ingest-litellm-spend` recurring job.
- `@fastify/rate-limit` v10 plugin already registered (Phase 2 Plan 04) with Valkey-backed RedisStore and the `/api/auth/verification-status` 30/min carve-out.
- `apps/api/src/middleware/tenant.ts` — request-tier tenant context middleware (mirrored by Phase 6's `withTenantContext` HOF for the worker tier).
- pino is the canonical logger; JSON output everywhere; no plaintext fallback.
- Constitutional: strict TDD, ≥ 90% per-phase coverage on all four axes (lines/branches/functions/statements), GHA CI mandatory, e2e tests against real docker-compose stack mandatory, no mocks of internal logic.

**Explicitly OUT of scope for Phase 6:**

- LiteLLM internal instrumentation — LiteLLM is treated as opaque sidecar per user steering (paraphrased: "LiteLLM stays on its own side, we stay on ours"); we do not patch its Python process, do not propagate W3C traceparent across its boundary, reconcile via spend-log table + Loki container-log ingest only.
- Public read API for audit log (`GET /api/admin/audit-log`) — deferred to Phase 7 (UI) or v2.
- `audit-log-fanout` BullMQ queue — sync writes were chosen for transactional consistency.
- Per-tenant rate limits — per-user budgets sufficient for v1; revisit if Phase 8 load test surfaces tenant-level abuse patterns.
- Tail-based trace sampling at the Collector — defer until storage pressure shows up (currently always-on 100%).
- AWS S3 archive of detached partitions in non-AWS deployments — pg_partman maintenance job emits a hook; operators on GCS/MinIO override the export step in v1.x.

</domain>

<decisions>
## Implementation Decisions

### Telemetry (OTel + log correlation + log scrubbing)

- **D-T1 — OTel auto-instrumentation scope.** Auto-instrument: Fastify, undici, pg, ioredis (baseline) **+ BullMQ jobs** (every job becomes a span with queue/job-id/attempt as attributes — critical for "why did tenant X's audit-fanout stall?" forensics) **+ Better Auth manual spans** (signup, signin, session-rotate, OAuth callback — Better Auth has no auto-instrumentation; manual spans give breakdown between BA work vs DB vs upstream IdP). **Skip Drizzle** (sits on `pg`; auto-instrumenting both produces duplicate signals — per "no duplication" steering). **Skip DNS + filesystem instrumentations** (span volume dwarfs useful signal).

- **D-T2 — Trace sampling.** Always-on 100% in v1. Tempo's filesystem backend (locked in Phase 06.1 D-01) handles a few thousand spans/sec from 1000 concurrent users comfortably. Revisit at Phase 8 once the k6 load test produces measured volume; tail-based sampling at the Collector is the upgrade path.

- **D-T3 — pino ↔ OTel log correlation.** Use `@opentelemetry/instrumentation-pino` — auto-injects `trace_id`, `span_id`, `trace_flags` into every pino log record when called inside an active span. Logs flow pino → stdout JSON → OTel Collector (filelog receiver) → Loki via `otlphttp` (already wired in Phase 06.1 D-04). Grafana derived-fields links log line → Tempo trace. Zero manual instrumentation in handler code.

- **D-T4 — Log scrubbing at source via pino `redact`.** Configure pino's built-in redact: paths include `req.headers.authorization`, `req.headers.cookie`, `*.token`, `*.secret`, `*.password`, `*.apiKey`, `res.headers["set-auth-token"]`, plus URL-query params with `code=`/`state=` keys, plus request bodies for auth endpoints. Censor: `[REDACTED]`. Sentinel-token sweep test injects a known string in every payload field and asserts it never reaches captured stdout. NOT a Collector-side processor (raw secrets would exist briefly in stdout before Collector reads them — a CloudWatch/EKS node-log capture would leak).

- **D-T5 — LiteLLM is opaque sidecar.** No instrumentation inside LiteLLM. No W3C traceparent header propagation across the boundary. Our API's outbound span shows the call (and its duration + status); reconciliation against `LiteLLM_SpendLogs` table (D-R1..R3) plus Loki ingest of LiteLLM container logs (already in `compose/otel-collector/config.yaml` log pipeline) covers the gap. User steering (paraphrased: "LiteLLM stays on its own side, we stay on ours") — locked.

- **D-T6 — Single metrics path.** OTel SDK metrics → OTel Collector → `prometheusremotewrite` → Mimir (already wired). NO `/metrics` Prometheus-scrape endpoint on the API. NO duplicate metrics paths. Per the "Prometheus metrics, no duplicated functionality" steering — locked.

- **D-T7 — Stack posture.** AWS/EKS-portable enterprise default (LGTM via OTel Collector). pino JSON logs canonical, no pretty-print, no plaintext. English-only log keys (constitutional).

### Audit Log (DATA-04)

- **D-A1 — Sync in-band INSERT.** Audit-log writes happen synchronously inside the route handler's transaction. Transactional guarantee: "the audit row exists iff the audited action committed." Async fanout (BullMQ queue) was rejected — lost-event window during Redis/worker outage means an `account.delete` could succeed without an audit row, conflicting with DATA-04 no-loss expectation.

- **D-A2 — Monthly RANGE partitioning via pg_partman.** Convert `audit_log` to a partitioned parent table; pg_partman creates monthly child partitions and detaches old partitions per retention policy. AWS RDS / Aurora-supported; the boring enterprise-portable choice. Migration adds the pg_partman extension + converts the existing flat table.

- **D-A3 — S3 archive of detached partitions.** New BullMQ recurring job (`audit-archive`, monthly cron) calls `aws_s3.query_export_to_s3` (or `pg_dump | aws s3 cp` fallback for non-AWS) on detached partitions, then drops the partition from the cluster. Operators on MinIO/GCS override the export step via env. Retention: keep 13 months hot (1 year + 1 month buffer for monthly reports); archive forever in object storage.

- **D-A4 — pg_partman maintenance.** Add `partman-maintenance` BullMQ recurring job (daily cron). Calls `partman.run_maintenance_proc()` to materialize next month's partition ahead of time and detach old ones per retention rule. Avoids pg_cron dependency.

- **D-A5 — NO public read API in v1.** `GET /api/admin/audit-log` deferred to Phase 7 (UI build pulls it forward) or v2. Operators query the table directly via `psql` or Grafana Postgres datasource until then.

- **D-A6 — Canonical `action` taxonomy (18 values, locked).** Stored as a TypeScript const-union and enforced at the DB layer via CHECK constraint:

  | # | action | When emitted |
  |---|--------|--------------|
  | 1 | `auth.signin` | Successful Better Auth signin (password, OAuth callback, email-OTP) |
  | 2 | `auth.signin_failed` | Signin rejected (bad password, expired OTP, OAuth state mismatch, locked) |
  | 3 | `auth.signout` | Explicit signout or session revocation |
  | 4 | `auth.password_change` | Password rotated (self-service or admin-forced) |
  | 5 | `auth.oauth_link` | External IdP linked to existing account |
  | 6 | `account.delete` | Account deletion executed (already partially wired in `delete-account.ts`) |
  | 7 | `account.delete_requested` | Soft-delete / grace-window initiated |
  | 8 | `key.issued` | LiteLLM virtual key or API token minted |
  | 9 | `key.revoked` | Virtual key / API token revoked or rotated out |
  | 10 | `settings.tenant_changed` | Tenant-scoped settings mutated |
  | 11 | `settings.user_changed` | User-scoped preferences mutated |
  | 12 | `admin.tenant_created` | New tenant provisioned by operator |
  | 13 | `admin.tenant_suspended` | Tenant disabled |
  | 14 | `admin.user_impersonated` | Operator assumed user identity for support |
  | 15 | `admin.role_changed` | Role assignment mutated (member ↔ admin ↔ owner) |
  | 16 | `security.cross_tenant_attempt` | RLS denial or app-layer tenant mismatch caught |
  | 17 | `security.rate_limit_exceeded` | Anti-abuse rate limit tripped |
  | 18 | `security.ssrf_blocked` | Outbound URL gated by SSRF defense |

- **D-A7 — Payload conventions (locked).** Always-required columns/keys: `tenant_id` (column), `actor_user_id` (column, NULL for unauth `auth.signin_failed` + `security.*`), `created_at` (column), `payload.request_id` (correlate with traces), `payload.ip` (string IPv4/IPv6 OR `null` if operator sets `AUDIT_REDACT_IP=true`), `payload.user_agent` (string, truncated to 512 chars).

  Per-action required keys:
  - `auth.*` → `payload.method` (`password|oauth_google|oauth_github|email_otp|...`)
  - `auth.signin_failed` → `payload.reason` (enum: `bad_credentials|expired_otp|oauth_state_mismatch|locked|unknown`)
  - `key.issued|key.revoked` → `payload.key_id` (NEVER the secret itself; pino redact enforces)
  - `settings.*` → `payload.field` + `payload.before_hash` + `payload.after_hash` (sha256; never raw value for secret fields)
  - `admin.user_impersonated` → `payload.target_user_id`, `payload.reason` (operator free text)
  - `security.cross_tenant_attempt` → `payload.attempted_tenant_id`, `payload.route`
  - `security.rate_limit_exceeded` → `payload.rule`, `payload.route`
  - `security.ssrf_blocked` → `payload.target_url_host`, `payload.rule`

  **Forbidden in payload** (enforced via pino redact + a positive test that the redactor catches them): raw passwords, raw bearer tokens, raw virtual keys, raw OAuth `code`/`state`/`access_token`, full `Authorization` header.

### LiteLLM Spend Reconciliation (OBS-04)

- **D-R1 — Three-layer usage_ledger write path (existing design, locked).**
  - **Layer 1 — Sync in handler.** `/api/transcribe`, `/api/reason`, `/api/agent/stream` etc. write to `usage_ledger` immediately on LiteLLM response (Phase 3). Fresh data in `/api/usage` instantly.
  - **Layer 2 — Async ingest (existing `ingest-litellm-spend`, recurring 60s).** Worker reads `LiteLLM_SpendLogs` from LiteLLM's co-tenant Postgres DB; idempotent `INSERT INTO usage_ledger ... ON CONFLICT (request_id) DO NOTHING`. Catches any rows that Layer 1 missed (handler crash between LiteLLM response and ledger write).
  - **Layer 3 — Daily reconciliation (Phase 6 NEW).** Tolerance-based dual-axis drift detection. See D-R2.

- **D-R2 — Daily reconciliation job.** New BullMQ job `reconciliation-daily-check` (cron daily, System mode — reads across all tenants). Computes for each tenant active in the last 24h: `drift_pct = |litellm_rows - ledger_rows| / max(litellm_rows, 1) * 100`, `drift_usd_cents = |litellm_spend_cents - ledger_spend_cents|`. Emits two OTel gauges to Mimir: `litellm_reconciliation_drift_pct{tenant_id}` and `litellm_reconciliation_drift_usd_cents{tenant_id}`. Cardinality bounded — only emits for tenants with non-zero activity in the window.

- **D-R3 — Alert + backfill.** Grafana/Mimir alert rule fires when EITHER axis breaches threshold: `drift_pct > 0.5` OR `drift_usd_cents > 1` over the 24h window. Alert surface = Grafana alert → operator-configured webhook (email/Slack/PagerDuty/SNS). Backfill on detection = the `reconciliation-discrepancy` BullMQ job calls existing `ingest-litellm-spend` with explicit `since`/`until` arguments over the gap window — idempotent on `request_id`, so re-running over already-ingested rows is a no-op. The thresholds are env-overridable (`RECONCILIATION_DRIFT_PCT_THRESHOLD=0.5`, `RECONCILIATION_DRIFT_USD_CENTS_THRESHOLD=1`).

### Health Probes + Horizontal-Scale Verification (OBS-05 + SCALE-01)

- **D-P1 — Three dedicated probes with kubelet-canonical names.**
  - `/livez` — process-alive only. Returns 200 if the Fastify event loop is responsive. **NO dependency checks.** A Postgres/Redis/LiteLLM blip MUST NOT cascade-restart every API pod.
  - `/readyz` — checks Postgres + Valkey + LiteLLM round-trip dependency health with **2-5s cached result** to prevent kubelet thundering herd at `periodSeconds=10`. Returns 503 if any dep is unhealthy; load balancer (Traefik/EKS) stops routing to this replica.
  - `/startupz` — covers slow-init: migrations applied + pg pool warm + Valkey reachable. Returns 200 once boot is complete.
  - `/api/health` retained as alias (delegates to `/livez`) for back-compat with existing tests in `apps/api/src/health.test.ts`.

- **D-P2 — Dep-check implementation.** New `apps/api/src/lib/dep-check.ts` with `checkPostgres()` (cheap `SELECT 1`), `checkValkey()` (`PING`), `checkLitellm()` (cheap `/health` upstream call with 2s timeout). Each result cached in-process for 5s via `lru-cache` keyed on dep name. Concurrent probes see the cached result; cache expiry triggers a single re-check.

- **D-P3 — Horizontal-scale e2e test.** `tests/e2e/horizontal-scale.test.ts` gated on `E2E=1`. Spawns `docker compose --profile default up --scale api=2` via testcontainers. Adds a tiny Fastify `onSend` hook to attach `x-served-by: ${os.hostname()}` to every response (lives in `apps/api/src/plugins/served-by.ts`). Test flow: (1) signin via Traefik → capture bearer + cookie; (2) hit a session-protected endpoint (`/api/me` or `/api/usage`) 20 times via Traefik round-robin; (3) assert ≥ 1 hit lands on EACH replica's hostname (proves round-robin actually distributes); (4) all 20 return 200 with the same `session.id` (proves session continuity across replicas). Locked: real services per constitutional "no mocks of internal logic".

### BullMQ Tenant-Context Middleware + Queue Inventory (SCALE-03)

- **D-W1 — `withTenantContext(handler)` HOF.** Lives at `apps/worker/src/lib/with-tenant-context.ts`. Signature: `withTenantContext<T extends z.ZodObject>(schema: T, handler: (data: z.infer<T>, ctx: TenantContext) => Promise<void>)`. Implementation:
  1. Parse + validate `job.data` against the Zod schema (must include `tenant_id`).
  2. Acquire pg client from `appOwnerPool`. Begin transaction.
  3. Execute `SET LOCAL app.tenant_id = '${tenant_id}'` (scope = current transaction).
  4. Attach `{tenant_id, request_id, job_id}` to pino MDC for this job's log lines.
  5. Open OTel span (`bullmq.job.<queue>`) with `tenant_id` as attribute.
  6. Invoke handler inside the transaction + span. On success: COMMIT. On failure: ROLLBACK.
  7. Tear down MDC + span in `finally`.

- **D-W2 — `withSystemContext(handler)` escape hatch.** Lives at `apps/worker/src/lib/with-system-context.ts`. For cross-tenant reconciliation jobs (`ingest-litellm-spend`, `reconciliation-daily-check`, `audit-archive`, `partman-maintenance`, `usage-rollup-daily` dispatcher). Does NOT set `app.tenant_id` GUC; runs as `postgres_owner` role which bypasses RLS. Pino MDC tag `mode: 'system'`. CI gate (D-W4) requires explicit opt-in to System mode.

- **D-W3 — Zod-validated job-data schemas.** Per-job schema lives next to the handler (`apps/worker/src/jobs/<queue>/schema.ts`). Tenant jobs require `tenant_id: z.string().uuid()`. System jobs use a different base schema without `tenant_id`. Enqueue site MUST `.parse(data)` before `queue.add(name, data)` — Phase 6 ships a `typedQueue<T>()` wrapper that enforces this at the type system.

- **D-W4 — 3-layer CI introspection gate.**
  1. **Biome custom rule** (`tools/biome-rules/require-tenant-context.ts`) — scans `apps/worker/src/jobs/**/*.ts`, fails if any handler default-export is not wrapped in `withTenantContext(...)` or `withSystemContext(...)`.
  2. **Runtime pg-pool guard** in `apps/worker/src/db/app-pool.ts` — wraps `pool.query` so it executes `SELECT current_setting('app.tenant_id', true)` once per checkout; if null AND caller is not in system-mode (checked via AsyncLocalStorage flag), throws `TenantContextMissingError`. Exercised in integration tests with testcontainer Postgres.
  3. **RLS property test** in `packages/data/src/__tests__/worker-rls-property.test.ts` — enqueues tenant-A and tenant-B jobs concurrently against a real testcontainer Postgres+Valkey; asserts each job reads/writes only its own tenant's rows. Constitutional `TEST-RLS-01` extends to cover the worker tier.

- **D-W5 — Phase 6 BullMQ queue inventory (6 total).**

  | Queue | Cadence | Context | Job Data (Zod) | Enqueue site |
  |---|---|---|---|---|
  | `ingest-litellm-spend` (EXISTING, refactored) | Repeatable 60s | **System** | `{ since: ISO8601 }` | Worker self-schedule on boot |
  | `email-delivery` (NEW) | On-demand | Tenant | `{ tenant_id, to, template_id, locale, variables, request_id }` | Auth routes (verify-email, reset-password), admin invites |
  | `usage-rollup-daily` (NEW) | Cron `5 0 * * *` UTC | System dispatcher → Tenant children | dispatcher: `{ date }`; children: `{ tenant_id, date }` | Worker scheduler dispatches per-tenant children |
  | `virtual-key-rotation` (NEW) | Cron `0 3 * * 0` weekly + on-demand | Tenant | `{ tenant_id, user_id, reason: 'scheduled'\|'compromised'\|'manual' }` | Scheduler + `apps/api/src/routes/admin/keys/rotate.ts` |
  | `reconciliation-daily-check` (NEW) | Cron daily | System | `{ window_start: ISO, window_end: ISO }` | Worker scheduler |
  | `reconciliation-discrepancy` (NEW) | On-demand (child of `reconciliation-daily-check` or `ingest-litellm-spend`) | Tenant | `{ tenant_id, since: ISO, until: ISO, drift_pct, drift_usd_cents }` | Parent job dispatches per-tenant child |
  | `partman-maintenance` (NEW) | Cron daily | System | `{}` (no payload) | Worker scheduler |
  | `audit-archive` (NEW) | Cron monthly | System | `{ partition_name }` | Worker scheduler after partman detach |

  Audit-log fanout queue was **removed** from the inventory — audit writes are sync (D-A1).

### Rate-Limit Policy Matrix (SCALE-04)

- **D-RL1 — Layered IP + user keying.** `@fastify/rate-limit` v10 registered twice in `apps/api/src/plugins/rate-limit.ts`:
  - **Global IP-tier** — `keyGenerator: req => req.ip`, ceiling ~600/min/IP (DoS shield). Same Valkey store as Phase 2.
  - **Per-route user-tier** — overrides on each route, `keyGenerator: req => req.session?.userId ?? req.ip` (auto-degrades to IP for unauthenticated). Per-route rpm budgets in D-RL2.
  - 429 fires when EITHER counter is exhausted. ~0.4ms latency added per request (two Valkey GETs).

- **D-RL2 — Per-route rpm matrix (locked, env-overridable).** Numbers calibrated by cost profile; env vars in `apps/api/src/config/rate-limits.ts` so Phase 8 k6 tuning is a config change, not a code change.

  | Route group | rpm/user | rpm/IP | Keying | Rationale |
  |---|---|---|---|---|
  | `/api/health`, `/livez`, `/readyz`, `/startupz` | unlimited | unlimited | skip | Probes; already skipped in Phase 2 |
  | `/api/auth/signin`, `/api/auth/signup`, `/api/auth/forgot-password` | n/a | **10/min/IP** | IP only | Abuse target; tight pre-auth ceiling |
  | `/api/auth/verification-status` | n/a | **30/min/(IP,email)** | composite (Phase 2 D-* carve-out — kept) | 5s client polling |
  | `/api/usage`, `/api/me`, `/api/tenants/current` | 120/min/user | 600/min/IP | layered | Poll-tolerant lightweight reads |
  | `/api/transcribe` | **20/min/user** | 60/min/IP | layered | Expensive (3-30s + file upload) |
  | `/api/reason` | **30/min/user** | 90/min/IP | layered | LLM call; cheaper than transcribe |
  | `/api/agent/stream` (NDJSON) | **10/min/user** | 30/min/IP | layered | Long-lived; catches reconnect storms |
  | `/api/agent/web-search` | 30/min/user (Phase 5 D-07 kept) | 90/min/IP | layered | |
  | `/api/{notes,folders,conversations,transcriptions}/{create,update,delete}` | 60/min/user | 300/min/IP | layered | Normal CRUD |
  | `/api/{notes,folders,...}/list`, `/search` | 120/min/user | 600/min/IP | layered | Read-heavy |
  | `/api/{notes,...}/batch-*` | **20/min/user** | 60/min/IP | layered | Each call = N records; treat as expensive |
  | `/api/v1/keys/create` | **5/min/user** | 20/min/IP | layered | Sensitive; key minting rare |
  | `/api/v1/keys/{list,revoke}` | 30/min/user | 90/min/IP | layered | Admin-tier |
  | `/api/admin/*` | 60/min/user | 300/min/IP | layered | Console UX |

- **D-RL3 — 429 envelope.** Keep Phase 2 shape `{error: "Too many requests"}` + `Retry-After`. **Add** standard rate-limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (per IETF `ratelimit-headers` draft / OWASP API4:2023). `@fastify/rate-limit` emits these natively when `addHeaders` is enabled. Headers report the user-tier limit (more actionable for clients); IP-tier remains internal-only.

- **D-RL4 — Per-tenant budgets — NOT in v1.** Per-user is sufficient. Per-tenant breaks the "1 user shouldn't lock 99 colleagues" intuition. Revisit if Phase 8 surfaces tenant-level abuse patterns.

### SSRF Defense

- **D-S1 — Global undici Dispatcher with SSRF interceptor.** Lives at `apps/api/src/lib/ssrf-dispatcher.ts`. Registered as the process-wide undici global dispatcher via `setGlobalDispatcher(...)` in `apps/api/src/bootstrap.ts` (before any route registration). Covers EVERY transitive `fetch()` call — Better Auth OIDC redirects, LiteLLM, Tavily/Yandex, pyannote.ai, future user-URL-fetching features.

- **D-S2 — Single-resolve-then-connect-by-IP.** Interceptor flow per outbound request:
  1. Parse target URL → extract hostname.
  2. Check hostname against `OUTBOUND_ALLOWED_HOSTS` allow-list (with `*.wildcard` support). Reject early if not allowed.
  3. Single DNS resolve via `dns.promises.lookup(host, {all: true})`.
  4. Check EACH resolved IP against the block-list (D-S3). Reject if any matches AND host is not in `OUTBOUND_PRIVATE_HOST_ALLOWLIST`.
  5. Connect by **resolved IP** (NOT re-resolve), with `Host: <original-hostname>` header preserved for TLS SNI + virtual hosting. This collapses check-and-connect into one resolve → closes DNS-rebinding TOCTOU.

- **D-S3 — Default block-list (hardcoded, default-deny).**
  - IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (**includes 169.254.169.254 AWS IMDSv1 — mandatory for AWS-ready posture**), `0.0.0.0/8`, `100.64.0.0/10` (CGNAT), `224.0.0.0/4` (multicast).
  - IPv6: `::1/128`, `fc00::/7` (ULA), `fe80::/10` (link-local), `::ffff:0:0/96` (IPv4-mapped — re-check unwrapped), `fd00:ec2::/32` (AWS IMDS IPv6).

- **D-S4 — Env-driven allow-list scheme.**
  ```bash
  OUTBOUND_ALLOWED_HOSTS=openrouter.ai,api.tavily.com,search-api.aistudio.yandex.ru,api.pyannote.ai,litellm,*.amazonaws.com
  # Comma-separated. Leading-wildcard '*.domain.tld' matches one+ left labels.
  # Bare hostnames match exactly. Default value for fresh `git clone`:
  # openrouter.ai,api.tavily.com,search-api.aistudio.yandex.ru,api.pyannote.ai,litellm,speaches,mailpit

  OUTBOUND_PRIVATE_HOST_ALLOWLIST=litellm,speaches,mailpit,valkey,postgres,pgbouncer
  # Hosts permitted to resolve to RFC1918/loopback IPs (docker-compose service
  # names + corp internal LiteLLM). Empty in production-like deploys.

  OUTBOUND_ALLOW_LOOPBACK=0    # 1 in dev/test for testcontainers; 0 in prod
  OUTBOUND_SSRF_MODE=enforce   # enforce | warn (warn = log + audit only, no 502)
  ```

- **D-S5 — Violation response.** HTTP 502 `{error: "Upstream blocked by SSRF policy", request_id}` to the client (we tried to call upstream and the gate refused). Structured WARN log: `event: ssrf.block`, `host`, `resolved_ip`, `route`, `user_id`, `request_id`. `audit_log` row with `action: security.ssrf_blocked` (matches D-A6 #18) + payload `{target_url_host, rule}`. `OUTBOUND_SSRF_MODE=warn` skips the 502 (request proceeds) but still logs + audits — useful for one-shot rollout to discover unknown legitimate hosts before enforcement.

- **D-S6 — Dev/test loopback opt-in.** `NODE_ENV !== 'production' && OUTBOUND_ALLOW_LOOPBACK=1` permits 127.0.0.1 + ::1 for testcontainers, Mailpit, local Valkey. Production deployments leave `OUTBOUND_ALLOW_LOOPBACK=0` and rely on `OUTBOUND_PRIVATE_HOST_ALLOWLIST` for docker-compose service names.

### Claude's Discretion

- Exact pg_partman migration scripts (extension provisioning + table-conversion DDL + initial partition seeding) — researcher/planner decision; must be forward-and-rollback CI-verified per Phase 1 D-*. Suggest one dedicated migration for the audit_log conversion + extension enable.
- `lru-cache` vs `node-cache` vs in-house TTL Map for the dep-check cache (D-P2) — researcher decides; constraint is no extra heavy dep.
- Exact Biome custom-rule API surface (D-W4 layer 1) — researcher to verify Biome 2.x extension model; fallback is an eslint custom rule if Biome doesn't ergonomically expose AST walkers.
- Whether `OUTBOUND_SSRF_MODE=warn` should still emit the `security.ssrf_blocked` audit row, OR a different action like `security.ssrf_warned` — researcher to align with operator runbook expectations; default: same action, payload tagged `mode: 'warn'`.
- Choice of `aws_s3.query_export_to_s3` vs `COPY ... TO PROGRAM 'aws s3 cp -'` for the audit-archive job (D-A3) — researcher benchmarks; favor the extension where available, shell fallback otherwise.
- The exact e2e test entrypoint for the horizontal-scale test (D-P3) — researcher decides between testcontainers driving docker-compose vs a dedicated `make e2e-test-scale` target. Constraint: must be CI-runnable.

### Folded Todos

None — `/gsd-add-todo` system did not surface relevant matches at discussion time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative requirements + roadmap
- `.planning/ROADMAP.md` §"Phase 6: Observability + Ops Hardening + Workers" (lines 409-422) — phase goal + 7 success criteria.
- `.planning/REQUIREMENTS.md` — OBS-01..05, DATA-04, SCALE-01, SCALE-03, SCALE-04 acceptance criteria. WIRE-traceability table lines 271-275, 249, 264-267.
- `.planning/PROJECT.md` — core value, English-only source rule, polling carve-out for /api/auth/verification-status (line 51, 112).

### Prior phase context (decisions Phase 6 depends on or mirrors)
- `.planning/phases/01-core-infra-multi-tenant-data/01-CONTEXT.md` — RLS, `app.tenant_id` GUC, tenant-context middleware, audit_log schema origin, RLS-introspection lint, migration-forward-and-rollback discipline.
- `.planning/phases/02-auth-wire-api-skeleton-conformance-harness/02-CONTEXT.md` — global error envelope, dual-auth, `@fastify/rate-limit` plugin baseline, polling carve-out for verification-status, CONTRACT-01 conformance.
- `.planning/phases/03-litellm-integration-bundled-oss-models/03-CONTEXT.md` — usage_ledger + LiteLLM spend ingest pattern (Layer 1 + Layer 2 of D-R1).
- `.planning/phases/04-streaming-realtime/04-CONTEXT.md` — D-18 missing-key 503 pattern, D-19 rate-limit pattern, D-20 undici 3s/5s timeout pattern (Phase 6 SSRF gate respects these).
- `.planning/phases/05-operational-endpoints/05-CONTEXT.md` — D-07 web-search 30/min/user (kept in Phase 6 RL matrix), D-31 RLS-on-every-new-table extends to worker tier.
- `.planning/phases/06.1-add-tempo-mimir-minimal-filesystem-backed-configs-both-crash/06.1-CONTEXT.md` — D-01 filesystem-backed Tempo/Mimir backends (locked), D-02 distroless-image probe limitations, D-04 `otlphttp/loki` exporter (Phase 6 log correlation depends on this pipeline).

### Existing code Phase 6 extends or refactors
- `apps/api/src/health.test.ts` + `apps/api/src/index.ts` — existing `/api/health` endpoint; Phase 6 keeps as alias, adds `/livez` `/readyz` `/startupz`.
- `apps/api/src/middleware/tenant.ts` — request-tier tenant-context HOF pattern that `withTenantContext` mirrors on the worker tier.
- `apps/api/src/plugins/rate-limit.ts` — Phase 2 Plan 04 baseline; Phase 6 extends with layered keying + per-route rpm matrix + standard headers.
- `apps/api/src/error-handler.ts` + `apps/api/src/errors.ts` — global envelope; Phase 6 routes SSRF 502 through this.
- `apps/worker/src/index.ts` — BullMQ Worker entrypoint with SIGTERM/SIGINT graceful drain; Phase 6 adds the 5 new queues.
- `apps/worker/src/jobs/ingest-litellm-spend.ts` — existing recurring job; Phase 6 wraps in `withSystemContext()` (single-line change at default export).
- `apps/worker/src/db/{app-pool,litellm-pool}.ts` — pg.Pool wrappers; Phase 6 adds the runtime tenant-context guard at the `app-pool.ts` layer.
- `packages/data/src/schema/audit_log.ts` — append-only table schema; Phase 6 adds CHECK constraint on `action` + converts to monthly RANGE partitioned parent.
- `packages/data/src/schema/usage_ledger.ts` — Layer 1 + Layer 2 sink; Phase 6 reconciliation reads it.
- `compose/otel-collector/config.yaml` — already wires traces → Tempo, logs → Loki via `otlphttp`, metrics → Mimir via `prometheusremotewrite` with `X-Scope-OrgID: openwhispr`.
- `compose/{tempo,mimir,grafana,loki}/` — datasource configs (filesystem-backed per 06.1 D-01).

### Reference docs
- pg_partman:
  - https://www.crunchydata.com/blog/auto-archiving-and-data-retention-management-in-postgres-with-pg_partman — overview.
  - https://aws.amazon.com/blogs/database/archive-and-purge-data-for-amazon-rds-for-postgresql-and-amazon-aurora-with-postgresql-compatibility-using-pg_partman-and-amazon-s3/ — AWS pattern, S3 archive flow.
  - https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_Partitions.html — RDS-supported usage.
- Kubernetes probes:
  - https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ — canonical probe semantics.
  - https://dev.to/young_gao/kubernetes-health-probes-done-right-liveness-readiness-and-startup-5g7g — 2026 best practices.
- LiteLLM observability:
  - https://docs.litellm.ai/docs/proxy/prometheus — Prometheus metrics (NOT used directly per D-T6; Loki ingest of container logs is the surface).
  - https://docs.litellm.ai/docs/proxy/cost_tracking — spend tracking.
  - https://github.com/BerriAI/litellm/issues/26611 — divergence failure modes (motivates dual-axis reconciliation D-R2).
- Rate-limit + SSRF:
  - https://github.com/fastify/fastify-rate-limit — `@fastify/rate-limit` v10 API + standard headers.
  - https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md — undici Dispatcher API (basis for D-S1 SSRF interceptor).
  - https://github.com/nodejs/undici/issues/2019 — undici SSRF protection discussion.
  - https://github.com/azu/request-filtering-agent — block-list ranges reference (re-implemented as undici interceptor per D-S1).
  - https://cvereports.com/reports/CVE-2026-27127 — DNS-rebinding SSRF bypass (motivates single-resolve D-S2).
  - https://advisories.gitlab.com/golang/github.com/gotenberg/gotenberg/v8/CVE-2026-42592/ — DNS rebinding pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/plugins/rate-limit.ts` — Valkey-backed `@fastify/rate-limit` v10 plugin. Phase 6 extends with layered keying + per-route rpm config object (not a rewrite).
- `apps/api/src/middleware/tenant.ts` — request-tier tenant-context HOF. Direct analogue for the worker-tier `withTenantContext`. Same mental model.
- `apps/worker/src/index.ts` — BullMQ Worker with graceful SIGTERM/SIGINT drain via `worker.close()+queue.close()+pool.end()+redis.quit()`. Phase 6 follows this skeleton for all 5 new queues.
- `apps/worker/src/jobs/ingest-litellm-spend.ts` — idempotent `ON CONFLICT (request_id) DO NOTHING` pattern (Phase 3); Phase 6 backfill (D-R3) reuses this job verbatim with explicit `since`/`until` args.
- `apps/worker/src/db/{app-pool,litellm-pool}.ts` — `pg.Pool` wrappers; Phase 6 adds the runtime tenant-context guard at `app-pool.ts`.
- `packages/data/src/schema/audit_log.ts` — already-defined append-only schema (Phase 1). Phase 6 ADDS: CHECK constraint on `action` enum, conversion to monthly RANGE partitioned parent, S3-archive job.
- `compose/otel-collector/config.yaml` — already wires traces/logs/metrics; Phase 6 adds OTel SDK on the API side to publish into it.
- `compose/{tempo,mimir,loki,grafana}/` — datasources + filesystem-backed configs (06.1 locked); Phase 6 adds Grafana dashboard JSON for RED + saturation + per-tenant usage + LiteLLM spend + reconciliation drift.

### Established Patterns
- **Tenant context propagation** — request-tier via Fastify `onRequest` hook setting `app.tenant_id` GUC (Phase 1 D-* + Phase 2 D-*). Worker-tier MIRRORS this pattern via `withTenantContext` HOF + `SET LOCAL` inside a transaction.
- **Error envelope** — global Fastify error handler emits `{error: string}` (Phase 2 D-*). SSRF 502 + 429 envelope routes through this. Audit/rate-limit/SSRF events also emit a corresponding `audit_log` row.
- **Idempotency on retry** — `ON CONFLICT (request_id) DO NOTHING` everywhere (Phase 3 usage_ledger pattern, Phase 5 client-id pattern). Reconciliation backfill (D-R3) leverages this.
- **Migration discipline** — Drizzle migrations in `packages/data/migrations/`, linear sequencing, forward-and-rollback CI-verified (Phase 1 D-*). Phase 6 adds 1-2 migrations (pg_partman + audit_log conversion + rate-limit config tables if needed).
- **Recurring BullMQ jobs** — existing `ingest-litellm-spend` uses `queue.upsertJobScheduler()` (Phase 3); Phase 6's 4 new recurring jobs follow the same pattern.

### Integration Points
- `apps/api/src/index.ts` — Fastify app builder. Phase 6 hooks: OTel SDK init at the top, SSRF Dispatcher install before route registration, three new probe routes registered alongside `/api/health`, `x-served-by` `onSend` hook for scale test.
- `apps/api/src/plugins/request-log.ts` — pino integration. Phase 6 adds `redact` paths config + ensures `@opentelemetry/instrumentation-pino` is in the load order.
- `apps/api/src/middleware/{dual-auth,tenant,require-cookie-only}.ts` — existing chain. Phase 6 doesn't modify; rate-limit + SSRF gates sit BEFORE these in the request lifecycle.
- `apps/api/src/error-handler.ts` — global envelope. Phase 6 adds SSRF 502 + audit_log emission for rate-limit 429 and SSRF blocks.
- `apps/worker/src/index.ts` — Worker entrypoint. Phase 6 registers the 5 new BullMQ queues + workers here.
- `packages/data/src/seed/conformance.ts` — contract-test fixtures (Phase 2 D-*). Phase 6 extends with audit_log fixture rows.
- `tools/lint-rls.ts` — RLS-introspection lint (Phase 1 D-*). Phase 6 MUST keep green after audit_log partitioning + extends to assert the partitioned children inherit RLS.
- `tests/e2e/` — Phase 6 adds: `horizontal-scale.test.ts`, `ssrf-block.test.ts`, `audit-log-write.test.ts`, `reconciliation-drift.test.ts`, `log-scrub-sentinel.test.ts`.

</code_context>

<specifics>
## Specific Ideas

- **"LiteLLM stays on its own side, we stay on ours" (user steering, paraphrased)** — opaque sidecar treatment is non-negotiable. No instrumentation inside LiteLLM, no W3C traceparent across the boundary, no patches. Reconciliation works on the spend-log table (already in Phase 3) plus Loki container-log ingest. This is the locked architectural posture for the entire AI-plane interaction in v1.
- **AWS-ready enterprise stack** — every Phase 6 pick optimizes for EKS/ECS portability: pg_partman is RDS/Aurora-native; OTel Collector → Mimir/Tempo/Loki maps to AWS Managed Grafana + Managed Prometheus; SSRF 169.254.169.254 block is mandatory because EKS pods can hit it by default with IMDSv1; kubelet-canonical /livez /readyz /startupz aligns with what every Helm chart and AWS load balancer expects. No exotic agents, no Datadog-style proprietary.
- **JSON logs everywhere** — pino JSON canonical. No pretty-print in production paths. Every log line includes `trace_id`, `span_id`, `tenant_id` (when in tenant context), `request_id`, English-only keys. Operator never has to grep plaintext.
- **"Prometheus metrics, no duplicated functionality" (user steering)** — single metrics path: OTel SDK → Collector → `prometheusremotewrite` → Mimir. NO `/metrics` Prom-pull endpoint on the API. NO dual instrumentation paths for the same signal.
- **Sync writes for safety-critical paths** — both `usage_ledger` (Layer 1 in handler) and `audit_log` are written synchronously. Async fanout for these would create a lost-event window during Redis/worker outage, which the project's enterprise posture cannot tolerate. The BullMQ tier is for jobs that genuinely tolerate eventual completion (email delivery, reconciliation, rollups).
- **Real services everywhere in tests** — constitutional rule. Phase 6 e2e adds `horizontal-scale.test.ts` with `docker compose --scale api=2`, `ssrf-block.test.ts` exercising the real undici Dispatcher against a private-IP target, `audit-log-write.test.ts` against real Postgres + pg_partman extension. No mocks of internal logic.

</specifics>

<deferred>
## Deferred Ideas

- **`GET /api/admin/audit-log` read API** — deferred to Phase 7 (UI build pulls forward) or v2. Operators query via psql / Grafana Postgres datasource in the meantime.
- **`audit-log-fanout` BullMQ queue** — sync writes were chosen. Revisit only if audit-log write latency becomes a hot-path bottleneck (would need an outbox-table pattern to preserve no-loss guarantee).
- **Tail-based trace sampling at the OTel Collector** — defer until storage pressure shows up. Tempo's filesystem backend handles always-on 100% at 1000-user scale.
- **Per-tenant rate-limit budgets** — per-user sufficient for v1. Revisit if Phase 8 surfaces tenant-level abuse patterns.
- **Trace-context propagation INTO LiteLLM** — opaque-sidecar posture is locked. Revisit only if LiteLLM upstream adds first-class OTel propagation that doesn't require patching.
- **W3C `Sec-CH-UA-*` client hints in audit_log.payload.user_agent** — current design uses the raw `user-agent` string truncated to 512 chars. Future enhancement.
- **Operator-supplied custom block-list ranges for SSRF** (e.g., corporate intranet 10.10.0.0/16) — current design hardcodes the standard list. Add `OUTBOUND_EXTRA_BLOCKLIST_CIDRS=...` env if real demand surfaces.
- **Audit-log retention longer than 13 months hot + S3 archive forever** — if compliance demands longer hot retention, operator overrides pg_partman retention env. Default targets SOC2/GDPR-typical 12-month-hot windows.
- **Operator console UI for audit log, reconciliation drift dashboard, rate-limit visibility** — Phase 7.
- **i18n of operator-visible 429 / 502 / audit-event copy** — Phase 10 i18n phase.
- **`/api/admin/tenants/:id/rate-limits` runtime config endpoint** — current design is env-driven static config. Runtime mutation deferred to v2.
- **OpenTelemetry log SDK (replace pino transport with OTel logs SDK direct)** — current design pipes pino → stdout → OTel Collector filelog receiver. Direct OTel log SDK is more idiomatic but the pino transport is the boring 2026 pick.
- **Mutation testing (Stryker) on the SSRF dispatcher + rate-limit keying** — already in scope for auth/multi-tenancy per Phase 0; Phase 6 may add these modules to the Stryker target list if budget permits.

### Reviewed Todos (not folded)
None — `/gsd-add-todo` system did not surface relevant matches at discussion time.

</deferred>

---

*Phase: 06-observability-ops-hardening-workers*
*Context gathered: 2026-05-11*
*Discussion mode: advisor-assisted (3 parallel research agents on the gray-area clusters)*
