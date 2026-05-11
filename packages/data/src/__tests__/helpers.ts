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
export interface BootOptions {
  /**
   * Override the Postgres container image. Phase 6 / Plan 02 introduces
   * `openwhispr/postgres:17.5-pgpartman` (postgres:17.5-alpine + pg_partman
   * 5.2.4) for the audit_log partitioning tests. Default remains the stock
   * upstream image so Phase 1–5 tests are unaffected.
   *
   * The image MUST be locally available (built via
   * `docker build ./compose/postgres -t openwhispr/postgres:17.5-pgpartman`)
   * because testcontainers does not pull from a registry by default.
   */
  image?: string;
  /**
   * If true, `CREATE EXTENSION pg_partman` is provisioned in the database
   * before running drizzle migrations. The custom image ships the
   * extension files; we still need to CREATE EXTENSION inside the openwhispr
   * database (initdb scripts run on the bootstrap database only after the
   * container is fully up, but testcontainers' wait-strategy may race the
   * /docker-entrypoint-initdb.d hook). Setting this flag makes the harness
   * idempotently provision the extension as the superuser before migrate().
   */
  withPgPartman?: boolean;
}

export async function bootMigratedPostgres(opts: BootOptions = {}): Promise<BootResult> {
  const ownerPassword = "owner-pw-test";
  const appPassword = "app-pw-test";
  // Phase 6 / Plan 02 — migration 0014 requires pg_partman. The default
  // image is therefore `openwhispr/postgres:17.5-pgpartman` (built by
  // compose/postgres/Dockerfile). Existing Phase 1-5 tests inherit this
  // change transparently: pg_partman's presence is benign for any
  // migration that does not invoke it.
  const image = opts.image ?? "openwhispr/postgres:17.5-pgpartman";
  // pg_partman is always provisioned when running migrations because 0014
  // calls partman.create_parent at apply time. Callers can pass
  // `withPgPartman: false` only if they pin a non-default image that
  // doesn't ship the extension — in that case migrations beyond 0013
  // will fail by design.
  const withPgPartman = opts.withPgPartman ?? true;

  const container = await new PostgreSqlContainer(image)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = container.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });

  if (withPgPartman) {
    // Custom image has pg_partman 5.2.4 in pg_available_extensions; we
    // explicitly CREATE EXTENSION in the openwhispr database (the initdb
    // hook may not run in testcontainers' bootstrap flow).
    await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
    await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  }

  // Create our two constitutional roles. The container's bootstrap role
  // (postgres_super) is a superuser, so it can create roles + assign
  // BYPASSRLS without ALTER ROLE round-trips.
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  // Phase 02.5 / Plan 02 — migration 0003 issues `ALTER ROLE openwhispr_app
  // SET app.tenant_id TO ...`. In production, openwhispr_owner IS the
  // bootstrap superuser (per init/00-roles.sql.tpl semantics) and can ALTER
  // any role. In this test harness, owner is a non-superuser created by the
  // container's bootstrap user; we must grant CREATEROLE (above) AND ADMIN
  // OPTION on openwhispr_app so the migration's ALTER ROLE succeeds. Both
  // grants are scoped to the testcontainer and do not weaken production
  // security posture.
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  // PG 15+ parameter-level privileges: setting a custom (un-prefixed-class)
  // GUC like `app.tenant_id` at role/database scope normally requires
  // superuser. Grant openwhispr_owner explicit SET+ALTER SYSTEM on the
  // canonical custom GUC so migration 0003's `ALTER ROLE openwhispr_app
  // SET app.tenant_id ...` works without making owner a superuser. In
  // production, openwhispr_owner IS the bootstrap superuser and this grant
  // is implicit.
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  // Owner needs CREATE on public to add tables; on PG 15+ public is owned
  // by the bootstrap user, so transfer ownership of the schema too.
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  if (withPgPartman) {
    // Mirror the GRANT chain from packages/data/migrations/init/02-pg-partman.sql
    // so the migration runner (openwhispr_owner) can call partman.create_parent
    // and UPDATE partman.part_config.
    // pg_partman 5.x's create_parent does dynamic SQL that needs CREATE on
    // the partman schema (it writes into partman.part_config and creates
    // child partitions in the user schema but references partman objects).
    await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
    await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
    await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
    await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
    await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  }
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

/**
 * Phase 6 / Plan 02 — image tag for the custom Postgres 17.5 build that
 * bundles pg_partman 5.2.4. Tests that boot their own `PostgreSqlContainer`
 * (i.e. do not use `bootMigratedPostgres`) but apply migrations beyond
 * 0013 must reference this image and call `provisionPgPartman()` on the
 * superuser pool before granting privileges to openwhispr_owner.
 */
export const POSTGRES_PARTMAN_IMAGE = "openwhispr/postgres:17.5-pgpartman";

/**
 * Idempotently provision the `partman` schema + pg_partman extension on a
 * given superuser pool, and grant the owner role the privileges
 * pg_partman 5.x needs to drive create_parent / run_maintenance_proc
 * (CREATE on schema, all on tables/sequences, EXECUTE on funcs+procs).
 *
 * Call this AFTER creating `openwhispr_owner` but BEFORE running migrate().
 */
export async function provisionPgPartman(
  superPool: Pool,
  ownerRole = "openwhispr_owner",
): Promise<void> {
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(`GRANT ALL ON SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO ${ownerRole}`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO ${ownerRole}`);
}
