// Phase 5 / Plan 01 — verifies migration 0006 backfills tenant_settings
// for every existing tenant. The default tenant from 0000_initial.sql
// (id = 00000000-0000-0000-0000-000000000000) MUST have a tenant_settings
// row after migrations apply.
//
// This is a separate file from settings-rls.test.ts so the backfill
// invariant is phrased as a single dedicated assertion — it surfaces
// loudly if a future contributor "cleans up" the bulk INSERT in 0006
// without realizing the default tenant from 0000 needs it.
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema/index.js";
import { provisionPgPartman } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "..", "..", "migrations");

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

const TIMEOUT = 180_000;

SUITE("Phase 5 / Plan 01 — migration 0006 backfill", () => {
  let pg: StartedPostgreSqlContainer | undefined;
  let ownerUri = "";

  beforeAll(async () => {
    if (!READY) return;
    // Phase 6 / Plan 02 — migration 0014 requires pg_partman.
    pg = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
      .withDatabase("openwhispr")
      .withUsername("postgres_super")
      .withPassword("super-pw")
      .start();

    const superPool = new Pool({ connectionString: pg.getConnectionUri() });
    await superPool.query(
      `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'owner-pw'`,
    );
    await superPool.query(`CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'app-pw'`);
    await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
    await superPool.query(
      `GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`,
    );
    await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
    await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
    await provisionPgPartman(superPool);
    await superPool.end();

    ownerUri = `postgres://openwhispr_owner:owner-pw@${pg.getHost()}:${pg.getMappedPort(5432)}/openwhispr`;
    const ownerPool = new Pool({ connectionString: ownerUri });
    const ownerDb = drizzle(ownerPool, { schema });
    await migrate(ownerDb, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: "_meta",
      migrationsTable: "__drizzle_migrations",
    });
    await ownerPool.end();
  }, TIMEOUT);

  afterAll(async () => {
    if (pg) await pg.stop();
  }, 60_000);

  it(
    "default tenant from 0000_initial.sql has a tenant_settings row after 0006",
    async () => {
      const pool = new Pool({ connectionString: ownerUri });
      try {
        const res = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tenant_settings WHERE tenant_id = '00000000-0000-0000-0000-000000000000'`,
        );
        expect(res.rows[0]?.n).toBe(1);
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "backfill is idempotent (no duplicate rows for the default tenant)",
    async () => {
      const pool = new Pool({ connectionString: ownerUri });
      try {
        // Re-run the canonical backfill statement — should be a no-op due
        // to the PK on tenant_id + ON CONFLICT DO NOTHING.
        await pool.query(
          `INSERT INTO tenant_settings (tenant_id) SELECT id FROM tenants ON CONFLICT (tenant_id) DO NOTHING`,
        );
        const res = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tenant_settings WHERE tenant_id = '00000000-0000-0000-0000-000000000000'`,
        );
        expect(res.rows[0]?.n).toBe(1);
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );
});

if (!READY) {
  // biome-ignore lint/suspicious/noConsole: deliberate skip notice
  console.warn("[migration-0006-backfill] migrations not present yet — skipping.");
}
