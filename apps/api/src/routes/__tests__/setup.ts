// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 12 / Plan 12-02 / D-12.02-EX1 — shared inline real-Postgres
// harness for route-level integration tests (capabilities + setup-state).
//
// CLAUDE.md constitutional rule: "no mocks of internal logic — DB-touching
// code uses real Postgres + PgBouncer + Valkey via testcontainers." The
// previous fake-db pattern (makeFakeDb intercepting drizzle's
// transaction.execute) violated this rule because drizzle's tx/execute
// IS internal logic — the process boundary is the libpq driver below it.
//
// This harness mirrors the inline pattern proven by:
//   - apps/api/src/lib/audit.test.ts (boots PG + pg_partman + migrates
//     through 0014 audit_log partition + 0017 setup_state)
//   - apps/api/src/routes/notes/__tests__/setup.ts (shared inline harness
//     for the 5 notes integration tests)
//
// We cannot cross-import packages/data/src/__tests__/helpers.ts per the
// orchestrator's per-worktree protocol — the helper must live inside the
// apps/api package surface.
//
// The local image `openwhispr/postgres:17.5-pgpartman` (built from
// compose/postgres/Dockerfile) is required for migration 0014 to succeed;
// the executor's earlier diagnosis that this image was unavailable was
// incorrect — `docker image ls openwhispr/postgres:17.5-pgpartman` shows
// 88e79d6ba7de present locally.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { registerErrorHandler } from "../../error-handler.js";
import { buildCapabilitiesRoutes } from "../capabilities.js";
import {
  buildSetupAdminRoutes,
  type SetupAdminDeps,
  type SetupAdminRenameTenant,
  type SetupAdminSignUpEmail,
} from "../setup-admin.js";
import { buildSetupStateRoutes } from "../setup-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/__tests__ -> packages/data/migrations
export const MIGRATIONS_FOLDER = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "data",
  "migrations",
);

// Local image baked from compose/postgres/Dockerfile. Migration 0014
// (audit_log partition) requires the `partman` schema + extension to be
// present BEFORE drizzle runs the migration set; the base postgres:17-alpine
// image is missing pg_partman and would fail with SQLSTATE 3F000.
export const PARTMAN_IMAGE = "openwhispr/postgres:17.5-pgpartman";

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export interface BootedPostgres {
  container: StartedPostgreSqlContainer;
  ownerPool: Pool;
  ownerUri: string;
  db: NodePgDatabase;
  shutdown(): Promise<void>;
}

/**
 * Boot a Postgres testcontainer, provision pg_partman + the
 * openwhispr_owner / openwhispr_app roles required by RLS policies, then
 * run the full drizzle migration set (0000..0017+). The returned `db` is
 * a `NodePgDatabase` bound to the owner pool — sufficient for the
 * Phase-12 capability-discovery routes which only `SELECT status FROM
 * setup_state`. Routes that require RLS gating (notes, audit_log writes)
 * would additionally open an app-role pool; the capability routes do
 * NOT, so we keep the harness lean.
 */
export async function bootMigratedPostgres(): Promise<BootedPostgres> {
  const ownerPw = "owner-pw-test";
  const appPw = "app-pw-test";
  const container = await new PostgreSqlContainer(PARTMAN_IMAGE)
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  // pg_partman provisioning (required by migration 0014_audit_log_partition).
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  // Roles + ownership (required by RLS policies and per-table GRANTs in
  // migrations 0000..0011).
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPw}'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPw}'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  // pg_partman schema grants for migration 0014's create_parent() call.
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPw}@${host}:${port}/openwhispr`;

  // Run drizzle migrations as owner (BYPASSRLS so policy-protected tables
  // can be DDL'd).
  const migratePool = new Pool({ connectionString: ownerUri });
  await migrate(drizzle(migratePool), {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await migratePool.end();

  // Keep a long-lived owner pool for the test suite to share.
  const ownerPool = new Pool({ connectionString: ownerUri });
  const db = drizzle(ownerPool);

  return {
    container,
    ownerPool,
    ownerUri,
    db,
    async shutdown() {
      await ownerPool.end();
      await container.stop();
    },
  };
}

/**
 * INSERT a tenants row (idempotent). Owner pool bypasses RLS so this
 * works without an active `withTenant` context.
 */
export async function seedTenant(
  pool: Pool,
  opts: { tenantId?: string; name?: string } = {},
): Promise<string> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  const name = opts.name ?? "Test Tenant";
  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    tenantId,
    name,
  ]);
  return tenantId;
}

/**
 * INSERT a users row (returns the generated user id). Caller MUST have
 * already seeded the tenant row (FK constraint).
 */
export async function seedUser(
  pool: Pool,
  opts: { tenantId?: string; email: string; userId?: string },
): Promise<string> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT_ID;
  if (opts.userId) {
    await pool.query(
      `INSERT INTO users (id, tenant_id, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [opts.userId, tenantId, opts.email],
    );
    return opts.userId;
  }
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
    [tenantId, opts.email],
  );
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("seedUser: INSERT ... RETURNING id produced no row");
  }
  return firstRow.id;
}

