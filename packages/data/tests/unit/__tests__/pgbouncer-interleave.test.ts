// SPDX-License-Identifier: FSL-1.1-ALv2
// PgBouncer-interleave property test — Phase 1 Plan 04 / D-20.
//
// The load-bearing claim of the multi-tenant data plane is "no row from
// tenant A is ever observed by a query running under tenant B, even when
// PgBouncer is multiplexing a small physical-connection pool across many
// tenant requests." This test proves that claim end-to-end:
//
//   1. Spin a real Postgres 17 with the constitutional roles
//      (`openwhispr_owner` BYPASSRLS for DDL, `openwhispr_app` RLS-subject
//      for everything else).
//   2. Apply the 0000_initial migration so the FORCE-RLS policies exist.
//   3. Spin a real PgBouncer 1.23 sidecar in transaction-pool mode in
//      front of `openwhispr_app`.
//   4. Connect a Drizzle pool with `max: 5` so the 100 alternating
//      tenant-A/tenant-B operations are forced to reuse physical
//      connections — without the SET-LOCAL discipline this would leak.
//   5. Insert as tenant A, then read as tenant B, then read with no
//      tenant context. The assertions: B never sees an A-row, and the
//      no-context probe sees zero rows (RLS fail-closed, Pitfall 4).
//
// Why two tests:
//   - The headline test uses pool max=5 (matches RESEARCH-DB §"TEST-RLS-01
//     property test (concrete)").
//   - The smaller-pool test uses max=3 to apply additional pressure on
//     physical-connection reuse. Same isolation must hold.
//
// Skip behavior:
//   This test depends on Plan 01-03's `0000_initial.sql` migration. If
//   that file isn't on disk yet (Plans 03 + 04 land in parallel as Wave
//   2), the test self-skips with a clear message rather than failing.
//   Once 01-03 lands the SQL the test activates automatically.
//
// Per CLAUDE.md "no mocks": real Postgres + real PgBouncer in
// testcontainers, not pg-mem.
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionPgPartman } from "../../../src/__tests__/helpers.js";
import * as schema from "../../../src/schema/index.js";
import { withTenant } from "../../../src/tenant-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "migrations");

/**
 * Plan 03 lands the actual `0000_*.sql` migration; Plan 04 ships in
 * parallel. If we're running before 03 has produced SQL files, skip
 * cleanly — the unit-test contract for `withTenant` is unaffected.
 */
function migrationsReady(): boolean {
  if (!existsSync(MIGRATIONS_FOLDER)) return false;
  try {
    const files = readdirSync(MIGRATIONS_FOLDER);
    return files.some((f) => f.endsWith(".sql"));
  } catch {
    return false;
  }
}

const READY = migrationsReady();
const SUITE = READY ? describe : describe.skip;

const TENANT_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

interface PoolHarness {
  network: StartedNetwork;
  pg: StartedPostgreSqlContainer;
  pgbouncer: StartedTestContainer;
  stop: () => Promise<void>;
}

async function bootPgWithPgBouncer(): Promise<PoolHarness> {
  const network = await new Network().start();

  const pg = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
    .withNetwork(network)
    .withNetworkAliases("postgres")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  // Bootstrap roles + ownership so migrations can run as owner.
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
  await provisionPgPartman(superPool);
  await superPool.end();

  const ownerUri = `postgres://openwhispr_owner:owner-pw@${pg.getHost()}:${pg.getMappedPort(5432)}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool, { schema });
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  // Insert tenant rows for A and B as owner (tenants is un-RLS'd; D-17).
  await ownerPool.query(
    `INSERT INTO tenants (id, name) VALUES ($1, 'A'), ($2, 'B') ON CONFLICT DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
  await ownerPool.end();

  // edoburu/pgbouncer publishes tags in `vMAJOR.MINOR.PATCH-p<rev>` format —
  // the bare `1.23.1` tag the plan refers to is conceptual; the registry
  // only carries `v1.23.1-p3` (latest patch revision of the 1.23.1 line).
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

  return {
    network,
    pg,
    pgbouncer,
    stop: async () => {
      await pgbouncer.stop();
      await pg.stop();
      await network.stop();
    },
  };
}

function makeAppPool(harness: PoolHarness, max: number): Pool {
  return new Pool({
    host: harness.pgbouncer.getHost(),
    port: harness.pgbouncer.getMappedPort(5432),
    database: "openwhispr",
    user: "openwhispr_app",
    password: "app-pw",
    max,
  });
}

