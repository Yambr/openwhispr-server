# Project Research Summary

**Project:** OpenWhispr Server
**Domain:** Open-source, enterprise-grade, self-hosted, wire-compatible backend for the OpenWhispr Electron desktop client (auth + transcription + LLM reasoning + agent NDJSON streaming + WSS realtime + billing), multi-tenant, 1000 concurrent users, default AI plane = LiteLLM Proxy + Speaches.
**Researched:** 2026-05-08
**Confidence:** HIGH

> Detailed findings live in sibling files:
> - [`STACK.md`](./STACK.md) — runtime, framework, DB, queue, ingress, observability, frontend, with versions
> - [`FEATURES.md`](./FEATURES.md) — wire-required + platform table-stakes, differentiators, anti-features
> - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — component decomposition, hot-path data flows, RLS, sizing math
> - [`PITFALLS.md`](./PITFALLS.md) — 41 catalogued pitfalls with phase mapping
>
> This document is the single distilled artifact for downstream agents (requirements scoping, roadmapper, phase planners).

---

## Executive Summary

OpenWhispr Server is **not a greenfield product** — it is a wire-compatible re-implementation of an existing cloud surface. The desktop client at `/Users/dev/openwhispr` is the canonical user; the contract is fully reverse-engineered in `BACKEND_SPEC.md` / `OAUTH_SPEC.md` / `SELF_HOSTING.md` (1556 lines total). Every architectural decision flows from a single primary directive: **the wire surface must match byte-for-byte**, including the global `{"error":"..."}` envelope, HTTP 401 (not 200-with-error) on auth failure, NDJSON line-flushing on `/api/agent/stream`, the `200 + limitReached:true` (not 4xx) quota signaling on `/api/transcribe`, the `set-auth-token` rotation header, and the channel-scheme-echoing custom-protocol redirect (`<scheme>://?bearer_token=...`). On top of that contract, the platform layers enterprise self-host expectations: multi-tenancy with row-level isolation, multi-provider abstraction, observability, backups, and OSS-grade documentation.

