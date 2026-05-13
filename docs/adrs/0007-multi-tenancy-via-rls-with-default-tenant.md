# ADR-0007: Multi-tenancy via PostgreSQL row-level security with a single default tenant in v1

**Status:** accepted

**Date:** 2026-05-13

**Phase:** 10 — i18n, Docs & OSS Housekeeping (records a constitutional decision in force since Phase 2)

## Context

OpenWhispr Server is designed for **1000 concurrent active users in one
installation**. Enterprise operators may eventually want to host multiple
organizations on a single cluster (per-business-unit isolation, MSP-style
hosting, dev/staging/prod partitioning on a shared DB). The v1 release ships
single-tenant by default — a fresh self-host has one organization — but the
schema and the access path must be ready to grow into multi-tenancy without a
data migration that rewrites every existing row.

Constraints:

- Tenant isolation must be enforced at the database layer, not just at the
  application layer (defense in depth — an application bug must not leak rows
  across tenants).
- The chosen mechanism must survive PgBouncer transaction-mode pooling.
- Cross-tenant queries (for global metrics, never user-facing) must be
  explicitly granted, not accidental.
- The v1 default-tenant story must add zero operator-visible complexity —
  the operator should not have to "create a tenant" before signing up.

## Decision

Multi-tenancy is implemented via **PostgreSQL row-level security (RLS)**:

- Every multi-tenant table carries a `tenant_id uuid NOT NULL` column with an
  index. The single v1 tenant has a deterministic UUID `00000000-0000-0000-0000-000000000001`
  ("default tenant"); migrations seed it.
- Every multi-tenant table has an RLS policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- A request-scoped Fastify hook reads the authenticated user's tenant id and
  issues `SET LOCAL app.tenant_id = '<uuid>'` at the start of every request's
  database transaction. The `LOCAL` scope ensures the GUC is bound to the
  transaction, which is the unit of work PgBouncer hands back to the pool.
- A small set of system queries (cross-tenant operator metrics, BullMQ job
  metadata) run as the `app_operator` role which is `BYPASSRLS`. Application
  code uses the default `app_user` role which is **not** `BYPASSRLS`.
- v1 ships with one tenant. v2 may add operator-facing tenant CRUD; the
  schema does not change.

## Consequences

- **Easier:** the chokepoint is a single hook + a single GUC; a property-based
  test (`tests/property/rls-isolation.test.ts`) asserts no query path leaks
  rows across tenants under random fuzzed inputs.
- **Easier (audit):** the audit_log table also carries tenant_id; forensic
  queries naturally scope to a tenant via the same RLS policy.
- **Harder:** every new table touched by an authenticated user request must
  remember to add the `tenant_id` column and the RLS policy. Migration lint
  (Phase 9) catches missing RLS policies on tenant-scoped tables.
- **Harder:** background jobs (BullMQ workers) must propagate tenant_id from
  the job payload and re-establish the GUC before any database access. The
  worker's job-runner hook does this centrally.
- **Risk:** `BYPASSRLS` grants are a foot-gun — overly broad grants
  effectively disable the chokepoint. Mitigated by code review on every
  migration that grants `BYPASSRLS` and a CI test that asserts the role list.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| **Schema-per-tenant** | PG handles dozens of schemas well, hundreds poorly; backup/restore and migration tooling complexity grows linearly with tenant count. Worse, schema-per-tenant requires an application-level catalog to route queries — recreating RLS at the app layer. |
| **Database-per-tenant** | Strongest isolation, weakest economics — 1000 databases on one PG cluster is operationally painful, and a cluster per tenant defeats the "1000 users in one installation" goal. |
| **Application-layer filtering (no RLS)** | Defense-in-depth gap — a single missing `WHERE tenant_id = ?` clause in a future query leaks rows. Unacceptable for an OSS backend handling audio + transcripts. |
| **Single-tenant rewrite (drop tenant_id entirely from v1)** | Future multi-tenancy then requires a full data migration that rewrites every row in every table. The cost of keeping a NOT NULL column with one value in v1 is trivial; the cost of retrofitting it later is not. |

## References

- `packages/data/migrations/000?_rls_*.sql` — RLS policy migrations
- `apps/api/src/plugins/tenant-guc.ts` — request-scoped `SET LOCAL` hook
- `tests/property/rls-isolation.test.ts` — fuzzed cross-tenant isolation
- `docs/architecture.md` — RLS chokepoint flowchart
- `docs/security.md` — tenant-isolation threat model
- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
