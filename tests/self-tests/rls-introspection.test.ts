// SPDX-License-Identifier: Apache-2.0
// Constitutional self-test for the RLS-introspection lint (Phase 1 / Plan 05).
//
// Mirrors tests/self-tests/cyrillic-injection.test.ts in spirit: it injects
// a deliberately broken DDL fragment into a fresh-migrated Postgres and
// asserts that `tools/lint-rls.ts` exits non-zero with `bad_table` in
// stderr. This is the gate that proves the lint rule is wired — if the
// lint silently passes for a tenant_id-bearing table without RLS, this
// test fails CI and forces an investigation.
//
// Per CLAUDE.md "no mocks": real Postgres testcontainer + real migration.
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "tools", "lint-rls.ts");
const MIGRATIONS_FOLDER = join(REPO_ROOT, "packages", "data", "migrations");

let container: StartedPostgreSqlContainer | undefined;
let ownerUri: string;

beforeAll(async () => {
  const ownerPassword = "owner-pw-self";
  // Phase 6 / Plan 02 — migration 0014 requires pg_partman.
  container = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'app-pw-self'`);
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.query("CREATE SCHEMA IF NOT EXISTS partman");
  await superPool.query("CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman");
  await superPool.query(`GRANT ALL ON SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO openwhispr_owner`);
  await superPool.query(`GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool);
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  // Inject the bad fixture — a tenant_id-bearing table with no RLS at all.
  await ownerPool.query(`CREATE TABLE bad_table (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`);
  await ownerPool.end();
}, 180_000);

afterAll(async () => {
  if (container) await container.stop();
}, 60_000);

describe("constitutional self-test: RLS-introspection lint fires on a bad migration", () => {
  it("makes lint-rls.ts exit non-zero and names the offending table", () => {
    let code = 0;
    let stderr = "";
    try {
      execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DATABASE_URL: ownerUri },
      });
    } catch (err: unknown) {
      const e = err as { status: number | null; stderr?: Buffer };
      code = e.status ?? 1;
      stderr = e.stderr?.toString() ?? "";
    }
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/bad_table/);
  }, 60_000);
});
