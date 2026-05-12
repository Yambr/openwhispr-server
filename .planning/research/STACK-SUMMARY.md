# Technology Stack — Slim Summary

> This is a quick-scan reference. Full rationale, alternatives, "what NOT to use", and sources live in `.planning/research/STACK.md`.

## TL;DR — One-Line Picks

| Layer | Pick | Version |
|---|---|---|
| Runtime | Node.js (Active LTS) | **24.x** |
| HTTP framework | **Fastify** | **5.x** |
| Auth library | **Better Auth (server)** + Bearer + JWT + OAuth Provider plugins | **1.x** |
| Database | **PostgreSQL** | **17.x** |
| Schema/ORM | **Drizzle ORM** + **drizzle-kit** | latest |
| Pooler | **PgBouncer** transaction mode | **1.23+** |
| HA Postgres (K8s) | **CloudNativePG** operator | **1.29.x** |
| Cache / rate-limit / WS fan-out | **Redis** (or **Valkey**) | **7.4 / 8.x** |
| Job queue | **BullMQ** | latest |
| LLM/audio gateway (default) | **LiteLLM Proxy** | **v1.83.7-stable+** (multipart-passthrough fix native) |
| ASR/Realtime backend (default) | **Speaches** (`speaches-local:master-cuda-12.6.3+`) | latest master |
| Object storage (self-host) | **MinIO** (S3-compatible) | latest |
| Observability | **OTel SDK → OTel Collector → Tempo + Mimir/Prometheus + Loki + Grafana** (LGTM) | latest |
| Logs shipping | **OTel Collector** (no Vector required) | — |
| Container orchestration | **docker-compose** (single-host) + **Helm chart** (K8s) | — |
| Ingress (K8s) | **Traefik 3** (primary) / Envoy Gateway / Contour | Traefik 3.x |
| i18n | **i18next** + **i18next-http-middleware** + **i18next-icu** + **accept-language-parser** | latest |
| Frontend (UI-SPEC target) | **Next.js 15 (App Router) + React 19 + Tailwind 4 + shadcn/ui** | latest |

## Stack Patterns by Variant

- **Self-host single-VM (OSS quickstart)** — docker-compose, Traefik with ACME, single-replica everything, MinIO single-disk, Postgres no replicas (rely on `pg_dump` cron + WAL archive to MinIO), Prometheus single-binary, Grafana single-binary. Skip Speaches GPU → route to a hosted Whisper API via LiteLLM.
- **Cloud / production HA** — K8s + Helm, Traefik or Envoy Gateway, CloudNativePG 1 primary + 2 replicas + automated failover, MinIO distributed (4 nodes), Speaches with HPA on GPU utilization (≥ 2× L40S), full LGTM stack, OTel Collector as DaemonSet, BullMQ workers as separate Deployment with HPA on Redis queue depth.
- **Corporate self-host (enterprise override)** — replace Let's Encrypt with cert-manager + internal CA Issuer, wire Keycloak/Authentik as Better Auth's upstream OAuth Provider, point LiteLLM at on-prem LLM gateway (vLLM, internal Bedrock proxy, etc.), MinIO backs everything.

## Version Compatibility Matrix

| Package A | Compatible With | Notes |
|---|---|---|
| Node.js 24 LTS | Fastify 5, Better Auth 1.x, Drizzle latest | Active LTS through Apr 2027 |
| Fastify 5 | `@fastify/multipart` ≥ 9.x, `@fastify/websocket` ≥ 11.x, `@fastify/http-proxy` ≥ 11.x | Older v4-pinned plugins won't work |
| Drizzle | pg ≥ 8, postgres-js ≥ 3 | `pg` more compatible with PgBouncer transaction mode |
| PgBouncer 1.23+ | Postgres 17 | Transaction-mode prepared-statement support requires 1.23+ |
| BullMQ | Redis 7.x or Valkey 8.x | Streams + consumer groups required |
| LiteLLM v1.83.7-stable+ | Speaches master-cuda-12.6.3+ | Multipart pass-through fix native |
| CloudNativePG 1.29 | K8s 1.28+ | Default image catalog is PG 18 — override to PG 17 in Cluster spec |
| Tailwind 4 | shadcn/ui latest, React 19 | Older shadcn/ui (Tailwind 3) requires migration |
| OTel SDK Node | Node 18+ | Trace + metrics stable; logs API stable |

## Hard "do not use" shortlist

- **Express 4/5**, **Prisma**, **TypeORM**, **MySQL/MariaDB**, **Postgres 16/18**, **`kubernetes/ingress-nginx`** (EOL March 2026), **LiteLLM v1.82.x** (multipart bug), **Jaeger**, **ELK**, **node-polyglot**, **Roll-your-own JWT/auth**, **Bun in production**, **Pages Router**, **CRA**.

> Full rationale, alternatives considered, deep-dives per layer, multi-arch notes, and citation sources live in `.planning/research/STACK.md`.
