# Phase 6: Observability + Ops Hardening + Workers — Research

**Researched:** 2026-05-11
**Domain:** Production-readiness — OTel/pino observability, audit_log partitioning, LiteLLM reconciliation, k8s probes, BullMQ worker tenant-context, layered rate limiting, undici SSRF
**Confidence:** HIGH (CONTEXT.md is unusually complete; ~370 lines locked; six discretion items resolved below)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Telemetry (D-T1..T7)** — Auto-instrument Fastify/undici/pg/ioredis/BullMQ + Better Auth manual spans. Skip Drizzle, DNS, fs. Always-on 100% sampling. pino ↔ OTel correlation via `@opentelemetry/instrumentation-pino` (auto-injects trace_id/span_id). Logs pino→stdout→Collector(filelog)→Loki via `otlphttp` (06.1 D-04 pipeline reused). pino `redact` paths at source — never Collector-side. LiteLLM opaque sidecar — no W3C traceparent crossing; reconcile via spend-log table + Loki. Single metrics path OTel SDK → Collector → `prometheusremotewrite` → Mimir. NO `/metrics` endpoint on API. English-only log keys.

**Audit Log (D-A1..A7)** — Sync in-band INSERT inside route txn (no async fanout). Monthly RANGE partitioning via pg_partman. S3-archive job for detached partitions. partman-maintenance daily cron. NO public read API in v1. 18 canonical action values, CHECK-constrained at DB. Payload conventions locked — `tenant_id`, `actor_user_id`, `created_at`, `payload.request_id`, `payload.ip` (or null if AUDIT_REDACT_IP=true), `payload.user_agent` (truncated 512). Per-action required keys. Raw secrets forbidden in payload (pino redact enforces).

**Reconciliation (D-R1..R3)** — Three-layer ledger: sync handler, async 60s ingest, daily reconciliation. New BullMQ job `reconciliation-daily-check`. Emits `litellm_reconciliation_drift_pct{tenant_id}` + `litellm_reconciliation_drift_usd_cents{tenant_id}`. Grafana alert on `drift_pct>0.5 OR drift_usd_cents>1` over 24h. Backfill via existing `ingest-litellm-spend` with explicit since/until — idempotent on request_id. Thresholds env-overridable.

**Probes + Scale (D-P1..P3)** — Three dedicated probes `/livez` (no deps) + `/readyz` (Postgres+Valkey+LiteLLM, 2-5s cache) + `/startupz` (migrations+pool warm). `/api/health` retained as `/livez` alias. New `apps/api/src/lib/dep-check.ts`. Horizontal-scale e2e via `docker compose --scale api=2` + Traefik round-robin + `x-served-by` header from `os.hostname()`. 20 round-trip hits, ≥1 each replica, all 200, same `session.id`.

**Workers (D-W1..W5)** — `withTenantContext<T>` HOF wraps Zod schema → pg client → `SET LOCAL app.tenant_id` (transaction-scoped) → pino MDC → OTel span. `withSystemContext` escape hatch runs as `postgres_owner` (bypasses RLS). Per-job Zod schemas; enqueue site type-enforced via `typedQueue<T>()`. 3-layer CI gate: Biome rule + runtime pg-pool guard (`current_setting('app.tenant_id', true)`) + RLS property test. 6 queues total: `ingest-litellm-spend` (refactored→System) + `email-delivery` + `usage-rollup-daily` (system dispatcher + per-tenant children) + `virtual-key-rotation` + `reconciliation-daily-check` + `reconciliation-discrepancy` + `partman-maintenance` + `audit-archive`.

**Rate Limit (D-RL1..RL4)** — `@fastify/rate-limit` v10 registered twice. Global IP-tier 600/min/IP. Per-route user-tier (`req.session?.userId ?? req.ip`). 429 fires when EITHER counter exhausted. Per-route rpm matrix locked + env-overridable. 429 envelope unchanged + `X-RateLimit-{Limit,Remaining,Reset}` headers added. Polling carve-out `/api/auth/verification-status` 30/min/(IP,email) preserved. No per-tenant budgets in v1.

**SSRF (D-S1..S6)** — Global undici Dispatcher with SSRF interceptor via `setGlobalDispatcher` in `apps/api/src/bootstrap.ts` before route registration. Single-resolve-then-connect-by-IP closes DNS-rebinding TOCTOU. Allow-list with `*.wildcard`. Default block-list locked (RFC1918, loopback, link-local incl. 169.254.169.254, IPv6 ULA, AWS IMDS v6). Env: `OUTBOUND_ALLOWED_HOSTS`, `OUTBOUND_PRIVATE_HOST_ALLOWLIST`, `OUTBOUND_ALLOW_LOOPBACK`, `OUTBOUND_SSRF_MODE` (enforce|warn). 502 + `security.ssrf_blocked` audit row on violation.

### Claude's Discretion (resolved below in Technical Approach)

1. Exact pg_partman migration scripts — D-T1 (Technical Approach §1)
2. `lru-cache` vs `node-cache` vs hand-rolled — D-T2 (§5)
3. Exact Biome custom-rule API — D-T3 (§4)
4. `OUTBOUND_SSRF_MODE=warn` audit action — D-T4 (§7)
5. `aws_s3.query_export_to_s3` vs `COPY ... TO PROGRAM` — D-T5 (§6)
6. e2e horizontal-scale entrypoint — D-T6 (§7)

### Deferred Ideas (OUT OF SCOPE)

