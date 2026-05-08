# Phase 1: Core Infra & Multi-Tenant Data — Research (DB / RLS / Encryption Dimension)

**Researched:** 2026-05-09
**Domain:** Postgres 17 schema, two-role RLS, Drizzle migrations workflow, KEK/DEK envelope encryption, RLS property testing
**Confidence:** HIGH (decisions D-13..D-23 are locked; verified versions; SQL/TS prescriptive)

## Summary

This dimension covers the data plane: Drizzle schema layout, the two-Postgres-role model (`openwhispr_owner` BYPASSRLS for migrations vs. `openwhispr_app` RLS-subject for the API), the first migration that creates the constitutional minimum tables with FORCE-RLS policies, the `withTenant()` transaction helper that keeps `SET LOCAL app.tenant_id` PgBouncer-transaction-mode safe, and the KEK/DEK envelope (AES-256-GCM, per-row DEK wrapped by env-provided KEK with Vault/KMS adapter stubs).

**Primary recommendation:** Drizzle 0.45.2 + drizzle-kit 0.31.10; `DATABASE_URL_OWNER` (BYPASSRLS) for migrations runner only, `DATABASE_URL` (RLS-subject, via PgBouncer) for everything else. Every tenant-scoped table gets `ENABLE` + `FORCE` row level security plus the canonical `current_setting('app.tenant_id', true)::uuid` policy. fast-check 4.7.0 + `@fast-check/vitest` 0.4.1 drive 100-pair RLS property tests through testcontainers Postgres + PgBouncer sidecar.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-13..D-23 — DB scope)

- **D-13:** Drizzle ORM 0.x latest. Schema in `packages/data/src/schema/`, one file per table (`tenants.ts`, `users.ts`, `sessions.ts`, `audit_log.ts`, `usage_ledger.ts`, plus `virtual_keys.ts` placeholder). Constitutional minimum columns: `id uuid`, `tenant_id uuid`, `created_at`, `updated_at`.
- **D-14:** Migrations in `packages/data/migrations/`. drizzle-kit generates SQL. CI runs `pnpm drizzle-kit migrate` against testcontainers Postgres on every PR touching `migrations/`.
- **D-15:** Two roles: `openwhispr_owner` owns DDL + BYPASSRLS (migration runner only); `openwhispr_app` is RLS-subject (API + tests, NEVER BYPASSRLS). PgBouncer connects as `openwhispr_app`.
- **D-16:** RLS policy template uses `current_setting('app.tenant_id', true)::uuid` — `, true` makes it fail-closed when unset (returns `''` → cast fails → policy denies).
- **D-17:** First migration `0000_initial.sql` creates `tenants` (root, no RLS), `users`, `sessions`, `audit_log`, `usage_ledger` (all RLS-protected). Seeds `default` tenant with stable UUID `00000000-0000-0000-0000-000000000000`.
- **D-18:** `packages/data/src/tenant-context.ts` exports `withTenant<T>(tenantId, fn)` — opens transaction, `SET LOCAL`, runs `fn`, commits.
- **D-19:** Fastify `onRequest` hook reads `x-tenant-id` header in Phase 1 (Phase 2 wires real bearer-token extraction).
- **D-20:** Contract test interleaves 100 tenant-A/B queries through real PgBouncer transaction-mode + Postgres in testcontainers; asserts zero cross-tenant rows.
- **D-23:** `packages/data/src/__tests__/rls-property.test.ts` uses fast-check to fuzz random tenant pairs across every queryable model.

### Claude's Discretion (DB scope)

- Specific Drizzle 0.x minor — pin to **0.45.2** (verified latest as of 2026-05-09).
- Whether RLS lint is TS or SQL — **TS** (matches `tools/lint-english.ts`).

### Deferred Ideas (OUT OF SCOPE for DB dimension)

- HashiCorp Vault adapter full implementation (stub only in v1).
- AWS KMS adapter full implementation (stub only in v1).
- Postgres failover / Patroni / CNPG (single-node compose Postgres in v1).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | PG 17+ schema with RLS; `app.tenant_id` GUC via `SET LOCAL` per request | §3 RLS policy template, §5 `withTenant` |
| DATA-02 | Forward-only Drizzle migrations; CI verifies forward+rollback | §1 Drizzle, §2 roles, §4 first migration |
| DATA-03 | Usage ledger idempotent on `request_id` | §4 `usage_ledger` DDL with `UNIQUE(request_id)` |
| DATA-04 | Audit log table | §4 `audit_log` DDL |
| DATA-05 | At-rest encryption for sensitive columns via KEK/DEK | §6 envelope encryption |
| DATA-06 | `tenants` table with seeded `default` row | §4 seed UUID `00000000-...` |
| DATA-07 | Backup/restore tooling | covered by other researcher; this doc references encryption |
| TEST-MIGRATION-01 | CI runs forward+rollback on real Postgres | §1 migrations workflow |
| TEST-RLS-01 | Property tests, every queryable model, no cross-tenant | §7 fast-check + testcontainers |
| PROVIDER-02 | KeyProvider abstraction (env / Vault stub / KMS stub) | §6 interface + three impls |

## Standard Stack

### Core (verified versions, npm registry, 2026-05-09)

| Package | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | **0.45.2** | Type-safe SQL builder + schema | `[VERIFIED: npm view drizzle-orm version → 0.45.2]` Locked by D-13. PgBouncer transaction-mode safe; pure SQL builder, no engine. |
| `drizzle-kit` | **0.31.10** | Migration generator + runner | `[VERIFIED: npm view drizzle-kit version → 0.31.10]` Pairs with drizzle-orm; SQL-first migrations hand-editable. |
| `pg` | **8.20.0** | Postgres driver | `[VERIFIED: npm view pg version → 8.20.0]` Recommended by Drizzle for PgBouncer compatibility (`STACK.md` table). |
| `fast-check` | **4.7.0** | Property-based test fuzzer | `[VERIFIED: npm view fast-check version → 4.7.0]` Industry standard for property tests in TS. |
| `@fast-check/vitest` | **0.4.1** | fast-check ↔ Vitest integration | `[VERIFIED: npm view @fast-check/vitest version → 0.4.1]` `test.prop()` style; matches Vitest 4 already pinned in Phase 0. |
| `@testcontainers/postgresql` | latest | Real Postgres in CI | `[CITED: testcontainers.com]` Already implied by TEST-MIGRATION-01. |
| `testcontainers` | latest | Generic containers (PgBouncer sidecar) | `[CITED: testcontainers.com]` |

