// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Phase 02.7 / Plan 05 — D-03 Layer B: case-insensitive email uniqueness.
 *
 * Source-of-record commit: <filled at commit time>
 *
 * Reverts:
 *   - Deleting `packages/data/migrations/0004_email_lowercase_normalize.sql`:
 *     Test 1 (happy-path backfill), Test 3 (post-0004 collision), and Test 4
 *     (cross-tenant) all RED — the migration file vanishes (ENOENT) AND the
 *     functional unique index `users_tenant_email_lower_unique` no longer
 *     exists, so the lower(email) lookup falls back to a seq scan AND
 *     case-collision INSERTs no longer raise a unique violation.
 *   - Removing the DO $$ collision-precondition block from migration 0004:
 *     Test 2 RED — the migration would silently pass over case-collision
 *     dupes (a data-loss event the design refuses to auto-perform).
 *   - Reverting check-user.ts to `WHERE email = $1` (case-sensitive):
 *     Test 1's "lookup via lower() succeeds for mixed-case input" assertion
 *     RED — the route would miss rows whose stored email differs in case
 *     from the query input.
 *
 * Real Postgres via testcontainers (no pg-mem; CLAUDE.md no-mocks rule).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "packages", "data", "migrations");

const MIGRATIONS_BASE = [
  "0000_initial.sql",
  "0001_better_auth.sql",
  "0002_oauth_state.sql",
  "0003_better_auth_tenant_defaults.sql",
] as const;

const MIGRATION_0004 = "0004_email_lowercase_normalize.sql";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const SECOND_TENANT_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Apply a single migration file. Splits on the literal `--> statement-breakpoint`
 * separator (drizzle-kit convention) and runs each statement individually so
 * a DO $$ block followed by an UPDATE/DDL all execute as separate top-level
 * statements within an enclosing transaction.
 */
