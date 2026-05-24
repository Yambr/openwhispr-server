// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 09 — shared test boot helper for /api/v1/keys/*
// integration tests. Mirrors transcriptions/__tests__/setup.ts.
//
// Real Postgres 17-alpine testcontainer + production migrations 0000..0010
// (api_keys table + RLS policy from Plan 01).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import rateLimit from "@fastify/rate-limit";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { registerErrorHandler } from "../../../../error-handler.js";
import { zodTypeProvider } from "../../../../plugins/zod-type-provider.js";
import { buildKeysCreateRoutes } from "../create.js";
import { buildKeysListRoutes } from "../list.js";
import { buildKeysRevokeRoutes } from "../revoke.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/v1/keys/__tests__ -> packages/data/migrations
export const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export interface BootedPostgres {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  ownerUri: string;
  shutdown(): Promise<void>;
}

// Phase 6 / Plan 02 — migration 0014 converts audit_log to a monthly
// RANGE-partitioned parent managed by pg_partman 5.2.4. The custom
// `ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1` image ships the extension files
// (built by compose/postgres/Dockerfile); tests that apply the full
// migration set MUST use this image and CREATE EXTENSION pg_partman
// before running migrate(). Without the switch, migration 0014 fails
// with `schema "partman" does not exist`.
const PARTMAN_IMAGE = "ghcr.io/yambr/openwhispr-postgres-17-pgpartman:17.5-bootstrap-1";

export async function bootMigratedPostgres(): Promise<BootedPostgres> {
  const ownerPw = "owner-pw-test";
  const appPw = "app-pw-test";
  const container = await new PostgreSqlContainer(PARTMAN_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  // Provision pg_partman 5.2.4 (required by migration 0014).
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPw}'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPw}'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  // pg_partman grants required by migration 0014 (mirrors
  // packages/data/migrations/init/02-pg-partman.sql).
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const ownerUri = `postgres://openwhispr_owner:${ownerPw}@${container.getHost()}:${container.getMappedPort(5432)}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(ownerPool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  const pool = new Pool({ connectionString: ownerUri });
  return {
    container,
    pool,
    ownerUri,
    async shutdown() {
      await pool.end();
      await container.stop();
    },
  };
}

export async function seedUser(
  pool: Pool,
  opts: { tenantId?: string; email: string },
): Promise<string> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
    [tenantId, opts.email],
  );
  return rows[0]!.id;
}

export async function buildTestApp(opts: {
  pool: Pool;
  userId: string;
  tenantId?: string;
  /** When true, register @fastify/rate-limit so per-route configs apply. */
  withRateLimit?: boolean;
}): Promise<FastifyInstance> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const db = drizzle(opts.pool);
  const app = Fastify({ logger: process.env.DEBUG_TEST ? { level: "debug" } : false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  if (opts.withRateLimit) {
    await app.register(rateLimit, {
      global: false,
      max: 1000,
      timeWindow: "1 minute",
    });
  }
  app.addHook("onRequest", async (req) => {
    req.user = { id: opts.userId, email: "keys-test@example.com" };
    req.tenant = tenantId;
  });
  const dbAny = db as unknown as Parameters<typeof buildKeysListRoutes>[0]["db"];
  await app.register(buildKeysListRoutes({ db: dbAny }));
  await app.register(buildKeysCreateRoutes({ db: dbAny }));
  await app.register(buildKeysRevokeRoutes({ db: dbAny }));
  await app.ready();
  return app;
}