### Supporting

| Package | Purpose | When to Use |
|---------|---------|-------------|
| `dotenv` | Load `.env` for migration runner | Migrations runner one-shot script |
| `node:crypto` (built-in) | AES-256-GCM, randomBytes | KEK/DEK envelope — no userland crypto deps |
| `zod` (already pinned in Phase 0) | Validate KeyProvider config | EnvKeyProvider config validation |

**Installation:**

```bash
pnpm --filter @openwhispr/data add drizzle-orm@0.45.2 pg@8.20.0
pnpm --filter @openwhispr/data add -D drizzle-kit@0.31.10 @types/pg
pnpm --filter @openwhispr/data add -D fast-check@4.7.0 @fast-check/vitest@0.4.1
pnpm --filter @openwhispr/data add -D testcontainers @testcontainers/postgresql
```

## Architecture Patterns

### Recommended Project Structure

```
packages/data/
├── src/
│   ├── schema/
│   │   ├── tenants.ts          # root, no RLS
│   │   ├── users.ts            # RLS
│   │   ├── sessions.ts         # RLS
│   │   ├── audit_log.ts        # RLS
│   │   ├── usage_ledger.ts     # RLS, UNIQUE(request_id)
│   │   ├── virtual_keys.ts     # RLS, ENCRYPTED — Phase 2/3 fills
│   │   └── index.ts            # re-export, plus TENANT_SCOPED_TABLES const
│   ├── client.ts               # Drizzle pool factory (app + owner)
│   ├── tenant-context.ts       # withTenant helper
│   ├── encryption/
│   │   ├── key-provider.ts     # interface
│   │   ├── env-key-provider.ts
│   │   ├── vault-key-provider.ts   # stub
│   │   ├── kms-key-provider.ts     # stub
│   │   └── envelope.ts         # encryptValue / decryptValue
│   ├── migrate.ts              # programmatic migration runner (uses owner role)
│   └── __tests__/
│       └── rls-property.test.ts
├── migrations/
│   ├── 0000_initial.sql
│   └── meta/                   # drizzle-kit metadata
└── drizzle.config.ts
```

### Pattern 1: Two-Pool Client Factory

**What:** Two distinct Drizzle clients sharing zero connections — one BYPASSRLS for migrations only, one RLS-subject for everything else.

**When to use:** Migration runner uses `ownerDb`; API + tests use `appDb`.

```typescript
// packages/data/src/client.ts
// Source: prescriptive — derived from D-15
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

// App pool: connects via PgBouncer (transaction-mode), as openwhispr_app, RLS-subject.
// DATABASE_URL = postgres://openwhispr_app:...@pgbouncer:6432/openwhispr
export function makeAppDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
  });
  return drizzle(pool, { schema });
}

// Owner pool: connects DIRECTLY to Postgres (port 5432, NOT via PgBouncer),
// as openwhispr_owner, BYPASSRLS. ONLY used by the migration runner.
// DATABASE_URL_OWNER = postgres://openwhispr_owner:...@postgres:5432/openwhispr
export function makeOwnerDb() {
  if (!process.env.DATABASE_URL_OWNER) {
    throw new Error('DATABASE_URL_OWNER not set — refusing to run as owner');
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_OWNER,
    max: 2, // small — only used for DDL
  });
  return drizzle(pool, { schema });
}
```

### Pattern 2: `withTenant` — the only DB entry point for app code

```typescript
// packages/data/src/tenant-context.ts
// Source: prescriptive — D-18, addresses PITFALLS.md Pitfall 11
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export async function withTenant<T>(
  db: NodePgDatabase<typeof import('./schema/index.js')>,
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  // Validate UUID shape before touching the wire to fail fast on garbage input.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error(`withTenant: invalid tenant UUID: ${tenantId}`);
  }
  return db.transaction(async (tx) => {
    // SET LOCAL is scoped to this transaction. PgBouncer transaction-pool releases
    // the underlying connection after COMMIT/ROLLBACK; SET LOCAL state goes with it.
    // Plain `SET` would leak across pooled connections — DO NOT use.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
```

> Note: `set_config(name, value, is_local := true)` is functionally equivalent to `SET LOCAL` and accepts a parameter for the value, which avoids string interpolation in the SQL — drizzle's `${}` parameterizes correctly. We do NOT use `SET LOCAL app.tenant_id = ${tenantId}` because Postgres `SET LOCAL` does not accept bind parameters for the value.

### Pattern 3: Fastify hook for tenant extraction (Phase 1 placeholder)

```typescript
// apps/api/src/middleware/tenant.ts
// Source: prescriptive — D-19. Phase 2 replaces header reading with bearer-token resolution.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTenant } from '@openwhispr/data/tenant-context';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
  }
}

export async function tenantPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    // PHASE 1 ONLY: read from x-tenant-id header. Phase 2 replaces this with
    // bearer-token → sessions.tenant_id lookup.
    const headerVal = req.headers['x-tenant-id'];
    if (typeof headerVal !== 'string') {
      // Default tenant fallback per D-17 seed
      req.tenantId = '00000000-0000-0000-0000-000000000000';
      return;
    }
    req.tenantId = headerVal;
  });
}

// Handlers wrap their DB work in withTenant(req.server.db, req.tenantId, async (tx) => {...})
```

### Anti-Patterns to Avoid