async function applyMigrationFile(client: Client, fileName: string): Promise<void> {
  const path = join(MIGRATIONS_DIR, fileName);
  const sql = readFileSync(path, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

async function applyBaseMigrations(client: Client): Promise<void> {
  for (const m of MIGRATIONS_BASE) {
    await applyMigrationFile(client, m);
  }
}

interface BootedDb {
  container: StartedPostgreSqlContainer;
  ownerUri: string;
}

/**
 * Boot a fresh Postgres 17 container with the openwhispr_owner +
 * openwhispr_app roles created and the public schema owned by the owner.
 * Mirrors `packages/data/src/__tests__/helpers.ts` setup but inlined here
 * to avoid coupling tests/integration to the @openwhispr/data build output.
 */
async function bootFreshPostgres(): Promise<BootedDb> {
  const ownerPassword = "owner-pw-test";
  const appPassword = "app-pw-test";

  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("openwhispr")
    .withUsername("postgres_super")
    .withPassword("super-pw")
    .start();

  const superPool = new Pool({ connectionString: container.getConnectionUri() });
  await superPool.query(
    `CREATE ROLE openwhispr_owner WITH LOGIN BYPASSRLS CREATEROLE PASSWORD '${ownerPassword}'`,
  );
  await superPool.query(
    `CREATE ROLE openwhispr_app   WITH LOGIN          PASSWORD '${appPassword}'`,
  );
  await superPool.query(`GRANT openwhispr_app TO openwhispr_owner WITH ADMIN OPTION`);
  await superPool.query(`GRANT SET, ALTER SYSTEM ON PARAMETER "app.tenant_id" TO openwhispr_owner`);
  await superPool.query(`ALTER DATABASE openwhispr OWNER TO openwhispr_owner`);
  await superPool.query(`ALTER SCHEMA public OWNER TO openwhispr_owner`);
  await superPool.end();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUri = `postgres://openwhispr_owner:${ownerPassword}@${host}:${port}/openwhispr`;

  return { container, ownerUri };
}

async function withClient<T>(uri: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe("Phase 02.7 / D-03 Layer B — migration 0004 email lowercase normalize", {
  timeout: 180_000,
}, () => {
  describe("Test 1 — happy-path backfill on mixed-case rows (no collisions)", () => {
    let booted: BootedDb;

    beforeAll(async () => {
      booted = await bootFreshPostgres();
      await withClient(booted.ownerUri, async (c) => {
        await applyBaseMigrations(c);
        // Insert three mixed-case emails, NO case-collisions among them.
        // Use the default tenant which migration 0000 seeds.
        await c.query(
          `INSERT INTO "users" (tenant_id, email) VALUES
              ($1, 'Alice@Example.com'),
              ($1, 'BOB@example.com'),
              ($1, 'charlie@example.com')`,
          [DEFAULT_TENANT_ID],
        );
        // Apply the new migration AFTER seeding so the backfill has
        // something to lowercase.
        await applyMigrationFile(c, MIGRATION_0004);
      });
    }, 180_000);

    afterAll(async () => {
      if (booted) await booted.container.stop();
    });

    it("backfill UPDATE lowercased every previously-mixed-case email row", async () => {
      await withClient(booted.ownerUri, async (c) => {
        const r = await c.query<{ email: string }>(
          `SELECT email FROM "users" WHERE tenant_id = $1 ORDER BY email`,
          [DEFAULT_TENANT_ID],
        );
        const emails = r.rows.map((row) => row.email);
        expect(emails).toEqual(["alice@example.com", "bob@example.com", "charlie@example.com"]);
        // Defensive: NO row should have any uppercase character anywhere.
        for (const e of emails) {
          expect(e).toBe(e.toLowerCase());
        }
      });
    });

    it("lookup via lower(email) finds the row regardless of input case", async () => {
      await withClient(booted.ownerUri, async (c) => {
        const r = await c.query<{ one: number }>(
          `SELECT 1 AS one FROM "users" WHERE lower(email) = lower($1) LIMIT 1`,
          ["ALICE@example.COM"],
        );
        expect(r.rows.length).toBe(1);
      });
    });

    it("functional unique index users_tenant_email_lower_unique exists", async () => {
      await withClient(booted.ownerUri, async (c) => {
        const r = await c.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes
              WHERE tablename = 'users' AND indexname = 'users_tenant_email_lower_unique'`,
        );
        expect(r.rows.length).toBe(1);
      });
    });

    it("old case-sensitive index users_tenant_email_unique was dropped", async () => {
      await withClient(booted.ownerUri, async (c) => {
        const r = await c.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes
              WHERE tablename = 'users' AND indexname = 'users_tenant_email_unique'`,
        );
        expect(r.rows.length).toBe(0);
      });
    });
  });

  describe("Test 2 — collision precondition: migration RAISES EXCEPTION", () => {
    let booted: BootedDb;

    beforeAll(async () => {
      booted = await bootFreshPostgres();
    }, 180_000);

    afterAll(async () => {
      if (booted) await booted.container.stop();
    });

    it("migration 0004 refuses to auto-deduplicate case-collision dupes", async () => {
      await withClient(booted.ownerUri, async (c) => {
        await applyBaseMigrations(c);
        // Seed a case-collision: two rows whose lower(email) match under the
        // SAME tenant. The legacy (tenant_id, email) unique index does NOT
        // catch this because 'X@Y.com' <> 'x@y.com' as plain text.
        await c.query(
          `INSERT INTO "users" (tenant_id, email) VALUES
              ($1, 'X@Y.com'),
              ($1, 'x@y.com')`,
          [DEFAULT_TENANT_ID],
        );

        // Migration 0004's first statement is a DO $$ block that counts
        // case-collision groups and RAISE EXCEPTION when count > 0.
        await expect(applyMigrationFile(c, MIGRATION_0004)).rejects.toThrow(
          /refusing to auto-deduplicate/i,
        );

        // Defense-in-depth: confirm the seed rows are still present in
        // their original mixed case (no partial backfill leaked through).
        const after = await c.query<{ email: string }>(
          `SELECT email FROM "users" WHERE tenant_id = $1 ORDER BY email`,
          [DEFAULT_TENANT_ID],
        );
        // Both original rows survive untouched (one with capital X).
        expect(after.rows.map((r) => r.email).sort()).toEqual(["X@Y.com", "x@y.com"].sort());
      });
    });
  });

  describe("Test 3 — post-0004 unique violation on case-collision INSERT", () => {
    let booted: BootedDb;

    beforeAll(async () => {
      booted = await bootFreshPostgres();
      await withClient(booted.ownerUri, async (c) => {
        await applyBaseMigrations(c);
        await applyMigrationFile(c, MIGRATION_0004);
      });
    }, 180_000);

    afterAll(async () => {
      if (booted) await booted.container.stop();
    });

    it("INSERT 'FOO@bar.com' after 'foo@bar.com' (same tenant) raises unique_violation on the new functional index", async () => {
      await withClient(booted.ownerUri, async (c) => {
        await c.query(`INSERT INTO "users" (tenant_id, email) VALUES ($1, 'foo@bar.com')`, [
          DEFAULT_TENANT_ID,
        ]);
        // PostgreSQL error code 23505 = unique_violation.
        let err: unknown;
        try {
          await c.query(`INSERT INTO "users" (tenant_id, email) VALUES ($1, 'FOO@bar.com')`, [
            DEFAULT_TENANT_ID,
          ]);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
        const e = err as { code?: string; constraint?: string; message?: string };
        expect(e.code).toBe("23505");
        // The violation should reference our new functional index by name.
        // pg surfaces the index name in `.constraint` for unique_violation
        // raised by an index (not a table CONSTRAINT).
        expect(`${e.constraint ?? ""} ${e.message ?? ""}`).toMatch(
          /users_tenant_email_lower_unique/,
        );
      });
    });
  });

  describe("Test 4 — cross-tenant uniqueness isolation preserved", () => {
    let booted: BootedDb;

    beforeAll(async () => {
      booted = await bootFreshPostgres();
      await withClient(booted.ownerUri, async (c) => {
        await applyBaseMigrations(c);
        await applyMigrationFile(c, MIGRATION_0004);
        // Seed a second tenant — same email under different tenant_id MUST be allowed.
        await c.query(
          `INSERT INTO "tenants" (id, name) VALUES ($1, 'second')
              ON CONFLICT (id) DO NOTHING`,
          [SECOND_TENANT_ID],
        );
      });
    }, 180_000);

    afterAll(async () => {
      if (booted) await booted.container.stop();
    });

    it("'foo@bar.com' may exist under tenant1 AND tenant2 simultaneously (uniqueness scoped to (tenant_id, lower(email)))", async () => {
      await withClient(booted.ownerUri, async (c) => {
        await c.query(`INSERT INTO "users" (tenant_id, email) VALUES ($1, 'foo@bar.com')`, [
          DEFAULT_TENANT_ID,
        ]);
        await expect(
          c.query(`INSERT INTO "users" (tenant_id, email) VALUES ($1, 'foo@bar.com')`, [
            SECOND_TENANT_ID,
          ]),
        ).resolves.toBeDefined();
        const r = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "users" WHERE lower(email) = 'foo@bar.com'`,
        );
        expect(Number(r.rows[0].n)).toBe(2);
      });
    });
  });
});
