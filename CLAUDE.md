<!-- GSD:project-start source:PROJECT.md -->
## Project

**OpenWhispr Server**

An open-source, enterprise-grade, self-hosted backend for the OpenWhispr Electron desktop client, implementing the wire surface defined by the upstream `SELF_HOSTING.md` / `BACKEND_SPEC.md` / `OAUTH_SPEC.md` (1556 lines of authoritative spec). It bundles a default **LiteLLM Proxy** wired to **open-source AI models** (Whisper for transcription, pyannote for diarization, faster-whisper / Speaches-compatible image for realtime) so a fresh `git clone && docker compose up` works out of the box for OSS users, while corporate operators override `LITELLM_BASE_URL` / `LITELLM_VIRTUAL_KEY` to point at their existing internal LiteLLM Proxy (e.g. the one described in `speaches-audio.md`) without any code changes — LiteLLM is itself the abstraction layer.

It is built to enterprise standards for **1000 concurrent active users** in one installation: HA Postgres with row-level multi-tenancy, horizontal autoscaling, BullMQ workers, anti-abuse rate limiting, full observability, and reproducible deploys via docker-compose (single-host self-host) and Helm (Kubernetes cloud).

**Core Value:** **A drop-in OpenWhispr backend any organization can self-host — open-source out of the box, corporate-LiteLLM-ready by env override.** Every other goal (multi-tenancy, observability, OSS docs, UI-SPEC) exists to serve this one outcome.

### Constraints

- **Tech stack (server)**: Node.js 24 LTS + Fastify 5 + TypeScript + Better Auth + Drizzle + Postgres 17 + PgBouncer + Redis/Valkey + BullMQ — boring, well-staffed, multi-arch (amd64+arm64).
- **Tech stack (frontend)**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui v2 — UI-SPEC target only in v1.
- **Database**: PostgreSQL 17+ — non-negotiable.
- **AI plane**: bundled LiteLLM ≥ v1.83.7-stable in default compose with open-source models; corporate operators env-override to point at their internal LiteLLM.
- **Wire compatibility**: every endpoint we serve matches `BACKEND_SPEC.md` byte-for-byte (JSON shapes, status codes, error envelope, NDJSON streaming, channel-scheme echo, `set-auth-token` rotation).
- **HTTPS only**: never plaintext HTTP on any externally reachable port.
- **Concurrency**: 1000 active concurrent users single installation, p95 latency budgets validated by load test.
- **Source-artifact language**: **English only** for docs, code, comments, commit messages, identifiers, log keys — hard rule.
- **Runtime localization**: `en` + `ru` minimum from day one for UI copy, emails, end-user error messages.
- **Engineering discipline (constitutional)**:
  - **Strict TDD** — tests precede production code on EVERY phase, including decimal/insertion phases (X.Y). Yolo-mode does NOT exempt from TDD. Each fix lands with its tests in the SAME atomic commit.
  - **Per-phase coverage floor ≥ 90%** on all new/modified code in that phase (above the project-wide 85/80/80/85 vitest floor). Applies equally to integer phases and decimal/insertion phases. A phase that ships < 90% on its diff REQUIRES a gap-closure phase BEFORE the next phase starts.
  - **GitHub Actions** is the only sanctioned CI; workflows in `.github/workflows/` from the first commit of phase 0.
  - **Maximum test automation** — no human QA; coverage spans unit, integration (real services via testcontainers), e2e, contract (against `BACKEND_SPEC.md`), load (1000 concurrent), security (SAST + deps + container + secrets + license), migration safety, i18n completeness, RLS-isolation property tests.
