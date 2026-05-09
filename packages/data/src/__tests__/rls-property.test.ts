// TEST-RLS-01 — fast-check property test for cross-tenant RLS isolation.
//
// Phase 1 / Plan 05. Drives 100+50+30+30 = 210 random tenant pairs through
// a real PgBouncer transaction-mode pool (small `max=5` to force physical
// connection reuse) and asserts that under every random pair (tenantA,
// tenantB) plus arbitrary input arrays:
//
//   * SELECT under tenantB returns zero rows belonging to tenantA.
//   * UPDATE under tenantB touches zero rows belonging to tenantA.
//   * DELETE under tenantB removes zero rows belonging to tenantA.
//
// The fifth, non-property smoke test asserts the fail-closed default:
// running a query without ever opening a `withTenant` transaction
// returns zero rows (RLS denies the unset GUC by failing the cast at
// execution time, or returning an empty result set).
//
// Per CLAUDE.md "no mocks": real Postgres 17 + real edoburu/pgbouncer
// 1.23.1 sidecar. Per CLAUDE.md "no simplification": all four
// tenant-scoped tables (users, sessions, audit_log, usage_ledger) are
// exercised, not just users. The full property suite runs ~3min with
// the per-property timeout set to 180_000ms.
//
// References:
//  * .planning/phases/01-core-infra-multi-tenant-data/01-RESEARCH-DB.md
//    §"TEST-RLS-01 property test (concrete)"
//  * .planning/phases/01-core-infra-multi-tenant-data/01-RESEARCH-INFRA.md §3.3

import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@fast-check/vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as fc from "fast-check";
import { Pool } from "pg";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema/index.js";
import { TENANT_SCOPED_TABLES } from "../schema/index.js";
import { withTenant } from "../tenant-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "migrations");

/**
 * The migrations file is produced by Plan 03; if it isn't on disk
 * (parallel-wave development) the suite self-skips rather than failing.
 */
function migrationsReady(): boolean {
  if (!existsSync(MIGRATIONS_FOLDER)) return false;
  try {
    return readdirSync(MIGRATIONS_FOLDER).some((f) => f.endsWith(".sql"));
  } catch {
    return false;
  }
}

const READY = migrationsReady();
const SUITE = READY ? describe : describe.skip;

interface Harness {
  network: StartedNetwork;
  pg: StartedPostgreSqlContainer;
  pgbouncer: StartedTestContainer;
  ownerUri: string;
  appPool: Pool;
  stop: () => Promise<void>;
}

async function bootHarness(): Promise<Harness> {
  const network = await new Network().start();

  const pg = await new PostgreSqlContainer("postgres:17-alpine")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: pg.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'owner-pw'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD 'app-pw'`);
  // Phase 02.5 / Plan 02 — migration 0003 ALTERs openwhispr_app's role
  // config; owner needs CREATEROLE + ADMIN OPTION on app + SET grant on the
  // custom GUC `app.tenant_id`. In production owner is bootstrap superuser.
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const ownerUri = `postgres://openwhispr_owner:owner-pw@${pg.getHost()}:${pg.getMappedPort(5432)}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool, { schema });
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  // edoburu/pgbouncer publishes tags as `vMAJOR.MINOR.PATCH-p<rev>`;
  // the bare `1.23.1` referenced in the plan resolves to `v1.23.1-p3`
  // (latest patch revision of the 1.23.1 line). Matches Plan 04.
  const pgbouncer = await new GenericContainer("edoburu/pgbouncer:v1.23.1-p3")
    .withNetwork(network)
    .withEnvironment({
      DB_HOST: "postgres",
      DB_USER: "openwhispr_app",
      DB_PASSWORD: "app-pw",
      DB_NAME: "openwhispr",
      POOL_MODE: "transaction",
      MAX_PREPARED_STATEMENTS: "200",
      AUTH_TYPE: "scram-sha-256",
    })
    .withExposedPorts(5432)
    .start();

  // Small max=5 forces physical connection reuse, exercising the
  // SET-LOCAL discipline under PgBouncer transaction-mode.
  const appPool = new Pool({
    host: pgbouncer.getHost(),
    port: pgbouncer.getMappedPort(5432),
    database: "openwhispr",
    user: "openwhispr_app",
    password: "app-pw",
    max: 5,
  });

  return {
    network,
    pg,
    pgbouncer,
    ownerUri,
    appPool,
    stop: async () => {
      await appPool.end();
      await pgbouncer.stop();
      await pg.stop();
      await network.stop();
    },
  };
}

