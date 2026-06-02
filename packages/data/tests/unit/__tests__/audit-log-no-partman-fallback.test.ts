// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260602-fda — blocker #1: audit_log migration must apply on a Postgres
// WITHOUT pg_partman (managed cloud Postgres where partman is not installable).
//
// Boots a STOCK postgres:17-alpine (no pg_partman in pg_available_extensions),
// applies ALL drizzle migrations, and asserts:
//   - migrate() succeeds (pre-fix it threw on 0014's partman.create_parent),
//   - audit_log is still a partitioned parent (relkind='p'),
//   - a native `audit_log_default` DEFAULT partition exists (the fallback),
//   - an INSERT into audit_log succeeds and routes to a child partition,
//   - pg_partman is genuinely absent (this is the no-partman branch).
//
// The pg_partman path stays covered by audit-log-partitioning.test.ts.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_FOLDER } from "../../../src/__tests__/helpers.js";

// Stock upstream image — deliberately NO pg_partman, mirroring a managed
// Postgres where the extension cannot be installed.
const STOCK_IMAGE = "postgres:17-alpine";

let container: StartedPostgreSqlContainer | undefined;
let ownerUri = "";

beforeAll(async () => {
  const ownerPassword = "owner-pw-test";
  const appPassword = "app-pw-test";
  container = await new PostgreSqlContainer(STOCK_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  // NO partman provisioning — this is the managed-Postgres scenario.
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;

  // Apply migrations as owner — MUST NOT throw on 0014 without partman.
  const ownerPool = new Pool({ connectionString: ownerUri });
  try {
    await migrate(drizzle(ownerPool), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: "_meta",
      migrationsTable: "__drizzle_migrations",
    });
  } finally {
    await ownerPool.end();
  }
}, 180_000);

afterAll(async () => {
  await container?.stop();
}, 60_000);

describe("audit_log migration without pg_partman (managed Postgres)", () => {
  it("pg_partman is genuinely absent from the cluster", async () => {
    const pool = new Pool({ connectionString: ownerUri });
    try {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_extension WHERE extname='pg_partman'`,
      );
      expect(rows[0]?.n).toBe("0");
    } finally {
      await pool.end();
    }
  });

  it("audit_log is still a partitioned parent (relkind='p')", async () => {
    const pool = new Pool({ connectionString: ownerUri });
    try {
      const { rows } = await pool.query<{ relkind: string }>(
        `SELECT relkind::text AS relkind FROM pg_class WHERE relname='audit_log'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.relkind).toBe("p");
    } finally {
      await pool.end();
    }
  });

  it("a native audit_log_default DEFAULT partition exists (the fallback child)", async () => {
    const pool = new Pool({ connectionString: ownerUri });
    try {
      // The DEFAULT partition is the catch-all; pg marks it via
      // pg_partitioned_table / pg_class.relispartition. We assert the child
      // exists and inherits from audit_log.
      const { rows } = await pool.query<{ child: string }>(
        `SELECT c.relname AS child
           FROM pg_inherits i
           JOIN pg_class c ON c.oid = i.inhrelid
           JOIN pg_class p ON p.oid = i.inhparent
          WHERE p.relname = 'audit_log'
            AND c.relname = 'audit_log_default'`,
      );
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  it("INSERT into audit_log succeeds and routes to a child partition (auth.signin works)", async () => {
    const tenant = "55555555-5555-4555-8555-555555555555";
    const pool = new Pool({ connectionString: ownerUri });
    try {
      await pool.query(
        `INSERT INTO tenants(id,name) VALUES ($1::uuid,'NoPartman') ON CONFLICT DO NOTHING`,
        [tenant],
      );
      // This is the auth.signin audit path — fail-closed in prod. It must
      // succeed against the DEFAULT partition.
      await pool.query(
        `INSERT INTO audit_log (tenant_id, action, payload)
           VALUES ($1::uuid, 'auth.signin', '{}'::jsonb)`,
        [tenant],
      );
      const { rows } = await pool.query<{ child: string }>(
        `SELECT tableoid::regclass::text AS child FROM audit_log WHERE tenant_id = $1::uuid LIMIT 1`,
        [tenant],
      );
      expect(rows).toHaveLength(1);
      // Routed to the DEFAULT child, not the bare parent.
      expect(rows[0]?.child).toContain("audit_log_default");
    } finally {
      await pool.end();
    }
  });

  it("RLS is ENABLED + FORCED on the parent (posture preserved without partman)", async () => {
    const pool = new Pool({ connectionString: ownerUri });
    try {
      const { rows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='audit_log'`);
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