`GET /api/admin/audit-log` (→ Phase 7), `audit-log-fanout` queue (sync chosen), tail sampling (→ Phase 8), per-tenant budgets, trace propagation into LiteLLM (locked posture), `Sec-CH-UA-*` client hints, operator custom blocklist CIDRs, retention > 13mo hot, operator UIs (→ Phase 7), i18n of operator-visible copy (→ Phase 10), `/api/admin/tenants/:id/rate-limits` runtime endpoint, OTel logs SDK replacement, Stryker on SSRF/rate-limit (budget-permitting).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | OTel auto-instrumentation for Fastify+undici+pg+ioredis with correlation IDs to LiteLLM | §3 (pino-OTel correlation) + verified pkg versions table — `@opentelemetry/auto-instrumentations-node@0.75.0`, `@opentelemetry/instrumentation-pino@0.63.0` |
| OBS-02 | Prom metrics via OTel Collector + Grafana dashboards | Single-path metrics (D-T6) — OTel SDK → Collector → `prometheusremotewrite` → Mimir; 06.1 pipeline reused; dashboards shipped in-tree |
| OBS-03 | JSON logs to Loki + scrub bearers + correlation IDs + English-only keys | pino `redact` config at source (D-T4) + sentinel-token sweep test + 06.1 filelog→Loki path |
| OBS-04 | LiteLLM spend reconciliation against ledger with discrepancy alerts | Dual-axis drift metric (D-R2) + Grafana alert (D-R3) + idempotent backfill via existing `ingest-litellm-spend` (Phase 3 plumbing reused) |
| OBS-05 | Liveness/readiness/startup probes — readiness fails on dep unhealthy | Three dedicated routes (D-P1) + `lru-cache` 5s TTL dep cache (§5) + `/api/health` alias preserved |
| DATA-04 | Audit log for auth/account/key/settings/admin/security events | 18-action enum CHECK-constrained + sync in-band INSERT (D-A1) + pg_partman monthly RANGE (§1) + S3-archive job + payload conventions locked |
| SCALE-01 | API tier stateless, sessions in Postgres, cache in Valkey, horizontal scaling verified | e2e `docker compose --scale api=2` via testcontainers compose API (§7) + Traefik round-robin + `x-served-by` header from `os.hostname()` |
| SCALE-03 | BullMQ workers run with tenant-context middleware verified by CI gate | `withTenantContext` HOF + AsyncLocalStorage tenant flag + 3-layer CI gate: Biome GritQL rule (§4) + runtime pg-pool guard + RLS property test |
| SCALE-04 | Anti-abuse rate limiting per-user + per-IP via Valkey token-bucket; polling carve-out preserved | Layered IP+user via `@fastify/rate-limit@10.3.0` registered twice; per-route rpm matrix locked; standard rate-limit headers added; Phase 2 carve-out preserved verbatim |

</phase_requirements>

---

## Executive Summary

Phase 6 is a production-readiness phase with an unusually complete locked-decision set in CONTEXT.md (49 D-* decisions across Telemetry/Audit/Reconciliation/Probes/Workers/RateLimit/SSRF). The planner's job is mechanical translation; this researcher's job is to verify the six discretion-area technologies are actually viable in 2026 and produce a wave/task ordering that satisfies the constitutional rules (strict TDD, ≥90/90/90/90 coverage, real services in tests, mandatory e2e, GHA CI green).

**Six discretion items resolved:**