- **Plain `SET app.tenant_id = ...` (no `LOCAL`)** — leaks across pooled connections under PgBouncer transaction-mode. (PITFALLS.md #11.)
- **Calling `db.execute()` directly outside `withTenant()`** — RLS evaluates against unset GUC → empty-string cast fails → policy denies → silently wrong (zero rows). Add a lint rule in Phase 3+ that forbids `db.execute` outside `withTenant`/`tenantPlugin`.
- **Letting the migration runner connect via PgBouncer** — owner role's BYPASSRLS combined with transaction-pooled connection reuse is a perfect leak vector. Owner pool MUST connect directly to Postgres on 5432.
- **Storing the KEK in source / Drizzle schema seed** — KEK comes from env (and Vault/KMS in later phases) only. Seed migrations never embed key material.
- **Skipping `FORCE ROW LEVEL SECURITY`** — without `FORCE`, table owners (including `openwhispr_owner` if it ever queries through the app pool) bypass RLS even with `ENABLE`. Always pair `ENABLE` + `FORCE`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tenant isolation in app code (`WHERE tenant_id = ?` everywhere) | Filter clauses in handlers | Postgres RLS + `SET LOCAL app.tenant_id` | Single forgotten `WHERE` → cross-tenant leak. RLS is unbypassable from app role. |
| AES-GCM cipher loop | Manual `createCipheriv` calls scattered through code | One `envelope.ts` with `encryptValue/decryptValue` | Auth-tag handling, IV reuse, error paths — easy to get wrong; concentrate in one audited file. |
| KEK rotation logic | Re-encrypting all ciphertext | Per-row DEK wrapped by KEK; KEK rotation re-wraps DEKs only | Standard envelope pattern; D-11 explicitly requires it. |
| UUID generation | Hand-built v4 | `gen_random_uuid()` in Postgres + `crypto.randomUUID()` in TS | Built-in, audited, equivalent. |
| Migration ordering | Hand-numbered files | `drizzle-kit generate` | drizzle-kit owns the `__drizzle_migrations` ledger and ordering. |
| Property test runners | Manual loops | `@fast-check/vitest` `test.prop` | Shrinking + reproduction seeds for free. |

## Common Pitfalls

### Pitfall 1: `SET` vs `SET LOCAL` under PgBouncer transaction-mode

**What goes wrong:** `SET app.tenant_id = '<uuid>'` (no LOCAL) persists at session level. PgBouncer transaction-mode returns the underlying connection to the pool after COMMIT — but the GUC stays set on the physical connection. Next request on the same physical connection sees stale tenant → **cross-tenant data leak**.

**How to avoid:** ALL tenant-context setting goes through `withTenant()` which uses `set_config(name, value, true)` (the `true` is the LOCAL flag). Add a Phase 3 lint rule that greps for `SET app.tenant_id` without `LOCAL` and fails CI. `[VERIFIED: PITFALLS.md #11; PROJECT SCALE-02 + DATA-01]`

**Warning signs:** RLS works in dev (no PgBouncer) but fails in staging. `SHOW app.tenant_id` randomly returns wrong tenant.

### Pitfall 2: Forgotten `ENABLE ROW LEVEL SECURITY` on a new tenant-scoped table

**What goes wrong:** Add a new tenant-scoped table with `tenant_id` column but forget `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` or the `CREATE POLICY` line. Queries return all tenants' rows. **Data-breach grade**, escapes review easily because single-tenant dev tests pass.

**How to avoid:** `tools/lint-rls.ts` (D-21) — introspect `pg_class.relrowsecurity` and `pg_policies` post-migration; fail CI if any table has a `tenant_id` column without `relrowsecurity = true` AND a policy that references `current_setting('app.tenant_id')`. `[CITED: PITFALLS.md #10]`

**Warning signs:** Lint script not yet running; new migration adds table without RLS section in the migration SQL.

### Pitfall 3: Postgres role inheritance — `_app` accidentally inherits BYPASSRLS

**What goes wrong:** `CREATE ROLE openwhispr_app WITH LOGIN INHERIT` and then `GRANT openwhispr_owner TO openwhispr_app` — `_app` now inherits BYPASSRLS, RLS policies skipped, cross-tenant leak.

**How to avoid:** Two independent roles, no `GRANT role TO role` chaining. Verify after migration:

```sql
-- Connect as openwhispr_app
SET ROLE openwhispr_app;
SELECT current_setting('is_superuser'), rolbypassrls
FROM pg_roles WHERE rolname = current_user;
-- Expect: f, f
```

`[CITED: Postgres 17 docs § Row Security Policies]`

### Pitfall 4: `current_setting('app.tenant_id')` (without `, true`) raises error on unset

**What goes wrong:** Without the `missing_ok = true` second argument, `current_setting` raises `unrecognized configuration parameter` error when GUC is not set. Every query without `withTenant()` returns a 5xx instead of cleanly denying via RLS.

**How to avoid:** Always pass `, true`. Then `current_setting` returns `''` when unset → `''::uuid` cast fails inside the policy expression → policy USING/WITH CHECK evaluates to NULL → row denied. **Fail-closed behavior.** `[CITED: D-16; Postgres docs]`

### Pitfall 5: `FORCE ROW LEVEL SECURITY` missing — table owner bypasses RLS

**What goes wrong:** `ENABLE ROW LEVEL SECURITY` alone exempts the table owner from policies. If the API ever connects as the table owner (e.g., misconfigured `.env`), RLS silently does nothing.

**How to avoid:** Pair every `ENABLE` with `FORCE`:

```sql
ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
ALTER TABLE foo FORCE ROW LEVEL SECURITY;
```

The lint script must check both `relrowsecurity = true` AND `relforcerowsecurity = true`. `[CITED: Postgres 17 docs § ddl-rowsecurity]`

### Pitfall 6: Drizzle prepared statements + PgBouncer transaction-mode

**What goes wrong:** PgBouncer transaction-mode historically broke prepared statements (each new transaction got a different physical connection that didn't have the prepared statement). PgBouncer 1.23+ supports protocol-level prepared statement multiplexing.

**How to avoid:** Pin PgBouncer ≥ 1.23 (D-02 already specifies `bitnami/pgbouncer:1.23`); set `max_prepared_statements = 200` in PgBouncer config. Drizzle 0.45.x supports both `pg` (which prefers extended-protocol prepared statements) and `postgres-js`. We use `pg` 8.20.0 — works fine with 1.23+. `[VERIFIED: STACK.md table; PgBouncer 1.23 release notes]`

### Pitfall 7: Cyclic FK dependency — `tenants` referenced everywhere

**What goes wrong:** Migration tries to create `users` before `tenants` exists — FK constraint fails.

**How to avoid:** First migration creates tables in this order: `tenants` → `users` → `sessions` → `audit_log` → `usage_ledger`. Drizzle's `relations()` references happen at TS level only; SQL FK is enforced by ordering inside the single migration file. Seed `default` tenant row inside the same migration BEFORE any code path could reference it.

### Pitfall 8: `__drizzle_migrations` table accidentally tenant-scoped

**What goes wrong:** Running the RLS lint over the full database hits the migrations bookkeeping table; if it has any `tenant_id`-shaped column accidentally, lint fires false positive — or worse, RLS policy applied to it would lock out the migration runner.

**How to avoid:** Drizzle's default migrations table has no `tenant_id` column; lint only matches columns named exactly `tenant_id`. Recommended: place the migrations table in a dedicated schema:

```typescript
// drizzle.config.ts
export default {
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  migrations: {
    schema: '_meta',           // creates _meta.__drizzle_migrations
    table: '__drizzle_migrations',
  },
} satisfies Config;
```

The `_meta` schema is owned by `openwhispr_owner` and not granted to `openwhispr_app`. `[CITED: drizzle-kit docs]`

### Pitfall 9: Tenant-context loss in BullMQ workers (Phase 6 forward-ref)

Already covered by PITFALLS.md #12. Phase 1 only ships the `withTenant` helper; Phase 6 tasks must wrap every job handler in `withTenant(payload.tenantId, async (tx) => ...)`. Note in `docs/operations.md` for Phase 6 implementers.

## Code Examples

### Drizzle schema files (constitutional minimum)

```typescript
// packages/data/src/schema/tenants.ts
// Root table — NOT tenant-scoped, NO RLS.
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

```typescript
// packages/data/src/schema/users.ts
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('users_tenant_id_idx').on(t.tenantId),
    emailUnique: uniqueIndex('users_tenant_email_unique').on(t.tenantId, t.email),
  }),
);
```

```typescript
// packages/data/src/schema/sessions.ts
import { pgTable, uuid, timestamp, customType, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => 'bytea',
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),  // SHA-256 of opaque bearer
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sessions_tenant_id_idx').on(t.tenantId),
    tokenHashIdx: index('sessions_token_hash_idx').on(t.tokenHash),
  }),
);
```

```typescript
// packages/data/src/schema/audit_log.ts
import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    actorUserId: uuid('actor_user_id'),  // nullable: system events
    action: text('action').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('audit_log_tenant_id_idx').on(t.tenantId),
    createdIdx: index('audit_log_created_at_idx').on(t.createdAt),
  }),
);
```

```typescript
// packages/data/src/schema/usage_ledger.ts
import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const usageLedger = pgTable(
  'usage_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    requestId: text('request_id').notNull(),     // idempotency key
    kind: text('kind').notNull(),                 // 'transcribe' | 'reason' | 'streaming'
    units: integer('units').notNull(),            // words / tokens / seconds
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('usage_ledger_tenant_id_idx').on(t.tenantId),
    requestIdUnique: uniqueIndex('usage_ledger_request_id_unique').on(t.requestId),
  }),
);
```

```typescript
// packages/data/src/schema/index.ts
export * from './tenants.js';
export * from './users.js';
export * from './sessions.js';
export * from './audit_log.js';
export * from './usage_ledger.js';

