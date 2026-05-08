// Shared testcontainers helpers for the Plan 03 data-layer suite.
//
// All three integration tests (migration-rollback, usage-ledger, audit-log)
// boot the same shape of Postgres 17 container with the openwhispr_owner
// + openwhispr_app roles pre-created and the migration applied. We expose
// `bootMigratedPostgres()` that returns a started container plus owner/app
// connection URIs so individual tests do not duplicate the boot logic.
//
// Real Postgres + real DDL only — never pg-mem (CLAUDE.md "no mocks").

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../schema/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/data/src/__tests__ -> packages/data/migrations
export const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "migrations");

export interface BootResult {
  container: StartedPostgreSqlContainer;
  ownerUri: string;
  appUri: string;
  stop: () => Promise<void>;
}

/**
 * Boot a Postgres 17 container, create the openwhispr_owner role
 * (with BYPASSRLS) AND the openwhispr_app role (without BYPASSRLS),
 * GRANT-chain the owner so it can run migrations, then apply the
 * Drizzle migrations from packages/data/migrations.
 *
 * The PostgreSqlContainer's superuser-created database starts owned by
 * its bootstrap role. We re-assign ownership to openwhispr_owner so the
 * 0000_initial.sql DDL (run as owner) can create tables in `public`.
 */
export async function bootMigratedPostgres(): Promise<BootResult> {
  const ownerPassword = "owner-pw-test";
  const appPassword = "app-pw-test";

  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = container.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });

  // Create our two constitutional roles. The container's bootstrap role
  // (postgres_super) is a superuser, so it can create roles + assign
  // BYPASSRLS without ALTER ROLE round-trips.
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  // Owner needs CREATE on public to add tables; on PG 15+ public is owned
  // by the bootstrap user, so transfer ownership of the schema too.
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;
  const appUri = `postgres://openwhispr_app:${appPassword}@${host}:${port}/openwhispr`;

  // Apply migrations as owner. drizzle-orm's migrate() honors the
  // migrationsSchema / migrationsTable options to keep the bookkeeping
  // table in `_meta` (Pitfall 8).
  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool, { schema });
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  return {
    container,
    ownerUri,
    appUri,
    stop: async () => {
      await container.stop();
    },
  };
}

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