1. **pg_partman migration** — Use **pg_partman 5.2.4+** with PostgreSQL 17 (5.x is current; 4.x trigger-based is removed). Convert `audit_log` to declarative RANGE partitioned parent via the **"detach-rename-create-attach" online pattern**; RLS policies on the parent automatically apply to all child partitions in PG declarative partitioning (this is native PG behavior, not a pg_partman feature). One dedicated migration `0011_audit_log_partition.sql` + extension provisioning. Forward+rollback test wired into existing `test-migration` CI job.
2. **undici SSRF interceptor** — undici has **no native SSRF protection** (issue #2019 open since 2023, no merged solution). Implementation pattern: custom `Agent` with `connect: { lookup }` override that performs single `dns.lookup({all: true})`, validates every IP against blocklist, then connects by IP while preserving `servername` (TLS SNI) and `Host:` header. Reference: `request-filtering-agent` for the blocklist ranges; we re-implement as undici interceptor because the original package targets the legacy `http.Agent`. **Confidence: MEDIUM** — pattern is sound but project-local (no battle-tested OSS implementation for undici v7 exists).
3. **pino+OTel load order** — `@opentelemetry/instrumentation-pino@0.63.0` MUST be initialized **before** any pino import. Standard pattern: `sdk-node` starts in `apps/api/src/otel-bootstrap.ts` imported FIRST in `apps/api/src/index.ts`. Auto-injects `trace_id`/`span_id`/`trace_flags` into every pino log record emitted from inside an active span. Grafana derived-fields config in `compose/grafana/provisioning/datasources/loki.yaml`: regex `"trace_id":"([a-f0-9]+)"` → Tempo link.
4. **Biome custom rule** — **Biome 2.x supports GritQL plugins** (`biomejs/biome@2.4.15` verified). Plugin lives at `tools/biome-rules/require-tenant-context.grit`, registered in `biome.json` `plugins: [...]`. GritQL pattern matches `export default $X` in `apps/worker/src/jobs/**/*.ts` where `$X` is not a call to `withTenantContext` or `withSystemContext`. **Confidence: MEDIUM** — GritQL pattern viability for "default-export-must-be-call-to-X" is reasonable but project-local; fallback is an ESLint rule in `eslint-plugin-local` if GritQL pattern proves limited.
5. **dep-check cache** — `lru-cache@11.3.6` is the boring choice. Tiny dep, no native modules, TTL via `ttl: 5000` option. Hand-rolled Map keyed on dep name is also fine but loses LRU bound (only 3 deps so functionally equivalent). **Pick `lru-cache`** for explicit TTL semantics + battle-tested.
6. **Audit S3 export + scale-test entrypoint** — `aws_s3.query_export_to_s3` is RDS/Aurora-only (extension not present in vanilla PG 17 from `postgres:17-alpine` image). Default implementation: shell-out via `pg_dump --table=audit_log_yyyy_mm --data-only` then `mc cp` (MinIO) / `aws s3 cp`. Operator-supplied `AUDIT_ARCHIVE_EXPORTER=aws_s3|s3_cli|mc_cp|custom` env selects the strategy. Scale-test entrypoint: **testcontainers-node v11 `DockerComposeEnvironment.withScale('api', 2)`** API (verified — released 2024, current).

**Primary recommendation:** Execute Phase 6 in 4 waves. Wave 0 is the migration + OTel bootstrap (everything depends on it). Wave 1 runs four parallel tracks (audit-log/reconciliation/probes/SSRF). Wave 2 wires layered rate-limit + worker tenant-context. Wave 3 is e2e + Grafana dashboards + docs. The audit-archive S3 export is the only item with significant unknown — recommend shipping the `mc cp` MinIO path as default and treating AWS S3 as an operator override.

---

## Technical Approach

### §1. pg_partman migration mechanics

**Goal:** Convert flat `audit_log` table to monthly RANGE-partitioned parent with pg_partman managing children.

**Verified facts** (sources at end):
- pg_partman 5.2.4 (released 2024) requires PG 14+, uses native declarative partitioning, no triggers.
- Postgres declarative partitioning **inherits RLS policies from parent to all child partitions automatically** (PG 13+). No template-table workaround needed for RLS.
- `aws_s3.query_export_to_s3` exists **only on RDS Postgres / Aurora**. Not in upstream PG; not in `postgres:17-alpine`.

**Migration shape** (`packages/data/migrations/0011_audit_log_partition.sql`):

```sql
-- 1. Enable extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

-- 2. Rename existing flat table out of the way
ALTER TABLE audit_log RENAME TO audit_log_legacy;

-- 3. Create partitioned parent with identical column set + action CHECK
CREATE TABLE audit_log (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id),
  actor_user_id uuid      NULL,
  action      text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),  -- PK must include partition key
  CONSTRAINT audit_log_action_check CHECK (action IN (
    'auth.signin','auth.signin_failed','auth.signout','auth.password_change',
    'auth.oauth_link','account.delete','account.delete_requested',
    'key.issued','key.revoked','settings.tenant_changed','settings.user_changed',
    'admin.tenant_created','admin.tenant_suspended','admin.user_impersonated',
    'admin.role_changed','security.cross_tenant_attempt',
    'security.rate_limit_exceeded','security.ssrf_blocked'
  ))
) PARTITION BY RANGE (created_at);

-- 4. Re-create indexes + RLS on parent (RLS propagates to children)
CREATE INDEX audit_log_tenant_id_idx ON audit_log (tenant_id);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 5. Register with pg_partman — monthly RANGE, retention 13 months
SELECT partman.create_parent(
  p_parent_table  => 'public.audit_log',
  p_control       => 'created_at',
  p_type          => 'range',
  p_interval      => '1 month',
  p_premake       => 4
);
UPDATE partman.part_config
   SET retention             = '13 months',
       retention_keep_table  = true,    -- detach, don't drop — archive job handles it
       retention_keep_index  = false,
       infinite_time_partitions = true
 WHERE parent_table = 'public.audit_log';

-- 6. Copy legacy rows into the new partitioned table (small in v1; tighten if grown)
INSERT INTO audit_log (id, tenant_id, actor_user_id, action, payload, created_at)
  SELECT id, tenant_id, actor_user_id, action, payload, created_at FROM audit_log_legacy;
DROP TABLE audit_log_legacy;
```

**Rollback** (paired `down.sql`):
```sql
ALTER TABLE audit_log RENAME TO audit_log_partitioned_tmp;
CREATE TABLE audit_log (id uuid PK, tenant_id ..., ...);
INSERT INTO audit_log SELECT * FROM audit_log_partitioned_tmp;
SELECT partman.undo_partition_proc(...) -- detach all children
DROP TABLE audit_log_partitioned_tmp CASCADE;
-- DROP EXTENSION pg_partman? — leave installed (operator extension; harmless)
```

**Drizzle implication:** Drizzle does NOT model partitioned tables natively. The schema file `packages/data/src/schema/audit_log.ts` continues to declare the table as if flat (Drizzle's query builder treats the partitioned parent the same as a regular table at the API level). The CHECK constraint + RLS + partitioning live in the hand-augmented SQL migration — same pattern as Phase 1 RLS (Phase 1 Plan 03 D-13). `tools/lint-rls.ts` must be extended to ALSO assert RLS is enabled on the partitioned parent (children inherit automatically; but the lint should not false-positive on the children, which `pg_policies` lists with `tablename = <child_partition_name>`).

**Docker image change required:** `postgres:17-alpine` does **not ship pg_partman**. Two options:
- (a) Build custom `compose/postgres/Dockerfile` `FROM postgres:17-alpine` + `apk add pg_partman` (Alpine has it as `postgresql17-contrib`-adjacent; verify package name during execution).
- (b) Switch to `bitnami/postgresql:17` which bundles pg_partman by default. **Recommend (a)** — keeps stack consistent with Phase 1 image pick (`postgres:17-alpine` per Phase 01.1 D-02), minimal blast radius.

**[BLOCKING] Schema-push task:** Phase 6 modifies `packages/data/src/schema/audit_log.ts` (CHECK constraint addition + drizzle-kit will regenerate). Planner MUST insert a `[BLOCKING] npx drizzle-kit push` task in the wave that ships the migration, paired with `make test-migration` (forward+rollback CI gate from Phase 1 Plan 05).

### §2. undici SSRF interceptor

**Verified facts:**
- undici@8.2.0 is current. **No native SSRF protection** — issue #2019 open since 2023, no accepted solution.
- The undici interceptor API is the supported extension point. Interceptors compose with `setGlobalDispatcher(agent.compose(interceptor))`.
- Critical for TLS: when connecting by IP, must explicitly pass `servername: hostname` to preserve SNI; the `Host:` header must remain the original hostname.

**Implementation pattern** (`apps/api/src/lib/ssrf-dispatcher.ts`):

```ts
import { Agent, type Dispatcher } from "undici";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

interface SSRFOptions {
  allowedHosts: string[];          // OUTBOUND_ALLOWED_HOSTS (wildcards)
  privateHostAllowlist: string[];  // OUTBOUND_PRIVATE_HOST_ALLOWLIST
  allowLoopback: boolean;
  mode: "enforce" | "warn";
  onBlock: (ctx: { host: string; ip: string; rule: string }) => void;
}

// Single-resolve-then-connect — closes DNS rebinding.
export function makeSSRFDispatcher(opts: SSRFOptions): Dispatcher {
  return new Agent({
    connect: {
      lookup: async (hostname, options, cb) => {
        // 1. Allow-list gate
        if (!hostMatches(hostname, opts.allowedHosts)) {
          return cb(new SSRFBlockedError("host_not_allowed", hostname));
        }
        // 2. Single DNS resolve, all addresses
        const addrs = await dnsLookup(hostname, { all: true });
        // 3. Per-IP blocklist check (RFC1918, link-local 169.254/16, IPv6 ULA, ...)
        for (const { address, family } of addrs) {
          const rule = checkBlocklist(address, family, opts);
          if (rule) {
            opts.onBlock({ host: hostname, ip: address, rule });
            if (opts.mode === "enforce") {
              return cb(new SSRFBlockedError(rule, hostname));
            }
          }
        }
        // 4. Hand the FIRST resolved address back to undici — connect by IP,
        //    not by hostname (closes TOCTOU window). servername is preserved
        //    by undici from the original URL, so TLS SNI still works.
        const first = addrs[0];
        cb(null, first.address, first.family);
      },
    },
  });
}

// Wired in apps/api/src/bootstrap.ts BEFORE any route registration:
import { setGlobalDispatcher } from "undici";
setGlobalDispatcher(makeSSRFDispatcher(opts));
```

**Key correctness points:**
- `connect: { lookup }` is the supported undici hook for custom DNS resolution. The Agent passes `(hostname, options, cb)` and expects `cb(err, address, family)`.
- `dns.lookup({ all: true })` returns every IP — we MUST check every entry, not just the first, to prevent DNS-rebinding-via-multi-A-record.
- Returning the resolved IP to undici causes it to connect by IP. undici preserves the original URL's hostname in the `Host:` header and in `tls.servername` for SNI — verified via Node 24's `https.Agent` -> `tls.connect` path.
- Block-list ranges hardcoded per D-S3.

**Edge cases:**
- HTTPS connection pooling — undici keys pool entries by `origin` (scheme://host:port), so pooling per-hostname still works correctly when we connect by IP (the cache key is the original hostname).
- IPv4-mapped IPv6 (`::ffff:10.0.0.1`) — must unwrap and re-check as IPv4 (covered in D-S3).
- AWS IMDSv1 169.254.169.254 — explicitly in 169.254.0.0/16 block.

**Confidence: MEDIUM.** This is project-local code. Reverse-patch verification in tests must hit a real loopback (testcontainers nginx serving a redirect to 169.254.169.254) to prove the gate fires. Reference: [request-filtering-agent](https://github.com/azu/request-filtering-agent) for the canonical CIDR list (re-implemented in undici interceptor form).

### §3. OTel pino instrumentation + log correlation

**Verified versions** (npm view, 2026-05-11):
- `@opentelemetry/instrumentation-pino@0.63.0`
- `@opentelemetry/auto-instrumentations-node@0.75.0`

**Load order constraint:** `instrumentation-pino` patches `pino` at require/import time. SDK must register the instrumentation BEFORE any `import pino from "pino"` anywhere in the app. The standard pattern:

```ts
// apps/api/src/otel-bootstrap.ts — imported FIRST in apps/api/src/index.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";

const sdk = new NodeSDK({
  instrumentations: [
    getNodeAutoInstrumentations({
      // Skip noisy ones per D-T1
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      // Avoid Drizzle double-counting on pg (D-T1)
    }),
    new PinoInstrumentation({
      logKeys: {
        traceId: "trace_id",
        spanId: "span_id",
        traceFlags: "trace_flags",
      },
    }),
  ],
});
sdk.start();
```

**Loki ↔ Tempo correlation in Grafana:** Add `derivedFields` to `compose/grafana/provisioning/datasources/loki.yaml`:

```yaml
jsonData:
  derivedFields:
    - name: TraceID
      matcherRegex: '"trace_id":"([a-f0-9]+)"'
      url: '${__value.raw}'
      datasourceUid: tempo
```

**Filelog receiver** (already wired in 06.1) parses pino JSON lines from `/var/log/containers/api-*.log`. Verify the `operators:` chain includes a `json_parser` so `trace_id` becomes a top-level field for Loki labels — without this Grafana derived-fields can still regex-match the JSON string, but querying-by-label is cheaper.

### §4. Biome custom rule (require-tenant-context)

**Verified:** Biome 2.4.15. GritQL plugin system is GA — see [Linter Plugins docs](https://biomejs.dev/linter/plugins/) + [GritQL Plugin Recipes](https://biomejs.dev/recipes/gritql-plugins/).

**Plugin layout:**
```
tools/biome-rules/
  require-tenant-context.grit
biome.json   # plugins: ["./tools/biome-rules/require-tenant-context.grit"]
```

**Pattern sketch** (`require-tenant-context.grit`):
```
language js
pattern $body where {
  $body <: contains `export default $X` => `export default $X` where {
    $X <: not within `withTenantContext($_, $_)`,
    $X <: not within `withSystemContext($_, $_)`,
    register_diagnostic(span=$X,
      message="apps/worker/src/jobs handlers must export withTenantContext(...) or withSystemContext(...)",
      severity="error")
  }
}
```

`biome.json` scoping limits this plugin to `apps/worker/src/jobs/**/*.ts` via `overrides`.

**Fallback if GritQL pattern proves limited:** ESLint rule in `tools/eslint-plugin-local/require-tenant-context.cjs` (we don't currently run ESLint — would need wiring). Confidence on GritQL viability: **MEDIUM** — the "default-export-must-be-call-to-X-or-Y" idiom is at the edge of what GritQL idiomatically expresses. Worth a Wave 0 5-min spike: write the .grit file, run `pnpm biome lint apps/worker/src/jobs/ingest-litellm-spend.ts` (which exports a non-wrapped default), confirm it fires. If GritQL can't express the negative match cleanly, switch to a plain TS AST walker (we already have `tools/lint-rls.ts` as the pattern) — call it `tools/lint-tenant-context.ts`, wired as a CI step like `lint:rls`.

### §5. In-process dep-check cache

**Pick: `lru-cache@11.3.6`.** Verified current, ~50 KB no native deps. Usage:

```ts
import { LRUCache } from "lru-cache";
const cache = new LRUCache<string, DepResult>({ max: 16, ttl: 5_000 });

async function check(name: "postgres" | "valkey" | "litellm", fn: () => Promise<DepResult>) {
  const cached = cache.get(name);
  if (cached) return cached;
  const result = await fn(); // single in-flight via Promise dedup (extra concern)
  cache.set(name, result);
  return result;
}
```

**Promise dedup (important for thundering herd):** kubelet probes can fire concurrently. Wrap `fn()` in an in-flight Map keyed on `name` so concurrent callers share one upstream check. ~10 lines of code, no extra dep.

**Rejected:** `node-cache` (older, lower download trend), hand-rolled Map (loses LRU bound; tiny but more code).

### §6. Audit-archive S3 export

**Verified facts:**
- `aws_s3.query_export_to_s3` is **RDS/Aurora-only** — extension shipped by AWS, not in vanilla PG 17.
- Vanilla Postgres 17 from `postgres:17-alpine` does NOT bundle `aws_s3`.
- The compose default has MinIO (Phase 1 D-27/28), not S3.

**Strategy: env-driven adapter pattern** (matches Phase 1 KeyProvider pattern).

`AUDIT_ARCHIVE_EXPORTER` env values:
| Value | Implementation | Use case |
|-------|----------------|----------|
| `mc_cp` (default) | `pg_dump --table=audit_log_yyyy_mm --data-only` ↦ pipe to `mc cp - minio/openwhispr/audit-archive/yyyy-mm.sql.gz` | docker-compose / MinIO operators |
| `s3_cli` | Same `pg_dump` ↦ `aws s3 cp - s3://...` | EKS/ECS without RDS, generic S3 |
| `aws_s3` | `SELECT aws_s3.query_export_to_s3(...)` | AWS RDS/Aurora operators |
| `custom` | Calls operator-supplied script at `$AUDIT_ARCHIVE_CUSTOM_SCRIPT` | escape hatch |

Implementation lives in `apps/worker/src/jobs/audit-archive.ts` (System mode). Job receives `{ partition_name }` from `partman-maintenance` after detach; shells out via Node `child_process.spawn` (audit-trail must capture stderr); on success, drops the partition.

**Why default `mc_cp`:** OSS posture; default compose ships MinIO; operator gets a working archive out of the box. AWS operators set `AUDIT_ARCHIVE_EXPORTER=aws_s3` in env, override the worker container's IAM (instance profile).

### §7. Horizontal-scale e2e test + warn-mode audit action

**Test entrypoint:** **testcontainers-node** supports `DockerComposeEnvironment` with `.withScale(serviceName, count)`. Verified in testcontainers-node v10+ (current). Pattern:

```ts
// tests/e2e/horizontal-scale.test.ts
import { DockerComposeEnvironment, Wait } from "testcontainers";

describe("horizontal scale", { skip: process.env.E2E !== "1" }, () => {
  let env: StartedDockerComposeEnvironment;
  beforeAll(async () => {
    env = await new DockerComposeEnvironment(".", "docker-compose.yml")
      .withProfile("default")
      .withScale("api", 2)
      .withWaitStrategy("api", Wait.forHttp("/livez", 3000))
      .up();
  }, 180_000);
  afterAll(() => env?.down({ removeVolumes: true }));
  // … sign in, 20 hits via Traefik, assert ≥1 each hostname, all 200, same session.id
});
```

**Make target:** Add `make e2e-test-scale` to `Makefile` for direct invocation; CI invokes via `make e2e-test` which already exists (Phase 3 Plan 09).

**Traefik round-robin:** Default loadbalancer strategy in Traefik 3 is RR by default for multiple healthy backends. No extra config needed — the existing `compose/traefik/dynamic.yml` `services.api.loadBalancer.servers` block auto-populates from Docker provider OR file provider; with `--scale api=2` and Docker provider (or explicit file servers list), RR distributes naturally. **Verify in Wave 0:** confirm the existing Phase 02.15 `aliases:[api.localhost]` config still works under scale; if Traefik is in file-provider mode pinning a single `http://api:3000`, swap to Docker provider for the test profile or add a second server entry.

**`x-served-by` plugin** (`apps/api/src/plugins/served-by.ts`): tiny Fastify `onSend` hook attaching `reply.header("x-served-by", os.hostname())`. <20 lines.

**`OUTBOUND_SSRF_MODE=warn` audit action:** **Use same `security.ssrf_blocked` action**, tag with `payload.mode: "warn"`. Rationale: operator runbooks (alerting, search) want a single key to grep for; adding a second action duplicates the dashboard. The `mode` field distinguishes "would-have-blocked" from "did-block" in queries.

### §8. BullMQ Worker + AsyncLocalStorage `withTenantContext`

**BullMQ verified version:** `bullmq@5.76.7`. The Worker handler signature in 2026:
```ts
new Worker(queueName, async (job: Job<T>) => { /* … */ }, { connection, concurrency });
```

**HOF pattern** (`apps/worker/src/lib/with-tenant-context.ts`):

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { Job } from "bullmq";
import type { Pool } from "pg";
import { trace } from "@opentelemetry/api";
import pino from "pino";

const tenantAls = new AsyncLocalStorage<{ tenantId: string; mode: "tenant" | "system"; jobId: string }>();
export const getTenantContext = () => tenantAls.getStore();

const tracer = trace.getTracer("worker");
const log = pino();

export function withTenantContext<S extends z.ZodObject<{ tenant_id: z.ZodString }>>(
  schema: S,
  handler: (data: z.infer<S>) => Promise<void>,
) {
  return async (job: Job) => {
    const data = schema.parse(job.data);
    const span = tracer.startSpan(`bullmq.job.${job.queueName}`, {
      attributes: { tenant_id: data.tenant_id, job_id: job.id! },
    });
    const childLog = log.child({ tenant_id: data.tenant_id, job_id: job.id });
    await tenantAls.run({ tenantId: data.tenant_id, mode: "tenant", jobId: job.id! }, async () => {
      const client = await appPool.connect();
      try {
        await client.query("BEGIN");
        // Parameterize via $1 — never interpolate UUID into SQL
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [data.tenant_id]);
        await handler(data);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        span.recordException(err as Error);
        childLog.error({ err }, "job failed");
        throw err;
      } finally {
        client.release();
        span.end();
      }
    });
  };
}
```

**`SET LOCAL` via `set_config(..., true)`:** Use `set_config('app.tenant_id', $1, true)` (3rd arg `is_local=true`) — this is the parameterized form. Direct `SET LOCAL app.tenant_id = $1` does NOT accept parameters and would require string interpolation (SQL-injection risk). The `set_config()` function is the correct PgBouncer-transaction-mode-safe pattern.

**Runtime pg-pool guard** (`apps/worker/src/db/app-pool.ts`): wrap `pool.connect()` so the returned client has its `query` method patched. On first query of a checkout, execute `SELECT current_setting('app.tenant_id', true)` — if result is `''` AND `tenantAls.getStore()?.mode !== 'system'`, throw `TenantContextMissingError`. Exercise in an integration test with testcontainer Postgres.

---

## Implementation Order

**Wave 0 — Foundation (BLOCKING for everything else):**
- W0-T1 — `[BLOCKING]` pg_partman extension added to compose postgres image (custom Dockerfile + Alpine pkg)
- W0-T2 — Migration `0011_audit_log_partition.sql` (RED test first: assert pg_partman extension exists; assert audit_log is `relkind='p'`; assert RLS enabled on parent + propagates to a created child)
- W0-T3 — `npx drizzle-kit push` task (Drizzle schema CHECK constraint update on `audit_log.action`)
- W0-T4 — OTel SDK bootstrap (`apps/api/src/otel-bootstrap.ts`) + load-order test (assert pino log emitted from inside a span has trace_id field)
- W0-T5 — `lru-cache@11` dep added; `apps/api/src/lib/dep-check.ts` skeleton with 5s TTL + promise dedup
- W0-T6 — GritQL spike: write `require-tenant-context.grit`, verify it fires on the un-wrapped `ingest-litellm-spend.ts` default export (BEFORE we refactor it). Decide GritQL vs TS-AST fallback.

**Wave 1 — Parallel tracks (4 independent):**
- W1-A — `audit_log` write path: shared `apps/api/src/lib/audit.ts` helper (`recordAudit(ctx, action, payload)`) called sync inside route txns. Wire into existing handlers that need audit per D-A6 (auth.signin, account.delete already exist; key.* and security.* added). Sentinel-token sweep test for `forbidden in payload` enforcement.
- W1-B — `/livez`, `/readyz`, `/startupz` routes + dep-check (uses W0-T5 cache). `/api/health` becomes `/livez` alias. Integration tests with real PG + Valkey + mock LiteLLM.
- W1-C — undici SSRF dispatcher (`apps/api/src/lib/ssrf-dispatcher.ts`) + bootstrap registration. Unit tests for every block-list CIDR. **E2E test:** testcontainers nginx serving 302 redirect to `http://169.254.169.254/` — assert 502 + audit_log row.
- W1-D — `withTenantContext` + `withSystemContext` HOFs + runtime pg-pool guard + AsyncLocalStorage. RLS property test extended to worker tier.

**Wave 2 — Wire-up (depends on Wave 1):**
- W2-A — Layered rate-limit: `@fastify/rate-limit` registered twice + per-route rpm matrix in `apps/api/src/config/rate-limits.ts` (env-overridable) + standard headers. Verify Phase 2 carve-out still passes its existing tests.
- W2-B — Refactor `ingest-litellm-spend.ts` to use `withSystemContext` (single-line default-export change). Add 5 new BullMQ workers (`email-delivery`, `usage-rollup-daily` dispatcher+children, `virtual-key-rotation`, `reconciliation-daily-check`, `reconciliation-discrepancy`, `partman-maintenance`, `audit-archive`). Each handler ships with Zod schema + RED test FIRST.
- W2-C — Biome plugin / TS-AST lint (`lint:tenant-context`) wired as required CI step. CI fails any job file with un-wrapped default export.
- W2-D — Grafana dashboards JSON committed under `compose/grafana/provisioning/dashboards/` — RED+saturation, per-tenant usage, LiteLLM spend, reconciliation drift. Loki derived-fields config for trace correlation.

**Wave 3 — Verification (gates phase close):**
- W3-A — Horizontal-scale e2e (`tests/e2e/horizontal-scale.test.ts`) — testcontainers `withScale("api", 2)` + 20-hit round-robin assertion.
- W3-B — Reconciliation drift e2e — seed mismatched ledger vs LiteLLM_SpendLogs, run job once, assert Mimir gauge + audit-log row.
- W3-C — SSRF block e2e — outbound to 169.254.169.254 returns 502 + `security.ssrf_blocked` row.
- W3-D — Log-scrub sentinel e2e — POST with `Authorization: Bearer SENTINEL-TOKEN-XYZ`, assert SENTINEL-TOKEN-XYZ absent from captured stdout of api container.
- W3-E — Audit-log-write e2e — `account.delete` round-trip writes the partitioned row, queryable via `psql audit_log`.
- W3-F — Docs (`docs/observability.md`, `docs/audit-log.md`, `docs/operations.md` updates for probes + rate-limit env vars + SSRF env).
- W3-G — Coverage ≥ 90/90/90/90 on every touched file; pass `make e2e-test` against real LGTM stack.

---

## Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| pg_partman not in `postgres:17-alpine` image | HIGH | BLOCKING for migration | Wave 0 builds custom postgres image. Verify exact Alpine package name in Plan 01 spike; fall back to `bitnami/postgresql:17` if friction. |
| RLS does not propagate to declarative partition children as expected | MEDIUM | Cross-tenant audit-log leak | Integration test (Wave 0): create a partition via partman, assert `SELECT * FROM audit_log_2026_05` under tenant-A context returns zero tenant-B rows. **Cite PG docs explicitly in the test comment.** |
| GritQL cannot express "default-export-must-be-call-to-X-or-Y" cleanly | MEDIUM | CI gate D-W4 layer 1 missing | Wave 0 spike. Fallback to TS-AST `tools/lint-tenant-context.ts` (Phase 1 D-21 pattern). Either way, layer 2 (runtime pg-pool guard) and layer 3 (property test) remain enforcing. |
| undici interceptor breaks TLS SNI when connecting by IP | MEDIUM | Outbound HTTPS fails for everything | Integration test with real `https://api.openrouter.ai/` (Phase 3 already verified live). If SNI breaks, downgrade to `{lookup}` only at the agent's connection layer where undici preserves `servername` from the URL — verify Node 24 `tls.connect` behavior; documented to use URL hostname for SNI. |
| `aws_s3.query_export_to_s3` operators expect AWS-RDS-default | LOW | Operator confusion | Document the env-driven exporter prominently in `docs/operations.md`; default to `mc_cp` for compose; `aws_s3` is documented as RDS-specific. |
| testcontainers `withScale` flakes under CI containerd | LOW | e2e flake | Pin testcontainers-node version; retry once with 30s extra timeout; fail loud. Per Phase 3 e2e patterns this hasn't been an issue. |
| Rate-limit standard headers conflict with Phase 2 envelope | LOW | Contract test regression | Only ADD `X-RateLimit-*` headers — 429 body envelope unchanged. CONTRACT-01 tests stay green. Verify by re-running `make contract-test` after Wave 2-A. |
| OTel SDK boot adds noticeable cold-start to API container | LOW | First-launch SLO regression (Phase 9) | Measure in Wave 0. Auto-instrumentations are tree-shaken at start; expect <200ms overhead. If significant, defer some instrumentations behind env flag. |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest@4.x` (workspace-wide, existing) |
| Config file | `vitest.config.ts` (root) + per-package overrides |
| Quick run command | `pnpm -r test --run` |
| Coverage command | `pnpm -r test --coverage` |
| Full suite command | `pnpm -r test --coverage --run && make contract-test && make e2e-test` |
| e2e gate | `E2E=1 make e2e-test` (boots real compose stack) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBS-01 | OTel auto-instrumentation emits Fastify/undici/pg/ioredis spans w/ correlation IDs | integration | `pnpm --filter @openwhispr/api test src/otel-bootstrap.test.ts` | ❌ Wave 0 |
| OBS-02 | Grafana dashboards JSON loads without parse errors; datasources resolve | smoke (CI) | `tests/self-tests/grafana-dashboards-validate.test.ts` | ❌ Wave 2 |
| OBS-03 | Sentinel token never appears in api container stdout | e2e | `E2E=1 vitest run tests/e2e/log-scrub-sentinel.test.ts` | ❌ Wave 3 |
| OBS-04 | drift gauges emitted; backfill closes drift; alert rule fires | e2e | `E2E=1 vitest run tests/e2e/reconciliation-drift.test.ts` | ❌ Wave 3 |
| OBS-05 | /livez returns 200 even when PG down; /readyz returns 503 when PG down | integration | `pnpm --filter @openwhispr/api test src/routes/probes.test.ts` | ❌ Wave 1 |
| DATA-04 | 18 actions CHECK-enforced; partition created automatically; RLS isolates | integration | `pnpm --filter @openwhispr/data test src/__tests__/audit-log-partition.test.ts` | ❌ Wave 0 |
| DATA-04 | account.delete writes audit_log row visible only to its tenant | e2e | `E2E=1 vitest run tests/e2e/audit-log-write.test.ts` | ❌ Wave 3 |
| SCALE-01 | 2-replica round-robin, zero session loss across 20 hits | e2e | `E2E=1 vitest run tests/e2e/horizontal-scale.test.ts` | ❌ Wave 3 |
| SCALE-03 | Tenant-A and tenant-B jobs concurrent never cross-read | property | `pnpm --filter @openwhispr/data test src/__tests__/worker-rls-property.test.ts` | ❌ Wave 1 |
| SCALE-03 | un-wrapped default export in apps/worker/src/jobs/ fails CI | unit (lint) | `pnpm biome lint apps/worker/src/jobs` (or `pnpm lint:tenant-context`) | ❌ Wave 0 spike |
| SCALE-04 | layered IP+user 429 fires when either exhausted; carve-out preserved | integration | `pnpm --filter @openwhispr/api test src/plugins/rate-limit.test.ts` | EXISTS (extend) |
| SSRF (D-S1..S6) | 169.254.169.254 redirect target → 502 + security.ssrf_blocked row | e2e | `E2E=1 vitest run tests/e2e/ssrf-block.test.ts` | ❌ Wave 3 |

### Sampling Rate
- **Per task commit:** `pnpm --filter <changed-pkg> test --run` (vitest watch on the relevant scope)
- **Per wave merge:** `pnpm -r test --coverage --run && pnpm lint && make contract-test`
- **Phase gate:** Full suite + `make e2e-test` green + coverage ≥ 90/90/90/90 on every touched file before `/gsd-verify-work`

### Wave 0 Gaps (test files to create FIRST per TDD)
- [ ] `apps/api/src/otel-bootstrap.test.ts` — assert load order, pino injection
- [ ] `apps/api/src/lib/dep-check.test.ts` — 5s TTL, promise dedup, three deps
- [ ] `apps/api/src/lib/ssrf-dispatcher.test.ts` — every CIDR, allow-list, modes
- [ ] `apps/api/src/routes/probes.test.ts` — livez/readyz/startupz semantics
- [ ] `apps/api/src/plugins/served-by.test.ts` — onSend hostname header
- [ ] `apps/worker/src/lib/with-tenant-context.test.ts` — Zod parse, txn boundary, ALS
- [ ] `apps/worker/src/lib/with-system-context.test.ts` — bypass-RLS role, MDC tag
- [ ] `apps/worker/src/db/app-pool.test.ts` — guard fires when tenant_id unset
- [ ] `packages/data/src/__tests__/audit-log-partition.test.ts` — pg_partman + RLS propagation
- [ ] `packages/data/src/__tests__/worker-rls-property.test.ts` — concurrent A/B tenants
- [ ] `tools/biome-rules/require-tenant-context.grit` OR `tools/lint-tenant-context.ts` + self-test
- [ ] `tests/e2e/horizontal-scale.test.ts`, `tests/e2e/ssrf-block.test.ts`, `tests/e2e/audit-log-write.test.ts`, `tests/e2e/reconciliation-drift.test.ts`, `tests/e2e/log-scrub-sentinel.test.ts`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | testcontainers + e2e | ✓ | (verified Phase 3) | none — fail CI |
| Node.js 24 LTS | runtime | ✓ | 24.15.0 | — |
| pnpm | workspace | ✓ | (Phase 0) | — |
| pg_partman extension | audit_log migration | ✗ | not in `postgres:17-alpine` | **Build custom image** or switch to `bitnami/postgresql:17` |
| undici@8 | global dispatcher | ✓ | 8.2.0 | bundled with Node 24 |
| `@opentelemetry/instrumentation-pino` | log correlation | ✓ | 0.63.0 | npm |
| `@opentelemetry/auto-instrumentations-node` | RED metrics + traces | ✓ | 0.75.0 | npm |
| `@fastify/rate-limit` | SCALE-04 | ✓ | 10.3.0 (already in repo per Phase 2) | — |
| `bullmq` | SCALE-03 | ✓ | 5.76.7 (already in repo per Phase 3) | — |
| `lru-cache` | dep-check | ✓ | 11.3.6 | hand-rolled Map |
| `biomejs/biome` GritQL plugins | CI gate D-W4 layer 1 | ✓ | 2.4.15 | TS-AST lint script |
| testcontainers-node `withScale` | horizontal-scale e2e | ✓ | v10+ (Phase 3 already uses testcontainers) | `make e2e-test-scale` shell target |
| LiteLLM mock + real keys | reconciliation e2e | ✓ | hermetic profile (Phase 3) | — |

**Missing dependencies with no fallback:** None blocking.
**Missing dependencies with fallback:** pg_partman not in current postgres image — custom Dockerfile is the documented path.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (carried from Phase 2) | Better Auth — no Phase 6 changes |
| V3 Session Management | yes | Postgres-stored sessions; horizontal-scale e2e proves no cross-replica loss |
| V4 Access Control | yes | RLS on partitioned audit_log; `withSystemContext` is the only bypass path (Biome+runtime+property gated) |
| V5 Input Validation | yes | Zod schemas on every job-data; per-route Fastify schema; SSRF allow-list parses URLs strictly |
| V6 Cryptography | yes (carried from Phase 1) | KEK/DEK via existing key provider — no Phase 6 changes |
| V7 Error Handling + Logging | yes | pino redact at source; sentinel-token sweep; English-only keys |
| V10 Malicious Code | yes | SSRF block-list incl. AWS IMDSv1 — closes server-side cred theft |
| V11 Business Logic | yes | rate-limit per-user+IP layered; audit_log immutable (no UPDATE/DELETE policy) |
| V12 Files | n/a | no new file uploads in this phase |

### Known Threat Patterns for {Node 24 + Fastify 5 + undici + Postgres 17 + Valkey 8}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server-side request forgery to internal IPs (incl. 169.254.169.254 AWS IMDS) | Tampering, Info-disclosure | undici dispatcher with single-resolve + CIDR block-list (D-S1..S6); audit log on every block |
| DNS rebinding TOCTOU | Tampering | Single-resolve-then-connect-by-IP; preserve SNI (D-S2) |
| Log injection of secrets | Info-disclosure | pino redact paths at source + sentinel-token sweep CI |
| Anti-abuse / credential stuffing | DoS | layered IP+user rate limit; pre-auth routes IP-only with tight ceiling (10/min/IP for signin/signup) |
| Cross-tenant data leak via missing app.tenant_id | Info-disclosure | runtime pg-pool guard + RLS property test + Biome rule (D-W4 3 layers) |
| Audit log tampering | Tampering, Repudiation | append-only (no UPDATE/DELETE policy on audit_log); pg_partman detaches but doesn't drop; S3 archive forever |
| Side-channel via probe response timing | Info-disclosure | LOW priority; /readyz dep checks via cached 5s result obscure precise probe timing |
| Worker job replay | Replay | BullMQ idempotency on `request_id` UPSERT (Phase 3 pattern reused for backfill) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `aws_s3` Postgres extension is RDS/Aurora-only and absent from upstream PG 17 | §6 | Operator-supplied env adapter still works; no breakage. Low risk. |
| A2 | Postgres declarative partitioning propagates RLS policies from parent to all child partitions automatically (PG 13+ behavior) | §1 | If wrong, partition children would silently leak cross-tenant. **MUST verify in Wave 0 integration test** (assert SELECT under tenant-B sees zero tenant-A rows in a partman-created child partition). |
| A3 | undici v8 preserves URL hostname for `servername` (TLS SNI) when `connect.lookup` returns a resolved IP | §2 | If wrong, all outbound HTTPS breaks. Verify in Wave 1 integration test against real `https://openrouter.ai/`. |
| A4 | testcontainers-node `DockerComposeEnvironment.withScale` is stable in current release | §7 | If broken, fallback is `Makefile` target `make e2e-test-scale` invoking `docker compose --scale` directly + a vitest runner that connects to the running stack. |
| A5 | Biome 2.x GritQL plugins can express "default export must be a call to function X or function Y" with negative-match semantics | §4 | If too limited, fallback is `tools/lint-tenant-context.ts` (TS-AST). Wave 0 spike resolves this in < 30 min. |
| A6 | pg_partman is installable in `postgres:17-alpine` via Alpine package or build-from-source in a custom Dockerfile | §1 + Env table | If not, switch to `bitnami/postgresql:17` base image. Affects compose Postgres pin only. |
| A7 | `set_config('app.tenant_id', $1, true)` is functionally equivalent to `SET LOCAL app.tenant_id = '...'` and PgBouncer-transaction-mode safe | §8 | Standard Postgres documented behavior; very low risk. Phase 1 D-18 already established this contract — reusing. |
| A8 | Always-on 100% trace sampling at the OTel Collector with Tempo filesystem backend (06.1 D-01) does NOT exceed disk/IO at 1000 concurrent users | Telemetry locked | If wrong, Phase 8 load test surfaces it and we add tail-based sampling (deferred per CONTEXT.md). |

**Confirmation needed before execution:** A2 + A3 + A5 are the three assumptions worth a 15-min spike each in Wave 0. A6 is mechanical (the image either contains the extension or doesn't). The rest are low-risk.

---

## Open Questions

1. **pg_partman alpine package availability** — need to verify exact package name for `postgres:17-alpine` build context. The `pg_partman` 5.x source compiles cleanly against PG 17; question is whether a prebuilt apk exists or we build from source in a multi-stage Dockerfile. Resolved in Wave 0 spike.
2. **Whether to keep `/api/health` as an alias forever or deprecate** — CONTEXT.md says keep as alias. Plan should add a `Deprecation:` response header pointing operators at `/livez` per RFC 8594. Mention in docs/operations.md.

---

## Sources

### Primary (HIGH confidence)
- npm view direct queries (2026-05-11): `@opentelemetry/instrumentation-pino@0.63.0`, `@opentelemetry/auto-instrumentations-node@0.75.0`, `undici@8.2.0`, `@fastify/rate-limit@10.3.0`, `bullmq@5.76.7`, `lru-cache@11.3.6`, `@biomejs/biome@2.4.15`
- Local Node version check: 24.15.0
- Local repo inspection: `apps/worker/src/jobs/ingest-litellm-spend.ts` (current default-export pattern), `packages/data/src/schema/audit_log.ts` (current flat table), `apps/api/src/middleware/tenant.ts` (request-tier HOF mirror)
- PostgreSQL 17 docs § Row Security Policies — RLS-on-partitioned-tables propagation [VERIFIED: PG manual]
- pg_partman 5.2.4 release notes (postgresql.org) — declarative-only, PG 14+ minimum
- Biome Linter Plugins docs — GritQL plugin GA in 2.x

### Secondary (MEDIUM confidence)
- WebSearch: pg_partman 5 + PG 17 + RLS — confirms native declarative partitioning + property-inheritance matrix
- WebSearch: undici interceptor SSRF — confirms no native support (issue #2019 still open)
- WebFetch of `https://github.com/nodejs/undici/issues/2019` — confirms agent-pattern recommendation
- WebSearch: Biome 2.x GritQL plugins — confirms plugin API stable, custom .grit files registered via biome.json
- [request-filtering-agent](https://github.com/azu/request-filtering-agent) — reference CIDR list (re-implemented for undici)

### Tertiary (LOW confidence — flagged for Wave 0 validation)
- GritQL ability to express "default-export-must-be-call-to-X-or-Y" — spike required
- testcontainers-node `withScale` stability under GHA — low risk based on Phase 3 e2e history
- Exact alpine apk for pg_partman — mechanical, verified at execution time

---

## Metadata

**Confidence breakdown:**
- Locked decisions (D-T1..S6): HIGH — already user-ratified in CONTEXT.md, this researcher only verifies viability
- Standard stack versions: HIGH — npm-verified 2026-05-11
- Architecture patterns (HOF, dispatcher, dep-check): HIGH — well-established patterns
- Discretion item 1 (pg_partman migration): HIGH for general shape, MEDIUM for exact DDL — Wave 0 spike refines
- Discretion item 2 (undici SSRF): MEDIUM — no battle-tested OSS reference for undici v8 specifically
- Discretion item 3 (Biome custom rule): MEDIUM — GritQL pattern viability TBD in Wave 0
- Discretion item 4 (warn-mode audit action): HIGH — design decision, low risk
- Discretion item 5 (audit-archive exporter): HIGH — env adapter pattern matches Phase 1 KeyProvider
- Discretion item 6 (scale e2e entrypoint): HIGH — testcontainers-node has documented API

**Research date:** 2026-05-11
**Valid until:** 2026-06-10 (30 days; OTel + Biome ecosystems move fast)

---

*Phase: 06-observability-ops-hardening-workers*
*Researcher pass: 2026-05-11*
