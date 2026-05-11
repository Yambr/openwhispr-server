# Phase 6: Observability + Ops Hardening + Workers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 06-observability-ops-hardening-workers
**Mode:** advisor-assisted (3 parallel `gsd-advisor-researcher` agents on Clusters 2/3/4)
**Areas discussed:** Telemetry (OTel + scrubbing), Audit + LiteLLM reconciliation, Probes + BullMQ middleware, Rate-limit + SSRF
**Response language:** Russian (user-facing prompts); English (artifact)

---

## Free-text steering captured before cluster discussion

User answered the gray-area selection question with an additional free-text directive that established meta-decisions applied across all clusters:

> [User's original directive was in Russian; paraphrased to English for the source artifact:] "LiteLLM stays on its own side, we stay on ours. Standard enterprise, AWS-ready stack. JSON logs. Prometheus metrics, perhaps something else but no duplicated functionality."

Interpreted as locked meta-decisions:
- **D-T5** — LiteLLM is opaque sidecar (no instrumentation inside; no W3C traceparent across boundary; reconcile via spend-log table + Loki container-log ingest).
- **D-T7** — AWS-ready enterprise stack (LGTM via OTel Collector; pg_partman for retention; kubelet-canonical probes).
- **D-T7** — pino JSON logs canonical, no pretty-print in production paths.
- **D-T6** — Single metrics path: OTel SDK → Collector → `prometheusremotewrite` → Mimir. NO duplicate `/metrics` Prom-pull endpoint.

---

## Cluster 1: Telemetry (OTel scope + log correlation + scrubbing)

### OTel auto-instrumentation scope (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| BullMQ jobs | Auto-instrument every BullMQ job as a span; critical for forensics | ✓ |
| Better Auth (manual spans) | Wrap BA handlers in manual spans (no auto-instrumentation available) | ✓ |
| Drizzle | Adds spans on top of `pg` instrumentation — produces duplicate signals | (rejected per no-duplication steering) |
| DNS + filesystem | High volume, low signal | (rejected) |

**User's choice:** BullMQ jobs + Better Auth manual spans. Skip Drizzle (dup of pg). Skip DNS/fs (noise).

### Trace sampling

| Option | Description | Selected |
|--------|-------------|----------|
| Always-on 100% in v1 | Tempo filesystem backend handles 1000-user scale; simplest model; revisit at Phase 8 | ✓ |
| Head sampling 10% + always-on errors | SDK-level decision before knowing if span errored; awkward |  |
| Tail sampling at Collector | More memory pressure; overkill v1 |  |

**User's choice:** Always-on 100%. Revisit at Phase 8.

### Pino ↔ OTel log correlation

| Option | Description | Selected |
|--------|-------------|----------|
| `@opentelemetry/instrumentation-pino` | Auto-injects trace_id/span_id/trace_flags into pino records; zero per-handler instrumentation | ✓ |
| Manual context.active() in handlers | Explicit but easy to drift |  |
| Skip correlation in v1 | Loses LGTM killer feature (click trace → see logs) |  |

**User's choice:** `@opentelemetry/instrumentation-pino`.

### Log scrubbing

| Option | Description | Selected |
|--------|-------------|----------|
| Pino `redact` paths (primary) | Runs at source before serialization; even crashes scrubbed; sentinel-token sweep test | ✓ |
| OTel Collector-side processor | Raw secrets exist briefly in stdout before Collector reads — host-side log capture (CloudWatch) leaks |  |
| Both (pino primary + OTel backstop) | Defense-in-depth; doubles config maintenance |  |

**User's choice:** Pino `redact` paths at source.

---

## Cluster 2: Audit log + LiteLLM reconciliation

**Advisor consulted:** `gsd-advisor-researcher` (background agent a509daf5275887f88).

### Audit log write path + retention

Advisor research presented 4 options across sync vs async, partitioning, archive, and read-API.

| Option | Description | Selected |
|--------|-------------|----------|
| Sync in-band + pg_partman monthly partitions + S3 archive + NO read API in v1 | Preserves transactional "event happened iff audit row exists"; AWS RDS/Aurora-supported; BullMQ cron absorbs maintenance + archive | ✓ |
| Async fanout via BullMQ `audit-log-fanout` queue | Lost-event window during Redis/worker outage; conflicts with DATA-04 no-loss expectation |  |
| Sync + partitioned + add `GET /api/admin/audit-log` read API in v1 | Pulls Phase 7 UI work forward; not blocked-by |  |

**User's choice:** Sync in-band + pg_partman + S3 archive, no read API in v1.

### Action taxonomy

Advisor proposed 18 canonical `action` values (auth.signin, auth.signin_failed, auth.signout, auth.password_change, auth.oauth_link, account.delete, account.delete_requested, key.issued, key.revoked, settings.tenant_changed, settings.user_changed, admin.tenant_created, admin.tenant_suspended, admin.user_impersonated, admin.role_changed, security.cross_tenant_attempt, security.rate_limit_exceeded, security.ssrf_blocked) plus payload conventions.

| Option | Description | Selected |
|--------|-------------|----------|
| Lock all 18 as canonical | Full SOC2-aligned coverage; const-union + DB CHECK | ✓ |
| Lock 12 minimum, defer 6 to v1.1 | Loses RL/SSRF cross-cluster integration (those events are emitters in cluster 4) |  |
| Different list | Free text |  |

**User's choice:** Lock all 18.

### LiteLLM spend reconciliation alerting

| Option | Description | Selected |
|--------|-------------|----------|
| Tolerance-based dual-axis Mimir alert | 0.5% rows AND $0.01 USD over 24h; bounded cardinality on active tenants; backfill via existing idempotent ingest | ✓ |
| Exact-match → Grafana alert | 30s ingest cadence creates boundary-flush false positives every run |  |
| Loki WARN log + LogQL alert rule | Splits alerting surface (RED on Mimir, this on Loki) — fragmented operator runbook |  |

**User's choice:** Tolerance-based dual-axis Mimir alert with idempotent backfill.

---

## Mid-discussion clarification: usage_ledger write design

User asked:
> [Paraphrased to English:] "ingest-litellm-spend (already exists, Phase 3) — doesn't LiteLLM itself return that? In every response?"

Claude explained the three-layer write path:
1. Sync in handler from LiteLLM response headers/body (`x-litellm-response-cost`, `usage.{prompt,completion,total}_tokens`) — fresh data in /api/usage instantly.
2. Async BullMQ `ingest-litellm-spend` recurring 60s reads `LiteLLM_SpendLogs` from LiteLLM's co-tenant Postgres — catches what Layer 1 missed (handler crash between response and write).
3. Phase 6 daily reconciliation tolerates drift, alerts on threshold breach, backfills via Layer 2 idempotency.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep three-layer design (sync + async ingest + daily reconciliation) | Fresh data in /api/usage; no-loss guarantee; client BACKEND_SPEC requires wordsUsed in response | ✓ |
| Async-only (BullMQ ingest) | 30-60s lag in /api/usage; breaks BACKEND_SPEC wordsUsed contract |  |
| Sync-only (no BullMQ ingest) | Handler crash = lost row; no source of truth except LiteLLM billing — bad for operator |  |

**User's choice:** Keep three-layer design.

---

## Cluster 3: Probes + horizontal-scale verification + BullMQ tenant-context

**Advisor consulted:** `gsd-advisor-researcher` (background agent aef574d998745e805).

### Health probe contract

| Option | Description | Selected |
|--------|-------------|----------|
| Three dedicated endpoints `/livez` + `/readyz` + `/startupz`, cached dep checks, `/api/health` retained as alias | Kubelet-canonical; livez has NO dep checks (antipattern non-negotiable); 2-5s cache prevents thundering herd | ✓ |
| Single `/api/health?depth=...` query param | Non-idiomatic for kubelet probe specs |  |
| Separate probe HTTP server on port 9090 | Over-engineered for 1000 concurrent target |  |

**User's choice:** Three dedicated probes with cached dep checks.

### Horizontal-scale verification test

| Option | Description | Selected |
|--------|-------------|----------|
| Scaled-compose e2e with `x-served-by` response header | Real services + real Traefik + os.hostname() to prove BOTH replicas serve; constitutional "no mocks of internal logic" | ✓ |
| Testcontainer in-process replica test | Skips real Traefik load-balancer path + compose networking reality |  |
| Manual operator runbook only | Violates "maximum test automation, no human QA" constitutional rule |  |

**User's choice:** Scaled-compose e2e with x-served-by header.

### BullMQ tenant-context middleware

| Option | Description | Selected |
|--------|-------------|----------|
| `withTenantContext(handler)` HOF + Zod schema + 3-layer CI gate (Biome rule + runtime pg-pool guard + RLS property test) | Mirrors api/middleware/tenant.ts; explicit + greppable; defense-in-depth via runtime guard | ✓ |
| `TenantAwareWorker extends Worker` subclass | Hides context boundary; tight BullMQ-internals coupling; awkward mixing system+tenant in one class |  |
| Convention + eslint custom rule only | No defense-in-depth — silent leak on lint regression; violates constitutional RLS isolation tests rule |  |

**User's choice:** `withTenantContext` HOF + 3-layer CI gate.

### BullMQ queue inventory

| Option | Description | Selected |
|--------|-------------|----------|
| 5 new + 1 existing (email-delivery, usage-rollup-daily, virtual-key-rotation, reconciliation-discrepancy, reconciliation-daily-check + existing ingest-litellm-spend refactored to System mode; audit-log queue REMOVED per Cluster 2 sync choice) |  | ✓ |
| Add audit-log fanout anyway (defense-in-depth) | Conflicts with Cluster 2 sync decision |  |
| Different inventory | Free text |  |

**User's choice:** 5 new + 1 existing (no audit-log fanout). Note: planner adds `partman-maintenance` + `audit-archive` system jobs derived from Cluster 2 D-A3/D-A4 — these emerged as derived inventory from the pg_partman decision, not the original 5.

---

## Mid-discussion human-language explanation

After Cluster 3 questions completed, user said:
> [Paraphrased to English:] "I really didn't get what that was about, but ok."

Claude provided a Russian-language plain-text recap of all Cluster 3 decisions (probes, horizontal-scale test, withTenantContext, queue inventory) explaining each in non-jargon terms before continuing to Cluster 4. User then continued to Cluster 4 after the recap.

---

## Cluster 4: Rate-limit policy + SSRF defense

**Advisor consulted:** `gsd-advisor-researcher` (background agent a547058693eacedc5).

### Rate-limit keying strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Layered IP + user (Cloudflare/Stripe pattern) | Two counters in Valkey; ~0.4ms latency; both DoS and per-user-fairness covered | ✓ |
| Per-user only | No pre-auth shield; one compromised user can DoS pre-auth surface |  |
| Per-IP only (current baseline) | Unfair under NAT; 1000 corp users share one IP |  |
| Composite `${userId}:${ip}` single key | Worst-of-both — abuser rotates IP OR user resets bucket |  |

**User's choice:** Layered IP + user keying.

### Per-route rpm matrix

Advisor proposed: signin/signup 10/min/IP; transcribe 20/min/user; reason 30/min/user; web-search 30/min/user (kept from Phase 5); CRUD writes 60/min/user; reads 120/min/user; batch-* 20/min/user; keys/create 5/min/user. All in `apps/api/src/config/rate-limits.ts` env-overridable constants.

| Option | Description | Selected |
|--------|-------------|----------|
| Accept proposed matrix | Calibrated to cost profile; Phase 8 k6 tunes env values | ✓ |
| Tighter (transcribe 10/min, reason 15/min, etc) | Risks pilot-user friction |  |
| Looser (transcribe 40/min, etc) | More LiteLLM cost exposure pre-Phase-8 |  |

**User's choice:** Accept proposed matrix.

### SSRF gate placement

| Option | Description | Selected |
|--------|-------------|----------|
| Global undici Dispatcher with SSRF interceptor | Default-on; covers every transitive fetch; single resolve → connect-by-IP closes DNS-rebinding TOCTOU; 169.254.169.254 blocked by default | ✓ |
| `safeFetch()` wrapper module | Opt-in — forgotten import = silent bypass; doesn't cover transitive (Better Auth, SDK libs) |  |
| `request-filtering-agent` npm package | http.Agent, not undici Dispatcher — fetch() bypasses it |  |

**User's choice:** Global undici Dispatcher.

### SSRF allow-list + violation response

| Option | Description | Selected |
|--------|-------------|----------|
| ENV `OUTBOUND_ALLOWED_HOSTS` with `*.wildcard` support + `OUTBOUND_PRIVATE_HOST_ALLOWLIST` for compose service names + `OUTBOUND_SSRF_MODE=enforce\|warn` + 502 envelope + WARN log + audit_log `security.ssrf_blocked` | Operator can roll out in `warn` mode first to discover legitimate hosts; aligns with audit taxonomy from Cluster 2 | ✓ |
| Block-list only, no allow-list | Weaker enterprise posture; future SSRF bug → exfil to any public IP |  |
| Strict allow-list, no wildcards | Operators with `*.amazonaws.com` LiteLLM end up listing hundreds of hosts |  |

**User's choice:** ENV allow-list with wildcards + 502 + audit.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` → "Claude's Discretion" section:
- pg_partman migration scripts (extension provisioning + table conversion + initial seeding) — researcher decides exact migration count/ordering; must be forward+rollback CI-verified.
- `lru-cache` vs `node-cache` vs in-house TTL Map for dep-check cache.
- Biome custom-rule API surface vs eslint fallback for `withTenantContext` linter (D-W4 layer 1).
- Whether `OUTBOUND_SSRF_MODE=warn` audits as `security.ssrf_blocked` with `mode: 'warn'` payload or a separate action.
- `aws_s3.query_export_to_s3` vs `COPY ... TO PROGRAM 'aws s3 cp -'` for audit-archive S3 dump.
- Horizontal-scale e2e entrypoint (testcontainers driver vs `make e2e-test-scale` target).

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section. Highlights:
- `GET /api/admin/audit-log` read API → Phase 7 UI or v2
- `audit-log-fanout` BullMQ queue → only if write latency becomes a bottleneck (would need outbox-table)
- Tail-based trace sampling → defer until storage pressure
- Per-tenant rate-limit budgets → revisit if Phase 8 surfaces tenant-level abuse
- Trace propagation INTO LiteLLM → opaque-sidecar posture locked
- Operator-supplied custom block-list CIDRs → add env if real demand
- Operator console UI for audit/reconciliation/rate-limit → Phase 7
- i18n of 429/502/audit-event copy → Phase 10
- Mutation testing (Stryker) on SSRF dispatcher + rate-limit keying → optional Phase 6 extension if budget permits

---

*Phase: 06-observability-ops-hardening-workers*
*Log date: 2026-05-11*
