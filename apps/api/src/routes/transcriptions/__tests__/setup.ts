// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 08 / Task 1 — shared test boot helper for
// transcriptions integration tests. Mirrors folders/notes setup.ts.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { registerErrorHandler } from "../../../error-handler.js";
import { zodTypeProvider } from "../../../plugins/zod-type-provider.js";
import { buildTranscriptionsBatchCreateRoutes } from "../batch-create.js";
import { buildTranscriptionsBatchDeleteRoutes } from "../batch-delete.js";
import { buildTranscriptionsCreateRoutes } from "../create.js";
import { buildTranscriptionsDeleteRoutes } from "../delete.js";
import { buildTranscriptionsListRoutes } from "../list.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/transcriptions/__tests__ -> packages/data/migrations
export const MIGRATIONS_FOLDER = resolve(
  __dirname,
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

export async function bootMigratedPostgres(): Promise<BootedPostgres> {
  const ownerPw = "owner-pw-test";
  const appPw = "app-pw-test";
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPw}'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPw}'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
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
}): Promise<FastifyInstance> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const db = drizzle(opts.pool);
  const app = Fastify({ logger: process.env.DEBUG_TEST ? { level: "debug" } : false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  app.addHook("onRequest", async (req) => {
    req.user = { id: opts.userId, email: "transcriptions-test@example.com" };
    req.tenant = tenantId;
  });
  const dbAny = db as unknown as Parameters<typeof buildTranscriptionsCreateRoutes>[0]["db"];
  await app.register(buildTranscriptionsCreateRoutes({ db: dbAny }));
  await app.register(buildTranscriptionsBatchCreateRoutes({ db: dbAny }));
  await app.register(buildTranscriptionsListRoutes({ db: dbAny }));
  await app.register(buildTranscriptionsDeleteRoutes({ db: dbAny }));
  await app.register(buildTranscriptionsBatchDeleteRoutes({ db: dbAny }));
  await app.ready();
  return app;
}
