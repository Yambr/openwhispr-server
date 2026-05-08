# Stack Research

**Domain:** Open-source, enterprise-grade, self-hosted, wire-compatible OpenWhispr backend (1000 concurrent users)
**Researched:** 2026-05-08
**Overall confidence:** HIGH (all primary recommendations verified against current 2026 releases; multi-arch availability confirmed for every infrastructure component)

---

## TL;DR — One-Line Picks

| Layer | Pick | Version | Confidence |
|---|---|---|---|
| Runtime | Node.js (Active LTS) | **24.x** | HIGH |
| HTTP framework | **Fastify** | **5.x** | HIGH |
| Auth library | **Better Auth (server)** + Bearer plugin + JWT plugin | **1.x** | HIGH |
| Database | **PostgreSQL** | **17.x** | HIGH |
| Schema/ORM | **Drizzle ORM** + **drizzle-kit** | latest | HIGH |
| Pooler | **PgBouncer** transaction mode | **1.23+** | HIGH |
| HA Postgres (K8s) | **CloudNativePG operator** | **1.29.x** | HIGH |
| Cache / rate-limit / WS fan-out | **Redis** (or Valkey) | **7.4 / 8.x** | HIGH |
| Job queue | **BullMQ** | latest | HIGH |
| LLM/audio gateway (default) | **LiteLLM Proxy** | **v1.83.7-stable or newer** (multipart-passthrough fix native) | HIGH |
| ASR/Realtime backend (default) | **Speaches** (`speaches-local:master-cuda-12.6.3` or newer) | latest master | HIGH |
| Object storage (self-host) | **MinIO** (S3-compatible) | latest | HIGH |
| Observability | **OpenTelemetry SDK → OTel Collector → Tempo + Mimir/Prometheus + Loki + Grafana** | LGTM stack | HIGH |
| Logs shipping | **OTel Collector** (no Vector required) | — | MEDIUM |
| Container orchestration | **docker-compose** (single-host) + **Helm chart** (K8s) | — | HIGH |
| Ingress (K8s) | **Traefik** (primary) or **Envoy Gateway / Contour** | Traefik 3.x | HIGH |
| i18n | **i18next** + **i18next-http-middleware** + **accept-language-parser** | latest | HIGH |
| Frontend (UI-SPEC target) | **Next.js 15 (App Router) + React 19 + Tailwind 4 + shadcn/ui** | latest | HIGH |

---

## 1. Application Runtime + Framework

### Primary: **Node.js 24 LTS + Fastify 5 (TypeScript)**

**Why this — concrete fit to the requirements:**