/**
 * Truncate users between test cases. Plan 12-03 setup-admin tests
 * INSERT admin users via the fake signUpEmail emulation; each test
 * starts from an empty users table.
 *
 * `RESTART IDENTITY CASCADE` resets any serial sequences and cascades
 * through accounts / sessions / verification_token tables that Better
 * Auth created in migrations 0001..0011. Owner pool bypasses RLS so no
 * `withTenant` context is required.
 */
export async function resetUsers(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE TABLE users RESTART IDENTITY CASCADE`);
}

/**
 * Reset setup_state back to its post-migration default. Migration 0017
 * INSERTs the singleton row; tests that mutate it MUST restore it (or
 * delete user rows) between test cases.
 *
 * `desired` controls the target status:
 *   - 'pending' / 'completed' / 'skipped_legacy' → UPDATE the row to that status.
 *   - 'missing' → DELETE the singleton (exercises the defensive-default
 *      branch in both handlers).
 */
export async function resetSetupState(
  pool: Pool,
  desired: "pending" | "completed" | "skipped_legacy" | "missing",
): Promise<void> {
  if (desired === "missing") {
    await pool.query(`DELETE FROM setup_state WHERE id = 1`);
    return;
  }
  // Ensure the row exists; if a prior test deleted it, re-insert.
  await pool.query(
    `INSERT INTO setup_state (id, status, completed_at)
     VALUES (1, $1::setup_state_status, $2)
     ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           completed_at = EXCLUDED.completed_at`,
    [desired, desired === "completed" ? new Date().toISOString() : null],
  );
}

export interface BuildCapabilitiesAppOpts {
  db: NodePgDatabase;
  env: NodeJS.ProcessEnv;
  user?: { id: string; email: string };
  tenantId?: string;
}

/**
 * Build a Fastify instance with the capabilities route registered. The
 * onRequest stub stamps `req.user`/`req.tenant` directly (the global
 * dualAuthHook is not registered in tests — same pattern as notes/setup.ts).
 */
export async function buildCapabilitiesApp(
  opts: BuildCapabilitiesAppOpts,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  if (opts.user && opts.tenantId) {
    const { user, tenantId } = opts;
    app.addHook("onRequest", async (req) => {
      req.user = user;
      req.tenant = tenantId;
    });
  }
  const dbAny = opts.db as unknown as Parameters<typeof buildCapabilitiesRoutes>[0]["db"];
  await app.register(buildCapabilitiesRoutes({ db: dbAny, env: opts.env }));
  await app.ready();
  return app;
}

export interface BuildSetupStateAppOpts {
  db: NodePgDatabase;
  withRateLimit?: boolean;
}

/**
 * Build a Fastify instance with the setup-state route registered.
 * Optionally registers @fastify/rate-limit so the per-route
 * `config.rateLimit` is honored (used by the rate-limit assertion).
 */
export async function buildSetupStateApp(opts: BuildSetupStateAppOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  if (opts.withRateLimit) {
    const rateLimit = (await import("@fastify/rate-limit")).default;
    await app.register(rateLimit, { global: false });
  }
  const dbAny = opts.db as unknown as Parameters<typeof buildSetupStateRoutes>[0]["db"];
  await app.register(buildSetupStateRoutes({ db: dbAny }));
  await app.ready();
  return app;
}

export interface BuildSetupAdminAppOpts {
  db: NodePgDatabase;
  /**
   * The owner Pool is forwarded so the route plugin can issue raw SQL
   * for two columns NOT declared in the drizzle schema TS files:
   *   * users.role — added by migration 0017 as a nullable text
   *                  (kept out of users.ts on purpose; Better Auth's
   *                  additionalFields owns the type declaration with
   *                  input:false so public sign-ups never escalate).
   * The same channel covers any future migration-only column without
   * forcing a schema-TS rebuild.
   */
  ownerPool: Pool;
  signUpEmail: SetupAdminSignUpEmail;
  renameTenant?: SetupAdminRenameTenant;
  withRateLimit?: boolean;
}

/**
 * Build a Fastify instance with the setup-admin route registered.
 * Mirrors `buildSetupStateApp` — registers @fastify/rate-limit when the
 * per-route `config.rateLimit` needs to fire (rate-limit assertion).
 */
export async function buildSetupAdminApp(opts: BuildSetupAdminAppOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  registerErrorHandler(app);
  if (opts.withRateLimit) {
    const rateLimit = (await import("@fastify/rate-limit")).default;
    await app.register(rateLimit, { global: false });
  }
  const dbAny = opts.db as unknown as SetupAdminDeps["db"];
  const deps: SetupAdminDeps = {
    db: dbAny,
    ownerPool: opts.ownerPool,
    signUpEmail: opts.signUpEmail,
    ...(opts.renameTenant ? { renameTenant: opts.renameTenant } : {}),
  };
  await app.register(buildSetupAdminRoutes(deps));
  await app.ready();
  return app;
}