SUITE("PgBouncer-interleave: cross-tenant isolation under transaction-pool reuse", () => {
  let harness: PoolHarness | undefined;

  beforeAll(async () => {
    // Vitest 4 runs `beforeAll` even inside `describe.skip` — guard
    // the boot so we don't try to start containers when migrations
    // aren't on disk yet.
    if (!READY) return;
    harness = await bootPgWithPgBouncer();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.stop();
  }, 60_000);

  async function runInterleave(maxConnections: number): Promise<void> {
    if (!harness) throw new Error("harness not booted (READY check failed)");
    const pool = makeAppPool(harness, maxConnections);
    const db = drizzle(pool, { schema });
    // Use a per-run salt so the second test (max=3) doesn't collide
    // against the first run's email rows on the
    // `users_tenant_email_unique(tenant_id, email)` index.
    const runSalt = `${maxConnections}-${Math.floor(Math.random() * 1e9)}`;
    try {
      // Insert N rows under each tenant + assert isolation across 100 ops.
      const insertedEmailsA: string[] = [];
      const insertedEmailsB: string[] = [];

      for (let i = 0; i < 100; i++) {
        const useA = i % 2 === 0;
        const tenant = useA ? TENANT_A : TENANT_B;
        // Three op shapes interleaved: insert / select-under-tenant /
        // probe-without-context.
        const shape = i % 3;
        if (shape === 0) {
          const email = `t${useA ? "a" : "b"}-${runSalt}-${i}@ex.com`;
          await withTenant(db, tenant, async (tx) => {
            await tx.execute(
              sql`INSERT INTO users (tenant_id, email) VALUES (${tenant}::uuid, ${email})`,
            );
          });
          (useA ? insertedEmailsA : insertedEmailsB).push(email);
        } else if (shape === 1) {
          const seen = (await withTenant(db, tenant, async (tx) =>
            tx.execute(sql`SELECT tenant_id::text AS tenant_id FROM users`),
          )) as { rows: Array<{ tenant_id: string }> };
          for (const row of seen.rows ?? []) {
            expect(row.tenant_id).toBe(tenant);
          }
        } else {
          // Probe with NO tenant context. RLS fail-closed semantics
          // (Pitfall 4) come in two flavors depending on how the
          // policy is written: either the cast `''::uuid` raises
          // `invalid input syntax for type uuid` at execution time,
          // or the row simply isn't returned (count = 0). Both
          // outcomes prove that an unset GUC cannot read tenant
          // data; we accept either.
          try {
            const probe = (await pool.query("SELECT count(*)::int AS n FROM users")) as {
              rows: Array<{ n: number }>;
            };
            const first = probe.rows[0];
            expect(first?.n).toBe(0);
          } catch (err) {
            const msg = (err as Error).message ?? "";
            expect(msg).toMatch(/invalid input syntax for type uuid/i);
          }
        }
      }

      // Final cross-tenant assertion under each tenant.
      const seenAsB = (await withTenant(db, TENANT_B, async (tx) =>
        tx.execute(sql`SELECT email, tenant_id::text AS tenant_id FROM users`),
      )) as { rows: Array<{ email: string; tenant_id: string }> };
      for (const row of seenAsB.rows ?? []) {
        expect(row.tenant_id).toBe(TENANT_B);
        expect(insertedEmailsA).not.toContain(row.email);
      }

      const seenAsA = (await withTenant(db, TENANT_A, async (tx) =>
        tx.execute(sql`SELECT email, tenant_id::text AS tenant_id FROM users`),
      )) as { rows: Array<{ email: string; tenant_id: string }> };
      for (const row of seenAsA.rows ?? []) {
        expect(row.tenant_id).toBe(TENANT_A);
        expect(insertedEmailsB).not.toContain(row.email);
      }
    } finally {
      await pool.end();
    }
  }

  it("100 alternating tenant-A/B/no-context ops with pool max=5 leak zero rows", async () => {
    await runInterleave(5);
  }, 180_000);

  it("smaller pool max=3 also preserves isolation", async () => {
    await runInterleave(3);
  }, 180_000);
});

if (!READY) {
  // eslint-disable-next-line no-console
  // biome-ignore lint/suspicious/noConsole: deliberate skip notice for parallel-wave plans
  console.warn(
    "[pgbouncer-interleave] migrations/0000_*.sql not present yet — skipping. Plan 01-03 lands the SQL; this suite activates automatically once it's on disk.",
  );
}