1. **NDJSON line-flushing on `/api/agent/stream`** — Fastify's reply API exposes the raw `reply.raw` Node stream; you can `reply.raw.write(line + '\n')` and `reply.raw.flushHeaders()` to guarantee per-line flush with no buffering. This is a one-liner; many frameworks (Express middleware chains, NestJS interceptors) make this harder by buffering through abstractions. ([fastify.dev](https://fastify.dev/))
2. **Multipart audio uploads on `/api/transcribe`** — `@fastify/multipart` v10.x is the canonical, battle-tested implementation with stream-mode support so audio bytes can be **piped straight to LiteLLM** without buffering the whole upload to disk/memory. ([@fastify/multipart on npm](https://www.npmjs.com/package/@fastify/multipart))
3. **WSS proxy for `/v1/realtime` with 1h timeouts** — `@fastify/websocket` + `@fastify/http-proxy` (whose `wsUpstream` setting accepts `wss://` upstreams) is the standard idiomatic recipe; Node 24 ships **undici v7** which improves long-lived connection handling and HTTP/2 support natively. ([fastify-http-proxy](https://github.com/fastify/fastify-http-proxy), [Node.js 24 LTS GA](https://vercel.com/changelog/node-js-24-lts-is-now-generally-available-for-builds-and-functions))
4. **Better-Auth-compatible cookie + bearer + `set-auth-token`** — Better Auth itself is **a TypeScript library that runs on the same Node.js HTTP server**. Co-locating auth in the same Fastify process eliminates a hop, makes `set-auth-token` rotation trivial (`reply.header('set-auth-token', newToken)`), and matches the desktop client's wire shape exactly. ([better-auth.com](https://better-auth.com/), [Bearer Token plugin](https://better-auth.com/docs/plugins/bearer))
5. **Horizontally stateless at 1000 concurrent** — Fastify's overhead per request is ~30k req/s on commodity hardware; with 1000 concurrent **active** users hitting transcribe/reason/stream endpoints, the bottleneck will be GPU (Speaches) and Postgres, not the API tier. Fastify scales linearly with `node --cluster`/PM2 or Kubernetes HPA on CPU. ([fastify.dev](https://fastify.dev/))
6. **Operator-friendly self-host** — Node 24 has multi-arch official images (`node:24-bookworm-slim` for amd64+arm64), `npm ci` is reproducible, and there's no compile step at deploy time (TS → JS in CI).

**Node version pin:** **Node.js 24.x (Active LTS, codename Krypton, became LTS Oct 2025)**. Node 22 is now Maintenance LTS through Apr 2027; 24 is the recommended runtime for new 2026 projects. Node 20 reached EOL **2026-04-30** — do not start there. ([Node.js 24 LTS upgrade guide](https://www.pkgpulse.com/guides/nodejs-24-lts-upgrade-from-node-22-2026), [Node 20 EOL](https://pocketlantern.dev/briefs/node-20-eol-april-2026-upgrade-path))

### Alternatives considered

| Option | Verdict | Why not primary |
|---|---|---|
| **NestJS 11 (on Fastify adapter)** | Strong second choice for >5-engineer teams | Heavyweight DI/decorators add friction for a wire-compatible OSS server where contributors land patches across the whole tree. The Fastify adapter underneath is what we'd use anyway — skip the abstraction. ([NestJS vs Fastify 2026](https://www.pkgpulse.com/blog/nestjs-vs-fastify-2026)) |
| **Hono 4** | Excellent runtime; not chosen | Hono targets edge/serverless (Cloudflare Workers, Bun, Deno). On long-running Node servers with multipart streams and WSS, the Web-Standards `Request`/`Response` model adds friction. Self-hosters know Node, not Bun. ([Encore comparison](https://encore.dev/articles/nestjs-vs-fastify-vs-hono)) |
| **Go (Echo/chi/Fiber)** | Better raw perf | But: Better Auth is TypeScript-only, multipart-passthrough patches are TS, the desktop client is TS — staying in TS keeps one shared mental model and one toolchain for the OSS contributor pool. |
| **Python/FastAPI** | Cohabits well with LiteLLM (also Python/FastAPI) | But: GIL-bound, `asyncio` multipart streaming is fiddly, NDJSON flushing requires SSE-adjacent tricks, ecosystem is less reliable for production WSS proxying than Node's undici. |
| **Rust (Axum)** | Best perf, hardest hire | OSS contributor pool for backend work is 10× smaller than TS. Hard project rule favors **boring**. |
| **Elixir/Phoenix** | BEAM is great for WSS at 1000 concurrent | But same hiring/contributor problem, and the rest of the LiteLLM/Better Auth ecosystem is TS/Python. |

### What NOT to use

- **Express 4/5** — no schema validation, no first-class streaming primitives, `req.pipe(res)` works but contributors have to learn its quirks. Fastify is strictly better.
- **Koa** — minimal, but the same composition issues as Express; no longer the active mainstream.
- **NestJS with Express adapter** — pays the abstraction tax twice.
- **Bun runtime in production** — getting closer but still not the boring choice for self-hosted enterprise as of mid-2026.

---

## 2. Auth Library / Server

### Primary: **Better Auth (server) v1.x with Bearer + JWT + Email-OTP plugins, embedded in the Fastify process**

**Why this is the right fit:**

The desktop client is already a Better Auth **client**. The wire contract (opaque bearer in `Authorization: Bearer ...`, session cookie fallback, `set-auth-token` rotation header on auth-client responses, `x-openwhispr-source: desktop`) is **exactly** what Better Auth server emits when configured with the Bearer plugin. Implementing this contract from scratch on top of Lucia or Authelia means re-inventing the rotation header, the cookie/bearer dual-attach, and the `/api/auth/*` routes — all of which Better Auth gives you for free.

**Confirmed capabilities (verified 2026):**
- Self-hosted server library that runs in any Node.js HTTP server (Fastify integration via `fastify.all('/api/auth/*', ...)` adapter pattern). ([better-auth.com](https://better-auth.com/), [GitHub](https://github.com/better-auth/better-auth))
- **Bearer plugin** intercepts requests and converts the `Authorization: Bearer ...` header into the session lookup — exactly the desktop's main-process call path. ([Bearer plugin docs](https://better-auth.com/docs/plugins/bearer))
- **Opaque bearer support** — JWT plugin can be configured to keep access tokens opaque (with optional prefix), matching the spec's "client never inspects the token contents" requirement. ([JWT plugin](https://better-auth.com/docs/plugins/jwt))
- **`set-auth-token` rotation** — emitted automatically on Better Auth client calls when sessions are extended or rotated. This is the exact header the desktop's `tokenStore.js` listens for.
- **OAuth 2.1 Provider plugin** lets you host the `/api/desktop-signin/{provider}` shim natively, with Google/Microsoft/Apple/GitHub providers built-in and OIDC/SAML extensible. ([OAuth Provider docs](https://better-auth.com/docs/plugins/oauth-provider))
- Recent (2026) updates added `customTokenResponseFields` callback (lets us inject `bearer_token` into the protocol-redirect URL cleanly) and structured RFC 6749 error responses on all six OAuth endpoints.

**Multi-tenancy:** Better Auth's organization plugin handles tenant scoping; tokens carry `org_id` claim. Satisfies AUTH-05.

### Alternatives considered

| Option | When it wins | Why not primary |
|---|---|---|
| **Lucia** | If you want a smaller surface and to write more glue yourself | No equivalent of `set-auth-token` rotation header out of the box; you'd reimplement Better Auth's wire shape. Maintainer also pivoted Lucia to "learn-by-example" rather than a library. |
| **Ory Kratos + Hydra** | Large enterprise with existing OIDC infrastructure | Two services, Go-based; integration with Better Auth's exact wire shape (set-auth-token, x-openwhispr-source) requires a TS shim layer anyway. Operator complexity 3-4× higher. ([Cerbos OSS auth roundup 2026](https://www.cerbos.dev/blog/best-open-source-auth-tools-and-software-for-enterprises-2026)) |
| **Keycloak / Authelia / Authentik / Zitadel** | Operators who already run one of these | All emit OIDC/JWT. To match the desktop's opaque-bearer + `set-auth-token` contract you must front them with a Better-Auth-compatible adapter regardless. **Recommended pattern: wire them up as upstream IdPs behind Better Auth's OAuth Provider plugin** — operator gets enterprise SSO, desktop sees Better Auth's contract. ([Top OSS Auth0 alternatives 2026](https://www.authgear.com/post/top-open-source-auth0-alternatives/)) |

### What NOT to use

- **Roll-your-own JWT** — re-implementing `set-auth-token` rotation, opaque-vs-signed semantics, and the OAuth flow is multi-month work; Better Auth has it tested.
- **NextAuth/Auth.js without Better Auth** — Next.js-coupled, doesn't expose the bearer header rotation contract the desktop expects.
- **Passport.js** — strategy framework, not an auth server. Doesn't solve the wire-shape problem.

### Multi-arch / packaging
Pure TypeScript library — runs anywhere Node 24 runs, no native bindings. ✅

---

## 3. Database Stack

### Primary: **PostgreSQL 17.x + Drizzle ORM + drizzle-kit migrations + PgBouncer (transaction mode) + CloudNativePG (HA on K8s)**

#### PostgreSQL 17.x

PostgreSQL 17 GA was September 2024; the current minor is **17.9 (released 2026-02-26)**, EOL November 2029. PG 18 is now the default in CloudNativePG 1.29 (default image catalog), but **17 is the safer pick for v1** — broader extension compatibility, more battle-tested operator runtimes, and `pg_jsonschema` / `pgvector` / `pg_partman` ecosystem fully aligned. ([PG 17 release notes](https://www.postgresql.org/about/news/postgresql-17-released-2936/), [PG 17.6 notes](https://www.postgresql.org/docs/release/17.6/), [endoflife.date](https://endoflife.date/postgresql))

**Why 17 specifically:** vacuum memory rewrite (lower bloat under heavy multi-tenant ledger inserts), high-concurrency lock contention improvements (matters at 1000 concurrent), bulk-load speedups (matters for spend-log ingestion from LiteLLM).

PROJECT.md constraint says "Postgres 16+"; 17 satisfies and is current.

#### Drizzle ORM + drizzle-kit (NOT Prisma)

**Why Drizzle over Prisma:**

| Criterion | Drizzle | Prisma |
|---|---|---|
| TypeScript-native schema | ✅ schema = TS file | ❌ proprietary `.prisma` DSL |
| Query engine | None (pure SQL builder) | Rust binary (Prisma engine) — extra layer, boot latency |
| PgBouncer transaction-mode compat | ✅ native | ❌ requires `pgbouncer=true` flag, prepared-statement workarounds |
| Edge/serverless | Less relevant for self-hosted, but fine | Requires Prisma Accelerate (paid) for serverless pooling |
| Bundle size / boot time | Smaller, faster | Slower cold start due to engine |
| Migration model | SQL-first; you can hand-edit migrations | Declarative; Prisma owns the migration |
| Multi-tenant RLS (DATA-01) | Easy — drop to raw SQL when needed | Awkward — RLS sits outside Prisma's mental model |

For a self-hosted server that lives behind PgBouncer (for 1000-concurrent connection multiplexing) and uses Postgres RLS for tenant isolation, **Drizzle is the correct call**. ([Drizzle vs Prisma 2026, makerkit](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma), [Bytebase comparison](https://www.bytebase.com/blog/drizzle-vs-prisma/), [Encore comparison](https://encore.dev/articles/drizzle-vs-prisma))

**Migrations:** `drizzle-kit generate` produces forward-only SQL files. Satisfies DATA-02 (forward-only versioning) and DEPLOY-04 (safe during rolling deploy — migrations are SQL files reviewed in PR, never auto-applied at app boot).

#### Connection pooling: PgBouncer 1.23+ (transaction mode)

- **PgBouncer** is the boring, battle-tested choice. Single static binary, ~2MB RAM per 1000 clients, transaction-mode pooling lets us multiplex thousands of API connections onto ~50 backend Postgres connections.
- **Prepared-statement support** in PgBouncer 1.23+ (`max_prepared_statements = 200`) handles Drizzle's prepared statements transparently; this used to be a footgun but is solved as of 2024.
- For SCALE-02 (sized for 1000 concurrent): PgBouncer pool size 100 backend × 4 PgBouncer instances = comfortable ceiling at 1000 concurrent active sessions.
([PgBouncer vs Supavisor 2026](https://www.pkgpulse.com/blog/pgbouncer-vs-pgcat-vs-supavisor-postgresql-connection-2026), [Production Postgres Pooling 2026](https://nerdleveltech.com/production-postgres-pooling-pgbouncer-supabase-supavisor-tutorial))

**Alternative: Supavisor** — Elixir-based, multi-tenant aware, scales further but adds Erlang runtime to the operator's plate. Pick this only if hitting >5000 concurrent or doing multi-region. Not justified at 1000.

#### HA topology

- **K8s deployments → CloudNativePG operator 1.29.x.** CNCF Sandbox project, defaults to PG 18 image catalogs (we override to 17), supports streaming replication, automated failover, base backups to S3-compatible storage, scheduled maintenance. The mainstream choice in 2026. ([CNPG 1.29 release](https://cloudnative-pg.io/releases/cloudnative-pg-1-29.0-released/), [CNPG GitHub](https://github.com/cloudnative-pg/cloudnative-pg))
- **Single-host docker-compose deployments → vanilla Postgres 17 container** with WAL archive to local volume + cron-driven `pg_basebackup`. HA is best-effort for self-host single-VM (operator's call to add a replica).

**Alternatives:**
- **Patroni** — proven but operator-heavy; Helm charts less polished than CNPG.
- **Stolon** — abandoned-feeling; not recommended in 2026.

### What NOT to use

| Avoid | Why | Use instead |
|---|---|---|
| **Prisma** | Proprietary DSL, Rust engine boot latency, awkward with PgBouncer transaction mode | Drizzle |
| **TypeORM** | Slow to evolve, decorator-heavy, schema drift footguns | Drizzle |
| **Sequelize** | Legacy, not type-safe enough for 2026 | Drizzle |
| **MySQL/MariaDB** | PROJECT.md says PG-only, non-negotiable | — |
| **DynamoDB / Mongo** | Multi-tenant RLS + relational ledger doesn't fit document stores | — |
| **Postgres 16** | Allowed by PROJECT but 17 is current and free | Postgres 17 |
| **Postgres 18** | Too new for v1 production self-host (some extensions lag) | Postgres 17 (revisit at v1.x) |

### Multi-arch ✅
- `postgres:17-bookworm` — amd64 + arm64 ✅
- `bitnami/pgbouncer` — amd64 + arm64 ✅
- CloudNativePG controller — amd64 + arm64 ✅

---

## 4. LiteLLM Integration

### Primary: **LiteLLM Proxy v1.83.7-stable (or newer) as a separate sidecar service in docker-compose / its own Deployment in K8s**

#### Multipart-passthrough fix — **NATIVELY FIXED in v1.83.7-stable** ✅

This is the load-bearing version answer for this research:

> **LiteLLM v1.83.7-stable contains the fix natively.** Backport patch (`patches/fix_passthrough_multipart.py`) is **NO LONGER REQUIRED** for v1.83.7+ deployments.

**Source of truth:**
- [LiteLLM v1.83.7-stable release notes](https://docs.litellm.ai/release_notes/v1.83.7/v1-83-7-stable) — explicitly lists "Fix proxy pass-through multipart uploads and Bedrock JSON body" by @shivamrawat1 in [PR #25464](https://github.com/BerriAI/litellm/pull/25464).
- [LiteLLM GitHub releases](https://github.com/BerriAI/litellm/releases/tag/v1.83.7-stable) — confirms the merge.

**Action for our backend:** pin `ghcr.io/berriai/litellm-non_root:main-v1.83.7-stable` (or newer; v1.83.14-stable is even more recent as of 2026-04). DO NOT ship the backport patch from `speaches-audio.md` line 183 — it was for the v1.82.3 era.

**Note:** `speaches-audio.md` references the bug but **does not say the fix is unmerged**; the PR was already in v1.83.7-stable when that doc was written. The patch file in the ExampleCorp repo is a relic of their v1.82.3 deployment timeline.

#### Deployment topology: **separate service, not in-process**

- **Sidecar container in docker-compose** (single host) — `litellm` service alongside `api`, `postgres`, `redis`, `speaches`. One LiteLLM instance per host.
- **Separate Deployment in K8s Helm chart** — own pod, own HPA (LiteLLM is Python/FastAPI; scales vertically less well than our Node API tier; HPA on CPU works fine).
- **Why not embedded:** LiteLLM is a Python service. Embedding means polyglot deploys, two language runtimes per container, complicated Dockerfile. Sidecar is **boring and operator-friendly** — restart LiteLLM independently when bumping versions.

LiteLLM has its own Postgres (we co-tenant: same Postgres cluster, separate database `litellm`) and Redis (shared with our API tier).

#### Per-user virtual key minting/rotation

Use LiteLLM's `/key/generate` API:

```
POST {LITELLM_URL}/key/generate
Authorization: Bearer {LITELLM_MASTER_KEY}
{
  "user_id": "<our-user-uuid>",
  "team_id": "<tenant-id>",
  "max_budget": 100.0,
  "duration": "30d",
  "key_alias": "user-<email>",
  "metadata": { "tenant_id": "...", "owner_user_id": "..." }
}
```

Persist the returned `sk-...` in our `auth_tokens` (or `provider_keys`) table, encrypted at rest (DATA-05). Rotate by calling `/key/regenerate` on a schedule or on tenant plan change.

For requests to `/api/transcribe`, `/api/reason`, etc., our backend forwards to LiteLLM with the **per-user virtual key**, not the master key. This gives us LITELLM-04 (per-user budgets) and LITELLM-05 (quota exhaustion → we map LiteLLM's 429 budget-exceeded to HTTP 200 `{ limitReached: true }`).

#### Spend-log ingestion → our usage ledger

LiteLLM has three options; **recommend (a) Postgres co-tenant, optionally augmented with (c) webhook for instant updates**:

| Approach | Pros | Cons |
|---|---|---|
| **(a) Postgres co-tenant — read LiteLLM's `LiteLLM_SpendLogs` table directly** | Authoritative source, no replication lag, queryable for analytics | Cross-DB foreign keys not possible (separate DB on same cluster); we mirror selected rows into our ledger via a periodic reconciliation job |
| (b) Polling `/spend/logs` API every N seconds | Simple | Latency, API rate limit |
| (c) **Webhook (`LITELLM_WEBHOOK_URL`)** | Real-time | LiteLLM doesn't ship a built-in spend-log webhook today (only key/budget alerts); can be added via [callback plugin](https://docs.litellm.ai/docs/proxy/logging) or **Langfuse/Langsmith integration** route |

**Recommended pattern:** LiteLLM writes spend logs to its DB; a BullMQ job in our backend (`ingest-litellm-spend`) runs every 30s, `SELECT ... FROM litellm.LiteLLM_SpendLogs WHERE id > last_seen`, INSERTs into our `usage_ledger`. Idempotent on `litellm_request_id`.

#### Pass-through endpoints (diarization)

The `/v1/audio/diarization` route is a LiteLLM `pass_through_endpoints` (not a native model route). We forward via LiteLLM with `auth: true` so virtual key budgets are enforced. **As noted in `speaches-audio.md`:** LiteLLM does NOT track spend on pass-through routes natively — for accurate billing, ingest from nginx access log (Vector → Loki → ledger reconciliation) OR add a custom callback. For v1, **document this as a known gap** and bill by request count, not duration.

#### Realtime WSS (`/v1/realtime`)

LiteLLM v1.82+ supports `mode: realtime`. Ingress/Traefik must allow WS Upgrade with 3600s read/send timeouts. ✅ ([Speaches realtime docs](https://speaches.ai/usage/realtime-api/))

### What NOT to do

- **Do NOT ship `patches/fix_passthrough_multipart.py`** — it's already in v1.83.7+. Pin >= v1.83.7-stable and skip the patch. Document the historical context in an ADR.
- **Do NOT pin v1.82.x** — known multipart bug.
- **Do NOT embed LiteLLM in our Node process** — Python/Node bridge is a maintenance disaster.
- **Do NOT use LiteLLM's master key in user-facing requests** — always mint per-user virtual keys.

### Multi-arch ✅
`ghcr.io/berriai/litellm-non_root` ships amd64 + arm64 manifests. ([LiteLLM container packages](https://github.com/orgs/berriai/packages/container/litellm/versions))

---

## 5. Speaches Integration

### Primary: **Speaches (`speaches-local:master-cuda-12.6.3` or newer) as a separate GPU-attached service**

#### Topology

Run Speaches in its own container (matches ExampleCorp's prod setup per `speaches-audio.md`). Three roles in one image:
- `/v1/audio/transcriptions` (Whisper-large-v3 / canary)
- `/v1/audio/diarization` (pyannote)
- `WSS /v1/realtime` (Speaches Realtime, OpenAI Realtime spec compatible)

LiteLLM proxies all three; clients only ever talk to LiteLLM.

#### GPU/CPU footprint at 1000 concurrent

**Hard reality:** Whisper-large-v3 + pyannote + realtime at 1000 active concurrent **requires GPU**. CPU-only is infeasible at scale.

Sizing (verified against 2026 benchmarks):

| Hardware | Concurrent capacity (Whisper-large-v3, faster-whisper INT8) | Cost rough |
|---|---|---|
| 1× **NVIDIA L40S 48GB** | ~60 concurrent streams ([2026 benchmark](https://www.spheron.network/blog/whisper-v4-asr-gpu-cloud-production-guide/)) | $0.32–0.72/hr spot |
| 1× **NVIDIA H100 80GB** | 200–300 concurrent streams | $2–4/hr |
| 2× H100 or 4× A100 | 1000+ concurrent live sessions | datacenter-grade |

**For 1000 concurrent active users on transcribe (not all simultaneous transcription):** assume ~10–20% true concurrency on STT = ~150–200 concurrent transcribe streams → **2× L40S** or **1× H100** is the minimum viable GPU footprint. Document this in `docs/operations.md` with a sizing matrix.

**Faster-whisper INT8 quantization** uses 3-4GB VRAM (~40% memory savings at minimal accuracy loss) — recommended default for Speaches config. ([SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper), [Northflank STT 2026 benchmarks](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks))

#### Fallback for non-GPU operators

Document explicitly in `docs/providers.md`: small operators without GPU can:
1. Configure LiteLLM to route `transcribe` to **Groq Whisper API** (cheap, fast, no GPU on-prem) or **OpenAI Whisper API**.
2. Disable realtime (`/api/openai-realtime-token` returns 503) if no GPU.
3. Use Speaches in **CPU mode with `Systran/faster-distil-whisper-small.en`** for low-traffic dev/staging (single-user only — do not claim production support for CPU).

This is the multi-provider abstraction (PROVIDER-01) earning its keep.

### Multi-arch
Speaches `master-cuda-12.6.3` is **amd64 + NVIDIA only** (CUDA images don't have arm64 + NVIDIA in the wild). For arm64 operators (Apple Silicon dev, Ampere servers) document the CPU-mode `speaches-local:master-cpu` image as dev-only.

### What NOT to do

- Do not bundle Speaches into our Node container (Python + CUDA runtime, multi-GB image bloat).
- Do not run Speaches behind PgBouncer or Redis-locked queue — it's stateless GPU compute, scale via HPA on `gpu_utilization` custom metric.

---

## 6. Queue / Cache

### Primary: **Redis 7.4 (or Valkey 8.x for license-conscious operators) + BullMQ**

**Why BullMQ:**
- **Throughput** — thousands of jobs/sec; we'll need this for transcription orchestration, webhook fanout, email delivery, LiteLLM spend-log ingestion. ([npmtrends](https://npmtrends.com/better-queue-vs-bullmq-vs-graphile-worker-vs-kue-vs-pg-boss), [BullMQ vs alternatives 2026](https://dev.to/axiom_agent/nodejs-job-queues-in-production-bullmq-bull-and-worker-threads-3c35))
- **Feature completeness** — repeatable jobs (cron), parent-child dependencies, rate limits per queue, exponential backoff. All needed.
- **Battle-tested** — most popular Node queue, large StackOverflow corpus.

**Redis is already required** (rate limiting per SCALE-04, cookie/session ephemeral storage, WS connection registry for fan-out across API replicas). So adding BullMQ adds **zero** infra services.

### Why NOT Postgres-native queue (graphile-worker / pg-boss)

graphile-worker tops out around **100-200 jobs/sec on typical PG hardware** before hitting lock contention — fine for low-volume but we have 1000 concurrent users generating webhook fanout (Stripe events, referral invites, spend-log ingest). One referenced case-study switched away from graphile-worker at ~5k jobs/min peak. ([HN discussion](https://news.ycombinator.com/item?id=46614277))

If Redis were not already a hard dependency, graphile-worker would be a strong "fewer moving parts" pick. But Redis IS required → BullMQ wins on throughput and ergonomics.

### Redis vs Valkey

- **Redis 7.4** (last BSD-3 version before 2024 RSAL/SSPL switch) or **Redis 7.4 OSS edition** post-2024 — works fine.
- **Valkey 8.x** — Linux Foundation fork, AGPL/BSD-clean, drop-in replacement, recommended for OSS purity. Multi-arch images exist.
- **Document both** in compose; default to Valkey 8.x in our Helm chart for license cleanliness.

### Multi-arch ✅
- `redis:7.4-alpine` — amd64 + arm64 ✅
- `valkey/valkey:8` — amd64 + arm64 ✅

### What NOT to use

- **Bull (Bull v3, the predecessor to BullMQ)** — superseded; use BullMQ.
- **Agenda** — MongoDB-backed, doesn't fit our stack.
- **Kue** — abandoned.
- **AWS SQS / GCP Pub/Sub** — couples self-host operators to a cloud, defeats the point.

---

## 7. Observability Stack

### Primary: **OpenTelemetry SDK (Node) → OTel Collector (sidecar/DaemonSet) → Tempo (traces) + Mimir/Prometheus (metrics) + Loki (logs) + Grafana (UI)**

The "LGTM stack" (Loki, Grafana, Tempo, Mimir) is the boring 2026 choice for OSS observability. OpenTelemetry SDK status for Node.js is **stable for tracing and metrics** (logs API is stable; logs SDK approaching stable). ([Grafana LGTM + OTel guide](https://oneuptime.com/blog/post/2026-02-06-lgtm-stack-opentelemetry/view), [Grafana OTel docs](https://grafana.com/docs/opentelemetry/))

**Concrete picks:**

| Component | Pick | Why |
|---|---|---|
| Trace SDK | `@opentelemetry/sdk-node` + auto-instrumentations-node | Auto-instruments Fastify, undici (outbound calls to LiteLLM), Postgres (pg/drizzle), Redis (ioredis), Better Auth |
| Trace backend | **Tempo** | LGTM stack default; cheap object-storage backend; Grafana-native UI |
| Metrics | **Prometheus** (single-host) / **Mimir** (K8s/multi-host) | Industry default; Grafana-native |
| Logs | **Loki** | Label-based log indexing, cheap; pairs with Grafana derived-fields → traces |
| Log shipping | **OTel Collector with `loki` exporter + `journald`/`filelog` receivers** | One agent for traces + metrics + logs, no need for Vector unless heavy log transformation |
| UI | **Grafana 11+** | Includes Tempo Service Graph, Loki↔Tempo correlation, ships dashboards as code |

### Vector vs OTel Collector

OTel Collector covers logs in 2026 — `filelog` receiver + `loki` exporter handles 95% of cases. **Vector is only justified** if operators need heavy log parsing, multi-destination fanout (Loki + Splunk + S3), or VRL transforms. For our ship-the-stack default: **OTel Collector wins** (one agent, fewer moving parts).

Document Vector as the alternative in `docs/operations.md` for heavy-log operators.

### LiteLLM spend logs surfacing

- **OBS-04 satisfied via:** Loki ingest of LiteLLM container logs (`/litellm/*` access log lines) **plus** the BullMQ ingestion job from §4 that writes to our usage ledger. Grafana dashboards query both Loki (text) and Postgres (structured ledger) via the Postgres datasource.

### nginx access log surfacing

- nginx (or Traefik) container logs → OTel Collector (`filelog` receiver, parsed via `regex_parser` operator) → Loki. Grafana dashboard correlates with traces via `request_id`.

### Multi-arch ✅
All Grafana stack images (`grafana/grafana`, `grafana/loki`, `grafana/tempo`, `grafana/mimir`, `prom/prometheus`, `otel/opentelemetry-collector-contrib`) ship amd64 + arm64. ✅

### What NOT to use

- **Datadog / New Relic / Honeycomb agents** — proprietary, defeats OSS positioning. Document as "operators can swap exporters" in providers docs.
- **Jaeger** — superseded by Tempo for object-storage backends; Jaeger UI deprecated in favor of Grafana.
- **Elastic / ELK / OpenSearch logs** — heavyweight, expensive at 1000 concurrent log volume; Loki is the boring 2026 pick.

---

## 8. Container / Deploy Stack

### Primary

| Target | Toolchain |
|---|---|
| **Self-host single-VM** | `docker-compose.yml` v2 (Compose Spec) — API + Postgres + PgBouncer + Redis (or Valkey) + LiteLLM + Speaches + MinIO + Traefik + Grafana stack |
| **K8s cloud** | **Helm chart** (single chart, subcharts for Postgres via CNPG, observability via kube-prometheus-stack/Loki) |

Helm wins over Kustomize for OSS distribution: one `helm install`, well-known values.yaml override pattern, OCI registry distribution. Kustomize overlays can be added later for operators who prefer them.

### Ingress (K8s)

**Primary recommendation: Traefik 3.x** with annotations for 1h WSS read/send timeouts (Traefik auto-detects WS upgrade — no special config needed beyond `transport.respondingTimeouts` overrides). ([Traefik Kubernetes Ingress NGINX routing](https://doc.traefik.io/traefik/reference/routing-configuration/kubernetes/ingress-nginx/))

**Why not nginx-ingress:** **NGINX Ingress Controller (`kubernetes/ingress-nginx`) is officially being retired by SIG Network — best-effort maintenance through March 2026, then no further releases or security patches.** The proposed successor `InGate` was abandoned. ([Kubernetes blog: Ingress NGINX Retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/), [Chkk EOL analysis](https://www.chkk.io/blog/ingress-nginx-deprecation))

**Alternatives ordered:**

| Choice | When |
|---|---|
| **Traefik 3** (default) | Single binary, auto WS detection, CRDs + Gateway API support, easiest for operators |
| **Envoy Gateway / Contour** | Operators wanting Gateway API native, Envoy-grade observability |
| **F5 NGINX Ingress Controller** (`nginx/nginx-ingress`, NOT `kubernetes/ingress-nginx`) | Operators with existing NGINX skill investment; commercially supported |
| **HAProxy Ingress** | Operators with existing HAProxy expertise |

Document **Gateway API** as the forward-looking primitive in `docs/operations.md` — our chart should expose Gateway API resources behind an opt-in flag for 2026+ K8s clusters.

### Cert management

- **cert-manager** (1.16+) for TLS issuance — Let's Encrypt by default, hooks for Vault/internal CA in operator overrides.

### Self-host TLS

- docker-compose path uses **Traefik** with built-in ACME (Let's Encrypt) — operator sets `TRAEFIK_ACME_EMAIL=...` and traffic just works.
- Plaintext HTTP **disabled by default** (PROJECT.md hard rule).

### Multi-arch ✅
- All recommended base images publish amd64 + arm64 manifests:
  - `node:24-bookworm-slim` ✅
  - `postgres:17-bookworm` ✅
  - `traefik:v3` ✅
  - `redis:7.4` / `valkey/valkey:8` ✅
  - `minio/minio` ✅
  - `ghcr.io/berriai/litellm-non_root` ✅
- **Speaches GPU image is amd64+CUDA only** (documented exception, see §5).
- Build our own API container with `docker buildx build --platform linux/amd64,linux/arm64`.

### What NOT to use

- **`kubernetes/ingress-nginx`** — retiring March 2026, no security patches after.
- **Pure Kustomize for OSS distribution** — fewer operators are familiar; Helm has the better UX for `helm install --values our-values.yaml`.
- **Skaffold / Tilt for production** — dev-only.
- **Single-VM "everything-in-one-container"** — wastes the operator's isolation; docker-compose multi-service is the right granularity.

---

## 9. i18n Stack

### Primary: **i18next 25.x + i18next-http-middleware (Fastify-compatible) + accept-language-parser**

**Why i18next:**
- **Server-side first-class** — `i18next` core is framework-agnostic; runs in Node, browsers, RN. Same translation files reusable across server and frontend (UI-SPEC). ([i18next docs](https://www.i18next.com/), [auto18n React i18n 2026](https://www.auto18n.com/en/blog/react-i18n-2026))
- **`Accept-Language` negotiation** — `i18next-http-middleware` parses `Accept-Language` and selects the resource bundle, with fallback chains. Idiomatic Fastify integration: `fastify.register(i18nextMiddleware.plugin, ...)`.
- **CLDR pluralization** via `i18next-icu` plugin — full ICU MessageFormat support: `{count, plural, one {# minute} other {# minutes}}`. Critical for `en` + `ru` (Russian has three plural forms — one/few/many — which **only ICU/CLDR-aware libraries handle correctly**).
- **Operator overrides (I18N-02)** — i18next's `loadPath` config supports filesystem layered loading (built-in JSON in container + operator override volume mount); idiomatic.
- **Locale resource format** — flat JSON or namespaced JSON, well-tooled (Crowdin, Weblate, POEditor all integrate).

**Why not FormatJS / react-intl:** Excellent ICU compliance, but more React-coupled and the Node server-side story is less mainstream than i18next. We need server-side first; i18next dominates that niche.

**Why not Lingui:** Smaller bundle (relevant for client only), excellent ICU, **but** the macro-driven extraction model is opinionated for codebases that are already TS-component-heavy — overkill for server-side error message bundles.

### Locale resource layout

```
locales/
  en/
    auth.json
    quota.json
    errors.json
  ru/
    auth.json
    quota.json
    errors.json
```

Operator override path: `${OPENWHISPR_LOCALES_OVERRIDE_DIR}` mounted into the API container; merged with built-ins at startup (built-ins win on missing keys).

### What NOT to use

- **`node-polyglot`** — no ICU plural support → wrong forms in Russian.
- **`gettext` / `ttag`** — works but smaller ecosystem in Node.
- **Hand-rolled `Accept-Language` parsing** — use `accept-language-parser` (or i18next-http-middleware's built-in).

### Multi-arch ✅ (pure JS)

---

## 10. Frontend Stack (UI-SPEC target)

### Primary: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Better Auth React client + TanStack Query 5**

**Why this stack:** It IS the 2026 default for new admin dashboards. ([shadcn/ui Next.js + React 19 docs](https://ui.shadcn.com/docs/react-19), [shadcn Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4), [AdminLTE shadcn/Next.js admin guide 2026](https://adminlte.io/blog/build-admin-dashboard-shadcn-nextjs/))

**Concrete picks:**

| Layer | Pick | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server Components for the operator console; route handlers can co-host the Better Auth handler if frontend and backend deploy together, OR call our Fastify `/api/*` directly |
| UI lib | shadcn/ui (latest, Tailwind v4 + React 19 supported) | Copy-paste-into-repo (not an npm dep) — operators can fork freely; matches OSS spirit |
| Styling | Tailwind 4 | OKLCH color tokens, smaller runtime |
| Forms | react-hook-form + zod | Standard 2026 combo |
| Data fetching | TanStack Query 5 | For SWR-style cache; pairs well with our REST endpoints |
| Auth client | `better-auth/react` | Same library as our server — client/server symmetry |
| i18n | next-intl (Next.js-idiomatic) OR i18next + react-i18next (shared bundles with server) | **Recommend i18next for resource-file reuse with the server** |
| Tables | TanStack Table 8 | For operator console: tenant lists, audit log, key list |
| Charts | Recharts (or visx) | For usage dashboards |

### UI-SPEC implications

The UI-SPEC.md (UI-01, UI-02) should target this stack so the user's downstream code generation produces consistent output. Component inventory in UI-SPEC enumerates shadcn/ui components by name (Button, Dialog, Form, DataTable, …).

### Alternatives considered

| Option | When it wins | Why not primary |
|---|---|---|
| **SvelteKit** | Smaller bundle, simpler reactivity | Smaller component ecosystem for admin UI primitives; shadcn/ui has Svelte port but lags React |
| **Remix (React Router 7)** | Web-fundamentals-aligned | Smaller community than Next.js for admin dashboards; less momentum |
| **Astro + islands** | Marketing pages, docs | Wrong tool for stateful operator console |
| **Nuxt 4 (Vue)** | Vue shops | Better Auth has React-first client; Vue client is community-maintained |

### What NOT to use

- **Create React App** — deprecated.
- **Pages Router (Next.js 14 and below)** — App Router is the 2026 default.
- **Material UI / Ant Design** — locked design system; doesn't fit our copy-into-repo OSS philosophy.
- **Bootstrap** — 2010s.

### Multi-arch ✅ (pure JS, runs on any Node 24 image)

---

## Installation (high-level — for the eventual `package.json`)

```bash
# Core runtime
# (Node 24 LTS via your Dockerfile / Volta / fnm — not in package.json)

# HTTP framework + plugins
npm install fastify @fastify/multipart @fastify/websocket @fastify/http-proxy \
  @fastify/cookie @fastify/cors @fastify/helmet @fastify/rate-limit \
  @fastify/sensible @fastify/swagger @fastify/under-pressure

# Auth
npm install better-auth

# DB
npm install drizzle-orm pg
npm install -D drizzle-kit

# Queue + cache
npm install bullmq ioredis

# i18n
npm install i18next i18next-http-middleware i18next-fs-backend i18next-icu \
  intl-messageformat accept-language-parser

# Validation
npm install zod

# HTTP outbound (LiteLLM/Speaches/Stripe)
# undici is bundled with Node 24; expose via globalThis.fetch or `import { fetch } from 'undici'`

# Observability
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/exporter-metrics-otlp-proto

# Logging
npm install pino pino-pretty

# Stripe
npm install stripe

# S3-compatible storage (MinIO etc.)
npm install @aws-sdk/client-s3

# Dev
npm install -D typescript @types/node tsx vitest @vitest/coverage-v8 \
  prettier eslint @typescript-eslint/eslint-plugin
```

(Frontend deps live in a separate `web/` workspace — Next.js, shadcn/ui, etc. — out of v1 implementation scope per PROJECT.md UI-01/02.)

---

## Alternatives Considered (consolidated)

| Recommended | Alternative | When to use the alternative |
|---|---|---|
| Fastify 5 | NestJS 11 (Fastify adapter) | Team > 5 engineers, want strict layering / DI |
| Better Auth | Ory Kratos+Hydra | Existing Ory deployment in the org |
| Drizzle | Prisma | Tooling-heavy team that values Studio over PgBouncer-friendliness |
| PgBouncer | Supavisor | Multi-tenant SaaS at >5000 concurrent or multi-region |
| BullMQ | graphile-worker | If Redis were not already required AND throughput < 100 jobs/sec |
| Traefik | Envoy Gateway / Contour | Operators wanting Gateway API native, or already running Envoy mesh |
| Loki | Elastic / OpenSearch | Operators with existing ELK skills and budget |
| OTel Collector (logs) | Vector | Heavy log transformation / multi-destination fanout |
| i18next | FormatJS @formatjs/intl | Strict-ICU enterprise glossary teams |
| Next.js 15 | SvelteKit / Remix / Nuxt | Strong pre-existing team preference |

---

## What NOT to Use (consolidated)

| Avoid | Why | Use instead |
|---|---|---|
| Express 4/5 | No native streaming/multipart story; abandoned by mainstream | Fastify 5 |
| Prisma | DSL + engine + PgBouncer friction | Drizzle |
| `kubernetes/ingress-nginx` | **Retiring March 2026, no security patches** | Traefik 3 / Envoy Gateway |
| LiteLLM v1.82.x | Multipart-passthrough 500 bug | LiteLLM **v1.83.7-stable+** (fix native) |
| `patches/fix_passthrough_multipart.py` | Already merged upstream into v1.83.7 | Pin LiteLLM v1.83.7-stable; delete the patch |
| Postgres 16 | Allowed but older | Postgres 17 |
| Postgres 18 | Bleeding-edge for v1 | Postgres 17 (revisit at v1.x) |
| Redis post-RSAL closed-source variants | License concerns | Valkey 8.x or Redis 7.4 OSS |
| node-polyglot for i18n | No proper Russian plural forms (one/few/many) | i18next + i18next-icu |
| Roll-your-own JWT/auth | Re-implements Better Auth's wire shape | Better Auth |
| Embedded Speaches/LiteLLM in Node container | Polyglot deploy, multi-GB image | Sidecars |
| Jaeger | Superseded by Tempo | Grafana Tempo |
| ELK stack | Heavyweight at 1000 concurrent | Loki |
| `kubernetes/ingress-nginx` again, just to be clear | EOL March 2026 | Traefik |

---

## Stack Patterns by Variant

**If self-hosting on a single VM (small org, <50 users):**
- docker-compose, Traefik with ACME, single-replica everything, MinIO single-disk, Postgres no replicas (rely on `pg_dump` cron + WAL archive to MinIO), no separate Mimir (Prometheus single-binary), Grafana single-binary.
- Skip Speaches GPU → route to Groq Whisper API via LiteLLM.

**If self-hosting at scale (1000 concurrent active):**
- K8s + Helm, Traefik or Envoy Gateway, CloudNativePG with 1 primary + 2 replicas + automated failover, MinIO distributed (4 nodes), Speaches with HPA on GPU utilization (2× L40S minimum), full LGTM stack, OTel Collector as DaemonSet, BullMQ workers as separate Deployment with HPA on Redis queue depth.

**If running fully air-gapped / on-prem with internal CA:**
- Replace Let's Encrypt with cert-manager + internal CA Issuer, replace upstream IdP with Keycloak/Authentik wired as Better Auth's upstream OAuth Provider, point LiteLLM at on-prem LLM gateway (vLLM, internal Bedrock proxy), MinIO backs everything.

---

## Version Compatibility Matrix

| Package A | Compatible With | Notes |
|---|---|---|
| Node.js 24 LTS | Fastify 5, Better Auth 1.x, Drizzle latest | Active LTS through Apr 2027 |
| Fastify 5 | `@fastify/multipart` ≥ 9.x, `@fastify/websocket` ≥ 11.x, `@fastify/http-proxy` ≥ 11.x | Older v4-pinned plugins won't work on Fastify 5 |
| Drizzle | pg ≥ 8, postgres-js ≥ 3 | Either driver works; `pg` more compatible with PgBouncer transaction mode |
| PgBouncer 1.23+ | Postgres 17 | Transaction-mode prepared-statement support requires 1.23+ |
| BullMQ | Redis 7.x or Valkey 8.x | Streams + consumer groups required |
| LiteLLM **v1.83.7-stable+** | Speaches master-cuda-12.6.3+ | Multipart pass-through fix native; prior versions need backport patch |
| CloudNativePG 1.29 | K8s 1.28+ | Default image catalog is PG 18 — override to PG 17 in Cluster spec |
| Tailwind 4 | shadcn/ui latest, React 19 | Older shadcn/ui versions (Tailwind 3) require migration |
| OTel SDK Node | Node 18+ | Trace + metrics stable; logs API stable, SDK approaching stable |

---

## Confidence Assessment

| Area | Confidence | Reasoning |
|---|---|---|
| Runtime + framework (Node 24 + Fastify 5) | **HIGH** | Verified versions, ecosystem maturity, exact fit to NDJSON/multipart/WSS/Better-Auth requirements |
| Auth (Better Auth) | **HIGH** | Wire shape (bearer + cookie + `set-auth-token` + `x-openwhispr-source`) is exactly what Better Auth emits; client side is already Better Auth |
| Postgres 17 + Drizzle + PgBouncer + CNPG | **HIGH** | All current 2026 versions verified; compatibility known; CNPG 1.29 just released |
| LiteLLM **v1.83.7-stable** has multipart fix natively | **HIGH** | Verified directly in [LiteLLM v1.83.7 release notes](https://docs.litellm.ai/release_notes/v1.83.7/v1-83-7-stable) and [PR #25464](https://github.com/BerriAI/litellm/pull/25464). **Patch in `speaches-audio.md` is no longer required.** |
| Speaches sizing for 1000 concurrent | **MEDIUM** | Sizing extrapolated from 2026 GPU benchmarks (L40S, H100); operator should load-test their own deployment. Document a sizing matrix, do not promise specific numbers without measurement. |
| BullMQ over graphile-worker | **HIGH** | Throughput numbers cited are well-established; Redis is already required |
| Traefik over ingress-nginx | **HIGH** | ingress-nginx EOL March 2026 is officially confirmed by Kubernetes SIG Network |
| LGTM observability stack | **HIGH** | Industry-default 2026 OSS observability; auto-instrumentation for our entire stack exists |
| i18next for server-side i18n with Russian plurals | **HIGH** | Only ICU/CLDR-aware libs handle Russian one/few/many correctly; i18next+i18next-icu does |
| Next.js 15 + React 19 + Tailwind 4 + shadcn/ui frontend | **HIGH** | Verified as the 2026 default admin-dashboard stack; UI-SPEC consumers will know it |

---

## Sources

### Application runtime + framework
- [Fastify (official)](https://fastify.dev/) — v5 docs, plugins, performance
- [@fastify/multipart on npm](https://www.npmjs.com/package/@fastify/multipart) — v10.x, stream-mode
- [fastify/fastify-http-proxy](https://github.com/fastify/fastify-http-proxy) — `wsUpstream` for WSS proxying
- [NestJS vs Fastify 2026 — pkgpulse](https://www.pkgpulse.com/blog/nestjs-vs-fastify-2026)
- [NestJS vs Fastify vs Hono 2026 — Encore](https://encore.dev/articles/nestjs-vs-fastify-vs-hono)
- [Node.js 24 LTS upgrade guide 2026 — pkgpulse](https://www.pkgpulse.com/guides/nodejs-24-lts-upgrade-from-node-22-2026)
- [Node 24 LTS GA — Vercel changelog](https://vercel.com/changelog/node-js-24-lts-is-now-generally-available-for-builds-and-functions)
- [Node 20 EOL Apr 2026](https://pocketlantern.dev/briefs/node-20-eol-april-2026-upgrade-path)

### Auth
- [Better Auth official site](https://better-auth.com/)
- [Better Auth Bearer plugin](https://better-auth.com/docs/plugins/bearer)
- [Better Auth JWT plugin (opaque tokens)](https://better-auth.com/docs/plugins/jwt)
- [Better Auth OAuth 2.1 Provider plugin](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth GitHub](https://github.com/better-auth/better-auth)
- [Best OSS auth tools enterprise 2026 — Cerbos](https://www.cerbos.dev/blog/best-open-source-auth-tools-and-software-for-enterprises-2026)
- [Top OSS Auth0 alternatives 2026 — authgear](https://www.authgear.com/post/top-open-source-auth0-alternatives/)

### Database
- [PostgreSQL 17 release notes](https://www.postgresql.org/about/news/postgresql-17-released-2936/)
- [PostgreSQL 17.6 minor release](https://www.postgresql.org/docs/release/17.6/)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [endoflife.date PostgreSQL](https://endoflife.date/postgresql)
- [CloudNativePG 1.29 release](https://cloudnative-pg.io/releases/cloudnative-pg-1-29.0-released/)
- [CloudNativePG GitHub](https://github.com/cloudnative-pg/cloudnative-pg)
- [Drizzle vs Prisma 2026 — makerkit](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
- [Drizzle vs Prisma 2026 — Bytebase](https://www.bytebase.com/blog/drizzle-vs-prisma/)
- [Drizzle vs Prisma — Encore](https://encore.dev/articles/drizzle-vs-prisma)
- [PgBouncer vs Supavisor 2026 — pkgpulse](https://www.pkgpulse.com/blog/pgbouncer-vs-pgcat-vs-supavisor-postgresql-connection-2026)
- [Production Postgres pooling 2026](https://nerdleveltech.com/production-postgres-pooling-pgbouncer-supabase-supavisor-tutorial)

### LiteLLM (the load-bearing version finding)
- **[LiteLLM v1.83.7-stable release notes (multipart-passthrough fix native)](https://docs.litellm.ai/release_notes/v1.83.7/v1-83-7-stable)**
- **[LiteLLM PR #25464 — fix multipart pass-through](https://github.com/BerriAI/litellm/pull/25464)** (referenced in `speaches-audio.md`)
- [LiteLLM v1.83.14-stable release](https://github.com/BerriAI/litellm/releases/tag/v1.83.14-stable) — newer than .7, also includes the fix
- [LiteLLM release notes index](https://docs.litellm.ai/release_notes)
- [LiteLLM container packages (multi-arch)](https://github.com/orgs/berriai/packages/container/litellm/versions)
- [LiteLLM logging/callbacks docs](https://docs.litellm.ai/docs/proxy/logging) — for spend log integration

### Speaches / GPU sizing
- [Speaches Realtime API docs](https://speaches.ai/usage/realtime-api/)
- [Whisper v4 / Speaches GPU production guide 2026 — Spheron](https://www.spheron.network/blog/whisper-v4-asr-gpu-cloud-production-guide/)
- [Best OSS STT models 2026 benchmarks — Northflank](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)
- [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)

### Queue
- [BullMQ vs alternatives 2026 — npmtrends](https://npmtrends.com/better-queue-vs-bullmq-vs-graphile-worker-vs-kue-vs-pg-boss)
- [Node.js job queues in production 2026](https://dev.to/axiom_agent/nodejs-job-queues-in-production-bullmq-bull-and-worker-threads-3c35)
- [graphile-worker scaling caveats — HN](https://news.ycombinator.com/item?id=46614277)
- [graphile-worker performance docs](https://worker.graphile.org/docs/performance)
- [pg-boss GitHub](https://github.com/timgit/pg-boss)

### Observability
- [LGTM stack with OpenTelemetry 2026 guide](https://oneuptime.com/blog/post/2026-02-06-lgtm-stack-opentelemetry/view)
- [Grafana OpenTelemetry docs](https://grafana.com/docs/opentelemetry/)
- [OTel Collector for application observability](https://grafana.com/docs/opentelemetry/collector/opentelemetry-collector/)

### Ingress / deploy
- **[Kubernetes blog: Ingress NGINX retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)** — March 2026 EOL
- [Chkk: Ingress-NGINX deprecation analysis](https://www.chkk.io/blog/ingress-nginx-deprecation)
- [Ingress NGINX migration guide — Okteto](https://www.okteto.com/blog/ingress-nginx-controller-deprecation-your-migration-guide-to-kubernetes-gateway-api/)
- [Kubernetes ingress controllers compared 2026 — Reintech](https://reintech.io/blog/kubernetes-ingress-controllers-compared-nginx-traefik-haproxy-contour)
- [WebSocket Kubernetes ingress NGINX/Traefik/HAProxy](https://websocket.org/guides/infrastructure/kubernetes/)

### i18n
- [React i18n 2026 — auto18n](https://www.auto18n.com/en/blog/react-i18n-2026)
- [Best i18n libraries Next.js/React/RN 2026 — SimpleLocalize](https://simplelocalize.io/blog/posts/the-most-popular-react-localization-libraries/)
- [Lingui vs i18next official comparison](https://lingui.dev/misc/i18next)

### Frontend
- [shadcn/ui Next.js 15 + React 19 docs](https://ui.shadcn.com/docs/react-19)
- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4)
- [Build admin dashboard shadcn/Next.js 2026 — AdminLTE](https://adminlte.io/blog/build-admin-dashboard-shadcn-nextjs/)

---

*Stack research for: open-source self-hosted wire-compatible OpenWhispr backend (1000 concurrent users)*
*Researched: 2026-05-08*
