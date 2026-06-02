// SPDX-License-Identifier: FSL-1.1-ALv2
// Quick 260602-x6z (upstream #4) — fresh `migrate` MUST succeed under a single
// NOBYPASSRLS owner role (corporate managed Postgres). Pre-fix, migration 0006
// runs `INSERT INTO tenant_settings ... SELECT id FROM tenants` under FORCE RLS
// before migration 0033's app.bypass arm exists → 42501 unless the owner role
// has BYPASSRLS. The fix: (A) 0006 policies are bypass-aware at creation, and
// (B) the migrate runner sets MIGRATE_SESSION_OPTIONS (app.bypass=on +
// app.tenant_id=<default>) on the migrate pool. This test boots the owner role
// WITHOUT BYPASSRLS and applies the full history through a pool carrying those
// exact options — proving replay works on one NOBYPASSRLS role.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionPgPartman } from "../../../src/__tests__/helpers.js";
import { MIGRATE_SESSION_OPTIONS } from "../../../src/migrate.js";
import * as schema from "../../../src/schema/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "..", "migrations");
const PARTMAN_IMAGE = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";
const TIMEOUT = 180_000;

let pg: StartedPostgreSqlContainer | undefined;
let ownerUri = "";
let migrateError: unknown;

beforeAll(async () => {
  pg = await new PostgreSqlContainer(PARTMAN_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: pg.getConnectionUri() });
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  // CRITICAL: owner role is NOBYPASSRLS — this is the corporate managed-PG
  // scenario. If the fix is incomplete, migrate() throws 42501 on 0006.
  await superPool.query(
    "CREATE ROLE openwhispr_owner WITH LOGIN NOBYPASSRLS CREATEROLE PASSWORD 'owner-pw'",
  );
  await superPool.query("CREATE ROLE openwhispr_app WITH LOGIN NOBYPASSRLS PASSWORD 'app-pw'");
  await superPool.query("GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION");
  await superPool.query('GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner');
  await superPool.query('GRANT SET, ALTER SYSTEM ON PARAMETER "app.bypass" TO openwhispr_owner');
  await superPool.query("ALTER DATABASE openwhispr OWNER TO openwhispr_owner");
  await superPool.query("ALTER SCHEMA public OWNER TO openwhispr_owner");
  await provisionPgPartman(superPool);
  await superPool.end();

  ownerUri = `postgres://openwhispr_owner:owner-pw@${pg.getHost()}:${pg.getMappedPort(5432)}/openwhispr`;

  // Build the migrate pool EXACTLY as migrate.ts does — carrying
  // MIGRATE_SESSION_OPTIONS (app.bypass=on + app.tenant_id=<default>).
  const ownerPool = new Pool({ connectionString: ownerUri, options: MIGRATE_SESSION_OPTIONS });
  try {
    await migrate(drizzle(ownerPool, { schema }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: "_meta",
      migrationsTable: "__drizzle_migrations",
    });
  } catch (err) {
    migrateError = err;
  } finally {
    await ownerPool.end();
  }
}, TIMEOUT);

afterAll(async () => {
  if (pg) await pg.stop();
}, 60_000);

describe("fresh migrate under a single NOBYPASSRLS role (upstream #4)", () => {
  it("migrate() succeeds end-to-end (no 42501 on the 0006 seed INSERT)", () => {
    expect(migrateError).toBeUndefined();
  });

  it("0006 backfilled the default tenant's tenant_settings row", async () => {
    const pool = new Pool({ connectionString: ownerUri, options: MIGRATE_SESSION_OPTIONS });
    try {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tenant_settings WHERE tenant_id = '00000000-0000-0000-0000-000000000000'`,
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("the 0006 policies are bypass-aware (contain app.bypass)", async () => {
    const pool = new Pool({ connectionString: ownerUri, options: MIGRATE_SESSION_OPTIONS });
    try {
      const { rows } = await pool.query<{ qual: string; with_check: string }>(
        `SELECT qual, with_check FROM pg_policies
          WHERE tablename = 'tenant_settings' AND policyname = 'tenant_settings_isolation'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.qual).toContain("app.bypass");
      expect(rows[0]?.with_check).toContain("app.bypass");
    } finally {
      await pool.end();
    }
  });

  it("the owner role genuinely has NO BYPASSRLS (proves the claim, not the attribute)", async () => {
    const pool = new Pool({ connectionString: ownerUri, options: MIGRATE_SESSION_OPTIONS });
    try {
      const { rows } = await pool.query<{ rolbypassrls: boolean }>(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(rows[0]?.rolbypassrls).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it("FORCE RLS is still enabled on tenant_settings (posture intact)", async () => {
    const pool = new Pool({ connectionString: ownerUri, options: MIGRATE_SESSION_OPTIONS });
    try {
      const { rows } = await pool.query<{ relforcerowsecurity: boolean }>(
        "SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenant_settings'",
      );
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