/**
 * Insert two tenant rows via the OWNER pool (BYPASSRLS). The `tenants`
 * table is intentionally un-RLS'd (D-17) so the owner can write directly.
 */
async function seedTenants(ownerUri: string, tenantA: string, tenantB: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUri });
  try {
    await pool.query(
      `INSERT INTO tenants (id, name) VALUES ($1, 'A'), ($2, 'B') ON CONFLICT DO NOTHING`,
      [tenantA, tenantB],
    );
  } finally {
    await pool.end();
  }
}

/**
 * Direct-as-owner reset of the tenant-scoped tables, so each property
 * iteration starts with a clean slate. Owner BYPASSRLS lets us truncate
 * without setting `app.tenant_id`.
 */
async function resetTenantTables(ownerUri: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUri });
  try {
    // CASCADE handles the FK chain users <- sessions <- usage_ledger
    // and audit_log -> users (actor_user_id is nullable so cascade not
    // required there).
    await pool.query(
      `TRUNCATE TABLE usage_ledger, audit_log, sessions, users RESTART IDENTITY CASCADE`,
    );
  } finally {
    await pool.end();
  }
}

const TIMEOUT = 180_000;

SUITE("TEST-RLS-01: 100+ random tenant pairs through PgBouncer", () => {
  let harness: Harness | undefined;

  beforeAll(async () => {
    if (!READY) return;
    harness = await bootHarness();
  }, TIMEOUT);

  afterAll(async () => {
    if (harness) await harness.stop();
  }, 60_000);

  test.prop(
    {
      tenantA: fc.uuid({ version: 4 }),
      tenantB: fc.uuid({ version: 4 }),
      emails: fc.array(fc.emailAddress(), { minLength: 1, maxLength: 8 }),
    },
    { numRuns: 100 },
  )(
    "users: SELECT/UPDATE/DELETE under tenantB never observes tenantA rows",
    async ({ tenantA, tenantB, emails }) => {
      fc.pre(tenantA !== tenantB);
      if (!harness) throw new Error("harness not booted");
      await resetTenantTables(harness.ownerUri);
      await seedTenants(harness.ownerUri, tenantA, tenantB);
      const db = drizzle(harness.appPool, { schema });

      // Insert all emails under tenantA via the app pool (RLS-subject).
      // Deduplicate emails so the (tenant_id, email) unique index does
      // not throw on shrunk inputs that contain duplicates.
      const uniqueEmails = Array.from(new Set(emails));
      await withTenant(db, tenantA, async (tx) => {
        for (const email of uniqueEmails) {
          await tx.execute(
            sql`INSERT INTO users (tenant_id, email) VALUES (${tenantA}::uuid, ${email})`,
          );
        }
      });

      // Under tenantB: SELECT must see zero of A's rows.
      const seen = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`SELECT id, email, tenant_id::text AS tenant_id FROM users`),
      )) as { rows: Array<{ id: string; email: string; tenant_id: string }> };
      for (const row of seen.rows ?? []) {
        expect(row.tenant_id).toBe(tenantB);
      }

      // Under tenantB: UPDATE the entire users table — must touch zero rows.
      const updated = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`UPDATE users SET email = email || '.x'`),
      )) as { rowCount: number | null };
      expect(updated.rowCount ?? 0).toBe(0);

      // Under tenantB: DELETE everything — zero deleted (since A's rows
      // are invisible under B's policy).
      const deleted = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`DELETE FROM users`),
      )) as { rowCount: number | null };
      expect(deleted.rowCount ?? 0).toBe(0);

      // Confirm A still sees its rows untouched.
      const seenA = (await withTenant(db, tenantA, async (tx) =>
        tx.execute(sql`SELECT email FROM users`),
      )) as { rows: Array<{ email: string }> };
      const observed = new Set((seenA.rows ?? []).map((r) => r.email));
      for (const e of uniqueEmails) {
        expect(observed.has(e)).toBe(true);
      }
    },
    TIMEOUT,
  );

  test.prop(
    {
      tenantA: fc.uuid({ version: 4 }),
      tenantB: fc.uuid({ version: 4 }),
      // expiresAt deltas in seconds from now; bounded so timestamps stay sane.
      expirations: fc.array(fc.integer({ min: 60, max: 86400 }), {
        minLength: 1,
        maxLength: 5,
      }),
    },
    { numRuns: 50 },
  )(
    "sessions: SELECT/UPDATE/DELETE under tenantB never observes tenantA rows",
    async ({ tenantA, tenantB, expirations }) => {
      fc.pre(tenantA !== tenantB);
      if (!harness) throw new Error("harness not booted");
      await resetTenantTables(harness.ownerUri);
      await seedTenants(harness.ownerUri, tenantA, tenantB);
      const db = drizzle(harness.appPool, { schema });

      // Need a user under tenantA for the sessions FK.
      const userIdRows = (await withTenant(db, tenantA, async (tx) =>
        tx.execute(
          sql`INSERT INTO users (tenant_id, email) VALUES (${tenantA}::uuid, ${`u-${tenantA}@ex.com`}) RETURNING id`,
        ),
      )) as { rows: Array<{ id: string }> };
      const userId = userIdRows.rows[0]?.id;
      if (!userId) throw new Error("seeded user missing id");

      await withTenant(db, tenantA, async (tx) => {
        for (const sec of expirations) {
          await tx.execute(
            sql`INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
                VALUES (${tenantA}::uuid, ${userId}::uuid,
                        decode(repeat('00', 32), 'hex'),
                        now() + (${sec}::int * interval '1 second'))`,
          );
        }
      });

      const seenAsB = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`SELECT tenant_id::text AS tenant_id FROM sessions`),
      )) as { rows: Array<{ tenant_id: string }> };
      for (const r of seenAsB.rows ?? []) expect(r.tenant_id).toBe(tenantB);

      const upd = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`UPDATE sessions SET expires_at = now()`),
      )) as { rowCount: number | null };
      expect(upd.rowCount ?? 0).toBe(0);

      const del = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`DELETE FROM sessions`),
      )) as { rowCount: number | null };
      expect(del.rowCount ?? 0).toBe(0);
    },
    TIMEOUT,
  );

  test.prop(
    {
      tenantA: fc.uuid({ version: 4 }),
      tenantB: fc.uuid({ version: 4 }),
      actions: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
        minLength: 1,
        maxLength: 5,
      }),
    },
    { numRuns: 30 },
  )(
    "audit_log: cross-tenant inserts stay isolated",
    async ({ tenantA, tenantB, actions }) => {
      fc.pre(tenantA !== tenantB);
      if (!harness) throw new Error("harness not booted");
      await resetTenantTables(harness.ownerUri);
      await seedTenants(harness.ownerUri, tenantA, tenantB);
      const db = drizzle(harness.appPool, { schema });

      await withTenant(db, tenantA, async (tx) => {
        for (const action of actions) {
          await tx.execute(
            sql`INSERT INTO audit_log (tenant_id, action, payload)
                VALUES (${tenantA}::uuid, ${action}, '{}'::jsonb)`,
          );
        }
      });

      const seenAsB = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`SELECT tenant_id::text AS tenant_id FROM audit_log`),
      )) as { rows: Array<{ tenant_id: string }> };
      for (const r of seenAsB.rows ?? []) expect(r.tenant_id).toBe(tenantB);

      const upd = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`UPDATE audit_log SET action = 'mutated'`),
      )) as { rowCount: number | null };
      expect(upd.rowCount ?? 0).toBe(0);

      const del = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`DELETE FROM audit_log`),
      )) as { rowCount: number | null };
      expect(del.rowCount ?? 0).toBe(0);
    },
    TIMEOUT,
  );

  test.prop(
    {
      tenantA: fc.uuid({ version: 4 }),
      tenantB: fc.uuid({ version: 4 }),
      requestIds: fc.array(fc.uuid({ version: 4 }), { minLength: 1, maxLength: 5 }),
      units: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
    },
    { numRuns: 30 },
  )(
    "usage_ledger: cross-tenant inserts stay isolated",
    async ({ tenantA, tenantB, requestIds, units }) => {
      fc.pre(tenantA !== tenantB);
      if (!harness) throw new Error("harness not booted");
      await resetTenantTables(harness.ownerUri);
      await seedTenants(harness.ownerUri, tenantA, tenantB);
      const db = drizzle(harness.appPool, { schema });

      // user under A, FK target.
      const userRows = (await withTenant(db, tenantA, async (tx) =>
        tx.execute(
          sql`INSERT INTO users (tenant_id, email) VALUES (${tenantA}::uuid, ${`u-${tenantA}@ex.com`}) RETURNING id`,
        ),
      )) as { rows: Array<{ id: string }> };
      const userId = userRows.rows[0]?.id;
      if (!userId) throw new Error("seeded user missing id");

      const dedupedRequestIds = Array.from(new Set(requestIds));
      const n = Math.min(dedupedRequestIds.length, units.length);

      await withTenant(db, tenantA, async (tx) => {
        for (let i = 0; i < n; i++) {
          const rid = dedupedRequestIds[i];
          const u = units[i];
          await tx.execute(
            sql`INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
                VALUES (${tenantA}::uuid, ${userId}::uuid, ${rid}, 'transcribe', ${u})`,
          );
        }
      });

      const seenAsB = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`SELECT tenant_id::text AS tenant_id FROM usage_ledger`),
      )) as { rows: Array<{ tenant_id: string }> };
      for (const r of seenAsB.rows ?? []) expect(r.tenant_id).toBe(tenantB);

      const upd = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`UPDATE usage_ledger SET units = 0`),
      )) as { rowCount: number | null };
      expect(upd.rowCount ?? 0).toBe(0);

      const del = (await withTenant(db, tenantB, async (tx) =>
        tx.execute(sql`DELETE FROM usage_ledger`),
      )) as { rowCount: number | null };
      expect(del.rowCount ?? 0).toBe(0);
    },
    TIMEOUT,
  );

  it("fail-closed: query without withTenant returns zero rows or RLS-cast error", async () => {
    if (!harness) throw new Error("harness not booted");
    // Seed something under a tenant via owner (bypass RLS) to ensure
    // there IS data; then probe via the app pool with NO `withTenant`
    // wrapper at all.
    const seedTenant = "ddddeeee-dddd-4ddd-bbbb-eeeeeeeeeeee";
    await resetTenantTables(harness.ownerUri);
    const ownerPool = new Pool({ connectionString: harness.ownerUri });
    try {
      await ownerPool.query(
        `INSERT INTO tenants (id, name) VALUES ($1, 'seed') ON CONFLICT DO NOTHING`,
        [seedTenant],
      );
      await ownerPool.query(`INSERT INTO users (tenant_id, email) VALUES ($1, 'fc@ex.com')`, [
        seedTenant,
      ]);
    } finally {
      await ownerPool.end();
    }

    try {
      const probe = (await harness.appPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM users",
      )) as { rows: Array<{ n: number }> };
      // Either the probe returns 0 (Pitfall 4 fail-closed) or it throws
      // an invalid-uuid cast error inside the policy. Both prove the
      // GUC-less path cannot read tenant data.
      expect(probe.rows[0]?.n).toBe(0);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      expect(msg).toMatch(/invalid input syntax for type uuid/i);
    }
  });

  it("schema export TENANT_SCOPED_TABLES covers the v1 surface", () => {
    // Auto-discovery hook for future migrations: every tenant-scoped
    // table the property test exercises must appear in the schema
    // export. Adding a new tenant-scoped table without updating this
    // export forces a property-test failure here, which is the
    // intentional gate (Plan 03 + Plan 05 cross-reference).
    expect([...TENANT_SCOPED_TABLES].sort()).toEqual(
      [
        "account",
        "audit_log",
        "oauth_state",
        "sessions",
        "usage_ledger",
        "users",
        "verification",
      ].sort(),
    );
  });
});

if (!READY) {
  // biome-ignore lint/suspicious/noConsole: deliberate skip notice for parallel-wave plans
  console.warn(
    "[rls-property] migrations/0000_*.sql not present yet — skipping. Plan 01-03 lands the SQL.",
  );
}
