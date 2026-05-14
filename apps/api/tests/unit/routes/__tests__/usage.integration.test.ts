// SPDX-License-Identifier: FSL-1.1-ALv2
// Phase 05 / Plan 02 / Task 2 — GET /api/usage integration test.
//
// Real Postgres 17-alpine testcontainer + production Drizzle migrations.
// Boots Fastify with the usage route mounted on a real Drizzle
// node-postgres handle, then asserts:
//   - new user with no ledger entries -> wordsUsed=0
//   - SUM(units) reflects all rows for the user across kinds (D-14)
//   - cross-user isolation — user A's wordsUsed excludes user B's units
//     (RLS-enforced via app.tenant_id GUC inside withTenant)
//   - 401 when req.user is absent
//   - response shape: plan='unlimited', wordsRemaining=999_999_999

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerErrorHandler } from "../../../../src/error-handler.js";
import { zodTypeProvider } from "../../../../src/plugins/zod-type-provider.js";
import { buildUsageRoutes } from "../../../../src/routes/usage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(
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

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

let container: StartedPostgreSqlContainer;
let pool: Pool;
let userA: string;
let userB: string;

// Two apps so we can stub onRequest with different user identities to
// prove cross-user isolation without re-registering the route.
let appA: FastifyInstance;
let appB: FastifyInstance;
let appUnauthed: FastifyInstance;

async function buildAppForUser(
  pool_: Pool,
  user: { id: string; email: string } | null,
): Promise<FastifyInstance> {
  const db = drizzle(pool_);
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(zodTypeProvider);
  if (user) {
    app.addHook("onRequest", async (req) => {
      req.user = user;
      req.tenant = DEFAULT_TENANT_ID;
    });
  }
  await app.register(
    buildUsageRoutes({
      db: db as unknown as Parameters<typeof buildUsageRoutes>[0]["db"],
    }),
  );
  await app.ready();
  return app;
}

beforeAll(async () => {
  const ownerPw = "owner-pw-test";
  const appPw = "app-pw-test";
  container = await new PostgreSqlContainer("postgres:17-alpine")
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

  pool = new Pool({ connectionString: ownerUri });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
    [DEFAULT_TENANT_ID, "usage-route-a@example.com"],
  );
  const b = await pool.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id`,
    [DEFAULT_TENANT_ID, "usage-route-b@example.com"],
  );
  userA = a.rows[0]?.id;
  userB = b.rows[0]?.id;

  appA = await buildAppForUser(pool, { id: userA, email: "usage-route-a@example.com" });
  appB = await buildAppForUser(pool, { id: userB, email: "usage-route-b@example.com" });
  appUnauthed = await buildAppForUser(pool, null);
}, 180_000);

afterAll(async () => {
  if (appA) await appA.close();
  if (appB) await appB.close();
  if (appUnauthed) await appUnauthed.close();
  if (pool) await pool.end();
  if (container) await container.stop();
}, 60_000);

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE usage_ledger`);
});

describe("integration — GET /api/usage (real Postgres)", () => {
  it("returns wordsUsed=0 for a new user with no ledger entries", async () => {
    const res = await appA.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      wordsUsed: number;
      wordsRemaining: number;
      plan: string;
      limitReached: boolean;
    };
    expect(body.wordsUsed).toBe(0);
    expect(body.wordsRemaining).toBe(999_999_999);
    expect(body.plan).toBe("unlimited");
    expect(body.limitReached).toBe(false);
  });

  it("SUM(units) reflects all kinds (D-14): transcribe + reason + streaming + web-search", async () => {
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
         VALUES ($1, $2, 'r-1', 'transcribe_minutes', 10),
                ($1, $2, 'r-2', 'reason_tokens', 5),
                ($1, $2, 'r-3', 'streaming-stt', 15),
                ($1, $2, 'r-4', 'web-search.tavily', 1)`,
      [DEFAULT_TENANT_ID, userA],
    );
    const res = await appA.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { wordsUsed: number }).wordsUsed).toBe(31);
  });

  it("cross-user isolation — userA's wordsUsed excludes userB's units", async () => {
    await pool.query(
      `INSERT INTO usage_ledger (tenant_id, user_id, request_id, kind, units)
         VALUES ($1, $2, 'a-1', 'transcribe_minutes', 100),
                ($1, $3, 'b-1', 'transcribe_minutes', 999)`,
      [DEFAULT_TENANT_ID, userA, userB],
    );
    const resA = await appA.inject({ method: "GET", url: "/api/usage" });
    const resB = await appB.inject({ method: "GET", url: "/api/usage" });
    expect((resA.json() as { wordsUsed: number }).wordsUsed).toBe(100);
    expect((resB.json() as { wordsUsed: number }).wordsUsed).toBe(999);
  });

  it("returns 401 envelope when req.user is absent (defensive auth guard)", async () => {
    const res = await appUnauthed.inject({ method: "GET", url: "/api/usage" });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});