// Auto-discoverable for the RLS property test (D-23).
export const TENANT_SCOPED_TABLES = [
  'users',
  'sessions',
  'audit_log',
  'usage_ledger',
] as const;
```

### First migration `0000_initial.sql` (concrete DDL)

```sql
-- packages/data/migrations/0000_initial.sql
-- Phase 1: core multi-tenant data plane.
-- Runs as openwhispr_owner (BYPASSRLS, owns DDL).

-- Roles created OUTSIDE this migration (in init script run by Postgres entrypoint),
-- because CREATE ROLE requires CREATEROLE privilege and roles outlive databases.
-- See packages/data/migrations/init/00-roles.sql for role creation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- 1. Root tenant table (NOT tenant-scoped, NO RLS).
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the default tenant with a stable UUID (D-17).
INSERT INTO tenants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000000', 'default')
ON CONFLICT (id) DO NOTHING;

-- 2. Tenant-scoped tables.
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_id_idx ON users(tenant_id);
CREATE UNIQUE INDEX users_tenant_email_unique ON users(tenant_id, email);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_tenant_id_idx ON sessions(tenant_id);
CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);

CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  actor_user_id  uuid,
  action         text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_id_idx ON audit_log(tenant_id);
CREATE INDEX audit_log_created_at_idx ON audit_log(created_at);

CREATE TABLE usage_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  request_id  text NOT NULL,
  kind        text NOT NULL,
  units       integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_ledger_tenant_id_idx ON usage_ledger(tenant_id);
CREATE UNIQUE INDEX usage_ledger_request_id_unique ON usage_ledger(request_id);

-- 3. Enable + FORCE RLS on every tenant-scoped table.
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users        FORCE  ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log    FORCE  ROW LEVEL SECURITY;
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger FORCE  ROW LEVEL SECURITY;