The recommended approach is a **boring, mainstream TypeScript stack on Node.js 24 LTS + Fastify 5**, with **Better Auth** (server-side library co-located in the Fastify process — its emitted contract already matches the desktop client's expectations because the desktop is already a Better Auth client), **Drizzle ORM + PostgreSQL 17 + PgBouncer transaction-pool + CloudNativePG**, **Redis/Valkey + BullMQ** for queue and rate-limit, **LiteLLM Proxy v1.83.7-stable+ as a sidecar service** (the multipart-passthrough bug from `speaches-audio.md` is **already fixed natively in v1.83.7** — the backport patch should be deleted), **Speaches on a dedicated GPU pool** behind LiteLLM, **Traefik 3 ingress** (NOT `kubernetes/ingress-nginx`, which retires March 2026), the **LGTM observability stack** (Loki + Grafana + Tempo + Mimir) via OTel Collector, and **i18next + i18next-icu** for runtime i18n with proper Russian CLDR pluralization. The future operator UI is **Next.js 15 + React 19 + Tailwind 4 + shadcn/ui**, but v1 ships only `UI-SPEC.md`, not the implementation.

The dominant risk class is **wire-contract drift** — every other category is recoverable, but a 200-instead-of-401, a hardcoded `openwhispr://` scheme, or a buffered NDJSON response breaks every desktop client transparently and silently. The mitigation strategy is a **wire-contract conformance test suite** (DIFF-12) authored incrementally alongside each endpoint and runnable against any deployed instance — combined with constitutional TDD discipline, GitHub Actions CI from day one, ≥85% coverage gate, mutation testing on auth/quota/billing math, RLS property tests, and a load test asserting 1000 concurrent at p95 SLO. The second-largest risk is **multi-tenancy footguns** (RLS-bypass under PgBouncer transaction-pool if `SET LOCAL` discipline slips, missing RLS policies on new tables, cache-key cross-tenant collisions, and tenant-context loss in background jobs) — addressed by a centralized tenant-context middleware, an RLS-introspection CI lint, and a Redis-wrapper-only access pattern. The third risk cluster is **LiteLLM/Speaches integration quirks** (pass-through endpoints not metered, Speaches GPU cold-start, OpenAI-Realtime-spec compatibility deltas) — addressed in a dedicated audio-pipeline phase with E2E fixtures.

---

## Key Findings

### Recommended Stack

The stack is fully verified against current 2026 releases, every component is multi-arch (amd64+arm64) except Speaches (CUDA-amd64 only — documented exception), and every choice is "boring and well-staffed" per the constitutional rule. Confidence is HIGH on every layer.

**Core technologies (with versions and confidence levels — full rationale in `STACK.md`):**

| Layer | Pick | Version | Confidence | Why |
|---|---|---|---|---|
| Runtime | Node.js (Active LTS) | **24.x** | HIGH | Native undici v7 for WSS, multi-arch official images, OSS contributor pool. Node 20 EOL Apr 2026 — do not start there. |
| HTTP framework | Fastify (TypeScript) | **5.x** | HIGH | `reply.raw.write/flush` for NDJSON line-flush, `@fastify/multipart` v10 stream-mode, `@fastify/http-proxy` `wsUpstream` for WSS, ~30k req/s |
| Auth | Better Auth (server) + Bearer + JWT + OAuth Provider plugins | **1.x** | HIGH | Desktop is already a Better Auth client; wire shape (cookie + bearer + `set-auth-token` rotation) is exactly what Better Auth emits |
| Database | PostgreSQL | **17.x** | HIGH | PG 17.9 current; vacuum rewrite + lock-contention improvements matter at 1000 concurrent. PG 16 allowed but older; PG 18 too new |
| ORM/Migrations | Drizzle ORM + drizzle-kit | latest | HIGH | TS-native schema, no engine binary, PgBouncer transaction-mode native, RLS-friendly raw SQL escape hatch. **NOT Prisma** |
| Pooler | PgBouncer transaction mode | **1.23+** | HIGH | Prepared-statement support resolves Drizzle compatibility. Sized 100 backend × 4 instances at 1000 concurrent |
| HA Postgres (K8s) | CloudNativePG operator | **1.29.x** | HIGH | CNCF Sandbox; default catalog PG 18 — override to PG 17 in Cluster spec |
| Cache + queue + WS fan-out | Redis 7.4 OR Valkey 8.x | latest | HIGH | Valkey for OSS license cleanliness in default Helm chart |
| Job queue | BullMQ | latest | HIGH | Throughput beats graphile-worker for our webhook+spend-log+email mix; Redis already required |
| LLM/audio gateway | LiteLLM Proxy | **v1.83.7-stable or newer** | HIGH | **Multipart-passthrough bug fixed natively in v1.83.7** ([PR #25464](https://github.com/BerriAI/litellm/pull/25464)). DO NOT ship the `patches/fix_passthrough_multipart.py` from `speaches-audio.md` — pin >= v1.83.7 and delete the patch. |
| ASR / Realtime backend | Speaches (`speaches-local:master-cuda-12.6.3`+) | latest master | HIGH | Three roles in one image (Whisper / pyannote / Realtime WSS); GPU-only, ~2× L40S or 1× H100 minimum for our concurrency mix |
| Object storage | MinIO (self-host) / S3-GCS-Azure (cloud) | latest | HIGH | S3-compatible API; pluggable per-tenant for residency |
| Ingress (K8s) | **Traefik 3.x** | 3.x | HIGH | **NOT `kubernetes/ingress-nginx` — officially retires March 2026** ([Kubernetes blog](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)). Auto WS-Upgrade, ACME built-in, Gateway API support. |
| Observability | OTel SDK Node → OTel Collector → **Tempo + Mimir/Prom + Loki + Grafana** | LGTM | HIGH | Auto-instrumentation for Fastify/undici/pg/ioredis. OTel Collector covers logs in 2026 — Vector unnecessary unless heavy transformation. |
| i18n | **i18next + i18next-http-middleware + i18next-icu** | latest | HIGH | Server-first; `Accept-Language` negotiation; CLDR plural rules — only ICU/CLDR-aware libs handle Russian one/few/many correctly. **NOT node-polyglot.** |
| Frontend (UI-SPEC target only in v1) | Next.js 15 (App Router) + React 19 + Tailwind 4 + shadcn/ui + TanStack Query 5 + better-auth/react | latest | HIGH | 2026 default for OSS admin dashboards |
| Container runtime | docker-compose v2 (single-host) + Helm chart (K8s) | — | HIGH | One chart, OCI-distributed; cert-manager for TLS issuance |

**Two load-bearing version findings:**

1. **LiteLLM ≥ v1.83.7-stable** — the multipart pass-through 500 bug documented in `speaches-audio.md` is fixed natively (PR #25464 merged). The `patches/fix_passthrough_multipart.py` file is a relic of the ExampleCorp v1.82.3-era deployment and **must not be shipped**. This is the single most actionable upstream change relative to the reference deployment.
2. **`kubernetes/ingress-nginx` is officially retiring March 2026** with no further security patches. The shipped Helm chart must use **Traefik 3** (or Envoy Gateway) — this affects DEPLOY-02 directly.

### Expected Features

The full feature catalogue (table-stakes + differentiators + anti-features + dependency graph + competitor matrix) is in [`FEATURES.md`](./FEATURES.md). Counts:

- **Wire-required (TS-W-*): 22 features** — the desktop client misbehaves or fails outright without each one. All P1 / v1.
- **Platform-level (TS-P-*): 20 features** — multi-tenancy, RLS, providers, quotas, audit log, observability, i18n, migrations, secrets, queue, rate limit. All P1 / v1.
- **Operator-experience (TS-O-*): 6 features** — admin + end-user UI-SPECs (not implementations), compose quickstart, Helm chart, one-command upgrade, full docs suite. All P1 / v1.
- **Differentiators (DIFF-*): 15 features** — 10 cheap-now and shipped in v1, 5 deferred to v1.5.
- **Anti-features: 15** — explicit non-goals with constructive alternatives.

**Must have (table stakes — full list per `FEATURES.md` § MVP Definition):**

- Wire lifecycle: `/api/check-user`, `/api/auth/verification-status` (5s polling carve-out), `/api/auth/delete-account`, OAuth shim with channel-scheme echo, opaque bearer + `set-auth-token` rotation, dual cookie+bearer auth, HTTP 401 on auth failure, global `{error}` envelope.
- Wire ops: `/api/health`, `/api/transcribe` (multipart, `limitReached@200`), `/api/reason`, `/api/agent/stream` (NDJSON flushed-per-line), `/api/agent/web-search`, usage/config endpoints, three realtime token endpoints (with `streams=2` for OpenAI realtime), Stripe lifecycle (4 endpoints with null-adapter for license-only installs), referrals (3 endpoints), generic passthrough, HTTPS-only, 1h streaming through ingress.
- Multi-tenancy with row-level isolation from day 1; pluggable identity (generic OIDC + email/password + at least 2 social), pluggable LLM/STT/Realtime/storage/email/billing providers; per-tenant quotas + LiteLLM-spend-fed usage ledger; audit log; backup/restore; probes; OTel + Prometheus + structured logs; **i18n with `en` + `ru` from day 1** (operator overrides without forking); rolling-deploy-safe migrations; secrets management; PgBouncer; BullMQ workers; rate limits; stateless API.
- Operator: UI-SPECs for admin + end-user (not implementations); compose quickstart < 5 min to first authenticated `/api/transcribe`; Helm chart; one-command upgrade; full docs suite (DOCS-01..09).

**Should have (v1 differentiators — see `FEATURES.md` § Differentiators):**

- **DIFF-01 Per-tenant provider override** — load-bearing differentiator that pulls TS-P-03/04/05/07 forward as tenant-scoped. **Must design tenant-scoped from day 1** (retrofitting is L-sized).
- **DIFF-02 Org-key tenancy mode** vs user-BYOK passthrough.
- **DIFF-03 Sandbox/test tenant** with mock provider — adoption multiplier.
- **DIFF-06 Encrypted-at-rest tokens** (KEK/DEK envelope) — share abstraction with TS-P-16 secrets.
- **DIFF-07 Built-in dev mode** (no IdP, mock email to stdout) auto-disabled in production.
- **DIFF-08 CI-tested reproducible local dev**.
- **DIFF-09 Per-tenant locale overrides**.
- **DIFF-12 Wire-contract conformance test suite** — runs against any deployment; **the regression net for everything else**.
- **DIFF-13 Realtime multi-stream brokering** (`streams=2`).
- **DIFF-14/15 Multi-arch + no-GPU API tier**.

**Defer (v1.5 / v2+):**

- v1.5: Cost dashboards per-tenant (DIFF-04), PII redaction (DIFF-05), bundled Grafana dashboards (DIFF-10), gradual-rollout migration runners (DIFF-11), actual frontend implementation (graduating UI-SPEC → code).
- v2+: SAML/SCIM provisioning, audit-log SIEM exports, FedRAMP/CMEK isolation, OpenAPI/JSON-Schema generation, live runtime trace validation against the OpenWhispr cloud, generic webhook subscriptions, locales beyond `en` + `ru`.

**Anti-features (deliberately NOT building, per `FEATURES.md` § Anti-Features):** modifications to the desktop client, reimplementing vendor SDKs already in LiteLLM, Google Calendar OAuth proxying, hidden/undocumented endpoints, custom IdP UI / self-hosted SSO portal (defer to bundled Authentik), real-time admin metrics WebSocket push, server-side TTS, generic webhook system in v1, plaintext-HTTP dev mode.

### Architecture Approach

The system is a layered cloud backend with explicit failure domains and a 12-phase build order (the +2 phases over the 10 listed in `ARCHITECTURE.md` are Phase 0 bootstrap and Phase 11 i18n+docs). Hot paths are well-understood: `/api/transcribe` streams multipart through to LiteLLM after a synchronous quota pre-check that returns `200 + limitReached:true` if exhausted (without burning money on an upstream call); `/api/agent/stream` opens an NDJSON response with explicit per-line flush, bypassing all proxy buffering; `/v1/realtime` opens a WSS upgrade with 3600s ingress timeouts in the recommended Option A topology (token endpoint hands the desktop a virtual key + URL, desktop opens WSS direct to LiteLLM-fronted Speaches). The OAuth flow round-trips the channel scheme (`openwhispr` / `-dev` / `-staging` / arbitrary override) from the `callbackURL` query param through an `oauth_state` table to the final 302 redirect — hard-coding the scheme is the #1 integration trap. Multi-tenancy is enforced at the database via Postgres RLS with an `app.tenant_id` GUC set per transaction (`SET LOCAL` — never plain `SET`, which leaks across pooled connections), backed by a CI lint that introspects `pg_class` + `pg_policies` and asserts every `tenant_id`-bearing table has an active policy.

**Major components (full data-flow diagrams in `ARCHITECTURE.md`):**

1. **Edge / ingress** — Traefik 3 (K8s) or Traefik in compose; TLS termination via cert-manager / built-in ACME; WS Upgrade; per-route `proxy_buffering off` for streaming; 3600s read/send timeouts for WSS; 100MB body cap for `/api/transcribe`; per-IP rate-limit zones.
2. **API tier** — stateless Fastify app, 3-N replicas, horizontal autoscale on CPU+RPS, owns all `/api/*` wire endpoints, tenant resolution + RLS GUC injection middleware, quota pre-check, NDJSON line-flush, WSS upstream proxy, provider dispatch through a registry of typed adapters.
3. **Auth shim** — same binary as API or sibling deployment; hosts `/api/desktop-signin/{provider}` with channel-scheme echo, Better-Auth-compatible bearer issue, `set-auth-token` rotation header.
4. **LiteLLM Proxy** — separate sidecar (NOT embedded — Python service, polyglot deploy is unacceptable); virtual-key auth, model alias map, multipart pass-through (native fix in v1.83.7+), spend logs sink to its own Postgres database co-tenant on the same cluster.
5. **Speaches** — separate GPU-attached deployment (NOT API-pod sidecar — would 10× GPU cost); StatefulSet with GPU node-selector in K8s; 1+ replica per audio capacity unit; Whisper-large-v3, pyannote, OpenAI-Realtime-spec WSS in one image. Sticky sessions for in-flight WSS by hashing `Authorization` token.
6. **Worker tier** — same image as API, queue-consumer entrypoint; webhook fanout, email send, daily usage rollups, LiteLLM spend-log ingestion (BullMQ job every 30s), tenant cleanup. Background jobs MUST re-establish full tenant context (DB GUC + log MDC + OTel context) before invoking handler.
7. **Postgres** — PG 17 with RLS, `app.tenant_id` GUC, append-only `usage_ledger` partitioned by day (UPDATE-heavy aggregates live in a separate rollup table to avoid VACUUM bloat), PgBouncer transaction-pool, CNPG operator with streaming replication and S3 backups in K8s.
8. **Redis / Valkey** — rate-limit token buckets (fail-OPEN on Redis death), BullMQ queue (fail-CLOSED on idempotency keys), OAuth-state nonces, ephemeral session cache. Every key prefixed `tenant:<uuid>:` via a wrapper; raw client calls are forbidden by lint.
9. **Object storage** — MinIO default; per-tenant bucket-prefix (or per-tenant bucket for residency-restricted tenants).
10. **Observability plane** — OTel Collector DaemonSet → Tempo / Mimir / Loki / Grafana; LiteLLM spend logs feed both Loki (text) and the structured `usage_ledger` (via BullMQ job).

**RLS isolation strategy (full DDL in `ARCHITECTURE.md` § 4.2):** every `tenant_id`-bearing table has `ENABLE ROW LEVEL SECURITY` and a default policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. The application Postgres role is `NOLOGIN BYPASSRLS=false` — RLS is unbypassable by app code. A separate `openwhispr_migrator` role with `BYPASSRLS` runs DDL/backfills, audit-logged. Cross-tenant attempts (token tenant ≠ subdomain/header tenant) → 403 + audit log row.

**Failure-domain matrix (full in `ARCHITECTURE.md` § 8):** LiteLLM down → 503 across audio/LLM endpoints (cannot degrade — core); Speaches down → 503 unless multi-STT routing configured; Postgres primary failover via Patroni/CNPG (~10-30s, bounded retries); **Redis fails OPEN on rate limit, CLOSED on idempotency keys**; worker tier down delays webhooks/email but synchronous endpoints unaffected; ingress single-replica is a SPOF — 2+ replicas required. Every external call is wrapped in: timeout (3s health, 30s sync, 60min stream) + jittered-backoff retry (idempotent only) + circuit breaker (open/half-open/close) + audit metric on each transition.

**Sizing math at 1000 concurrent (full in `ARCHITECTURE.md` § 10):** assume worst-case mix of 200 concurrent NDJSON agent streams + 100 concurrent WSS realtime + 700 sync-mix at 50 RPS for transcribe/reason. Sockets held simultaneously: ~310 ingress, ~310 api→litellm, ~110-130 GPU. nginx/Traefik: `worker_connections 8192`, `worker_rlimit_nofile 65535`, 2 ingress replicas. API tier: 3 pods × 4 vCPU × ~500 concurrent per process = 6000-capable; 4GB request, 6GB limit per pod; **explicitly raise `ulimit -n` to 65535** (default 1024 causes silent EMFILE under load). Postgres: 6k-10k QPS peak, PgBouncer pool size 100 backend × 4 instances, `max_connections=200`, 1 primary + 2 replicas, WAL on separate SSD volume, 50GB initial. Redis: 6k-10k ops/s — single instance does 100k+; 2 for HA. Speaches GPU: 50 concurrent transcribes per A10/L4-class GPU, 20 per realtime session — 2-4 GPU pods (L40S or L4). **All numbers are MEDIUM confidence — must be validated under SCALE-06 load test (1000-concurrent k6 nightly) before being committed as SLO.**

### Critical Pitfalls

The full catalogue of 41 pitfalls with phase-mapping is in [`PITFALLS.md`](./PITFALLS.md). The top 10 by risk severity × likelihood, with prevention strategy and the phase that must address each:

| # | Pitfall | Phase | Prevention Strategy |
|---|---------|-------|---------------------|
| **1** | **Returning HTTP 200 with `{error:...}` instead of HTTP 401 on auth failure** — breaks the desktop's `withSessionRefresh()` retry path; users see infinite "verifying…" UX | Phase 2 (Auth) | Auth middleware MUST short-circuit with 401 + global error envelope; **contract-test sweep** across every authenticated endpoint with `Authorization: Bearer invalid`; lint forbids `200` from auth-required handlers when `req.user` is null |
| **2** | **Returning 4xx for `/api/transcribe` quota exhaustion instead of `200 {limitReached:true}`** — quota UI never appears; users see "Something went wrong" instead of the upgrade CTA | Phase 3-4 (Transcription/quota) | Mapping layer translates LiteLLM 4xx-budget-exceeded into 200 + `limitReached:true` envelope; zero-quota tenant E2E test |
| **3** | **NDJSON buffering on `/api/agent/stream`** (any layer in the chain — framework, Traefik, ingress, CDN — that buffers kills streaming UX) | Phase 4 (Streaming) + Phase 7 (Deploy) | `application/x-ndjson` Content-Type + `X-Accel-Buffering: no` + per-route `proxy_buffering off` annotations + explicit `res.flush()` per line + first-line-latency contract test (< 500ms through full ingress chain) |
| **4** | **Hard-coding `openwhispr://` in the OAuth final redirect** instead of echoing `callbackURL`'s `protocol=` — silently breaks every dev/staging/custom build | Phase 2 (Auth shim) | Persist `channel_scheme` from `callbackURL` in `oauth_state` table; echo verbatim in final 302; allow-list `^openwhispr(-[a-z]+)?$`; multi-channel matrix contract test |
| **5** | **`SET app.tenant_id` (without `LOCAL`) leaks across PgBouncer transaction-pooled connections** — cross-tenant data leak (data-breach-grade) | Phase 3 (Multi-tenancy) | Always `SET LOCAL app.tenant_id` inside an explicit transaction; framework middleware enforces (no raw query path); contract test with PgBouncer transaction-mode + 100 interleaved tenant-A/tenant-B queries |
| **6** | **Missing RLS policy on a new tenant-scoped table** — every new migration is a potential cross-tenant leak | Phase 3 (Multi-tenancy) | CI lint introspects `pg_class` + `pg_policies` and asserts `relrowsecurity = true` AND a policy referencing `current_setting('app.tenant_id')` for every `tenant_id`-bearing table; randomized fuzzer property test (TEST-RLS-01) |
| **7** | **Ingress < 1h read/send timeouts kill WSS realtime sessions** — meeting transcriptions cut off after exactly N minutes | Phase 4 + Phase 7 | Per-route `proxy-read-timeout: 3600` + `proxy-send-timeout: 3600` + `proxy-buffering: off`; 65-min synthetic WSS smoke test |
| **8** | **`set-auth-token` rotation race with concurrent in-flight requests** — old token revoked while R2/R3 still in flight; 401 cascade outside the 60s grace window = user-visible logout | Phase 2 (Token rotation) | Tokens overlap ≥ 60s (5 min preferred); accept N latest token versions per session; rotate only on Better-Auth-style endpoints, not every `/api/*` call; concurrent-request rotation contract test |
| **9** | **LiteLLM does NOT meter pass-through endpoints** (diarization specifically) — billing relies solely on spend-logs and burns money silently | Phase 4 (LiteLLM) + Phase 5 (Observability) | Two authoritative usage sources: LiteLLM spend-logs for native models + nginx access-log parser → unified `usage_ledger`; daily reconciliation job alerts on drift |
| **10** | **Default secrets in shipped compose** (`POSTGRES_PASSWORD=changeme`, `LITELLM_MASTER_KEY=sk-1234`) — operators in a hurry skip rotation; production deploy = trivial root compromise; Shodan exposure | Phase 7 (Deploy) | Compose ships with **NO default secrets**; `bootstrap.sh` generates random secrets; runtime check refuses to start if any required secret matches a known-default value; pre-commit hook scans for known defaults |

**Honorable mentions** (high-impact, well-mapped — see `PITFALLS.md` for full prevention):
- **#11** Cross-tenant cache key collisions in Redis → enforce `tenant:<uuid>:` prefix wrapper, forbid raw Redis calls.
- **#12** Background-job tenant context loss → job runner re-establishes DB GUC + log MDC + OTel before handler runs; CI introspection gate.
- **#14** LiteLLM v1.82.x multipart-passthrough bug → pin v1.83.7-stable+; **delete the backport patch** from the reference.
- **#21** FD exhaustion at 1000 concurrent → `ulimits.nofile=65536`; startup probe verifies; Prometheus alert at 80%.
- **#26** Migrations that lock under load → `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT NOT VALID` then `VALIDATE`; migration linter (squawk/pgroll) blocks PRs with blocking patterns.
- **#31/32** Hard-coded English strings + naive `n===1` pluralization → ESLint forbids string literals in user-facing surfaces; CI gate asserts every `t("key")` exists in BOTH `en` and `ru`; ICU MessageFormat for plurals (Russian needs 4 forms).
- **#40** Bearer tokens in logs → logging middleware scrubs `Authorization`, `Cookie`, `set-auth-token`, `*token*`/`*secret*`/`*password*`/`*key*`; sentinel-token log-scrub test.
- **#41** PII data-residency violations (cross-border LLM calls) → per-tenant `allowed_providers` config; provider-selection layer enforces; audit log every selection.

---

## Implications for Roadmap

The architecture and feature research jointly suggest a **12-phase build order**. Phases are sized for a 1-3 person team with constitutional TDD discipline (tests precede production code; ≥85% coverage gate; integration via testcontainers; mutation testing on auth/quota/billing math). Each phase has a deliverable that's **tested via the wire-contract conformance suite (DIFF-12) incrementally** — the suite is not a final-phase milestone, it's a regression net authored alongside every endpoint.

### Phase 0: Repo Bootstrap

**Rationale:** Constitutional rules (TDD, GitHub Actions, English-only, ≥85% coverage, mutation testing, RLS property tests, license scan) must exist on commit #1 — retrofitting them after Phase 1 is harder than starting clean.
**Delivers:** Monorepo layout (api/, worker/, web/ stub, infra/, docs/), TypeScript + Fastify scaffold, Drizzle scaffold, Vitest + testcontainers harness, `.github/workflows/` (lint + typecheck + unit + integration + e2e + contract + SAST + dep-scan + container-scan + secrets-scan + license-scan + i18n-completeness + RLS-property + migration-safety + nightly load test), branch protection on `main`, English-only lint rule, ADR template, `make dev` / `make test` one-command devex.
**Avoids:** Pitfall #35 (license leakage — scanner from day 1), constitutional drift on TDD/CI/coverage.

### Phase 1: Core Infrastructure (Compose-Only)

**Rationale:** Nothing else functions without Postgres/Redis/MinIO/LiteLLM/Speaches/Traefik scaffolding; observability hooks must exist before the first wire endpoint is implemented so the conformance suite can attach traces.
**Delivers:** `docker-compose.yml` with Traefik + Postgres 17 + PgBouncer + Redis/Valkey + MinIO + LiteLLM v1.83.7-stable + Speaches + OTel Collector + Tempo + Loki + Mimir/Prometheus + Grafana; healthchecks; bootstrap.sh that generates secrets; first-launch HTTPS via Caddy/mkcert; no-default-secrets refuse-to-start runtime check; tenant + user + session + usage_ledger schema with RLS DDL + RLS-introspection lint; "default" tenant bootstrap.
**Uses:** PostgreSQL 17, PgBouncer 1.23+, Drizzle schema, Traefik 3, OTel Collector, LGTM stack, Valkey 8.
**Avoids:** Pitfall #6 (RLS missing on new tables — lint enforces from day 1), #10 (PgBouncer transaction-pool RLS leak — `SET LOCAL` discipline baked into framework middleware), #27 (default secrets — compose has none), #28 (HTTPS-only friction — local CA in bootstrap), #29 (first-launch > 5 min — CI smoke gate).

### Phase 2: Auth + Wire-API Skeleton

**Rationale:** Desktop client cannot exercise any other endpoint without a valid bearer token. The wire-contract conformance suite is bootstrapped here. Every Phase 2 deliverable has a contract test before implementation (TDD).
**Delivers:** Better Auth integration in Fastify; `/api/check-user`, `/api/auth/verification-status` (with 5s polling carve-out from rate limiter), `/api/auth/delete-account`; OAuth shim `/api/desktop-signin/{provider}` with channel-scheme echo + allow-list; `oauth_state` table; opaque-bearer issue + URL-safe-base64 regex enforcement; cookie + bearer dual-auth middleware; `set-auth-token` rotation header with ≥ 60s overlap window; HTTP 401 (not 200) on auth failure; global `{error}` envelope; multi-channel redirect matrix test (`openwhispr` / `-dev` / `-staging` / custom); URL-safe token format lint at issuance.
**Uses:** Better Auth v1 (Bearer + JWT + OAuth Provider plugins), email-OTP plugin.
**Implements:** `ARCHITECTURE.md` § 3 (Auth flow data path); satisfies WIRE-01..05, AUTH-01..06.
**Avoids:** Pitfalls #1 (200-vs-401), #4 (hardcoded scheme), #5 (cookie host-scoping — split-host integration test), #6 (OAuth state cookie loss — HTML error page on mismatch), #7 (URL-unsafe bearer — token regex), #8 (rotation race — overlap window), #9 (refresh window outside 60s grace — long-lived tokens, no scheduled rotation).

### Phase 3: LiteLLM + Speaches Default Backend

**Rationale:** With auth in place, the next wire-required endpoints are `/api/transcribe` + `/api/reason` — these validate the LiteLLM/Speaches sidecar topology, virtual-key minting, and the quota pre-check pattern. Realtime/streaming come next phase to keep buffering bugs separate.
**Delivers:** `docs/litellm-config-spec.md` (derived from `speaches-audio.md`); LiteLLM v1.83.7-stable pinned + diarization E2E test; per-user virtual-key minting via `/key/generate`; `/api/transcribe` end-to-end with multipart streaming + quota pre-check + `200 + limitReached:true` mapping; `/api/reason` end-to-end; Speaches readiness probe with canary transcription (warm-up); Whisper RU/EN alias canary tests; diarization-transcription stitching algorithm; `usage_ledger` writes with idempotency on `request_id`.
**Uses:** LiteLLM Proxy v1.83.7-stable+ (NOT shipping the backport patch), Speaches `master-cuda-12.6.3+`, Drizzle migrations, BullMQ for spend-log ingestion.
**Implements:** `ARCHITECTURE.md` § 2.1 hot-path; satisfies LITELLM-01..05, WIRE-10..11.
**Avoids:** Pitfalls #2 (4xx on quota), #14 (LiteLLM v1.82.x multipart bug — pinned + delete patch), #15 (pass-through unmetered — nginx-log + reconciliation job), #17 (Speaches cold-start), #18 (Whisper alias misconfig), #19 (diarization separate from transcription — server-side stitch), #38 (multipart upload DoS — three-tier size cap).

### Phase 4: Streaming + Realtime

**Rationale:** Streaming endpoints carry the highest concentration of buffering/timeout pitfalls; isolating them in their own phase lets the proxy chain be tuned and verified end-to-end.
**Delivers:** `/api/agent/stream` NDJSON line-flushed with explicit `res.flush()` + `X-Accel-Buffering: no` + per-route `proxy_buffering off`; `/api/agent/web-search`; first-line-latency contract test (< 500ms through full ingress chain); WSS `/v1/realtime` Option A (direct desktop ↔ LiteLLM-fronted Speaches) with 3600s ingress timeouts; `/api/openai-realtime-token` (with `streams=2` returning `clientSecrets[]`), `/api/streaming-token`, `/api/deepgram-streaming-token`; OpenAI-Realtime-spec per-event compatibility matrix vs Speaches; 65-min WSS smoke test; sticky-session ingress hashing for in-flight WSS pods.
**Implements:** `ARCHITECTURE.md` §§ 2.2 + 2.3 hot paths; satisfies WIRE-12..15, SCALE-05.
**Avoids:** Pitfalls #3 (NDJSON buffering), #16 (WSS < 1h timeouts), #20 (Realtime spec compatibility), #22 (general reverse-proxy buffering — per-route catalogue), #23 (slow-client backpressure).

### Phase 5: Multi-Provider Abstraction

**Rationale:** With LiteLLM happy-path stable in Phase 3, the abstraction is now shaped by real-world needs (not over-engineered up-front). DIFF-01 (per-tenant provider override) is the load-bearing differentiator and **must be designed tenant-scoped from day 1** of this phase to avoid an L-sized retrofit.
**Delivers:** Typed `LLMProvider`/`STTProvider`/`RealtimeProvider`/`StorageProvider`/`EmailProvider`/`BillingProvider`/`IdPProvider` interfaces (`ARCHITECTURE.md` § 5); adapters for direct OpenAI/Anthropic/Gemini/Mistral/Bedrock/Azure OpenAI/Vertex (LLM); AssemblyAI/Deepgram/OpenAI-Whisper/Groq (STT); OpenAI-Realtime/AssemblyAI/Deepgram-streaming (Realtime); S3/GCS/Azure-Blob (Storage); SES/SendGrid/Postmark (Email); Stripe + null-adapter (Billing); generic OIDC + Google/Microsoft/Apple/GitHub (IdP); per-tenant config resolver with hot-reload-safe snapshots via Postgres LISTEN/NOTIFY; **mock provider for the sandbox tenant (DIFF-03)**.
**Implements:** Satisfies PROVIDER-01..07, DIFF-01..03.
**Avoids:** Future retrofit cost; per-tenant data-residency violations (#41) by enforcing `tenant.allowed_providers` allow-list at provider-selection layer.

### Phase 6: Quotas + Billing + Referrals

**Rationale:** Ledger and billing math depend on real upstream calls to validate counts, so this comes after providers stabilize.
**Delivers:** `usage_ledger` (append-only, daily-partitioned); `usage_summary_view` materialized + worker-driven daily rollup; LiteLLM spend-log ingestion BullMQ job (every 30s, idempotent on `litellm_request_id`); pass-through metering via Loki/nginx access-log parser; daily reconciliation alert; Stripe `/api/stripe/{checkout,portal,switch-plan,preview-switch}` with signature verification on webhooks; `/api/streaming-usage`, `/api/usage`, `/api/stt-config`, `/api/note-recording-config`; referrals `/api/referrals/{stats,invite,invites}` with worker-queued email send + delivery retry.
**Implements:** Satisfies WIRE-13..17, DATA-03, OBS-04.
**Avoids:** Pitfalls #15 (pass-through unmetered), #25 (usage-ledger VACUUM bloat — append-only + partition design + tuned autovacuum).

### Phase 7: Observability + Ops Hardening + Background Jobs

**Rationale:** With the wire surface complete and metering live, cross-cutting concerns (tracing, logging, audit, security) can be wired as a coherent layer rather than incrementally.
**Delivers:** End-to-end OTel tracing API → LiteLLM → Speaches; structured JSON logs with correlation IDs and **bearer-scrubbing middleware** (sentinel-token test); audit_log table writes for auth events, account deletion, key issuance, quota changes, provider config changes, cross-tenant attempts; SSRF-safe HTTP client (private-IP block + DNS-rebinding defense) for all server-side outbound (webhooks, OIDC discovery, federated callbacks); Grafana dashboards (RED + saturation + LiteLLM spend) shipped in-tree; **telemetry default OFF** with auditable debug endpoint; BullMQ worker tier with **tenant-context middleware** that re-establishes DB GUC + log MDC + OTel before handler invocation (CI introspection gate).
**Implements:** Satisfies OBS-01..04, DATA-04, SCALE-03, SCALE-04.
**Avoids:** Pitfalls #12 (background-job tenant context loss), #36 (telemetry default), #39 (SSRF in webhooks), #40 (bearer in logs).

### Phase 8: Frontend UI-SPEC

**Rationale:** UI implementation is explicitly out of v1 scope; UI-SPEC.md is the deliverable per UI-01/02. Spec targets the recommended Next.js 15 + shadcn/ui stack so downstream code generation produces consistent output.
**Delivers:** `UI-SPEC-admin.md` (tenants, users, API keys, quotas, providers, audit log, observability links, billing) + `UI-SPEC-end-user.md` (profile, plan, usage, referrals, account deletion); component inventory enumerated by shadcn/ui name; WCAG 2.2 AA + responsive + design-system standards; locale negotiation chain documented; mock screenshots / Figma-equivalent.
**Implements:** Satisfies UI-01..03.

### Phase 9: Load Test + Tuning

**Rationale:** K8s amplifies bugs (per-pod FD limits, HPA flapping, pod-restart mid-WSS). Compose tuned and validated first, then ported to Helm.
**Delivers:** k6 load test of 1000 concurrent active users (transcribe + reason + agent stream + WSS realtime mix per `ARCHITECTURE.md` § 10); validates p95 SLO budgets per endpoint (committed only after this phase, not before); tunes PgBouncer pool, Redis ops/s, Speaches GPU sizing, FD ulimits, Postgres autovacuum, ingress worker_connections; nightly load test in CI against ephemeral environment.
**Implements:** Satisfies SCALE-01..06, TEST-LOAD-01.
**Avoids:** Pitfalls #21 (FD exhaustion), #23 (slow-client backpressure), #24 (PG connection storm), #25 (ledger bloat under sustained writes).

### Phase 10: Helm Chart + Cloud Deploy

**Rationale:** With compose tuned and load-validated, port to K8s. Helm subchart for CNPG, kube-prometheus-stack for observability.
**Delivers:** Single Helm chart with subcharts; CNPG operator integration (PG 17 image catalog override); Traefik 3 ingress with per-route annotations (NOT ingress-nginx — retiring); HPA on API + worker tiers; GPU node-selector for Speaches; cert-manager for TLS; `helm install --values` + `helm upgrade` paths; **online-migration discipline** (CONCURRENTLY indexes, NOT VALID then VALIDATE constraints, batched column adds) with `squawk` or `pgroll` lint; **upgrade-matrix CI test** (install N-1, populate data, upgrade to N, assert health and integrity); separate `/healthz`/`/readyz`/`/livez` probes.
**Implements:** Satisfies DEPLOY-01..04, DATA-02.
**Avoids:** Pitfalls #26 (locking migrations), #30 (upgrade path breaks).

### Phase 11: i18n + Documentation + OSS Housekeeping

**Rationale:** Locale framework wiring exists from Phase 2 onward (string keys, not literals — enforced by lint), but copy stabilization and full doc suite come last when the surface is no longer changing.
**Delivers:** `en` + `ru` resource files for all user-facing surfaces (UI copy, email templates including subject lines, notification text, end-user-visible error messages); ICU MessageFormat plural rules for Russian (one/few/many/other) with boundary-case snapshot tests; locale-aware `Intl.DateTimeFormat` / `Intl.NumberFormat`; per-tenant locale overrides (DIFF-09); CI gate asserts every `t("key")` exists in both locales; ESLint rule forbids string literals in user-facing surfaces; full DOCS-01..09 deliverables; CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, LICENSE headers, ADRs for every Key Decision, TRADEMARKS.md, compliance.md (GDPR, 152-FZ, data residency).
**Implements:** Satisfies I18N-01..02, DOCS-01..09, TEST-I18N-01.
**Avoids:** Pitfalls #31 (hard-coded English), #32 (CLDR pluralization), #33 (date/number formatting), #34 (email subject not localized), #35 (license leakage), #37 (trademark).

### Phase Ordering Rationale

- **Phase 0 → 1 → 2 is the critical path:** repo bootstrap (constitutional rules) → infrastructure (Postgres+RLS+observability scaffolding) → auth (the desktop cannot exercise any other endpoint without a valid bearer).
- **Auth (Phase 2) before LiteLLM happy-path (Phase 3):** smoke-testing transcribe needs auth.
- **Sync endpoints (Phase 3) before streaming (Phase 4):** sync flushes out provider/quota plumbing without time pressure of buffering bugs; streaming pitfalls (NDJSON flush, WSS timeouts, proxy buffering) are isolated to their own phase.
- **LiteLLM happy-path (Phase 3) before multi-provider (Phase 5):** abstraction is shaped by real-world LiteLLM/Speaches needs; building abstractions first risks over-engineering and incorrect interface boundaries.
- **Providers stable (Phase 5) before quotas/billing (Phase 6):** ledger needs real upstream calls to validate counts and reconciliation.
- **Wire surface complete (Phases 2-6) before observability hardening (Phase 7):** tracing, audit, SSRF defense, scrubbing are cross-cutting; wiring incrementally creates inconsistent coverage.
- **Compose tuned + load-tested (Phase 9) before Helm (Phase 10):** K8s amplifies bugs; tune in compose first, then port.
- **i18n + docs (Phase 11) at end:** stable copy is harder to translate twice; but locale-key framework exists from Phase 2 (lint forbids string literals from day 1).
- **Phase 8 (UI-SPEC) is decoupled** — can run in parallel with Phase 5-7 since it doesn't block backend work.
- **Conformance suite (DIFF-12) is incremental, not a final phase:** every wire-required endpoint adds a contract test in the same PR that implements it. By Phase 6 the suite is the regression net for the entire wire surface.

### Research Flags

Phases that — based on pitfall density and severity per `PITFALLS.md` § Phase Research-Depth Flags — should plan for additional `/gsd-research-phase` work before implementation:

- **Phase 2 (Wire/Auth contract):** **HIGH research depth.** 9 critical pitfalls (#1, #4, #5, #6, #7, #8, #9, plus contract baseline). Needs a full contract-test harness scaffold and the multi-channel redirect matrix locked before the OAuth shim is written.
- **Phase 3 (Multi-tenancy + Schema + RLS):** **HIGH research depth.** 6 critical pitfalls (#5, #6, #11, #12, #25, #41). RLS + PgBouncer transaction-pool interaction is a known footgun; a focused spike on `SET LOCAL` discipline + framework middleware contract is required before any tenant-scoped code lands.
- **Phase 4 (LiteLLM/Speaches integration):** **HIGH research depth.** 8 critical pitfalls (#3, #14, #15, #16, #17, #18, #19, #20). LiteLLM behavior is the most-cited risk class in `speaches-audio.md`; needs the Realtime per-event compatibility matrix authored first.
- **Phase 6 (Scale + load test):** **MEDIUM-HIGH research depth.** 4 critical pitfalls (#21, #23, #24, #25). Realistic 1000-user simulation plan is non-trivial — k6 scenario design needs to mix transcribe + reason + stream + WSS at the right ratios.
- **Phase 7 (Observability + Jobs):** **MEDIUM research depth.** 4 pitfalls (#12, #36, #39, #40). Standard patterns but cross-cutting; SSRF-safe HTTP client and bearer-scrubbing middleware need careful specification.
- **Phase 10 (Deploy):** **MEDIUM.** 5 pitfalls (#16, #22, #27, #28, #29, #30). Well-understood but operator UX SLO is tight (< 5 min first-launch).
- **Phase 11 (OSS readiness + i18n):** **MEDIUM.** 7 pitfalls (#31, #32, #33, #34, #35, #37, #41). Process discipline rather than design depth.

Phases with standard patterns (skip dedicated research-phase, proceed directly to planning):

- **Phase 0 (Repo bootstrap):** mainstream TypeScript monorepo + GitHub Actions; fully covered by stack research.
- **Phase 1 (Core infra compose):** docker-compose + standard service composition; sizing covered.
- **Phase 5 (Multi-provider abstraction):** typed-interface boilerplate; LiteLLM patterns shaped in Phase 3 inform the design.
- **Phase 8 (UI-SPEC authoring):** spec-only deliverable; well-bounded.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | **HIGH** | All primary picks verified against current 2026 releases (LiteLLM v1.83.7-stable, PG 17.9, CNPG 1.29, Node 24 LTS, Fastify 5, Better Auth 1.x); multi-arch confirmed for every infrastructure component; two load-bearing version findings explicitly verified (LiteLLM multipart fix native in v1.83.7; ingress-nginx EOL March 2026). One MEDIUM area: LGTM logs SDK status (Vector vs OTel Collector logs — OTel Collector is stable but newer in this role). |
| **Features** | **HIGH** | Wire-required features are sourced directly from the upstream specs (`BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md`); platform-level features cross-referenced against widely-deployed adjacent OSS (LiteLLM Proxy, Authentik, Langfuse, Supabase Self-Hosted, OpenWebUI). Anti-features explicit and constructive. |
| **Architecture** | **HIGH** for component decomposition + data-flow shapes (derived directly from upstream specs + production-validated `speaches-audio.md` deployment); **MEDIUM** for sizing math (FD limits, p95 budgets, GPU concurrency) — extrapolated from standard nginx/Linux defaults and 2026 GPU benchmarks; **must be validated under SCALE-06 load test** before being committed as SLO. |
| **Pitfalls** | **HIGH** for upstream-spec-derived items (cross-referenced to `BACKEND_SPEC.md`, `OAUTH_SPEC.md`, `SELF_HOSTING.md`); **HIGH** for LiteLLM/Speaches items (cited from `speaches-audio.md` and PR #25464); **MEDIUM** for general distributed-systems traps (industry-standard knowledge, well-documented). 41 pitfalls with full phase-mapping. |

**Overall confidence:** **HIGH**

### Gaps to Address

1. **Sizing-math validation under load** — all 1000-concurrent capacity numbers (PgBouncer pool depth, Redis ops/s, Speaches GPU concurrency, ingress worker_connections, FD limits, p95 latency budgets per endpoint) are MEDIUM confidence and **must not be committed as SLO until the Phase 9 load test validates them**. Roadmapper: do NOT publish per-endpoint p95 budgets in the operator-facing SLA until Phase 9 completes.
2. **Speaches GPU sizing matrix** — sizing extrapolated from 2026 benchmarks (L40S, H100); operators should load-test their own deployment. Document a sizing matrix in `docs/operations.md`, do not promise specific numbers without measurement.
3. **OpenAI Realtime spec compatibility delta** — Speaches "claims compatibility" but the OpenAI Realtime spec is large; per-event verification matrix must be built in Phase 4 (capture-replay tooling against real desktop session). Until then, assume some events will require server-side workarounds.
4. **LiteLLM pass-through metering reliability** — depending on nginx access-log parsing for billing is novel; daily reconciliation alert + manual audit during the first 30 days post-launch are required.
5. **Multi-host vs single-host cookie scoping** — cookie `Domain` policy interacts subtly with the three pre-auth endpoints. Phase 2 must include a split-host topology integration test; Phase 7 (or Phase 10 deploy docs) must document the cookie-scoping decision tree.
6. **Token rotation policy** — Key Decision needed in Phase 2: TTL length, overlap window length, rotation cadence. Recommended: long-lived (≥ 30d) tokens, ≥ 5min rotation overlap, no scheduled batch rotation.
7. **Per-tenant data residency configuration shape** — the `tenant.allowed_providers` schema needs Phase 5 design work; the v1 cut may be limited to "allow/deny per provider id" with full geographic-policy expression deferred to v1.5.
8. **BACKEND_SPEC.md and OAUTH_SPEC.md completeness** — research relies on 1556 lines of upstream documentation. Live runtime trace validation against the OpenWhispr cloud is explicitly out of v1 scope (defers to v2); the conformance suite (DIFF-12) is the v1 substitute. There is residual risk that some endpoint behavior is under-documented; the generic passthrough channel (TS-W-19) absorbs new endpoints discovered post-launch.

---

## Sources

### Primary (HIGH confidence)

- `/Users/dev/openwhispr/docs/BACKEND_SPEC.md` — per-endpoint contract, conventions, global error envelope, custom-protocol redirect, NDJSON streaming
- `/Users/dev/openwhispr/docs/OAUTH_SPEC.md` — OpenWhispr Cloud Sign-In flow, channel-scheme echo, custom-protocol reference
- `/Users/dev/openwhispr/docs/SELF_HOSTING.md` — wire walkthrough, edge cases, minimum viable backend checklist
- `/Users/dev/openwhispr-server/speaches-audio.md` — ExampleCorp production LiteLLM v1.82.3 + Speaches `master-cuda-12.6.3` deployment; multipart-passthrough patch reference
- `/Users/dev/openwhispr-server/.planning/PROJECT.md` — requirement IDs (WIRE-*, AUTH-*, LITELLM-*, PROVIDER-*, DATA-*, SCALE-*, OBS-*, UI-*, DEPLOY-*, DOCS-*, I18N-*, TDD-*, CI-*, CONTRACT-*, TEST-*, DEVEX-*); Out of Scope; Constraints
- [LiteLLM v1.83.7-stable release notes (multipart-passthrough fix native)](https://docs.litellm.ai/release_notes/v1.83.7/v1-83-7-stable)
- [LiteLLM PR #25464 — fix multipart pass-through](https://github.com/BerriAI/litellm/pull/25464)
- [Kubernetes blog: Ingress NGINX retirement (March 2026 EOL)](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
- [PostgreSQL 17 release notes + 17.6/17.9 minor releases](https://www.postgresql.org/about/news/postgresql-17-released-2936/)
- [CloudNativePG 1.29 release](https://cloudnative-pg.io/releases/cloudnative-pg-1-29.0-released/)
- [Better Auth official site](https://better-auth.com/) + Bearer / JWT / OAuth Provider plugin docs
- [Fastify 5 official docs](https://fastify.dev/) + `@fastify/multipart`, `@fastify/websocket`, `@fastify/http-proxy`
- [Node.js 24 LTS GA](https://vercel.com/changelog/node-js-24-lts-is-now-generally-available-for-builds-and-functions); [Node 20 EOL Apr 2026](https://pocketlantern.dev/briefs/node-20-eol-april-2026-upgrade-path)
- [Speaches Realtime API docs](https://speaches.ai/usage/realtime-api/)
- [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)

### Secondary (MEDIUM confidence)

- [Whisper v4 / Speaches GPU production guide 2026 — Spheron](https://www.spheron.network/blog/whisper-v4-asr-gpu-cloud-production-guide/) — sizing benchmarks
- [Best OSS STT models 2026 benchmarks — Northflank](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [Drizzle vs Prisma 2026 — Bytebase / makerkit / Encore comparisons](https://www.bytebase.com/blog/drizzle-vs-prisma/)
- [PgBouncer vs Supavisor 2026](https://www.pkgpulse.com/blog/pgbouncer-vs-pgcat-vs-supavisor-postgresql-connection-2026)
- [BullMQ vs alternatives 2026](https://npmtrends.com/better-queue-vs-bullmq-vs-graphile-worker-vs-kue-vs-pg-boss); [graphile-worker scaling caveats — HN](https://news.ycombinator.com/item?id=46614277)
- [LGTM stack with OpenTelemetry 2026 guide](https://oneuptime.com/blog/post/2026-02-06-lgtm-stack-opentelemetry/view)
- [shadcn/ui Next.js 15 + React 19 + Tailwind v4 docs](https://ui.shadcn.com/docs/react-19)
- [i18next + i18next-icu](https://www.i18next.com/) (CLDR plural rules for Russian)
- Adjacent OSS projects (LiteLLM Proxy, Langfuse, OpenWebUI, Supabase Self-Hosted, Authentik) — feature-table calibration

### Tertiary (LOW confidence — needs validation)

- 1000-concurrent sizing math per `ARCHITECTURE.md` § 10 — based on standard nginx/Linux defaults and adjacent stack patterns; **must be validated under SCALE-06 load test**
- LiteLLM webhook spend-log delivery semantics under heavy load — assumed eventually-consistent; first-30-day audit recommended
- Speaches Realtime claim of "OpenAI Realtime API compatibility" — must be verified event-by-event in Phase 4

---

*Research synthesized: 2026-05-08*
*Ready for roadmap: yes*
