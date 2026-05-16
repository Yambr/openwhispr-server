// SPDX-License-Identifier: FSL-1.1-ALv2
//
// tests/e2e/rls-fail-closed.spec.ts — Phase 32 / Plan 32-04.
//
// E2E gate: prove the fail-closed RLS posture against a real Postgres 17
// running under the same image + role configuration the production stack
// uses. Per DISCIPLINE Rule 3 + 4: real services, no mocks of internal
// logic; per LOCKER-04: do NOT introduce a synthetic test-only route into
// production app code — instead the test connects directly to PG as the
// `openwhispr_app` role and exercises the RLS surface.
//
// Why this is an e2e (not a unit test):
//   * The 128-case property test in packages/data covers the per-cell
//     matrix at the unit-suite layer.
//   * THIS test owns the integration-level proof: a real Postgres backed
//     by the same migration pipeline the production stack runs (drizzle
//     migrate(), including 0018), the same role grants, the same RLS
//     policies. It asserts that an `openwhispr_app` connection without an
//     `app.tenant_id` GUC raises 42501 on INSERT and 0-rows on SELECT
//     against a tenant-scoped table.
//
// Discovery: matches `tests/e2e/*.test.ts` via
// `tests/e2e/vitest.e2e.config.ts`. Filename intentionally ends in
// `.spec.ts` so it is NOT picked up by the default Plan 09 e2e include
// glob (the realtime/transcribe suite has bespoke stack-up requirements);
// add an include extension below or rename if/when CI wires this in.
//
// Local invocation:
//   E2E=1 pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts \
//     tests/e2e/rls-fail-closed.spec.ts
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e -> repo root
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATIONS_FOLDER = resolve(REPO_ROOT, "packages", "data", "migrations");

let container: StartedPostgreSqlContainer | undefined;
let appUri: string | undefined;
let ownerUri: string | undefined;

beforeAll(async () => {
  // Mirror the production stack's role + privilege topology. This is the
  // same shape that `packages/data/src/__tests__/helpers.ts`
  // `bootMigratedPostgres` builds for unit tests; we re-do it inline here
  // to keep the e2e suite free of cross-package internal imports.
  container = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superUri = container.getConnectionUri();
  const superPool = new Pool({ connectionString: superUri });

  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD 'owner-pw-e2e'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD 'app-pw-e2e'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  ownerUri = `postgres://openwhispr_owner:owner-pw-e2e@${host}:${port}/openwhispr`;
  appUri = `postgres://openwhispr_app:app-pw-e2e@${host}:${port}/openwhispr`;

  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool);
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();
}, 240_000);

afterAll(async () => {
  if (container) await container.stop();
}, 60_000);

describe("Phase 32 — RLS fail-closed (e2e against real Postgres + production migration pipeline)", () => {
  it("INSERT into notes without app.tenant_id GUC raises 42501", async () => {
    const pool = new Pool({ connectionString: appUri! });
    try {
      const userId = randomUUID();
      const tenantId = randomUUID();
      // First create a tenant + user via the owner role so the FK chain
      // would otherwise be satisfiable — the RLS deny is what we're
      // proving, not a constraint violation.
      const ownerPool = new Pool({ connectionString: ownerUri! });
      try {
        await ownerPool.query(`INSERT INTO tenants (id, name) VALUES ($1::uuid, 'e2e-rls')`, [
          tenantId,
        ]);
        await ownerPool.query(
          `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid, $2::uuid, $3)`,
          [userId, tenantId, "rls-e2e@test.local"],
        );
      } finally {
        await ownerPool.end();
      }

      await expect(
        pool.query(
          `INSERT INTO notes (id, tenant_id, user_id, title) VALUES ($1::uuid, $2::uuid, $3::uuid, 'leak')`,
          [randomUUID(), tenantId, userId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await pool.end();
    }
  }, 60_000);

  it("SELECT from notes without app.tenant_id GUC returns 0 rows (silent deny-read)", async () => {
    // Owner seeds a row; app role with no GUC must not see it.
    const ownerPool = new Pool({ connectionString: ownerUri! });
    let tenantId: string;
    try {
      tenantId = randomUUID();
      const userId = randomUUID();
      await ownerPool.query(`INSERT INTO tenants (id, name) VALUES ($1::uuid, 'e2e-rls-2')`, [
        tenantId,
      ]);
      await ownerPool.query(
        `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid, $2::uuid, 'rls-e2e-2@test.local')`,
        [userId, tenantId],
      );
      await ownerPool.query(
        `INSERT INTO notes (id, tenant_id, user_id, title) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'seeded')`,
        [tenantId, userId],
      );
    } finally {
      await ownerPool.end();
    }

    const appPool = new Pool({ connectionString: appUri! });
    try {
      const res = await appPool.query(`SELECT 1 FROM notes WHERE tenant_id = $1::uuid`, [tenantId]);
      expect(res.rowCount).toBe(0);
    } finally {
      await appPool.end();
    }
  }, 60_000);

  it("With set_config('app.tenant_id', ...), the same SELECT returns the seeded row (sanity check)", async () => {
    const ownerPool = new Pool({ connectionString: ownerUri! });
    let tenantId: string;
    try {
      tenantId = randomUUID();
      const userId = randomUUID();
      await ownerPool.query(`INSERT INTO tenants (id, name) VALUES ($1::uuid, 'e2e-rls-3')`, [
        tenantId,
      ]);
      await ownerPool.query(
        `INSERT INTO users (id, tenant_id, email) VALUES ($1::uuid, $2::uuid, 'rls-e2e-3@test.local')`,
        [userId, tenantId],
      );
      await ownerPool.query(
        `INSERT INTO notes (id, tenant_id, user_id, title) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'visible-with-ctx')`,
        [tenantId, userId],
      );
    } finally {
      await ownerPool.end();
    }

    const appPool = new Pool({ connectionString: appUri! });
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const res = await client.query(`SELECT 1 FROM notes WHERE tenant_id = $1::uuid`, [tenantId]);
      expect(res.rowCount).toBe(1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await appPool.end();
    }
  }, 60_000);
});