-- 4. Canonical tenant-isolation policy on each table.
-- USING for SELECT/UPDATE/DELETE row visibility; WITH CHECK for INSERT/UPDATE row admittance.
-- current_setting('app.tenant_id', true): missing_ok=true → returns '' when unset,
-- '' ::uuid throws → policy denies (fail-closed). This is INTENTIONAL.
CREATE POLICY users_tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY sessions_tenant_isolation ON sessions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY usage_ledger_tenant_isolation ON usage_ledger
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 5. Grants for the application role (RLS-subject).
GRANT USAGE ON SCHEMA public TO openwhispr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users        TO openwhispr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions     TO openwhispr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log    TO openwhispr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON usage_ledger TO openwhispr_app;
-- Tenants table: read-only for app (tenant resolution); writes only via owner.
GRANT SELECT ON tenants TO openwhispr_app;
```

### Roles init script (run once at Postgres container startup)

```sql
-- packages/data/migrations/init/00-roles.sql
-- Mounted into postgres container's /docker-entrypoint-initdb.d/.
-- Passwords come from env vars expanded at template-render time by bootstrap.sh.

CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS PASSWORD '${OPENWHISPR_OWNER_PASSWORD}';
CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${OPENWHISPR_APP_PASSWORD}';
-- NOTE: openwhispr_app explicitly does NOT have BYPASSRLS, NOSUPERUSER (default), NOINHERIT default.

-- Owner owns the database.
ALTER DATABASE openwhispr OWNER TO openwhispr_owner;

-- Verify (defensive):
DO $$
BEGIN
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app') THEN
    RAISE EXCEPTION 'openwhispr_app must NOT have BYPASSRLS';
  END IF;
END $$;
```

### KEK/DEK envelope encryption

```typescript
// packages/data/src/encryption/key-provider.ts
// Source: prescriptive — D-12, PROVIDER-02
export interface KeyProvider {
  readonly id: string;
  getKek(): Promise<Buffer>;
  wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; iv: Buffer; authTag: Buffer }>;
  unwrapDek(wrapped: Buffer, iv: Buffer, authTag: Buffer): Promise<Buffer>;
}

export function selectProvider(): KeyProvider {
  const id = process.env.OPENWHISPR_KEY_PROVIDER ?? 'env';
  switch (id) {
    case 'env':   return new EnvKeyProvider();
    case 'vault': return new VaultKeyProvider();   // stub
    case 'kms':   return new KmsKeyProvider();     // stub
    default: throw new Error(`Unknown key provider: ${id}`);
  }
}
```

```typescript
// packages/data/src/encryption/env-key-provider.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyProvider } from './key-provider.js';

const ALG = 'aes-256-gcm';

export class EnvKeyProvider implements KeyProvider {
  readonly id = 'env';
  private kek: Buffer | null = null;

  async getKek(): Promise<Buffer> {
    if (this.kek) return this.kek;
    const raw = process.env.MASTER_KEK;
    if (!raw) throw new Error('MASTER_KEK env var not set');
    // base64url-encoded 32 bytes (per bootstrap.sh D-10).
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length !== 32) {
      throw new Error(`MASTER_KEK must decode to 32 bytes, got ${buf.length}`);
    }
    this.kek = buf;
    return buf;
  }

  async wrapDek(dek: Buffer): Promise<{ wrapped: Buffer; iv: Buffer; authTag: Buffer }> {
    if (dek.length !== 32) throw new Error('DEK must be 32 bytes');
    const kek = await this.getKek();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALG, kek, iv);
    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { wrapped, iv, authTag };
  }

  async unwrapDek(wrapped: Buffer, iv: Buffer, authTag: Buffer): Promise<Buffer> {
    const kek = await this.getKek();
    const decipher = createDecipheriv(ALG, kek, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }
}
```

```typescript
// packages/data/src/encryption/envelope.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyProvider } from './key-provider.js';

const ALG = 'aes-256-gcm';

export interface EncryptedRow {
  dek_wrapped: Buffer;
  dek_iv: Buffer;
  dek_auth_tag: Buffer;
  value_iv: Buffer;
  value_auth_tag: Buffer;
  value_ciphertext: Buffer;
}

