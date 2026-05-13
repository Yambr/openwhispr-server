# ADR-0005: Server stack — Node 24 + Fastify 5 + Better Auth + Drizzle + PG 17 + PgBouncer + Valkey + BullMQ

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping (records a foundational decision in force since Phase 0)

## Context

OpenWhispr Server's wire surface, multi-tenancy model, and concurrency target
(1000 active users per installation) dictate a backend stack that is:

- Boring and well-staffed (mature LTS runtime, large pool of contributors).
- Multi-arch (amd64 + arm64) for container deploys on both x86 and Graviton/Apple
  Silicon hosts.
- Strict-TypeScript-friendly end-to-end.
- Compatible with the transaction-mode PgBouncer pooler we need for connection
  efficiency at concurrent-user scale.
- Compatible with row-level security (RLS) for tenant isolation (see ADR-0007).
- Capable of handling NDJSON streaming, multipart upload pass-through, and
  WebSocket fan-out (the `/v1/realtime` surface).

We do **not** want to invest in custom auth, custom job queues, or a custom
ORM — every such subsystem in our domain has a battle-tested upstream pick.

## Decision

The canonical server stack is:

- **Runtime:** Node.js 24 LTS (Active LTS through April 2027). Pinned via
  `.nvmrc`, `.tool-versions`, and `packageManager` field.
- **HTTP framework:** Fastify 5 with `@fastify/multipart` ≥ 9, `@fastify/websocket`
  ≥ 11, and `@fastify/http-proxy` ≥ 11 for the LiteLLM pass-through.
- **Auth:** Better Auth 1.x as the auth library, with the Bearer, JWT, and OIDC
  Provider plugins (see ADR-0009 for the auth-flow detail).
- **ORM / schema:** Drizzle ORM + drizzle-kit for migrations.
- **Database:** PostgreSQL 17. Phase 9 Helm chart uses CloudNativePG with the
  catalog image pinned to PG 17 (the operator default is PG 18, which we override).
- **Connection pooling:** PgBouncer 1.23+ in transaction-mode (prepared-statement
  support shipped in 1.23 — required for Drizzle's parameterized queries).
- **Cache / rate-limit / WebSocket fan-out:** Valkey 8.x (or Redis 7.4+). Valkey
  is the default because it is BSD-licensed and not at risk of upstream re-license.
- **Job queue:** BullMQ on Valkey/Redis Streams. The api enqueues; the worker
  app consumes (separate Deployment in Kubernetes, separate service in compose).

## Consequences

- **Easier:** every layer has high-quality TypeScript types; multi-arch images
  build cleanly on a single `docker buildx` invocation; the stack is well-known
  to hiring pools and OSS contributors.
- **Easier (multi-tenancy):** PG 17 + PgBouncer transaction mode + Drizzle
  parameter-binding all play well with the RLS chokepoint (ADR-0007); the
  `app.tenant_id` GUC is set per-transaction by a request-scoped middleware.
- **Harder:** transaction-mode PgBouncer disallows server-side cursors and
  session-scoped LISTEN/NOTIFY; we use BullMQ for async fan-out instead. Documented.
- **Risk:** Node 24 will eventually transition to Maintenance LTS; we will
  re-evaluate to Node 26 LTS when it lands (October 2026), tracked as a Phase 11
  candidate.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Express 4/5** | Plugin ecosystem is mature but performance and TypeScript-firstness lag Fastify; Fastify 5's hooks model fits our envelope/RLS interceptor pattern better. |
| **Hono / Elysia / oak** | Smaller communities, less enterprise familiarity, less plugin coverage for our multipart + websocket + http-proxy needs. |
| **Prisma** | Schema migration model fights additive-only safety (Phase 9 `lint-migrations` gate); Drizzle compiles to plain SQL we can read and review. |
| **TypeORM** | Heavier runtime, weaker TypeScript inference, decorator dependency tax. |
| **Lucia (auth)** | No OAuth-Provider plugin — Better Auth's OIDC provider story is materially better for enterprise self-host (Keycloak / Authentik / Azure AD). |
| **MySQL / MariaDB** | RLS support is materially weaker than PostgreSQL; our multi-tenancy story is RLS-shaped (ADR-0007). |
| **PostgreSQL 16 or 18** | 16 lacks the per-backend memory introspection improvements we use in operations runbooks; 18 is too new to be the catalog default in CloudNativePG 1.29. We override to 17. |
| **Plain Redis vs Valkey** | Redis Inc.'s re-license to RSALv2/SSPL in 2024 created supply-chain uncertainty for OSS distributions; Valkey is the Linux Foundation fork and remains BSD-licensed. |
| **Roll-your-own job queue** | BullMQ ships consumer-groups, retries with jitter, rate-limit, repeatable jobs, and a dashboard out of the box; rebuilding any of these is wasted work. |

## References

- CLAUDE.md (root) — Technology Stack TL;DR table
- `.planning/research/STACK.md` — long-form rationale, version compatibility matrix
- ADR-0001 (pnpm + Node 24)
- ADR-0007 (RLS multi-tenancy)
- ADR-0009 (Better Auth + OIDC plugin)
- https://github.com/cloudnative-pg/cloudnative-pg
- https://www.pgbouncer.org/changelog.html (1.23 prepared-statement support)
- https://valkey.io/
