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

import { provisionPgPartman } from "../packages/data/src/__tests__/helpers.js";
import { bootstrapRoles } from "../packages/data/tests/unit/__helpers__/bootstrap-roles.js";

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
  // Phase 18.1.1 / Plan 03 / D-11+D-12 — switch to pgpartman image (the
  // migrations folder advanced to require pg_partman at 0014) AND use the
  // canonical bootstrapRoles helper. The previous inline bootstrap omitted
  // CREATEROLE + GRANT ADMIN OPTION, so migration 0003 (ALTER ROLE
  // openwhispr_app SET app.tenant_id …) failed with PG 42501; the helper
  // grants both, transitively closing D-11.
  const container = await new PostgreSqlContainer("openwhispr/postgres:17.5-pgpartman")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await bootstrapRoles(superPool, {
    dbName: "openwhispr",
    ownerPassword,
    appPassword: "app-pw-lint",
  });
  await provisionPgPartman(superPool);
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
// Phase 6 Wave 0 RED stubs — REMOVED 2026-05-17.
//
// The five RED stubs that previously lived here (under a
// "pg_partman child handling (Phase 6, D-A2)" describe block) referenced
// the wrong child-naming pattern. The shipped Phase 6 / Plan 06-02
// implementation uses partman's default `audit_log_pYYYYMMDD` (+
// `audit_log_default`) child names, NOT the `audit_log_YYYY_MM` pattern
// the stubs were written against.
//
// The actual child-exclusion is implemented in `tools/lint-rls.ts`
// (constant `AUDIT_LOG_CHILD_REGEX`) and is exercised end-to-end via the
// `audit-log-partitioning.test.ts` integration test, which boots the real
// pg_partman extension. The stubs here added no coverage; they only
// asserted a sentinel `throw new Error("not yet implemented")` and would
// have required a rewrite against partman's real names to be useful.
//
// TODO(v2.3): if pure-RLS-lint coverage of partman children is wanted as
// a unit (vs the existing integration test), author NEW tests against the
// canonical `audit_log_pYYYYMMDD` + `audit_log_default` names.
// ──────────────────────────────────────────────────────────────────────
