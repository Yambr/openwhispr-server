// Phase 05 / Plan 06 / Task 1 — shared test boot helper for folders
// integration tests. Mirrors apps/api/src/routes/notes/__tests__/setup.ts.
//
// Provides:
//   bootMigratedPostgres() — Postgres 17-alpine testcontainer +
//                            production migrations (0000..0012) + the
//                            openwhispr_owner / openwhispr_app roles
//                            used by RLS policies.
//   seedUser({tenant_id, email}) — INSERT a fresh user row.
//   buildTestApp({db, userId, tenantId}) — Fastify app with all 5
//                                          folders CRUD routes.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { registerErrorHandler } from "../../../error-handler.js";
import { zodTypeProvider } from "../../../plugins/zod-type-provider.js";
import { buildFoldersBatchCreateRoutes } from "../batch-create.js";
import { buildFoldersCreateRoutes } from "../create.js";
import { buildFoldersDeleteRoutes } from "../delete.js";
import { buildFoldersListRoutes } from "../list.js";
import { buildFoldersUpdateRoutes } from "../update.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/folders/__tests__ -> packages/data/migrations
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
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPw}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(
    `GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`,
  );
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
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  // Stub dual-auth: every request runs as opts.userId under opts.tenantId.
  app.addHook("onRequest", async (req) => {
    req.user = { id: opts.userId, email: "folders-test@example.com" };
    req.tenant = tenantId;
  });
  const dbAny = db as unknown as Parameters<typeof buildFoldersCreateRoutes>[0]["db"];
  await app.register(buildFoldersCreateRoutes({ db: dbAny }));
  await app.register(buildFoldersBatchCreateRoutes({ db: dbAny }));
  await app.register(buildFoldersUpdateRoutes({ db: dbAny }));
  await app.register(buildFoldersDeleteRoutes({ db: dbAny }));
  await app.register(buildFoldersListRoutes({ db: dbAny }));
  await app.ready();
  return app;
}