- **Open source**: every requirement ships with corresponding documentation; no closed/internal subsystems.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
## 1. Application Runtime + Framework
### Primary: **Node.js 24 LTS + Fastify 5 (TypeScript)**
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
## 2. Auth Library / Server
### Primary: **Better Auth (server) v1.x with Bearer + JWT + Email-OTP plugins, embedded in the Fastify process**
- Self-hosted server library that runs in any Node.js HTTP server (Fastify integration via `fastify.all('/api/auth/*', ...)` adapter pattern). ([better-auth.com](https://better-auth.com/), [GitHub](https://github.com/better-auth/better-auth))
- **Bearer plugin** intercepts requests and converts the `Authorization: Bearer ...` header into the session lookup — exactly the desktop's main-process call path. ([Bearer plugin docs](https://better-auth.com/docs/plugins/bearer))
- **Opaque bearer support** — JWT plugin can be configured to keep access tokens opaque (with optional prefix), matching the spec's "client never inspects the token contents" requirement. ([JWT plugin](https://better-auth.com/docs/plugins/jwt))
- **`set-auth-token` rotation** — emitted automatically on Better Auth client calls when sessions are extended or rotated. This is the exact header the desktop's `tokenStore.js` listens for.
- **OAuth 2.1 Provider plugin** lets you host the `/api/desktop-signin/{provider}` shim natively, with Google/Microsoft/Apple/GitHub providers built-in and OIDC/SAML extensible. ([OAuth Provider docs](https://better-auth.com/docs/plugins/oauth-provider))
- Recent (2026) updates added `customTokenResponseFields` callback (lets us inject `bearer_token` into the protocol-redirect URL cleanly) and structured RFC 6749 error responses on all six OAuth endpoints.
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
## 3. Database Stack
### Primary: **PostgreSQL 17.x + Drizzle ORM + drizzle-kit migrations + PgBouncer (transaction mode) + CloudNativePG (HA on K8s)**
#### PostgreSQL 17.x
#### Drizzle ORM + drizzle-kit (NOT Prisma)
| Criterion | Drizzle | Prisma |
|---|---|---|
| TypeScript-native schema | ✅ schema = TS file | ❌ proprietary `.prisma` DSL |
| Query engine | None (pure SQL builder) | Rust binary (Prisma engine) — extra layer, boot latency |
| PgBouncer transaction-mode compat | ✅ native | ❌ requires `pgbouncer=true` flag, prepared-statement workarounds |
| Edge/serverless | Less relevant for self-hosted, but fine | Requires Prisma Accelerate (paid) for serverless pooling |
| Bundle size / boot time | Smaller, faster | Slower cold start due to engine |
| Migration model | SQL-first; you can hand-edit migrations | Declarative; Prisma owns the migration |
| Multi-tenant RLS (DATA-01) | Easy — drop to raw SQL when needed | Awkward — RLS sits outside Prisma's mental model |
#### Connection pooling: PgBouncer 1.23+ (transaction mode)
- **PgBouncer** is the boring, battle-tested choice. Single static binary, ~2MB RAM per 1000 clients, transaction-mode pooling lets us multiplex thousands of API connections onto ~50 backend Postgres connections.
- **Prepared-statement support** in PgBouncer 1.23+ (`max_prepared_statements = 200`) handles Drizzle's prepared statements transparently; this used to be a footgun but is solved as of 2024.
- For SCALE-02 (sized for 1000 concurrent): PgBouncer pool size 100 backend × 4 PgBouncer instances = comfortable ceiling at 1000 concurrent active sessions.
#### HA topology
- **K8s deployments → CloudNativePG operator 1.29.x.** CNCF Sandbox project, defaults to PG 18 image catalogs (we override to 17), supports streaming replication, automated failover, base backups to S3-compatible storage, scheduled maintenance. The mainstream choice in 2026. ([CNPG 1.29 release](https://cloudnative-pg.io/releases/cloudnative-pg-1-29.0-released/), [CNPG GitHub](https://github.com/cloudnative-pg/cloudnative-pg))
- **Single-host docker-compose deployments → vanilla Postgres 17 container** with WAL archive to local volume + cron-driven `pg_basebackup`. HA is best-effort for self-host single-VM (operator's call to add a replica).
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
## 4. LiteLLM Integration
### Primary: **LiteLLM Proxy v1.83.7-stable (or newer) as a separate sidecar service in docker-compose / its own Deployment in K8s**
#### Multipart-passthrough fix — **NATIVELY FIXED in v1.83.7-stable** ✅
- [LiteLLM v1.83.7-stable release notes](https://docs.litellm.ai/release_notes/v1.83.7/v1-83-7-stable) — explicitly lists "Fix proxy pass-through multipart uploads and Bedrock JSON body" by @shivamrawat1 in [PR #25464](https://github.com/BerriAI/litellm/pull/25464).
- [LiteLLM GitHub releases](https://github.com/BerriAI/litellm/releases/tag/v1.83.7-stable) — confirms the merge.
#### Deployment topology: **separate service, not in-process**
- **Sidecar container in docker-compose** (single host) — `litellm` service alongside `api`, `postgres`, `redis`, `speaches`. One LiteLLM instance per host.
- **Separate Deployment in K8s Helm chart** — own pod, own HPA (LiteLLM is Python/FastAPI; scales vertically less well than our Node API tier; HPA on CPU works fine).
- **Why not embedded:** LiteLLM is a Python service. Embedding means polyglot deploys, two language runtimes per container, complicated Dockerfile. Sidecar is **boring and operator-friendly** — restart LiteLLM independently when bumping versions.
#### Per-user virtual key minting/rotation
#### Spend-log ingestion → our usage ledger
| Approach | Pros | Cons |
|---|---|---|
| **(a) Postgres co-tenant — read LiteLLM's `LiteLLM_SpendLogs` table directly** | Authoritative source, no replication lag, queryable for analytics | Cross-DB foreign keys not possible (separate DB on same cluster); we mirror selected rows into our ledger via a periodic reconciliation job |
| (b) Polling `/spend/logs` API every N seconds | Simple | Latency, API rate limit |
| (c) **Webhook (`LITELLM_WEBHOOK_URL`)** | Real-time | LiteLLM doesn't ship a built-in spend-log webhook today (only key/budget alerts); can be added via [callback plugin](https://docs.litellm.ai/docs/proxy/logging) or **Langfuse/Langsmith integration** route |
#### Pass-through endpoints (diarization)
#### Realtime WSS (`/v1/realtime`)
### What NOT to do
- **Do NOT ship `patches/fix_passthrough_multipart.py`** — it's already in v1.83.7+. Pin >= v1.83.7-stable and skip the patch. Document the historical context in an ADR.
- **Do NOT pin v1.82.x** — known multipart bug.
- **Do NOT embed LiteLLM in our Node process** — Python/Node bridge is a maintenance disaster.
- **Do NOT use LiteLLM's master key in user-facing requests** — always mint per-user virtual keys.
### Multi-arch ✅
## 5. Speaches Integration
### Primary: **Speaches (`speaches-local:master-cuda-12.6.3` or newer) as a separate GPU-attached service**
#### Topology
- `/v1/audio/transcriptions` (Whisper-large-v3 / canary)
- `/v1/audio/diarization` (pyannote)
- `WSS /v1/realtime` (Speaches Realtime, OpenAI Realtime spec compatible)
#### GPU/CPU footprint at 1000 concurrent
| Hardware | Concurrent capacity (Whisper-large-v3, faster-whisper INT8) | Cost rough |
|---|---|---|
| 1× **NVIDIA L40S 48GB** | ~60 concurrent streams ([2026 benchmark](https://www.spheron.network/blog/whisper-v4-asr-gpu-cloud-production-guide/)) | $0.32–0.72/hr spot |
| 1× **NVIDIA H100 80GB** | 200–300 concurrent streams | $2–4/hr |
| 2× H100 or 4× A100 | 1000+ concurrent live sessions | datacenter-grade |
#### Fallback for non-GPU operators
### Multi-arch
### What NOT to do
- Do not bundle Speaches into our Node container (Python + CUDA runtime, multi-GB image bloat).
- Do not run Speaches behind PgBouncer or Redis-locked queue — it's stateless GPU compute, scale via HPA on `gpu_utilization` custom metric.
## 6. Queue / Cache
### Primary: **Redis 7.4 (or Valkey 8.x for license-conscious operators) + BullMQ**
- **Throughput** — thousands of jobs/sec; we'll need this for transcription orchestration, webhook fanout, email delivery, LiteLLM spend-log ingestion. ([npmtrends](https://npmtrends.com/better-queue-vs-bullmq-vs-graphile-worker-vs-kue-vs-pg-boss), [BullMQ vs alternatives 2026](https://dev.to/axiom_agent/nodejs-job-queues-in-production-bullmq-bull-and-worker-threads-3c35))
- **Feature completeness** — repeatable jobs (cron), parent-child dependencies, rate limits per queue, exponential backoff. All needed.
- **Battle-tested** — most popular Node queue, large StackOverflow corpus.
### Why NOT Postgres-native queue (graphile-worker / pg-boss)
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
## 7. Observability Stack
### Primary: **OpenTelemetry SDK (Node) → OTel Collector (sidecar/DaemonSet) → Tempo (traces) + Mimir/Prometheus (metrics) + Loki (logs) + Grafana (UI)**
| Component | Pick | Why |
|---|---|---|
| Trace SDK | `@opentelemetry/sdk-node` + auto-instrumentations-node | Auto-instruments Fastify, undici (outbound calls to LiteLLM), Postgres (pg/drizzle), Redis (ioredis), Better Auth |
| Trace backend | **Tempo** | LGTM stack default; cheap object-storage backend; Grafana-native UI |
| Metrics | **Prometheus** (single-host) / **Mimir** (K8s/multi-host) | Industry default; Grafana-native |
| Logs | **Loki** | Label-based log indexing, cheap; pairs with Grafana derived-fields → traces |
| Log shipping | **OTel Collector with `loki` exporter + `journald`/`filelog` receivers** | One agent for traces + metrics + logs, no need for Vector unless heavy log transformation |
| UI | **Grafana 11+** | Includes Tempo Service Graph, Loki↔Tempo correlation, ships dashboards as code |
### Vector vs OTel Collector
### LiteLLM spend logs surfacing
- **OBS-04 satisfied via:** Loki ingest of LiteLLM container logs (`/litellm/*` access log lines) **plus** the BullMQ ingestion job from §4 that writes to our usage ledger. Grafana dashboards query both Loki (text) and Postgres (structured ledger) via the Postgres datasource.
### nginx access log surfacing
- nginx (or Traefik) container logs → OTel Collector (`filelog` receiver, parsed via `regex_parser` operator) → Loki. Grafana dashboard correlates with traces via `request_id`.
### Multi-arch ✅
### What NOT to use
- **Datadog / New Relic / Honeycomb agents** — proprietary, defeats OSS positioning. Document as "operators can swap exporters" in providers docs.
- **Jaeger** — superseded by Tempo for object-storage backends; Jaeger UI deprecated in favor of Grafana.
- **Elastic / ELK / OpenSearch logs** — heavyweight, expensive at 1000 concurrent log volume; Loki is the boring 2026 pick.
## 8. Container / Deploy Stack
### Primary
| Target | Toolchain |
|---|---|
| **Self-host single-VM** | `docker-compose.yml` v2 (Compose Spec) — API + Postgres + PgBouncer + Redis (or Valkey) + LiteLLM + Speaches + MinIO + Traefik + Grafana stack |
| **K8s cloud** | **Helm chart** (single chart, subcharts for Postgres via CNPG, observability via kube-prometheus-stack/Loki) |
### Ingress (K8s)
| Choice | When |
|---|---|
| **Traefik 3** (default) | Single binary, auto WS detection, CRDs + Gateway API support, easiest for operators |
| **Envoy Gateway / Contour** | Operators wanting Gateway API native, Envoy-grade observability |
| **F5 NGINX Ingress Controller** (`nginx/nginx-ingress`, NOT `kubernetes/ingress-nginx`) | Operators with existing NGINX skill investment; commercially supported |
| **HAProxy Ingress** | Operators with existing HAProxy expertise |
### Cert management
- **cert-manager** (1.16+) for TLS issuance — Let's Encrypt by default, hooks for Vault/internal CA in operator overrides.
### Self-host TLS
- docker-compose path uses **Traefik** with built-in ACME (Let's Encrypt) — operator sets `TRAEFIK_ACME_EMAIL=...` and traffic just works.
- Plaintext HTTP **disabled by default** (PROJECT.md hard rule).
### Multi-arch ✅
- All recommended base images publish amd64 + arm64 manifests:
- **Speaches GPU image is amd64+CUDA only** (documented exception, see §5).
- Build our own API container with `docker buildx build --platform linux/amd64,linux/arm64`.
### What NOT to use
- **`kubernetes/ingress-nginx`** — retiring March 2026, no security patches after.
- **Pure Kustomize for OSS distribution** — fewer operators are familiar; Helm has the better UX for `helm install --values our-values.yaml`.
- **Skaffold / Tilt for production** — dev-only.
- **Single-VM "everything-in-one-container"** — wastes the operator's isolation; docker-compose multi-service is the right granularity.
## 9. i18n Stack
### Primary: **i18next 25.x + i18next-http-middleware (Fastify-compatible) + accept-language-parser**
- **Server-side first-class** — `i18next` core is framework-agnostic; runs in Node, browsers, RN. Same translation files reusable across server and frontend (UI-SPEC). ([i18next docs](https://www.i18next.com/), [auto18n React i18n 2026](https://www.auto18n.com/en/blog/react-i18n-2026))
- **`Accept-Language` negotiation** — `i18next-http-middleware` parses `Accept-Language` and selects the resource bundle, with fallback chains. Idiomatic Fastify integration: `fastify.register(i18nextMiddleware.plugin, ...)`.
- **CLDR pluralization** via `i18next-icu` plugin — full ICU MessageFormat support: `{count, plural, one {# minute} other {# minutes}}`. Critical for `en` + `ru` (Russian has three plural forms — one/few/many — which **only ICU/CLDR-aware libraries handle correctly**).
- **Operator overrides (I18N-02)** — i18next's `loadPath` config supports filesystem layered loading (built-in JSON in container + operator override volume mount); idiomatic.
- **Locale resource format** — flat JSON or namespaced JSON, well-tooled (Crowdin, Weblate, POEditor all integrate).
### Locale resource layout
### What NOT to use
- **`node-polyglot`** — no ICU plural support → wrong forms in Russian.
- **`gettext` / `ttag`** — works but smaller ecosystem in Node.
- **Hand-rolled `Accept-Language` parsing** — use `accept-language-parser` (or i18next-http-middleware's built-in).
### Multi-arch ✅ (pure JS)
## 10. Frontend Stack (UI-SPEC target)
### Primary: **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui + Better Auth React client + TanStack Query 5**
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
## Installation (high-level — for the eventual `package.json`)
# Core runtime
# (Node 24 LTS via your Dockerfile / Volta / fnm — not in package.json)
# HTTP framework + plugins
# Auth
# DB
# Queue + cache
# i18n
# Validation
# HTTP outbound (LiteLLM/Speaches/Stripe)
# undici is bundled with Node 24; expose via globalThis.fetch or `import { fetch } from 'undici'`
# Observability
# Logging
# Stripe
# S3-compatible storage (MinIO etc.)
# Dev
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
## Stack Patterns by Variant
- docker-compose, Traefik with ACME, single-replica everything, MinIO single-disk, Postgres no replicas (rely on `pg_dump` cron + WAL archive to MinIO), no separate Mimir (Prometheus single-binary), Grafana single-binary.
- Skip Speaches GPU → route to Groq Whisper API via LiteLLM.
- K8s + Helm, Traefik or Envoy Gateway, CloudNativePG with 1 primary + 2 replicas + automated failover, MinIO distributed (4 nodes), Speaches with HPA on GPU utilization (2× L40S minimum), full LGTM stack, OTel Collector as DaemonSet, BullMQ workers as separate Deployment with HPA on Redis queue depth.
- Replace Let's Encrypt with cert-manager + internal CA Issuer, replace upstream IdP with Keycloak/Authentik wired as Better Auth's upstream OAuth Provider, point LiteLLM at on-prem LLM gateway (vLLM, internal Bedrock proxy), MinIO backs everything.
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