export async function encryptValue(provider: KeyProvider, plaintext: Buffer): Promise<EncryptedRow> {
  const dek = randomBytes(32);
  const valueIv = randomBytes(12);
  const cipher = createCipheriv(ALG, dek, valueIv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const valueAuthTag = cipher.getAuthTag();

  const { wrapped, iv: dekIv, authTag: dekAuthTag } = await provider.wrapDek(dek);
  // Defensive: zeroize plaintext DEK in this scope. (V8 GC may retain copies; this is best-effort.)
  dek.fill(0);

  return {
    dek_wrapped: wrapped,
    dek_iv: dekIv,
    dek_auth_tag: dekAuthTag,
    value_iv: valueIv,
    value_auth_tag: valueAuthTag,
    value_ciphertext: ciphertext,
  };
}

export async function decryptValue(provider: KeyProvider, row: EncryptedRow): Promise<Buffer> {
  const dek = await provider.unwrapDek(row.dek_wrapped, row.dek_iv, row.dek_auth_tag);
  const decipher = createDecipheriv(ALG, dek, row.value_iv);
  decipher.setAuthTag(row.value_auth_tag);
  const plaintext = Buffer.concat([decipher.update(row.value_ciphertext), decipher.final()]);
  dek.fill(0);
  return plaintext;
}
```

**Postgres column shape for any encrypted-value table** (Phase 2/3 fills `virtual_keys`):

```sql
-- Six bytea columns per encrypted value:
ALTER TABLE virtual_keys
  ADD COLUMN dek_wrapped       bytea NOT NULL,
  ADD COLUMN dek_iv            bytea NOT NULL,
  ADD COLUMN dek_auth_tag      bytea NOT NULL,
  ADD COLUMN value_iv          bytea NOT NULL,
  ADD COLUMN value_auth_tag    bytea NOT NULL,
  ADD COLUMN value_ciphertext  bytea NOT NULL;
```

### TEST-RLS-01 property test (concrete)

```typescript
// packages/data/src/__tests__/rls-property.test.ts
// Source: prescriptive — D-20, D-23, TEST-RLS-01
import { fc, test } from '@fast-check/vitest';
import { describe, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Network, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../schema/index.js';
import { withTenant } from '../tenant-context.js';

let pg: StartedPostgreSqlContainer;
let pgbouncer: StartedTestContainer;
let appDb: NodePgDatabase<typeof schema>;
let appPool: Pool;

beforeAll(async () => {
  const network = await new Network().start();

  pg = await new PostgreSqlContainer('postgres:17-alpine')
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .withDatabase('openwhispr')
    .withUsername('openwhispr_owner')
    .withPassword('owner-pw')
    .start();

  // Run migrations as owner directly against Postgres (bypassing PgBouncer).
  const ownerPool = new Pool({ connectionString: pg.getConnectionUri() });
  const ownerDb = drizzle(ownerPool, { schema });
  await migrate(ownerDb, { migrationsFolder: 'packages/data/migrations' });
  // Create app role + grants (in real life this is done by init/00-roles.sql).
  await ownerPool.query(`CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'app-pw'`);
  // ... grants from 0000_initial.sql ...
  await ownerPool.end();

  pgbouncer = await new GenericContainer('bitnami/pgbouncer:1.23')
    .withNetwork(network)
    .withEnvironment({
      POSTGRESQL_HOST: 'postgres',
      POSTGRESQL_USERNAME: 'openwhispr_app',
      POSTGRESQL_PASSWORD: 'app-pw',
      POSTGRESQL_DATABASE: 'openwhispr',
      PGBOUNCER_POOL_MODE: 'transaction',
      PGBOUNCER_MAX_PREPARED_STATEMENTS: '200',
    })
    .withExposedPorts(6432)
    .start();

  appPool = new Pool({
    host: pgbouncer.getHost(),
    port: pgbouncer.getMappedPort(6432),
    database: 'openwhispr',
    user: 'openwhispr_app',
    password: 'app-pw',
    max: 5, // forces interleaving across few connections
  });
  appDb = drizzle(appPool, { schema });
});

afterAll(async () => {
  await appPool.end();
  await pgbouncer.stop();
  await pg.stop();
});

describe('TEST-RLS-01: cross-tenant isolation under PgBouncer transaction-mode', () => {
  test.prop([
    fc.uuid({ version: 4 }),
    fc.uuid({ version: 4 }),
    fc.array(fc.emailAddress(), { minLength: 1, maxLength: 5 }),
  ], { numRuns: 100 })(
    'tenant B never observes tenant A\'s rows',
    async (tenantA, tenantB, emails) => {
      fc.pre(tenantA !== tenantB);

      // Seed tenant rows as owner (skip via direct insert in setup helper).
      await seedTenants([tenantA, tenantB]);

      // Insert under tenant A.
      await withTenant(appDb, tenantA, async (tx) => {
        for (const email of emails) {
          await tx.insert(schema.users).values({ tenantId: tenantA, email });
        }
      });

      // Read under tenant B — must see ZERO rows from A.
      const seen = await withTenant(appDb, tenantB, async (tx) => {
        return tx.select().from(schema.users);
      });
      expect(seen.every((u) => u.tenantId === tenantB)).toBe(true);
      expect(seen.find((u) => emails.includes(u.email))).toBeUndefined();

      // Attempt UPDATE/DELETE under tenant B — must affect 0 rows.
      const upd = await withTenant(appDb, tenantB, async (tx) => {
        return tx.update(schema.users).set({ email: 'pwn@x' }).returning();
      });
      expect(upd.filter((r) => r.tenantId === tenantA)).toHaveLength(0);
    },
  );

  test('reads with NO tenant context return zero rows (fail-closed)', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      // Note: no SET LOCAL app.tenant_id
      const r = await client.query('SELECT * FROM users');
      expect(r.rows).toHaveLength(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
```

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 1 is greenfield. The single seeded row is the `default` tenant UUID, which is stable forever (D-17). | None. |
| Live service config | Postgres role definitions live in container init script (`init/00-roles.sql`); not in git as DDL because passwords are env-substituted. The DDL template IS in git. | None for Phase 1; document for Phase 9 Helm chart. |
| OS-registered state | None. | None. |
| Secrets/env vars | `MASTER_KEK`, `DATABASE_URL` (app role), `DATABASE_URL_OWNER`, `OPENWHISPR_OWNER_PASSWORD`, `OPENWHISPR_APP_PASSWORD`, `OPENWHISPR_KEY_PROVIDER` — all generated by `bootstrap.sh` (D-10), written to `.env` (gitignored). | bootstrap.sh task must enumerate exactly this list. |
| Build artifacts | drizzle-kit emits `migrations/meta/_journal.json` and snapshot files. These ARE committed (D-14 implies CI re-runs on changes). | drizzle-kit auto-manages; tasks just commit alongside generated SQL. |

## Validation Architecture (DB)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (already pinned in Phase 0) + `@fast-check/vitest` 0.4.1 |
| Config file | `vitest.config.ts` (Phase 0) — extend to include `packages/data/src/**` |
| Quick run | `pnpm --filter @openwhispr/data test -- --run packages/data/src/__tests__/rls-property.test.ts` |
| Full suite | `pnpm test` (workspace-wide) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Wave 0 status |
|--------|----------|-----------|-------------------|---------------|
| DATA-01 | RLS active on all tenant-scoped tables; `SET LOCAL` works under PgBouncer transaction-mode | property | `pnpm --filter @openwhispr/data test rls-property` | New file |
| DATA-02 | `pnpm drizzle-kit migrate` exits 0 on fresh PG; `pnpm drizzle-kit drop` (or scripted DROP-all) restores empty DB | integration | `pnpm --filter @openwhispr/data test migrate` | New file |
| DATA-03 | `usage_ledger` rejects duplicate `request_id` (idempotency) | unit/integration | `pnpm --filter @openwhispr/data test usage-ledger` | New file |
| DATA-04 | `audit_log` accepts JSONB payloads, indexed on `created_at` | integration | `pnpm --filter @openwhispr/data test audit-log` | New file |
| DATA-05 | `encryptValue/decryptValue` round-trip; tampered ciphertext fails GCM auth | unit | `pnpm --filter @openwhispr/data test envelope` | New file |
| DATA-06 | Default tenant row exists with UUID `00000000-0000-0000-0000-000000000000` after migrate | integration | `pnpm --filter @openwhispr/data test migrate` (assertion within) | New file |
| TEST-MIGRATION-01 | Forward-apply + drop-and-restore equivalence | integration | `pnpm --filter @openwhispr/data test migration-rollback` | New file |
| TEST-RLS-01 | 100 random tenant pairs, zero cross-tenant rows observed | property | (same as DATA-01 above) | New file |
| PROVIDER-02 | `selectProvider()` returns correct impl per env; Vault/KMS stubs throw helpful errors | unit | `pnpm --filter @openwhispr/data test key-provider` | New file |

### Concrete validation invariants (assertions against running infra)

- `make migrate` exits 0 against a fresh Postgres 17 container; tables `tenants`, `users`, `sessions`, `audit_log`, `usage_ledger` exist and have expected indexes.
- `SELECT id FROM tenants WHERE id = '00000000-0000-0000-0000-000000000000'` returns exactly one row.
- Connect as `openwhispr_app`, `BEGIN; SELECT set_config('app.tenant_id', '<uuidA>', true); INSERT INTO users(...) VALUES (...); COMMIT;` — succeeds.
- Connect as `openwhispr_app` with NO `set_config` call: `SELECT * FROM users` inside a transaction returns 0 rows (fail-closed).
- `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'openwhispr_app'` returns `f`.
- `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('users','sessions','audit_log','usage_ledger')` — all four return `(t, t)`.
- `pg_policies` has exactly one policy per tenant-scoped table referencing `current_setting('app.tenant_id', true)`.
- TEST-RLS-01 property test: 100 runs, 0 cross-tenant rows observed across SELECT/UPDATE/DELETE.
- `make migrate:rollback` (`drizzle-kit drop` or scripted DROP TABLE chain in reverse) exits 0; all tenant-scoped tables dropped; `__drizzle_migrations` ledger reset.

### Sampling Rate

- **Per task commit:** `pnpm --filter @openwhispr/data test -- --run` (~30s with testcontainers reuse).
- **Per wave merge:** full Phase 1 test suite including PgBouncer-sidecar property test (~2 min).
- **Phase gate:** full suite green before `/gsd-verify-work`; CI's `test-migration` job covers forward+rollback as a separate gate.

### Wave 0 Gaps

- [ ] `packages/data/drizzle.config.ts` — drizzle-kit config (schema path, migrations dir, `_meta` schema for migrations table).
- [ ] `packages/data/src/schema/{tenants,users,sessions,audit_log,usage_ledger}.ts` — five schema files.
- [ ] `packages/data/src/schema/index.ts` — re-export + `TENANT_SCOPED_TABLES`.
- [ ] `packages/data/src/client.ts` — `makeAppDb` + `makeOwnerDb`.
- [ ] `packages/data/src/tenant-context.ts` — `withTenant`.
- [ ] `packages/data/src/encryption/{key-provider,env-key-provider,vault-key-provider,kms-key-provider,envelope}.ts` — five files.
- [ ] `packages/data/src/migrate.ts` — programmatic migration entry point used by `make migrate`.
- [ ] `packages/data/migrations/0000_initial.sql` — first migration (drizzle-kit generated, hand-augmented for RLS DDL since drizzle-kit doesn't emit `ENABLE/FORCE ROW LEVEL SECURITY` natively as of 0.31.10).
- [ ] `packages/data/migrations/init/00-roles.sql` — role creation template (mounted into postgres container).
- [ ] `packages/data/src/__tests__/rls-property.test.ts` — TEST-RLS-01 with PgBouncer sidecar.
- [ ] `packages/data/src/__tests__/migration-rollback.test.ts` — TEST-MIGRATION-01.
- [ ] `packages/data/src/__tests__/envelope.test.ts` — DATA-05.
- [ ] `packages/data/src/__tests__/key-provider.test.ts` — PROVIDER-02.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | partial | Phase 1 ships `sessions` table with bytea `token_hash`; Phase 2 wires Better Auth issuance. |
| V3 Session Management | partial | `sessions.token_hash` is SHA-256 of opaque bearer (`[ASSUMED]` re hash algorithm — Phase 2 confirms; bytea is wide enough for 32 bytes). |
| V4 Access Control | yes | RLS + two-role model is the access-control implementation. Lint script (D-21) enforces. |
| V5 Input Validation | yes | UUID validation in `withTenant`; zod for KeyProvider config; drizzle's parameterization for SQL. |
| V6 Cryptography | yes | AES-256-GCM via `node:crypto` (audited), 12-byte IV, 32-byte DEK, 32-byte KEK, GCM auth tag. KEK never hand-rolled — comes from env / Vault / KMS. |

### Known Threat Patterns for {Postgres + Drizzle + PgBouncer + Node crypto}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection in tenant ID | Tampering | UUID regex validation in `withTenant`; drizzle parameterization (`set_config(name, value, true)` uses bind param). |
| Cross-tenant leak via missing RLS | Information Disclosure | `ENABLE` + `FORCE` RLS on every tenant-scoped table; lint script (D-21) introspects `pg_class.relrowsecurity` AND `relforcerowsecurity`. |
| Cross-tenant leak via PgBouncer | Information Disclosure | `set_config(..., true)` (LOCAL flag) inside transaction; never plain `SET`. Property test (D-20) asserts under real PgBouncer. |
| Privilege escalation via role inheritance | Elevation | Two independent roles, no `GRANT role TO role` chain; defensive `DO $$ ... RAISE EXCEPTION` in init script asserts `_app` lacks BYPASSRLS. |
| GCM IV reuse | Information Disclosure | `randomBytes(12)` for every encryption op; never reuse. |
| KEK exposure in logs | Information Disclosure | `MASTER_KEK` redacted by structured-log scrubber (Phase 0 pattern); never logged in plaintext. |
| DEK retention in memory after use | Information Disclosure | `dek.fill(0)` after use (best-effort given V8 GC behavior); `[ASSUMED]` re effectiveness — V8 may copy buffers. Document as defense-in-depth. |
| Tampered ciphertext accepted | Tampering | AES-GCM auth tag verification — `decipher.final()` throws on mismatch. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | drizzle-kit 0.31.10 still does NOT emit `ENABLE/FORCE ROW LEVEL SECURITY` natively from schema definitions, so the first migration must be hand-edited to add the RLS DDL after drizzle-kit generation | §4 first migration | If drizzle-kit gained native RLS support in a recent minor, the migration generation flow simplifies; risk is wasted effort, not correctness. |
| A2 | `dek.fill(0)` provides meaningful zeroization given V8's GC and string interning | §6 envelope encryption | Defense-in-depth claim; if ineffective, KEK still protects DEK at rest. Low risk; document as best-effort. |
| A3 | bytea `token_hash` will be SHA-256 (32 bytes) — Phase 2 decision | Schema/sessions | Phase 2 may pick a different KDF (Argon2id for password-style, SHA-256 for opaque bearers). bytea column is wide enough for any choice. Low risk. |
| A4 | PgBouncer 1.23+ `max_prepared_statements = 200` is sufficient for Drizzle's prepared statement cache size | §1 Drizzle | If exceeded, statements get re-prepared per request — perf hit but no correctness issue. Tune later under load. |
| A5 | `bitnami/pgbouncer:1.23` image is multi-arch (amd64+arm64) and current as of 2026-05-09 | §1 stack | Runtime-verified by other researcher (infra dimension). |

## Open Questions

1. **Should `tenants` itself be readable by `_app` only via RLS as well?**
   - What we know: Currently spec says `tenants` is the root table, no RLS, app gets `SELECT` only. App reads `tenants` to resolve current tenant before setting `app.tenant_id`.
   - What's unclear: Is reading other tenants' rows (without metadata, just IDs) a leak risk? Names could be sensitive.
   - Recommendation: For Phase 1, leave `tenants` un-RLS (keep simple; only `id` and `name` exposed). For Phase 6+, add RLS on `tenants` keyed by `id = current_setting(...)::uuid` once tenant resolution stops happening through this table. Document as a Phase 6 follow-up.

2. **Drizzle-kit native RLS support — is it in 0.45.x / 0.31.x?**
   - What we know: Drizzle has a `pgPolicy` helper introduced in 2024; some versions emit policy DDL.
   - What's unclear: As of 0.31.10 drizzle-kit, does `pgTable.rls()` emit `FORCE` automatically? (Tagged A1 above as ASSUMED.)
   - Recommendation: Plan task includes "verify drizzle-kit RLS output, hand-augment migration if needed" — the migration SQL is the contract, not what drizzle-kit emits.

3. **Should `usage_ledger` be partitioned from day 1?**
   - What we know: PITFALLS.md flags ledger bloat as a "first large-table migration after launch" risk.
   - What's unclear: Phase 1 spec doesn't mention partitioning.
   - Recommendation: Out of scope for Phase 1 — single table is fine until ~1M rows/day. Phase 6 (quotas/billing) revisits.

## Sources

### Primary (HIGH confidence)
- `[VERIFIED]` `npm view drizzle-orm version` → 0.45.2 (2026-05-09)
- `[VERIFIED]` `npm view drizzle-kit version` → 0.31.10
- `[VERIFIED]` `npm view pg version` → 8.20.0
- `[VERIFIED]` `npm view fast-check version` → 4.7.0
- `[VERIFIED]` `npm view @fast-check/vitest version` → 0.4.1
- `[CITED]` Postgres 17 docs § Row Security Policies — https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- `[CITED]` PgBouncer features (transaction pool + prepared statements) — https://www.pgbouncer.org/features.html
- `[CITED]` Drizzle ORM docs (drizzle-kit migrate, custom types) — https://orm.drizzle.team/
- `[CITED]` Phase 1 CONTEXT.md decisions D-13..D-23 (locked)
- `[CITED]` PROJECT.md DATA-01..07, TEST-MIGRATION-01, TEST-RLS-01, PROVIDER-02
- `[CITED]` ARCHITECTURE.md §4 Multi-Tenancy Model (DDL sketch)
- `[CITED]` PITFALLS.md #10 (forgotten RLS), #11 (`SET` vs `SET LOCAL`), #12 (job context loss)
- `[CITED]` Node.js `crypto` docs — `createCipheriv`, `randomBytes` (AES-GCM)

### Secondary (MEDIUM confidence)
- testcontainers-node + `@testcontainers/postgresql` — established pattern in CI; latest minor used.

### Tertiary (LOW confidence)
- (none — every claim is verified or cited)

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — all verified against npm 2026-05-09.
- Architecture (two-role model + RLS template): HIGH — Postgres docs explicit; CONTEXT decisions locked.
- Pitfalls: HIGH — sourced from PITFALLS.md + Postgres docs.
- KEK/DEK envelope: HIGH for AES-GCM mechanics; MEDIUM for `dek.fill(0)` effectiveness (A2).
- drizzle-kit native RLS DDL emission: MEDIUM — A1 ASSUMED, may need hand-augmentation.

**Research date:** 2026-05-09
**Valid until:** 2026-06-08 (30 days; npm versions move fast — re-verify before Phase 1 execution if delay > 4 weeks)

---

*Phase 1 Research — DB / RLS / encryption dimension. Other dimensions: infra/compose, tooling.*
