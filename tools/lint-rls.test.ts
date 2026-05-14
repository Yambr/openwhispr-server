// SPDX-License-Identifier: FSL-1.1-ALv2
// Unit test for tools/lint-rls.ts — Phase 1 Plan 05.
//
// Boots a real Postgres 17 testcontainer, applies the canonical
// 0000_initial.sql migration as the openwhispr_owner role, then exercises
// the four lint cases:
//
//   1. Clean schema → exit 0.
//   2. Inject `bad_table (id uuid, tenant_id uuid)` with no RLS → exit 1,
//      stderr names `bad_table` and "RLS is disabled".
//   3. Inject `bad_table` with ENABLE RLS but NO policy → exit 1, stderr
//      names "no policy attached".
//   4. Inject a policy that USES `id IS NOT NULL` (does not reference
//      `app.tenant_id`) → exit 1, stderr names
//      "does not reference app.tenant_id".
//
// Per CLAUDE.md "no mocks": real Postgres + real DDL via testcontainers.
// pg-mem is not used.
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SCRIPT = join(REPO_ROOT, "tools", "lint-rls.ts");
const MIGRATIONS_FOLDER = join(REPO_ROOT, "packages", "data", "migrations");

interface Booted {
  container: StartedPostgreSqlContainer;
  ownerUri: string;
  stop: () => Promise<void>;
}

async function bootMigrated(): Promise<Booted> {
  const ownerPassword = "owner-pw-lint";
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(`CREATE ROLE openwhispr_app WITH LOGIN PASSWORD 'app-pw-lint'`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;
  const ownerPool = new Pool({ connectionString: ownerUri });
  const ownerDb = drizzle(ownerPool);
  await migrate(ownerDb, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: "_meta",
    migrationsTable: "__drizzle_migrations",
  });
  await ownerPool.end();

  return {
    container,
    ownerUri,
    stop: async () => {
      await container.stop();
    },
  };
}

interface RunResult {
  code: number;
  stderr: string;
  stdout: string;
}

function runLint(databaseUrl: string): RunResult {
  try {
    const stdout = execFileSync("pnpm", ["exec", "tsx", SCRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status: number | null; stderr?: Buffer; stdout?: Buffer };
    return {
      code: e.status ?? 1,
      stderr: e.stderr?.toString() ?? "",
      stdout: e.stdout?.toString() ?? "",
    };
  }
}

async function resetBadFixture(ownerUri: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUri });
  try {
    await pool.query(`DROP TABLE IF EXISTS bad_table`);
  } finally {
    await pool.end();
  }
}

let booted: Booted;

beforeAll(async () => {
  booted = await bootMigrated();
}, 180_000);

afterAll(async () => {
  if (booted) await booted.stop();
}, 60_000);

describe("tools/lint-rls.ts", () => {
  it("exits 0 against a clean migrated schema", async () => {
    await resetBadFixture(booted.ownerUri);
    const r = runLint(booted.ownerUri);
    expect(r.code).toBe(0);
  }, 60_000);

  it("flags a table with tenant_id column but RLS disabled (exit 1)", async () => {
    await resetBadFixture(booted.ownerUri);
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      await pool.query(`CREATE TABLE bad_table (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`);
    } finally {
      await pool.end();
    }
    const r = runLint(booted.ownerUri);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad_table/);
    expect(r.stderr).toMatch(/RLS is disabled/i);
    await resetBadFixture(booted.ownerUri);
  }, 60_000);

  it("flags a table with ENABLE RLS but no policy attached (exit 1)", async () => {
    await resetBadFixture(booted.ownerUri);
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      await pool.query(`CREATE TABLE bad_table (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`);
      await pool.query(`ALTER TABLE bad_table ENABLE ROW LEVEL SECURITY`);
      await pool.query(`ALTER TABLE bad_table FORCE  ROW LEVEL SECURITY`);
    } finally {
      await pool.end();
    }
    const r = runLint(booted.ownerUri);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad_table/);
    expect(r.stderr).toMatch(/no policy attached/i);
    await resetBadFixture(booted.ownerUri);
  }, 60_000);

  it("flags a policy that does not reference app.tenant_id (exit 1)", async () => {
    await resetBadFixture(booted.ownerUri);
    const pool = new Pool({ connectionString: booted.ownerUri });
    try {
      await pool.query(`CREATE TABLE bad_table (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`);
      await pool.query(`ALTER TABLE bad_table ENABLE ROW LEVEL SECURITY`);
      await pool.query(`ALTER TABLE bad_table FORCE  ROW LEVEL SECURITY`);
      await pool.query(
        `CREATE POLICY bad_table_anything ON bad_table USING (id IS NOT NULL) WITH CHECK (id IS NOT NULL)`,
      );
    } finally {
      await pool.end();
    }
    const r = runLint(booted.ownerUri);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad_table/);
    expect(r.stderr).toMatch(/does not reference app\.tenant_id/i);
    await resetBadFixture(booted.ownerUri);
  }, 60_000);
});

// ──────────────────────────────────────────────────────────────────────
// Phase 6 Wave 0 RED stubs — TDD-01b. Implementation in Plan 06-02 per
// 06-VALIDATION.md. APPENDED to the existing Phase 1 suite above.
//
// Phase 6 audit_log conversion to a pg_partman monthly-RANGE partitioned
// parent (D-A2) creates partman-named children e.g. `audit_log_2026_05`.
// The Phase 1 RLS lint MUST:
//   - Confirm the partitioned PARENT has RLS enabled + a tenant-scoped policy
//   - NOT false-positive-report inherited children as "missing RLS"
//     (children inherit the parent's policy at relkind='r' partman level;
//     the lint should either skip child names matching audit_log_\d{4}_\d{2}
//     OR detect inheritance from a partitioned parent and treat as covered).
// ──────────────────────────────────────────────────────────────────────

const PHASE_6_NOT_YET =
  "not yet implemented — Plan 06-02 extends lint-rls.ts for pg_partman children (D-A2)";

describe("tools/lint-rls.ts — pg_partman child handling (Phase 6, D-A2)", () => {
  it("reports the audit_log partitioned PARENT has RLS enabled", () => {
    throw new Error(PHASE_6_NOT_YET);
  });

  it("does NOT false-positive-flag partman child audit_log_2026_05 as missing RLS", () => {
    throw new Error(PHASE_6_NOT_YET);
  });

  it("skips child table names matching the audit_log_\\d{4}_\\d{2} pattern", () => {
    throw new Error(PHASE_6_NOT_YET);
  });

  it("alternatively, detects inheritance from a partitioned parent (relkind='p') and treats child as covered", () => {
    throw new Error(PHASE_6_NOT_YET);
  });

  it("STILL flags a non-partman table that lacks RLS (regression — existing behavior preserved)", () => {
    throw new Error(PHASE_6_NOT_YET);
  });
});
